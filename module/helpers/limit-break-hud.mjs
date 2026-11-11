import {
  playInterfaceSound,
  settingOrDefault,
  createHotbarObserver,
  getHookHTMLElement,
} from "./ui.mjs";

const TEMPLATE = "systems/ffxiv/templates/actor/parts/actor-limitbreak-gauge.hbs";
const HUD_ID = "ffxiv-limit-break-hud";
const LIMIT_BREAK_SOUND_VOLUME = 0.4;
const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_limitBreakUnlocked: "systems/ffxiv/assets/sfx/ffxiv-limit-break-unlocked.ogg",
  soundNotificationFFXIV_limitBreakCharged: "systems/ffxiv/assets/sfx/ffxiv-limit-break-charged.ogg",
  soundNotificationFFXIV_limitBreakActivated: "systems/ffxiv/assets/sfx/ffxiv-limit-break-activated.ogg",
};

const observeHotbar = createHotbarObserver(queuePositionLimitBreakHud);

let positionFrame = null;

function queuePositionLimitBreakHud() {
  if (positionFrame) return;
  positionFrame = requestAnimationFrame(() => {
    positionFrame = null;
    positionLimitBreakHud();
  });
}

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
  const src = settingOrDefault(setting, DEFAULT_SOUNDS);
  playInterfaceSound(src, { volume: LIMIT_BREAK_SOUND_VOLUME, socketOptions });
}

export function playLimitBreakActivatedSound() {
  playLimitBreakSound("soundNotificationFFXIV_limitBreakActivated", true);
}

export async function activateLimitBreakGauge(max, startEmpty = false) {
  if (!game.user?.isGM) return false;

  const maximum = Math.max(1, Math.min(10, Number(max) || getLimitBreakMax()));
  await game.settings.set("ffxiv", "limitBreakMax", maximum);
  await game.settings.set("ffxiv", "limitBreakValue", startEmpty ? 0 : maximum);
  await game.settings.set("ffxiv", "limitBreakActive", true);
  if (!startEmpty) {
    playLimitBreakSound("soundNotificationFFXIV_limitBreakCharged", true);
  }
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
    if (slots.length > 0) return slots;
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

  const slots = getVisibleHotbarSlots(hotbar);
  if (slots && slots.length > 0) {
    const rects = slots
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r && (r.width > 0 || r.height > 0));
    if (rects.length > 0) {
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const width = right - left;
      if (width > 0) return { left, top, bottom, width };
    }
  }

  const rect = hotbar.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  return {
    left: rect.left + rect.width * 0.1,
    top: rect.top,
    bottom: rect.bottom,
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
  const height = hud.offsetHeight || 32;

  // Position bars to align with hotbar slots
  hud.style.left = `${Math.round(bounds.left)}px`;
  hud.style.top = `${Math.round(bounds.bottom + 8)}px`;
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
  playLimitBreakSound(
    value === max
      ? "soundNotificationFFXIV_limitBreakCharged"
      : "soundNotificationFFXIV_limitBreakUnlocked",
    true,
  );
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
  queuePositionLimitBreakHud();
}

export function initLimitBreakHud() {
  Hooks.on("renderHotbar", () => {
    queuePositionLimitBreakHud();
    const hotbar = getHotbarElement();
    observeHotbar(hotbar);
  });
  Hooks.on("canvasReady", () => renderLimitBreakHud());
  window.addEventListener("resize", () => queuePositionLimitBreakHud());

  const hotbar = getHotbarElement();
  observeHotbar(hotbar);

  renderLimitBreakHud();
}

export async function toggleLimitBreakGauge() {
  if (!game.user?.isGM) return;

  if (isLimitBreakActive()) {
    await deactivateLimitBreakGauge();
    refreshSceneControls();
    return;
  }

  const options = await promptLimitBreakOptions();
  if (!options) {
    refreshSceneControls();
    return;
  }

  await activateLimitBreakGauge(options.max, options.startEmpty);
  refreshSceneControls();
}

async function promptLimitBreakOptions() {
  let max = getLimitBreakMax();
  let startEmpty = false;
  const content = `
    <form class="ffxiv-limit-break-dialog">
      <div class="form-group">
        <label for="ffxiv-limit-break-max">${game.i18n.localize("FFXIV.LimitBreak.Segments")}</label>
        <input id="ffxiv-limit-break-max" type="number" name="max" min="1" max="10" step="1" value="${max}">
      </div>
      <div class="form-group">
        <label for="ffxiv-limit-break-empty">${game.i18n.localize("FFXIV.LimitBreak.StartEmpty")}</label>
        <input id="ffxiv-limit-break-empty" type="checkbox" name="startEmpty">
        <p class="hint">${game.i18n.localize("FFXIV.LimitBreak.StartEmptyHint")}</p>
      </div>
    </form>`;

  const confirmed = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("FFXIV.LimitBreak.Activate") },
    content,
    buttons: [
      {
        action: "activate",
        label: game.i18n.localize("FFXIV.LimitBreak.Activate"),
        icon: "fas fa-check",
        default: true,
        callback: () => true,
      },
      {
        action: "cancel",
        label: game.i18n.localize("FFXIV.Dialogs.Cancel"),
        icon: "fas fa-times",
        callback: () => false,
      },
    ],
    render: (_app, html) => {
      const root = getHookHTMLElement(html);
      const input = root?.querySelector?.("input[name='max']");
      input?.addEventListener("change", () => {
        max = Number(input.value) || max;
      });
      input?.addEventListener("input", () => {
        max = Number(input.value) || max;
      });
      const emptyInput = root?.querySelector?.("input[name='startEmpty']");
      emptyInput?.addEventListener("change", () => {
        startEmpty = emptyInput.checked;
      });
    },
  });

  if (!confirmed) return null;
  return {
    max: Math.max(1, Math.min(10, Number(max) || 3)),
    startEmpty,
  };
}

function refreshSceneControls() {
  globalThis.ui?.controls?.render?.({ force: true });
}

export async function consumeLimitBreakSegment() {
  if (!game.user?.isGM) return false;
  if (!isLimitBreakActive()) return false;
  const value = getLimitBreakValue();
  if (value <= 0) return false;
  await game.settings.set("ffxiv", "limitBreakValue", value - 1);
  return true;
}
