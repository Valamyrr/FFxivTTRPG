import { initBarrierAutomation } from "./helpers/barrier.mjs";
import { FFXIVActor } from "./actors/actor.mjs";
import { FFXIVCombat } from "./combat.mjs";
import { FFXIVItem } from "./items/item.mjs";
import { FFXIVActiveEffect } from "./active-effect.mjs";
import { FFXIVTokenDocument } from "./token.mjs";
import { FFXIVRegionLayer } from "./region-layer.mjs";
import { registerDataModels } from "./data-models.mjs";
import { FFXIVActorSheet } from "./actors/actor-sheet.mjs";
import { FFXIVItemSheet } from "./items/item-sheet.mjs";
import { preloadHandlebarsTemplates } from "./helpers/templates.mjs";
import { FFXIV } from "./helpers/config.mjs";
import { debugError, debugLog } from "./helpers/debug.mjs";
import { initLimitBreakHud } from "./helpers/limit-break-hud.mjs";
import { initHudResources } from "./helpers/hud-resources.mjs";
import { initDutyCommenced } from "./helpers/duty-commenced.mjs";
import { SettingsHelpers } from "./helpers/settings.mjs";
import {
  COMATOSE_ALLOWED_STATUS_IDS,
  KNOCKED_OUT_ALLOWED_STATUS_IDS,
  applyStatusEffectChange,
  applyStatusEffectStackDelta,
  getStatusStackCount,
  hasStatus,
  isEliteFoeBlockedStatus,
  isNegativeStatusEffect,
  isStackableStatusEffect,
  migrateLegacyStatusStackEffects,
  updateStatusEffects,
} from "./helpers/status-effects.mjs";
import { registerEscapeHandler } from "./helpers/escape.mjs";
import { getSummonTokenDisposition, syncSummonTokenDispositions } from "./helpers/summons.mjs";
import { initHotbar, registerHotbarKeybindings } from "./helpers/hotbar.mjs";
import { initEnrichedTooltips } from "./helpers/tooltips.mjs";
import { getActiveGM } from "./helpers/socket.mjs";
import { registerFormulaEditorContexts } from "./helpers/formula-editor.mjs";
import { registerRulePages } from "./journal/rule-page.mjs";
import { registerRules } from "./helpers/rules.mjs";
import { registerAbilityTargets } from "./helpers/ability-targets.mjs";
import {
  normalizeLegacySubtractActiveEffectChangeModes,
  normalizeLegacySubtractActiveEffectUpdate,
  migrateLegacySubtractActiveEffectChangeModes,
  normalizeDashDirectHitText,
  normalizeDashDirectHitTextUpdate,
  migrateDashDirectHitText,
  migrateBootshineCriticalFlags,
  migrateEssentialDignityHealingFlags,
  migrateLegacyPetTraits,
  migrateActorCurrencyToFortune,
  migrateAscendentStatusIdToTranscendent,
} from "./migrations/legacy-data.mjs";
import {
  playConfiguredSound,
  applyFFXIVChatTheme,
  getHookHTMLElement,
} from "./helpers/ui.mjs";
import { migrateItemDataStructure } from "./migrations/item-data.mjs";
import {
  installTokenBarrierOverlay,
  installTokenBarColors,
  installTokenStatusStackCounterOverlay,
  refreshAllTokenStatusStackCounters,
  refreshActorTokenBars,
} from "./helpers/token-overlays.mjs";
import {
  renderCombatStepIndicators,
  renderCombatTrackerStatusStacks,
  renderCombatTrackerOrderControls,
  renderCombatTrackerSummonGroups,
  installCarouselCombatTrackerStepIndicators,
  syncCombatantKnockedOutStatus,
} from "./helpers/combat-tracker.mjs";
import {
  registerMarkerPlacementKeybindings,
  openMarkerPlacementTool,
  initializeMarkerShapeDialog,
  renderMarkerDataUrl,
  registerMarkerHooks,
} from "./helpers/markers.mjs";
import { getActorCanvasToken } from "./helpers/damage.mjs";
import {
  shouldSuppressDefaultStatusText,
  registerChatMessageCreation,
  registerChatMessageRendering,
} from "./helpers/chat.mjs";
import { registerHandlebarsHelpers } from "./helpers/handlebars.mjs";
import { registerSystemSocketHooks } from "./helpers/socket-handlers.mjs";

const LEGACY_ABILITY_TYPES = new Set([
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
]);
const HIDDEN_ITEM_CREATE_TYPES = new Set(["currency"]);
const markerPreviewImages = new WeakMap();
const markerPreviewCache = new WeakMap();

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once("init", function () {
  registerDataModels();
  registerAbilityTargets();
  SettingsHelpers.initSettings();
  game.settings.register("ffxiv", "customMarkers", {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register("ffxiv", "markerOpacity", {
    scope: "user",
    config: false,
    type: Number,
    default: 0.75,
  });
  game.settings.register("ffxiv", "abilityMarkerOpacity", {
    scope: "user",
    config: false,
    type: Number,
    default: 0.75,
  });
  registerHotbarKeybindings();
  registerMarkerPlacementKeybindings();
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.ffxivttrpg = {
    FFXIVActor,
    FFXIVItem,
    placeMarker: (marker, options) => openMarkerPlacementTool(marker, options),
    initializeMarkerEditor: (element, marker, setMarker, signal) => {
      const size = 15;
      const state = Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => Boolean(marker?.state?.[y]?.[x])),
      );
      const geometry = {
        shape: marker?.shape === "circle" ? "circle" : "grid",
        radius: marker?.radius ?? null,
      };
      initializeMarkerShapeDialog(
        element,
        { options: { signal } },
        state,
        Math.floor(size / 2),
        geometry,
        setMarker,
        undefined,
        "abilityMarkerOpacity",
      );
    },
    renderMarkerPreview: (canvasElement, marker, showGrid = false) => {
      if (!canvasElement || !marker) return;
      const gridSize = Math.max(24, Math.round(canvas.grid.size / 3));
      const key = JSON.stringify([gridSize, marker]);
      const current = markerPreviewImages.get(canvasElement);
      if (current?.key === key && current.showGrid === showGrid) return;
      let cached = markerPreviewCache.get(marker);
      if (cached?.key !== key) {
        cached = { key, rendered: renderMarkerDataUrl(marker, gridSize) };
        markerPreviewCache.set(marker, cached);
      }
      const rendered = cached.rendered;
      if (!rendered) {
        markerPreviewImages.delete(canvasElement);
        canvasElement.width = 1;
        canvasElement.height = 1;
        return;
      }
      canvasElement.width = rendered.width;
      canvasElement.height = rendered.height;
      const context = canvasElement.getContext("2d");
      const image = new Image();
      markerPreviewImages.set(canvasElement, { image, key, showGrid });
      image.addEventListener("load", () => {
        if (markerPreviewImages.get(canvasElement)?.image !== image) return;
        context.drawImage(image, 0, 0);
        if (!showGrid) return;
        context.save();
        context.globalCompositeOperation = "source-atop";
        context.strokeStyle = "rgba(255, 255, 255, 0.65)";
        context.lineWidth = Math.max(1, gridSize / 24);
        context.beginPath();
        for (let x = gridSize; x < canvasElement.width; x += gridSize) {
          context.moveTo(x, 0);
          context.lineTo(x, canvasElement.height);
        }
        for (let y = gridSize; y < canvasElement.height; y += gridSize) {
          context.moveTo(0, y);
          context.lineTo(canvasElement.width, y);
        }
        context.stroke();
        context.restore();
      }, { once: true });
      image.src = rendered.src;
    },
    runItemMigration: async (force = false) =>
      migrateItemDataStructure({ force }),
    applyGlobalArtworkRotationLock: async () =>
      applyGlobalArtworkRotationLock(),
  };

  // Add custom constants for configuration.
  CONFIG.FFXIV = FFXIV;
  registerRulePages();
  registerRules();

  // Define custom Document classes
  CONFIG.Actor.documentClass = FFXIVActor;
  CONFIG.Combat.documentClass = FFXIVCombat;
  CONFIG.Item.documentClass = FFXIVItem;
  CONFIG.ActiveEffect.documentClass = FFXIVActiveEffect;
  CONFIG.Token.documentClass = FFXIVTokenDocument;
  CONFIG.Canvas.layers.regions.layerClass = FFXIVRegionLayer;
  registerFormulaEditorContexts();

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register sheet application classes
  debugLog("FFXIV | Registering sheets");
  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  DocumentSheetConfig.unregisterSheet(
    Actor,
    "core",
    foundry.appv1.sheets.ActorSheet,
  );

  DocumentSheetConfig.registerSheet(Actor, "ffxiv", FFXIVActorSheet, {
    types: ["character", "pet", "npc", "encounter"],
    makeDefault: true,
    label: "FFXIV.SheetLabels.Actor",
  });

  DocumentSheetConfig.unregisterSheet(
    Item,
    "core",
    foundry.appv1.sheets.ItemSheet,
  );
  DocumentSheetConfig.registerSheet(Item, "ffxiv", FFXIVItemSheet, {
    makeDefault: true,
    label: "FFXIV.SheetLabels.Item",
  });

  CONFIG.Item.typeLabels = {
    ability: game.i18n.localize("FFXIV.ItemType.ability"),
    consumable: game.i18n.localize("FFXIV.ItemType.consumable"),
    trait: game.i18n.localize("FFXIV.ItemType.trait"),
    title: game.i18n.localize("FFXIV.ItemType.title"),
    gear: game.i18n.localize("FFXIV.ItemType.gear"),
    minion: game.i18n.localize("FFXIV.ItemType.minion"),
    augment: game.i18n.localize("FFXIV.ItemType.augment"),
    job: game.i18n.localize("FFXIV.ItemType.job"),
  };

  CONFIG.Actor.typeLabels = {
    character: game.i18n.localize("FFXIV.ActorType.character"),
    npc: game.i18n.localize("FFXIV.ActorType.npc"),
    encounter: game.i18n.localize("FFXIV.ActorType.encounter"),
    pet: game.i18n.localize("FFXIV.ActorType.pet"),
  };

  updateStatusEffects();
  registerEscapeHandler();

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

Hooks.on("preCreateActiveEffect", (effect) => {
  normalizeLegacySubtractActiveEffectChangeModes(effect);
  const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
  if (!actor) return;
  applyLinkedTraitDataToActiveEffectSource(effect, actor);
  const statuses = Array.from(effect.statuses ?? effect._source?.statuses ?? []);
  if (
    hasStatus(actor, "knocked_out") &&
    statuses.some((statusId) => !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(statusId))
  )
    return false;
  if (
    hasStatus(actor, "comatose") &&
    statuses.some((statusId) => !COMATOSE_ALLOWED_STATUS_IDS.has(statusId))
  )
    return false;
  if (
    hasStatus(actor, "transcendent") &&
    statuses.some((statusId) => isNegativeStatusEffect(statusId))
  )
    return false;
  if (statuses.some((statusId) => isEliteFoeBlockedStatus(actor, statusId)))
    return false;
});

Hooks.on("preCreateItem", (item) => {
  normalizeDashDirectHitText(item);
});

Hooks.on("preUpdateItem", (_item, changes) => {
  normalizeDashDirectHitTextUpdate(changes);
});

Hooks.on("preUpdateActiveEffect", (effect, changes, options) => {
  normalizeLegacySubtractActiveEffectUpdate(changes);
  if (options?.ffxivSyncEliteFoeEffect) return;
  if (effect?.parent?.documentName !== "Actor") return;
  if (
    foundry.utils.hasProperty(changes, "statuses")
  ) {
    const statuses = Array.from(changes.statuses ?? []);
    if (
      hasStatus(effect.parent, "knocked_out") &&
      statuses.some((statusId) => !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(statusId))
    )
      return false;
    if (
      hasStatus(effect.parent, "comatose") &&
      statuses.some((statusId) => !COMATOSE_ALLOWED_STATUS_IDS.has(statusId))
    )
      return false;
    if (
      hasStatus(effect.parent, "transcendent") &&
      statuses.some((statusId) => isNegativeStatusEffect(statusId))
    )
      return false;
    if (statuses.some((statusId) => isEliteFoeBlockedStatus(effect.parent, statusId)))
      return false;
  }
  if (effect.getFlag("ffxiv", ELITE_FOE_EFFECT_FLAG) !== true) return;
  if (foundry.utils.hasProperty(changes, "disabled") && changes.disabled === true)
    return false;
});

Hooks.on("preDeleteActiveEffect", (effect, options) => {
  if (options?.ffxivSyncEliteFoeEffect) return;
  if (effect?.parent?.documentName !== "Actor") return;
  if (effect.getFlag("ffxiv", ELITE_FOE_EFFECT_FLAG) === true)
    return false;
});

Hooks.on("updateActiveEffect", (effect, _changes, options) => {
  if (options?.ffxivSyncEliteFoeEffect) return;
  if (effect?.parent?.documentName !== "Actor") return;
  if (effect.getFlag("ffxiv", ELITE_FOE_EFFECT_FLAG) !== true) return;
  syncEliteFoeEffect(effect.parent).catch((error) => {
    debugError("FFXIV | Failed to sync elite foe effect:", error);
  });
});

function applyLinkedTraitDataToActiveEffectSource(effect, actor = null) {
  const parent = actor ?? (effect?.parent?.documentName === "Actor" ? effect.parent : null);
  const trait = parent?.findTraitLinkedToActiveEffect?.(effect);
  if (!trait) return;

  const updates = {
    "flags.ffxiv.linkedTraitId": trait.id,
    "flags.ffxiv.linkedTraitUuid": trait.uuid,
    "flags.ffxiv.linkedTraitName": trait.name,
  };
  const traitDescription = String(trait.system?.description ?? "").trim();
  const effectDescription = String(effect.description ?? effect._source?.description ?? "").trim();
  if (traitDescription && !effectDescription) updates.description = traitDescription;
  effect.updateSource(updates);
}

Hooks.on("createActor", (actor) => {
  syncEliteFoeEffect(actor).catch((error) => {
    debugError("FFXIV | Failed to sync elite foe effect:", error);
  });
});

Hooks.on("updateActor", (actor, changes, options) => {
  if (foundry.utils.hasProperty(changes, "system.elite_foe")) {
    syncEliteFoeEffect(actor).catch((error) => {
      debugError("FFXIV | Failed to sync elite foe effect:", error);
    });
  }

  if (options?.ffxivSkipKnockedOutSync) return;
  if (!foundry.utils.hasProperty(changes, "system.health.value")) return;
  const health = Number(actor.system?.health?.value ?? 0);
  if (health > 0 || hasStatus(actor, "knocked_out")) return;
  applyStatusEffectChange(actor, "knocked_out", true).catch((error) => {
    debugError("FFXIV | Failed to apply knocked out status:", error);
  });
});

Hooks.on("updateCombatant", (combatant, changes, options) => {
  if (options?.ffxivSyncKnockedOut) return;
  if (!foundry.utils.hasProperty(changes, "defeated")) return;
  syncCombatantKnockedOutStatus(combatant).catch((error) => {
    debugError("FFXIV | Failed to sync defeated status:", error);
  });
});

Hooks.on("combat-tracker-dock-init", (api) => {
  installCarouselCombatTrackerStepIndicators(api);
});

Hooks.on("renderCombatTracker", (app, html) => {
  renderCombatStepIndicators(app, html);
  renderCombatTrackerStatusStacks(app, html);
  renderCombatTrackerOrderControls(app, html);
  renderCombatTrackerSummonGroups(app, html);
});

Hooks.on("preCreateToken", (token) => {
  const disposition = getSummonTokenDisposition(token);
  if (Number.isFinite(disposition)) token.updateSource({ disposition });
});

Hooks.on("preUpdateToken", (token, changes) => {
  if (!("disposition" in changes)) return;
  const disposition = getSummonTokenDisposition(token);
  if (Number.isFinite(disposition)) changes.disposition = disposition;
});

Hooks.on("updateToken", (token, changes) => {
  if (!("disposition" in changes) || game.user.id !== getActiveGM()?.id) return;
  syncSummonTokenDispositions(token.parent).catch((error) => {
    debugError("FFXIV | Failed to sync summon dispositions:", error);
  });
});

Hooks.on("canvasReady", (canvas) => {
  if (game.user.id !== getActiveGM()?.id) return;
  syncSummonTokenDispositions(canvas.scene).catch((error) => {
    debugError("FFXIV | Failed to sync summon dispositions:", error);
  });
});

Hooks.on("updateActor", (_actor, changes) => {
  if (game.user.id !== getActiveGM()?.id) return;
  if (!foundry.utils.hasProperty(changes, "prototypeToken.disposition")) return;
  for (const scene of game.scenes) {
    syncSummonTokenDispositions(scene).catch((error) => {
      debugError("FFXIV | Failed to sync summon dispositions:", error);
    });
  }
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

registerHandlebarsHelpers();

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", function () {
  initEnrichedTooltips();
  installSheetDragPerformanceClass();
  initHotbar();
  initLimitBreakHud();
  initHudResources();
  initBarrierAutomation();
  initDutyCommenced();
  configureCombatTrackedResource().catch((error) => {
    debugError("FFXIV | Failed to configure combat tracked resource:", error);
  });
  installCarouselCombatTrackerStepIndicators();
  installTokenBarColors();
  installTokenBarrierOverlay();
  installTokenStatusStackCounterOverlay();
  refreshAllTokenStatusStackCounters().catch((error) => {
    debugError("FFXIV | Failed to refresh status stack counters:", error);
  });
  installItemDirectoryCompatibilityPatch();
  installItemCreateTypeFilter();
  installStackableStatusEffectHudBehavior();
  installAbilityLinkedEffectScopeSync();
  installActorSheetActiveEffectRefresh();
  installActiveEffectStatusDuplicateControls();
  installGlobalArtworkRotationLock();
  installEncounterActorPlacement();
  applyGlobalArtworkRotationLock().catch((error) => {
    debugError("FFXIV | Failed to apply global artwork rotation lock:", error);
  });
  syncEliteFoeEffects().catch((error) => {
    debugError("FFXIV | Failed to sync elite foe effects:", error);
  });

  // Color Scheme to use with css variables
  if (game.settings.get("ffxiv", "overrideColorScheme")) {
    CONFIG.theme = "blue";
  } else {
    if (game.settings.get("core", "uiConfig").colorScheme.applications) {
      CONFIG.theme = game.settings.get(
        "core",
        "uiConfig",
      ).colorScheme.applications;
    } else {
      CONFIG.theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  }

  if (game.user.isGM) {
    migrateAscendentStatusIdToTranscendent().catch((error) => {
      debugError("FFXIV | Failed to migrate ascendent status id:", error);
    });
    migrateLegacyStatusStackEffects().catch((error) => {
      debugError("FFXIV | Failed to migrate legacy status stacks:", error);
    });
    migrateLegacySubtractActiveEffectChangeModes().catch((error) => {
      debugError("FFXIV | Failed to migrate legacy subtract active effect modes:", error);
    });
    migrateDashDirectHitText().catch((error) => {
      debugError("FFXIV | Failed to clear dash-only direct hit text fields:", error);
    });
    migrateBootshineCriticalFlags().catch((error) => {
      debugError("FFXIV | Failed to migrate Bootshine critical flags:", error);
    });
    migrateEssentialDignityHealingFlags().catch((error) => {
      debugError("FFXIV | Failed to migrate Essential Dignity healing flags:", error);
    });
    migrateLegacyPetTraits();
    migrateItemDataStructure();
    migrateActorCurrencyToFortune();
  }
});

function installSheetDragPerformanceClass() {
  let draggedWindow = null;

  const clear = () => {
    draggedWindow?.classList.remove("ffxiv-window-dragging");
    draggedWindow = null;
  };

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.("button, a, input, select, textarea")) return;

    const header = event.target?.closest?.(
      ".application.ffxiv .window-header, .window-app.ffxiv .window-header",
    );
    const app = header?.closest?.(".application.ffxiv, .window-app.ffxiv");
    if (!app) return;

    clear();
    draggedWindow = app;
    draggedWindow.classList.add("ffxiv-window-dragging");
  }, true);

  window.addEventListener("pointerup", clear, true);
  window.addEventListener("pointercancel", clear, true);
  window.addEventListener("blur", clear);
}

async function configureCombatTrackedResource() {
  if (!game.user.can("SETTINGS_MODIFY")) return;

  const key = foundry.documents.Combat.CONFIG_SETTING;
  const settings = game.settings.get("core", key);
  if (settings.resource && settings.resource !== "health") return;

  await game.settings.set("core", key, {
    ...settings,
    resource: "health.value",
  });
}

function installAbilityLinkedEffectScopeSync() {
  if (globalThis.__ffxivAbilityEffectScopeSyncInstalled) return;
  globalThis.__ffxivAbilityEffectScopeSyncInstalled = true;

  Hooks.on("updateActiveEffect", async (effect, changes, options) => {
    if (options?.ffxivSyncApplyTo) return;
    const parent = effect?.parent;
    if (parent?.documentName !== "Item" || parent.type !== "ability") return;

    const hasFlagChange = foundry.utils.hasProperty(changes, "flags.ffxiv.applyTo");
    const hasTransferChange = foundry.utils.hasProperty(changes, "transfer");
    if (!hasFlagChange && !hasTransferChange) return;

    const flagged = String(effect.getFlag("ffxiv", "applyTo") || "").trim().toLowerCase();
    const applyTo = flagged === "self" || flagged === "target" || flagged === "self_auto"
      ? flagged
      : effect.transfer
        ? "self"
        : "target";
    const transfer = applyTo === "self";

    const updates = {};
    if (effect.transfer !== transfer) updates.transfer = transfer;
    if (flagged !== applyTo) updates["flags.ffxiv.applyTo"] = applyTo;
    if (!Object.keys(updates).length) return;

    await effect.update(updates, { render: false, ffxivSyncApplyTo: true });
  });
}

function installActorSheetActiveEffectRefresh() {
  if (globalThis.__ffxivActorSheetActiveEffectRefreshInstalled) return;
  globalThis.__ffxivActorSheetActiveEffectRefreshInstalled = true;

  const refreshActorSheetApps = async (actor) => {
    const apps = new Set([
      ...Object.values(actor.apps ?? {}),
      ...Object.values(ui.windows ?? {}).filter((app) => app?.document === actor),
    ]);
    for (const app of apps) {
      if (!(app instanceof FFXIVActorSheet)) continue;
      if (app.rendered === false) continue;
      if (!app._pendingSheetScrollPositions?.length && typeof app._captureSheetScroll === "function") {
        app._captureSheetScroll();
      }
      try {
        if (typeof app._refreshEffectsPanelIfChanged === "function") {
          await app._refreshEffectsPanelIfChanged();
        }
        if (typeof app._refreshAbilitiesPanel === "function") {
          await app._refreshAbilitiesPanel();
        }
      } finally {
        if (typeof app._restoreSheetScroll === "function") {
          app._restoreSheetScroll();
        }
      }
    }
  };

  const refreshActorSheets = (effect) => {
    const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
    if (!actor) return;
    refreshActorSheetApps(actor).catch((error) => {
      debugError("FFXIV | Failed to refresh actor sheet active effects:", error);
    });
  };

  const cleanupExpiredEffect = (effect) => {
    if (effect?.parent?.documentName !== "Actor") return;
    const remaining = Number(effect.duration?.remaining);
    const expired = Number.isFinite(remaining) && remaining <= 0;
    if (effect.disabled || !effect.isTemporary || effect.active !== false || !expired) return;
    effect.delete({ render: false }).catch((error) => {
      debugError("FFXIV | Failed to delete expired active effect:", error);
    });
  };

  Hooks.on("createActiveEffect", (effect, options) => {
    if (options?.ffxivSuppressStatusText === true) {
      refreshActorSheets(effect);
      return;
    }
    showActiveEffectCreationText(effect);
    try {
      const statuses = Array.from(effect?.statuses ?? effect?._source?.statuses ?? []);
      const hasEnmity = statuses.some((s) => String(s ?? "").trim() === "enmity");
      if (hasEnmity) {
        const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
        if (actor) {
          const token = getActorCanvasToken(actor);
          if (token?.center) {
            playConfiguredSound("soundNotificationFFXIV_enmity");
          }
        }
      }
    } catch (err) {
      debugError("FFXIV | Failed to play enmity sound:", err);
    }
    refreshActorSheets(effect);
  });
  Hooks.on("updateActiveEffect", (effect) => {
    cleanupExpiredEffect(effect);
    refreshActorSheets(effect);
  });
  Hooks.on("deleteActiveEffect", (effect, options) => {
    if (options?.ffxivSuppressRemovalText !== true && options?.ffxivSuppressStatusText !== true)
      showActiveEffectRemovalText(effect);
    refreshActorSheets(effect);
  });
}

function showActiveEffectCreationText(effect) {
  try {
    const statuses = Array.from(effect?.statuses ?? effect?._source?.statuses ?? []);
    const detrimental = statuses.some((s) => isNegativeStatusEffect(String(s ?? "").trim()));
    const fill = detrimental ? 0xff6b6b : 0x57d67a;
    showActiveEffectChangeText(effect, "+", fill);
  } catch (err) {
    showActiveEffectChangeText(effect, "+", 0x57d67a);
  }
}

function showActiveEffectRemovalText(effect) {
  try {
    const statuses = Array.from(effect?.statuses ?? effect?._source?.statuses ?? []);
    const detrimental = statuses.some((s) => isNegativeStatusEffect(String(s ?? "").trim()));
    const fill = detrimental ? 0x57d67a : 0xff6b6b;
    showActiveEffectChangeText(effect, "-", fill);
  } catch (err) {
    showActiveEffectChangeText(effect, "-", 0xff6b6b);
  }
}

const pendingActiveEffectText = new Map();

function showActiveEffectChangeText(effect, sign, fill) {
  const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
  if (effect?.getFlag?.("ffxiv", ELITE_FOE_EFFECT_FLAG) === true) return;
  if (!actor || typeof canvas?.interface?.createScrollingText !== "function") return;

  const token = getActorCanvasToken(actor);
  if (!token?.center) return;

  let batch = pendingActiveEffectText.get(token);
  if (!batch) {
    batch = { entries: [], timeout: null };
    pendingActiveEffectText.set(token, batch);
  }

  const direction = sign === "-"
    ? (CONST.TEXT_ANCHOR_POINTS?.BOTTOM ?? 2)
    : (CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1);

  const icon = effect?.img ?? effect?.icon ?? null;
  batch.entries.push({ text: `${sign}${effect.name}`, fill, direction, icon });
  clearTimeout(batch.timeout);
  batch.timeout = setTimeout(() => {
    pendingActiveEffectText.delete(token);
    showActiveEffectTextBatch(token, batch.entries);
  }, 50);
}

function showActiveEffectTextBatch(token, entries) {
  if (!token?.center || !canvas?.interface) return;
  if (!game.settings.get("core", "scrollingStatusText")) return;

  const uiScale = canvas.dimensions?.uiScale ?? 1;
  const lineSpacing = 32 * uiScale;
  const firstLineOffset = -((entries.length - 1) * lineSpacing) / 2;

  entries.forEach(({ text, fill, direction, icon }, index) => {
    const center = {
      x: token.center.x,
      y: token.center.y + firstLineOffset + index * lineSpacing,
    };
    showActiveEffectTextEntry(center, { text, fill, direction, icon, uiScale })
      .catch((error) => debugError("FFXIV | Failed to display status text:", error));
  });
}

async function showActiveEffectTextEntry(center, { text, fill, direction, icon, uiScale }) {
  const interfaceLayer = canvas.interface;
  const CanvasAnimation = foundry.canvas.animation.CanvasAnimation;
  const container = new PIXI.Container();
  const textStyle = CONFIG.canvasTextStyle.clone();
  textStyle.fontSize = 28;
  textStyle.fill = fill;
  textStyle.stroke = 0x000000;
  textStyle.strokeThickness = 4;
  textStyle.fontWeight = "700";

  const label = new PIXI.Text(text, textStyle);
  label.anchor.set(0, 0.5);

  const iconSprite = createActiveEffectTextIcon(icon, 26);
  if (iconSprite) {
    container.addChild(iconSprite);
    label.x = 32;
  }
  container.addChild(label);
  container.pivot.set(container.width / 2, 0);
  container.position.set(center.x, center.y);
  container.alpha = 0;
  container.scale.set(0.6 * uiScale);
  container.visible = false;
  container.eventMode = "none";
  container.zIndex = CONFIG.Canvas.groups.interface.zIndexScrollingText;
  interfaceLayer.addChild(container);

  const directionTop = CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1;
  const distance = (canvas.grid?.size ?? 100) * 1.5;
  const destinationY = center.y + (direction === directionTop ? -distance : distance);

  try {
    const appeared = await CanvasAnimation.animate([
      { parent: container, attribute: "alpha", to: 1 },
      { parent: container.scale, attribute: "x", to: uiScale },
      { parent: container.scale, attribute: "y", to: uiScale },
    ], {
      context: interfaceLayer,
      duration: 300,
      easing: CanvasAnimation.easeInOutCosine,
      ontick: () => container.visible = true,
    });
    if (!appeared || container.destroyed) return;
    await CanvasAnimation.animate([
      { parent: container, attribute: "alpha", to: 0 },
      { parent: container, attribute: "y", to: destinationY },
    ], {
      context: interfaceLayer,
      duration: 900,
      easing: CanvasAnimation.easeInOutCosine,
    });
  } finally {
    if (!container.destroyed) {
      container.removeFromParent();
      container.destroy({ children: true });
    }
  }
}

function createActiveEffectTextIcon(icon, size) {
  if (!icon || typeof PIXI?.Texture?.from !== "function") return null;
  try {
    const sprite = new PIXI.Sprite(PIXI.Texture.from(icon));
    sprite.anchor.set(0, 0.5);
    sprite.width = size;
    sprite.height = size;
    return sprite;
  } catch {
    return null;
  }
}

function installActiveEffectStatusDuplicateControls() {
  if (globalThis.__ffxivActiveEffectDuplicateControlsInstalled) return;
  globalThis.__ffxivActiveEffectDuplicateControlsInstalled = true;

  const renderControls = (app, html) => {
    const effect = app?.document;
    if (!effect || effect.documentName !== "ActiveEffect") return;
    const root = getHookHTMLElement(html, app);
    if (!(root instanceof HTMLElement)) return;

    app._ffxivStatusStackObserver?.disconnect?.();
    if (app._ffxivStatusStackPoll) {
      clearInterval(app._ffxivStatusStackPoll);
      app._ffxivStatusStackPoll = null;
    }

    const decorate = () => {
      if (app._ffxivStatusStackDecorating) return;
      const statusesGroup = root.querySelector(".form-group.statuses");
      if (!(statusesGroup instanceof HTMLElement)) return;

      app._ffxivStatusStackDecorating = true;
      const tags = Array.from(
        statusesGroup.querySelectorAll(".tag[data-key]"),
      );
      for (const tag of tags) {
        const statusId = String(tag.dataset.key ?? "").trim();
        const existing = tag.querySelector(".ffxiv-status-stack-controls");
        if (!statusId || !isStackableStatusEffect(statusId)) {
          existing?.remove();
          continue;
        }

        const currentValue = `x${getEffectStatusStackCount(effect, statusId)}`;
        if (existing) {
          const valueNode = existing.querySelector(".ffxiv-status-stack-value");
          if (valueNode && valueNode.textContent !== currentValue) {
            valueNode.textContent = currentValue;
          }
          continue;
        }

        const controls = document.createElement("span");
        controls.className = "ffxiv-status-stack-controls";

        const minus = document.createElement("button");
        minus.type = "button";
        minus.className = "ffxiv-status-stack-btn";
        minus.textContent = "−";
        minus.title = game.i18n.localize("FFXIV.CharacterSheet.StackDecrease");

        const value = document.createElement("span");
        value.className = "ffxiv-status-stack-value";
        value.textContent = currentValue;

        const plus = document.createElement("button");
        plus.type = "button";
        plus.className = "ffxiv-status-stack-btn";
        plus.textContent = "+";
        plus.title = game.i18n.localize("FFXIV.CharacterSheet.StackIncrease");

        const updateCount = async (delta) => {
          const current = getEffectStatusStackCount(effect, statusId);
          const next = Math.max(1, current + delta);
          await effect.update(
            { [`flags.ffxiv.statusStacks.${statusId}`]: next },
            { render: false, ffxivStatusStackControl: true },
          );
          value.textContent = `x${next}`;
        };

        minus.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          updateCount(-1);
        });
        plus.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          updateCount(1);
        });

        controls.append(minus, value, plus);
        tag.appendChild(controls);
      }
      app._ffxivStatusStackDecorating = false;
    };

    const observer = new MutationObserver(() => {
      if (app._ffxivStatusStackDecorating) return;
      decorate();
    });
    const observeTarget = root.querySelector(".form-group.statuses") ?? root;
    observer.observe(observeTarget, { childList: true, subtree: true });
    app._ffxivStatusStackObserver = observer;

    decorate();
    queueMicrotask(() => decorate());
    requestAnimationFrame(() => decorate());
    let polls = 0;
    app._ffxivStatusStackPoll = setInterval(() => {
      decorate();
      polls += 1;
      if (polls >= 20) {
        clearInterval(app._ffxivStatusStackPoll);
        app._ffxivStatusStackPoll = null;
      }
    }, 100);
  };

  Hooks.on("renderActiveEffectConfig", renderControls);
  Hooks.on("renderActiveEffectConfigV2", renderControls);
  Hooks.on("renderDocumentSheetV2", (app, html) => {
    if (app?.constructor?.name !== "ActiveEffectConfig") return;
    renderControls(app, html);
  });
  Hooks.on("closeActiveEffectConfig", (app) => {
    if (!app) return;
    app._ffxivStatusStackObserver?.disconnect?.();
    if (app._ffxivStatusStackPoll) {
      clearInterval(app._ffxivStatusStackPoll);
      app._ffxivStatusStackPoll = null;
    }
    app._ffxivStatusStackDecorating = false;
    delete app._ffxivStatusStackObserver;
  });
}

function getEffectStatusStackCount(effect, statusId) {
  const perStatus = Number.parseInt(
    effect?.getFlag("ffxiv", `statusStacks.${statusId}`),
    10,
  );
  if (Number.isFinite(perStatus) && perStatus > 0) return perStatus;
  const legacy = Number.parseInt(effect?.getFlag("ffxiv", "stackCount"), 10);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 1;
}

function installStackableStatusEffectHudBehavior() {
  if (globalThis.__ffxivStackableStatusHudInstalled) return;
  globalThis.__ffxivStackableStatusHudInstalled = true;

  const updateHudTooltips = (actor, root) => {
    if (!(root instanceof HTMLElement)) return;
    const statusIcons = root.querySelectorAll(
      ".palette.status-effects img.effect-control[data-status-id]",
    );
    for (const icon of statusIcons) {
      const statusId = icon.dataset.statusId;
      if (!isStackableStatusEffect(statusId)) continue;
      const status = CONFIG.statusEffects?.find(
        (effect) => effect.id === statusId,
      );
      const baseTitle = game.i18n.localize(
        status?.name ?? status?.label ?? statusId ?? "",
      );
      const count = getStatusStackCount(actor, statusId);
      const title = count > 0 ? `${baseTitle} (x${count})` : baseTitle;
      icon.setAttribute("data-tooltip-text", title);
    }
  };

  Hooks.on("renderTokenHUD", (app, html) => {
    const actor =
      app?.actor ??
      app?.document?.actor ??
      app?.object?.actor ??
      app?.object?.document?.actor;
    if (!actor) return;
    const element = getHookHTMLElement(html, app);
    if (!(element instanceof HTMLElement)) return;
    updateHudTooltips(actor, element);

    app._ffxivStackStatusHudController?.abort?.();
    app._ffxivStackStatusHudController = new AbortController();
    const { signal } = app._ffxivStackStatusHudController;

    const onStatusClick = async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const icon = target.closest?.(
        ".palette.status-effects img.effect-control[data-status-id]",
      );
      if (!(icon instanceof HTMLElement)) return;

      const statusId = icon.dataset.statusId;
      const linkedGrantedEffect = actor.effects?.some((effect) => {
        const statuses = effect?.statuses;
        return (
          statuses instanceof Set &&
          statuses.has(statusId) &&
          Boolean(effect.getFlag("ffxiv", "linkedSourceEffectId"))
        );
      });
      if (linkedGrantedEffect) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        ui.notifications.warn(
          game.i18n.localize("FFXIV.Notifications.ActorEffectFromItemLocked"),
        );
        return;
      }
      if (!isStackableStatusEffect(statusId)) return;

      // Override core toggle behavior for stackable statuses.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!actor) {
        ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true });
        return;
      }

      if (event.type === "contextmenu") return;
      const isRightClick = event.type === "auxclick" && event.button === 2;
      const delta = isRightClick ? -1 : 1;
      await applyStatusEffectStackDelta(actor, statusId, delta);
      await app.render({ force: true });
    };

    element.addEventListener("click", onStatusClick, { capture: true, signal });
    element.addEventListener("auxclick", onStatusClick, {
      capture: true,
      signal,
    });
    element.addEventListener("contextmenu", onStatusClick, {
      capture: true,
      signal,
    });
  });
}

function installGlobalArtworkRotationLock() {
  if (globalThis.__ffxivGlobalArtworkRotationLockInstalled) return;
  globalThis.__ffxivGlobalArtworkRotationLockInstalled = true;

  Hooks.on("preCreateToken", (tokenDocument, data) => {
    if (!game.settings.get("ffxiv", "lockArtworkRotationGlobal")) return;
    if (foundry.utils.getProperty(data, "lockRotation") === true) return;
    tokenDocument.updateSource({ lockRotation: true });
  });
}

function installEncounterActorPlacement() {
  if (globalThis.__ffxivEncounterActorPlacementInstalled) return;
  globalThis.__ffxivEncounterActorPlacementInstalled = true;

  Hooks.on("dropCanvasData", (_canvas, data) => {
    if (data?.type !== "Actor" || !data.uuid) return;
    if (data.ffxivEncounterMember === true) {
      placeEncounterMemberFromDrop(data).catch((error) => {
        debugError("FFXIV | Encounter member placement failed:", error);
        ui.notifications.error(game.i18n.localize("FFXIV.Encounter.PlacementFailed"));
      });
      return false;
    }
    const actor = fromUuidSync(data.uuid);
    if (actor?.documentName !== "Actor" || actor.type !== "encounter") return;
    placeEncounterActor(actor, data).catch((error) => {
      debugError("FFXIV | Encounter placement failed:", error);
      ui.notifications.error(game.i18n.localize("FFXIV.Encounter.PlacementFailed"));
    });
    return false;
  });
}

async function placeEncounterMemberFromDrop(position) {
  const actor = await fromUuid(position.uuid);
  if (actor?.documentName !== "Actor" || actor.type === "encounter") return;
  await placeEncounterMember(actor, position);
}

async function placeEncounterMember(actor, position) {
  const scene = canvas.scene;
  if (!scene) return;

  const token = await actor.getTokenDocument({ hidden: Boolean(position.hidden) });
  const gridSizeX = canvas.grid.sizeX || canvas.grid.size;
  const gridSizeY = canvas.grid.sizeY || canvas.grid.size;
  const tokenData = token.toObject();
  const x = Number(position.x);
  const y = Number(position.y);
  delete tokenData._id;
  if (Number.isFinite(x)) tokenData.x = Math.round(x / gridSizeX) * gridSizeX;
  if (Number.isFinite(y)) tokenData.y = Math.round(y / gridSizeY) * gridSizeY;
  if (Number.isFinite(position.elevation)) tokenData.elevation = position.elevation;

  await scene.createEmbeddedDocuments("Token", [tokenData]);
}

async function placeEncounterActor(encounter, position) {
  const scene = canvas.scene;
  if (!scene) return;

  const actors = [];
  const members = encounter.system.members ?? [];
  const actorsByUuid = new Map(
    await Promise.all(
      [...new Set(members.map((member) => member.uuid).filter(Boolean))]
        .map(async (uuid) => [uuid, await fromUuid(uuid)]),
    ),
  );
  for (const member of members) {
    const actor = actorsByUuid.get(member.uuid);
    if (actor?.documentName !== "Actor" || actor.type === "encounter") continue;
    const quantity = Math.max(1, Number.parseInt(member.quantity, 10) || 1);
    for (let index = 0; index < quantity; index++) actors.push(actor);
  }

  if (!actors.length) {
    ui.notifications.warn(game.i18n.localize("FFXIV.Encounter.EmptyPlacement"));
    return;
  }

  const tokenDocuments = await Promise.all(
    actors.map((actor) => actor.getTokenDocument({ hidden: encounter.system.spawn_hidden })),
  );
  const gridSizeX = canvas.grid.sizeX || canvas.grid.size;
  const gridSizeY = canvas.grid.sizeY || canvas.grid.size;
  const cellWidth = Math.max(
    gridSizeX,
    ...tokenDocuments.map((token) => (Number(token.width) || 1) * gridSizeX),
  );
  const cellHeight = Math.max(
    gridSizeY,
    ...tokenDocuments.map((token) => (Number(token.height) || 1) * gridSizeY),
  );
  const columns = Math.ceil(Math.sqrt(tokenDocuments.length));
  const rows = Math.ceil(tokenDocuments.length / columns);
  const originX = Number(position.x) - ((columns - 1) * cellWidth) / 2;
  const originY = Number(position.y) - ((rows - 1) * cellHeight) / 2;

  const tokenData = tokenDocuments.map((token, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const data = token.toObject();
    delete data._id;
    data.x = Math.round((originX + column * cellWidth) / gridSizeX) * gridSizeX;
    data.y = Math.round((originY + row * cellHeight) / gridSizeY) * gridSizeY;
    if (Number.isFinite(position.elevation)) data.elevation = position.elevation;
    return data;
  });

  await scene.createEmbeddedDocuments("Token", tokenData);
  ui.notifications.info(
    game.i18n.format("FFXIV.Encounter.Placed", {
      count: tokenData.length,
      name: encounter.name,
    }),
  );
}

async function applyGlobalArtworkRotationLock() {
  if (!game.user?.isGM) return;
  if (!game.settings.get("ffxiv", "lockArtworkRotationGlobal")) return;

  const actorUpdates = game.actors
    .filter((actor) => actor?.prototypeToken?.lockRotation !== true)
    .map((actor) => ({
      _id: actor.id,
      "prototypeToken.lockRotation": true,
    }));

  if (actorUpdates.length) {
    await Actor.updateDocuments(actorUpdates);
  }

  for (const scene of game.scenes) {
    const tokenUpdates = scene.tokens
      .filter((token) => token?.lockRotation !== true)
      .map((token) => ({
        _id: token.id,
        lockRotation: true,
      }));
    if (tokenUpdates.length) {
      await scene.updateEmbeddedDocuments("Token", tokenUpdates);
    }
  }
}

function installItemCreateTypeFilter() {
  if (globalThis.__ffxivItemCreateTypeFilterInstalled) return;
  globalThis.__ffxivItemCreateTypeFilterInstalled = true;

  const stripLegacyTypeOptions = (root) => {
    if (!root) return;
    const typeSelect = root.querySelector?.("select[name='type']");
    if (!typeSelect) return;

    // Only touch selects that clearly look like Item type selectors.
    const values = new Set(
      Array.from(typeSelect.options).map((option) => String(option.value)),
    );
    if (!values.has("ability")) return;
    if (![...LEGACY_ABILITY_TYPES].some((type) => values.has(type))) return;

    for (const option of Array.from(typeSelect.options)) {
      if (LEGACY_ABILITY_TYPES.has(option.value)) option.remove();
      if (HIDDEN_ITEM_CREATE_TYPES.has(option.value)) option.remove();
    }

    if (LEGACY_ABILITY_TYPES.has(typeSelect.value)) {
      typeSelect.value = "ability";
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (HIDDEN_ITEM_CREATE_TYPES.has(typeSelect.value)) {
      typeSelect.value = "ability";
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const filterLegacyTypes = (app, element) => {
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    stripLegacyTypeOptions(root);

    // Some dialogs repopulate form fields post-render; keep it clean.
    if (!root._ffxivTypeFilterObserver) {
      const observer = new MutationObserver(() => stripLegacyTypeOptions(root));
      observer.observe(root, { childList: true, subtree: true });
      root._ffxivTypeFilterObserver = observer;
    }
  };

  Hooks.on("renderApplicationV2", filterLegacyTypes);
  Hooks.on("renderDialogV2", filterLegacyTypes);
  Hooks.on("renderDialog", filterLegacyTypes);
}

function installItemDirectoryCompatibilityPatch() {
  const DirectoryClass = foundry?.applications?.sidebar?.tabs?.ItemDirectory;
  if (!DirectoryClass?.prototype?._onClickEntry) return;
  if (DirectoryClass.prototype._ffxivCollectionCompatPatched) return;

  const originalOnClickEntry = DirectoryClass.prototype._onClickEntry;
  const originalGetEntryContextOptions =
    DirectoryClass.prototype._getEntryContextOptions;
  DirectoryClass.prototype._onClickEntry =
    async function patchedItemDirectoryOnClickEntry(event, ...args) {
      const collection = this.collection;
      const entryElement =
        event?.currentTarget?.closest?.("[data-entry-id]") ??
        event?.target?.closest?.("[data-entry-id]");
      const entryId = entryElement?.dataset?.entryId;
      const hasGetDocument = typeof collection?.getDocument === "function";
      const hasGet = typeof collection?.get === "function";

      // Safety guard: if core cannot resolve this entry to a document, skip hard-crash and warn.
      if (entryId && !hasGetDocument && hasGet) {
        const doc = collection.get(entryId);
        if (!doc?.sheet) {
          ui.notifications?.warn(
            "This item entry could not be opened because its document is unavailable.",
          );
          return;
        }
      } else if (entryId && hasGetDocument) {
        const resolved = await collection.getDocument(entryId);
        if (!resolved?.sheet) {
          ui.notifications?.warn(
            "This item entry could not be opened because its document is unavailable.",
          );
          return;
        }
      }
      return originalOnClickEntry.call(this, event, ...args);
    };
  if (typeof originalGetEntryContextOptions === "function") {
    DirectoryClass.prototype._getEntryContextOptions =
      function patchedItemDirectoryContextOptions(...args) {
        const options =
          originalGetEntryContextOptions.call(this, ...args) || [];
        return options.map((option) => {
          if (typeof option?.visible !== "function") return option;
          const originalVisible = option.visible;
          return {
            ...option,
            visible: (...visibleArgs) => {
              try {
                return originalVisible(...visibleArgs);
              } catch (error) {
                debugError(
                  "FFXIV | Item directory context visibility guard:",
                  error,
                );
                return false;
              }
            },
          };
        });
      };
  }
  DirectoryClass.prototype._ffxivCollectionCompatPatched = true;
}

/* -------------------------------------------- */
/*  Render Actor Sheet Hook                     */
/* -------------------------------------------- */

let isDraggingItem = false;
Hooks.on("renderActorSheet", async (app) => {
  if (app instanceof FFXIVActorSheet) return;
  const actor = app.actor;
  const isOwner = actor.testUserPermission(
    game.user,
    CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
  );
  if (isDraggingItem && !isOwner) return;
  const items = actor.items.contents;

  const occupiedPositions = new Set();
  const itemsToUpdate = [];

  items.forEach((item) => {
    if (FFXIV.inventory_items.indexOf(item.type) > -1) {
      const position = Number(item.system.position) || 0;
      if (occupiedPositions.has(position) || position === 0) {
        itemsToUpdate.push(item);
      } else {
        occupiedPositions.add(position);
      }
    }
  });

  let nextFreePosition = 1;
  itemsToUpdate.forEach((item) => {
    if (CONFIG.FFXIV.inventory_items.indexOf(item.type) > -1) {
      while (occupiedPositions.has(nextFreePosition)) {
        nextFreePosition++;
      }

      item.update({ "system.position": nextFreePosition });
      occupiedPositions.add(nextFreePosition); // Mark the new position as occupied
    }
  });

  if (itemsToUpdate.length > 0) {
    app.render();
  }
});

let draggedItem = null;

Hooks.on("renderActorSheet", (app, html) => {
  if (app instanceof FFXIVActorSheet) return;
  const actor = app.actor;
  const isOwner = actor.testUserPermission(
    game.user,
    CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
  );
  if (!isOwner) return;

  html.find(".inventory-item").off("dragstart drop dragover");

  html.find(".inventory-item").on("dragstart", (event) => {
    debugLog("Drag started:", event.currentTarget.dataset.itemId);
    draggedItem = {
      id: event.currentTarget.dataset.itemId,
      position: event.currentTarget.dataset.itemPosition,
    };
    isDraggingItem = true;
    const dragGhost = event.currentTarget.cloneNode(true);
    dragGhost.querySelector(".item-tooltip").style.display = "none";
    dragGhost.querySelector(".item-quantity").style.display = "none";

    dragGhost.style.position = "absolute";
    dragGhost.style.top = "-1000px";
    document.body.appendChild(dragGhost);

    event.originalEvent.dataTransfer.setDragImage(dragGhost, 0, 0);

    setTimeout(() => {
      document.body.removeChild(dragGhost);
    }, 0);

    const item = actor.items.get(event.currentTarget.dataset.itemId);
    event.originalEvent.dataTransfer.setData(
      "text/plain",
      JSON.stringify({
        type: "Item",
        uuid: item.uuid,
      }),
    );
  });

  html.find(".inventory-item").on("dragover", (event) => {
    debugLog("Drag over:", event.currentTarget.dataset.itemId || "empty slot");
  });

  html.find(".inventory-item").on("drop", async (event) => {
    event.preventDefault();
    debugLog(event);

    const targetPosition = event.currentTarget.dataset.itemPosition;

    debugLog("Dropped on:", targetPosition || "empty slot");

    const targetItemId = event.currentTarget.dataset.itemId;

    const draggedItemData = actor.items.get(draggedItem.id);

    if (targetItemId) {
      const targetItemData = actor.items.get(targetItemId);
      await draggedItemData.update({ "system.position": targetPosition });
      await targetItemData.update({ "system.position": draggedItem.position });
    } else {
      await draggedItemData.update({ "system.position": targetPosition });
    }

    playConfiguredSound("soundNotificationFFXIV_moveItem");

    app.render();
  });
});

Hooks.on("preCreateItem", (itemData) => {
  if (!itemData.img || itemData.img === "icons/svg/item-bag.svg") {
    const defaultImages = {};
    const defaultImg = defaultImages[itemData.type] || "icons/svg/item-bag.svg";
    itemData.updateSource({ img: defaultImg });
  }
});

Hooks.on("userConnected", (player, login) => {
  if (login && !game.paused) {
    ui.notifications.info(
      game.i18n.format("FFXIV.Notifications.NewPlayer", {
        playerName: player.name,
      }),
    );
    playConfiguredSound("soundNotificationFFXIV_enterChat");
  }
});

Hooks.on("renderActorSheet", (app, html) => {
  if (app instanceof FFXIVActorSheet) return;
  playConfiguredSound("soundNotificationFFXIV_openSheet");
  const actorSheet = app.actor.sheet;
  html.on(
    "click",
    ".abilities-sub-tabs .sub-tab",
    actorSheet._displayAbilityTab.bind(actorSheet),
  );
  html.on(
    "click",
    ".companions-sub-tabs .companions-sub-tab",
    actorSheet._displayCompanionTab.bind(actorSheet),
  );
});

Hooks.on("updateItem", (item, changes, options) => {
  if (options?.ffxivSkipActorSheetRefresh) return;
  const fields = Object.keys(foundry.utils.flattenObject(changes))
    .filter(key => key !== "_id" && key !== "_stats" && !key.startsWith("_stats."));
  if (!fields.length) return;
  const markersOnly = fields.every(key =>
    key === "system.markers" || key.startsWith("system.markers.")
    || key === "system.marker" || key.startsWith("system.marker."),
  );
  refreshOwnedItemActorSheets(item, { preserveTopWindow: true, markersOnly }).catch((err) =>
    debugError("FFXIV | Failed to refresh actor sheet after item update", err),
  );
});

Hooks.on("closeItemSheet", (app) => {
  refreshOwnedItemActorSheets(app?.item, { markersOnly: true }).catch((err) =>
    debugError(
      "FFXIV | Failed to refresh actor sheet after item sheet close",
      err,
    ),
  );
});

async function refreshOwnedItemActorSheets(
  item,
  { preserveTopWindow = false, markersOnly = false } = {},
) {
  if (!item?.parent || item.parent.documentName !== "Actor") return;

  const sheets = new Set();
  if (item.parent.sheet?.rendered) sheets.add(item.parent.sheet);
  for (const sheet of Object.values(ui.windows)) {
    if (
      sheet instanceof FFXIVActorSheet &&
      sheet.actor?.id === item.parent.id &&
      sheet.rendered
    ) {
      sheets.add(sheet);
    }
  }
  if (!sheets.size) return;

  const restoreTopWindow = preserveTopWindow ? captureTopWindowRestore() : null;
  for (const sheet of sheets) {
    if (
      sheet instanceof FFXIVActorSheet &&
      typeof sheet._captureSheetScroll === "function"
    ) {
      sheet._captureSheetScroll();
    }
  }

  for (const sheet of sheets) {
    if (markersOnly && sheet instanceof FFXIVActorSheet && sheet.actor.type === "npc" && item.type === "ability") {
      await sheet._refreshAbilityMarkerPreview(item);
    } else {
      await sheet.render({ force: true, focus: false });
    }
  }

  for (const sheet of sheets) {
    if (
      sheet instanceof FFXIVActorSheet &&
      typeof sheet._restoreSheetScroll === "function"
    ) {
      sheet._restoreSheetScroll();
    }
  }

  restoreTopWindow?.();
}

function captureTopWindowRestore() {
  const topElement = getTopApplicationElement();
  if (!topElement) return null;

  return () => {
    if (!document.body.contains(topElement)) return;
    const highestZIndex = getApplicationElements().reduce(
      (highest, element) => Math.max(highest, getZIndex(element)),
      0,
    );
    topElement.style.zIndex = String(highestZIndex + 1);
  };
}

function getTopApplicationElement() {
  return (
    getApplicationElements().sort((a, b) => getZIndex(b) - getZIndex(a))[0] ??
    null
  );
}

function getApplicationElements() {
  const apps = [
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications.instances?.values?.() ?? []),
  ];

  return [...new Set(apps)]
    .map(getApplicationElement)
    .filter((element) => element && document.body.contains(element));
}

function getApplicationElement(app) {
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  if (app?.id) return document.getElementById(app.id);
  if (Number.isFinite(app?.appId))
    return document.querySelector(`[data-appid="${app.appId}"]`);
  return null;
}

function getZIndex(element) {
  const zIndex = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex : 0;
}

Hooks.on("closeActorSheet", (hookEvent) => {
  if (hookEvent instanceof FFXIVActorSheet) return;
  playConfiguredSound("soundNotificationFFXIV_closeSheet");
});

Hooks.on("renderChatLog", (app, html) => {
  applyFFXIVChatTheme(html);
  applyFFXIVChatTheme(document.querySelector("section#chat.sidebar-tab"));
});

Hooks.on("renderTokenHUD", (app, html) => {
  const tokenDocument = app.document ?? app.object?.document;
  if (!["character", "npc"].includes(tokenDocument?.actor?.type)) return;

  const element = getHookHTMLElement(html, app);
  if (!element) return;

  const barRows = {};
  for (const barName of ["bar1", "bar2"]) {
    const attribute = tokenDocument[barName]?.attribute;
    const input = element.querySelector(`input[name="${barName}"]`);
    const row = input?.closest(".attribute") ?? null;
    if (input && ["health", "barrier"].includes(attribute)) {
      input.disabled = false;
      input.removeAttribute("disabled");
      input.classList.toggle("ffxiv-barrier-input", attribute === "barrier");
      if (attribute === "health") {
        input.title = game.i18n.localize("FFXIV.Health.abbrv");
      } else if (attribute === "barrier") {
        input.title = game.i18n.localize("FFXIV.Health.barrier");
      }
    }
    if (row && attribute) barRows[attribute] = row;
  }

  if (tokenDocument.actor?.type !== "character") {
    element.querySelector(".attribute.ffxiv-mana-hud")?.remove();
    return;
  }

  const barsContainer =
    barRows.health?.parentElement ??
    barRows.barrier?.parentElement ??
    element.querySelector(".col.right") ??
    element;

  if (barRows.health) barRows.health.classList.add("ffxiv-hud-health");
  if (barRows.barrier) barRows.barrier.classList.add("ffxiv-hud-barrier");

  if (barRows.health) barsContainer.appendChild(barRows.health);

  let manaRow = barsContainer.querySelector(".attribute.ffxiv-mana-hud");
  if (!manaRow) {
    manaRow = document.createElement("div");
    manaRow.classList.add("attribute", "ffxiv-mana-hud");
    manaRow.innerHTML = `<input type="text" class="ffxiv-mana-input" name="ffxiv-mana" inputmode="numeric" title="MP">`;
  }

  const manaInput = manaRow.querySelector("input[name='ffxiv-mana']");
  if (manaInput) {
    const manaValue = Number(tokenDocument.actor?.system?.mana?.value ?? 0);
    const manaMax = Math.max(
      0,
      Number(tokenDocument.actor?.system?.mana?.max ?? 5) || 5,
    );
    manaInput.value = String(Math.max(0, manaValue));
    manaInput.disabled = false;
    manaInput.removeAttribute("disabled");

    if (!manaInput.dataset.ffxivBound) {
      manaInput.dataset.ffxivBound = "true";
      const applyMana = async () => {
        const raw = String(manaInput.value ?? "").trim();
        const current = Number(tokenDocument.actor?.system?.mana?.value ?? 0);
        let next = current;
        if (/^[+-]\d+$/.test(raw)) {
          next = current + Number(raw);
        } else {
          const parsed = Number(raw);
          next = Number.isFinite(parsed) ? parsed : current;
        }
        const manaCap = Math.max(
          0,
          Number(tokenDocument.actor?.system?.mana?.max ?? 5) || 5,
        );
        const nextValue = Math.max(
          0,
          Math.min(next, Math.max(manaCap, current)),
        );
        manaInput.value = String(nextValue);
        if (nextValue === current) return;
        await tokenDocument.actor.update(
          { "system.mana.value": nextValue },
          { render: false },
        );
        refreshActorTokenBars(tokenDocument.actor);
      };

      manaInput.addEventListener("change", () => {
        void applyMana();
      });
      manaInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        manaInput.blur();
      });
      manaInput.addEventListener("blur", () => {
        void applyMana();
      });
    }
  }

  let secondaryRow = barsContainer.querySelector(".ffxiv-hud-secondary-row");
  if (!secondaryRow) {
    secondaryRow = document.createElement("div");
    secondaryRow.classList.add("ffxiv-hud-secondary-row");
  }

  if (barRows.barrier) secondaryRow.appendChild(barRows.barrier);
  secondaryRow.appendChild(manaRow);
  barsContainer.appendChild(secondaryRow);
});

Hooks.on("updateActor", (actor, changes) => {
  if (!["character", "npc"].includes(actor?.type)) return;
  const resourceChanged =
    foundry.utils.hasProperty(changes, "system.health.value") ||
    foundry.utils.hasProperty(changes, "system.health.max") ||
    foundry.utils.hasProperty(changes, "system.barrier.value") ||
    foundry.utils.hasProperty(changes, "system.barrier.max") ||
    foundry.utils.hasProperty(changes, "system.mana.value") ||
    foundry.utils.hasProperty(changes, "system.mana.max");
  if (!resourceChanged) return;
  refreshActorTokenBars(actor);
});

registerMarkerHooks();

const ELITE_FOE_EFFECT_FLAG = "eliteFoeEffect";
const ELITE_FOE_EFFECT_ICON = "systems/ffxiv/assets/effects/large_enemy.webp";

async function syncEliteFoeEffects() {
  if (!game.user?.isGM) return;
  for (const actor of game.actors ?? []) {
    await syncEliteFoeEffect(actor);
  }
  for (const token of canvas?.tokens?.placeables ?? []) {
    await syncEliteFoeEffect(token.actor);
  }
}

async function syncEliteFoeEffect(actor) {
  if (!game.user?.isGM) return;
  if (actor?.documentName !== "Actor" || actor.type !== "npc") return;

  const effects = getEliteFoeEffects(actor);
  if (actor.system?.elite_foe === true) {
    if (!effects.length) {
      await createEliteFoeEffect(actor);
      return;
    }
    const primary = effects[0];
    const label = game.i18n.localize("FFXIV.CharacterSheet.EliteFoe");
    const updates = {};
    if (primary.name !== label) updates.name = label;
    if (primary.img !== ELITE_FOE_EFFECT_ICON) updates.img = ELITE_FOE_EFFECT_ICON;
    if (primary.icon !== ELITE_FOE_EFFECT_ICON) updates.icon = ELITE_FOE_EFFECT_ICON;
    if (primary.disabled) updates.disabled = false;
    if (primary.origin !== actor.uuid) updates.origin = actor.uuid;
    if (primary.transfer !== false) updates.transfer = false;
    if (primary.displayStatusIcon !== true) updates.displayStatusIcon = true;
    if (primary.showIcon !== (CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2)) {
      updates.showIcon = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    }
    if (primary.getFlag("ffxiv", ELITE_FOE_EFFECT_FLAG) !== true) {
      updates[`flags.ffxiv.${ELITE_FOE_EFFECT_FLAG}`] = true;
    }
    if (Object.keys(updates).length) {
      await primary.update(updates, {
        render: false,
        ffxivSyncEliteFoeEffect: true,
      });
    }
    const duplicates = effects.slice(1).map((effect) => effect.id).filter(Boolean);
    if (duplicates.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", duplicates, {
        render: false,
        ffxivSyncEliteFoeEffect: true,
      });
    }
    return;
  }

  const ids = effects.map((effect) => effect.id).filter(Boolean);
  if (ids.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {
      render: false,
      ffxivSyncEliteFoeEffect: true,
    });
  }
}

function getEliteFoeEffects(actor) {
  return Array.from(actor?.effects ?? []).filter((effect) =>
    effect?.getFlag("ffxiv", ELITE_FOE_EFFECT_FLAG) === true,
  );
}

async function createEliteFoeEffect(actor) {
  const label = game.i18n.localize("FFXIV.CharacterSheet.EliteFoe");
  const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [
      {
        name: label,
        img: ELITE_FOE_EFFECT_ICON,
        icon: ELITE_FOE_EFFECT_ICON,
        origin: actor.uuid,
        disabled: false,
        transfer: false,
        displayStatusIcon: true,
        showIcon: showAlways,
        duration: {},
        flags: {
          ffxiv: {
            [ELITE_FOE_EFFECT_FLAG]: true,
          },
        },
      },
    ],
    { render: false, ffxivSyncEliteFoeEffect: true },
  );
}

registerSystemSocketHooks();

registerChatMessageCreation();

Hooks.on("canvasReady", () => {
  try {
    if (!canvas?.interface || typeof canvas.interface.createScrollingText !== "function") return;
    if (canvas.interface.__ffxivCreateScrollingTextWrapped) return;
    const originalCreateScrollingText = canvas.interface.createScrollingText.bind(canvas.interface);
    canvas.interface.createScrollingText = (center, text, options = {}) => {
      try {
        const textValue = String(text ?? "");
        if (shouldSuppressDefaultStatusText(textValue)) return Promise.resolve();
      } catch (err) {
        // fall through to original
      }
      return originalCreateScrollingText(center, text, options);
    };
    canvas.interface.__ffxivCreateScrollingTextWrapped = true;
  } catch (err) {
    // This is a best effort attempt to suppress default status effect scrolling text, but it may not work in all versions of Foundry
    // or with all modules that modify the canvas interface. If it fails, it will simply fall back to the original behavior without breaking anything.
    // Hopefully. :')
  }
});

registerChatMessageRendering();
