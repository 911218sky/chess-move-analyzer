type EngineMode = "full" | "lite";
type SearchMode = "time" | "depth";
type ActiveColor = "w" | "b";
type PredictionSide = "white" | "black" | "both";
type LlmProvider = "openai";
type LlmLanguage = "zh-TW" | "en";
type StorageKeySpec = string | string[] | Record<string, unknown>;

// Background responses used by popup/options/content message calls.
interface ListModelsResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

interface ExplainMoveResponse {
  ok: boolean;
  text?: string;
  model?: string;
  provider?: string;
  error?: string;
  streaming?: boolean;
  requestId?: string;
}

interface ExplainMoveResult {
  text: string;
  model: string;
  provider: string;
}

interface ExtensionRuntimeMessage {
  action?: string;
  target?: string;
  enabled?: boolean;
  color?: PredictionSide;
  showMoveHints?: boolean;
  engineMode?: EngineMode;
  analysisSettings?: AnalysisSettings;
  llmSettings?: LlmContentSettings;
  fen?: string;
  options?: AnalysisSettings;
  baseUrl?: string;
  apiKey?: string;
  payload?: ExplainMovePayload;
  requestId?: string;
  textDelta?: string;
  text?: string;
  done?: boolean;
  error?: string;
  model?: string;
  provider?: string;
}

interface RuntimeMessageEvent {
  addListener(
    listener: (
      message: ExtensionRuntimeMessage,
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => unknown
  ): void;
  removeListener?(
    listener: (
      message: ExtensionRuntimeMessage,
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => unknown
  ): void;
}

interface BrowserTab {
  id?: number;
  url?: string;
  [key: string]: unknown;
}

interface BrowserRuntimeApi {
  getURL(path: string): string;
  getManifest(): { version: string };
  onMessage: RuntimeMessageEvent;
  sendMessage<T = unknown>(message: ExtensionRuntimeMessage): Promise<T>;
  sendMessage<T = unknown>(
    message: ExtensionRuntimeMessage,
    callback: (result: T) => void
  ): void;
  lastError?: { message?: string };
  getContexts?(query: {
    contextTypes?: string[];
    documentUrls?: string[];
  }): Promise<Array<Record<string, unknown>>>;
}

interface BrowserStorageAreaApi {
  get<T = Record<string, unknown>>(keys?: StorageKeySpec): Promise<T>;
  get<T = Record<string, unknown>>(
    keys: StorageKeySpec | undefined,
    callback: (items: T) => void
  ): void;
  set(items: Record<string, unknown>): Promise<void>;
  set(items: Record<string, unknown>, callback: () => void): void;
}

interface BrowserTabsApi {
  query(queryInfo: Record<string, unknown>): Promise<BrowserTab[]>;
  query(queryInfo: Record<string, unknown>, callback: (tabs: BrowserTab[]) => void): void;
  sendMessage<T = unknown>(tabId: number, message: ExtensionRuntimeMessage): Promise<T>;
  sendMessage<T = unknown>(
    tabId: number,
    message: ExtensionRuntimeMessage,
    callback: (result: T) => void
  ): void;
}

interface BrowserScriptingApi {
  executeScript(details: {
    target: { tabId: number };
    files: string[];
  }): Promise<unknown>;
}

interface BrowserOffscreenApi {
  createDocument(details: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
}

interface BrowserExtensionApiShape {
  runtime: BrowserRuntimeApi;
  storage: {
    local: BrowserStorageAreaApi;
  };
  tabs: BrowserTabsApi;
  scripting?: BrowserScriptingApi;
  offscreen?: BrowserOffscreenApi;
}

interface AnalysisSettings {
  engineMode?: EngineMode;
  searchMode?: SearchMode;
  movetime?: number;
  depth?: number;
  multiPv?: number;
  hashMb?: number;
  threads?: number;
}

interface NormalizedAnalysisSettings extends Required<AnalysisSettings> {
  searchLimit: number;
  engineConfigKey: string;
}

interface CandidateLine {
  multipv: number;
  move: string;
  pv: string[];
  depth: number | null;
  scoreType: "cp" | "mate" | null;
  score: number | null;
  wdl?: {
    win: number;
    draw: number;
    loss: number;
  } | null;
}

interface AnalysisResult {
  move?: string;
  activeColor?: ActiveColor;
  engineMode?: EngineMode;
  searchMode?: SearchMode;
  searchLimit?: number;
  requestedDepth?: number;
  actualDepth?: number | null;
  elapsedMs?: number;
  multiPv?: number;
  lines?: CandidateLine[];
  error?: string;
  superseded?: boolean;
}

interface LlmContentSettings {
  enabled?: boolean;
  provider?: string;
  model?: string;
  language?: string;
}

interface StoredReleaseUpdateCheck {
  releaseUpdateCheck?: {
    version?: string;
    url?: string;
    checkedAt?: number;
    chromeDownloadUrl?: string;
    firefoxDownloadUrl?: string;
  };
}

interface StoredEnginePreferences {
  engineMode?: EngineMode;
  strengthPreset?: string;
  multiPv?: string;
}

interface StoredDisplayPreferences {
  playerColor?: string;
  autoAnalyzeEnabled?: boolean;
  showMoveHints?: boolean;
}

interface StoredLlmSettings {
  llmExplainEnabled?: boolean;
  llmProvider?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  llmLanguage?: string;
  llmPromptTemplate?: string;
  llmAvailableModels?: string[];
}

interface LlmConfig {
  enabled: boolean;
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: LlmLanguage;
  promptTemplate: string;
}

interface PageLlmSettings extends LlmConfig {
  availableModels: string[];
}

interface ExplainMoveCandidateLine {
  move?: string;
  score?: string;
  pv?: string[];
}

interface ExplainMoveReview {
  move?: string;
  moverColor?: ActiveColor;
  qualityLabel?: string | null;
}

interface ExplainMovePayload {
  fen?: string | null;
  boardText?: string;
  activeColor?: ActiveColor;
  bestMove?: string;
  evaluation?: string;
  language?: string;
  candidateLines?: ExplainMoveCandidateLine[];
  review?: ExplainMoveReview | null;
}

interface OpenAiTextContentPart {
  type: "text";
  text: string;
}

type OpenAiMessageContent = string | OpenAiTextContentPart[];

interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: OpenAiMessageContent;
}

interface OpenAiModelRecord {
  id?: string;
}

interface OpenAiModelListResponse {
  data?: OpenAiModelRecord[];
  error?: {
    message?: string;
  };
  message?: string;
}

interface OpenAiChatCompletionChoice {
  message?: {
    content?: OpenAiMessageContent;
  };
}

interface OpenAiChatCompletionResponse {
  choices?: OpenAiChatCompletionChoice[];
  error?: {
    message?: string;
  };
  message?: string;
}

interface OpenAiChatCompletionRequest {
  model: string;
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  messages: OpenAiChatMessage[];
}

interface AnalyzeBoardMessage {
  action: "analyzeBoard";
  fen: string;
  options?: AnalysisSettings;
  target?: string;
}

interface OffscreenPingMessage {
  action: "ping";
  target: "offscreen";
}

interface ListOpenAiModelsMessage {
  action: "listOpenAiModels";
  baseUrl: string;
  apiKey: string;
  target?: string;
}

interface ExplainMoveMessage {
  action: "explainMove";
  payload: ExplainMovePayload;
  requestId?: string;
  target?: string;
}

interface ExplainMoveChunkMessage {
  action: "explainMoveChunk";
  requestId: string;
  textDelta?: string;
  text?: string;
  done?: boolean;
  error?: string;
  model?: string;
  provider?: string;
  target?: string;
}

type BackgroundRuntimeMessage =
  | AnalyzeBoardMessage
  | OffscreenPingMessage
  | ListOpenAiModelsMessage
  | ExplainMoveMessage
  | ExplainMoveChunkMessage;

interface OffscreenAnalysisResponse {
  error?: string;
  superseded?: boolean;
}

interface EngineProfiles {
  full: string[];
  lite?: string[];
}

interface QueuedAnalysisTask {
  fen: string;
  settings: NormalizedAnalysisSettings;
  resolve: (analysis: AnalysisResult) => void;
  reject: (error: Error) => void;
  lines?: Map<number, CandidateLine>;
  timeoutId?: number;
  startedAt?: number;
  superseded?: boolean;
}

interface ExtensionApi {
  raw: BrowserExtensionApiShape;
  runtime: {
    getURL(path: string): string;
    onMessage: RuntimeMessageEvent;
    sendMessage<T = unknown>(message: ExtensionRuntimeMessage): Promise<T>;
  };
  storage: {
    local: {
      get<T = Record<string, unknown>>(keys?: StorageKeySpec): Promise<T>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: Record<string, unknown>): Promise<BrowserTab[]>;
    sendMessage<T = unknown>(tabId: number, message: ExtensionRuntimeMessage): Promise<T>;
  };
}

interface StockfishAnalyzerInstance {
  analyzeFen(fen: string, options?: AnalysisSettings): Promise<AnalysisResult>;
}

interface StockfishAnalyzerConstructor {
  new (engineProfiles: EngineProfiles | string[]): StockfishAnalyzerInstance;
}

declare const extensionAPI: ExtensionApi;
declare const StockfishAnalyzer: StockfishAnalyzerConstructor;
declare const chrome: BrowserExtensionApiShape;
declare const browser: BrowserExtensionApiShape;
type ExtensionHostGlobal = typeof globalThis & {
  chrome?: BrowserExtensionApiShape;
  browser?: BrowserExtensionApiShape;
  extensionAPI?: ExtensionApi;
  StockfishAnalyzer?: StockfishAnalyzerConstructor;
};
