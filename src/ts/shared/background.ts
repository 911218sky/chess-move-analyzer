namespace SharedBackground {
  export function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  export function getSenderTabId(sender: unknown): number | null {
    const tabId = (sender as { tab?: { id?: number } })?.tab?.id;
    return typeof tabId === "number" ? tabId : null;
  }

  export function isAnalyzeBoardMessage(message: unknown): message is AnalyzeBoardMessage {
    return (
      isObjectRecord(message) &&
      message.action === "analyzeBoard" &&
      typeof message.fen === "string" &&
      (typeof message.options === "undefined" || isObjectRecord(message.options))
    );
  }

  export function isListModelsMessage(message: unknown): message is ListOpenAiModelsMessage {
    return (
      isObjectRecord(message) &&
      message.action === "listOpenAiModels" &&
      typeof message.baseUrl === "string" &&
      typeof message.apiKey === "string"
    );
  }

  export function isExplainMoveMessage(message: unknown): message is ExplainMoveMessage {
    return (
      isObjectRecord(message) &&
      message.action === "explainMove" &&
      isObjectRecord(message.payload)
    );
  }
}
