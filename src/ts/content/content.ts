(function initContentScript() {
type BoardCell = string | null;
type BoardState = BoardCell[][];
type MoveQualityKey =
  | "brilliant"
  | "great"
  | "best"
  | "mistake"
  | "miss"
  | "blunder";
type ScoreboardStatus = "calculating" | "tracking" | "ready" | "Calculating...";

type MoveQuality = {
  key: MoveQualityKey;
  label: string;
  icon: string;
  tone: MoveQualityKey;
  expectedDrop: number;
  winPercentDrop: number;
  centipawnLoss: number;
  bestMove: string;
};

type MoveReview = {
  move: string;
  moverColor: ActiveColor;
  quality: MoveQuality;
};

type ScoreboardState = {
  analysis: AnalysisResult;
  activeColor: ActiveColor;
  review: MoveReview | null;
  status: ScoreboardStatus;
};

type AccuracyStats = {
  moves: number;
  totalAccuracy: number;
  harmonicDenominator: number;
};

type ExplanationState =
  | { status: "loading"; model: string; requestId?: string }
  | { status: "streaming"; text: string; model: string; provider: string; requestId: string }
  | { status: "ready"; text: string; model: string; provider: string }
  | { status: "error"; error: string; model: string }
  | { status: "config"; message: string; model: string };

type ReviewSeed = {
  move: string;
  moverColor: ActiveColor;
  previousAnalysis: AnalysisResult;
};

let isAutoAnalyzeEnabled = false;
let moveObserver: MutationObserver | null = null;
let previousHighlights: HTMLElement[] = [];
let activeAnalysisId = 0;
let latestAnalysisFen: string | null = null;
let pendingAnalysisTimer: number | null = null;
let boardSettleTimer: number | null = null;
let boardPollTimer: number | null = null;
let lastObservedBoardState: BoardState | null = null;
let lastObservedBoardSignature: string | null = null;
let lastKnownActiveColor: ActiveColor = "w";
let fenCastlingRights: string | null = null;
let fenEnPassantSquare = "-";
let fenHalfmoveClock = 0;
let fenFullmoveNumber = 1;
let latestCompletedAnalysis: AnalysisResult | null = null;
let latestMoveReview: MoveReview | null = null;
let latestScoreboardState: ScoreboardState | null = null;
let scoreboardCollapsed = false;
let explanationCollapsed = false;
let moveQualityTotals = createEmptyQualityTotals();
let accuracyTotals = createEmptyAccuracyTotals();
let selectedPredictionSide: PredictionSide = "both";
let selectedShowMoveHints = true;
let selectedEngineMode: EngineMode = "full";
let selectedAnalysisSettings: AnalysisSettings = {
  searchMode: "time",
  movetime: 3000,
  depth: 18,
  multiPv: 1,
  hashMb: 256,
  threads: 4,
};
let selectedLlmSettings: Required<LlmContentSettings> = {
  enabled: false,
  provider: "openai",
  model: "gpt-5.4-mini",
  language: "zh-TW",
};
let latestExplanationState: ExplanationState | null = null;
let activeExplanationToken = 0;
let activeExplanationRequestId: string | null = null;
const CANDIDATE_HIGHLIGHT_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
];

// Toast system setup
const toastContainer = document.createElement("div");
toastContainer.style.cssText = `
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  width: 300px;
  pointer-events: none;
`;
document.body.appendChild(toastContainer);

// Move display toast
const moveDisplay = document.createElement("div");
moveDisplay.style.cssText = `
  background-color: #262421;
  color: #fff;
  padding: 16px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 14px;
  display: none;
  transition: all 0.3s ease-in-out;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1px solid #404040;
`;
toastContainer.appendChild(moveDisplay);

// Loading indicator toast
const loadingToast = document.createElement("div");
loadingToast.style.cssText = `
  background-color: #262421;
  color: #fff;
  padding: 16px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 14px;
  display: none;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1px solid #404040;
`;

// Add loading spinner
const spinner = document.createElement("div");
spinner.style.cssText = `
  width: 16px;
  height: 16px;
  border: 2px solid #404040;
  border-top: 2px solid #7fa650;
  border-radius: 50%;
  animation: spin 1s linear infinite;
`;

// Add spinner animation
const style = document.createElement("style");
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(100%);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  
  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0);
    }
    to {
      opacity: 0;
      transform: translateX(100%);
    }
  }
`;
document.head.appendChild(style);

const loadingText = document.createElement("span");
loadingText.textContent = "Analyzing position...";
loadingToast.appendChild(spinner);
loadingToast.appendChild(loadingText);
toastContainer.appendChild(loadingToast);

const scoreboardPanel = document.createElement("div");
scoreboardPanel.style.cssText = `
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 10000;
  width: 320px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  background: #262421;
  color: #fff;
  border: 1px solid #404040;
  border-radius: 6px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.24);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 13px;
  display: none;
  overflow: hidden;
`;
document.body.appendChild(scoreboardPanel);

scoreboardPanel.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  const toggle = target?.closest?.("#chess-analyzer-scoreboard-toggle");
  const explanationToggle = target?.closest?.("#chess-analyzer-explanation-toggle");
  if (toggle && latestScoreboardState) {
    scoreboardCollapsed = !scoreboardCollapsed;
    renderScoreboard(
      latestScoreboardState.analysis,
      latestScoreboardState.activeColor,
      latestScoreboardState.review,
      latestScoreboardState.status
    );
    return;
  }

  if (explanationToggle && latestScoreboardState) {
    explanationCollapsed = !explanationCollapsed;
    renderScoreboard(
      latestScoreboardState.analysis,
      latestScoreboardState.activeColor,
      latestScoreboardState.review,
      latestScoreboardState.status
    );
  }
});

function showLoadingLegacy(activeColor) {
  if (!isAutoAnalyzeEnabled) return;
  clearHighlights();
  loadingText.textContent = `Analyzing ${getColorLabel(activeColor)} move...`;
  loadingToast.style.display = "flex";
  loadingToast.style.animation = "slideIn 0.3s ease-out forwards";
  moveDisplay.style.display = "none";
}

function hideLoadingLegacy() {
  loadingToast.style.animation = "slideOut 0.3s ease-in forwards";
  setTimeout(() => {
    loadingToast.style.display = "none";
  }, 300);
}

function showBestMoveLegacy(move) {
  if (!isAutoAnalyzeEnabled) return;

  // Check for promotion move
  if (move.length === 5) {
    let promotionPiece = "";
    switch (move[4].toLowerCase()) {
      case "q":
        promotionPiece = "Queen";
        break;
      case "r":
        promotionPiece = "Rook";
        break;
      case "b":
        promotionPiece = "Bishop";
        break;
      case "n":
        promotionPiece = "Knight";
        break;
    }

    moveDisplay.innerHTML = `
      <div style="margin-bottom: 8px;">
        <span style="color: #7fa650; font-weight: 600;">Best move:</span>
        <span style="font-weight: 500;"> ${move.substring(0, 4)}</span>
      </div>
      <div style="font-size: 13px; color: #a8a8a8;">
        <span style="color: #f1c40f;">鈽?/span> Promote to ${promotionPiece}
      </div>
    `;
  } else {
    moveDisplay.innerHTML = `
      <span style="color: #7fa650; font-weight: 600;">Best move:</span>
      <span style="font-weight: 500;"> ${move}</span>
    `;
  }

  moveDisplay.style.display = "block";
  moveDisplay.style.animation = "slideIn 0.3s ease-out forwards";
  hideLoading();
  highlightBestMove(move);
}

function hideBestMove() {
  moveDisplay.style.animation = "slideOut 0.3s ease-in forwards";
  setTimeout(() => {
    moveDisplay.style.display = "none";
  }, 300);
  hideLoading();
  clearHighlights();
}

function showLoading(activeColor) {
  if (!isAutoAnalyzeEnabled || !shouldShowMoveHintsForColor(activeColor)) {
    hideLoading();
    moveDisplay.style.display = "none";
    clearHighlights();
    return;
  }
  clearHighlights();
  loadingText.textContent = `Analyzing ${getColorLabel(activeColor)} move...`;
  loadingToast.style.display = "flex";
  moveDisplay.style.display = "none";
}

function hideLoading() {
  loadingToast.style.display = "none";
}

function getCandidateColor(index) {
  return CANDIDATE_HIGHLIGHT_COLORS[
    index % CANDIDATE_HIGHLIGHT_COLORS.length
  ];
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getMoveSquares(move) {
  if (!move || move.length < 4) {
    return null;
  }

  const charToNum = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
  const fromFile = charToNum[move[0]];
  const toFile = charToNum[move[2]];

  if (!fromFile || !toFile) {
    return null;
  }

  return {
    fromSquare: `${fromFile}${move[1]}`,
    toSquare: `${toFile}${move[3]}`,
  };
}

function createMoveHighlight(
  square: string,
  color: string,
  index: number,
  isTarget: boolean
): HTMLDivElement {
  const highlight = document.createElement("div");
  highlight.className = `highlight cheat-highlight square-${square}`;
  highlight.style.cssText = `
    background:${hexToRgba(color, isTarget ? 0.55 : 0.3)};
    box-shadow: inset 0 0 0 ${isTarget ? 4 : 2}px ${color};
    z-index:${20 + index};
    position:absolute;
    pointer-events:none;
    box-sizing:border-box;
    display:flex;
    align-items:flex-start;
    justify-content:flex-end;
    color:#fff;
    font-size:16px;
    font-weight:700;
    line-height:1;
    padding:4px;
    text-shadow:0 1px 2px rgba(0, 0, 0, 0.6);
  `;
  if (isTarget) {
    highlight.textContent = String(index + 1);
  }
  return highlight;
}

function highlightBestMove(bestMove, lines = []) {
  // Remove existing highlights
  previousHighlights.forEach((highlight) => highlight.remove());
  previousHighlights = [];

  if (!selectedShowMoveHints) {
    return;
  }

  const chessboard = document.querySelector("wc-chess-board");
  if (!chessboard) {
    console.error("Chessboard not found for highlighting.");
    return;
  }

  const candidateMoves = lines
    .map((line) => line.move || line.pv?.[0])
    .filter(Boolean);
  const moves = candidateMoves.length > 0 ? candidateMoves : [bestMove];
  const uniqueMoves = [];

  for (const move of moves) {
    if (!uniqueMoves.includes(move)) {
      uniqueMoves.push(move);
    }
  }

  if (bestMove && !uniqueMoves.includes(bestMove)) {
    uniqueMoves.unshift(bestMove);
  }

  if (uniqueMoves.length === 0 || !bestMove || bestMove.length < 4) {
    console.error("Invalid best move:", bestMove);
    return;
  }

  uniqueMoves.slice(0, 5).forEach((move, index) => {
    const squares = getMoveSquares(move);
    if (!squares) {
      return;
    }

    const color = getCandidateColor(index);
    const initialHighlight = createMoveHighlight(
      squares.fromSquare,
      color,
      index,
      false
    );
    const finalHighlight = createMoveHighlight(
      squares.toSquare,
      color,
      index,
      true
    );

    chessboard.appendChild(initialHighlight);
    chessboard.appendChild(finalHighlight);
    previousHighlights.push(initialHighlight, finalHighlight);
  });
}

function clearHighlights() {
  previousHighlights.forEach((highlight) => highlight.remove());
  previousHighlights = [];
}

function getColorLabel(activeColor) {
  return activeColor === "b" ? "Black" : "White";
}

function getOpponentColor(color) {
  return color === "b" ? "w" : "b";
}

function getFallbackActiveColor(playerColor) {
  return playerColor === "black" ? "b" : "w";
}

function shouldShowPredictionForColor(activeColor) {
  return (
    selectedPredictionSide === "both" ||
    (selectedPredictionSide === "white" && activeColor === "w") ||
    (selectedPredictionSide === "black" && activeColor === "b")
  );
}

function shouldExplainForColor(activeColor: ActiveColor): boolean {
  return shouldShowPredictionForColor(activeColor);
}

function shouldShowMoveHintsForColor(activeColor) {
  return selectedShowMoveHints && shouldShowPredictionForColor(activeColor);
}

function getSelectedLineLimit() {
  const lineLimit = Number.parseInt(String(selectedAnalysisSettings.multiPv), 10);
  if (!Number.isFinite(lineLimit)) {
    return 1;
  }

  return Math.max(1, Math.min(5, lineLimit));
}

function limitAnalysisLines(analysis) {
  if (!analysis || !Array.isArray(analysis.lines)) {
    return analysis;
  }

  const lineLimit = getSelectedLineLimit();
  analysis.lines = analysis.lines.slice(0, lineLimit);
  analysis.multiPv = lineLimit;
  return analysis;
}

function formatScore(line) {
  if (!line || line.score === null || line.score === undefined) {
    return "";
  }

  if (line.scoreType === "mate") {
    return `M${line.score}`;
  }

  const pawns = line.score / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function getLineWhiteCentipawns(line, activeColor) {
  if (!line || line.score === null || line.score === undefined) {
    return 0;
  }

  if (line.scoreType === "mate") {
    const mateForWhite = activeColor === "w" ? line.score : -line.score;
    const direction = mateForWhite >= 0 ? 1 : -1;
    return direction * (100000 - Math.min(Math.abs(mateForWhite), 99) * 1000);
  }

  return activeColor === "w" ? line.score : -line.score;
}

function getLineCentipawnsForColor(line, activeColor, color) {
  const whiteCp = getLineWhiteCentipawns(line, activeColor);
  return color === "w" ? whiteCp : -whiteCp;
}

function estimateWhiteWinPercentFromCp(cp) {
  return 100 / (1 + Math.exp(-cp / 250));
}

function normalizeWdlChances(wdl) {
  const win = Number(wdl?.win || 0);
  const draw = Number(wdl?.draw || 0);
  const loss = Number(wdl?.loss || 0);
  const total = win + draw + loss;

  if (total <= 0) {
    return null;
  }

  return {
    win: (win / total) * 100,
    draw: (draw / total) * 100,
    loss: (loss / total) * 100,
  };
}

function getWinningChances(line, activeColor) {
  if (!line) {
    return { white: 50, draw: 0, black: 50 };
  }

  if (line.wdl) {
    const sideToMoveChances = normalizeWdlChances(line.wdl);

    if (sideToMoveChances) {
      const white =
        activeColor === "w" ? sideToMoveChances.win : sideToMoveChances.loss;
      const black =
        activeColor === "w" ? sideToMoveChances.loss : sideToMoveChances.win;

      return {
        white,
        draw: sideToMoveChances.draw,
        black,
      };
    }
  }

  const white = estimateWhiteWinPercentFromCp(
    getLineWhiteCentipawns(line, activeColor)
  );
  return {
    white,
    draw: 0,
    black: 100 - white,
  };
}

function getExpectedScoreForColor(line, activeColor, color) {
  const chances = getWinningChances(line, activeColor);
  const expectedWhite = (chances.white + chances.draw * 0.5) / 100;
  return color === "w" ? expectedWhite : 1 - expectedWhite;
}

function formatWhiteScore(line, activeColor) {
  if (!line || line.score === null || line.score === undefined) {
    return "0.00";
  }

  if (line.scoreType === "mate") {
    const mateForWhite = activeColor === "w" ? line.score : -line.score;
    return mateForWhite >= 0 ? `M${mateForWhite}` : `-M${Math.abs(mateForWhite)}`;
  }

  const whitePawns = getLineWhiteCentipawns(line, activeColor) / 100;
  return `${whitePawns > 0 ? "+" : ""}${whitePawns.toFixed(2)}`;
}

function formatChancePercent(value) {
  const number = Number(value);
  const clamped = Number.isFinite(number)
    ? Math.max(0, Math.min(100, number))
    : 0;

  if (clamped === 0 || clamped === 100) {
    return `${Math.round(clamped)}%`;
  }

  if (clamped < 0.1) {
    return "<0.1%";
  }

  if (clamped > 99.9) {
    return "99.9%";
  }

  const rounded = Math.round(clamped * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function getMoveStatsColumns(): Array<{
  color: ActiveColor;
  label: string;
  detail: string;
}> {
  if (selectedPredictionSide === "white") {
    return [{ color: "w", label: "You", detail: "White" }];
  }

  if (selectedPredictionSide === "black") {
    return [{ color: "b", label: "You", detail: "Black" }];
  }

  return [
    { color: "w", label: "White", detail: "" },
    { color: "b", label: "Black", detail: "" },
  ];
}

function createEmptyQualityTotals(): Record<ActiveColor, Record<MoveQualityKey, number>> {
  return {
    w: { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 },
    b: { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 },
  };
}

function createEmptyAccuracyTotals(): Record<ActiveColor, AccuracyStats> {
  return {
    w: { moves: 0, totalAccuracy: 0, harmonicDenominator: 0 },
    b: { moves: 0, totalAccuracy: 0, harmonicDenominator: 0 },
  };
}

function resetReviewState() {
  latestCompletedAnalysis = null;
  latestMoveReview = null;
  moveQualityTotals = createEmptyQualityTotals();
  accuracyTotals = createEmptyAccuracyTotals();
}

function resetFenState() {
  fenCastlingRights = null;
  fenEnPassantSquare = "-";
  fenHalfmoveClock = 0;
  fenFullmoveNumber = 1;
}

function normalizeUciMove(move) {
  if (!move) {
    return "";
  }

  const value = String(move).trim();
  return value.length <= 4
    ? value.toLowerCase()
    : `${value.slice(0, 4).toLowerCase()}${value[4].toLowerCase()}`;
}

function recordMoveQuality(color, quality) {
  if (!quality || !moveQualityTotals[color]) {
    return;
  }

  moveQualityTotals[color][quality.key] += 1;
  accuracyTotals[color].moves += 1;
  const moveAccuracy = getMoveAccuracyScore(quality);
  accuracyTotals[color].totalAccuracy += moveAccuracy;
  accuracyTotals[color].harmonicDenominator += 1 / Math.max(1, moveAccuracy);
}

function getAccuracy(color) {
  const stats = accuracyTotals[color];
  if (!stats || stats.moves === 0) {
    return "-";
  }

  // Blend arithmetic and harmonic means so one catastrophic move still matters
  // without making a single miss dominate the entire session score.
  const arithmeticMean = stats.totalAccuracy / stats.moves;
  const harmonicMean = stats.moves / Math.max(0.0001, stats.harmonicDenominator);
  const blendedAccuracy = (arithmeticMean + harmonicMean) / 2;

  return Math.max(0, Math.min(100, blendedAccuracy)).toFixed(1);
}

function getMoveAccuracyScore(quality) {
  if (!quality) {
    return 0;
  }

  const winPercentDrop = Math.max(0, quality.winPercentDrop || 0);
  const baseScore = 103.1668 * Math.exp(-0.04354 * winPercentDrop) - 3.1669;
  const floorByQuality = {
    brilliant: 100,
    great: 96,
    best: 92,
    mistake: 62,
    miss: 48,
    blunder: 22,
  };
  const floor = floorByQuality[quality.key] ?? 40;

  if (quality.key === "brilliant") {
    return 100;
  }

  return Math.max(floor, Math.min(100, baseScore));
}

function getQualityColor(tone) {
  const colors = {
    brilliant: "#26c2a3",
    great: "#86a8c8",
    best: "#7eb957",
    mistake: "#d45b4f",
    miss: "#f07065",
    blunder: "#c83a3a",
  };
  return colors[tone] || colors.best;
}

function getColorChipStyle(color) {
  if (color === "w") {
    return "background:#f3f3f3; border:1px solid #777;";
  }

  return "background:#111; border:1px solid #777;";
}

function renderColorBadge(color, label, detail = "") {
  return `
    <span style="display:inline-flex; align-items:center; gap:6px;">
      <span style="width:10px; height:10px; border-radius:999px; ${getColorChipStyle(
        color
      )}"></span>
      <span>${escapeHtml(label)}</span>
      ${detail ? `<span style="color:#8f8f8f;">${escapeHtml(detail)}</span>` : ""}
    </span>
  `;
}

function shouldShowReviewForCurrentSelection(review) {
  if (!review) {
    return false;
  }

  if (selectedPredictionSide === "both") {
    return true;
  }

  const focusedColor = selectedPredictionSide === "white" ? "w" : "b";
  return review.moverColor === focusedColor;
}

function classifyMoveQuality(
  playedMove,
  moverColor,
  previousAnalysis,
  currentAnalysis
): MoveQuality | null {
  // Compare the played move against the engine's previous recommendation from
  // the mover's perspective, then classify by expected-score loss rather than
  // raw centipawn loss alone.
  const previousLine = previousAnalysis?.lines?.[0];
  const currentLine = currentAnalysis?.lines?.[0];
  if (!playedMove || !previousLine || !currentLine) {
    return null;
  }

  const previousActiveColor = previousAnalysis.activeColor || moverColor;
  const currentActiveColor =
    currentAnalysis.activeColor || getOpponentColor(moverColor);
  const normalizedPlayedMove = normalizeUciMove(playedMove);
  const previousPlayedLine = previousAnalysis.lines?.find(
    (line) => normalizeUciMove(line.move) === normalizedPlayedMove
  );
  const playedLine = previousPlayedLine || currentLine;
  const playedActiveColor = previousPlayedLine
    ? previousActiveColor
    : currentActiveColor;
  const bestExpected = getExpectedScoreForColor(
    previousLine,
    previousActiveColor,
    moverColor
  );
  const playedExpected = getExpectedScoreForColor(
    playedLine,
    playedActiveColor,
    moverColor
  );
  const expectedDrop = Math.max(0, bestExpected - playedExpected);
  const previousChances = getWinningChances(previousLine, previousActiveColor);
  const playedChances = getWinningChances(playedLine, playedActiveColor);
  const previousWinPercent =
    moverColor === "w" ? previousChances.white : previousChances.black;
  const playedWinPercent =
    moverColor === "w" ? playedChances.white : playedChances.black;
  const winPercentDrop = Math.max(0, previousWinPercent - playedWinPercent);
  const bestCp = getLineCentipawnsForColor(
    previousLine,
    previousActiveColor,
    moverColor
  );
  const playedCp = getLineCentipawnsForColor(
    playedLine,
    playedActiveColor,
    moverColor
  );
  const centipawnLoss = Math.max(0, bestCp - playedCp);
  const bestMove = previousLine.move || previousAnalysis.move || normalizedPlayedMove;
  const normalizedBestMove = normalizeUciMove(bestMove);
  const isBestMove = normalizedPlayedMove === normalizedBestMove;
  const previousWinChance = getExpectedScoreForColor(
    previousLine,
    previousActiveColor,
    moverColor
  );
  const secondLine = previousAnalysis?.lines?.[1];
  const secondBestDrop = secondLine
    ? Math.max(
        0,
        bestExpected -
          getExpectedScoreForColor(secondLine, previousActiveColor, moverColor)
      )
    : 0;

  if (isBestMove && secondBestDrop >= 0.14) {
    return {
      key: "brilliant",
      label: "Brilliant",
      icon: "!!",
      tone: "brilliant",
      expectedDrop,
      winPercentDrop,
      centipawnLoss,
      bestMove,
    };
  }

  if (isBestMove && secondBestDrop >= 0.08) {
    return {
      key: "great",
      label: "Great",
      icon: "!",
      tone: "great",
      expectedDrop,
      winPercentDrop,
      centipawnLoss,
      bestMove,
    };
  }

  if (isBestMove || expectedDrop <= 0.03) {
    return {
      key: "best",
      label: "Best",
      icon: "*",
      tone: "best",
      expectedDrop,
      winPercentDrop,
      centipawnLoss,
      bestMove,
    };
  }

  if (previousWinChance >= 0.75 && expectedDrop >= 0.2) {
    return {
      key: "miss",
      label: "Miss",
      icon: "X",
      tone: "miss",
      expectedDrop,
      winPercentDrop,
      centipawnLoss,
      bestMove,
    };
  }

  if (expectedDrop >= 0.35) {
    return {
      key: "blunder",
      label: "Blunder",
      icon: "??",
      tone: "blunder",
      expectedDrop,
      winPercentDrop,
      centipawnLoss,
      bestMove,
    };
  }

  return {
    key: "mistake",
    label: "Mistake",
    icon: "?",
    tone: "mistake",
    expectedDrop,
    winPercentDrop,
    centipawnLoss,
    bestMove,
  };
}

function normalizeLlmSettings(
  settings?: LlmContentSettings
): Required<LlmContentSettings> {
  return {
    enabled: settings?.enabled === true,
    provider: settings?.provider || "openai",
    model: settings?.model || "gpt-5.4-mini",
    language: settings?.language || "zh-TW",
  };
}

function buildExplanationRequestKey(fen: string, analysis: AnalysisResult): string {
  const bestMove = analysis?.move || analysis?.lines?.[0]?.move || "-";
  return [
    fen || "-",
    bestMove,
    selectedLlmSettings.provider,
    selectedLlmSettings.model,
  ].join("|");
}

// Feed the LLM a readable board snapshot alongside FEN so it can reason about
// piece placement even when it does not reliably reconstruct the board from FEN alone.
function formatBoardTextForPrompt(board: BoardState | null): string {
  if (!Array.isArray(board) || board.length !== 8) {
    return "Board unavailable";
  }

  const pieceMap = {
    wp: "P",
    wn: "N",
    wb: "B",
    wr: "R",
    wq: "Q",
    wk: "K",
    bp: "p",
    bn: "n",
    bb: "b",
    br: "r",
    bq: "q",
    bk: "k",
  };

  const rows = board.map((row, index) => {
    const rank = 8 - index;
    const cells = row
      .map((cell) => {
        if (!cell) {
          return ".";
        }

        return pieceMap[cell] || ".";
      })
      .join(" ");

    return `${rank} ${cells}`;
  });

  return [...rows, "  a b c d e f g h"].join("\n");
}

function clearExplanationState() {
  latestExplanationState = null;
  activeExplanationToken += 1;
  activeExplanationRequestId = null;
}

function syncExplanationForCurrentSelection() {
  if (!latestCompletedAnalysis || !latestAnalysisFen) {
    clearExplanationState();
    return;
  }

  const explanationColor =
    latestCompletedAnalysis.activeColor || lastKnownActiveColor;

  if (!selectedLlmSettings.enabled || !shouldExplainForColor(explanationColor)) {
    clearExplanationState();
    return;
  }

  requestMoveExplanation(
    latestCompletedAnalysis,
    explanationColor,
    latestMoveReview,
    latestAnalysisFen,
    getBoardState(),
    buildExplanationRequestKey(latestAnalysisFen, latestCompletedAnalysis)
  );
}

function renderExplanationSection(activeColor: ActiveColor) {
  if (!selectedLlmSettings.enabled || !shouldExplainForColor(activeColor)) {
    return "";
  }

  const explanationState = latestExplanationState;
  const status = explanationState?.status || "idle";
  const modelLabel = explanationState?.model || selectedLlmSettings.model || "-";
  const toggleLabel = explanationCollapsed ? "Expand explanation" : "Collapse explanation";
  let bodyHtml = `<div style="color:#a8a8a8;">Enable analysis to generate a move explanation.</div>`;

  if (status === "loading") {
    bodyHtml = `<div style="color:#d7d7d7;">OpenAI is explaining this move...</div>`;
  } else if (explanationState?.status === "streaming") {
    bodyHtml = `<div style="color:#ececec; line-height:1.5; white-space:pre-wrap;">${escapeHtml(
      explanationState.text || ""
    )}</div>`;
  } else if (explanationState?.status === "ready") {
    bodyHtml = `<div style="color:#ececec; line-height:1.5; white-space:pre-wrap;">${escapeHtml(
      explanationState.text || ""
    )}</div>`;
  } else if (explanationState?.status === "error") {
    bodyHtml = `<div style="color:#ef9a9a; line-height:1.5;">${escapeHtml(
      explanationState.error || "Unable to explain this move."
    )}</div>`;
  } else if (explanationState?.status === "config") {
    bodyHtml = `<div style="color:#d7d7d7; line-height:1.5;">${escapeHtml(
      explanationState.message || "Configure the LLM settings to enable explanations."
    )}</div>`;
  }

  return `
    <div style="border-top:1px solid #404040; padding-top:10px; margin-top:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:${explanationCollapsed ? "0" : "7px"};">
        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
          <span style="color:#b8b8b8;">Why this move</span>
          <span style="color:#8fb9ff; font-size:11px;">${escapeHtml(modelLabel)}</span>
        </div>
        <button id="chess-analyzer-explanation-toggle" type="button" aria-label="${toggleLabel}" title="${toggleLabel}" style="width:24px; height:24px; padding:0; border:1px solid #555; border-radius:4px; background:#1f1d1a; color:#fff; font-size:16px; line-height:20px; font-weight:700; cursor:pointer; flex:0 0 auto;">${explanationCollapsed ? "+" : "-"}</button>
      </div>
      ${explanationCollapsed ? "" : bodyHtml}
    </div>
  `;
}

function requestMoveExplanation(
  analysis: AnalysisResult,
  activeColor: ActiveColor,
  review: MoveReview | null,
  fen: string,
  boardState: BoardState,
  explanationKey: string
): void {
  if (!selectedLlmSettings.enabled) {
    clearExplanationState();
    return;
  }

  if (!selectedLlmSettings.model) {
    latestExplanationState = {
      status: "config",
      message: "Set a model in LLM Settings before generating explanations.",
      model: selectedLlmSettings.model,
    };
    return;
  }

  const token = ++activeExplanationToken;
  const requestId = `explain-${Date.now()}-${token}`;
  activeExplanationRequestId = requestId;
  latestExplanationState = {
    status: "loading",
    model: selectedLlmSettings.model,
    requestId,
  };
  if (latestScoreboardState) {
    renderScoreboard(
      latestScoreboardState.analysis,
      latestScoreboardState.activeColor,
      latestScoreboardState.review,
      latestScoreboardState.status
    );
  }

  const lines = Array.isArray(analysis?.lines) ? analysis.lines.slice(0, 3) : [];
  const payload: ExplainMovePayload = {
    fen,
    boardText: formatBoardTextForPrompt(boardState),
    activeColor,
    bestMove: analysis?.move || lines[0]?.move || "-",
    evaluation: lines[0] ? formatScore(lines[0]) : "--",
    candidateLines: lines.map((line) => ({
      move: line?.move,
      score: formatScore(line),
      pv: Array.isArray(line?.pv) ? line.pv.slice(0, 6) : [],
    })),
    review: review
      ? {
          move: review.move,
          moverColor: review.moverColor,
          qualityLabel: review.quality?.label || null,
        }
      : null,
  };

  extensionAPI.runtime
    .sendMessage<ExplainMoveResponse>({
      action: "explainMove",
      payload,
      requestId,
    })
    .then((response) => {
      if (
        token !== activeExplanationToken ||
        latestAnalysisFen !== fen ||
        explanationKey !== buildExplanationRequestKey(fen, analysis)
      ) {
        return;
      }

      if (response?.streaming) {
        return;
      }

      if (!response?.ok) {
        latestExplanationState = {
          status: "error",
          error: response?.error || "Unable to explain this move.",
          model: selectedLlmSettings.model,
        };
      } else {
        latestExplanationState = {
          status: "ready",
          text: response.text || "",
          model: response.model || selectedLlmSettings.model,
          provider: response.provider || selectedLlmSettings.provider,
        };
      }

      if (latestScoreboardState) {
        renderScoreboard(
          latestScoreboardState.analysis,
          latestScoreboardState.activeColor,
          latestScoreboardState.review,
          latestScoreboardState.status
        );
      }
    })
    .catch((error) => {
      if (token !== activeExplanationToken) {
        return;
      }

      latestExplanationState = {
        status: "error",
        error: error?.message || "Unable to explain this move.",
        model: selectedLlmSettings.model,
      };

      if (latestScoreboardState) {
        renderScoreboard(
          latestScoreboardState.analysis,
          latestScoreboardState.activeColor,
          latestScoreboardState.review,
          latestScoreboardState.status
        );
      }
    });
}

function renderScoreboard(
  analysis,
  activeColor,
  review,
  status: ScoreboardStatus = "ready"
) {
  if (!isAutoAnalyzeEnabled) {
    scoreboardPanel.style.display = "none";
    return;
  }

  latestScoreboardState = { analysis, activeColor, review, status };

  const line = analysis?.lines?.[0] || null;
  const hasChanceData =
    Boolean(line?.wdl) ||
    (line?.score !== null && line?.score !== undefined);
  const chances = hasChanceData ? getWinningChances(line, activeColor) : null;
  const whitePct = chances ? formatChancePercent(chances.white) : "--";
  const drawPct = chances ? formatChancePercent(chances.draw) : "--";
  const blackPct = chances ? formatChancePercent(chances.black) : "--";
  const safeWhiteWidth = chances ? Math.max(2, chances.white) : 33.333;
  const safeDrawWidth = chances
    ? Math.max(chances.draw > 0 ? 2 : 0, chances.draw)
    : 33.333;
  const safeBlackWidth = chances ? Math.max(2, chances.black) : 33.333;
  const evalLabel = hasChanceData ? formatWhiteScore(line, activeColor) : "--";
  const canShowPrediction = shouldShowPredictionForColor(activeColor);
  const bestMove = canShowPrediction ? analysis?.move || line?.move || "-" : "-";
  const quality = review?.quality || null;
  const qualityColor = getQualityColor(quality?.tone);
  const explanationHtml = renderExplanationSection(activeColor);
  const moveStatsColumns = getMoveStatsColumns();
  const moveStatsGridTemplate =
    moveStatsColumns.length === 1
      ? "minmax(120px, 1fr) 84px"
      : "minmax(120px, 1fr) 74px 74px";
  const moveStatsHeader = moveStatsColumns
    .map(
      (column) => `
        <div style="text-align:right;">
          <div style="font-weight:700; color:#f1f1f1;">${renderColorBadge(
            column.color,
            column.label
          )}</div>
          ${
            column.detail
              ? `<div style="font-size:11px; color:#a8a8a8;">${column.detail}</div>`
              : ""
          }
        </div>
      `
    )
    .join("");
  const qualityRows = [
    ["brilliant", "Brilliant", "!!"],
    ["great", "Great", "!"],
    ["best", "Best", "*"],
    ["mistake", "Mistake", "?"],
    ["miss", "Miss", "X"],
    ["blunder", "Blunder", "??"],
  ]
    .map(([key, label, icon]) => {
      const color = getQualityColor(key);
      const valueCells = moveStatsColumns
        .map(
          (column) => `
            <span style="text-align:right; color:${color}; font-weight:700;">${moveQualityTotals[column.color][key]}</span>
          `
        )
        .join("");
      return `
        <div style="display:grid; grid-template-columns:${moveStatsGridTemplate}; align-items:center; gap:8px; padding:5px 0;">
          <span style="display:flex; align-items:center; gap:7px; min-width:0; font-weight:600;">
            <span style="width:24px; height:24px; border-radius:4px; background:${color}; color:#111; display:inline-flex; align-items:center; justify-content:center; font-weight:800; font-size:12px; flex:0 0 auto;">${icon}</span>
            <span>${label}</span>
          </span>
          ${valueCells}
        </div>
      `;
    })
    .join("");
  const reviewHtml =
    review && quality && shouldShowReviewForCurrentSelection(review)
      ? `
        <div style="border-top:1px solid #404040; padding-top:10px; margin-top:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <span style="color:#b8b8b8;">${renderColorBadge(
              review.moverColor,
              "Last move"
            )}</span>
            <span style="background:${qualityColor}; color:#111; border-radius:4px; padding:3px 7px; font-weight:700;">
              ${escapeHtml(quality.label)}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; gap:8px; margin-top:7px; color:#d7d7d7;">
            <span>${escapeHtml(review.move)}</span>
            <span style="color:#a8a8a8;">-${Math.round(quality.winPercentDrop || 0)}% WP</span>
          </div>
          ${
            quality.bestMove && quality.bestMove !== review.move
              ? `<div style="color:#a8a8a8; margin-top:5px;">Best was ${escapeHtml(
                  quality.bestMove
                )}</div>`
              : ""
          }
        </div>
      `
      : "";
  const accuracyRows =
    moveStatsColumns.length === 1
      ? `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid #404040; padding-top:10px; margin-top:10px;">
          <span style="color:#b8b8b8;">Accuracy</span>
          <span style="display:flex; align-items:center; gap:8px; font-weight:700;">
            ${renderColorBadge(
              moveStatsColumns[0].color,
              moveStatsColumns[0].detail || moveStatsColumns[0].label
            )}
            <span>${getAccuracy(moveStatsColumns[0].color)}</span>
          </span>
        </div>
      `
      : `
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; align-items:end; border-top:1px solid #404040; padding-top:10px; margin-top:10px;">
          <span style="color:#b8b8b8;">Accuracy</span>
          <span style="text-align:center;">
            <span style="display:block; color:#a8a8a8; font-size:11px;">${renderColorBadge(
              "w",
              "White"
            )}</span>
            <span style="display:block; font-weight:700;">${getAccuracy("w")}</span>
          </span>
          <span style="text-align:right;">
            <span style="display:block; color:#a8a8a8; font-size:11px;">${renderColorBadge(
              "b",
              "Black"
            )}</span>
            <span style="display:block; font-weight:700;">${getAccuracy("b")}</span>
          </span>
        </div>
      `;

  const headerHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border-bottom:${scoreboardCollapsed ? "0" : "1px solid #404040"};">
      <div style="font-weight:700; font-size:14px;">Live Scoreboard</div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="color:#a8a8a8; font-size:12px;">${escapeHtml(status)}</div>
        <button id="chess-analyzer-scoreboard-toggle" type="button" aria-label="${scoreboardCollapsed ? "Expand scoreboard" : "Collapse scoreboard"}" title="${scoreboardCollapsed ? "Expand" : "Collapse"}" style="width:24px; height:24px; padding:0; border:1px solid #555; border-radius:4px; background:#1f1d1a; color:#fff; font-size:16px; line-height:20px; font-weight:700; cursor:pointer;">${scoreboardCollapsed ? "+" : "-"}</button>
      </div>
    </div>
  `;

  const bodyHtml = scoreboardCollapsed
    ? ""
    : `
    <div style="padding:12px 14px 13px; overflow:auto; max-height:calc(100vh - 92px);">
      <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:8px;">
        <span style="color:#b8b8b8;">Turn</span>
        <span style="font-weight:700;">${getColorLabel(activeColor)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:10px;">
        <span style="color:#b8b8b8;">Eval</span>
        <span style="font-weight:700;">${escapeHtml(evalLabel)}</span>
      </div>
      <div style="height:12px; display:flex; overflow:hidden; border-radius:3px; background:#111; margin-bottom:8px;">
        <div style="width:${safeWhiteWidth}%; background:#f2f2f2;"></div>
        <div style="width:${safeDrawWidth}%; background:#8d8d8d;"></div>
        <div style="width:${safeBlackWidth}%; background:#111;"></div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; color:#cfcfcf; font-size:12px;">
        <span>White ${whitePct}</span>
        <span style="text-align:center;">Draw ${drawPct}</span>
        <span style="text-align:right;">Black ${blackPct}</span>
      </div>
      ${accuracyRows}
      <div style="border-top:1px solid #404040; padding-top:10px; margin-top:10px;">
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <span style="color:#b8b8b8;">${
            canShowPrediction
              ? `Best for ${getColorLabel(activeColor)}`
              : `${getColorLabel(activeColor)} prediction hidden`
          }</span>
          <span style="font-weight:700;">${escapeHtml(bestMove)}</span>
        </div>
      </div>
      ${explanationHtml}
      ${reviewHtml}
      <div style="border-top:1px solid #404040; padding-top:9px; margin-top:10px;">
        <div style="display:grid; grid-template-columns:${moveStatsGridTemplate}; gap:8px; color:#a8a8a8; font-size:12px; margin-bottom:3px; align-items:end;">
          <span>Moves</span>
          ${moveStatsHeader}
        </div>
        ${qualityRows}
      </div>
    </div>
  `;
  scoreboardPanel.innerHTML = headerHtml + bodyHtml;
  scoreboardPanel.style.display = "block";
}

function renderScoreboardCalculating(activeColor, review) {
  if (latestScoreboardState?.analysis) {
    // Keep the last finished panel visible while the next position is being analyzed
    // so the overlay does not flicker during fast move sequences.
    renderScoreboard(
      latestScoreboardState.analysis,
      latestScoreboardState.activeColor,
      latestScoreboardState.review,
      "Calculating..."
    );
    return;
  }

  renderScoreboard(null, activeColor, review, "Calculating...");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCandidateLines(lines = []) {
  if (lines.length <= 1) {
    return "";
  }

  const rows = lines
    .map((line, index) => {
      const score = formatScore(line);
      const pv = line.pv ? line.pv.slice(0, 5).join(" ") : line.move;
      const color = getCandidateColor(index);
      return `
        <div style="display:flex; justify-content:space-between; gap:8px; margin-top:6px; font-size:12px; color:#c8c8c8;">
          <span style="display:flex; align-items:center; gap:6px; min-width:0;">
            <span style="width:9px; height:9px; border-radius:2px; background:${color}; flex:0 0 auto;"></span>
            <span>${line.multipv}. ${escapeHtml(pv)}</span>
          </span>
          <span style="color:#a8a8a8;">${escapeHtml(score)}</span>
        </div>
      `;
    })
    .join("");

  return `<div style="margin-top:8px; border-top:1px solid #404040; padding-top:6px;">${rows}</div>`;
}

function showBestMove(analysis, activeColor) {
  if (!isAutoAnalyzeEnabled) return;
  const move = typeof analysis === "string" ? analysis : analysis.move;
  const resolvedActiveColor =
    typeof analysis === "string" ? activeColor : analysis.activeColor || activeColor;

  if (!shouldShowMoveHintsForColor(resolvedActiveColor)) {
    hideLoading();
    moveDisplay.style.display = "none";
    clearHighlights();
    if (typeof analysis !== "string") {
      renderScoreboard(analysis, resolvedActiveColor, latestMoveReview, "ready");
    }
    return;
  }

  const lineLimit = getSelectedLineLimit();
  const lines =
    typeof analysis === "string" ? [] : (analysis.lines || []).slice(0, lineLimit);
  const requestedLines =
    typeof analysis === "string"
      ? lineLimit
      : Math.min(analysis.multiPv || lineLimit, lineLimit);
  const engineMode =
    typeof analysis === "string"
      ? selectedEngineMode
      : analysis.engineMode || selectedEngineMode;
  const actualDepth =
    typeof analysis === "string" ? null : analysis.actualDepth || null;
  const requestedDepth =
    typeof analysis === "string"
      ? selectedAnalysisSettings.depth
      : analysis.requestedDepth || selectedAnalysisSettings.depth;
  const depthLabel = actualDepth
    ? ` - d${actualDepth}${requestedDepth ? `/${requestedDepth}` : ""}`
    : "";
  const timeLabel =
    typeof analysis === "string"
      ? ""
      : Number.isFinite(analysis.elapsedMs)
      ? ` - ${(analysis.elapsedMs / 1000).toFixed(1)}s`
      : "";
  const candidateLines = renderCandidateLines(lines);
  const lineLabel = requestedLines > 1 ? `${requestedLines} lines` : "1 line";
  const modeLabel = `${
    engineMode === "lite" ? "Lite" : "Full"
  } - ${lineLabel}${depthLabel}${timeLabel}`;

  // Check for promotion move (length of 5 where last char is the promotion piece)
  if (move.length === 5) {
    let promotionPiece = "";
    switch (move[4].toLowerCase()) {
      case "q":
        promotionPiece = "Queen";
        break;
      case "r":
        promotionPiece = "Rook";
        break;
      case "b":
        promotionPiece = "Bishop";
        break;
      case "n":
        promotionPiece = "Knight";
        break;
    }

    moveDisplay.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">Best for ${getColorLabel(
        resolvedActiveColor
      )}: ${move.substring(
        0,
        4
      )}</div>
      <div style="color: #ffd700; font-size: 12px;">Promote to ${promotionPiece}</div>
      <div style="font-size: 11px; color: #8f8f8f; margin-top: 6px;">${modeLabel}</div>
      ${candidateLines}
    `;
  } else {
    moveDisplay.innerHTML = `
      <div style="font-weight: bold;">Best for ${getColorLabel(resolvedActiveColor)}: ${move}</div>
      <div style="font-size: 11px; color: #8f8f8f; margin-top: 6px;">${modeLabel}</div>
      ${candidateLines}
    `;
  }

  moveDisplay.style.display = "block";
  hideLoading();
  highlightBestMove(move, lines);
  if (typeof analysis !== "string") {
    renderScoreboard(analysis, resolvedActiveColor, latestMoveReview, "ready");
  }
}

function hideBestMoveLegacy() {
  moveDisplay.style.display = "none";
  hideLoading();
  clearHighlights();
}

function hideAnalysisUi() {
  hideLoading();
  moveDisplay.style.display = "none";
  scoreboardPanel.style.display = "none";
  clearHighlights();
  clearExplanationState();
}

function cancelPendingAnalysis() {
  if (pendingAnalysisTimer) {
    clearTimeout(pendingAnalysisTimer);
    pendingAnalysisTimer = null;
  }
}

function cancelBoardSettleCheck() {
  if (boardSettleTimer) {
    clearTimeout(boardSettleTimer);
    boardSettleTimer = null;
  }
}

function startBoardPolling() {
  stopBoardPolling();

  boardPollTimer = setInterval(() => {
    if (!isAutoAnalyzeEnabled || boardSettleTimer) {
      return;
    }

    const currentBoard = getBoardState();
    const currentSignature = serializeBoard(currentBoard);

    if (!lastObservedBoardSignature) {
      lastObservedBoardState = currentBoard;
      lastObservedBoardSignature = currentSignature;
      return;
    }

    if (currentSignature !== lastObservedBoardSignature) {
      scheduleBoardSettleCheck();
    }
  }, 500);
}

function stopBoardPolling() {
  if (boardPollTimer) {
    clearInterval(boardPollTimer);
    boardPollTimer = null;
  }
}

function invalidateCurrentAnalysis() {
  activeAnalysisId++;
  latestAnalysisFen = null;
  resetReviewState();
  resetFenState();
  cancelPendingAnalysis();
  cancelBoardSettleCheck();
  hideAnalysisUi();
}

function scheduleAnalysis(activeColor, reviewSeed = null) {
  cancelPendingAnalysis();
  activeAnalysisId++;
  latestAnalysisFen = null;
  lastKnownActiveColor = activeColor;

  pendingAnalysisTimer = setTimeout(() => {
    pendingAnalysisTimer = null;
    if (!isAutoAnalyzeEnabled) {
      return;
    }

    analyzeBoardState(activeColor, reviewSeed);
  }, 250);
}

function serializeBoard(board) {
  return board
    .map((row) => row.map((cell) => cell || "--").join(","))
    .join("/");
}

function getChangedPieces(previousBoard, currentBoard) {
  const removed = [];
  const added = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const previousPiece = previousBoard?.[row]?.[col] || null;
      const currentPiece = currentBoard?.[row]?.[col] || null;

      if (previousPiece === currentPiece) {
        continue;
      }

      if (previousPiece) {
        removed.push({ piece: previousPiece, row, col });
      }

      if (currentPiece) {
        added.push({ piece: currentPiece, row, col });
      }
    }
  }

  return { removed, added };
}

function inferMovedColor(previousBoard, currentBoard) {
  if (!previousBoard || !currentBoard) {
    return null;
  }

  const { removed, added } = getChangedPieces(previousBoard, currentBoard);
  const movedColors = ["w", "b"].filter((color) => {
    const removedOwn = removed.some((item) => item.piece[0] === color);
    const addedOwn = added.some((item) => item.piece[0] === color);
    return removedOwn && addedOwn;
  });

  return movedColors.length === 1 ? movedColors[0] : null;
}

function isLikelyGameReset(previousBoard, currentBoard) {
  if (!previousBoard || !currentBoard) {
    return false;
  }

  const { removed, added } = getChangedPieces(previousBoard, currentBoard);
  return removed.length + added.length > 6;
}

function squareFromRowCol(row, col) {
  return `${"abcdefgh"[col]}${8 - row}`;
}

function rowColFromSquare(square) {
  if (!/^[a-h][1-8]$/.test(square || "")) {
    return null;
  }

  return {
    row: 8 - Number.parseInt(square[1], 10),
    col: "abcdefgh".indexOf(square[0]),
  };
}

function removeCastlingRight(right) {
  if (!fenCastlingRights) {
    return;
  }

  fenCastlingRights = fenCastlingRights.replace(right, "") || "-";
}

function inferCastlingRightsFromBoard(board) {
  let rights = "";

  if (board?.[7]?.[4] === "wk") {
    if (board[7][7] === "wr") rights += "K";
    if (board[7][0] === "wr") rights += "Q";
  }

  if (board?.[0]?.[4] === "bk") {
    if (board[0][7] === "br") rights += "k";
    if (board[0][0] === "br") rights += "q";
  }

  return rights || "-";
}

function initializeFenState(board, activeColor = lastKnownActiveColor) {
  fenCastlingRights = inferCastlingRightsFromBoard(board);
  fenEnPassantSquare = "-";
  fenHalfmoveClock = 0;

  const plyCount = getMoveTextPlyCount();
  if (Number.isFinite(plyCount) && plyCount > 0) {
    fenFullmoveNumber = Math.floor(plyCount / 2) + 1;
    return;
  }

  fenFullmoveNumber = 1;
}

function updateFenStateAfterMove(previousBoard, currentBoard, playedMove) {
  if (!previousBoard || !currentBoard || !playedMove?.move) {
    fenEnPassantSquare = "-";
    return;
  }

  if (!fenCastlingRights) {
    fenCastlingRights = inferCastlingRightsFromBoard(previousBoard);
  }

  const normalizedMove = normalizeUciMove(playedMove.move);
  const fromSquare = normalizedMove.slice(0, 2);
  const toSquare = normalizedMove.slice(2, 4);
  const from = rowColFromSquare(fromSquare);
  const to = rowColFromSquare(toSquare);
  const movedColor = playedMove.movedColor;
  const movedPiece = from ? previousBoard?.[from.row]?.[from.col] : null;
  const capturedPiece = to ? previousBoard?.[to.row]?.[to.col] : null;

  fenEnPassantSquare = "-";

  if (movedPiece?.[1] === "k") {
    if (movedColor === "w") {
      removeCastlingRight("K");
      removeCastlingRight("Q");
    } else {
      removeCastlingRight("k");
      removeCastlingRight("q");
    }
  }

  if (movedPiece?.[1] === "r") {
    if (fromSquare === "h1") removeCastlingRight("K");
    if (fromSquare === "a1") removeCastlingRight("Q");
    if (fromSquare === "h8") removeCastlingRight("k");
    if (fromSquare === "a8") removeCastlingRight("q");
  }

  if (capturedPiece?.[1] === "r") {
    if (toSquare === "h1") removeCastlingRight("K");
    if (toSquare === "a1") removeCastlingRight("Q");
    if (toSquare === "h8") removeCastlingRight("k");
    if (toSquare === "a8") removeCastlingRight("q");
  }

  if (movedPiece?.[1] === "p" && from && to && Math.abs(from.row - to.row) === 2) {
    fenEnPassantSquare = squareFromRowCol((from.row + to.row) / 2, from.col);
  }

  const isCapture =
    Boolean(capturedPiece) ||
    (movedPiece?.[1] === "p" && from && to && from.col !== to.col);
  fenHalfmoveClock =
    movedPiece?.[1] === "p" || isCapture ? 0 : fenHalfmoveClock + 1;

  if (movedColor === "b") {
    fenFullmoveNumber += 1;
  }
}

function inferPlayedMove(previousBoard, currentBoard) {
  const movedColor = inferMovedColor(previousBoard, currentBoard);
  if (!movedColor) {
    return null;
  }

  const { removed, added } = getChangedPieces(previousBoard, currentBoard);
  const ownRemoved = removed.filter((item) => item.piece[0] === movedColor);
  const ownAdded = added.filter((item) => item.piece[0] === movedColor);
  if (ownRemoved.length === 0 || ownAdded.length === 0) {
    return null;
  }

  const kingRemoved = ownRemoved.find((item) => item.piece[1] === "k");
  const kingAdded = ownAdded.find((item) => item.piece[1] === "k");
  if (kingRemoved && kingAdded) {
    const from = squareFromRowCol(kingRemoved.row, kingRemoved.col);
    const to = squareFromRowCol(kingAdded.row, kingAdded.col);
    return {
      movedColor,
      from,
      to,
      move: `${from}${to}`,
    };
  }

  const pawnRemoved = ownRemoved.find((item) => item.piece[1] === "p");
  const promotedPiece = ownAdded.find(
    (item) => item.piece[1] !== "p" && item.piece[1] !== "k"
  );
  if (pawnRemoved && promotedPiece && (promotedPiece.row === 0 || promotedPiece.row === 7)) {
    const from = squareFromRowCol(pawnRemoved.row, pawnRemoved.col);
    const to = squareFromRowCol(promotedPiece.row, promotedPiece.col);
    return {
      movedColor,
      from,
      to,
      move: `${from}${to}${promotedPiece.piece[1]}`,
    };
  }

  const from = ownRemoved[0];
  const to = ownAdded[0];
  const fromSquare = squareFromRowCol(from.row, from.col);
  const toSquare = squareFromRowCol(to.row, to.col);
  return {
    movedColor,
    from: fromSquare,
    to: toSquare,
    move: `${fromSquare}${toSquare}`,
  };
}

function getMoveTextPlyCount() {
  const movePattern =
    /^(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?|[a-h]x?[a-h][1-8](=[QRBN])?[+#]?|[a-h][18]=[QRBN][+#]?)$/;
  const selectorGroups = [
    "vertical-move-list [data-ply]",
    "wc-vertical-move-list [data-ply]",
    "vertical-move-list .node",
    "wc-vertical-move-list .node",
    "vertical-move-list .move",
    "wc-vertical-move-list .move",
    ".move-list [data-ply]",
    ".move-list .node",
    ".move-list .move",
    ".main-line-row .node",
  ];
  const seen = new Set();
  let count = 0;
  let maxPly = 0;

  selectorGroups.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (seen.has(node)) {
        return;
      }
      seen.add(node);

      const element = node as HTMLElement;
      const ply = Number.parseInt(
        element.dataset?.ply || element.getAttribute("data-ply") || "",
        10
      );
      if (Number.isFinite(ply)) {
        maxPly = Math.max(maxPly, ply);
      }

      const text = (element.textContent || "")
        .trim()
        .replace(/[!?]+$/g, "")
        .replace(/[+#]+$/g, "");
      if (movePattern.test(text)) {
        count++;
      }
    });
  });

  if (count || maxPly) {
    return Math.max(count, maxPly);
  }

  const moveListSelectors = [
    "vertical-move-list",
    "wc-vertical-move-list",
    ".move-list",
    ".main-line",
    ".main-line-row",
    "[class*='move-list']",
  ];

  for (const selector of moveListSelectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent || "";
    const parsedCount = countSanMovesInText(text, movePattern);

    if (parsedCount) {
      return parsedCount;
    }
  }

  return null;
}

function countSanMovesInText(text, movePattern) {
  return (text || "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
    .split(/\s+/)
    .map((token) =>
      token
        .trim()
        .replace(/^[!?]+|[!?]+$/g, "")
        .replace(/[+#]+$/g, "")
    )
    .filter((token) => movePattern.test(token)).length;
}

function inferActiveColorFromPage(fallbackColor) {
  const plyCount = getMoveTextPlyCount();
  if (Number.isFinite(plyCount)) {
    return plyCount % 2 === 0 ? "w" : "b";
  }

  return fallbackColor;
}

function scheduleBoardSettleCheck() {
  cancelBoardSettleCheck();

  boardSettleTimer = setTimeout(() => {
    boardSettleTimer = null;
    if (!isAutoAnalyzeEnabled) {
      return;
    }

    const currentBoard = getBoardState();
    const currentSignature = serializeBoard(currentBoard);
    if (currentSignature === lastObservedBoardSignature) {
      return;
    }

    if (isLikelyGameReset(lastObservedBoardState, currentBoard)) {
      resetReviewState();
      lastKnownActiveColor = inferActiveColorFromPage(lastKnownActiveColor);
      initializeFenState(currentBoard, lastKnownActiveColor);
      lastObservedBoardState = currentBoard;
      lastObservedBoardSignature = currentSignature;
      scheduleAnalysis(lastKnownActiveColor);
      return;
    }

    const playedMove = inferPlayedMove(lastObservedBoardState, currentBoard);
    const movedColor = playedMove?.movedColor || inferMovedColor(lastObservedBoardState, currentBoard);
    const activeTurn = movedColor
      ? getOpponentColor(movedColor)
      : getOpponentColor(lastKnownActiveColor);
    const reviewSeed =
      playedMove &&
      latestCompletedAnalysis &&
      latestCompletedAnalysis.activeColor === movedColor
        ? {
            move: playedMove.move,
            moverColor: movedColor,
            previousAnalysis: latestCompletedAnalysis,
          }
        : null;

    updateFenStateAfterMove(lastObservedBoardState, currentBoard, playedMove);
    lastObservedBoardState = currentBoard;
    lastObservedBoardSignature = currentSignature;

    scheduleAnalysis(activeTurn, reviewSeed);
  }, 700);
}

function analyzeBoardState(
  activeColor: ActiveColor = lastKnownActiveColor,
  reviewSeed: ReviewSeed | null = null
): void {
  if (!isAutoAnalyzeEnabled) {
    activeAnalysisId++;
    latestAnalysisFen = null;
    hideBestMove();
    return;
  }

  console.log("Auto-analyzing board state...");
  const boardState = getBoardState();
  if (!boardState) {
    activeAnalysisId++;
    latestAnalysisFen = null;
    hideAnalysisUi();
    return;
  }

  const activeTurn = activeColor === "b" ? "b" : "w";
  if (!fenCastlingRights) {
    initializeFenState(boardState, activeTurn);
  }
  const fen = boardToFen(boardState, activeTurn);

  const analysisId = ++activeAnalysisId;
  latestAnalysisFen = fen;
  lastKnownActiveColor = activeTurn;

  if (shouldShowMoveHintsForColor(activeTurn)) {
    showLoading(activeTurn);
  } else {
    hideLoading();
    moveDisplay.style.display = "none";
    clearHighlights();
  }
  renderScoreboardCalculating(activeTurn, latestMoveReview);

  extensionAPI.runtime
    .sendMessage<AnalysisResult>({
      action: "analyzeBoard",
      fen: fen,
      options: {
        engineMode: selectedEngineMode,
        ...selectedAnalysisSettings,
        multiPv: getSelectedLineLimit(),
      },
    })
    .then((analysis) => {
      if (
        !isAutoAnalyzeEnabled ||
        analysisId !== activeAnalysisId ||
        fen !== latestAnalysisFen
      ) {
        return;
      }

      if (analysis && analysis.superseded) {
        return;
      }

      if (analysis && analysis.error && SharedErrors.isBenignAnalysisError(analysis.error)) {
        return;
      }

      if (analysis && analysis.error) {
        console.error("Analysis error:", analysis.error);
        hideAnalysisUi();
        return;
      }

      if (analysis && analysis.move) {
        limitAnalysisLines(analysis);
        console.log("Received analysis:", analysis.move);
        analysis.activeColor = analysis.activeColor || activeTurn;
        latestCompletedAnalysis = analysis;
        if (reviewSeed) {
          const quality = classifyMoveQuality(
            reviewSeed.move,
            reviewSeed.moverColor,
            reviewSeed.previousAnalysis,
            analysis
          );
          latestMoveReview = quality
            ? {
                move: reviewSeed.move,
                moverColor: reviewSeed.moverColor,
                quality,
              }
            : null;
          recordMoveQuality(reviewSeed.moverColor, quality);
        }
        const explanationKey = buildExplanationRequestKey(fen, analysis);
        if (selectedLlmSettings.enabled && shouldExplainForColor(activeTurn)) {
          requestMoveExplanation(
            analysis,
            activeTurn,
            latestMoveReview,
            fen,
            boardState,
            explanationKey
          );
        } else {
          clearExplanationState();
        }
        if (shouldShowMoveHintsForColor(activeTurn)) {
          showBestMove(analysis, activeTurn);
        } else {
          hideLoading();
          moveDisplay.style.display = "none";
          clearHighlights();
          renderScoreboard(analysis, activeTurn, latestMoveReview, "tracking");
        }
      } else {
        hideAnalysisUi();
      }
    })
    .catch((error) => {
      if (analysisId !== activeAnalysisId || SharedErrors.isBenignAnalysisError(error)) {
        return;
      }
      console.error("Analysis error:", error);
      hideAnalysisUi();
    });
}

// Message listener
function setupMoveObserver(playerColor) {
  if (moveObserver) {
    moveObserver.disconnect();
  }
  stopBoardPolling();
  cancelBoardSettleCheck();

  // Find the chess board
  const board = document.querySelector("wc-chess-board");
  if (!board) return;

  lastObservedBoardState = getBoardState();
  lastObservedBoardSignature = serializeBoard(lastObservedBoardState);
  lastKnownActiveColor = inferActiveColorFromPage(
    getFallbackActiveColor(playerColor)
  );
  initializeFenState(lastObservedBoardState, lastKnownActiveColor);

  // Wait until Chess.com finishes its move animation, then compare board snapshots.
  moveObserver = new MutationObserver((mutations) => {
    if (!isAutoAnalyzeEnabled) return;

    const hasBoardChange = mutations.some((mutation) => {
      const target = mutation.target as Element;
      return (
        mutation.type === "childList" ||
        (mutation.type === "attributes" &&
          target?.classList?.contains("piece"))
      );
    });

    if (hasBoardChange) {
      scheduleBoardSettleCheck();
    }
  });

  // Start observing the board
  moveObserver.observe(board, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  startBoardPolling();
}

// Add moveObserver setup to the toggleAutoAnalyze handler
extensionAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message);

  if (message.action === "toggleAutoAnalyze") {
    isAutoAnalyzeEnabled = message.enabled;
    if (message.engineMode) {
      selectedEngineMode = message.engineMode;
    }
    if (message.analysisSettings) {
      selectedAnalysisSettings = {
        ...selectedAnalysisSettings,
        ...message.analysisSettings,
      };
    }
    if (message.llmSettings) {
      selectedLlmSettings = normalizeLlmSettings(message.llmSettings);
    }
    if (message.color) {
      selectedPredictionSide = SharedDisplay.normalizePredictionSide(message.color);
    }
    if (typeof message.showMoveHints === "boolean") {
      selectedShowMoveHints = message.showMoveHints;
      if (!selectedShowMoveHints) {
        hideLoading();
        moveDisplay.style.display = "none";
        clearHighlights();
      }
    }
    if (isAutoAnalyzeEnabled) {
      extensionAPI.storage.local
        .get<StoredDisplayPreferences>(["playerColor", "showMoveHints"])
        .then((result) => {
          console.log("Starting analysis with color:", result.playerColor);
          selectedPredictionSide = SharedDisplay.normalizePredictionSide(result.playerColor);
          selectedShowMoveHints = result.showMoveHints !== false;
          invalidateCurrentAnalysis();
          setupMoveObserver(result.playerColor || "white");
          analyzeBoardState(lastKnownActiveColor);
        });
    } else {
      invalidateCurrentAnalysis();
      if (moveObserver) {
        moveObserver.disconnect();
        moveObserver = null;
      }
      stopBoardPolling();
    }
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action === "llmSettingsChanged") {
    selectedLlmSettings = normalizeLlmSettings(message.llmSettings);
    syncExplanationForCurrentSelection();

    if (latestScoreboardState) {
      renderScoreboard(
        latestScoreboardState.analysis,
        latestScoreboardState.activeColor,
        latestScoreboardState.review,
        latestScoreboardState.status
      );
    }

    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action === "explainMoveChunk") {
    if (!message.requestId || message.requestId !== activeExplanationRequestId) {
      sendResponse({ ok: false, ignored: true });
      return undefined;
    }

    if (message.error) {
      latestExplanationState = {
        status: "error",
        error: message.error,
        model: message.model || selectedLlmSettings.model,
      };
    } else {
      const currentText =
        latestExplanationState?.status === "streaming"
          ? latestExplanationState.text
          : latestExplanationState?.status === "ready"
            ? latestExplanationState.text
            : "";
      const nextText =
        typeof message.text === "string"
          ? message.text
          : `${currentText}${message.textDelta || ""}`;
      const provider = message.provider || selectedLlmSettings.provider;
      const model = message.model || selectedLlmSettings.model;

      latestExplanationState = message.done
        ? {
            status: "ready",
            text: nextText,
            model,
            provider,
          }
        : {
            status: "streaming",
            text: nextText,
            model,
            provider,
            requestId: message.requestId,
          };
    }

    if (latestScoreboardState) {
      renderScoreboard(
        latestScoreboardState.analysis,
        latestScoreboardState.activeColor,
        latestScoreboardState.review,
        latestScoreboardState.status
      );
    }

    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action === "displaySettingsChanged") {
    if (message.color) {
      selectedPredictionSide = SharedDisplay.normalizePredictionSide(message.color);
    }
    if (typeof message.showMoveHints === "boolean") {
      selectedShowMoveHints = message.showMoveHints;
    }
    if (!selectedShowMoveHints) {
      hideLoading();
      moveDisplay.style.display = "none";
      clearHighlights();
    } else if (isAutoAnalyzeEnabled && latestCompletedAnalysis) {
      showBestMove(
        latestCompletedAnalysis,
        latestCompletedAnalysis.activeColor || lastKnownActiveColor
      );
    }
    syncExplanationForCurrentSelection();
    if (latestScoreboardState) {
      renderScoreboard(
        latestScoreboardState.analysis,
        latestScoreboardState.activeColor,
        latestScoreboardState.review,
        latestScoreboardState.status
      );
    }
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action === "colorChanged") {
    selectedPredictionSide = SharedDisplay.normalizePredictionSide(message.color);
    invalidateCurrentAnalysis();
    if (isAutoAnalyzeEnabled) {
      setupMoveObserver(message.color || "white");
      analyzeBoardState(lastKnownActiveColor);
    } else {
      syncExplanationForCurrentSelection();
    }
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action === "engineSettingsChanged") {
    if (message.engineMode) {
      selectedEngineMode = message.engineMode;
    }
    if (message.analysisSettings) {
      selectedAnalysisSettings = {
        ...selectedAnalysisSettings,
        ...message.analysisSettings,
      };
    }
    activeAnalysisId++;
    latestAnalysisFen = null;
    cancelPendingAnalysis();
    hideAnalysisUi();
    if (isAutoAnalyzeEnabled) {
      analyzeBoardState(lastKnownActiveColor);
    }
    sendResponse({
      ok: true,
      engineMode: selectedEngineMode,
      analysisSettings: selectedAnalysisSettings,
    });
    return undefined;
  }
});

// Utility functions
function getBoardState() {
  const pieces = document.querySelectorAll(".piece");
  const board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  pieces.forEach((piece) => {
    const classList = piece.className;
    const match = classList.match(/square-(\d)(\d)/);
    if (match) {
      const row = 8 - parseInt(match[2], 10);
      const col = parseInt(match[1], 10) - 1;
      const typeMatch = classList.match(/\b[bw][pnbrqk]\b/);
      if (typeMatch) {
        board[row][col] = typeMatch[0];
      }
    }
  });
  return board;
}

function boardToFen(board, activeColor = "w") {
  let fen = board
    .map((row) =>
      row
        .map((cell) => {
          if (!cell) return "1";
          const piece = cell[1].toLowerCase();
          return cell[0] === "w" ? piece.toUpperCase() : piece;
        })
        .join("")
        .replace(/1+/g, (match) => match.length)
    )
    .join("/");

  const castlingRights = fenCastlingRights || inferCastlingRightsFromBoard(board);
  const enPassant = fenEnPassantSquare || "-";
  const halfmoveClock = String(Math.max(0, fenHalfmoveClock));
  const fullmoveNumber = String(Math.max(1, fenFullmoveNumber));

  return `${fen} ${activeColor} ${castlingRights} ${enPassant} ${halfmoveClock} ${fullmoveNumber}`;
}
})();
