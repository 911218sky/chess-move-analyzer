(function initFirefoxBackground() {
const analyzer = new StockfishAnalyzer({
  full: [
    browser.runtime.getURL("stockfish/stockfish-18.js"),
    browser.runtime.getURL("stockfish/stockfish-18-single.js"),
  ],
  lite: [
    browser.runtime.getURL("stockfish/stockfish-18-lite.js"),
    browser.runtime.getURL("stockfish/stockfish-18-lite-single.js"),
  ],
});

async function getStoredLlmConfig(): Promise<LlmConfig> {
  return SharedLlm.getStoredLlmConfig((keys) =>
    browser.storage.local.get<StoredLlmSettings>(keys)
  );
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

async function sendTabMessage<T = unknown>(
  tabId: number,
  message: ExtensionRuntimeMessage
): Promise<T> {
  return browser.tabs.sendMessage(tabId, message) as Promise<T>;
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

browser.runtime.onMessage.addListener((message: unknown, sender: unknown) => {
  if (SharedBackground.isAnalyzeBoardMessage(message)) {
    return analyzer.analyzeFen(message.fen, message.options).catch((error) => {
      if (SharedErrors.isBenignAnalysisError(error)) {
        return { superseded: true };
      }

      throw error;
    });
  }

  if (SharedBackground.isListModelsMessage(message)) {
    return SharedLlm.listOpenAiModels(message.baseUrl, message.apiKey)
      .then((models) => ({ ok: true, models }))
      .catch((error) => {
        console.error("Model listing error:", error);
        return { ok: false, error: SharedErrors.getErrorMessage(error) };
      });
  }

  if (SharedBackground.isExplainMoveMessage(message)) {
    const tabId = SharedBackground.getSenderTabId(sender);
    return getStoredLlmConfig()
      .then(async (config) => {
        if (!config.enabled) {
          return { ok: false, error: "LLM explanations are disabled." };
        }

        if (!config.apiKey) {
          return { ok: false, error: "OpenAI API key is missing." };
        }

        if (!config.model) {
          return { ok: false, error: "OpenAI model is missing." };
        }

        if (tabId === null) {
          const result = await SharedLlm.explainMoveWithConfig(message.payload, config);
          return { ok: true, ...result };
        }

        const requestId = message.requestId || `explain-${Date.now()}`;
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

        return {
          ok: true,
          streaming: true,
          requestId,
          model: config.model,
          provider: config.provider,
        };
      })
      .catch((error) => {
        console.error("Move explanation error:", error);
        return { ok: false, error: SharedErrors.getErrorMessage(error) };
      });
  }

  return undefined;
});
})();
