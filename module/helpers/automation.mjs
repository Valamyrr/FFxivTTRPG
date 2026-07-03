export const AUTOMATION_LEVEL_SETTING = "automationLevel";

export const AUTOMATION_LEVELS = {
  DISABLED: "disabled",
  ABILITY: "ability",
  FULL: "full",
};

export function isAbilityAutomationEnabled() {
  return game.settings.get("ffxiv", AUTOMATION_LEVEL_SETTING) !== AUTOMATION_LEVELS.DISABLED;
}

export function isCombatAutomationEnabled() {
  return game.settings.get("ffxiv", AUTOMATION_LEVEL_SETTING) === AUTOMATION_LEVELS.FULL;
}
