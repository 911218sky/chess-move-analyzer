(function initPopup() {
const RELEASE_API_URL =
  "https://api.github.com/repos/911218sky/chess-move-analyzer/releases/latest";
const RELEASE_PAGE_URL =
  "https://github.com/911218sky/chess-move-analyzer/releases/latest";
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;
const FIREFOX_STABLE_XPI_NAME = "chess-move-analyzer.firefox.xpi";

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type ReleaseCheckResult = {
  version: string;
  url: string;
  checkedAt: number;
  chromeDownloadUrl?: string;
  firefoxDownloadUrl?: string;
};

const STRENGTH_PRESETS = {
  fast: { searchMode: "time", movetime: 500, depth: 12, hashMb: 64, threads: 2 },
  balanced: {
    searchMode: "time",
    movetime: 1500,
    depth: 18,
    hashMb: 128,
    threads: 4,
  },
  strong: {
    searchMode: "depth",
    movetime: 3000,
    depth: 20,
    hashMb: 256,
    threads: 4,
  },
  max: { searchMode: "depth", movetime: 5000, depth: 24, hashMb: 512, threads: 8 },
  ultimate: {
    searchMode: "depth",
    movetime: 8000,
    depth: 28,
    hashMb: 512,
    threads: 8,
  },
};

function buildAnalysisSettings(
  engineMode: EngineMode,
  strengthPreset: string,
  multiPv: string
): AnalysisSettings {
  return {
    ...(STRENGTH_PRESETS[strengthPreset] || STRENGTH_PRESETS.strong),
    multiPv: Number.parseInt(multiPv, 10) || 1,
    engineMode,
  };
}

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function isNewerVersion(latestVersion, currentVersion) {
  const latestParts = normalizeVersion(latestVersion);
  const currentParts = normalizeVersion(currentVersion);
  const maxLength = Math.max(latestParts.length, currentParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const latestPart = latestParts[index] || 0;
    const currentPart = currentParts[index] || 0;

    if (latestPart > currentPart) {
      return true;
    }

    if (latestPart < currentPart) {
      return false;
    }
  }

  return false;
}

function getCurrentManifestVersion() {
  return extensionAPI.raw.runtime.getManifest().version;
}

function getBrowserTarget() {
  const extensionUrl = extensionAPI.raw.runtime.getURL("");
  return extensionUrl.startsWith("moz-extension://") ? "firefox" : "chrome";
}

function pickAssetDownloadUrl(
  assets: ReleaseAsset[] | undefined,
  target: "chrome" | "firefox"
): string {
  if (!Array.isArray(assets)) {
    return "";
  }

  if (target === "chrome") {
    const chromeAsset = assets.find((asset: ReleaseAsset) =>
      asset?.name?.endsWith(".chrome.zip")
    );
    return chromeAsset?.browser_download_url || "";
  }

  const stableFirefoxAsset = assets.find(
    (asset: ReleaseAsset) => asset?.name === FIREFOX_STABLE_XPI_NAME
  );
  if (stableFirefoxAsset?.browser_download_url) {
    return stableFirefoxAsset.browser_download_url;
  }

  const versionedFirefoxAsset = assets.find((asset: ReleaseAsset) =>
    asset?.name?.endsWith(".firefox.xpi")
  );
  return versionedFirefoxAsset?.browser_download_url || "";
}

function showUpdateNotice(latestVersion, releaseUrl, directDownloadUrl) {
  const notice = document.getElementById("updateNotice") as HTMLElement;
  const title = document.getElementById("updateNoticeTitle") as HTMLElement;
  const message = document.getElementById("updateNoticeMessage") as HTMLElement;
  const actionButton = document.getElementById(
    "updateNoticeAction"
  ) as HTMLButtonElement;
  const currentVersion = getCurrentManifestVersion();
  const target = getBrowserTarget();
  const destinationUrl = directDownloadUrl || releaseUrl || RELEASE_PAGE_URL;

  title.textContent = `Update available: ${latestVersion}`;
  message.textContent = `Current ${currentVersion}. A newer ${target} build is available on GitHub.`;
  actionButton.textContent =
    target === "firefox" ? "Download Firefox" : "Download Chrome";
  actionButton.onclick = () => {
    window.open(destinationUrl, "_blank", "noopener,noreferrer");
  };
  notice.classList.remove("hidden");
}

async function fetchLatestRelease(): Promise<ReleaseCheckResult> {
  const response = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed: ${response.status}`);
  }

  const release = await response.json();
  return {
    version: release.tag_name || release.name || "",
    url: release.html_url || RELEASE_PAGE_URL,
    chromeDownloadUrl: pickAssetDownloadUrl(release.assets, "chrome"),
    firefoxDownloadUrl: pickAssetDownloadUrl(release.assets, "firefox"),
    checkedAt: Date.now(),
  };
}

async function maybeShowUpdateNotice() {
  try {
    const cache = await extensionAPI.storage.local.get<StoredReleaseUpdateCheck>(
      "releaseUpdateCheck"
    );
    const cachedResult = cache.releaseUpdateCheck;
    const now = Date.now();
    let latestRelease = cachedResult;

    if (
      !latestRelease ||
      !latestRelease.checkedAt ||
      now - latestRelease.checkedAt > UPDATE_CHECK_INTERVAL_MS
    ) {
      latestRelease = await fetchLatestRelease();
      await extensionAPI.storage.local.set({ releaseUpdateCheck: latestRelease });
    }

    if (
      latestRelease?.version &&
      isNewerVersion(latestRelease.version, getCurrentManifestVersion())
    ) {
      showUpdateNotice(
        latestRelease.version,
        latestRelease.url,
        getBrowserTarget() === "firefox"
          ? latestRelease.firefoxDownloadUrl
          : latestRelease.chromeDownloadUrl
      );
    }
  } catch (error) {
    console.warn("Unable to check for updates:", error);
  }
}

async function getCurrentEngineSettings(): Promise<{
  engineMode: EngineMode;
  strengthPreset: string;
  multiPv: string;
  analysisSettings: AnalysisSettings;
}> {
  const result = await extensionAPI.storage.local.get<StoredEnginePreferences>([
    "engineMode",
    "strengthPreset",
    "multiPv",
  ]);
  const engineMode = result.engineMode || "full";
  const strengthPreset =
    result.strengthPreset === "deep"
      ? "ultimate"
      : result.strengthPreset || "strong";
  const multiPv = result.multiPv || "1";

  return {
    engineMode,
    strengthPreset,
    multiPv,
    analysisSettings: buildAnalysisSettings(
      engineMode,
      strengthPreset,
      multiPv
    ),
  };
}

async function getCurrentLlmSettings(): Promise<PageLlmSettings> {
  return SharedLlm.getPageLlmSettings((keys) =>
    extensionAPI.storage.local.get<StoredLlmSettings>(keys)
  );
}

async function notifySettingsChanged() {
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

  const settings = await getCurrentEngineSettings();

  try {
    await SharedTab.sendMessageToTab(activeTab, {
      action: "engineSettingsChanged",
      engineMode: settings.engineMode,
      analysisSettings: settings.analysisSettings,
    });
  } catch (error) {
    if (SharedErrors.isMissingReceiverError(error)) {
      return;
    }

    throw error;
  }
}

async function notifyDisplaySettingsChanged() {
  const state = await extensionAPI.storage.local.get<StoredDisplayPreferences>([
    "autoAnalyzeEnabled",
    "playerColor",
    "showMoveHints",
  ]);
  if (!state.autoAnalyzeEnabled) {
    return;
  }

  const activeTab = await SharedTab.getActiveTab();
  if (!activeTab || !SharedTab.isChessTab(activeTab.url)) {
    return;
  }

  try {
    await SharedTab.sendMessageToTab(activeTab, {
      action: "displaySettingsChanged",
      color: SharedDisplay.normalizePredictionSide(state.playerColor),
      showMoveHints: state.showMoveHints !== false,
    });
  } catch (error) {
    if (SharedErrors.isMissingReceiverError(error)) {
      return;
    }

    throw error;
  }
}

async function notifyLlmSettingsChanged() {
  await SharedLlm.notifyLlmSettingsChanged(getCurrentLlmSettings);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await maybeShowUpdateNotice();

    const result = await extensionAPI.storage.local.get<
      StoredDisplayPreferences &
        StoredEnginePreferences & { autoAnalyzeEnabled?: boolean }
    >([
      "playerColor",
      "autoAnalyzeEnabled",
      "engineMode",
      "strengthPreset",
      "multiPv",
      "showMoveHints",
    ]);

    const settingsToggleButton = document.getElementById(
      "settingsToggle"
    ) as HTMLButtonElement;
    settingsToggleButton.addEventListener("click", () => {
      window.open(
        extensionAPI.runtime.getURL("pub/options.html"),
        "_blank",
        "noopener,noreferrer"
      );
    });

    const colorToggle = document.getElementById("colorToggle") as HTMLElement;
    const colorOptions = colorToggle.querySelectorAll(".color-option");

    const selectedColor =
      result.playerColor === "white" || result.playerColor === "black"
        ? result.playerColor
        : "both";
    colorToggle.dataset.selected = selectedColor;
    colorOptions.forEach((option) => {
      const colorOption = option as HTMLElement;
      option.classList.toggle(
        "selected",
        colorOption.dataset.color === selectedColor
      );
    });
    if (result.playerColor !== selectedColor) {
      await extensionAPI.storage.local.set({ playerColor: selectedColor });
    }

    const analyzeButton = document.getElementById("analyze") as HTMLButtonElement;
    analyzeButton.classList.toggle("active", result.autoAnalyzeEnabled || false);
    analyzeButton.textContent = result.autoAnalyzeEnabled
      ? "Auto Analyze: ON"
      : "Auto Analyze: OFF";

    const engineModeSelect = document.getElementById(
      "engineMode"
    ) as HTMLSelectElement;
    const strengthPresetSelect = document.getElementById(
      "strengthPreset"
    ) as HTMLSelectElement;
    const multiPvSelect = document.getElementById("multiPv") as HTMLSelectElement;
    const showMoveHintsInput = document.getElementById(
      "showMoveHints"
    ) as HTMLInputElement;

    engineModeSelect.value = result.engineMode || "full";
    strengthPresetSelect.value =
      result.strengthPreset === "deep"
        ? "ultimate"
        : result.strengthPreset || "strong";
    multiPvSelect.value = result.multiPv || "1";
    showMoveHintsInput.checked = result.showMoveHints !== false;

    engineModeSelect.addEventListener("change", async () => {
      await extensionAPI.storage.local.set({
        engineMode: engineModeSelect.value,
      });
      await notifySettingsChanged();
    });

    strengthPresetSelect.addEventListener("change", async () => {
      await extensionAPI.storage.local.set({
        strengthPreset: strengthPresetSelect.value,
      });
      await notifySettingsChanged();
    });

    multiPvSelect.addEventListener("change", async () => {
      await extensionAPI.storage.local.set({ multiPv: multiPvSelect.value });
      await notifySettingsChanged();
    });

    showMoveHintsInput.addEventListener("change", async () => {
      await extensionAPI.storage.local.set({
        showMoveHints: showMoveHintsInput.checked,
      });
      await notifyDisplaySettingsChanged();
    });

    colorToggle.addEventListener("click", async (event) => {
      const target = event.target as Element;
      const selectedOption = target.closest(".color-option") as HTMLElement;
      if (!selectedOption) {
        return;
      }

      const newColor = SharedDisplay.normalizePredictionSide(
        selectedOption?.dataset.color
      );
      colorToggle.dataset.selected = newColor;

      colorOptions.forEach((option) => {
        const colorOption = option as HTMLElement;
        colorOption.classList.toggle(
          "selected",
          colorOption.dataset.color === newColor
        );
      });

      await extensionAPI.storage.local.set({ playerColor: newColor });

      const state = await extensionAPI.storage.local.get<{
        autoAnalyzeEnabled?: boolean;
      }>("autoAnalyzeEnabled");
      if (state.autoAnalyzeEnabled) {
        const activeTab = await SharedTab.getActiveTab();
        if (activeTab) {
          await SharedTab.sendMessageToTab(activeTab, {
            action: "colorChanged",
            color: newColor,
          });
        }
      }
    });
  } catch (error) {
    console.error("Error loading preferences:", error);
  }
});

document.getElementById("analyze").addEventListener("click", async () => {
  try {
    const activeTab = await SharedTab.getActiveTab();
    if (!activeTab) {
      return;
    }

    const result = await extensionAPI.storage.local.get<{
      autoAnalyzeEnabled?: boolean;
    }>("autoAnalyzeEnabled");
    const newState = !result.autoAnalyzeEnabled;
    await extensionAPI.storage.local.set({ autoAnalyzeEnabled: newState });

    const button = document.getElementById("analyze") as HTMLButtonElement;
    button.classList.toggle("active", newState);
    button.textContent = newState ? "Auto Analyze: ON" : "Auto Analyze: OFF";

    const settings = await getCurrentEngineSettings();
    const displaySettings = await extensionAPI.storage.local.get<StoredDisplayPreferences>([
      "playerColor",
      "showMoveHints",
    ]);
    const llmSettings = await getCurrentLlmSettings();

    await SharedTab.sendMessageToTab(activeTab, {
      action: "toggleAutoAnalyze",
      enabled: newState,
      color: SharedDisplay.normalizePredictionSide(displaySettings.playerColor),
      showMoveHints: displaySettings.showMoveHints !== false,
      engineMode: settings.engineMode,
      analysisSettings: settings.analysisSettings,
      llmSettings: SharedLlm.buildContentLlmSettings(llmSettings),
    });
  } catch (error) {
    console.error("Error:", error);
  }
});
})();
