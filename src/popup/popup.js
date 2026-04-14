const DEFAULT_SETTINGS = {
  enabled: true,
  autoFullscreenOnEpisodeChange: true,
  autoSkipIntro: true,
  autoPlayNextEpisode: false,
  autoPauseEvery90Minutes: false,
  autoPauseIntervalMinutes: 90,
  retryFullscreenWhilePlayerLoads: true,
  debugLogs: false,
};

const CORE_AUTOMATION_KEYS = [
  "autoFullscreenOnEpisodeChange",
  "autoSkipIntro",
  "autoPlayNextEpisode",
  "autoPauseEvery90Minutes",
];

const PAUSE_INTERVAL_MINUTES_MIN = 5;
const PAUSE_INTERVAL_MINUTES_MAX = 360;

const toggleElements = [...document.querySelectorAll("[data-setting-key]")];
const statusTextElement = document.querySelector("#statusText");
const pauseIntervalInputElement = document.querySelector("#autoPauseIntervalMinutes");

void initializePopup();

async function initializePopup() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  syncToggles(settings);
  syncPauseIntervalInput(settings);
  renderStatus(settings);

  toggleElements.forEach((element) => {
    element.addEventListener("change", handleToggleChange);
  });

  pauseIntervalInputElement?.addEventListener("change", handlePauseIntervalChange);
  pauseIntervalInputElement?.addEventListener("blur", handlePauseIntervalChange);

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

      nextSettings[key] =
        key === "autoPauseIntervalMinutes"
          ? sanitizePauseIntervalMinutes(changes[key].newValue)
          : changes[key].newValue;
      hasRelevantChange = true;
    }

    if (!hasRelevantChange) {
      return;
    }

    Object.assign(settings, nextSettings);
    syncToggles(settings);
    syncPauseIntervalInput(settings);
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

async function handlePauseIntervalChange(event) {
  const element = event.currentTarget;

  if (!(element instanceof HTMLInputElement)) {
    return;
  }

  const nextValue = sanitizePauseIntervalMinutes(element.value);
  element.value = String(nextValue);

  await chrome.storage.local.set({
    autoPauseIntervalMinutes: nextValue,
  });
}

function syncToggles(settings) {
  toggleElements.forEach((element) => {
    const settingKey = element.dataset.settingKey;
    element.checked = Boolean(settings[settingKey]);
  });
}

function syncPauseIntervalInput(settings) {
  if (!pauseIntervalInputElement) {
    return;
  }

  pauseIntervalInputElement.value = String(
    sanitizePauseIntervalMinutes(settings.autoPauseIntervalMinutes)
  );

  pauseIntervalInputElement.disabled = !settings.enabled || !settings.autoPauseEvery90Minutes;
}

function renderStatus(settings) {
  if (!settings.enabled) {
    statusTextElement.textContent = "Tudo desligado.";
    return;
  }

  const activeAutomations = CORE_AUTOMATION_KEYS.filter((key) => Boolean(settings[key])).length;

  if (activeAutomations === 0) {
    statusTextElement.textContent = "Sem funcoes ativas.";
    return;
  }

  statusTextElement.textContent =
    activeAutomations === 1
      ? "1 funcao ativa."
      : `${activeAutomations} funcoes ativas.`;
}

function sanitizePauseIntervalMinutes(value) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_SETTINGS.autoPauseIntervalMinutes;
  }

  return Math.min(
    PAUSE_INTERVAL_MINUTES_MAX,
    Math.max(PAUSE_INTERVAL_MINUTES_MIN, Math.round(parsedValue))
  );
}
