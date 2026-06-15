const TEMPLATE = "systems/ffxiv/templates/actor/parts/actor-limitbreak-gauge.hbs";
const HUD_ID = "ffxiv-limit-break-hud";
const LIMIT_BREAK_SOUND_VOLUME = 0.4;
const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_limitBreakCharged: "systems/ffxiv/assets/sfx/ffxiv-limit-break-charged.ogg",
  soundNotificationFFXIV_limitBreakActivated: "systems/ffxiv/assets/sfx/ffxiv-limit-break-activated.ogg",
};

let resizeObserver = null;

function getLimitBreakGaugeContext() {
  const enabled = !!game.settings.get("ffxiv", "limitBreakActive");
  const max = Math.max(1, Number(game.settings.get("ffxiv", "limitBreakMax")) || 3);
  const value = Math.max(0, Math.min(max, Number(game.settings.get("ffxiv", "limitBreakValue")) || 0));
  return {
    isGM: game.user?.isGM ?? false,
    limitBreakGauge: {
      enabled,
      max,
      value,
      segments: Array.from({ length: max }, (_segment, index) => ({
        value: index + 1,
        filled: index < value,
      })),
    },
  };
}

export function isLimitBreakActive() {
  return !!game.settings.get("ffxiv", "limitBreakActive");
}

export function getLimitBreakMax() {
  return Math.max(1, Number(game.settings.get("ffxiv", "limitBreakMax")) || 3);
}

export function getLimitBreakValue() {
  const max = getLimitBreakMax();
  return Math.max(0, Math.min(max, Number(game.settings.get("ffxiv", "limitBreakValue")) || 0));
}

function playLimitBreakSound(setting, socketOptions = false) {
  const configured = game.settings.get("ffxiv", setting);
  const fallback = DEFAULT_SOUNDS[setting] || "";
  const src =
    configured && fallback.endsWith(".ogg") && configured === fallback.replace(/\.ogg$/, ".mp3")
      ? fallback
      : configured || fallback;
  if (!game.settings.get("ffxiv", "soundNotificationFFXIV") || !src) return;

  foundry.audio.AudioHelper.play({
    src,
    channel: "interface",
    volume: LIMIT_BREAK_SOUND_VOLUME,
    autoplay: true,
    loop: false,
  }, socketOptions);
}

export function playLimitBreakActivatedSound() {
  playLimitBreakSound("soundNotificationFFXIV_limitBreakActivated", true);
}

export async function activateLimitBreakGauge(max) {
  if (!game.user?.isGM) return false;

  const value = Math.max(1, Math.min(10, Number(max) || getLimitBreakMax()));
  await game.settings.set("ffxiv", "limitBreakMax", value);
  await game.settings.set("ffxiv", "limitBreakValue", value);
  await game.settings.set("ffxiv", "limitBreakActive", true);
  playLimitBreakSound("soundNotificationFFXIV_limitBreakCharged", true);
  return true;
}

export async function deactivateLimitBreakGauge() {
  if (!game.user?.isGM) return false;

  await game.settings.set("ffxiv", "limitBreakActive", false);
  await game.settings.set("ffxiv", "limitBreakValue", 0);
  return true;
}

function getHotbarElement() {
  return document.querySelector("#hotbar, .hotbar");
}

function getVisibleHotbarSlots(hotbar) {
  const slotSelectors = [
    "#macro-list .macro",
    "#macro-list li",
    ".macro-list .macro",
    ".macro-list li",
    ".hotbar-page .macro",
    ".hotbar-page .slot",
    ".macro",
    ".slot",
  ];

  for (const selector of slotSelectors) {
    const slots = Array.from(hotbar.querySelectorAll(selector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    if (slots.length >= 10) return slots;
  }

  return [];
}

function getHotbarSlot(hotbar, slot) {
  const selectors = [
    `[data-slot="${slot}"]`,
    `[data-hotbar-slot="${slot}"]`,
    `.macro[data-slot="${slot}"]`,
    `.slot[data-slot="${slot}"]`,
  ];
  const exactSlot = selectors.map((selector) => hotbar.querySelector(selector)).find(Boolean);
  if (exactSlot) return exactSlot;
  return getVisibleHotbarSlots(hotbar)[slot - 1] ?? null;
}

function getHotbarBounds() {
  const hotbar = getHotbarElement();
  if (!hotbar) return null;

  const secondSlot = getHotbarSlot(hotbar, 2);
  const ninthSlot = getHotbarSlot(hotbar, 9);
  if (secondSlot && ninthSlot) {
    const start = secondSlot.getBoundingClientRect();
    const end = ninthSlot.getBoundingClientRect();
    if (start.width && end.width) {
      return {
        left: start.left,
        top: Math.min(start.top, end.top),
        width: end.right - start.left,
      };
    }
  }

  const rect = hotbar.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  return {
    left: rect.left + rect.width * 0.1,
    top: rect.top,
    width: rect.width * 0.8,
  };
}

export function positionLimitBreakHud() {
  const hud = document.getElementById(HUD_ID);
  if (!hud) return;

  const bounds = getHotbarBounds();
  if (!bounds) {
    hud.hidden = true;
    return;
  }

  hud.hidden = false;
  const height = hud.offsetHeight || 42;
  hud.style.left = `${Math.round(bounds.left)}px`;
  hud.style.top = `${Math.max(0, Math.round(bounds.top - height - 8))}px`;
  hud.style.width = `${Math.round(bounds.width)}px`;
}

async function onLimitBreakControl(event) {
  const control = event.target.closest(".limit-break-control");
  if (!control || !game.user?.isGM) return;

  event.preventDefault();
  event.stopPropagation();

  const max = getLimitBreakMax();
  const current = getLimitBreakValue();
  const action = String(control.dataset.action ?? "");
  let value = current;

  if (action === "increase") value += 1;
  else if (action === "decrease") value -= 1;
  else if (action === "set") value = Number(control.dataset.value);

  value = Math.max(0, Math.min(max, Number.isFinite(value) ? value : current));
  if (value === current) return;
  await game.settings.set("ffxiv", "limitBreakValue", value);
}

export async function renderLimitBreakHud() {
  const context = getLimitBreakGaugeContext();
  let root = document.getElementById(HUD_ID);

  if (!context.limitBreakGauge.enabled) {
    root?.remove();
    return;
  }

  if (!root) {
    root = document.createElement("div");
    root.id = HUD_ID;
    root.className = "ffxiv";
    root.addEventListener("click", onLimitBreakControl);
    document.body.append(root);
  }

  root.innerHTML = `<div class="limit-break-hud"><div class="limit-break-hud-root">${await foundry.applications.handlebars.renderTemplate(TEMPLATE, context)}</div></div>`;
  positionLimitBreakHud();
  requestAnimationFrame(positionLimitBreakHud);
}

export function initLimitBreakHud() {
  Hooks.on("renderHotbar", () => requestAnimationFrame(positionLimitBreakHud));
  Hooks.on("canvasReady", () => renderLimitBreakHud());
  window.addEventListener("resize", positionLimitBreakHud);

  const hotbar = getHotbarElement();
  if (hotbar && typeof ResizeObserver !== "undefined") {
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(positionLimitBreakHud);
    resizeObserver.observe(hotbar);
  }

  renderLimitBreakHud();
}
