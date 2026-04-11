const DEFAULT_SETTINGS = {
  enabled: true,
  autoFullscreenOnEpisodeChange: true,
  retryFullscreenWhilePlayerLoads: true,
  debugLogs: false,
};

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
    statusTextElement.textContent = "Automacoes desligadas para DisneyPlus.com.";
    return;
  }

  const activeAutomations = Object.entries(settings)
    .filter(([key, value]) => key !== "enabled" && Boolean(value))
    .length;

  if (activeAutomations === 0) {
    statusTextElement.textContent = "Extensao ativa, mas sem automacoes ligadas.";
    return;
  }

  statusTextElement.textContent =
    activeAutomations === 1
      ? "1 automacao ativa e pronta para o player."
      : `${activeAutomations} automacoes ativas e prontas para o player.`;
}
