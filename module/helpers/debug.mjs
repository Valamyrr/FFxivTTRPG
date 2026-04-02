const DEBUG_SETTING_KEY = "debugLogging";

function canReadDebugSetting() {
  return Boolean(game?.settings?.settings?.has(`ffxiv.${DEBUG_SETTING_KEY}`));
}

export function isDebugLoggingEnabled() {
  if (!canReadDebugSetting()) return false;
  return Boolean(game.settings.get("ffxiv", DEBUG_SETTING_KEY));
}

export function debugLog(...args) {
  if (!isDebugLoggingEnabled()) return;
  console.log(...args);
}

export function debugError(...args) {
  if (!isDebugLoggingEnabled()) return;
  console.error(...args);
}
