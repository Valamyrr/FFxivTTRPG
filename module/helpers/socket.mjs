let activeGMId = null;

export function getActiveGM() {
  const current = game.users?.get(activeGMId);
  if (current?.active && current.isGM) return current;

  const activeGMs = Array.from(game.users ?? [])
    .filter((user) => user.active && user.isGM)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const next = activeGMs[0] ?? null;
  activeGMId = next?.id ?? null;
  return next;
}

export function emitToActiveGM(payload) {
  const gm = getActiveGM();
  if (!gm) {
    ui.notifications.warn(
      game.i18n.localize("FFXIV.Notifications.NoActiveGM"),
    );
    return false;
  }

  game.socket.emit("system.ffxiv", {
    ...payload,
    gmUserId: gm.id,
  });
  return true;
}
