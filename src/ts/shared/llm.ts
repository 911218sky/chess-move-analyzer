namespace SharedLlm {
  export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
  export const DEFAULT_LLM_PROVIDER: LlmProvider = "openai";
  export const DEFAULT_LLM_MODEL = "gpt-5.4-mini";
  export const DEFAULT_LLM_LANGUAGE: LlmLanguage = "zh-TW";
  export const LEGACY_DEFAULT_PROMPT_TEMPLATE = [
    "Explain the best chess move for an intermediate player.",
    "{{language_instruction}}",
    "Keep the response under 140 words.",
    "Focus on concrete tactical and strategic reasons.",
    "Mention the risk of ignoring the move.",
    "",
    "FEN: {{fen}}",
    "Board:",
    "{{board_text}}",
    "Side to move: {{side_to_move}}",
    "Best move: {{best_move}}",
    "Evaluation: {{evaluation}}",
    "Recent move: {{recent_move}}",
    "Candidate lines:",
    "{{candidate_lines}}",
  ].join("\n");
  export const DEFAULT_PROMPT_TEMPLATE = [
    "Explain the best chess move in simple, easy Traditional Chinese.",
    "{{language_instruction}}",
    "Use 2 to 4 short sentences.",
    "Start with: \u5efa\u8b70\u8d70 {{best_move}}\u3002",
    "Explain only the most important reason.",
    "If useful, mention one risk of not playing it.",
    "Avoid long paragraphs, jargon, and overly abstract strategy terms.",
    "",
    "FEN: {{fen}}",
    "Board:",
    "{{board_text}}",
    "Side to move: {{side_to_move}}",
    "Best move: {{best_move}}",
    "Evaluation: {{evaluation}}",
    "Recent move: {{recent_move}}",
    "Candidate lines:",
    "{{candidate_lines}}",
  ].join("\n");

  export function normalizePromptTemplate(template?: string | null): string {
    const trimmed = String(template ?? "").trim();
    if (!trimmed || trimmed === LEGACY_DEFAULT_PROMPT_TEMPLATE) {
      return DEFAULT_PROMPT_TEMPLATE;
    }

    return trimmed;
  }

  export function normalizeBaseUrl(value?: string | null): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      return DEFAULT_LLM_BASE_URL;
    }

    return trimmed.replace(/\/+$/, "");
  }

  export function normalizeLlmLanguage(value?: string | null): LlmLanguage {
    return value === "en" ? "en" : "zh-TW";
  }

  export function normalizeLlmProvider(value?: string | null): LlmProvider {
    return value === "openai" ? "openai" : DEFAULT_LLM_PROVIDER;
  }

  export function buildContentLlmSettings(
    settings: Partial<LlmConfig> & { enabled?: boolean }
  ): Required<LlmContentSettings> {
    return {
      enabled: settings.enabled === true,
      provider: settings.provider || DEFAULT_LLM_PROVIDER,
      model: settings.model || DEFAULT_LLM_MODEL,
      language: settings.language || DEFAULT_LLM_LANGUAGE,
    };
  }

  export function normalizeStoredLlmConfig(stored: StoredLlmSettings = {}): LlmConfig {
    return {
      enabled: stored.llmExplainEnabled === true,
      provider: normalizeLlmProvider(stored.llmProvider),
      baseUrl: normalizeBaseUrl(stored.llmBaseUrl || DEFAULT_LLM_BASE_URL),
      apiKey: stored.llmApiKey || "",
      model: stored.llmModel || DEFAULT_LLM_MODEL,
      language: normalizeLlmLanguage(stored.llmLanguage),
      promptTemplate: normalizePromptTemplate(stored.llmPromptTemplate),
    };
  }

  export function normalizePageLlmSettings(stored: StoredLlmSettings = {}): PageLlmSettings {
    const config = normalizeStoredLlmConfig(stored);

    return {
      ...config,
      availableModels: Array.isArray(stored.llmAvailableModels)
        ? stored.llmAvailableModels
        : [],
    };
  }

  export async function getStoredLlmConfig(
    getStoredValues: (keys: StorageKeySpec) => Promise<StoredLlmSettings>
  ): Promise<LlmConfig> {
    const stored = await getStoredValues([
      "llmExplainEnabled",
      "llmProvider",
      "llmBaseUrl",
      "llmApiKey",
      "llmModel",
      "llmLanguage",
      "llmPromptTemplate",
    ]);

    return normalizeStoredLlmConfig(stored);
  }

  export async function getPageLlmSettings(
    getStoredValues: (keys: StorageKeySpec) => Promise<StoredLlmSettings>
  ): Promise<PageLlmSettings> {
    const stored = await getStoredValues([
      "llmExplainEnabled",
      "llmProvider",
      "llmBaseUrl",
      "llmApiKey",
      "llmModel",
      "llmLanguage",
      "llmPromptTemplate",
      "llmAvailableModels",
    ]);

    return normalizePageLlmSettings(stored);
  }

  export async function notifyLlmSettingsChanged(
    getPageSettings: () => Promise<PageLlmSettings>
  ): Promise<void> {
    const state = await extensionAPI.storage.local.get<StoredDisplayPreferences>(
      "autoAnalyzeEnabled"
    );
    if (!state.autoAnalyzeEnabled) {
      return;
    }

    const activeTab = await SharedTab.getActiveTab();
    if (!activeTab || !SharedTab.isChessTab(activeTab.url)) {
      return;
    }

    const llmSettings = await getPageSettings();
    try {
      await SharedTab.sendMessageToTab(activeTab, {
        action: "llmSettingsChanged",
        llmSettings: buildContentLlmSettings(llmSettings),
      });
    } catch (error) {
      if (SharedErrors.isMissingReceiverError(error)) {
        return;
      }

      throw error;
    }
  }

  export function extractMessageText(content?: OpenAiMessageContent): string {
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item?.type === "text") {
            return item.text || "";
          }

          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    return "";
  }

  export function extractStreamDeltaText(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
            return (item as { text?: string }).text || "";
          }

          return "";
        })
        .join("");
    }

    return "";
  }

  export function buildExplanationPrompt(payload: ExplainMovePayload, config: LlmConfig): string {
    const candidateLines = Array.isArray(payload?.candidateLines)
      ? payload.candidateLines
          .map((line: ExplainMoveCandidateLine, index: number) => {
            const pv = Array.isArray(line?.pv) ? line.pv.join(" ") : line?.move || "";
            return `${index + 1}. ${line?.move || "-"} | ${line?.score || "-"} | ${pv}`;
          })
          .join("\n")
      : "";
    const recentMove = payload?.review?.move
      ? `Recent move: ${payload.review.move} (${payload.review.moverColor || "unknown"})`
      : "Recent move: unavailable";
    const languageInstruction =
      config?.language === "en"
        ? "Reply in English."
        : "Reply in Traditional Chinese.";
    const template = normalizePromptTemplate(config?.promptTemplate);
    const replacements = {
      "{{language_instruction}}": languageInstruction,
      "{{fen}}": payload?.fen || "",
      "{{board_text}}": payload?.boardText || "Board unavailable",
      "{{side_to_move}}": payload?.activeColor === "b" ? "Black" : "White",
      "{{best_move}}": payload?.bestMove || "-",
      "{{evaluation}}": payload?.evaluation || "-",
      "{{recent_move}}": recentMove,
      "{{candidate_lines}}": candidateLines || "1. unavailable",
    };

    return Object.entries(replacements).reduce(
      (prompt, [token, value]) => prompt.split(token).join(value),
      template
    );
  }

  export async function performJsonRequest<
    TResponse extends { error?: { message?: string }; message?: string }
  >(
    baseUrl: string,
    path: string,
    apiKey: string,
    body?: OpenAiChatCompletionRequest
  ): Promise<TResponse> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json().catch(() => ({}))) as TResponse;
    if (!response.ok) {
      const apiMessage =
        data?.error?.message || data?.message || `Request failed: ${response.status}`;
      throw new Error(apiMessage);
    }

    return data;
  }

  export async function listOpenAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const data = await performJsonRequest<OpenAiModelListResponse>(
      baseUrl,
      "/models",
      apiKey,
      undefined
    );
    return (Array.isArray(data?.data) ? data.data : [])
      .map((model: OpenAiModelRecord) => model?.id)
      .filter(
        (modelId): modelId is string =>
          typeof modelId === "string" && modelId.length > 0
      )
      .sort((left, right) => left.localeCompare(right));
  }

  export function buildExplainMoveRequest(
    payload: ExplainMovePayload,
    config: LlmConfig,
    stream = false
  ): OpenAiChatCompletionRequest {
    return {
      model: config.model,
      temperature: 0.2,
      max_tokens: 220,
      stream,
      messages: [
        {
          role: "system",
          content:
            "You are a chess coach for casual players. Reply in very simple language. Keep it short, direct, and easy to understand. Prefer 2 to 4 short sentences. Avoid long paragraphs and technical jargon.",
        },
        {
          role: "user",
          content: buildExplanationPrompt(payload, config),
        },
      ],
    };
  }

  export async function explainMoveWithConfig(
    payload: ExplainMovePayload,
    config: LlmConfig
  ): Promise<ExplainMoveResult> {
    const data = await performJsonRequest<OpenAiChatCompletionResponse>(
      config.baseUrl,
      "/chat/completions",
      config.apiKey,
      buildExplainMoveRequest(payload, config)
    );

    const text = extractMessageText(data?.choices?.[0]?.message?.content);
    if (!text) {
      throw new Error("The model returned an empty explanation.");
    }

    return {
      text,
      model: config.model,
      provider: config.provider,
    };
  }

  export async function streamExplainMoveWithConfig(
    payload: ExplainMovePayload,
    config: LlmConfig,
    onDelta: (deltaText: string) => Promise<void> | void
  ): Promise<string> {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildExplainMoveRequest(payload, config, true)),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        message?: string;
      };
      throw new Error(
        data?.error?.message || data?.message || `Request failed: ${response.status}`
      );
    }

    if (!response.body) {
      const result = await explainMoveWithConfig(payload, config);
      await onDelta(result.text);
      return result.text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) {
          continue;
        }

        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: unknown };
          }>;
        };
        const deltaText = extractStreamDeltaText(parsed?.choices?.[0]?.delta?.content);
        if (!deltaText) {
          continue;
        }

        fullText += deltaText;
        await onDelta(deltaText);
      }
    }

    return fullText;
  }
}
