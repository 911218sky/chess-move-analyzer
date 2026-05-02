(function initStockfishAnalyzer(global: ExtensionHostGlobal) {
  class StockfishAnalyzer {
    engineProfiles: EngineProfiles;
    workerScriptUrls: string[] = [];
    workerScriptUrl: string | null = null;
    engineMode: EngineMode | null = null;
    engineConfigKey: string | null = null;
    worker: Worker | null = null;
    readyPromise: Promise<void> | null = null;
    queue: QueuedAnalysisTask[] = [];
    currentTask: QueuedAnalysisTask | null = null;
    readyTimeoutMs = 60000;
    analysisTimeoutMs = 90000;
    searchMovetimeMs = 3000;
    searchDepth = 18;
    searchMode: SearchMode = "time";
    multiPv = 1;
    hashMb = 256;

    constructor(engineProfiles: EngineProfiles | string[]) {
      this.engineProfiles = Array.isArray(engineProfiles)
        ? { full: engineProfiles }
        : engineProfiles;
    }

    async analyzeFen(fen: string, options: AnalysisSettings = {}) {
      const settings = this.normalizeSettings(options);

      await this.ensureReady(settings);

      return new Promise<AnalysisResult>((resolve, reject) => {
        this.dropQueuedTasks();
        this.stopCurrentTask();
        this.queue.push({ fen, settings, resolve, reject });
        this.processQueue();
      });
    }

    async ensureReady(settings: NormalizedAnalysisSettings) {
      if (
        this.readyPromise &&
        this.engineMode === settings.engineMode &&
        this.engineConfigKey === settings.engineConfigKey
      ) {
        return this.readyPromise;
      }

      if (this.readyPromise || this.worker) {
        this.resetEngine(new Error("Engine mode changed."));
      }

      this.engineMode = settings.engineMode;
      this.engineConfigKey = settings.engineConfigKey;
      // Switch worker bundles only when the engine profile or hardware-relevant
      // configuration changed, so consecutive analyses can reuse the warm engine.
      this.workerScriptUrls = this.engineProfiles[this.engineMode] || this.engineProfiles.full;
      this.readyPromise = this.initializeWorker(0, settings);

      return this.readyPromise;
    }

    initializeWorker(engineIndex: number, settings: NormalizedAnalysisSettings) {
      this.workerScriptUrl = this.workerScriptUrls[engineIndex];
      this.worker = new Worker(this.workerScriptUrl);

      return new Promise<void>((resolve, reject) => {
        let initialized = false;
        let waitingForReady = false;
        const fail = (error: Error) => {
          global.clearTimeout(timeoutId);

          if (this.worker) {
            this.worker.terminate();
            this.worker = null;
          }

          const nextEngineIndex = engineIndex + 1;
          if (nextEngineIndex < this.workerScriptUrls.length) {
            this.initializeWorker(nextEngineIndex, settings)
              .then(resolve)
              .catch(reject);
            return;
          }

          this.rejectAll(error);
          reject(error);
        };

        const timeoutId = global.setTimeout(() => {
          if (initialized) {
            return;
          }

          fail(new Error("Stockfish initialization timed out."));
        }, this.readyTimeoutMs);

        this.worker.onmessage = (event) => {
          const lines = this.getWorkerMessageLines(event.data);

          for (const line of lines) {
            if (!initialized && line === "uciok") {
              waitingForReady = true;
              this.getEngineOptions(settings).forEach((option) => {
                this.worker.postMessage(option);
              });
              this.worker.postMessage("ucinewgame");
              this.worker.postMessage("isready");
              continue;
            }

            if (!initialized && waitingForReady && line === "readyok") {
              initialized = true;
              global.clearTimeout(timeoutId);
              resolve();
              continue;
            }

            this.handleWorkerMessage(line);
          }
        };

        this.worker.onerror = (event) => {
          fail(new Error(event.message || "Stockfish worker failed."));
        };

      this.worker.postMessage("uci");
      });
    }

    getWorkerMessageLines(data: unknown): string[] {
      const message = typeof data === "string" ? data : String(data);
      return message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    }

    getEngineOptions(settings: NormalizedAnalysisSettings): string[] {
      const options = [
        `setoption name Hash value ${settings.hashMb}`,
        "setoption name UCI_ShowWDL value true",
        `setoption name MultiPV value ${settings.multiPv}`,
      ];
      const isSingleThreadEngine = /single/i.test(this.workerScriptUrl || "");

      if (!isSingleThreadEngine) {
        options.push(`setoption name Threads value ${settings.threads}`);
      }

      return options;
    }

    normalizeSettings(options: AnalysisSettings): NormalizedAnalysisSettings {
      const engineMode =
        options.engineMode === "lite" && this.engineProfiles.lite
          ? "lite"
          : "full";
      const searchMode = options.searchMode === "depth" ? "depth" : "time";
      const movetime = this.clampNumber(options.movetime, 250, 10000, 3000);
      const depth = this.clampNumber(options.depth, 8, 30, 18);
      const multiPv = this.clampNumber(options.multiPv, 1, 5, 1);
      const hashMb = this.clampNumber(options.hashMb, 32, 512, 256);
      const threads = this.clampNumber(
        options.threads,
        1,
        8,
        Math.min(global.navigator?.hardwareConcurrency || 2, 4)
      );

      return {
        engineMode,
        searchMode,
        movetime,
        depth,
        multiPv,
        hashMb,
        threads,
        searchLimit: searchMode === "depth" ? depth : movetime,
        engineConfigKey: `${engineMode}:${hashMb}:${multiPv}:${threads}`,
      };
    }

    clampNumber(value: unknown, min: number, max: number, fallback: number): number {
      const number = Number.parseInt(String(value), 10);
      if (!Number.isFinite(number)) {
        return fallback;
      }

      return Math.max(min, Math.min(max, number));
    }

    handleWorkerMessage(line: string): void {
      if (line.startsWith("info ") && this.currentTask) {
        this.capturePvLine(line, this.currentTask);
        return;
      }

      if (!line.startsWith("bestmove") || !this.currentTask) {
        return;
      }

      const bestMove = line.split(" ")[1];
      if (!bestMove) {
        return;
      }

      const task = this.currentTask;
      const analysis: AnalysisResult = {
        move: bestMove,
        activeColor: this.getFenActiveColor(task.fen),
        engineMode: task.settings.engineMode,
        searchMode: task.settings.searchMode,
        searchLimit: task.settings.searchLimit,
        requestedDepth: task.settings.depth,
        actualDepth: this.getActualDepth(task),
        elapsedMs: Date.now() - (task.startedAt || Date.now()),
        multiPv: task.settings.multiPv,
        lines: this.getSortedLines(task),
      };

      global.clearTimeout(this.currentTask.timeoutId);
      this.currentTask = null;

      if (!task.superseded) {
        task.resolve(analysis);
      }

      this.processQueue();
    }

    capturePvLine(line: string, task: QueuedAnalysisTask): void {
      if (!task.lines) {
        task.lines = new Map();
      }

      const pvMatch = line.match(/\bpv\s+(.+)$/);
      if (!pvMatch) {
        return;
      }

      const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
      const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
      const depthMatch = line.match(/\bdepth\s+(\d+)/);
      const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);
      const multipv = multipvMatch ? Number.parseInt(multipvMatch[1], 10) : 1;
      const pv = pvMatch[1].trim().split(/\s+/);

      task.lines.set(multipv, {
        multipv,
        move: pv[0],
        pv,
        depth: depthMatch ? Number.parseInt(depthMatch[1], 10) : null,
        scoreType: scoreMatch ? (scoreMatch[1] as "cp" | "mate") : null,
        score: scoreMatch ? Number.parseInt(scoreMatch[2], 10) : null,
        wdl: wdlMatch
          ? {
              win: Number.parseInt(wdlMatch[1], 10),
              draw: Number.parseInt(wdlMatch[2], 10),
              loss: Number.parseInt(wdlMatch[3], 10),
            }
          : null,
      });
    }

    getFenActiveColor(fen: string): "w" | "b" {
      return fen.split(/\s+/)[1] === "b" ? "b" : "w";
    }

    getSortedLines(task: QueuedAnalysisTask): CandidateLine[] {
      if (!task.lines) {
        return [];
      }

      return Array.from(task.lines.values())
        .sort((a, b) => a.multipv - b.multipv)
        .slice(0, task.settings.multiPv);
    }

    getActualDepth(task: QueuedAnalysisTask): number | null {
      const lines = this.getSortedLines(task);
      const depths = lines
        .map((line) => line.depth)
        .filter((depth): depth is number => Number.isFinite(depth));

      return depths.length > 0 ? Math.max(...depths) : null;
    }

    dropQueuedTasks() {
      while (this.queue.length > 0) {
        const queuedTask = this.queue.shift();
        queuedTask?.reject(new Error("Analysis superseded."));
      }
    }

    stopCurrentTask() {
      if (!this.currentTask || this.currentTask.superseded || !this.worker) {
        return;
      }

      this.currentTask.superseded = true;
      this.currentTask.reject(new Error("Analysis superseded."));
      this.worker.postMessage("stop");
    }

    processQueue(): void {
      if (!this.worker || this.currentTask || this.queue.length === 0) {
        return;
      }

      const nextTask = this.queue.shift();
      if (!nextTask) {
        return;
      }
      this.currentTask = nextTask;
      this.currentTask.startedAt = Date.now();
      this.currentTask.lines = new Map();
      this.currentTask.timeoutId = global.setTimeout(() => {
        const error = new Error("Stockfish analysis timed out.");
        this.rejectAll(error);
      }, this.analysisTimeoutMs);

      this.worker.postMessage(`position fen ${nextTask.fen}`);
      if (nextTask.settings.searchMode === "depth") {
        this.worker.postMessage(`go depth ${nextTask.settings.depth}`);
      } else {
        this.worker.postMessage(`go movetime ${nextTask.settings.movetime}`);
      }
    }

    resetEngine(error: Error): void {
      if (this.currentTask) {
        global.clearTimeout(this.currentTask.timeoutId);
        this.currentTask.reject(error);
        this.currentTask = null;
      }

      this.dropQueuedTasks();

      if (this.worker) {
        this.worker.postMessage("quit");
        this.worker.terminate();
        this.worker = null;
      }

      this.readyPromise = null;
      this.workerScriptUrl = null;
      this.workerScriptUrls = [];
      this.engineMode = null;
      this.engineConfigKey = null;
    }

    rejectAll(error: Error): void {
      if (this.currentTask) {
        global.clearTimeout(this.currentTask.timeoutId);
        this.currentTask.reject(error);
        this.currentTask = null;
      }

      while (this.queue.length > 0) {
        const queuedTask = this.queue.shift();
        queuedTask?.reject(error);
      }

      if (this.worker) {
        this.worker.postMessage("quit");
        this.worker.terminate();
        this.worker = null;
      }

      this.readyPromise = null;
      this.workerScriptUrl = null;
      this.workerScriptUrls = [];
      this.engineMode = null;
      this.engineConfigKey = null;
    }
  }

  global.StockfishAnalyzer = StockfishAnalyzer;
})(globalThis as ExtensionHostGlobal);
