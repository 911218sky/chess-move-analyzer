importScripts(
  "../shared/errors.js",
  "../shared/llm.js",
  "../shared/background.js"
);

(function initChromeBackground() {
const OFFSCREEN_DOCUMENT_PATH = "pub/offscreen.html";

let offscreenDocumentPromise: Promise<void> | null = null;
let offscreenDocumentReady = false;

function sendRuntimeMessage<TResponse = unknown>(
  message: BackgroundRuntimeMessage
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response as TResponse);
    });
  });
}

function getStorageLocal<TStorage extends object>(
  keys: StorageKeySpec
): Promise<TStorage> {
  return new Promise<TStorage>((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve((result || {}) as TStorage);
    });
  });
}

async function getStoredLlmConfig(): Promise<LlmConfig> {
  return SharedLlm.getStoredLlmConfig((keys) => getStorageLocal<StoredLlmSettings>(keys));
}

async function explainMove(payload: ExplainMovePayload): Promise<ExplainMoveResult> {
  const config = await getStoredLlmConfig();
  if (!config.enabled) {
    throw new Error("LLM explanations are disabled.");
  }

  if (!config.apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  if (!config.model) {
    throw new Error("OpenAI model is missing.");
  }

  return SharedLlm.explainMoveWithConfig(payload, config);
}

function sendTabMessage<T = unknown>(
  tabId: number,
  message: ExtensionRuntimeMessage
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response as T);
    });
  });
}

async function streamExplainMoveWithConfig(
  payload: ExplainMovePayload,
  config: LlmConfig,
  requestId: string,
  tabId: number
): Promise<void> {
  const fullText = await SharedLlm.streamExplainMoveWithConfig(
    payload,
    config,
    async (deltaText) => {
      await sendTabMessage(tabId, {
        action: "explainMoveChunk",
        requestId,
        textDelta: deltaText,
        done: false,
        model: config.model,
        provider: config.provider,
      });
    }
  );

  await sendTabMessage(tabId, {
    action: "explainMoveChunk",
    requestId,
    text: fullText,
    done: true,
    model: config.model,
    provider: config.provider,
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenDocumentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenDocumentUrl],
    });

    if (existingContexts.length > 0) {
      offscreenDocumentReady = true;
      return;
    }
  }

  if (offscreenDocumentReady) {
    return;
  }

  if (offscreenDocumentPromise) {
    return offscreenDocumentPromise;
  }

  if (!chrome.offscreen) {
    throw new Error("Chrome offscreen API is unavailable.");
  }

  offscreenDocumentPromise = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WORKERS"],
      justification: "Run Stockfish analysis in an offscreen document.",
    })
    .then(() => {
      offscreenDocumentReady = true;
    })
    .finally(() => {
      offscreenDocumentPromise = null;
    });

  return offscreenDocumentPromise;
}

async function ensureOffscreenReceiver(): Promise<void> {
  await ensureOffscreenDocument();
  await sendRuntimeMessage({
    target: "offscreen",
    action: "ping",
  });
}

chrome.runtime.onMessage.addListener((
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => {
  if (SharedBackground.isObjectRecord(message) && message.target === "offscreen") {
    return undefined;
  }

  if (SharedBackground.isAnalyzeBoardMessage(message)) {
    ensureOffscreenReceiver()
      .then(() =>
        sendRuntimeMessage<AnalysisResult>({
          target: "offscreen",
          action: "analyzeBoard",
          fen: message.fen,
          options: message.options,
        })
      )
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        if (SharedErrors.isBenignAnalysisError(error)) {
          sendResponse({ superseded: true });
          return;
        }

        console.error("Offscreen analysis error:", error);
        sendResponse({ error: SharedErrors.getErrorMessage(error) });
      });

    return true;
  }

  if (SharedBackground.isListModelsMessage(message)) {
    SharedLlm.listOpenAiModels(message.baseUrl, message.apiKey)
      .then((models) => {
        sendResponse({ ok: true, models });
      })
      .catch((error) => {
        console.error("Model listing error:", error);
        sendResponse({ ok: false, error: SharedErrors.getErrorMessage(error) });
      });

    return true;
  }

  if (SharedBackground.isExplainMoveMessage(message)) {
    const tabId = SharedBackground.getSenderTabId(sender);
    getStoredLlmConfig()
      .then((config) => {
        if (!config.enabled) {
          sendResponse({ ok: false, error: "LLM explanations are disabled." });
          return;
        }

        if (!config.apiKey) {
          sendResponse({ ok: false, error: "OpenAI API key is missing." });
          return;
        }

        if (!config.model) {
          sendResponse({ ok: false, error: "OpenAI model is missing." });
          return;
        }

        if (tabId === null) {
          explainMove(message.payload)
            .then((result) => {
              sendResponse({ ok: true, ...result });
            })
            .catch((error) => {
              console.error("Move explanation error:", error);
              sendResponse({ ok: false, error: SharedErrors.getErrorMessage(error) });
            });
          return;
        }

        const requestId = message.requestId || `explain-${Date.now()}`;
        sendResponse({
          ok: true,
          streaming: true,
          requestId,
          model: config.model,
          provider: config.provider,
        });

        void streamExplainMoveWithConfig(message.payload, config, requestId, tabId).catch(
          async (error) => {
            console.error("Move explanation stream error:", error);
            try {
              await sendTabMessage(tabId, {
                action: "explainMoveChunk",
                requestId,
                error: SharedErrors.getErrorMessage(error),
                done: true,
                model: config.model,
                provider: config.provider,
              });
            } catch (sendError) {
              console.error("Unable to send explanation error chunk:", sendError);
            }
          }
        );
      })
      .catch((error) => {
        console.error("Move explanation error:", error);
        sendResponse({ ok: false, error: SharedErrors.getErrorMessage(error) });
      });

    return true;
  }

  return undefined;
});
})();
