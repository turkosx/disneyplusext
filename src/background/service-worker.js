const DEFAULT_SETTINGS = {
  enabled: true,
  autoFullscreenOnEpisodeChange: true,
  autoSkipIntro: true,
  autoPlayNextEpisode: false,
  retryFullscreenWhilePlayerLoads: true,
  debugLogs: false,
};

chrome.runtime.onInstalled.addListener(async () => {
  const currentSettings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const missingSettings = {};

  for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
    if (currentSettings[key] === undefined) {
      missingSettings[key] = defaultValue;
    }
  }

  if (Object.keys(missingSettings).length > 0) {
    await chrome.storage.local.set(missingSettings);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "set-window-fullscreen") {
    return;
  }

  const windowId = sender.tab?.windowId;

  if (typeof windowId !== "number" || windowId < 0) {
    sendResponse({
      ok: false,
      error: "Janela do navegador nao encontrada.",
    });
    return;
  }

  chrome.windows.update(windowId, { state: "fullscreen" }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({
        ok: false,
        error: chrome.runtime.lastError.message,
      });
      return;
    }

    sendResponse({ ok: true });
  });

  return true;
});
