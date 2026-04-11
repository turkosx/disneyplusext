const DEFAULT_SETTINGS = {
  enabled: true,
  autoFullscreenOnEpisodeChange: true,
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
