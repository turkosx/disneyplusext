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

const previousWindowStates = new Map();

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
  if (
    message?.type !== "set-window-fullscreen" &&
    message?.type !== "exit-window-fullscreen"
  ) {
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

  chrome.windows.get(windowId, {}, (currentWindow) => {
    if (chrome.runtime.lastError) {
      sendResponse({
        ok: false,
        error: chrome.runtime.lastError.message,
      });
      return;
    }

    if (message?.type === "set-window-fullscreen") {
      if (currentWindow.state !== "fullscreen") {
        previousWindowStates.set(windowId, currentWindow.state);
      }

      chrome.windows.update(windowId, { state: "fullscreen" }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        sendResponse({ ok: true, changed: currentWindow.state !== "fullscreen" });
      });

      return;
    }

    if (currentWindow.state !== "fullscreen") {
      sendResponse({ ok: true, changed: false });
      return;
    }

    const targetState = previousWindowStates.get(windowId) ?? "normal";

    chrome.windows.update(windowId, { state: targetState }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }

      previousWindowStates.delete(windowId);
      sendResponse({ ok: true, changed: true, state: targetState });
    });
  });

  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  previousWindowStates.delete(windowId);
});
