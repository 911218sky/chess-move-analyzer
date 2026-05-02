(function initOptionsPage() {
const DEFAULT_PROVIDER = SharedLlm.DEFAULT_LLM_PROVIDER;
const DEFAULT_MODEL = SharedLlm.DEFAULT_LLM_MODEL;
const DEFAULT_LANGUAGE = SharedLlm.DEFAULT_LLM_LANGUAGE;

async function getCurrentLlmSettings(): Promise<PageLlmSettings> {
  return SharedLlm.getPageLlmSettings((keys) =>
    extensionAPI.storage.local.get<StoredLlmSettings>(keys)
  );
}

async function notifyLlmSettingsChanged() {
  await SharedLlm.notifyLlmSettingsChanged(getCurrentLlmSettings);
}

function populateModelList(selectElement, models, currentModel) {
  const uniqueModels = Array.from(
    new Set((Array.isArray(models) ? models : []).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));

  selectElement.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent =
    uniqueModels.length > 0 ? "Choose a detected model" : "No models loaded yet";
  selectElement.appendChild(placeholderOption);

  uniqueModels.forEach((modelId) => {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    option.selected = modelId === currentModel;
    selectElement.appendChild(option);
  });

  if (!uniqueModels.includes(currentModel || "")) {
    selectElement.value = "";
  }
}

function setStatus(message, tone = "muted") {
  const status = document.getElementById("llmStatus") as HTMLElement;
  status.textContent = message;
  status.dataset.tone = tone;
}

function setButtonLoadingState(
  button: HTMLButtonElement,
  isLoading: boolean,
  idleLabel: string,
  loadingLabel: string
) {
  button.disabled = isLoading;
  button.dataset.loading = isLoading ? "true" : "false";
  button.textContent = isLoading ? loadingLabel : idleLabel;
}

document.addEventListener("DOMContentLoaded", async () => {
  const enabledInput = document.getElementById("llmExplainEnabled") as HTMLInputElement;
  const providerSelect = document.getElementById("llmProvider") as HTMLSelectElement;
  const languageSelect = document.getElementById("llmLanguage") as HTMLSelectElement;
  const baseUrlInput = document.getElementById("llmBaseUrl") as HTMLInputElement;
  const apiKeyInput = document.getElementById("llmApiKey") as HTMLInputElement;
  const modelInput = document.getElementById("llmModel") as HTMLInputElement;
  const modelListSelect = document.getElementById("llmModelList") as HTMLSelectElement;
  const promptTemplateInput = document.getElementById(
    "llmPromptTemplate"
  ) as HTMLTextAreaElement;
  const refreshModelsButton = document.getElementById(
    "refreshModels"
  ) as HTMLButtonElement;
  const resetPromptButton = document.getElementById(
    "resetPrompt"
  ) as HTMLButtonElement;

  const llmSettings = await getCurrentLlmSettings();
  enabledInput.checked = llmSettings.enabled;
  providerSelect.value = llmSettings.provider;
  languageSelect.value = llmSettings.language;
  baseUrlInput.value = llmSettings.baseUrl;
  apiKeyInput.value = llmSettings.apiKey;
  modelInput.value = llmSettings.model;
  promptTemplateInput.value = llmSettings.promptTemplate;
  populateModelList(modelListSelect, llmSettings.availableModels, llmSettings.model);
  setStatus(
    llmSettings.enabled
      ? "LLM explanations are enabled."
      : "LLM explanations are currently disabled.",
    llmSettings.enabled ? "success" : "muted"
  );

  const persist = async (
    overrides: Partial<StoredLlmSettings> = {}
  ): Promise<StoredLlmSettings> => {
    const nextSettings = {
      llmExplainEnabled: enabledInput.checked,
      llmProvider: providerSelect.value || DEFAULT_PROVIDER,
      llmBaseUrl: SharedLlm.normalizeBaseUrl(baseUrlInput.value),
      llmApiKey: apiKeyInput.value.trim(),
      llmModel: modelInput.value.trim() || DEFAULT_MODEL,
      llmLanguage: languageSelect.value || DEFAULT_LANGUAGE,
      llmPromptTemplate: SharedLlm.normalizePromptTemplate(promptTemplateInput.value),
      ...overrides,
    };

    await extensionAPI.storage.local.set(nextSettings);
    try {
      await notifyLlmSettingsChanged();
    } catch (error) {
      console.warn("Unable to notify content script about LLM settings:", error);
    }
    return nextSettings;
  };

  const refreshModels = async () => {
    if (!apiKeyInput.value.trim()) {
      setStatus("Add an API key before loading models.", "error");
      return;
    }

    setButtonLoadingState(
      refreshModelsButton,
      true,
      "Refresh Models",
      "Refreshing..."
    );
    setStatus("Loading models from the provider...", "loading");

    try {
      const models = await SharedLlm.listOpenAiModels(
        SharedLlm.normalizeBaseUrl(baseUrlInput.value),
        apiKeyInput.value.trim()
      );
      await extensionAPI.storage.local.set({ llmAvailableModels: models });
      populateModelList(modelListSelect, models, modelInput.value.trim());
      setStatus(
        models.length > 0
          ? `Loaded ${models.length} models.`
          : "The provider returned no models for this API key.",
        models.length > 0 ? "success" : "muted"
      );
    } catch (error) {
      setStatus(SharedErrors.getErrorMessage(error) || "Unable to load models.", "error");
    } finally {
      setButtonLoadingState(
        refreshModelsButton,
        false,
        "Refresh Models",
        "Refreshing..."
      );
    }
  };

  enabledInput.addEventListener("change", async () => {
    await persist();
    setStatus(
      enabledInput.checked
        ? "LLM explanations are enabled."
        : "LLM explanations are currently disabled.",
      enabledInput.checked ? "success" : "muted"
    );
  });

  providerSelect.addEventListener("change", async () => {
    await persist();
  });

  languageSelect.addEventListener("change", async () => {
    await persist();
    setStatus("Reply language updated.", "success");
  });

  baseUrlInput.addEventListener("change", async () => {
    baseUrlInput.value = SharedLlm.normalizeBaseUrl(baseUrlInput.value);
    await persist();
  });

  apiKeyInput.addEventListener("change", async () => {
    await persist();
    setStatus("API key saved locally in extension storage.", "success");
  });

  modelInput.addEventListener("change", async () => {
    modelInput.value = modelInput.value.trim() || DEFAULT_MODEL;
    await persist();
    setStatus(`Using model ${modelInput.value}.`, "success");
  });

  modelListSelect.addEventListener("change", async () => {
    if (!modelListSelect.value) {
      return;
    }

    modelInput.value = modelListSelect.value;
    await persist();
    setStatus(`Using model ${modelListSelect.value}.`, "success");
  });

  promptTemplateInput.addEventListener("change", async () => {
    promptTemplateInput.value = SharedLlm.normalizePromptTemplate(promptTemplateInput.value);
    await persist();
    setStatus("Prompt template updated.", "success");
  });

  refreshModelsButton.addEventListener("click", async () => {
    await persist();
    await refreshModels();
  });

  resetPromptButton.addEventListener("click", async () => {
    promptTemplateInput.value = SharedLlm.DEFAULT_PROMPT_TEMPLATE;
    await persist({ llmPromptTemplate: SharedLlm.DEFAULT_PROMPT_TEMPLATE });
    setStatus("Prompt template reset to default.", "success");
  });
});
})();
