import {
  getStatusStackCount,
  getStatusStackValue,
  isStackableStatusEffect,
} from "./status-effects.mjs";

const FFXIV_BARRIER_OVERLAY_KEY = "ffxivBarrierOverlay";
const FFXIV_MANA_OVERLAY_KEY = "ffxivManaOverlay";
const FFXIV_HEALTH_OVERLAY_KEY = "ffxivHealthOverlay";

export function installTokenBarrierOverlay() {
  const tokenProto = foundry.canvas.placeables.Token?.prototype;
  if (!tokenProto || tokenProto._ffxivBarrierOverlayPatched) return;

  const originalDrawBars = tokenProto.drawBars;
  tokenProto.drawBars = function (...args) {
    const result = originalDrawBars.apply(this, args);
    // If Foundry does not have the fancy new bar color hook, paint health the old-fashioned way.
    // This behaviour was added in 14.364
    if (!tokenProto._ffxivBarColorsPatched) drawFFXIVHealthBarOverlay(this);
    drawFFXIVBarrierOverlay(this);
    drawFFXIVManaOverlay(this);
    return result;
  };

  tokenProto._ffxivBarrierOverlayPatched = true;
}

export function installTokenBarColors() {
  const tokenProto = foundry.canvas.placeables.Token?.prototype;
  if (!tokenProto || tokenProto._ffxivBarColorsPatched) return;

  const originalGetBarColors = tokenProto._getBarColors;
  if (typeof originalGetBarColors !== "function") {
    // Older Foundry versions do not know this trick yet, so the overlay fallback gets to keep its job.
    return;
  }
  tokenProto._getBarColors = function (index, data) {
    if (["character", "npc"].includes(this.actor?.type) && data?.attribute === "health") {
      const value = Math.max(Number(data.value) || 0, 0);
      const max = Number(data.max) || 0;
      if (max > 0) {
        const color = foundry.utils.Color.from(value / max >= 0.3 ? "#54ad24" : "#c12c2c");
        return { empty: color, full: color };
      }
    }

    return originalGetBarColors.call(this, index, data);
  };

  tokenProto._ffxivBarColorsPatched = true;
}

export function installTokenStatusStackCounterOverlay() {
  const tokenProto = foundry.canvas.placeables.Token?.prototype;
  if (!tokenProto || tokenProto._ffxivStatusStackCounterPatched) return;

  const originalDrawEffect = tokenProto._drawEffect;
  if (typeof originalDrawEffect === "function") {
    tokenProto._drawEffect = async function (src, ...args) {
      const icon = await originalDrawEffect.call(this, src, ...args);
      if (icon && src) icon.name = src;
      return icon;
    };
  }

  const originalRefreshEffects = tokenProto._refreshEffects;
  if (typeof originalRefreshEffects === "function") {
    tokenProto._refreshEffects = function (...args) {
      const result = originalRefreshEffects.apply(this, args);
      fitFFXIVTokenEffectIconAspectRatios(this);
      drawFFXIVStatusStackCounters(this);
      return result;
    };
  } else {
    const originalDrawEffects = tokenProto._drawEffects;
    if (typeof originalDrawEffects === "function") {
      tokenProto._drawEffects = async function (...args) {
        const result = await originalDrawEffects.apply(this, args);
        fitFFXIVTokenEffectIconAspectRatios(this);
        drawFFXIVStatusStackCounters(this);
        return result;
      };
    }
  }

  tokenProto._ffxivStatusStackCounterPatched = true;
}

function fitFFXIVTokenEffectIconAspectRatios(token) {
  const effectsContainer = token?.effects;
  if (!effectsContainer) return;

  for (const sprite of effectsContainer.children.filter(
    (effect) => effect?.isSprite && effect !== effectsContainer.overlay,
  )) {
    const texture = sprite.texture;
    const textureWidth = Number(texture?.width || texture?.baseTexture?.width);
    const textureHeight = Number(texture?.height || texture?.baseTexture?.height);
    if (!Number.isFinite(textureWidth) || !Number.isFinite(textureHeight)) continue;
    if (textureWidth <= 0 || textureHeight <= 0) continue;

    const currentWidth = Number(sprite.width);
    const currentHeight = Number(sprite.height);
    const currentX = Number(sprite.x);
    const currentY = Number(sprite.y);
    const currentIsSlot = Math.abs(currentWidth - currentHeight) <= 0.5;
    const slotWidth = Number(currentIsSlot ? currentWidth : sprite._ffxivEffectSlotWidth);
    const slotHeight = Number(currentIsSlot ? currentHeight : sprite._ffxivEffectSlotHeight);
    const slotX = Number(currentIsSlot ? currentX : sprite._ffxivEffectSlotX);
    const slotY = Number(currentIsSlot ? currentY : sprite._ffxivEffectSlotY);
    if (!Number.isFinite(slotWidth) || !Number.isFinite(slotHeight)) continue;
    if (slotWidth <= 0 || slotHeight <= 0) continue;

    sprite._ffxivEffectSlotWidth = slotWidth;
    sprite._ffxivEffectSlotHeight = slotHeight;
    sprite._ffxivEffectSlotX = slotX;
    sprite._ffxivEffectSlotY = slotY;

    const scale = Math.min(slotWidth / textureWidth, slotHeight / textureHeight);
    const width = textureWidth * scale;
    const height = textureHeight * scale;
    sprite.width = width;
    sprite.height = height;
    sprite.x = slotX + ((slotWidth - width) / 2);
    sprite.y = slotY + ((slotHeight - height) / 2);
  }
}

export async function refreshAllTokenStatusStackCounters() {
  const tokens = canvas?.tokens?.placeables ?? [];
  if (!tokens.length) return;
  for (const token of tokens) {
    if (!token?.actor) continue;
    await token.drawEffects();
  }
}

function drawFFXIVStatusStackCounters(token) {
  const effectsContainer = token?.effects;
  if (!effectsContainer || !token.actor) return;
  if (
    !token._ffxivStatusCounterContainer ||
    !token.children.find((child) => child?.name === "ffxivStatusStackCounters")
  ) {
    const counterContainer = new PIXI.Container();
    counterContainer.name = "ffxivStatusStackCounters";
    token._ffxivStatusCounterContainer = token.addChild(counterContainer);
  }

  const counterContainer = token._ffxivStatusCounterContainer;
  counterContainer.removeChildren().forEach((child) => child.destroy());

  const iconPathToStatusId = new Map();
  for (const statusEffect of CONFIG.statusEffects ?? []) {
    if (!isStackableStatusEffect(statusEffect?.id)) continue;
    if (statusEffect.icon)
      iconPathToStatusId.set(statusEffect.icon, statusEffect.id);
    if (statusEffect.img)
      iconPathToStatusId.set(statusEffect.img, statusEffect.id);
  }
  const iconPathToEffects = getTokenStackableEffectsByIcon(token.actor);
  const statusIdCounts = getTokenStackableEffectCountsByStatusId(iconPathToEffects);

  for (const sprite of effectsContainer.children.filter(
    (effect) => effect?.isSprite && effect !== effectsContainer.overlay,
  )) {
    const statusId = iconPathToStatusId.get(sprite.name);
    if (!statusId) continue;

    const effect = iconPathToEffects.get(sprite.name)?.shift();
    const stackCount = effect
      ? getStatusStackValue(effect, 1, statusId)
      : getStatusStackCount(token.actor, statusId);
    if (stackCount <= 1 && (statusIdCounts.get(statusId) ?? 0) <= 1) continue;

    const iconSize = sprite.height || 20;
    const textStyle = CONFIG.canvasTextStyle.clone();
    textStyle.fontWeight = "700";
    textStyle.fill = "#ffffff";
    textStyle.stroke = "#000000";
    textStyle.strokeThickness = Math.max(2, Math.round((iconSize / 20) * 3));
    textStyle.fontSize = Math.max(11, Math.round((iconSize / 20) * 14));
    textStyle.align = "right";

    const label = new PIXI.Text(String(stackCount), textStyle);
    label.name = `${statusId}-stack-counter`;
    label.anchor.set(1);

    const sizeRatio = iconSize / 20;
    label.x = sprite.x + sprite.width + 1 * sizeRatio;
    label.y = sprite.y + sprite.height + 3 * sizeRatio;
    label.resolution = Math.max(1, (20 / iconSize) * 1.5);
    counterContainer.addChild(label);
  }
}

function getTokenStackableEffectsByIcon(actor) {
  const effectsByIcon = new Map();
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled) continue;
    const statusId = getSingleStackableStatusId(effect);
    if (!statusId) continue;

    const icon = effect.img || effect.icon;
    if (!icon) continue;
    if (!effectsByIcon.has(icon)) effectsByIcon.set(icon, []);
    effectsByIcon.get(icon).push(effect);
  }
  return effectsByIcon;
}

function getTokenStackableEffectCountsByStatusId(effectsByIcon) {
  const counts = new Map();
  for (const effects of effectsByIcon.values()) {
    for (const effect of effects) {
      const statusId = getSingleStackableStatusId(effect);
      if (!statusId) continue;
      counts.set(statusId, (counts.get(statusId) ?? 0) + 1);
    }
  }
  return counts;
}

function getSingleStackableStatusId(effect) {
  const statuses = effect?.statuses;
  if (!(statuses instanceof Set)) return null;
  const stackableStatuses = Array.from(statuses).filter((statusId) =>
    isStackableStatusEffect(statusId),
  );
  return stackableStatuses.length === 1 ? stackableStatuses[0] : null;
}

function drawFFXIVHealthBarOverlay(token) {
  const overlay = getHealthOverlayGraphic(token);
  if (!overlay) return;

  overlay.clear();
  overlay.visible = false;

  if (!token?.actor || !["character", "npc"].includes(token.actor.type)) return;

  const healthBarName = getTokenBarByAttribute(token, "health");
  if (!healthBarName) return;

  const healthBar = token.bars?.[healthBarName];
  if (!healthBar || healthBar.visible === false) return;

  const healthData = token.document?.getBarAttribute?.(healthBarName);
  const maxHealth = Number(healthData?.max) || 0;
  if (maxHealth <= 0) return;

  const currentHealth = Math.max(Number(healthData?.value) || 0, 0);
  const healthPct = Math.clamp(currentHealth / maxHealth, 0, 1);
  const { width, height } = token.document.getSize();
  const scale = canvas.dimensions.uiScale;
  const barHeight = 8 * (token.document.height >= 2 ? 1.5 : 1) * scale;
  const barY = healthBarName === "bar1" ? height - barHeight : 0;
  const barWidth = width;
  const healthColor = healthPct * 100 >= 30 ? 0x54ad24 : 0xc12c2c;
  const trackColor = 0x111111;

  overlay.position.set(0, 0);
  overlay.lineStyle(scale, 0x000000, 0.85);
  overlay.beginFill(trackColor, 0.85);
  overlay.drawRoundedRect(0, barY, barWidth, barHeight, 2 * scale);

  if (healthPct > 0) {
    overlay.beginFill(healthColor, 0.95);
    overlay.drawRoundedRect(0, barY, healthPct * barWidth, barHeight, 2 * scale);
  }

  overlay.visible = true;
}

function getHealthOverlayGraphic(token) {
  const bars = token?.bars;
  if (!bars) return null;
  if (bars[FFXIV_HEALTH_OVERLAY_KEY]) return bars[FFXIV_HEALTH_OVERLAY_KEY];
  const overlay = bars.addChild(new PIXI.Graphics());
  bars[FFXIV_HEALTH_OVERLAY_KEY] = overlay;
  return overlay;
}

function drawFFXIVBarrierOverlay(token) {
  const overlay = getBarrierOverlayGraphic(token);
  if (!overlay) return;

  overlay.clear();
  overlay.visible = false;

  if (!token?.actor || !["character", "npc"].includes(token.actor.type)) return;

  const healthBarName = getTokenBarByAttribute(token, "health");
  if (!healthBarName) return;

  const healthBar = token.bars?.[healthBarName];
  if (!healthBar || healthBar.visible === false) return;

  const healthData = token.document?.getBarAttribute?.(healthBarName);
  const maxHealth = Number(healthData?.max) || 0;
  if (maxHealth <= 0) return;

  const barrierBarName = getTokenBarByAttribute(token, "barrier");
  if (barrierBarName && token.bars?.[barrierBarName]) {
    token.bars[barrierBarName].visible = false;
  }

  const currentHealth = Math.max(Number(healthData?.value) || 0, 0);
  const barrierValue = Math.max(
    Number(token.actor.system?.barrier?.value) || 0,
    0,
  );
  if (barrierValue <= 0) return;

  const startPct = Math.clamp(currentHealth, 0, maxHealth) / maxHealth;
  const barrierPct = barrierValue / maxHealth;
  const insidePct = Math.clamp(Math.min(barrierPct, 1 - startPct), 0, 1);
  const overflowPct = Math.max(barrierPct - insidePct, 0);
  const overflowDisplayPct = Math.min(overflowPct, 1);

  const { width, height } = token.document.getSize();
  const scale = canvas.dimensions.uiScale;
  const barHeight = 8 * (token.document.height >= 2 ? 1.5 : 1) * scale;
  const barY = healthBarName === "bar1" ? height - barHeight : 0;
  const barWidth = width;
  const barrierColor = 0xffd54f;

  overlay.position.set(0, 0);
  overlay.lineStyle(scale, 0x000000, 0.85);
  if (insidePct > 0) {
    overlay.beginFill(barrierColor, 0.95);
    overlay.drawRoundedRect(
      startPct * barWidth,
      barY,
      insidePct * barWidth,
      barHeight,
      2 * scale,
    );
  }

  if (overflowDisplayPct > 0) {
    const overflowHeight = Math.max(2 * scale, barHeight * 0.45);
    const overflowY = barY - overflowHeight - 0.5 * scale;
    overlay.beginFill(barrierColor, 0.95);
    overlay.drawRoundedRect(
      0,
      overflowY,
      overflowDisplayPct * barWidth,
      overflowHeight,
      2 * scale,
    );
  }

  overlay.visible = true;
}

function getBarrierOverlayGraphic(token) {
  const bars = token?.bars;
  if (!bars) return null;
  if (bars[FFXIV_BARRIER_OVERLAY_KEY]) return bars[FFXIV_BARRIER_OVERLAY_KEY];
  const overlay = bars.addChild(new PIXI.Graphics());
  bars[FFXIV_BARRIER_OVERLAY_KEY] = overlay;
  return overlay;
}

function drawFFXIVManaOverlay(token) {
  const overlay = getManaOverlayGraphic(token);
  if (!overlay) return;

  overlay.clear();
  overlay.visible = false;

  if (!token?.actor || token.actor.type !== "character") return;

  const healthBarName = getTokenBarByAttribute(token, "health");
  const healthBar = healthBarName ? token.bars?.[healthBarName] : null;
  if (!healthBar || healthBar.visible === false) return;

  const currentMana = Math.max(0, Number(token.actor.system?.mana?.value) || 0);
  const maxMana = Math.max(1, Number(token.actor.system?.mana?.max) || 5);
  if (currentMana >= maxMana) return;
  const manaPct = Math.clamp(currentMana / maxMana, 0, 1);

  const { width, height } = token.document.getSize();
  const scale = canvas.dimensions.uiScale;
  const barHeight = 7 * (token.document.height >= 2 ? 1.5 : 1) * scale;
  const barWidth = width;
  const barY = height + 2 * scale;
  const manaColor = 0xd064c4;
  const manaTrackColor = 0x111111;

  overlay.position.set(0, 0);
  overlay.lineStyle(scale, 0x000000, 0.85);
  overlay.beginFill(manaTrackColor, 0.85);
  overlay.drawRoundedRect(0, barY, barWidth, barHeight, 2 * scale);

  if (manaPct > 0) {
    overlay.beginFill(manaColor, 0.95);
    overlay.drawRoundedRect(0, barY, manaPct * barWidth, barHeight, 2 * scale);
  }

  overlay.visible = true;
}

function getManaOverlayGraphic(token) {
  const bars = token?.bars;
  if (!bars) return null;
  if (bars[FFXIV_MANA_OVERLAY_KEY]) return bars[FFXIV_MANA_OVERLAY_KEY];
  const overlay = bars.addChild(new PIXI.Graphics());
  bars[FFXIV_MANA_OVERLAY_KEY] = overlay;
  return overlay;
}

function getTokenBarByAttribute(token, attribute) {
  for (const barName of ["bar1", "bar2"]) {
    const barAttribute = token.document?.[barName]?.attribute;
    if (barAttribute === attribute) return barName;
  }
  return null;
}

export function refreshActorTokenBars(actor) {
  if (!actor || !canvas?.tokens) return;

  for (const token of canvas.tokens.placeables) {
    if (!token?.actor || !["character", "npc"].includes(token.actor.type)) continue;
    if (
      token.actor === actor ||
      token.actor.uuid === actor.uuid ||
      token.actor.id === actor.id
    ) {
      if (typeof token.drawBars === "function") token.drawBars();
      else token.renderFlags?.set?.({ refreshBars: true });
    }
  }
}
