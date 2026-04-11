const DEFAULT_SETTINGS = {
  enabled: true,
  autoFullscreenOnEpisodeChange: true,
  autoSkipIntro: true,
  autoPlayNextEpisode: false,
  retryFullscreenWhilePlayerLoads: true,
  debugLogs: false,
};

const CORE_AUTOMATION_KEYS = [
  "autoFullscreenOnEpisodeChange",
  "autoSkipIntro",
  "autoPlayNextEpisode",
];

const toggleElements = [...document.querySelectorAll("[data-setting-key]")];
const statusTextElement = document.querySelector("#statusText");

void initializePopup();

async function initializePopup() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  syncToggles(settings);
  renderStatus(settings);

  toggleElements.forEach((element) => {
    element.addEventListener("change", handleToggleChange);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    const nextSettings = { ...settings };
    let hasRelevantChange = false;

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!changes[key]) {
        continue;
      }

      nextSettings[key] = changes[key].newValue;
      hasRelevantChange = true;
    }

    if (!hasRelevantChange) {
      return;
    }

    Object.assign(settings, nextSettings);
    syncToggles(settings);
    renderStatus(settings);
  });
}

async function handleToggleChange(event) {
  const element = event.currentTarget;
  const settingKey = element.dataset.settingKey;

  if (!settingKey) {
    return;
  }

  await chrome.storage.local.set({
    [settingKey]: element.checked,
  });
}

function syncToggles(settings) {
  toggleElements.forEach((element) => {
    const settingKey = element.dataset.settingKey;
    element.checked = Boolean(settings[settingKey]);
  });
}

function renderStatus(settings) {
  if (!settings.enabled) {
    statusTextElement.textContent = "Tudo desligado.";
    return;
  }

  const activeAutomations = CORE_AUTOMATION_KEYS.filter((key) => Boolean(settings[key])).length;

  if (activeAutomations === 0) {
    statusTextElement.textContent = "Sem funções ativas.";
    return;
  }

  statusTextElement.textContent =
    activeAutomations === 1
      ? "1 função ativa."
      : `${activeAutomations} funções ativas.`;
}
