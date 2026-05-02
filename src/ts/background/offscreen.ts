(function initOffscreen() {
const analyzer = new StockfishAnalyzer({
  full: [
    chrome.runtime.getURL("stockfish/stockfish-18.js"),
    chrome.runtime.getURL("stockfish/stockfish-18-single.js"),
  ],
  lite: [
    chrome.runtime.getURL("stockfish/stockfish-18-lite.js"),
    chrome.runtime.getURL("stockfish/stockfish-18-lite-single.js"),
  ],
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return undefined;
  }

  if (message.action === "ping") {
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action !== "analyzeBoard") {
    return undefined;
  }

  analyzer
    .analyzeFen(message.fen, message.options)
    .then((analysis) => {
      sendResponse(analysis);
    })
    .catch((error) => {
      if (SharedErrors.isBenignAnalysisError(error)) {
        sendResponse({ superseded: true });
        return;
      }

      console.error("Stockfish analysis error:", error);
      sendResponse({ error: SharedErrors.getErrorMessage(error) });
    });

  return true;
});
})();
