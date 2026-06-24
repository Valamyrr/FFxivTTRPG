import {
  getStatusStackCount,
  isBeneficialStatusEffect,
  isNegativeStatusEffect,
} from "./status-effects.mjs";

const TEMPLATE = "systems/ffxiv/templates/actor/parts/actor-hud-resources.hbs";
const HUD_HEALTH_ID = "ffxiv-hud-health";
const HUD_MANA_ID = "ffxiv-hud-mana";
const HUD_STATUS_EFFECTS_ID = "ffxiv-hud-status-effects";

let resizeObserver = null;
let mutationObserver = null;
let currentObservedHotbar = null;
let hotbarTransitionListener = null;

function observeHotbar(hotbar) {
  if (!hotbar || typeof ResizeObserver === "undefined") return;
  if (currentObservedHotbar && currentObservedHotbar !== hotbar) {
    if (hotbarTransitionListener) {
      currentObservedHotbar.removeEventListener("transitionend", hotbarTransitionListener, true);
      hotbarTransitionListener = null;
    }
  }
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => requestAnimationFrame(positionHudResources));
  resizeObserver.observe(hotbar);
  mutationObserver = new MutationObserver(() => requestAnimationFrame(positionHudResources));
  mutationObserver.observe(hotbar, { attributes: true, childList: true, subtree: true });
  hotbarTransitionListener = () => requestAnimationFrame(positionHudResources);
  hotbar.addEventListener("transitionend", hotbarTransitionListener, true);
  currentObservedHotbar = hotbar;
}

function getSelectedActor() {
  const token = canvas?.tokens?.controlled?.[0];
  return token?.actor ?? null;
}

function isSelectedActor(actor) {
  const selectedActor = getSelectedActor();
  return Boolean(
    actor &&
    selectedActor &&
    (
      actor === selectedActor ||
      actor.uuid === selectedActor.uuid ||
      actor.id === selectedActor.id
    ),
  );
}

function getStatusName(status, statusId) {
  const label = status?.label ? game.i18n.localize(status.label) : "";
  if (label && label !== status.label) return label;
  return status?.name || statusId;
}

function getActiveStatusEffects(actor) {
  const statusConfigs = new Map(
    (CONFIG.statusEffects ?? []).map((status) => [status.id, status]),
  );
  const statusIds = new Set();

  for (const effect of actor.effects ?? []) {
    if (!effect || effect.disabled) continue;
    for (const statusId of effect.statuses ?? []) {
      if (statusId) statusIds.add(statusId);
    }
  }

  return Array.from(statusIds).map((statusId) => {
    const status = statusConfigs.get(statusId);
    const name = getStatusName(status, statusId);
    const stackCount = getStatusStackCount(actor, statusId);
    return {
      id: statusId,
      name,
      icon: status?.icon || status?.img || "icons/svg/aura.svg",
      stackCount,
      stackLabel: stackCount > 1 ? String(stackCount) : "",
      type: isBeneficialStatusEffect(statusId)
        ? "beneficial"
        : isNegativeStatusEffect(statusId)
          ? "negative"
          : "neutral",
    };
  });
}

function getHudResourcesContext() {
  const actor = getSelectedActor();
  if (!actor || actor.type === "pet") {
    return { hudResources: { enabled: false } };
  }

  const system = actor.system;
  const health = system?.health ?? { value: 0, max: 0 };
  const mana = system?.mana ?? { value: 0, max: 0 };
  const barrier = system?.barrier ?? { value: 0 };
  const showMana = actor.type === "character";

  const healthMax = Number(health.max) || 1;
  const manaMax = Number(mana.max) || 1;
  const healthValue = Number(health.value) || 0;
  const manaValue = Number(mana.value) || 0;
  const barrierValue = Number(barrier.value) || 0;

  const healthPercent = Math.min(100, Math.max(0, (healthValue / healthMax) * 100));
  const manaPercent = Math.min(100, Math.max(0, (manaValue / manaMax) * 100));
  const normalizedHealth = Math.max(0, Math.min(healthValue, healthMax || 0));
  const normalizedBarrier = Math.max(0, barrierValue);
  const barrierStartPercentage = healthMax > 0 ? (normalizedHealth / healthMax) * 100 : 0;
  const barrierInsidePercentage = healthMax > 0
    ? Math.max(0, Math.min((normalizedBarrier / healthMax) * 100, 100 - barrierStartPercentage))
    : 0;
  const barrierOverflowPercent = healthMax > 0
    ? Math.max(0, Math.min(((normalizedBarrier - Math.max(0, healthMax - normalizedHealth)) / healthMax) * 100, 100))
    : 0;

  return {
    hudResources: {
      enabled: true,
      showMana,
      health: { value: healthValue, max: healthMax },
      mana: { value: manaValue, max: manaMax },
      healthPercent,
      manaPercent,
      barrierStartPercentage,
      barrierInsidePercentage,
      barrierOverflowPercent,
      statusEffects: getActiveStatusEffects(actor),
    },
  };
}

function getHotbarElement() {
  return document.querySelector("#hotbar, .hotbar");
}

function getHotbarBounds() {
  const hotbar = getHotbarElement();
  if (!hotbar) return null;

  const rect = hotbar.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  return rect;
}

function positionHudResources() {
  const healthHud = document.getElementById(HUD_HEALTH_ID);
  const manaHud = document.getElementById(HUD_MANA_ID);
  const statusEffectsHud = document.getElementById(HUD_STATUS_EFFECTS_ID);
  if (!healthHud) return;

  const bounds = getHotbarBounds();
  if (!bounds) {
    healthHud.hidden = true;
    if (manaHud) manaHud.hidden = true;
    if (statusEffectsHud) statusEffectsHud.hidden = true;
    return;
  }

  healthHud.hidden = false;
  if (manaHud) manaHud.hidden = false;
  if (statusEffectsHud) statusEffectsHud.hidden = false;

  const barWidth = 200;
  const barHeight = 30;
  const gap = 8;
  const topOffset = 8; // Position where limit break gauge was

  // Position HP on the left side of hotbar
  healthHud.style.left = `${Math.round(bounds.left + 10)}px`;
  healthHud.style.top = `${Math.max(0, Math.round(bounds.top - barHeight - topOffset))}px`;
  healthHud.style.width = `${barWidth}px`;

  // Position MP on the right side of hotbar (if it exists)
  if (manaHud) {
    manaHud.style.left = `${Math.round(bounds.right - barWidth - 10)}px`;
    manaHud.style.top = `${Math.max(0, Math.round(bounds.top - barHeight - topOffset))}px`;
    manaHud.style.width = `${barWidth}px`;
  }

  if (statusEffectsHud) {
    const left = Math.round(bounds.left + barWidth + gap + 10);
    const right = Math.round((manaHud ? bounds.right - barWidth - gap - 10 : bounds.right - 10));
    const width = Math.max(0, right - left);
    statusEffectsHud.style.left = `${left}px`;
    statusEffectsHud.style.top = `${Math.max(0, Math.round(bounds.top - barHeight - topOffset))}px`;
    statusEffectsHud.style.width = `${width}px`;
  }
}

export async function renderHudResources() {
  const context = getHudResourcesContext();
  let healthRoot = document.getElementById(HUD_HEALTH_ID);
  let manaRoot = document.getElementById(HUD_MANA_ID);
  let statusEffectsRoot = document.getElementById(HUD_STATUS_EFFECTS_ID);

  if (!context.hudResources.enabled) {
    healthRoot?.remove();
    manaRoot?.remove();
    statusEffectsRoot?.remove();
    return;
  }

  const template = await foundry.applications.handlebars.renderTemplate(TEMPLATE, context);

  if (!healthRoot) {
    healthRoot = document.createElement("div");
    healthRoot.id = HUD_HEALTH_ID;
    healthRoot.className = "ffxiv";
    document.body.append(healthRoot);
  }

  if (!context.hudResources.showMana) {
    manaRoot?.remove();
  } else if (!manaRoot) {
    manaRoot = document.createElement("div");
    manaRoot.id = HUD_MANA_ID;
    manaRoot.className = "ffxiv";
    document.body.append(manaRoot);
  }

  if (!context.hudResources.statusEffects.length) {
    statusEffectsRoot?.remove();
    statusEffectsRoot = null;
  } else if (!statusEffectsRoot) {
    statusEffectsRoot = document.createElement("div");
    statusEffectsRoot.id = HUD_STATUS_EFFECTS_ID;
    statusEffectsRoot.className = "ffxiv";
    document.body.append(statusEffectsRoot);
  }

  // Parse the template to extract health and mana parts
  const parser = new DOMParser();
  const doc = parser.parseFromString(template, "text/html");
  const healthPart = doc.querySelector("[data-hud-health]");
  const manaPart = doc.querySelector("[data-hud-mana]");
  const statusEffectsPart = doc.querySelector("[data-hud-status-effects]");

  if (healthPart) {
    healthRoot.innerHTML = healthPart.outerHTML;
    const healthBar = healthRoot.querySelector('.health-bar');
    if (healthBar) {
      healthBar.classList.remove('health-good', 'health-bad', 'health-danger');
      if (context.hudResources.healthPercent >= 30) {
        healthBar.classList.add('health-good');
      } else {
        healthBar.classList.add('health-danger');
      }
    }
  }
  if (manaPart) {
    manaRoot.innerHTML = manaPart.outerHTML;
  }
  if (statusEffectsRoot && statusEffectsPart) {
    statusEffectsRoot.innerHTML = statusEffectsPart.outerHTML;
  }

  positionHudResources();
  requestAnimationFrame(positionHudResources);
}

export function initHudResources() {
  Hooks.on("renderHotbar", () => {
    requestAnimationFrame(positionHudResources);
    const hotbar = getHotbarElement();
    observeHotbar(hotbar);
  });
  Hooks.on("controlToken", () => renderHudResources());
  Hooks.on("canvasReady", () => renderHudResources());
  Hooks.on("updateActor", () => renderHudResources());
  Hooks.on("createActiveEffect", (effect) => {
    if (isSelectedActor(effect.parent)) renderHudResources();
  });
  Hooks.on("updateActiveEffect", (effect) => {
    if (isSelectedActor(effect.parent)) renderHudResources();
  });
  Hooks.on("deleteActiveEffect", (effect) => {
    if (isSelectedActor(effect.parent)) renderHudResources();
  });
  window.addEventListener("resize", () => requestAnimationFrame(positionHudResources));

  const hotbar = getHotbarElement();
  observeHotbar(hotbar);

  renderHudResources();
}
