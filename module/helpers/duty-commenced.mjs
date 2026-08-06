const DUTY_COMMENCED_ID = "ffxiv-duty-commenced";
const DUTY_COMMENCED_SOCKET_TYPE = "ffxivDutyCommenced";
const DUTY_COMMENCED_DURATION = 4600;

let removalTimer = null;

export function showDutyCommenced() {
  document.getElementById(DUTY_COMMENCED_ID)?.remove();
  if (removalTimer) clearTimeout(removalTimer);

  const overlay = document.createElement("div");
  overlay.id = DUTY_COMMENCED_ID;
  overlay.className = "ffxiv-duty-commenced";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");

  const banner = document.createElement("div");
  banner.className = "ffxiv-duty-commenced-banner";

  const text = document.createElement("div");
  text.className = "ffxiv-duty-commenced-text";
  text.textContent = game.i18n.localize("FFXIV.Combat.DutyCommenced");
  text.dataset.text = text.textContent;

  const flare = document.createElement("div");
  flare.className = "ffxiv-duty-commenced-flare";
  flare.setAttribute("aria-hidden", "true");

  const leftRule = document.createElement("div");
  leftRule.className = "ffxiv-duty-commenced-rule left";
  leftRule.setAttribute("aria-hidden", "true");

  const rightRule = document.createElement("div");
  rightRule.className = "ffxiv-duty-commenced-rule right";
  rightRule.setAttribute("aria-hidden", "true");

  const sparks = document.createElement("div");
  sparks.className = "ffxiv-duty-commenced-sparks";
  sparks.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 8; index += 1) {
    sparks.append(document.createElement("i"));
  }

  banner.append(leftRule, rightRule, text, flare, sparks);
  overlay.append(banner);
  document.body.append(overlay);

  const remove = () => {
    if (overlay.isConnected) overlay.remove();
    if (removalTimer) clearTimeout(removalTimer);
    removalTimer = null;
  };
  overlay.addEventListener("animationend", (event) => {
    if (event.target === overlay) remove();
  });
  removalTimer = setTimeout(remove, DUTY_COMMENCED_DURATION);
}

export function broadcastDutyCommenced() {
  if (!game.user?.isGM) return;
  showDutyCommenced();
  game.socket.emit("system.ffxiv", {
    type: DUTY_COMMENCED_SOCKET_TYPE,
    sourceUserId: game.user.id,
  });
}

export function initDutyCommenced() {
  game.socket.on("system.ffxiv", (payload) => {
    if (payload?.type !== DUTY_COMMENCED_SOCKET_TYPE) return;
    if (payload.sourceUserId === game.user.id) return;
    if (!game.users.get(payload.sourceUserId)?.isGM) return;
    showDutyCommenced();
  });
}
