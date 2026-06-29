export const TARGET_CLEAR_SETTING = "targetClearTiming";

export const TARGET_CLEAR_TIMINGS = {
  ABILITY: "ability",
  TURN_END: "turnEnd",
  NEVER: "never",
};

export function clearUserTargets() {
  if (!game.user?.targets?.size) return;
  if (canvas?.tokens?.setTargets) {
    canvas.tokens.setTargets([], { mode: "replace" });
  } else {
    game.user.targets.clear();
  }
}

export function clearUserTargetsForTiming(timing) {
  if (game.settings.get("ffxiv", TARGET_CLEAR_SETTING) !== timing) return;
  clearUserTargets();
}
