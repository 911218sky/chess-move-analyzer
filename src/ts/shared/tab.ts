namespace SharedTab {
  export function isChessTab(url: string | undefined): boolean {
    return /^https?:\/\/(www\.)?chess\.com\//i.test(url || "");
  }

  export async function getActiveTab(): Promise<BrowserTab | null> {
    const tabs = await extensionAPI.tabs.query({
      active: true,
      currentWindow: true,
    });

    return tabs[0] || null;
  }

  export async function ensureContentScriptInjected(
    tab: BrowserTab | null
  ): Promise<boolean> {
    if (!tab?.id || !isChessTab(tab.url) || !extensionAPI.raw?.scripting) {
      return false;
    }

    await extensionAPI.raw.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "js/core/extension-api.js",
        "js/shared/errors.js",
        "js/shared/display.js",
        "js/content/content.js",
      ],
    });

    return true;
  }

  export async function sendMessageToTab<T>(
    tab: BrowserTab,
    message: ExtensionRuntimeMessage
  ): Promise<T> {
    try {
      return await extensionAPI.tabs.sendMessage<T>(tab.id, message);
    } catch (error) {
      if (!SharedErrors.isMissingReceiverError(error)) {
        throw error;
      }

      const injected = await ensureContentScriptInjected(tab);
      if (!injected) {
        throw error;
      }

      return extensionAPI.tabs.sendMessage<T>(tab.id, message);
    }
  }
}
