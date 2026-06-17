// Import document classes.
import { FFXIVActor } from "./actors/actor.mjs";
import { FFXIVCombat, getTurnStep } from "./combat.mjs";
import { FFXIVItem } from "./items/item.mjs";
import { registerDataModels } from "./data-models.mjs";
// Import sheet classes.
import { FFXIVActorSheet } from "./actors/actor-sheet.mjs";
import { FFXIVItemSheet } from "./items/item-sheet.mjs";
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from "./helpers/templates.mjs";
import { FFXIV } from "./helpers/config.mjs";
import { debugError, debugLog } from "./helpers/debug.mjs";
import {
  activateLimitBreakGauge,
  deactivateLimitBreakGauge,
  getLimitBreakMax,
  getLimitBreakValue,
  initLimitBreakHud,
  isLimitBreakActive,
} from "./helpers/limit-break-hud.mjs";

import { SettingsHelpers } from "./helpers/settings.mjs";
import {
  applyStatusEffectChange,
  applyStatusEffectStackDelta,
  applyStatusEffectStackValue,
  getActorDrainValue,
  getStatusStackCount,
  getStatusStackValue,
  hasStatus,
  isEliteFoeBlockedStatus,
  isNegativeStatusEffect,
  isAdditiveStackableStatusEffect,
  isStackableStatusEffect,
  migrateLegacyStatusStackEffects,
  recoverActorHealth,
  recoverActorMana,
  removeEnmityInflictedByActor,
  updateStatusEffects,
} from "./helpers/status-effects.mjs";
import { registerEscapeHandler } from "./helpers/escape.mjs";
import {
  formatShopTierDisplay,
  normalizeShopTier,
} from "./helpers/shop-tier.mjs";
import {
  ABILITY_SUBTYPE_TYPES,
  getAbilitySubtype,
  ensureAbilitySubtypeTags,
  canonicalizeBakedTag,
  canonicalizeBakedTags,
} from "./helpers/ability-subtype.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once("init", function () {
  registerDataModels();
  SettingsHelpers.initSettings();
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.ffxivttrpg = {
    FFXIVActor,
    FFXIVItem,
    runItemMigration: async (force = false) =>
      migrateItemDataStructure({ force }),
    applyGlobalArtworkRotationLock: async () =>
      applyGlobalArtworkRotationLock(),
  };

  // Add custom constants for configuration.
  CONFIG.FFXIV = FFXIV;

  // Define custom Document classes
  CONFIG.Actor.documentClass = FFXIVActor;
  CONFIG.Combat.documentClass = FFXIVCombat;
  CONFIG.Item.documentClass = FFXIVItem;

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
    types: ["character", "pet", "npc"],
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
    pet: game.i18n.localize("FFXIV.ActorType.pet"),
  };

  updateStatusEffects();
  registerEscapeHandler();

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

Hooks.on("preCreateActiveEffect", (effect) => {
  const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
  if (!actor) return;
  applyLinkedTraitDataToActiveEffectSource(effect, actor);
  const statuses = Array.from(effect.statuses ?? effect._source?.statuses ?? []);
  if (
    hasStatus(actor, "knocked_out") &&
    statuses.some((statusId) => !KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS.has(statusId))
  )
    return false;
  if (statuses.some((statusId) => isEliteFoeBlockedStatus(actor, statusId)))
    return false;
});

Hooks.on("preUpdateActiveEffect", (effect, changes, options) => {
  if (options?.ffxivSyncEliteFoeEffect) return;
  if (effect?.parent?.documentName !== "Actor") return;
  if (
    foundry.utils.hasProperty(changes, "statuses") &&
    hasStatus(effect.parent, "knocked_out")
  ) {
    const statuses = Array.from(changes.statuses ?? []);
    if (statuses.some((statusId) => !KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS.has(statusId)))
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
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

Handlebars.registerHelper("toLowerCase", function (str) {
  return str.toLowerCase();
});

Handlebars.registerHelper("range", function (end) {
  return Array.from({ length: end }, (_, i) => i + 1);
});

Handlebars.registerHelper("isOccupied", function (items, position) {
  return items.some((item) => item.system.position == position);
});

Handlebars.registerHelper("add", function (a, b) {
  const left = Number(a);
  const right = Number(b);
  return (
    (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0)
  );
});
Handlebars.registerHelper("sub", function (a, b) {
  const left = Number(a);
  const right = Number(b);
  return (
    (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)
  );
});
Handlebars.registerHelper("eq", function (a, b) {
  return a === b;
});
Handlebars.registerHelper("not", function (a) {
  return !a;
});
Handlebars.registerHelper("or", function (a, b) {
  return a || b;
});
Handlebars.registerHelper("and", function (a, b) {
  return a && b;
});
Handlebars.registerHelper("hasContent", function (value) {
  if (value === null || value === undefined) return false;
  const text = String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text.length > 0;
});

Handlebars.registerHelper(
  "shopTierDisplay",
  function (systemOrTier, maybeCustom) {
    if (
      systemOrTier &&
      typeof systemOrTier === "object" &&
      !Array.isArray(systemOrTier)
    ) {
      return formatShopTierDisplay(
        systemOrTier.shop_tier,
        systemOrTier.shop_tier_custom,
        game.i18n,
      );
    }
    return formatShopTierDisplay(systemOrTier, maybeCustom, game.i18n);
  },
);

Handlebars.registerHelper("hasShopTier", function (systemOrTier, maybeCustom) {
  return Boolean(Handlebars.helpers.shopTierDisplay(systemOrTier, maybeCustom));
});

function normalizeRarityValue(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  const aliasMap = {
    1: "basic",
    2: "green",
    3: "aetherial",
    4: "blue",
    5: "relic",
    6: "unique",
    basic: "basic",
    common: "basic",
    green: "green",
    uncommon: "green",
    aetherial: "aetherial",
    pink: "aetherial",
    blue: "blue",
    rare: "blue",
    relic: "relic",
    epic: "relic",
    unique: "unique",
    legendary: "unique",
  };
  return aliasMap[normalized] ?? "";
}

Handlebars.registerHelper("rarityTextClass", function (rarity) {
  const key = normalizeRarityValue(rarity);
  return key ? `text-rarity-${key}` : "";
});

Handlebars.registerHelper("rarityTooltipClass", function (rarity) {
  const key = normalizeRarityValue(rarity);
  return key ? `rarity-${key}` : "";
});

Handlebars.registerHelper("itemQualityLabelKey", function (system) {
  return normalizeRarityValue(system?.rarity ?? "")
    ? "FFXIV.Item.Rarity"
    : "FFXIV.Item.ShopTier";
});

Handlebars.registerHelper("itemQualityDisplay", function (system) {
  const rarity = normalizeRarityValue(system?.rarity);
  if (rarity)
    return game.i18n.localize(
      `FFXIV.Rarities.${rarity.charAt(0).toUpperCase()}${rarity.slice(1)}`,
    );
  return formatShopTierDisplay(
    system?.shop_tier,
    system?.shop_tier_custom,
    game.i18n,
  );
});

Handlebars.registerHelper("hasItemQuality", function (system) {
  return Boolean(Handlebars.helpers.itemQualityDisplay(system));
});

const BAKED_ACTION_TAG_LABELS = {
  primary_ability: "FFXIV.Tags.Primary",
  secondary_ability: "FFXIV.Tags.Secondary",
  instant_ability: "FFXIV.Tags.Instant",
  limit_break: "FFXIV.ItemType.limit_break",
};
const BAKED_ACTION_TAGS = new Set([
  "primary",
  "secondary",
  "instant",
  "limit break",
  "limit-break",
  "ffxiv.tags.primary",
  "ffxiv.tags.secondary",
  "ffxiv.tags.instant",
  "ffxiv.itemtype.limit_break",
]);

function localizeTag(tag) {
  const text = String(tag ?? "");
  return globalThis.game?.i18n?.localize(text) ?? text;
}

function normalizeActionTag(tag) {
  return String(tag ?? "")
    .trim()
    .toLowerCase();
}

function isBakedActionTag(tag) {
  return [tag, localizeTag(tag)].some((value) =>
    BAKED_ACTION_TAGS.has(normalizeActionTag(value)),
  );
}

Handlebars.registerHelper("actionTags", function (type, tags) {
  const effectiveType =
    type === "ability" ? getAbilitySubtype({ type, system: { tags } }) : type;
  const bakedTag = BAKED_ACTION_TAG_LABELS[effectiveType];
  const customTags = Array.isArray(tags)
    ? tags.filter((tag) => !isBakedActionTag(tag))
    : [];
  return bakedTag ? [bakedTag, ...customTags] : customTags;
});

Handlebars.registerHelper("customActionTags", function (tags) {
  return Array.isArray(tags)
    ? tags.filter((tag) => tag && !isBakedActionTag(tag))
    : [];
});

Handlebars.registerHelper("hasCustomActionTags", function (tags) {
  return Array.isArray(tags) && tags.some((tag) => tag && !isBakedActionTag(tag));
});

Handlebars.registerHelper("traitCardTags", function (system) {
  const tags = Handlebars.helpers.customActionTags(system?.tags);
  if (Number(system?.job_resources_max ?? 0) > 0) {
    tags.push("FFXIV.Abilities.JobResource");
  }
  return tags;
});

Handlebars.registerHelper("bakedActionTag", function (type) {
  return BAKED_ACTION_TAG_LABELS[type] ?? "";
});

Handlebars.registerHelper("eqTag", function (left, right) {
  return normalizeTagValue(left) === normalizeTagValue(right);
});

Handlebars.registerHelper("isAbilitySubtype", function (item, subtype) {
  return getAbilitySubtype(item) === subtype;
});
Handlebars.registerHelper("superior", function (a, b) {
  return a > b;
});
Handlebars.registerHelper("inferior", function (a, b) {
  return a < b;
});
Handlebars.registerHelper("mod", function (index, divisor, remainder) {
  if (arguments.length === 3) {
    return index % divisor === 0;
  } else if (arguments.length === 4) {
    return index % divisor === remainder;
  }
});
Handlebars.registerHelper("array", function () {
  return Array.from(arguments).slice(0, arguments.length - 1);
});

const DEFAULT_TAB_ICONS = {
  imgTabAbilities: "systems/ffxiv/assets/tab-icons/actions-and-traits.webp",
  imgTabAttributes: "systems/ffxiv/assets/tab-icons/pvp-profile.webp",
  imgTabGear: "systems/ffxiv/assets/tab-icons/armoury-chest.webp",
  imgTabRoleplay: "systems/ffxiv/assets/tab-icons/character.webp",
  imgTabItems: "systems/ffxiv/assets/tab-icons/inventory.webp",
  imgTabCompanions: "systems/ffxiv/assets/tab-icons/companions.webp",
  imgTabSettings: "systems/ffxiv/assets/tab-icons/system-configuration.webp",
};
const LEGACY_ABILITY_TYPES = new Set([
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
]);
const HIDDEN_ITEM_CREATE_TYPES = new Set(["currency"]);

function getCharacterTabIcon(settingKey) {
  const configured = game.settings.get("ffxiv", settingKey);
  if (typeof configured === "string") {
    const normalized = configured.trim();
    if (normalized && normalized !== "null" && normalized !== "undefined")
      return normalized;
  }
  return DEFAULT_TAB_ICONS[settingKey];
}

const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_moveItem:
    "systems/ffxiv/assets/sfx/ffxiv-obtain-item.ogg",
  soundNotificationFFXIV_enterChat:
    "systems/ffxiv/assets/sfx/ffxiv-full-party.ogg",
  soundNotificationFFXIV_openSheet:
    "systems/ffxiv/assets/sfx/ffxiv-switch-target.ogg",
  soundNotificationFFXIV_closeSheet:
    "systems/ffxiv/assets/sfx/ffxiv-untarget.ogg",
  soundNotificationFFXIV_enmity:
    "systems/ffxiv/assets/sfx/ffxiv-aggro.ogg",
};
const FFXIV_BARRIER_OVERLAY_KEY = "ffxivBarrierOverlay";
const FFXIV_MANA_OVERLAY_KEY = "ffxivManaOverlay";
const FFXIV_HEALTH_OVERLAY_KEY = "ffxivHealthOverlay";

function playConfiguredSound(setting) {
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
    volume: 1,
    autoplay: true,
    loop: false,
  });
}

Handlebars.registerHelper("characterTabs", function (settings) {
  let items = [
    {
      tab: "abilities",
      label: game.i18n.localize("FFXIV.Abilities.Abilities"),
      icon: getCharacterTabIcon("imgTabAbilities"),
    },
    {
      tab: "attributes",
      label: game.i18n.localize("FFXIV.Attributes.Attributes"),
      icon: getCharacterTabIcon("imgTabAttributes"),
    },
    {
      tab: "roleplay",
      label: game.i18n.localize("FFXIV.CharacterSheet.Character"),
      icon: getCharacterTabIcon("imgTabRoleplay"),
    },
  ];
  items.push({
    tab: "items",
    label: game.i18n.localize("FFXIV.CharacterSheet.Inventory"),
    icon: getCharacterTabIcon("imgTabItems"),
  });
  items.push({
    tab: "companions",
    label: game.i18n.localize("FFXIV.CharacterSheet.Companions"),
    icon: getCharacterTabIcon("imgTabCompanions"),
  });
  items.push({
    tab: "effects",
    label: game.i18n.localize("FFXIV.CharacterSheet.Effects"),
    icon: "systems/ffxiv/assets/tab-icons/active-help.webp",
  });
  items.push({
    tab: "settings",
    label: game.i18n.localize("FFXIV.CharacterSheet.Config"),
    icon: getCharacterTabIcon("imgTabSettings"),
  });
  return items;
});

Handlebars.registerHelper("getPetData", function (pets, id) {
  return pets.find((p) => p._id === id);
});

Handlebars.registerHelper("repeat", function (n, options) {
  let content = "";
  for (let i = 0; i < n; i++) {
    content += options.fn({ index: i });
  }
  return content;
});
Handlebars.registerHelper("object", function ({ hash }) {
  return hash;
});
Handlebars.registerHelper("reverse", function (array) {
  return array.slice().reverse(); // Reverse a copy of the array
});
Handlebars.registerHelper("labelize", function (category, value) {
  const configCategory = FFXIV[category];
  const configValue = configCategory ? configCategory[value] : null;
  return configValue ? configValue.label : value;
});
Handlebars.registerHelper("delabelize", function (category, label) {
  const configCategory = FFXIV[category];
  if (!configCategory) return "";
  for (const key in configCategory) {
    if (configCategory[key].label === label) {
      return configCategory[key].value;
    }
  }
  return "";
});

Handlebars.registerHelper("buildInventoryGrid", function (items, gridSize) {
  const grid = new Array(gridSize).fill(null); // Create an array of size gridSize filled with null
  items.forEach((item) => {
    if (CONFIG.FFXIV.inventory_items.indexOf(item.type) > -1) {
      //Check item is inventoriable
      const pos = item.system.position;
      if (pos >= 1 && pos <= gridSize) {
        // Check if position is between 1 and gridSize
        grid[pos - 1] = item; // Place item in its position (0-indexed)
      }
    }
  });

  return grid; // Return the filled grid array
});
Handlebars.registerHelper("sortAbilities", function (items, order, type) {
  const byType = (item) => {
    if (type === "trait") return item.type === "trait";
    if (type === "ability") return item.type === "ability";
    if (["primary_ability", "secondary_ability", "instant_ability", "limit_break"].includes(type)) {
      return getAbilitySubtype(item) === type;
    }
    return item.type === type;
  };
  if (!order || !order[type] || !Array.isArray(order[type])) {
    return items.filter(byType); // no saved order, return as is
  }

  return items.filter(byType).sort((a, b) => {
    const indexA = order[type].indexOf(a._id);
    const indexB = order[type].indexOf(b._id);

    return (indexA === -1 ? 9999 : indexA) - (indexB === -1 ? 9999 : indexB);
  });
});

Handlebars.registerHelper("sortPets", function (pets, order) {
  if (!order || !Array.isArray(order)) {
    return pets;
  }
  return pets.sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    return (indexA === -1 ? 9999 : indexA) - (indexB === -1 ? 9999 : indexB);
  });
});
Handlebars.registerHelper("getActor", function (actorId) {
  return game.actors?.get(actorId);
});

Handlebars.registerHelper("gearBonuses", function (items) {
  const gearLabels = Object.values(CONFIG.FFXIV.gear_subcategories).map(
    (g) => g.label,
  );
  const getGearPosition = (category) => {
    let index = gearLabels.indexOf(category);
    return index !== -1 ? index : 999;
  };

  return items
    .filter((item) => item.system?.equipped)
    .sort(
      (a, b) =>
        getGearPosition(a.system.category) - getGearPosition(b.system.category),
    );
});
Handlebars.registerHelper("getAttributeBonus", function (gearItems, attrKey) {
  if (!gearItems || gearItems.length === 0) return []; // Prevent errors
  const modifiersList = Object.assign(
    {},
    CONFIG.FFXIV.attributes,
    CONFIG.FFXIV.characteristics,
  );
  return gearItems.map((item) => {
    const modifierEntry = item.system?.modifiers?.find(
      (mod) => mod[0] === modifiersList[attrKey]?.label,
    );
    return modifierEntry ? modifierEntry[1] : "-";
  });
});
Handlebars.registerHelper("attributeList", function () {
  return Object.keys(
    Object.assign({}, CONFIG.FFXIV.attributes, CONFIG.FFXIV.characteristics),
  );
});
Handlebars.registerHelper("hasItemType", function (items, type) {
  if (!items) return false;
  return items.some((item) => item.type === type);
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", function () {
  initLimitBreakHud();
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
  applyGlobalArtworkRotationLock().catch((error) => {
    debugError("FFXIV | Failed to apply global artwork rotation lock:", error);
  });
  syncEliteFoeEffects().catch((error) => {
    debugError("FFXIV | Failed to sync elite foe effects:", error);
  });

  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (!isFFXIVItemHotbarDrop(data)) return;
    createItemMacro(data, slot);
    return false;
  });

  Hooks.on("deleteItem", (item, _options, userId) => {
    if (game.user.id !== userId) return;
    deletePairedItemMacros(item).catch((error) => {
      debugError("FFXIV | Failed to delete paired item macro:", error);
    });
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
    migrateLegacyPetTraits();
    migrateItemDataStructure();
    migrateActorCurrencyToFortune();
  }
});

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

function showActiveEffectChangeText(effect, sign, fill) {
  const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
  if (effect?.getFlag?.("ffxiv", ELITE_FOE_EFFECT_FLAG) === true) return;
  if (!actor || typeof canvas?.interface?.createScrollingText !== "function") return;

  const token = getActorCanvasToken(actor);
  if (!token?.center) return;

  const direction = CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1;
  const anchor = CONST.TEXT_ANCHOR_POINTS?.CENTER ?? 0;
  canvas.interface.createScrollingText(token.center, `${sign}${effect.name}`, {
    anchor,
    direction,
    distance: (canvas.grid?.size ?? 100) * 1.5,
    fontSize: 28,
    fill,
    stroke: 0x000000,
    strokeThickness: 4,
    ffxivAllowStatusText: true,
  });
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

function hasStringContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string") return false;
  const text = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text.length > 0;
}

function getMigratableActorCompendiumPacks() {
  return game.packs.filter(
    (pack) => pack.documentName === "Actor" && !pack.locked,
  );
}

function getLegacyPetTraitsSource(pet) {
  return (
    pet._source?.system?.traits ??
    pet.toObject?.(false)?.system?.traits ??
    pet.system?.traits
  );
}

function buildMigratedPetTraitItemData(traits) {
  return {
    _id: foundry.utils.randomID(),
    name: "Migrated Trait",
    type: "trait",
    img: "icons/svg/aura.svg",
    system: {
      description: traits,
      tags: [],
      activable: false,
      modifiers: [],
      source: "",
      level: 0,
    },
    flags: {
      ffxiv: {
        migratedTrait: true,
      },
    },
  };
}

function hasMigratedPetTraitItem(items) {
  return Array.from(items ?? []).some(
    (item) =>
      item.type === "trait" &&
      (item.flags?.ffxiv?.migratedTrait || item.name === "Migrated Trait"),
  );
}

function hasAnyPetTraitItem(items) {
  return Array.from(items ?? []).some((item) => item.type === "trait");
}

async function migrateLegacyPetTraits({
  includeWorld = true,
  includeCompendiums = false,
} = {}) {
  if (includeWorld) {
    for (const pet of game.actors.filter((actor) => actor.type === "pet")) {
      const sourceTraits = getLegacyPetTraitsSource(pet);
      const traits = typeof sourceTraits === "string" ? sourceTraits : "";
      if (!hasStringContent(traits)) continue;
      const hasMigrated = hasMigratedPetTraitItem(pet.items);
      if (hasMigrated) continue;

      try {
        await pet.createEmbeddedDocuments("Item", [
          buildMigratedPetTraitItemData(traits),
        ]);
        await pet.update({ "system.traits": "" });
        debugLog(`FFXIV | Migrated traits for pet ${pet.name}`);
      } catch (error) {
        console.error(
          "FFXIV | Pet trait migration failed for",
          pet.name,
          error,
        );
      }
    }
  }

  if (!includeCompendiums) return;

  for (const pack of getMigratableActorCompendiumPacks()) {
    const updates = [];
    const pets = (await pack.getDocuments()).filter(
      (actor) => actor.type === "pet",
    );
    for (const pet of pets) {
      const sourceTraits = getLegacyPetTraitsSource(pet);
      const traits = typeof sourceTraits === "string" ? sourceTraits : "";
      if (!hasStringContent(traits)) continue;

      const itemData = Array.from(pet.items ?? []);
      if (hasMigratedPetTraitItem(itemData) || hasAnyPetTraitItem(itemData))
        continue;

      const source = pet.toObject(false);
      const items = Array.isArray(source.items) ? source.items : [];
      updates.push({
        _id: pet.id,
        "system.traits": "",
        items: [...items, buildMigratedPetTraitItemData(traits)],
      });
    }

    if (!updates.length) continue;
    try {
      await pack.documentClass.updateDocuments(updates, {
        pack: pack.collection,
        render: false,
      });
      debugLog(
        `FFXIV | Migrated traits for ${updates.length} compendium pet(s) in ${pack.collection}`,
      );
    } catch (error) {
      console.error(
        `FFXIV | Pet trait migration failed for compendium ${pack.collection}`,
        error,
      );
    }
  }
}

async function migrateActorCurrencyToFortune() {
  for (const actor of game.actors.filter(
    (entry) => entry.type === "character",
  )) {
    const currencyItems = actor.items.filter(
      (item) => item.type === "currency",
    );
    if (!currencyItems.length) continue;

    const migratedFortune = currencyItems.reduce((total, item) => {
      const quantity = Number.parseInt(item.system?.quantity, 10);
      return total + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);

    const currentFortune = Number.parseInt(actor.system?.fortune, 10);
    const nextFortune = Math.max(
      (Number.isFinite(currentFortune) ? currentFortune : 0) + migratedFortune,
      0,
    );

    try {
      await actor.update({ "system.fortune": nextFortune });
      await actor.deleteEmbeddedDocuments(
        "Item",
        currencyItems.map((item) => item.id),
      );
      debugLog(
        `FFXIV | Migrated ${currencyItems.length} currency item(s) to Fortune for ${actor.name}`,
      );
    } catch (error) {
      console.error("FFXIV | Currency migration failed for", actor.name, error);
    }
  }
}

function remapLegacyAscendentStatusIds(statuses) {
  const source = Array.isArray(statuses)
    ? statuses
    : statuses instanceof Set
      ? Array.from(statuses)
      : [];
  if (!source.includes("ascendent")) return null;
  return Array.from(
    new Set(
      source.map((statusId) => (statusId === "ascendent" ? "transcendent" : statusId)),
    ),
  );
}

function getStatusEffectConfig(statusId) {
  return CONFIG.statusEffects?.find((status) => status.id === statusId);
}

async function migrateOwnerLegacyStatusEffects(owner, { refreshIcons = false } = {}) {
  const updates = [];
  for (const effect of owner?.effects ?? []) {
    const sourceStatuses = Array.isArray(effect._source?.statuses)
      ? effect._source.statuses
      : effect.statuses instanceof Set
        ? Array.from(effect.statuses)
        : [];
    const nextStatuses = remapLegacyAscendentStatusIds(sourceStatuses);
    const statusIds = nextStatuses ?? sourceStatuses;
    const update = { _id: effect.id };

    if (nextStatuses) update.statuses = nextStatuses;
    if (refreshIcons && statusIds.length === 1) {
      const status = getStatusEffectConfig(statusIds[0]);
      const img = status?.img || status?.icon || "";
      if (img && effect.img !== img) update.img = img;
    }

    if (Object.keys(update).length > 1) updates.push(update);
  }

  if (updates.length) {
    await owner.updateEmbeddedDocuments("ActiveEffect", updates, {
      render: false,
    });
  }
  return updates.length;
}

async function migrateAscendentStatusIdToTranscendent() {
  if (!game.user?.isGM) return;

  let migratedItems = 0;
  let migratedEffects = 0;

  const remapStatusEntries = (entries) => {
    if (!Array.isArray(entries) || !entries.length) return null;
    let changed = false;
    const next = entries.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      if (entry.id !== "ascendent") return entry;
      changed = true;
      return { ...entry, id: "transcendent" };
    });
    return changed ? next : null;
  };

  const migrateItemStatusFields = async (item) => {
    const updates = {};
    if (item.system?.status_effect === "ascendent") {
      updates["system.status_effect"] = "transcendent";
    }
    const remappedEntries = remapStatusEntries(item.system?.status_effects);
    if (remappedEntries) updates["system.status_effects"] = remappedEntries;
    if (!Object.keys(updates).length) return;
    await item.update(updates, { render: false });
    migratedItems += 1;
  };

  for (const item of game.items ?? []) {
    await migrateItemStatusFields(item);
  }

  for (const actor of game.actors ?? []) {
    migratedEffects += await migrateOwnerLegacyStatusEffects(actor);
    for (const item of actor.items ?? []) {
      await migrateItemStatusFields(item);
      migratedEffects += await migrateOwnerLegacyStatusEffects(item);
    }
  }

  if (!migratedItems && !migratedEffects) return;
}

async function refreshSceneActorStatusEffectsForLegacyIcons() {
  const processedActors = new Set();

  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens?.contents ?? []) {
      const actor = token.actor;
      if (!actor) continue;
      const key = actor.isToken ? token.uuid : actor.uuid;
      if (processedActors.has(key)) continue;
      processedActors.add(key);

      try {
        await migrateOwnerLegacyStatusEffects(actor, { refreshIcons: true });
      } catch (error) {
        console.error(
          "FFXIV | Failed to refresh legacy status icons for",
          actor.name,
          error,
        );
      }
    }
  }
}

const SHOP_TIER_TYPES = new Set(["consumable", "gear", "augment", "minion"]);
const ACTION_FORMULA_TYPES = new Set([
  "ability",
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
  "augment",
  "minion",
]);
const HP_COST_MIGRATION_TYPES = new Set([
  "ability",
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
  "consumable",
  "augment",
  "minion",
]);
const ITEM_DATA_MIGRATION_VERSION = "19";
function getMigratableItemCompendiumPacks() {
  return game.packs.filter(
    (pack) => pack.documentName === "Item" && !pack.locked,
  );
}

function getItemCompendiumPacks() {
  return game.packs.filter((pack) => pack.documentName === "Item");
}

function getActorCompendiumPacks() {
  return game.packs.filter((pack) => pack.documentName === "Actor");
}

async function withCompendiumUnlocked(pack, operation) {
  const wasLocked = Boolean(pack.locked);
  if (wasLocked) await pack.configure({ locked: false });
  try {
    return await operation();
  } finally {
    if (wasLocked) await pack.configure({ locked: true });
  }
}

function getCanonicalizedTagUpdate(tags) {
  if (!Array.isArray(tags)) return null;
  const nextTags = canonicalizeBakedTags(tags);
  return JSON.stringify(nextTags) === JSON.stringify(tags) ? null : nextTags;
}

function getCanonicalizedAbilityGrantItemTags(abilityGrants) {
  if (!Array.isArray(abilityGrants)) return null;

  let changed = false;
  const nextGrants = abilityGrants.map((grant) => {
    if (!grant?.item?.system || typeof grant.item.system !== "object")
      return grant;

    const nextTags = getCanonicalizedTagUpdate(grant.item.system.tags);
    if (!nextTags) return grant;

    changed = true;
    return {
      ...grant,
      item: {
        ...grant.item,
        system: {
          ...grant.item.system,
          tags: nextTags,
        },
      },
    };
  });

  return changed ? nextGrants : null;
}

function getStrippedAbilityGrantItemData(abilityGrants) {
  const entries = Array.isArray(abilityGrants)
    ? abilityGrants
    : abilityGrants && typeof abilityGrants === "object"
      ? Object.values(abilityGrants)
      : [];
  if (!entries.length) return null;

  let changed = false;
  const nextGrants = entries.map((grant) => {
    if (!grant || typeof grant !== "object" || !Object.hasOwn(grant, "item"))
      return grant;

    changed = true;
    const { item, ...rest } = grant;
    return rest;
  });

  return changed ? nextGrants : null;
}

function getItemTagMigrationPatch(itemLike) {
  const updates = {};
  const nextTags = getCanonicalizedTagUpdate(itemLike.system?.tags);
  if (nextTags) updates["system.tags"] = nextTags;

  const nextGrants = getCanonicalizedAbilityGrantItemTags(
    itemLike.system?.ability_grants,
  );
  if (nextGrants) updates["system.ability_grants"] = nextGrants;

  return Object.keys(updates).length ? updates : null;
}

function migrateItemSourceTags(itemSource) {
  const patch = getItemTagMigrationPatch(itemSource);
  if (!patch) return { item: itemSource, changed: false };

  const nextItem = foundry.utils.deepClone(itemSource);
  for (const [path, value] of Object.entries(patch)) {
    foundry.utils.setProperty(nextItem, path, value);
  }

  return { item: nextItem, changed: true };
}

async function migrateCanonicalItemTags() {
  const worldUpdates = [];
  let updatedActorItems = 0;
  let updatedCompendiumItems = 0;
  let updatedActorCompendiumItems = 0;

  for (const item of game.items) {
    const patch = getItemTagMigrationPatch(item);
    if (!patch) continue;
    worldUpdates.push({ _id: item.id, ...patch });
  }

  if (worldUpdates.length) {
    await Item.updateDocuments(worldUpdates, { render: false });
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      const patch = getItemTagMigrationPatch(item);
      if (!patch) continue;
      updates.push({ _id: item.id, ...patch });
    }

    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    updatedActorItems += updates.length;
  }

  for (const pack of getItemCompendiumPacks()) {
    const updates = [];
    for (const item of await pack.getDocuments()) {
      const patch = getItemTagMigrationPatch(item);
      if (!patch) continue;
      updates.push({ _id: item.id, ...patch });
    }

    if (!updates.length) continue;
    await withCompendiumUnlocked(pack, () =>
      pack.documentClass.updateDocuments(updates, {
        pack: pack.collection,
        render: false,
      }),
    );
    updatedCompendiumItems += updates.length;
  }

  for (const pack of getActorCompendiumPacks()) {
    const updates = [];
    for (const actor of await pack.getDocuments()) {
      const source = actor.toObject(false);
      const items = Array.isArray(source.items) ? source.items : [];
      let changedItems = 0;
      const nextItems = items.map((itemSource) => {
        const migrated = migrateItemSourceTags(itemSource);
        if (migrated.changed) changedItems += 1;
        return migrated.item;
      });

      if (!changedItems) continue;
      updates.push({ _id: actor.id, items: nextItems });
      updatedActorCompendiumItems += changedItems;
    }

    if (!updates.length) continue;
    await withCompendiumUnlocked(pack, () =>
      pack.documentClass.updateDocuments(updates, {
        pack: pack.collection,
        render: false,
      }),
    );
  }

  return {
    updatedWorldItems: worldUpdates.length,
    updatedActorItems,
    updatedCompendiumItems,
    updatedActorCompendiumItems,
  };
}

let _itemMigrationPromise = null;

async function migrateItemDataStructure({ force = false } = {}) {
  if (_itemMigrationPromise) return _itemMigrationPromise;
  _itemMigrationPromise = _migrateItemDataStructureInternal({ force });
  try {
    return await _itemMigrationPromise;
  } finally {
    _itemMigrationPromise = null;
  }
}

async function _migrateItemDataStructureInternal({ force = false } = {}) {
  const currentVersion = game.settings.get("ffxiv", "itemMigrationVersion");
  if (!force && currentVersion === ITEM_DATA_MIGRATION_VERSION) return;
  const parsedMigrationVersion = Number.parseInt(currentVersion, 10);
  const migrationVersion = Number.isFinite(parsedMigrationVersion)
    ? parsedMigrationVersion
    : 0;

  let inProgressNotification = null;
  let progressActive = false;
  let progressContainer = null;
  let progressBarFill = null;
  let progressLabel = null;
  const applyStyles = (el, styles) => Object.assign(el.style, styles);
  const ensureMigrationProgressUI = () => {
    if (progressContainer?.isConnected) return;
    progressContainer = document.createElement("div");
    progressContainer.id = "ffxiv-item-migration-progress";
    applyStyles(progressContainer, {
      position: "fixed",
      left: "16px",
      right: "16px",
      bottom: "16px",
      zIndex: "9999",
      background: "rgba(20, 20, 20, 0.92)",
      border: "1px solid #4da3ff",
      borderRadius: "8px",
      padding: "10px 12px",
      color: "#f3f3f3",
      boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
    });

    progressLabel = document.createElement("div");
    applyStyles(progressLabel, {
      fontSize: "13px",
      marginBottom: "8px",
      fontWeight: "600",
    });

    const progressTrack = document.createElement("div");
    applyStyles(progressTrack, {
      height: "10px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.2)",
      overflow: "hidden",
    });

    progressBarFill = document.createElement("div");
    applyStyles(progressBarFill, {
      height: "100%",
      width: "0%",
      background: "linear-gradient(90deg, #4da3ff, #87c3ff)",
      transition: "width 120ms ease-out",
    });

    progressTrack.appendChild(progressBarFill);
    progressContainer.append(progressLabel, progressTrack);
    document.body.appendChild(progressContainer);
  };
  const clearMigrationProgressUI = () => {
    progressContainer?.remove();
    progressContainer = null;
    progressBarFill = null;
    progressLabel = null;
  };
  const showMigrationProgress = (pct, labelKey, data = {}) => {
    const label = game.i18n.has(labelKey)
      ? game.i18n.format(labelKey, data)
      : game.i18n.localize(labelKey);
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    ensureMigrationProgressUI();
    if (progressLabel) progressLabel.textContent = `${label} (${clamped}%)`;
    if (progressBarFill) progressBarFill.style.width = `${clamped}%`;
    progressActive = true;
    debugLog(`FFXIV | [${clamped}%] ${label}`);
  };
  const clearMigrationProgress = () => {
    if (!progressActive) return;
    showMigrationProgress(
      100,
      "FFXIV.Notifications.ItemMigrationProgressComplete",
    );
    setTimeout(() => {
      clearMigrationProgressUI();
    }, 500);
    progressActive = false;
  };
  const reportPhase = (messageKey, data = {}) => {
    const message = game.i18n.has(messageKey)
      ? game.i18n.format(messageKey, data)
      : game.i18n.localize(messageKey);
    debugLog(`FFXIV | ${message}`);
  };
  try {
    inProgressNotification = ui.notifications?.warn(
      game.i18n.localize("FFXIV.Notifications.ItemMigrationInProgress"),
      { permanent: true },
    );

    showMigrationProgress(
      2,
      "FFXIV.Notifications.ItemMigrationProgressStarting",
    );
    if (migrationVersion <= 15) {
      await refreshSceneActorStatusEffectsForLegacyIcons();
    }
    await migrateLegacyPetTraits({
      includeWorld: false,
      includeCompendiums: true,
    });
    reportPhase("FFXIV.Notifications.ItemMigrationPhaseShopTierStart");
    showMigrationProgress(
      10,
      "FFXIV.Notifications.ItemMigrationPhaseShopTierStart",
    );
    const shopTierStats = await migrateLegacyShopTiers();
    reportPhase(
      "FFXIV.Notifications.ItemMigrationPhaseShopTierDone",
      shopTierStats,
    );
    showMigrationProgress(
      30,
      "FFXIV.Notifications.ItemMigrationPhaseShopTierDone",
      shopTierStats,
    );

    reportPhase("FFXIV.Notifications.ItemMigrationPhaseFormulaStart");
    showMigrationProgress(
      35,
      "FFXIV.Notifications.ItemMigrationPhaseFormulaStart",
    );
    const formulaStats = await migrateActionFormulaStructure();
    reportPhase(
      "FFXIV.Notifications.ItemMigrationPhaseFormulaDone",
      formulaStats,
    );
    showMigrationProgress(
      55,
      "FFXIV.Notifications.ItemMigrationPhaseFormulaDone",
      formulaStats,
    );

    reportPhase("FFXIV.Notifications.ItemMigrationPhaseHpCostStart");
    showMigrationProgress(
      60,
      "FFXIV.Notifications.ItemMigrationPhaseHpCostStart",
    );
    const hpCostStats = await migrateAbilityHpCosts();
    reportPhase(
      "FFXIV.Notifications.ItemMigrationPhaseHpCostDone",
      hpCostStats,
    );
    showMigrationProgress(
      75,
      "FFXIV.Notifications.ItemMigrationPhaseHpCostDone",
      hpCostStats,
    );

    reportPhase("FFXIV.Notifications.ItemMigrationPhaseTagStart");
    showMigrationProgress(
      77,
      "FFXIV.Notifications.ItemMigrationPhaseTagStart",
    );
    const tagStats = await migrateCanonicalItemTags();
    reportPhase("FFXIV.Notifications.ItemMigrationPhaseTagDone", tagStats);
    showMigrationProgress(
      79,
      "FFXIV.Notifications.ItemMigrationPhaseTagDone",
      tagStats,
    );

    reportPhase("FFXIV.Notifications.ItemMigrationPhaseAbilityTypeStart");
    showMigrationProgress(
      80,
      "FFXIV.Notifications.ItemMigrationPhaseAbilityTypeStart",
    );
    const abilityTypeStats = await migrateAbilityItemTypes({
      onProgress: ({ current, total, itemName }) => {
        const phaseStart = 0;
        const phaseEnd = 99;
        const phaseRange = phaseEnd - phaseStart;
        const stepPct = total > 0 ? current / total : 1;
        const pct = Math.floor(phaseStart + phaseRange * stepPct);

        showMigrationProgress(
          pct,
          "FFXIV.Notifications.ItemMigrationPhaseAbilityTypeProgress",
          {
            current,
            total,
            itemName,
          },
        );
      },
    });
    reportPhase(
      "FFXIV.Notifications.ItemMigrationPhaseAbilityTypeDone",
      abilityTypeStats,
    );
    showMigrationProgress(
      99,
      "FFXIV.Notifications.ItemMigrationPhaseAbilityTypeDone",
      abilityTypeStats,
    );

    await game.settings.set(
      "ffxiv",
      "itemMigrationVersion",
      ITEM_DATA_MIGRATION_VERSION,
    );
    showMigrationProgress(
      100,
      "FFXIV.Notifications.ItemMigrationProgressComplete",
    );
    ui.notifications.info(
      game.i18n.localize("FFXIV.Notifications.ItemMigrationComplete"),
    );
  } catch (error) {
    console.error("FFXIV | Item migration failed", error);
    ui.notifications.error(
      game.i18n.localize("FFXIV.Notifications.ItemMigrationFailed"),
    );
  } finally {
    clearMigrationProgress();
    if (inProgressNotification) {
      if (typeof ui.notifications?.remove === "function") {
        ui.notifications.remove(
          inProgressNotification.id ?? inProgressNotification,
        );
      } else if (typeof inProgressNotification.remove === "function")
        inProgressNotification.remove();
    }
  }
}

function normalizeHpCostValue(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

async function migrateAbilityHpCosts() {
  let updatedWorldItems = 0;
  let updatedActorItems = 0;
  let updatedCompendiumItems = 0;
  const worldUpdates = [];
  for (const item of game.items) {
    if (!HP_COST_MIGRATION_TYPES.has(item.type)) continue;
    const nextValue = normalizeHpCostValue(item.system?.hpcost);
    if (
      nextValue ===
      (Number.isFinite(item.system?.hpcost)
        ? item.system.hpcost
        : Number.parseInt(item.system?.hpcost, 10) || 0)
    )
      continue;
    worldUpdates.push({ _id: item.id, "system.hpcost": nextValue });
    updatedWorldItems += 1;
  }
  if (worldUpdates.length) {
    await Item.updateDocuments(worldUpdates, { render: false });
  }

  for (const pack of getMigratableItemCompendiumPacks()) {
    const docs = await pack.getDocuments();
    const updates = [];
    for (const item of docs) {
      if (!HP_COST_MIGRATION_TYPES.has(item.type)) continue;
      const nextValue = normalizeHpCostValue(item.system?.hpcost);
      const currentValue = Number.isFinite(item.system?.hpcost)
        ? item.system.hpcost
        : Number.parseInt(item.system?.hpcost, 10) || 0;
      if (nextValue === currentValue) continue;
      updates.push({ _id: item.id, "system.hpcost": nextValue });
    }
    if (!updates.length) continue;
    await pack.documentClass.updateDocuments(updates, {
      pack: pack.collection,
      render: false,
    });
    updatedCompendiumItems += updates.length;
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      if (!HP_COST_MIGRATION_TYPES.has(item.type)) continue;
      const nextValue = normalizeHpCostValue(item.system?.hpcost);
      const currentValue = Number.isFinite(item.system?.hpcost)
        ? item.system.hpcost
        : Number.parseInt(item.system?.hpcost, 10) || 0;
      if (nextValue === currentValue) continue;
      updates.push({ _id: item.id, "system.hpcost": nextValue });
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    updatedActorItems += updates.length;
  }
  return { updatedWorldItems, updatedActorItems, updatedCompendiumItems };
}

function _getMigratedUUIDTextLinkReplacements(system, UUIDMap) {
  const serialized = JSON.stringify(system);
  if (!serialized?.includes("@UUID[")) return null;

  const replacements = new Map();
  serialized.replace(/@UUID\[([^\]]+)\]/g, (match, uuid) => {
    const nextUUID = UUIDMap.get(uuid);
    if (nextUUID && nextUUID !== uuid) replacements.set(uuid, nextUUID);
    return match;
  });

  return replacements.size ? replacements : null;
}

function _replaceMigratedUUIDTextLinks(value, replacements) {
  if (typeof value === "string") {
    let replacementCount = 0;
    const nextValue = value.replace(/@UUID\[([^\]]+)\]/g, (match, uuid) => {
      const nextUUID = replacements.get(uuid);
      if (!nextUUID || nextUUID === uuid) return match;
      replacementCount += 1;
      return `@UUID[${nextUUID}]`;
    });

    return {
      value: nextValue,
      changed: replacementCount > 0,
      replacementCount,
    };
  }

  if (Array.isArray(value)) {
    let changed = false;
    let replacementCount = 0;

    const nextValue = value.map((entry) => {
      const rewritten = _replaceMigratedUUIDTextLinks(entry, replacements);
      changed ||= rewritten.changed;
      replacementCount += rewritten.replacementCount;
      return rewritten.value;
    });

    return {
      value: changed ? nextValue : value,
      changed,
      replacementCount,
    };
  }

  if (value && typeof value === "object") {
    let changed = false;
    let replacementCount = 0;
    const nextValue = {};

    for (const [key, entry] of Object.entries(value)) {
      const rewritten = _replaceMigratedUUIDTextLinks(entry, replacements);
      changed ||= rewritten.changed;
      replacementCount += rewritten.replacementCount;
      nextValue[key] = rewritten.value;
    }

    return {
      value: changed ? nextValue : value,
      changed,
      replacementCount,
    };
  }

  return {
    value,
    changed: false,
    replacementCount: 0,
  };
}

function _buildUUIDTextLinkUpdate(item, UUIDMap) {
  const system = item.toObject(false).system ?? {};
  const replacements = _getMigratedUUIDTextLinkReplacements(system, UUIDMap);
  if (!replacements) return null;

  const rewritten = _replaceMigratedUUIDTextLinks(system, replacements);
  if (!rewritten.changed) return null;

  return {
    update: { _id: item.id, system: rewritten.value },
    replacements: rewritten.replacementCount,
  };
}

async function remapMigratedItemUUIDTextLinks(UUIDMap) {
  const stats = {
    updatedWorldUUIDTextItems: 0,
    updatedActorUUIDTextItems: 0,
    updatedCompendiumUUIDTextItems: 0,
    updatedUUIDTextLinks: 0,
  };
  if (!UUIDMap.size) return stats;

  const worldUpdates = [];
  for (const item of game.items) {
    const rewritten = _buildUUIDTextLinkUpdate(item, UUIDMap);
    if (!rewritten) continue;
    worldUpdates.push(rewritten.update);
    stats.updatedWorldUUIDTextItems += 1;
    stats.updatedUUIDTextLinks += rewritten.replacements;
  }
  if (worldUpdates.length) {
    await Item.updateDocuments(worldUpdates, { render: false });
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      const rewritten = _buildUUIDTextLinkUpdate(item, UUIDMap);
      if (!rewritten) continue;
      updates.push(rewritten.update);
      stats.updatedActorUUIDTextItems += 1;
      stats.updatedUUIDTextLinks += rewritten.replacements;
    }
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    }
  }

  for (const pack of getMigratableItemCompendiumPacks()) {
    const updates = [];
    for (const item of await pack.getDocuments()) {
      const rewritten = _buildUUIDTextLinkUpdate(item, UUIDMap);
      if (!rewritten) continue;
      updates.push(rewritten.update);
      stats.updatedCompendiumUUIDTextItems += 1;
      stats.updatedUUIDTextLinks += rewritten.replacements;
    }
    if (updates.length) {
      await pack.documentClass.updateDocuments(updates, {
        pack: pack.collection,
        render: false,
      });
    }
  }

  return stats;
}

async function migrateAbilityItemTypes({ onProgress = null } = {}) {
  const legacyAbilityTypes = new Set(ABILITY_SUBTYPE_TYPES);
  const grantOwnerTypes = new Set(["job", "augment"]);
  let createdWorldItems = 0;
  let deletedWorldItems = 0;
  let updatedWorldTags = 0;
  let createdActorItems = 0;
  let deletedActorItems = 0;
  let updatedActorTags = 0;
  let updatedAbilityOrders = 0;
  let updatedJobGrantUUIDs = 0;
  let strippedActorJobGrantItems = 0;
  let createdCompendiumItems = 0;
  let deletedCompendiumItems = 0;
  let updatedCompendiumTags = 0;
  let updatedActorCompendiumAbilityItems = 0;
  const migratedUUIDMap = new Map();
  const worldUUIDMap = new Map();
  const worldLegacyIdToUuidMap = new Map();
  const ensureMigratedAbilitySubtypeTags = (
    tags,
    fallbackSubtype = "primary_ability",
  ) =>
    ensureAbilitySubtypeTags(tags, fallbackSubtype, {
      canonicalizeSubtypeTag: true,
      canonicalizeBakedTags: true,
    });
  const remapAndNormalizeGrantEntries = (
    rawGrants,
    UUIDMap,
    { ownerItem = null, legacyIdToUuidMap = null } = {},
  ) => {
    let entries = Array.isArray(rawGrants)
      ? rawGrants
      : Object.values(rawGrants || {});
    let changed = false;
    if (!entries.length && ownerItem?.type === "augment") {
      const legacyId = String(ownerItem.system?.granted_ability ?? "").trim();
      if (legacyId) {
        const legacySource = game.items.get(legacyId) ?? null;
        let legacyUUID = legacyIdToUuidMap?.get(legacyId) ?? "";
        if (!legacyUUID && legacySource?.uuid) legacyUUID = legacySource.uuid;
        if (legacyUUID) {
          const legacyItem = legacySource ? legacySource.toObject() : null;
          if (legacyItem) delete legacyItem._id;
          entries = [
            {
              uuid: legacyUUID,
              name: legacySource?.name || ownerItem.name || "",
              type: legacySource?.type || "ability",
              ...(legacyItem ? { item: legacyItem } : {}),
            },
          ];
          changed = true;
        }
      }
    }
    const nextEntries = entries.map((grant) => {
      if (!grant || typeof grant !== "object") return grant;
      let nextGrant = grant;

      const currentUUID = String(grant.uuid ?? "");
      const nextUUID = UUIDMap.get(currentUUID);
      if (nextUUID && nextUUID !== currentUUID) {
        nextGrant = { ...nextGrant, uuid: nextUUID };
        changed = true;
      }

      const grantType = String(nextGrant.type ?? "");
      const normalizedSubtype = legacyAbilityTypes.has(grantType)
        ? grantType
        : nextGrant.item
          ? getAbilitySubtype(nextGrant.item)
          : "";
      if (legacyAbilityTypes.has(grantType)) {
        nextGrant = { ...nextGrant, type: "ability" };
        changed = true;
      }

      if (nextGrant.item && typeof nextGrant.item === "object") {
        const itemType = String(nextGrant.item.type ?? "");
        if (itemType === "ability" || legacyAbilityTypes.has(itemType)) {
          const fallbackSubtype = legacyAbilityTypes.has(itemType)
            ? itemType
            : normalizedSubtype || "primary_ability";

          const currentTags = Array.isArray(nextGrant.item.system?.tags)
            ? nextGrant.item.system.tags
            : [];

          const normalizedTags = ensureMigratedAbilitySubtypeTags(
            currentTags,
            fallbackSubtype,
          );

          const typeChanged = itemType !== "ability";
          const tagsChanged =
            JSON.stringify(normalizedTags) !== JSON.stringify(currentTags);

          if (typeChanged || tagsChanged) {
            const nextItem = foundry.utils.deepClone(nextGrant.item);
            nextItem.type = "ability";
            nextItem.system = nextItem.system || {};
            nextItem.system.tags = normalizedTags;

            nextGrant = { ...nextGrant, item: nextItem };
            changed = true;
          }
        }

        const grantItemType = String(nextGrant.item.type ?? "");
        const nextItemSystem = foundry.utils.deepClone(
          nextGrant.item.system || {},
        );
        let itemChanged = false;

        if (ACTION_FORMULA_TYPES.has(grantItemType)) {
          const formulaPatch = _migrateActionFormulaFields(nextItemSystem);
          if (formulaPatch) {
            for (const [path, value] of Object.entries(formulaPatch)) {
              const localPath = path.startsWith("system.")
                ? path.slice(7)
                : path;
              foundry.utils.setProperty(nextItemSystem, localPath, value);
            }
            itemChanged = true;
          }
        }

        if (HP_COST_MIGRATION_TYPES.has(grantItemType)) {
          const nextHpCost = normalizeHpCostValue(nextItemSystem.hpcost);
          const currentHpCost = Number.isFinite(nextItemSystem.hpcost)
            ? nextItemSystem.hpcost
            : Number.parseInt(nextItemSystem.hpcost, 10) || 0;
          if (nextHpCost !== currentHpCost) {
            nextItemSystem.hpcost = nextHpCost;
            itemChanged = true;
          }
        }

        if (SHOP_TIER_TYPES.has(grantItemType)) {
          const normalizedTier = normalizeShopTier(
            nextItemSystem.shop_tier,
            nextItemSystem.shop_tier_custom,
          );
          if (
            nextItemSystem.shop_tier !== normalizedTier.shop_tier ||
            (nextItemSystem.shop_tier_custom ?? "") !==
            normalizedTier.shop_tier_custom
          ) {
            nextItemSystem.shop_tier = normalizedTier.shop_tier;
            nextItemSystem.shop_tier_custom = normalizedTier.shop_tier_custom;
            itemChanged = true;
          }
        }

        if (itemChanged) {
          nextGrant = {
            ...nextGrant,
            item: {
              ...nextGrant.item,
              system: nextItemSystem,
            },
          };
          changed = true;
        }
      }

      return nextGrant;
    });
    return changed ? nextEntries : null;
  };
  const buildAbilityData = (item) => {
    const source = item.toObject();
    const fallbackSubtype = legacyAbilityTypes.has(item.type)
      ? item.type
      : "primary_ability";
    source.type = "ability";
    source.system = source.system || {};
    source.system.tags = ensureMigratedAbilitySubtypeTags(
      source.system.tags,
      fallbackSubtype,
      { canonicalizeSubtypeTag: true },
    );
    delete source._id;
    return source;
  };
  const buildEmbeddedAbilityData = (item) => {
    const source = buildAbilityData(item);
    source._id = item.id;
    return source;
  };


  const worldItems = Array.from(game.items);
  const worldLegacyItems = [];
  const worldAbilityItems = worldItems.filter(
    (item) => item.type === "ability" || legacyAbilityTypes.has(item.type),
  );
  const worldAbilityTotal = worldAbilityItems.length;
  let worldAbilityCurrent = 0;

  const reportWorldAbilityProgress = (item) => {
    worldAbilityCurrent += 1;
    if (typeof onProgress !== "function") return;

    onProgress({
      current: worldAbilityCurrent,
      total: worldAbilityTotal,
      itemName: item?.name ?? "",
    });
  };

  for (const item of worldItems) {
    if (item.type === "ability") {
      const normalizedTags = ensureMigratedAbilitySubtypeTags(
        item.system?.tags,
        "primary_ability",
      );
      const currentTags = Array.isArray(item.system?.tags)
        ? item.system.tags
        : [];
      if (JSON.stringify(normalizedTags) !== JSON.stringify(currentTags)) {
        await item.update({ "system.tags": normalizedTags }, { render: false });
        updatedWorldTags += 1;
      }

      reportWorldAbilityProgress(item);
      continue;
    }

    if (!legacyAbilityTypes.has(item.type)) continue;

    worldLegacyItems.push(item);
    reportWorldAbilityProgress(item);
  }

  if (worldLegacyItems.length) {
    const createData = worldLegacyItems.map((item) => buildAbilityData(item));
    const created = await Item.createDocuments(createData, { render: false });
    createdWorldItems += created.length;
    for (let i = 0; i < worldLegacyItems.length; i++) {
      worldUUIDMap.set(worldLegacyItems[i].uuid, created[i]?.uuid);
      if (worldLegacyItems[i].uuid && created[i]?.uuid) {
        migratedUUIDMap.set(worldLegacyItems[i].uuid, created[i].uuid);
      }
      if (worldLegacyItems[i]?.id && created[i]?.uuid) {
        worldLegacyIdToUuidMap.set(worldLegacyItems[i].id, created[i].uuid);
      }
    }
    const deleteIds = worldLegacyItems.map((item) => item.id);
    await Item.deleteDocuments(deleteIds, { render: false });
    deletedWorldItems += deleteIds.length;
  }

  for (const pack of getMigratableItemCompendiumPacks()) {
    const docs = await pack.getDocuments();
    const packUUIDMap = new Map();
    const packLegacyIdToUuidMap = new Map();
    const packLegacyItems = [];
    const tagUpdates = [];
    for (const item of docs) {
      if (item.type === "ability") {
        const normalizedTags = ensureMigratedAbilitySubtypeTags(
          item.system?.tags,
          "primary_ability",
        );
        const currentTags = Array.isArray(item.system?.tags)
          ? item.system.tags
          : [];
        if (JSON.stringify(normalizedTags) !== JSON.stringify(currentTags)) {
          tagUpdates.push({ _id: item.id, "system.tags": normalizedTags });
        }
        continue;
      }
      if (!legacyAbilityTypes.has(item.type)) continue;
      packLegacyItems.push(item);
    }

    if (tagUpdates.length) {
      await pack.documentClass.updateDocuments(tagUpdates, {
        pack: pack.collection,
        render: false,
      });
      updatedCompendiumTags += tagUpdates.length;
    }

    if (packLegacyItems.length) {
      const createData = packLegacyItems.map((item) => buildAbilityData(item));
      const created = await pack.documentClass.createDocuments(createData, {
        pack: pack.collection,
        render: false,
      });
      createdCompendiumItems += created.length;
      for (let i = 0; i < packLegacyItems.length; i++) {
        packUUIDMap.set(packLegacyItems[i].uuid, created[i]?.uuid);
        if (packLegacyItems[i].uuid && created[i]?.uuid) {
          migratedUUIDMap.set(packLegacyItems[i].uuid, created[i].uuid);
        }
        if (packLegacyItems[i]?.id && created[i]?.uuid) {
          packLegacyIdToUuidMap.set(packLegacyItems[i].id, created[i].uuid);
        }
      }
      const deleteIds = packLegacyItems.map((item) => item.id);
      await pack.documentClass.deleteDocuments(deleteIds, {
        pack: pack.collection,
        render: false,
      });
      deletedCompendiumItems += deleteIds.length;
    }

    const refreshedDocs = await pack.getDocuments();
    const packIdToUuidMap = new Map(
      refreshedDocs.map((doc) => [doc.id, doc.uuid]),
    );
    for (const [legacyId, nextUuid] of packLegacyIdToUuidMap.entries()) {
      packIdToUuidMap.set(legacyId, nextUuid);
    }
    const jobUpdates = [];
    for (const item of refreshedDocs) {
      if (!grantOwnerTypes.has(item.type)) continue;
      const nextGrants = remapAndNormalizeGrantEntries(
        item.system?.ability_grants,
        packUUIDMap,
        {
          ownerItem: item,
          legacyIdToUuidMap: packIdToUuidMap,
        },
      );
      if (!nextGrants) continue;
      const update = { _id: item.id, "system.ability_grants": nextGrants };
      if (
        item.type === "augment" &&
        String(item.system?.granted_ability ?? "").trim()
      ) {
        update["system.granted_ability"] = "";
      }
      jobUpdates.push(update);
    }
    if (jobUpdates.length) {
      await pack.documentClass.updateDocuments(jobUpdates, {
        pack: pack.collection,
        render: false,
      });
      updatedJobGrantUUIDs += jobUpdates.length;
    }
  }

  const worldGrantUpdates = [];
  for (const item of game.items) {
    if (!grantOwnerTypes.has(item.type)) continue;
    const nextGrants = remapAndNormalizeGrantEntries(
      item.system?.ability_grants,
      worldUUIDMap,
      {
        ownerItem: item,
        legacyIdToUuidMap: worldLegacyIdToUuidMap,
      },
    );
    if (!nextGrants) continue;

    const update = { _id: item.id, "system.ability_grants": nextGrants };
    if (
      item.type === "augment" &&
      String(item.system?.granted_ability ?? "").trim()
    ) {
      update["system.granted_ability"] = "";
    }

    worldGrantUpdates.push(update);
  }

  if (worldGrantUpdates.length) {
    await Item.updateDocuments(worldGrantUpdates, { render: false });
    updatedJobGrantUUIDs += worldGrantUpdates.length;
  }

  const worldIdToUuidMap = new Map();
  for (const worldItem of game.items) {
    worldIdToUuidMap.set(worldItem.id, worldItem.uuid);
  }
  for (const [legacyId, nextUuid] of worldLegacyIdToUuidMap.entries()) {
    worldIdToUuidMap.set(legacyId, nextUuid);
  }

  for (const actor of game.actors) {
    const toMigrate = [];
    const idMap = new Map();
    const actorUUIDMap = new Map();

    for (const item of actor.items) {
      if (!legacyAbilityTypes.has(item.type)) continue;
      toMigrate.push(item);
    }

    if (toMigrate.length) {
      const createData = toMigrate.map((item) => buildAbilityData(item));
      const created = await actor.createEmbeddedDocuments("Item", createData, {
        render: false,
      });
      createdActorItems += created.length;
      for (let i = 0; i < toMigrate.length; i++) {
        idMap.set(toMigrate[i].id, created[i].id);
        actorUUIDMap.set(toMigrate[i].uuid, created[i]?.uuid);
        if (toMigrate[i].uuid && created[i]?.uuid) {
          migratedUUIDMap.set(toMigrate[i].uuid, created[i].uuid);
        }
      }
      await actor.deleteEmbeddedDocuments(
        "Item",
        toMigrate.map((item) => item.id),
        { render: false },
      );
      deletedActorItems += toMigrate.length;
    }

    const abilityOrder = foundry.utils.deepClone(
      actor.system?.ability_order || {},
    );
    let orderChanged = false;
    for (const key of Object.keys(abilityOrder)) {
      if (!Array.isArray(abilityOrder[key])) continue;
      const next = abilityOrder[key].map((id) => idMap.get(id) ?? id);
      if (JSON.stringify(next) !== JSON.stringify(abilityOrder[key])) {
        abilityOrder[key] = next;
        orderChanged = true;
      }
    }
    if (orderChanged) {
      await actor.update(
        { "system.ability_order": abilityOrder },
        { render: false },
      );
      updatedAbilityOrders += 1;
    }

    const abilityItems = actor.items.filter((item) => item.type === "ability");
    const tagUpdates = [];
    for (const item of abilityItems) {
      const normalizedTags = ensureMigratedAbilitySubtypeTags(
        item.system?.tags,
        "primary_ability",
      );
      const currentTags = Array.isArray(item.system?.tags)
        ? item.system.tags
        : [];
      if (JSON.stringify(normalizedTags) === JSON.stringify(currentTags))
        continue;
      tagUpdates.push({ _id: item.id, "system.tags": normalizedTags });
    }
    if (tagUpdates.length) {
      await actor.updateEmbeddedDocuments("Item", tagUpdates, {
        render: false,
      });
      updatedActorTags += tagUpdates.length;
    }

    const UUIDMap = new Map([...worldUUIDMap, ...actorUUIDMap]);
    const jobUpdates = [];
    let actorJobGrantUUIDUpdates = 0;
    const actorIdToUuidMap = new Map(worldIdToUuidMap);

    for (const [oldUuid, newUuid] of actorUUIDMap.entries()) {
      const oldId = String(oldUuid).split(".").pop();
      if (oldId && newUuid) actorIdToUuidMap.set(oldId, newUuid);
    }

    for (const item of actor.items) {
      if (!grantOwnerTypes.has(item.type)) continue;
      const nextGrants = remapAndNormalizeGrantEntries(
        item.system?.ability_grants,
        UUIDMap,
        {
          ownerItem: item,
          legacyIdToUuidMap: actorIdToUuidMap,
        },
      );
      const strippedGrants = item.type === "job"
        ? getStrippedAbilityGrantItemData(
          nextGrants ?? item.system?.ability_grants,
        )
        : null;
      if (!nextGrants && !strippedGrants) continue;
      const update = {
        _id: item.id,
        "system.ability_grants": strippedGrants ?? nextGrants,
      };
      if (
        item.type === "augment" &&
        String(item.system?.granted_ability ?? "").trim()
      ) {
        update["system.granted_ability"] = "";
      }
      jobUpdates.push(update);
      if (nextGrants) actorJobGrantUUIDUpdates += 1;
      if (strippedGrants) strippedActorJobGrantItems += 1;
    }
    if (jobUpdates.length) {
      await actor.updateEmbeddedDocuments("Item", jobUpdates, {
        render: false,
      });
      updatedJobGrantUUIDs += actorJobGrantUUIDUpdates;
    }
  }

  for (const pack of getActorCompendiumPacks()) {
    await withCompendiumUnlocked(pack, async () => {
      for (const actor of await pack.getDocuments()) {
        const tagUpdates = [];
        const toMigrate = [];
        for (const item of actor.items) {
          if (item.type === "ability") {
            const normalizedTags = ensureMigratedAbilitySubtypeTags(
              item.system?.tags,
              getAbilitySubtype(item) || "primary_ability",
            );
            const currentTags = Array.isArray(item.system?.tags)
              ? item.system.tags
              : [];
            if (JSON.stringify(normalizedTags) !== JSON.stringify(currentTags)) {
              tagUpdates.push({ _id: item.id, "system.tags": normalizedTags });
            }
            continue;
          }

          if (legacyAbilityTypes.has(item.type)) toMigrate.push(item);
        }

        if (tagUpdates.length) {
          await actor.updateEmbeddedDocuments("Item", tagUpdates, {
            render: false,
          });
          updatedActorCompendiumAbilityItems += tagUpdates.length;
        }

        if (!toMigrate.length) continue;
        const createData = toMigrate.map((item) => buildEmbeddedAbilityData(item));
        await actor.deleteEmbeddedDocuments(
          "Item",
          toMigrate.map((item) => item.id),
          { render: false },
        );
        const created = await actor.createEmbeddedDocuments(
          "Item",
          createData,
          { keepId: true, render: false },
        );
        updatedActorCompendiumAbilityItems += created.length;
      }
    });
  }

  const uuidTextStats = await remapMigratedItemUUIDTextLinks(migratedUUIDMap);
  return {
    createdWorldItems,
    deletedWorldItems,
    updatedWorldTags,
    createdCompendiumItems,
    deletedCompendiumItems,
    updatedCompendiumTags,
    createdActorItems,
    deletedActorItems,
    updatedActorTags,
    updatedAbilityOrders,
    updatedJobGrantUUIDs,
    strippedActorJobGrantItems,
    updatedActorCompendiumAbilityItems,
    ...uuidTextStats,
  };
}

async function migrateLegacyShopTiers() {
  const worldItemUpdates = [];
  const actorItemUpdates = [];
  let updatedCompendiumItems = 0;
  for (const item of game.items) {
    if (!SHOP_TIER_TYPES.has(item.type)) continue;
    const nextTier = normalizeShopTier(
      item.system.shop_tier,
      item.system.shop_tier_custom,
    );
    if (
      item.system.shop_tier === nextTier.shop_tier &&
      (item.system.shop_tier_custom ?? "") === nextTier.shop_tier_custom
    )
      continue;
    worldItemUpdates.push({ item, nextTier });
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      if (!SHOP_TIER_TYPES.has(item.type)) continue;
      const nextTier = normalizeShopTier(
        item.system.shop_tier,
        item.system.shop_tier_custom,
      );
      if (
        item.system.shop_tier === nextTier.shop_tier &&
        (item.system.shop_tier_custom ?? "") === nextTier.shop_tier_custom
      )
        continue;

      updates.push({
        _id: item.id,
        "system.shop_tier": nextTier.shop_tier,
        "system.shop_tier_custom": nextTier.shop_tier_custom,
      });
    }

    if (!updates.length) continue;
    actorItemUpdates.push({ actor, updates });
  }

  if (worldItemUpdates.length) {
    const worldUpdates = worldItemUpdates.map(({ item, nextTier }) => ({
      _id: item.id,
      "system.shop_tier": nextTier.shop_tier,
      "system.shop_tier_custom": nextTier.shop_tier_custom,
    }));
    await Item.updateDocuments(worldUpdates, { render: false });
  }

  for (const { actor, updates } of actorItemUpdates) {
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
  }

  for (const pack of getMigratableItemCompendiumPacks()) {
    const docs = await pack.getDocuments();
    const updates = [];
    for (const item of docs) {
      if (!SHOP_TIER_TYPES.has(item.type)) continue;
      const nextTier = normalizeShopTier(
        item.system.shop_tier,
        item.system.shop_tier_custom,
      );
      if (
        item.system.shop_tier === nextTier.shop_tier &&
        (item.system.shop_tier_custom ?? "") === nextTier.shop_tier_custom
      )
        continue;
      updates.push({
        _id: item.id,
        "system.shop_tier": nextTier.shop_tier,
        "system.shop_tier_custom": nextTier.shop_tier_custom,
      });
    }
    if (!updates.length) continue;
    await pack.documentClass.updateDocuments(updates, {
      pack: pack.collection,
      render: false,
    });
    updatedCompendiumItems += updates.length;
  }
  return {
    updatedWorldItems: worldItemUpdates.length,
    updatedActorItems: actorItemUpdates.reduce(
      (sum, entry) => sum + entry.updates.length,
      0,
    ),
    updatedCompendiumItems,
  };
}

function _normalizeActionFormulaAttribute(rawAttribute) {
  const normalized = String(rawAttribute ?? "")
    .trim()
    .toLowerCase();
  const aliases = {
    str: "str",
    strength: "str",
    dex: "dex",
    dexterity: "dex",
    vit: "vit",
    vitality: "vit",
    int: "int",
    intelligence: "int",
    mnd: "mnd",
    mind: "mnd",
  };
  return aliases[normalized] ?? "";
}

function _extractActionFormulaAttribute(formula) {
  const source = String(formula ?? "");
  if (!source.trim()) return { formula: "", attribute: "" };

  const plusPattern = /(\s*\+\s*)@([a-z_]+)/i;
  let next = source;
  let matchedAttribute = "";

  const plusMatch = plusPattern.exec(source);
  if (plusMatch) {
    matchedAttribute = _normalizeActionFormulaAttribute(plusMatch[2]);
    if (matchedAttribute) {
      next = `${source.slice(0, plusMatch.index)}${source.slice(plusMatch.index + plusMatch[0].length)}`;
    }
  }

  if (!matchedAttribute) {
    const startPattern = /^\s*@([a-z_]+)\s*/i;
    const startMatch = startPattern.exec(source);
    if (startMatch) {
      matchedAttribute = _normalizeActionFormulaAttribute(startMatch[1]);
      if (matchedAttribute) next = source.slice(startMatch[0].length);
    }
  }

  const cleaned = String(next)
    .replace(/\s+/g, " ")
    .replace(/^\s*\+\s*/g, "")
    .replace(/\+\s*\+/g, "+")
    .trim();

  return {
    formula: cleaned,
    attribute: matchedAttribute,
  };
}

function _migrateActionFormulaFields(itemSystem) {
  const pairs = [
    { formulaKey: "hit_formula", attrKey: "hit_formula_attribute" },
    { formulaKey: "direct_formula", attrKey: "direct_formula_attribute" },
    { formulaKey: "alternate_formula", attrKey: "alternate_formula_attribute" },
    {
      formulaKey: "alternate_formula_critical",
      attrKey: "alternate_formula_critical_attribute",
    },
  ];

  const updates = {};
  let changed = false;

  for (const { formulaKey, attrKey } of pairs) {
    const formulaValue = String(itemSystem?.[formulaKey] ?? "");
    const currentAttribute = _normalizeActionFormulaAttribute(
      itemSystem?.[attrKey] ?? "",
    );

    if (currentAttribute) {
      if (itemSystem?.[attrKey] !== currentAttribute) {
        updates[`system.${attrKey}`] = currentAttribute;
        changed = true;
      }
      continue;
    }

    if (!formulaValue.trim()) continue;
    const extracted = _extractActionFormulaAttribute(formulaValue);
    if (!extracted.attribute) continue;

    if (extracted.formula !== formulaValue) {
      updates[`system.${formulaKey}`] = extracted.formula;
      changed = true;
    }
    updates[`system.${attrKey}`] = extracted.attribute;
    changed = true;
  }

  return changed ? updates : null;
}

async function migrateActionFormulaStructure() {
  const worldItemUpdates = [];
  const actorItemUpdates = [];
  let updatedCompendiumItems = 0;
  for (const item of game.items) {
    if (!ACTION_FORMULA_TYPES.has(item.type)) continue;
    const updates = _migrateActionFormulaFields(item.system);
    if (!updates) continue;
    worldItemUpdates.push({ item, updates });
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      if (!ACTION_FORMULA_TYPES.has(item.type)) continue;
      const patch = _migrateActionFormulaFields(item.system);
      if (!patch) continue;
      updates.push({ _id: item.id, ...patch });
    }

    if (!updates.length) continue;
    actorItemUpdates.push({ actor, updates });
  }

  if (worldItemUpdates.length) {
    const worldUpdates = worldItemUpdates.map(({ item, updates }) => ({
      _id: item.id,
      ...updates,
    }));
    await Item.updateDocuments(worldUpdates, { render: false });
  }

  for (const { actor, updates } of actorItemUpdates) {
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
  }

  for (const pack of getMigratableItemCompendiumPacks()) {
    const docs = await pack.getDocuments();
    const updates = [];
    for (const item of docs) {
      if (!ACTION_FORMULA_TYPES.has(item.type)) continue;
      const patch = _migrateActionFormulaFields(item.system);
      if (!patch) continue;
      updates.push({ _id: item.id, ...patch });
    }
    if (!updates.length) continue;
    await pack.documentClass.updateDocuments(updates, {
      pack: pack.collection,
      render: false,
    });
    updatedCompendiumItems += updates.length;
  }
  return {
    updatedWorldItems: worldItemUpdates.length,
    updatedActorItems: actorItemUpdates.reduce(
      (sum, entry) => sum + entry.updates.length,
      0,
    ),
    updatedCompendiumItems,
  };
}

function getFFXIVTheme() {
  if (game.settings.get("ffxiv", "overrideColorScheme")) return "blue";
  return (
    game.settings.get("core", "uiConfig").colorScheme.applications ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light")
  );
}

function applyFFXIVChatTheme(element) {
  const chatElement = element instanceof HTMLElement ? element : element?.[0];
  if (!chatElement) return;

  const theme = getFFXIVTheme();
  chatElement.classList.add("chat-ffxiv", `${theme}_theme`);
}

function isFFXIVItemHotbarDrop(data) {
  if (data?.type !== "Item") return false;
  return Boolean(data.uuid || (data.actorId && data.itemId));
}

async function createItemMacro(data, slot) {
  if (data.type !== "Item") return;

  const uuid =
    data.uuid ||
    (data.actorId && data.itemId
      ? `Actor.${data.actorId}.Item.${data.itemId}`
      : null);
  if (!uuid) return;

  const item = await fromUuid(uuid);
  if (!item)
    return ui.notifications.warn(
      game.i18n.localize("FFXIV.Notifications.MacroItemMissing"),
    );
  const folder = await getPlayerMacroFolder(item);

  const command = `const item = await fromUuid("${uuid}");
if (!item) return ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.MacroItemMissing"));
return item.roll?.();`;

  let macro = game.macros.find(
    (m) =>
      m.name === item.name &&
      m.command === command &&
      m.folder?.id === folder?.id,
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command,
      folder: folder?.id,
      flags: { ffxiv: { itemUuid: uuid } },
    });
  }

  game.user.assignHotbarMacro(macro, slot);
  return false;
}

async function deletePairedItemMacros(item) {
  if (item?.type !== "ability") return;
  if (item.parent?.documentName !== "Actor") return;

  const uuid = String(item.uuid ?? "").trim();
  if (!uuid) return;

  const macros = game.macros.filter(
    (macro) => String(macro.getFlag("ffxiv", "itemUuid") ?? "") === uuid,
  );
  if (!macros.length) return;

  for (const macro of macros) {
    await macro.delete();
  }
}

async function getPlayerMacroFolder(item) {
  const parentFolder = await getOrCreateMacroFolder("Player Macros");
  const actorName =
    item.parent?.documentName === "Actor"
      ? item.parent.name
      : game.user.character?.name || game.user.name;
  return getOrCreateMacroFolder(actorName, parentFolder);
}

async function getOrCreateMacroFolder(name, parent = null) {
  const parentId = parent?.id ?? null;
  const existing = game.folders.find(
    (folder) =>
      folder.type === "Macro" &&
      folder.name === name &&
      (folder.folder?.id ?? folder.parent ?? null) === parentId,
  );
  if (existing) return existing;

  return Folder.create({
    name,
    type: "Macro",
    folder: parentId,
  });
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
  refreshOwnedItemActorSheets(item, { preserveTopWindow: true }).catch((err) =>
    debugError("FFXIV | Failed to refresh actor sheet after item update", err),
  );
});

Hooks.on("closeItemSheet", (app) => {
  refreshOwnedItemActorSheets(app?.item).catch((err) =>
    debugError(
      "FFXIV | Failed to refresh actor sheet after item sheet close",
      err,
    ),
  );
});

async function refreshOwnedItemActorSheets(
  item,
  { preserveTopWindow = false } = {},
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
    await sheet.render({ force: true, focus: false });
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
  document
    .querySelector("section#chat.sidebar-tab")
    ?.classList.add("chat-ffxiv", `${getFFXIVTheme()}_theme`);
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
    manaInput.value = String(Math.max(0, Math.min(manaValue, manaMax)));
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
        const nextValue = Math.max(0, Math.min(next, manaCap));
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

function installTokenBarrierOverlay() {
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

function installTokenBarColors() {
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

function installTokenStatusStackCounterOverlay() {
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

async function refreshAllTokenStatusStackCounters() {
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

function refreshActorTokenBars(actor) {
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

function renderCombatStepIndicators(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  element
    .querySelectorAll(".ffxiv-combat-step-indicator")
    .forEach((indicator) => indicator.remove());

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  const turns = combat?.turns ?? [];
  if (!turns.length) return;

  const combatantElements = new Map();
  const combatantRows = element.querySelectorAll("[data-combatant-id]");
  for (const combatantElement of combatantRows) {
    const combatantId = combatantElement.dataset.combatantId;
    if (combatantId) combatantElements.set(combatantId, combatantElement);
  }
  if (!combatantElements.size) return;

  let currentStep = null;
  let previousElement = null;
  for (const combatant of turns) {
    const combatantElement = combatantElements.get(combatant.id);
    if (!combatantElement) continue;

    const step = getTurnStep(combatant);
    if (step !== currentStep) {
      if (previousElement) {
        previousElement.after(createCombatStepIndicator(
          currentStep,
          "end",
          previousElement,
        ));
      }
      combatantElement.before(createCombatStepIndicator(
        step,
        "start",
        combatantElement,
      ));
      currentStep = step;
    }
    previousElement = combatantElement;
  }

  if (previousElement) {
    previousElement.after(createCombatStepIndicator(
      currentStep,
      "end",
      previousElement,
    ));
  }
}

function renderCombatTrackerStatusStacks(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  if (!combat?.combatants?.size) return;

  const combatantElements = element.querySelectorAll("[data-combatant-id]");
  for (const combatantElement of combatantElements) {
    const combatant = combat.combatants.get(
      combatantElement.dataset.combatantId,
    );
    if (!combatant?.actor) continue;
    decorateCombatantStatusStacks(combatantElement, combatant.actor);
  }
}

function decorateCombatantStatusStacks(combatantElement, actor) {
  const effects = combatantElement.querySelector(
    ".token-effects, .combatant-effects, .effects",
  );
  if (!(effects instanceof HTMLElement)) return;

  effects
    .querySelectorAll(".ffxiv-combat-status-stack")
    .forEach((counter) => counter.remove());

  const statusEffects = new Map(
    (CONFIG.statusEffects ?? []).map((effect) => [effect.id, effect]),
  );
  for (const statusId of actor.statuses ?? []) {
    if (!isStackableStatusEffect(statusId)) continue;
    const status = statusEffects.get(statusId);
    const icon = getCombatTrackerStatusIcon(effects, statusId, status);
    if (!(icon instanceof HTMLImageElement)) continue;
    const label = game.i18n.localize(status?.name ?? status?.label ?? statusId);
    const count = getStatusStackCount(actor, statusId);
    if (count <= 1) {
      icon.title = label;
      icon.setAttribute("data-tooltip", label);
      continue;
    }

    const wrapper =
      icon.parentElement?.classList.contains("ffxiv-combat-status")
        ? icon.parentElement
        : document.createElement("span");
    if (wrapper !== icon.parentElement) {
      wrapper.className = "ffxiv-combat-status";
      icon.before(wrapper);
      wrapper.appendChild(icon);
    }

    const counter = document.createElement("span");
    counter.className = "ffxiv-combat-status-stack";
    counter.textContent = String(count);
    wrapper.appendChild(counter);

    icon.title = `${label} (x${count})`;
    icon.setAttribute("data-tooltip", `${label} (x${count})`);
  }
}

function getCombatTrackerStatusIcon(effects, statusId, status) {
  const icons = Array.from(effects.querySelectorAll("img"));
  return icons.find((icon) => {
    const iconStatusId = String(
      icon.dataset.statusId ?? icon.dataset.status ?? "",
    );
    if (iconStatusId === statusId) return true;
    const src = String(icon.getAttribute("src") ?? icon.src ?? "");
    return Boolean(status?.img && src.includes(status.img)) ||
      Boolean(status?.icon && src.includes(status.icon));
  });
}

function renderCombatTrackerOrderControls(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  const turns = combat?.turns ?? [];
  if (!turns.length) return;

  const stepIndexes = new Map();
  for (const combatant of turns) {
    const step = getTurnStep(combatant);
    if (!stepIndexes.has(step)) stepIndexes.set(step, []);
    stepIndexes.get(step).push(combatant.id);
  }

  const combatantElements = element.querySelectorAll("[data-combatant-id]");
  for (const combatantElement of combatantElements) {
    const combatantId = combatantElement.dataset.combatantId;
    const combatant = combat.combatants.get(combatantId);
    if (!combatant) continue;

    const controls = getCombatTrackerInitiativeElement(combatantElement);
    if (!(controls instanceof HTMLElement)) continue;

    const stepIds = stepIndexes.get(getTurnStep(combatant)) ?? [];
    const index = stepIds.indexOf(combatant.id);
    controls.replaceChildren(
      createCombatOrderButton(combat, combatant, -1, index <= 0),
      createCombatOrderButton(
        combat,
        combatant,
        1,
        index === -1 || index >= stepIds.length - 1,
      ),
    );
    controls.classList.add("ffxiv-combat-order-controls");
  }
}

function getCombatTrackerInitiativeElement(combatantElement) {
  const element = combatantElement.querySelector(
    ".token-initiative, .combatant-initiative, .initiative",
  );
  if (element instanceof HTMLElement) return element;

  const controls = document.createElement("div");
  controls.className = "token-initiative";
  combatantElement.appendChild(controls);
  return controls;
}

function createCombatOrderButton(combat, combatant, direction, unavailable) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ffxiv-combat-order-button";
  button.disabled = unavailable || !game.user.isGM;
  button.dataset.direction = String(direction);
  button.title = game.i18n.localize(
    direction < 0 ? "FFXIV.Combat.MoveUp" : "FFXIV.Combat.MoveDown",
  );

  const icon = document.createElement("i");
  icon.className = direction < 0 ? "fas fa-chevron-up" : "fas fa-chevron-down";
  button.appendChild(icon);

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    await combat.reorderCombatant(combatant.id, direction);
  });

  return button;
}

function installCarouselCombatTrackerStepIndicators(api = null) {
  if (globalThis.__ffxivCarouselCombatStepIndicatorsInstalled) return;
  if (game.modules.get("combat-tracker-dock")?.active !== true) return;

  const CombatDockClass = api?.CombatDock ?? CONFIG.combatTrackerDock?.CombatDock;
  if (!CombatDockClass?.prototype) return;
  globalThis.__ffxivCarouselCombatStepIndicatorsInstalled = true;

  const render = (dock) => renderCarouselCombatStepIndicators(dock);
  for (const method of ["setupCombatants", "updateOrder", "updateCombatant"]) {
    const original = CombatDockClass.prototype[method];
    if (typeof original !== "function") continue;
    CombatDockClass.prototype[method] = function ffxivWrappedCombatDockMethod(
      ...args
    ) {
      const result = original.apply(this, args);
      render(this);
      return result;
    };
  }
  renderCarouselCombatStepIndicators(ui.combatDock);
}

function renderCarouselCombatStepIndicators(dock) {
  const container = dock?.element?.querySelector?.("#combatants");
  if (!(container instanceof HTMLElement)) return;

  container
    .querySelectorAll(".ffxiv-carousel-combat-step-indicator")
    .forEach((indicator) => indicator.remove());

  const combatants = dock.sortedCombatants ?? dock.combat?.turns ?? [];
  if (!combatants.length) return;

  const portraitElements = new Map();
  for (const portrait of dock.portraits ?? []) {
    if (portrait?.combatant?.id && portrait.element instanceof HTMLElement) {
      portraitElements.set(portrait.combatant.id, portrait.element);
    }
  }
  for (const element of container.querySelectorAll("[data-combatant-id]")) {
    const combatantId = element.dataset.combatantId;
    if (combatantId && !portraitElements.has(combatantId)) {
      portraitElements.set(combatantId, element);
    }
  }

  const orderedEntries = combatants
    .map((combatant) => {
      const element = portraitElements.get(combatant.id);
      if (!(element instanceof HTMLElement)) return null;
      return {
        combatant,
        element,
        order: getCarouselCombatantElementOrder(element),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  if (!orderedEntries.length) return;

  let currentStep = null;
  let previousEntry = null;
  for (const entry of orderedEntries) {
    const step = getTurnStep(entry.combatant);
    if (step !== currentStep) {
      if (previousEntry) {
        container.appendChild(createCarouselCombatStepBoundary(
          currentStep,
          step,
          previousEntry.order,
          dock,
        ));
      } else {
        container.appendChild(createCarouselCombatStepIndicator(
          step,
          "start",
          entry.order - 1,
          dock,
        ));
      }
      currentStep = step;
    }
    previousEntry = entry;
  }

  if (previousEntry) {
    container.appendChild(createCarouselCombatStepIndicator(
      currentStep,
      "end",
      previousEntry.order + 1,
      dock,
    ));
    moveCarouselRoundSeparatorAfterStepEnd(container, previousEntry.order + 2);
  }
}

function getCarouselCombatantElementOrder(element) {
  const order = Number.parseFloat(element.style.order);
  if (Number.isFinite(order)) return order;
  return Array.prototype.indexOf.call(
    element.parentElement?.children ?? [],
    element,
  );
}

function createCarouselCombatStepIndicator(step, position, order, dock) {
  const element = document.createElement("div");
  element.classList.add("separator", "ffxiv-carousel-combat-step-indicator");
  element.classList.add(`ffxiv-combat-step-${position}`);
  element.classList.add(dock?.isVertical ? "vertical" : "horizontal");
  element.dataset.step = String(step);
  element.setAttribute("role", "presentation");
  element.title = getCombatStepIndicatorLabel(step, position);
  element.style.order = String(order);
  return element;
}

function createCarouselCombatStepBoundary(previousStep, nextStep, order, dock) {
  const element = document.createElement("div");
  element.classList.add(
    "separator",
    "ffxiv-carousel-combat-step-indicator",
    "ffxiv-carousel-combat-step-boundary",
  );
  element.classList.add(dock?.isVertical ? "vertical" : "horizontal");
  element.dataset.previousStep = String(previousStep);
  element.dataset.nextStep = String(nextStep);
  element.style.setProperty(
    "--ffxiv-previous-step-color",
    getCarouselCombatStepColor(previousStep),
  );
  element.style.setProperty(
    "--ffxiv-next-step-color",
    getCarouselCombatStepColor(nextStep),
  );
  element.setAttribute("role", "presentation");
  element.title = `${getCombatStepIndicatorLabel(
    previousStep,
    "end",
  )} / ${getCombatStepIndicatorLabel(nextStep, "start")}`;
  element.style.order = String(order);
  return element;
}

function getCarouselCombatStepColor(step) {
  return step === 0 ? "#54ad24" : "#c12c2c";
}

function getCombatStepIndicatorLabel(step, position) {
  const stepLabel = step === 0
    ? game.i18n.localize("FFXIV.Combat.AdventurerStep")
    : game.i18n.localize("FFXIV.Combat.EnemyStep");
  return position === "start"
    ? stepLabel
    : game.i18n.format("FFXIV.Combat.StepEnd", { step: stepLabel });
}

function moveCarouselRoundSeparatorAfterStepEnd(container, order) {
  const separator = container.querySelector(
    ".separator:not(.ffxiv-carousel-combat-step-indicator)",
  );
  if (separator instanceof HTMLElement) {
    separator.style.order = String(order);
  }
}

async function syncCombatantKnockedOutStatus(combatant) {
  const actor = combatant?.actor;
  if (!actor) return;

  const flagKey = "knockedOutFromDefeated";
  if (combatant.defeated) {
    if (!hasStatus(actor, "knocked_out")) {
      await applyStatusEffectChange(actor, "knocked_out", true);
      if (hasStatus(actor, "knocked_out")) {
        await combatant.setFlag("ffxiv", flagKey, true);
      }
    }
    return;
  }

  if (combatant.getFlag("ffxiv", flagKey) !== true) return;
  await combatant.unsetFlag("ffxiv", flagKey);
  if (hasStatus(actor, "knocked_out")) {
    await applyStatusEffectChange(actor, "knocked_out", false);
  }
}

function createCombatStepIndicator(step, position, combatantElement) {
  const tagName = combatantElement?.tagName === "LI" ? "li" : "div";
  const element = document.createElement(tagName);
  element.classList.add(
    "ffxiv-combat-step-indicator",
    `ffxiv-combat-step-${position}`,
  );
  element.dataset.step = String(step);
  element.setAttribute("role", "presentation");
  element.textContent = getCombatStepIndicatorLabel(step, position);
  return element;
}

function getHookHTMLElement(html, app) {
  return html instanceof HTMLElement
    ? html
    : html?.[0] instanceof HTMLElement
      ? html[0]
      : html?.element instanceof HTMLElement
        ? html.element
        : html?.element?.[0] instanceof HTMLElement
          ? html.element[0]
          : app?.element instanceof HTMLElement
            ? app.element
            : app?.element?.[0] instanceof HTMLElement
              ? app.element[0]
              : null;
}

const FFXIV_MARKER_SOCKET_TYPE = "placeMarkerTile";
const markerDialogs = new WeakSet();

Hooks.on("getSceneControlButtons", (controls) => {
  if (game.user?.isGM) {
    controls.ffxivLimitBreak = {
      name: "ffxivLimitBreak",
      title: game.i18n.localize("FFXIV.LimitBreak.Control"),
      icon: "fa-regular fa-swords",
      order: (Number(controls.walls?.order) || 4) - 0.1,
      visible: true,
      active: isLimitBreakActive(),
      onChange: async (_event, active) => {
        if (!active) return;
        await toggleLimitBreakGauge();
      },
    };
  }

  if (!controls.tiles?.tools) return;
  controls.tiles.visible = true;

  const markerTool = {
    name: "ffxivMarker",
    title: game.i18n.localize("FFXIV.MarkerPlacement.Title"),
    icon: "fas fa-map-marker-alt",
    visible: true,
    button: true,
    onChange: async (_event, active) => {
      if (!active) return;
      await openMarkerPlacementTool();
    },
  };
  controls.tiles.tools = insertSceneToolAfterSelect(
    controls.tiles.tools,
    "ffxivMarker",
    markerTool,
  );
});

function insertSceneToolAfterSelect(tools, toolKey, tool) {
  const entries = Object.entries(tools).filter(([key]) => key !== toolKey);
  const selectIndex = entries.findIndex(([key, value]) => {
    const name = value?.name ?? key;
    return name === "select" || name === "selectTile" || name === "tilesSelect";
  });
  const insertIndex = selectIndex >= 0 ? selectIndex + 1 : entries.length;
  entries.splice(insertIndex, 0, [toolKey, tool]);
  return Object.fromEntries(entries);
}

async function toggleLimitBreakGauge() {
  if (!game.user?.isGM) return;

  if (isLimitBreakActive()) {
    await deactivateLimitBreakGauge();
    refreshSceneControls();
    restoreDefaultSceneControl();
    return;
  }

  const max = await promptLimitBreakMax();
  if (!max) {
    refreshSceneControls();
    restoreDefaultSceneControl();
    return;
  }

  await activateLimitBreakGauge(max);
  refreshSceneControls();
  restoreDefaultSceneControl();
}

async function promptLimitBreakMax() {
  let max = getLimitBreakMax();
  const content = `
    <form class="ffxiv-limit-break-dialog">
      <div class="form-group">
        <label for="ffxiv-limit-break-max">${game.i18n.localize("FFXIV.LimitBreak.Segments")}</label>
        <input id="ffxiv-limit-break-max" type="number" name="max" min="1" max="10" step="1" value="${max}">
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
    },
  });

  if (!confirmed) return null;
  return Math.max(1, Math.min(10, Number(max) || 3));
}

function refreshSceneControls() {
  globalThis.ui?.controls?.render?.({ force: true });
}

function restoreDefaultSceneControl() {
  const controls = globalThis.ui?.controls;
  const fallback = controls?.controls?.tokens
    ? "tokens"
    : controls?.controls?.token
      ? "token"
      : controls?.controls?.tiles
        ? "tiles"
        : null;
  if (fallback) controls.activate?.({ control: fallback });
}

async function openMarkerPlacementTool() {
  if (!canvas.scene) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"),
    );
    return;
  }

  const marker = await configureMarkerShape();
  if (!marker) return;

  const gridSize = canvas.grid.size;
  const rendered = renderMarkerDataUrl(marker, gridSize);
  if (!rendered) {
    ui.notifications.warn(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.EmptyShape"),
    );
    return;
  }

  try {
    if (marker.targeted) {
      ui.notifications.info(
        game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToken"),
      );
      const target = await previewTargetedMarkerPlacement(rendered);
      if (!target) return;
      await requestMarkerTileCreation({
        texture: createMarkerTileTexture(rendered.src),
        x: target.x,
        y: target.y,
        width: rendered.width,
        height: rendered.height,
        z: 100,
        rotation: 0,
        hidden: false,
        locked: false,
        flags: {
          ffxiv: {
            markerPlacement: {
              mode: marker.mode,
              targeted: true,
              tokenId: target.token.document.id,
            },
          },
        },
      });
      return;
    }

    ui.notifications.info(
      game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToPlace"),
    );
    const position = await previewMarkerPlacement(rendered);
    if (!position) return;
    await requestMarkerTileCreation({
      texture: createMarkerTileTexture(rendered.src),
      x: position.x,
      y: position.y,
      width: rendered.width,
      height: rendered.height,
      z: 100,
      rotation: 0,
      hidden: false,
      locked: false,
      flags: {
        ffxiv: {
          markerPlacement: {
            mode: marker.mode,
            targeted: false,
          },
        },
      },
    });
  } catch (err) {
    debugError("Marker placement failed:", err);
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.TileFailed"),
    );
  }
}

async function requestMarkerTileCreation(tileData) {
  if (game.user.isGM)
    return createMarkerTileFromRequest({
      sceneId: canvas.scene.id,
      tileData,
    });

  const gm = game.users.find((user) => user.active && user.isGM);
  if (!gm) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoGM"),
    );
    return null;
  }

  game.socket.emit("system.ffxiv", {
    type: FFXIV_MARKER_SOCKET_TYPE,
    userName: game.user.name,
    gmUserId: gm.id,
    data: {
      sceneId: canvas.scene.id,
      tileData,
    },
  });
  ui.notifications.info(
    game.i18n.localize("FFXIV.MarkerPlacement.Instructions.RequestSent"),
  );
  return null;
}

async function createMarkerTileFromRequest({ sceneId, tileData }) {
  return createMarkerTile(sceneId, foundry.utils.deepClone(tileData));
}

function createMarkerTileTexture(src) {
  return {
    src,
    anchorX: 0,
    anchorY: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

async function createMarkerTile(sceneId, tileData) {
  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found.`);
  const result = await scene.createEmbeddedDocuments("Tile", [tileData]);
  return result[0] ?? null;
}

async function configureMarkerShape() {
  const size = 15;
  const center = Math.floor(size / 2);
  const state = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  for (let y = center - 2; y <= center + 2; y++) {
    for (let x = center - 2; x <= center + 2; x++) state[y][x] = true;
  }
  let selection = {
    state,
    opacity: 0.8,
    type: "enemy",
    mode: "standard",
    targeted: false,
  };
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <style>
      .ffxiv-marker-config { display: flex; gap: 16px; overflow-x: auto; }
      .ffxiv-marker-panel { display: flex; flex-direction: column; gap: 8px; }
      .ffxiv-marker-row { display: flex; align-items: center; gap: 8px; }
      .ffxiv-marker-grid { display: grid; grid-template-columns: repeat(${size}, 24px); }
      .ffxiv-marker-cell { width: 24px; height: 24px; border: 1px solid #888; background: #222; cursor: pointer; }
      .ffxiv-marker-cell.selected.enemy { background: orange; }
      .ffxiv-marker-cell.selected.allied { background: #66ffff; }
      .ffxiv-marker-presets { display: flex; flex-direction: column; gap: 8px; }
      .ffxiv-marker-preset-row { display: flex; gap: 8px; }
	      .ffxiv-marker-preview { overflow: hidden; max-width: 260px; max-height: 260px; border: 0; background: transparent; width: fit-content; height: fit-content; padding: 6px; }
      .ffxiv-marker-preview canvas { display: block; }
    </style>
    <div class="ffxiv-marker-config" style="display: flex; gap: 16px; overflow-x: auto; align-items: flex-start;">
      <div class="ffxiv-marker-panel" style="display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto;">
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Source")}</label>
          <select id="ffxiv-marker-type">
            <option value="enemy" selected>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Enemy")}</option>
            <option value="allied">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Ally")}</option>
          </select>
        </div>
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Opacity")}</label>
          <input type="range" id="ffxiv-marker-opacity" min="0" max="100" value="80">
          <span id="ffxiv-marker-opacity-value">80%</span>
        </div>
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Mode")}</label>
          <select id="ffxiv-marker-mode">
            <option value="standard" selected>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Standard")}</option>
            <option value="stack">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Stack")}</option>
            <option value="knockback">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Knockback")}</option>
            <option value="tankbuster">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Tankbuster")}</option>
          </select>
        </div>
        <label class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="ffxiv-marker-targeted">
          ${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Targeted")}
        </label>
        <div class="ffxiv-marker-grid" style="display: grid; grid-template-columns: repeat(${size}, 24px); flex: 0 0 auto;">
          ${state
      .flatMap((row, y) =>
        row.map(
          (_on, x) =>
            `<div class="ffxiv-marker-cell" data-x="${x}" data-y="${y}" style="width: 24px; height: 24px; box-sizing: border-box; border: 1px solid #888; background: ${state[y][x] ? "orange" : "#222"}; cursor: pointer;"></div>`,
        ),
      )
      .join("")}
        </div>
      </div>
      <div class="ffxiv-marker-panel" style="display: flex; flex-direction: column; gap: 8px; flex: 0 0 260px;">
        <strong>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Presets")}</strong>
	        <div class="ffxiv-marker-presets" style="display: flex; flex-direction: column; gap: 8px;">
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="standard">Standard 3x3</button>
	            <button type="button" data-span="2" data-mode="standard">Standard 5x5</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-circle-span="2" data-mode="standard">Circle 5x5</button>
	            <button type="button" data-circle-span="3" data-mode="standard">Circle 7x7</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="stack">Stack 3x3</button>
	            <button type="button" data-span="2" data-mode="stack">Stack 5x5</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="knockback">Knockback 3x3</button>
	            <button type="button" data-span="2" data-mode="knockback">Knockback 5x5</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="tankbuster">Tank Buster 3x3</button>
	            <button type="button" data-span="2" data-mode="tankbuster">Tank Buster 5x5</button>
	          </div>
        </div>
        <strong>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Preview")}</strong>
	        <div class="ffxiv-marker-preview" style="overflow: hidden; max-width: 260px; max-height: 260px; border: 0; background: transparent; width: fit-content; height: fit-content; padding: 6px;"><canvas id="ffxiv-marker-preview" style="display: block;"></canvas></div>
      </div>
    </div>`;

  initializeMarkerShapeDialog(
    wrapper,
    null,
    state,
    center,
    (selectionValue) => {
      selection = selectionValue;
    },
  );
  const confirmed = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.localize("FFXIV.MarkerPlacement.Title"),
      resizable: true,
    },
    position: { width: 760 },
    content: wrapper,
    buttons: [
      {
        action: "create",
        label: game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Button.Place"),
        icon: "fas fa-check",
        default: true,
        callback: () => true,
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fas fa-times",
        callback: () => false,
      },
    ],
    render: (app, html) => {
      initializeMarkerShapeDialog(
        app,
        html,
        state,
        center,
        (selectionValue) => {
          selection = selectionValue;
        },
      );
    },
  });

  if (!confirmed) return null;
  return selection;
}

function initializeMarkerShapeDialog(
  app,
  html,
  state,
  center,
  setSelection,
  dialogKey,
) {
  const element = getDialogElement(app, html, dialogKey);
  if (!element) return false;
  if (markerDialogs.has(element)) return true;
  markerDialogs.add(element);
  const cells = Array.from(element.querySelectorAll(".ffxiv-marker-cell"));
  const type = element.querySelector("#ffxiv-marker-type");
  const opacity = element.querySelector("#ffxiv-marker-opacity");
  const opacityValue = element.querySelector("#ffxiv-marker-opacity-value");
  const mode = element.querySelector("#ffxiv-marker-mode");
  const targeted = element.querySelector("#ffxiv-marker-targeted");
  const preview = element.querySelector("#ffxiv-marker-preview");
  const previewContainer = preview.closest(".ffxiv-marker-preview");
  if (
    !cells.length ||
    !type ||
    !opacity ||
    !opacityValue ||
    !mode ||
    !targeted ||
    !preview
  ) {
    markerDialogs.delete(element);
    return false;
  }
  const updateSelection = () => {
    setSelection({
      state,
      opacity: Number(opacity.value) / 100,
      type: type.value,
      mode: mode.value,
      targeted: targeted.checked,
    });
  };

  const updateCells = () => {
    for (const cell of cells) {
      const on = state[Number(cell.dataset.y)][Number(cell.dataset.x)];
      cell.classList.toggle("selected", on);
      cell.classList.toggle("enemy", on && type.value === "enemy");
      cell.classList.toggle("allied", on && type.value === "allied");
      cell.style.background = !on
        ? "#222"
        : type.value === "enemy"
          ? "orange"
          : "#66ffff";
    }
  };
  const updatePreview = () => {
    updateSelection();
    const rendered = renderMarkerDataUrl(
      {
        state,
        opacity: Number(opacity.value) / 100,
        type: type.value,
        mode: mode.value,
        targeted: targeted.checked,
      },
      Math.max(24, Math.round(canvas.grid.size / 3)),
    );
    if (!rendered) {
      preview.width = 1;
      preview.height = 1;
      if (previewContainer) {
        previewContainer.style.width = "fit-content";
        previewContainer.style.height = "fit-content";
      }
      return;
    }
    preview.width = rendered.width;
    preview.height = rendered.height;
    const displayWidth = Math.min(220, rendered.width);
    const displayHeight = rendered.height * (displayWidth / rendered.width);
    preview.style.width = `${displayWidth}px`;
    preview.style.height = `${displayHeight}px`;
    if (previewContainer) {
      previewContainer.style.width = `${displayWidth + 12}px`;
      previewContainer.style.height = `${Math.min(260, displayHeight + 12)}px`;
      previewContainer.style.background = "transparent";
      previewContainer.style.border = "0";
      previewContainer.style.overflow = "hidden";
      previewContainer.style.padding = "6px";
    }
    const ctx = preview.getContext("2d");
    ctx.clearRect(0, 0, preview.width, preview.height);
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.drawImage(image, 0, 0);
    };
    image.src = rendered.src;
  };
  const configurePreset = (span, presetMode) => {
    for (const row of state) row.fill(false);
    for (let y = center - span; y <= center + span; y++) {
      for (let x = center - span; x <= center + span; x++) state[y][x] = true;
    }
    mode.value = presetMode;
    type.disabled = presetMode === "tankbuster";
    updateCells();
    updatePreview();
  };
  const configureCirclePreset = (span, presetMode) => {
    for (const row of state) row.fill(false);
    if (span === 1) {
      state[center][center] = true;
      state[center - 1][center] = true;
      state[center + 1][center] = true;
      state[center][center - 1] = true;
      state[center][center + 1] = true;
      mode.value = presetMode;
      type.disabled = presetMode === "tankbuster";
      updateCells();
      updatePreview();
      return;
    }
    const radius = span + 0.5;
    for (let y = center - span; y <= center + span; y++) {
      for (let x = center - span; x <= center + span; x++) {
        state[y][x] = Math.hypot(x - center, y - center) < radius;
      }
    }
    mode.value = presetMode;
    type.disabled = presetMode === "tankbuster";
    updateCells();
    updatePreview();
  };

  let dragging = false;
  let initial = false;
  const toggleCell = (cell) => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    state[y][x] = !state[y][x];
    updateCells();
    updatePreview();
  };

  for (const cell of cells) {
    cell.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      initial = state[Number(cell.dataset.y)][Number(cell.dataset.x)];
      toggleCell(cell);
    });
    cell.addEventListener("pointerenter", () => {
      if (!dragging) return;
      if (state[Number(cell.dataset.y)][Number(cell.dataset.x)] === initial)
        toggleCell(cell);
    });
  }
  window.addEventListener("pointerup", () => (dragging = false), {
    signal: html?.options?.signal,
  });
  element.querySelectorAll("[data-span][data-mode]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      configurePreset(Number(button.dataset.span), button.dataset.mode);
    });
  });
  element
    .querySelectorAll("[data-circle-span][data-mode]")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        configureCirclePreset(
          Number(button.dataset.circleSpan),
          button.dataset.mode,
        );
      });
    });
  opacity.addEventListener("input", () => {
    opacityValue.textContent = `${opacity.value}%`;
    updatePreview();
  });
  type.addEventListener("change", () => {
    updateCells();
    updatePreview();
  });
  mode.addEventListener("change", () => {
    type.disabled = mode.value === "tankbuster";
    updatePreview();
  });
  targeted.addEventListener("change", updatePreview);
  updateCells();
  updatePreview();
  return true;
}

function getDialogElement(app, html, dialogKey) {
  const keyedElement = dialogKey
    ? document.querySelector(`[data-ffxiv-marker-dialog="${dialogKey}"]`)
    : null;
  const visibleMarkerElements = Array.from(
    document.querySelectorAll(".ffxiv-marker-config"),
  ).filter((element) => element.offsetParent !== null);
  const candidates = [
    keyedElement,
    html,
    html?.element,
    html?.element?.[0],
    html?.target,
    html?.currentTarget,
    html?.[0],
    app,
    app?.element,
    app?.element?.[0],
    app?.target,
    app?.currentTarget,
    app?.[0],
    visibleMarkerElements.at(-1),
    visibleMarkerElements
      .at(-1)
      ?.closest(".app, .application, .window-app, .dialog"),
  ];

  return (
    candidates.find(
      (element) =>
        element instanceof HTMLElement &&
        element.querySelector?.("#ffxiv-marker-preview"),
    ) ?? null
  );
}

function renderMarkerDataUrl(marker, gridSize) {
  const bounds = getMarkerBounds(marker.state);
  if (!bounds) return null;
  const cropped = marker.state
    .slice(bounds.minY, bounds.maxY + 1)
    .map((row) => row.slice(bounds.minX, bounds.maxX + 1));
  const widthCells = cropped[0].length;
  const heightCells = cropped.length;
  const width = widthCells * gridSize;
  const height = heightCells * gridSize;
  const canvasElement = document.createElement("canvas");
  canvasElement.width = width;
  canvasElement.height = height;
  const ctx = canvasElement.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const isOn = (x, y) =>
    y >= 0 && y < heightCells && x >= 0 && x < widthCells && cropped[y][x];
  const baseColor =
    marker.mode === "tankbuster"
      ? "firebrick"
      : marker.type === "enemy"
        ? "orange"
        : "#66ffff";

  ctx.globalAlpha = marker.opacity;
  ctx.fillStyle = baseColor;
  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      if (!cropped[y][x]) continue;
      drawMarkerCell(ctx, x * gridSize, y * gridSize, gridSize, [
        isOn(x, y - 1),
        isOn(x - 1, y),
        isOn(x + 1, y),
        isOn(x, y + 1),
      ]);
      ctx.fill();
    }
  }

  drawMarkerOverlays(ctx, cropped, width, height, gridSize, marker);
  return {
    src: canvasElement.toDataURL("image/webp"),
    width,
    height,
    widthCells,
    heightCells,
  };
}

function getMarkerBounds(state) {
  let minX = state[0].length;
  let minY = state.length;
  let maxX = -1;
  let maxY = -1;
  state.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }),
  );
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function drawMarkerCell(ctx, x, y, size, [top, left, right, bottom]) {
  const radius = size / 4;
  ctx.beginPath();
  ctx.moveTo(x + (top || left ? 0 : radius), y);
  if (!top && !left) ctx.arcTo(x, y, x, y + radius, radius);
  ctx.lineTo(x, y + (bottom || left ? size : size - radius));
  if (!bottom && !left) ctx.arcTo(x, y + size, x + radius, y + size, radius);
  ctx.lineTo(x + (bottom || right ? size : size - radius), y + size);
  if (!bottom && !right)
    ctx.arcTo(x + size, y + size, x + size, y + size - radius, radius);
  ctx.lineTo(x + size, y + (top || right ? 0 : radius));
  if (!top && !right) ctx.arcTo(x + size, y, x + size - radius, y, radius);
  ctx.closePath();
}

function drawMarkerOverlays(ctx, cropped, width, height, gridSize, marker) {
  const widthCells = cropped[0].length;
  const heightCells = cropped.length;
  const centerX = Math.floor(widthCells / 2);
  const centerY = Math.floor(heightCells / 2);

  if (marker.mode === "stack") {
    for (const { dx, dy } of [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ]) {
      for (let step = 1; step <= 2; step++) {
        const x = centerX + dx * step;
        const y = centerY + dy * step;
        if (!cropped[y]?.[x]) break;
        drawMarkerArrow(
          ctx,
          x * gridSize + gridSize / 2,
          y * gridSize + gridSize / 2,
          width / 2,
          height / 2,
          gridSize * 0.4,
          "yellow",
          step === 1 ? marker.opacity : marker.opacity * 0.5,
          true,
        );
      }
    }
  }

  if (marker.mode === "knockback") {
    for (let y = 0; y < heightCells; y++) {
      for (let x = 0; x < widthCells; x++) {
        if (!cropped[y][x] || (x === centerX && y === centerY)) continue;
        drawMarkerArrow(
          ctx,
          x * gridSize + gridSize / 2,
          y * gridSize + gridSize / 2,
          width / 2,
          height / 2,
          gridSize * 0.6,
          "#8b4513",
          marker.opacity * 0.5,
          false,
        );
      }
    }
  }

  if (marker.targeted && cropped[centerY - 1]?.[centerX]) {
    const cx = centerX * gridSize + gridSize / 2;
    const cy = (centerY - 1) * gridSize + gridSize / 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.moveTo(cx, cy - gridSize * 0.4);
    ctx.lineTo(cx + gridSize * 0.2, cy);
    ctx.lineTo(cx, cy + gridSize * 0.4);
    ctx.lineTo(cx - gridSize * 0.2, cy);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(2, gridSize * 0.03);
    ctx.strokeStyle = "black";
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMarkerArrow(
  ctx,
  tileX,
  tileY,
  originX,
  originY,
  length,
  color,
  alpha,
  inward,
) {
  const dx = inward ? originX - tileX : tileX - originX;
  const dy = inward ? originY - tileY : tileY - originY;
  const distance = Math.hypot(dx, dy);
  if (!distance) return;
  const ux = dx / distance;
  const uy = dy / distance;
  const px = -uy;
  const py = ux;
  const halfLength = length / 2;
  const tipX = tileX + ux * halfLength;
  const tipY = tileY + uy * halfLength;
  const baseX = tileX - ux * halfLength;
  const baseY = tileY - uy * halfLength;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(baseX + px * length * 0.5, baseY + py * length * 0.5);
  ctx.lineTo(baseX - px * length * 0.5, baseY - py * length * 0.5);
  ctx.lineTo(tipX, tipY);
  ctx.closePath();
  ctx.fill();
}

async function previewMarkerPlacement(rendered) {
  const sprite = await createMarkerPreviewSprite(rendered);
  sprite.width = rendered.width;
  sprite.height = rendered.height;
  sprite.alpha = 0.65;
  sprite.eventMode = "none";
  canvas.stage.addChild(sprite);

  const snap = (event) => {
    const gridSize = canvas.grid.size;
    const pos = getCanvasEventPosition(event);
    const cellX = Math.floor(pos.x / gridSize);
    const cellY = Math.floor(pos.y / gridSize);
    sprite.x = (cellX - Math.floor(rendered.widthCells / 2)) * gridSize;
    sprite.y = (cellY - Math.floor(rendered.heightCells / 2)) * gridSize;
    return { x: sprite.x, y: sprite.y };
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onClick);
      canvas.stage.off("rightdown", onCancel);
      canvas.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    };
    const onMove = (event) => snap(event);
    const onClick = (event) => {
      const position = snap(event);
      cleanup();
      resolve(position);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.once("pointerdown", onClick);
    canvas.stage.once("rightdown", onCancel);
  });
}

async function previewTargetedMarkerPlacement(rendered) {
  const sprite = await createMarkerPreviewSprite(rendered);
  sprite.width = rendered.width;
  sprite.height = rendered.height;
  sprite.alpha = 0.65;
  sprite.eventMode = "none";
  sprite.visible = false;
  canvas.stage.addChild(sprite);

  const positionForEvent = (event) => {
    const pos = getCanvasEventPosition(event);
    const token = canvas.tokens.placeables.find(
      (placeable) =>
        pos.x >= placeable.x &&
        pos.x <= placeable.x + placeable.w &&
        pos.y >= placeable.y &&
        pos.y <= placeable.y + placeable.h,
    );
    if (token) {
      sprite.visible = true;
      sprite.x = token.x + token.w / 2 - rendered.width / 2;
      sprite.y = token.y + token.h / 2 - rendered.height / 2;
      return { token, x: sprite.x, y: sprite.y };
    }
    sprite.visible = false;
    return null;
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onClick);
      canvas.stage.off("rightdown", onCancel);
      canvas.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    };
    const onMove = (event) => positionForEvent(event);
    const onClick = (event) => {
      const target = positionForEvent(event);
      if (!target) return;
      cleanup();
      resolve(target);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.once("pointerdown", onClick);
    canvas.stage.once("rightdown", onCancel);
  });
}

async function createMarkerPreviewSprite(rendered) {
  const texture = PIXI.Texture.fromURL
    ? await PIXI.Texture.fromURL(rendered.src)
    : PIXI.Texture.from(rendered.src);
  return new PIXI.Sprite(texture);
}

function getCanvasEventPosition(event) {
  if (event.data?.getLocalPosition)
    return event.data.getLocalPosition(canvas.stage);
  if (event.getLocalPosition) return event.getLocalPosition(canvas.stage);
  if (event.global)
    return canvas.stage.worldTransform.applyInverse(event.global);
  return canvas.mousePosition;
}

Hooks.on("moveToken", (tokenDocument, movement) => {
  if (!game.user.isGM) return;
  const destination = movement?.destination;
  if (!destination) return;
  updateTargetedMarkersForToken(tokenDocument, destination);
});

Hooks.on("updateToken", (tokenDocument, changes) => {
  if (!game.user.isGM) return;
  if (
    !("width" in changes || "height" in changes) ||
    "x" in changes ||
    "y" in changes
  )
    return;
  updateTargetedMarkersForToken(tokenDocument, tokenDocument);
});

function updateTargetedMarkersForToken(tokenDocument, tokenPosition) {
  const scene = tokenDocument.parent;
  if (!scene || canvas.scene?.id !== scene.id) return;
  for (const tile of scene.tiles) {
    const marker = tile.getFlag("ffxiv", "markerPlacement");
    if (!marker?.targeted || marker.tokenId !== tokenDocument.id) continue;
    const position = getCenteredMarkerPosition(tile, tokenPosition);
    tile
      .update({
        x: position.x,
        y: position.y,
      })
      .catch((err) => debugError("Failed to move targeted marker:", err));
  }
}

function getCenteredMarkerPosition(tile, tokenPosition) {
  const gridSize = canvas.grid.size;
  const tokenWidth = (tokenPosition.width ?? 1) * gridSize;
  const tokenHeight = (tokenPosition.height ?? 1) * gridSize;
  return {
    x: Math.round(tokenPosition.x + tokenWidth / 2 - tile.width / 2),
    y: Math.round(tokenPosition.y + tokenHeight / 2 - tile.height / 2),
  };
}

async function applyDamageToActor(actor, damage, options = {}) {
  const incomingDamage = Math.max(Number.parseInt(damage, 10) || 0, 0);
  const barrier = Math.max(Number(actor.system.barrier?.value) || 0, 0);
  const healthDamage = Math.max(incomingDamage - barrier, 0);
  const nextHealth = Math.max(
    (Number(actor.system.health?.value) || 0) - healthDamage,
    0,
  );
  const updates = {
    "system.health.value": nextHealth,
  };

  if (barrier > 0) {
    updates["system.barrier.value"] = Math.max(barrier - incomingDamage, 0);
  }

  const result = await actor.update(updates, { ffxivSkipKnockedOutSync: true });
  if (healthDamage > 0 && nextHealth <= 0 && !hasStatus(actor, "knocked_out")) {
    await applyStatusEffectChange(actor, "knocked_out", true);
  }
  showFloatingCombatText(actor, incomingDamage, "damage", options);
  return result;
}

async function applyHealingToActor(actor, amount, options = {}) {
  const result = await recoverActorHealth(actor, amount);
  if (result.healing > 0) {
    showFloatingCombatText(actor, result.healing, "healing", options);
  }
  return result;
}

function showFloatingCombatText(actor, amount, kind, options = {}) {
  const value = Math.max(Number.parseInt(amount, 10) || 0, 0);
  if (value <= 0) return;
  if (!game.settings.get("ffxiv", "floatingDamageNumbers")) return;
  if (typeof canvas?.interface?.createScrollingText !== "function") return;

  const token = options.token ?? getActorCanvasToken(actor);
  if (!token?.center) return;

  const isHealing = kind === "healing";
  const direction = CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1;
  const anchor = CONST.TEXT_ANCHOR_POINTS?.CENTER ?? 0;
  canvas.interface.createScrollingText(token.center, `${isHealing ? "+" : "-"}${value}`, {
    anchor,
    direction,
    distance: (canvas.grid?.size ?? 100) * 1.5,
    fontSize: 34,
    fill: isHealing ? 0x62d26f : 0xff5c5c,
    stroke: 0x000000,
    strokeThickness: 5,
  });
}

function getActorCanvasToken(actor) {
  if (!actor) return null;
  const actorUuid = String(actor.uuid ?? "").trim();
  const tokens = canvas?.tokens?.placeables ?? [];
  const exactTokens = tokens.filter((token) => {
    const tokenActor = token.actor;
    return (
      tokenActor === actor ||
      (actorUuid && tokenActor?.uuid === actorUuid)
    );
  });
  if (exactTokens.length) {
    return exactTokens.find((token) => token.isOwner) ?? exactTokens[0];
  }
  if (actorUuid && !actorUuid.startsWith("Actor.")) return null;

  const fallbackTokens = tokens.filter((token) => {
    const tokenActor = token.actor;
    return (
      tokenActor?.id === actor.id ||
      token.document?.actorId === actor.id
    );
  });
  return fallbackTokens.find((token) => token.isOwner) ?? fallbackTokens[0] ?? null;
}

async function applyDamageToActorWithEffects(
  targetActor,
  rawDamage,
  { sourceActor = null, targetToken = null } = {},
) {
  const damage = getDamageWithEffects(targetActor, rawDamage, { sourceActor });
  if (!damage) return null;
  if (damage.resolvedDamage > 0) {
    await applyDamageToActor(targetActor, damage.resolvedDamage, {
      token: targetToken,
    });
    if (hasStatus(targetActor, "sleep")) {
      await applyStatusEffectChange(targetActor, "sleep", false);
    }
    await applyDrainRecovery(sourceActor);
  }
  return damage;
}

function getDamageWithEffects(
  targetActor,
  rawDamage,
  { sourceActor = null } = {},
) {
  if (!targetActor) return null;
  const baseDamage = Math.max(Number.parseInt(rawDamage, 10) || 0, 0);
  if (baseDamage <= 0) {
    return { actor: targetActor, baseDamage, resolvedDamage: 0 };
  }
  if (hasStatus(targetActor, "transcendent")) {
    return { actor: targetActor, baseDamage, resolvedDamage: 0 };
  }
  const outgoing = sourceActor ? getActorDamageEffectModifiers(sourceActor, "outgoing") : { flat: 0, mult: 1 };
  const incoming = getActorDamageEffectModifiers(targetActor, "incoming");
  const self = sourceActor?.id === targetActor.id
    ? getActorDamageEffectModifiers(targetActor, "self")
    : { flat: 0, mult: 1 };

  const totalFlat = outgoing.flat + incoming.flat + self.flat;
  const totalMult = outgoing.mult * incoming.mult * self.mult;
  const resolvedDamage = Math.max(
    Math.floor((baseDamage + totalFlat) * totalMult),
    0,
  );

  return { actor: targetActor, baseDamage, resolvedDamage };
}

async function applyDrainRecovery(sourceActor) {
  const drain = getActorDrainValue(sourceActor);
  if (drain <= 0) return;
  await applyHealingToActor(sourceActor, drain);
}

async function applyDamageSourceManaRecovery(sourceActor, sourceItem, damageResults) {
  if (!sourceActor || !sourceItem) return;
  const damageInstances = Array.from(damageResults ?? []).filter(
    (result) => Number(result?.resolvedDamage) > 0,
  ).length;
  if (damageInstances <= 0) return;

  const amount = getActorDamageMpRecovery(sourceActor, sourceItem);
  if (amount <= 0) return;
  await recoverActorMana(sourceActor, amount * damageInstances, {
    render: false,
  });
}

function getActorDamageMpRecovery(actor, item) {
  let recovery = 0;
  const effects = Array.from(actor?.allApplicableEffects?.() ?? []);
  for (const effect of effects) {
    if (!effect || effect.disabled) continue;

    const data = foundry.utils.getProperty(effect, "flags.ffxiv.mpRecovery.onDamage");
    const entries = Array.isArray(data) ? data : data ? [data] : [];
    for (const entry of entries) {
      if (!mpRecoveryEntryAppliesToItem(entry, item)) continue;
      const amount = Number(entry.amount ?? entry.flat);
      if (Number.isFinite(amount)) recovery += amount;
    }

    for (const change of effect.changes ?? []) {
      const key = String(change?.key ?? "").trim().toLowerCase();
      if (key !== "flags.ffxiv.mprecovery.ondamage.amount") continue;

      const amount = Number(change?.value);
      if (!Number.isFinite(amount)) continue;
      const mode = normalizeActiveEffectChangeMode(change?.mode);
      if (mode === "multiply") recovery *= amount;
      else if (mode === "override") recovery = amount;
      else if (mode === "subtract") recovery -= amount;
      else recovery += amount;
    }
  }
  return Math.max(Math.floor(recovery), 0);
}

function mpRecoveryEntryAppliesToItem(entry, item) {
  if (!entry || typeof entry !== "object") return false;
  const requiredTags = toArray(entry.tags ?? entry.tag).filter(Boolean);
  if (!requiredTags.length) return true;

  const itemTags = Array.isArray(item?.system?.tags) ? item.system.tags : [];
  return requiredTags.some((tag) =>
    itemTags.some((itemTag) => FFXIVItem._tagMatches(itemTag, [tag])),
  );
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === "" ? [] : [value];
}

function getActorDamageEffectModifiers(actor, channel) {
  const channelPath = `damage.${channel}`;

  const result = { flat: 0, mult: 1 };
  const effects = Array.from(actor?.allApplicableEffects?.() ?? []);
  for (const effect of effects) {
    if (!effect || effect.disabled) continue;

    const flagFlat = Number(foundry.utils.getProperty(effect, `flags.ffxiv.${channelPath}.flat`));
    if (Number.isFinite(flagFlat)) result.flat += flagFlat;
    const flagMult = Number(foundry.utils.getProperty(effect, `flags.ffxiv.${channelPath}.mult`));
    if (Number.isFinite(flagMult)) result.mult *= flagMult;

    for (const change of effect.changes ?? []) {
      const key = String(change?.key ?? "").trim().toLowerCase();
      const mode = normalizeActiveEffectChangeMode(change?.mode);
      const value = Number(change?.value);
      if (!Number.isFinite(value)) continue;

      if (key === `flags.ffxiv.${channelPath}.flat`) {
        if (mode === "multiply") result.flat *= value;
        else if (mode === "override") result.flat = value;
        else if (mode === "subtract") result.flat -= value;
        else result.flat += value;
      }
      if (key === `flags.ffxiv.${channelPath}.mult`) {
        if (mode === "add") result.mult += value;
        else if (mode === "override") result.mult = value;
        else if (mode === "subtract") result.mult -= value;
        else result.mult *= value;
      }
    }
  }

  if (!Number.isFinite(result.mult) || result.mult < 0) result.mult = 1;
  if (!Number.isFinite(result.flat)) result.flat = 0;
  return result;
}

function normalizeActiveEffectChangeMode(mode) {
  if (typeof mode === "string" && mode) return mode.toLowerCase();
  const legacy = Number.parseInt(mode, 10);
  switch (legacy) {
    case 1:
      return "multiply";
    case 2:
      return "add";
    case 5:
      return "override";
    default:
      return "add";
  }
}

function normalizeStatusEntryStacks(entry) {
  const parsed = Number.parseInt(entry?.stacks, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeStatusEntryApplyTo(entry) {
  return String(entry?.applyTo ?? "").trim().toLowerCase() === "self"
    ? "self"
    : "target";
}

function normalizeStatusEntry(entry, fallbackSourceUuid = null) {
  return {
    statusId: String(
      entry?.statusId ?? entry?.id ?? entry?.effect?.id ?? "",
    ).trim(),
    active: entry?.active !== undefined
      ? entry.active !== false
      : entry?.action !== false,
    applyMode: entry?.applyMode === "auto" ? "auto" : "manual",
    applyTo: normalizeStatusEntryApplyTo(entry),
    stacks: normalizeStatusEntryStacks(entry),
    allSources: entry?.allSources === true,
    sourceUuid:
      String(entry?.sourceUuid ?? fallbackSourceUuid ?? "").trim() || null,
  };
}

async function applyStatusEntryToActor(actor, entry) {
  const statusId = String(entry?.statusId ?? entry?.effect?.id ?? "").trim();
  if (!actor || !statusId) return;
  const stacks = normalizeStatusEntryStacks(entry);
  const isActive = entry.active !== false;
  const origin = String(entry?.sourceUuid ?? "").trim() || null;

  if (!isActive && entry?.allSources === true) {
    return (await deleteActorStatuses(actor, [statusId])) > 0;
  }

  if (isStackableStatusEffect(statusId)) {
    let result;
    if (isAdditiveStackableStatusEffect(statusId)) {
      const delta = isActive ? stacks : -stacks;
      result = await applyStatusEffectStackDelta(actor, statusId, delta, { origin, ffxivSuppressStatusText: true });
    } else {
      result = await applyStatusEffectStackValue(actor, statusId, isActive ? stacks : 0, {
        origin,
        ffxivSuppressStatusText: true,
      });
    }
    if (result === false) return false;
    try {
      const label = getStatusLabelById(statusId);
      const speaker = ChatMessage.getSpeaker({ actor });
      const actionText = isActive
        ? game.i18n.format("FFXIV.Notifications.EffectApplied", { effect: label, actor: actor.name })
        : game.i18n.format("FFXIV.Notifications.EffectRemoved", { effect: label, actor: actor.name });
      const stackText = isActive && stacks > 1 ? ` (${stacks} stacks)` : isActive && !isAdditiveStackableStatusEffect && stacks > 0 ? ` (stacks: ${stacks})` : "";
      await ChatMessage.create({
        user: game.user.id,
        speaker,
        content: `<div class=\"ffxiv-status-log\">${actionText}${stackText}</div>`,
      });
    } catch (err) {
      debugError("Failed to create status chat log:", err);
    }
    return true;
  }
  const result = await applyStatusEffectChange(actor, statusId, isActive, { origin, ffxivSuppressStatusText: true });
  if (result === false) return false;
  try {
    const label = getStatusLabelById(statusId);
    const speaker = ChatMessage.getSpeaker({ actor });
    const actionText = isActive
      ? game.i18n.format("FFXIV.Notifications.EffectApplied", { effect: label, actor: actor.name })
      : game.i18n.format("FFXIV.Notifications.EffectRemoved", { effect: label, actor: actor.name });
    await ChatMessage.create({
      user: game.user.id,
      speaker,
      content: `<div class=\"ffxiv-status-log\">${actionText}</div>`,
    });
  } catch (err) {
    debugError("Failed to create status chat log:", err);
  }
  return result !== false;
}

function getStatusLabelById(statusId) {
  const effect = CONFIG.statusEffects?.find((entry) => entry.id === statusId);
  if (!effect) return statusId;
  return game.i18n.localize(effect.label ?? effect.name ?? statusId);
}

function getStatusEntryNotificationKey(entry) {
  return entry?.active === false
    ? "FFXIV.Notifications.EffectRemoved"
    : "FFXIV.Notifications.EffectApplied";
}

async function applyLinkedEffectsToActor(actor, effectDocs) {
  if (!actor || !Array.isArray(effectDocs) || !effectDocs.length) return;
  let normalizedEffectDocs = effectDocs.map((doc) =>
    prepareLinkedActiveEffectDuration(actor, foundry.utils.deepClone(doc)),
  );
  normalizedEffectDocs = await prepareLinkedActiveEffectStatusRules(
    actor,
    normalizedEffectDocs,
  );
  if (!normalizedEffectDocs.length) return 0;

  const replacementSources = normalizedEffectDocs
    .filter((doc) => !isLinkedEffectDocAdditiveStackable(doc))
    .map((doc) => {
      const sourceEffectId = String(foundry.utils.getProperty(doc, "flags.ffxiv.linkedSourceEffectId") ?? "").trim();
      if (!sourceEffectId) return null;
      const sourceItemUuid = String(foundry.utils.getProperty(doc, "flags.ffxiv.linkedSourceItemUuid") ?? doc.origin ?? "").trim();
      const sourceItemId = String(foundry.utils.getProperty(doc, "flags.ffxiv.linkedSourceItemId") ?? getItemIdFromUuid(sourceItemUuid)).trim();
      return { sourceEffectId, sourceItemUuid, sourceItemId };
    })
    .filter(Boolean);

  if (replacementSources.length && actor.effects?.size) {
    const ids = actor.effects
      .filter((effect) => {
        const linkedId = String(effect.getFlag("ffxiv", "linkedSourceEffectId") ?? "").trim();
        if (!linkedId) return false;
        const origin = String(effect.origin ?? "").trim();
        const originItemId = getItemIdFromUuid(origin);
        const flaggedSourceUuid = String(effect.getFlag("ffxiv", "linkedSourceItemUuid") ?? "").trim();
        const flaggedSourceItemId = String(effect.getFlag("ffxiv", "linkedSourceItemId") ?? "").trim();
        return replacementSources.some(({ sourceEffectId, sourceItemUuid, sourceItemId }) => {
          if (linkedId !== sourceEffectId) return false;
          if (!sourceItemUuid && !sourceItemId) return true;
          if (sourceItemUuid && (origin === sourceItemUuid || flaggedSourceUuid === sourceItemUuid)) return true;
          if (!sourceItemId) return false;
          if (originItemId === sourceItemId || flaggedSourceItemId === sourceItemId) return true;
          return getItemIdFromUuid(flaggedSourceUuid) === sourceItemId;
        });
      })
      .map((effect) => effect.id)
      .filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
  }
  const created = await actor.createEmbeddedDocuments("ActiveEffect", normalizedEffectDocs, { render: false });

  const appliedStatuses = new Set(
    normalizedEffectDocs.flatMap((doc) => getLinkedEffectDocStatuses(doc)),
  );
  if (appliedStatuses.has("stun")) {
    await actor.setFlag("ffxiv", "stunnedInEncounter", true);
  }
  if (appliedStatuses.has("knocked_out")) {
    await deleteActorStatuses(actor, getKnockedOutBlockedStatusIds());
    await removeEnmityInflictedByActor(actor);
  }
  return created.length;
}

const COMATOSE_LINKED_ALLOWED_STATUS_IDS = new Set(["comatose", "death"]);
const KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS = new Set([
  "comatose",
  "death",
  "knocked_out",
]);
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

async function prepareLinkedActiveEffectStatusRules(actor, effectDocs) {
  const preparedDocs = [];
  let removeWeakness = false;
  let appliedComatose = false;

  for (const doc of effectDocs) {
    const statuses = getLinkedEffectDocStatuses(doc);
    doc.statuses = statuses;

    if (!statuses.length) {
      preparedDocs.push(doc);
      continue;
    }

    if (
      hasStatus(actor, "knocked_out") &&
      statuses.some((statusId) => !KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS.has(statusId))
    )
      continue;

    if (
      hasStatus(actor, "comatose") &&
      statuses.some((statusId) => !COMATOSE_LINKED_ALLOWED_STATUS_IDS.has(statusId))
    )
      continue;

    if (
      hasStatus(actor, "transcendent") &&
      statuses.some((statusId) => isNegativeStatusEffect(statusId))
    )
      continue;

    if (statuses.some((statusId) => isEliteFoeBlockedStatus(actor, statusId)))
      continue;

    if (statuses.length === 1 && statuses[0] === "weakness") {
      if (hasStatus(actor, "brink_death")) {
        setLinkedEffectDocStatus(doc, "comatose");
        appliedComatose = true;
        preparedDocs.push(doc);
        continue;
      }
      if (hasStatus(actor, "weakness")) {
        setLinkedEffectDocStatus(doc, "brink_death");
        removeWeakness = true;
        preparedDocs.push(doc);
        continue;
      }
    }

    if (
      statuses.includes("stun") &&
      (hasStatus(actor, "stun") ||
        actor.getFlag("ffxiv", "stunnedInEncounter") === true)
    )
      continue;

    if (statuses.includes("comatose")) appliedComatose = true;
    preparedDocs.push(doc);
  }

  if (appliedComatose) {
    await deleteActorStatuses(actor, getComatoseBlockedStatusIds());
    return preparedDocs.filter((doc) => {
      const statuses = getLinkedEffectDocStatuses(doc);
      return (
        !statuses.length ||
        statuses.every((statusId) =>
          COMATOSE_LINKED_ALLOWED_STATUS_IDS.has(statusId),
        )
      );
    });
  }

  if (preparedDocs.some((doc) => getLinkedEffectDocStatuses(doc).includes("knocked_out"))) {
    await deleteActorStatuses(actor, getKnockedOutBlockedStatusIds());
    return preparedDocs.filter((doc) => {
      const statuses = getLinkedEffectDocStatuses(doc);
      return (
        !statuses.length ||
        statuses.every((statusId) =>
          KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS.has(statusId),
        )
      );
    });
  }

  if (removeWeakness) await deleteActorStatuses(actor, ["weakness"]);
  return preparedDocs;
}

function getLinkedEffectDocStatuses(doc) {
  return sanitizeEffectStatuses(doc?.statuses ?? []);
}

function isLinkedEffectDocAdditiveStackable(doc) {
  return getLinkedEffectDocStatuses(doc).some((statusId) =>
    isAdditiveStackableStatusEffect(statusId),
  );
}

function canLinkedEffectDocApplyToActor(actor, doc) {
  const statuses = getLinkedEffectDocStatuses(doc);
  if (!statuses.length) return true;
  if (
    hasStatus(actor, "knocked_out") &&
    statuses.some((statusId) => !KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS.has(statusId))
  )
    return false;
  if (
    hasStatus(actor, "comatose") &&
    statuses.some((statusId) => !COMATOSE_LINKED_ALLOWED_STATUS_IDS.has(statusId))
  )
    return false;
  if (
    hasStatus(actor, "transcendent") &&
    statuses.some((statusId) => isNegativeStatusEffect(statusId))
  )
    return false;
  if (statuses.some((statusId) => isEliteFoeBlockedStatus(actor, statusId)))
    return false;
  if (
    statuses.includes("stun") &&
    (hasStatus(actor, "stun") ||
      actor.getFlag("ffxiv", "stunnedInEncounter") === true)
  )
    return false;
  return true;
}

function hasApplicableLinkedEffectDocs(actor, effectDocs) {
  return effectDocs.some((doc) => canLinkedEffectDocApplyToActor(actor, doc));
}

function setLinkedEffectDocStatus(doc, statusId) {
  doc.statuses = [statusId];
  const status = (CONFIG.statusEffects ?? []).find(
    (entry) => String(entry?.id ?? "").trim().toLowerCase() === statusId,
  );
  const statusImg = status?.img || status?.icon;
  if (statusImg) {
    doc.img = statusImg;
    doc.icon = statusImg;
  }
  return doc;
}

function getComatoseBlockedStatusIds() {
  return (CONFIG.statusEffects ?? [])
    .map((entry) => String(entry?.id ?? "").trim().toLowerCase())
    .filter(
      (statusId) =>
        statusId && !COMATOSE_LINKED_ALLOWED_STATUS_IDS.has(statusId),
    );
}

function getKnockedOutBlockedStatusIds() {
  return (CONFIG.statusEffects ?? [])
    .map((entry) => String(entry?.id ?? "").trim().toLowerCase())
    .filter(
      (statusId) =>
        statusId && !KNOCKED_OUT_LINKED_ALLOWED_STATUS_IDS.has(statusId),
    );
}

async function deleteActorStatuses(actor, statusIds) {
  if (!actor?.effects?.size) return 0;
  const statusSet = new Set(statusIds);
  const ids = actor.effects
    .filter((effect) => {
      if (!effect || effect.disabled) return false;
      const statuses = effect.statuses;
      return (
        statuses instanceof Set &&
        Array.from(statuses).some((statusId) => statusSet.has(statusId))
      );
    })
    .map((effect) => effect.id)
    .filter(Boolean);
  if (ids.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
  }
  return ids.length;
}

function prepareLinkedActiveEffectDuration(actor, doc) {
  if (!doc.duration || typeof doc.duration !== "object") return doc;

  doc.duration.startTime = game.time?.worldTime ?? null;

  const combat = game.combat;
  if (!combat?.started || !combat.turns?.length) {
    doc.duration.startRound = null;
    doc.duration.startTurn = null;
    return doc;
  }

  doc.duration.combat = combat.id;
  doc.duration.startRound = combat.round ?? 0;
  doc.duration.startTurn = combat.turn ?? 0;

  const offset = getTurnsUntilActorTurnEnd(actor, combat) - 1;
  if (offset <= 0) return doc;

  const turns = Number(doc.duration.turns);
  if (Number.isFinite(turns) && turns > 0) {
    doc.duration.turns = turns + offset;
    return doc;
  }

  const units = String(doc.duration.units ?? "").toLowerCase();
  const value = Number(doc.duration.value);
  if (Number.isFinite(value) && value > 0 && (units === "turn" || units === "turns")) {
    doc.duration.value = value + offset;
  }
  return doc;
}

function getTurnsUntilActorTurnEnd(actor, combat) {
  const turns = combat?.turns ?? [];
  if (!turns.length) return 1;

  const currentTurn = Number.isInteger(combat.turn) ? combat.turn : 0;
  const targetTurn = turns.findIndex((combatant) =>
    isSameActorDocument(combatant.actor, actor),
  );
  if (targetTurn < 0) return 1;
  if (targetTurn >= currentTurn) return targetTurn - currentTurn + 1;
  return turns.length - currentTurn + targetTurn + 1;
}

function isSameActorDocument(first, second) {
  return (
    first &&
    second &&
    (first === second ||
      (first.uuid && second.uuid && first.uuid === second.uuid) ||
      (first.id && second.id && first.id === second.id))
  );
}

function getItemIdFromUuid(uuid) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(".");
  const itemIndex = parts.lastIndexOf("Item");
  return itemIndex >= 0 ? String(parts[itemIndex + 1] ?? "").trim() : "";
}

async function removeLinkedEffectsFromActor(actor, sourceItemUuid, sourceEffectIds = [], options = {}) {
  if (!actor?.effects?.size) return 0;
  const includeAutoApply = options.includeAutoApply === true;
  const normalizedSourceUuid = String(sourceItemUuid ?? "").trim();
  const sourceItemId = getItemIdFromUuid(normalizedSourceUuid);
  const idSet = new Set((Array.isArray(sourceEffectIds) ? sourceEffectIds : []).map(String));
  const sourceEffectIdsProvided = idSet.size > 0;
  const hasSourceIdentity = Boolean(normalizedSourceUuid || sourceItemId);

  const effectsToDelete = actor.effects.filter((effect) => {
    const linkedId = String(effect.getFlag("ffxiv", "linkedSourceEffectId") ?? "").trim();
    const linkedAutoApply = effect.getFlag("ffxiv", "linkedAutoApply") === true;
    const origin = String(effect.origin ?? "").trim();
    const originItemId = getItemIdFromUuid(origin);
    const flaggedSourceUuid = String(effect.getFlag("ffxiv", "linkedSourceItemUuid") ?? "").trim();
    const flaggedSourceItemId = String(effect.getFlag("ffxiv", "linkedSourceItemId") ?? "").trim();

    const matchesSourceIdentity = (() => {
      if (!hasSourceIdentity) return false;
      if (origin && normalizedSourceUuid && origin === normalizedSourceUuid) return true;
      if (flaggedSourceUuid && normalizedSourceUuid && flaggedSourceUuid === normalizedSourceUuid) {
        return true;
      }
      if (sourceItemId) {
        if (originItemId && originItemId === sourceItemId) return true;
        if (flaggedSourceItemId && flaggedSourceItemId === sourceItemId) return true;
        const flaggedSourceUuidItemId = getItemIdFromUuid(flaggedSourceUuid);
        if (flaggedSourceUuidItemId && flaggedSourceUuidItemId === sourceItemId) return true;
      }
      return false;
    })();

    if (sourceEffectIdsProvided) {
      if (linkedAutoApply && !includeAutoApply) return false;
      if (linkedId && idSet.has(linkedId)) return true;
      // Legacy safety: allow source-based fallback even when per-effect ids are missing or mismatched.
      if (matchesSourceIdentity) return true;
      return false;
    }

    if (matchesSourceIdentity) return true;
    return !hasSourceIdentity && Boolean(linkedId);
  });
  const ids = effectsToDelete.map((effect) => effect.id).filter(Boolean);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
  return ids.length;
}

function parseJsonIdArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function parseJsonStatusEntries(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeStatusEntry(entry))
      .filter((entry) => entry.statusId);
  } catch (_error) {
    return [];
  }
}

function parseJsonStatusApplications(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((application) => ({
        actorId: String(
          application?.actorId ?? application?.actorRef ?? "",
        ).trim(),
        entries: (Array.isArray(application?.entries)
          ? application.entries
          : []
        )
          .map((entry) => normalizeStatusEntry(entry))
          .filter((entry) => entry.statusId),
      }))
      .filter((application) => application.actorId && application.entries.length);
  } catch (_error) {
    return [];
  }
}

function getActorReference(actor) {
  return String(actor?.uuid ?? actor?.id ?? "").trim();
}

async function resolveActorFromReference(ref) {
  const value = String(ref ?? "").trim();
  if (!value) return null;
  if (value.includes(".")) {
    try {
      const doc = await fromUuid(value);
      if (doc?.documentName === "Actor") return doc;
      if (doc?.actor?.documentName === "Actor") return doc.actor;
    } catch (_error) { }
  }
  return game.actors.get(value) ?? null;
}

async function resolveItemFromReference(ref, actor = null) {
  const value = String(ref ?? "").trim();
  if (!value) return null;
  if (value.includes(".")) {
    try {
      const doc = await fromUuid(value);
      if (doc?.documentName === "Item") return doc;
    } catch (_error) { }
  }
  return actor?.items?.get(value) ?? game.items?.get(value) ?? null;
}

async function resolveSocketActors(data = {}) {
  data = data ?? {};
  const refs =
    Array.isArray(data.actorRefs) && data.actorRefs.length
      ? data.actorRefs
      : data.actorIds;
  const actors = [];
  const seen = new Set();
  for (const ref of refs ?? []) {
    const actor = await resolveActorFromReference(ref);
    const key = String(actor?.uuid ?? actor?.id ?? "").trim();
    if (!actor || !key || seen.has(key)) continue;
    seen.add(key);
    actors.push(actor);
  }
  return actors;
}

function setApplyActiveEffectsButtonState(button, applied, options = {}) {
  if (!(button instanceof HTMLButtonElement)) return;
  const applyLabel = game.i18n.localize("FFXIV.Abilities.ApplyActiveEffects");
  const undoLabel = game.i18n.localize("FFXIV.Abilities.UndoActiveEffects");
  if (!applied) {
    button.dataset.ffxivLinkedState = "apply";
    delete button.dataset.appliedActorIds;
    delete button.dataset.appliedSourceEffectIds;
    delete button.dataset.appliedSourceItemUuid;
    button.textContent = applyLabel;
    return;
  }

  const actorIds = Array.from(
    new Set(
      (Array.isArray(options.actorIds) ? options.actorIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  );
  const sourceEffectIds = Array.from(
    new Set(
      (Array.isArray(options.sourceEffectIds) ? options.sourceEffectIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  );
  button.dataset.ffxivLinkedState = "applied";
  button.dataset.appliedActorIds = JSON.stringify(actorIds);
  button.dataset.appliedSourceEffectIds = JSON.stringify(sourceEffectIds);
  button.dataset.appliedSourceItemUuid = String(options.sourceItemUuid ?? "").trim();
  button.textContent = undoLabel;
}

function setApplyStatusButtonState(button, applied, options = {}) {
  if (!(button instanceof HTMLButtonElement)) return;
  const applyLabel = game.i18n.localize("FFXIV.Abilities.StatusEffect");
  const undoLabel = game.i18n.localize("FFXIV.Abilities.UndoStatusEffects");
  if (!applied) {
    button.dataset.ffxivStatusState = "apply";
    delete button.dataset.appliedActorIds;
    delete button.dataset.appliedStatusEntries;
    delete button.dataset.appliedStatusApplications;
    button.textContent = applyLabel;
    return;
  }

  const actorIds = Array.from(
    new Set(
      (Array.isArray(options.actorIds) ? options.actorIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  );
  const statusEntries = (Array.isArray(options.statusEntries) ? options.statusEntries : [])
    .map((entry) => normalizeStatusEntry(entry))
    .filter((entry) => entry.statusId);
  const applications = (Array.isArray(options.applications) ? options.applications : [])
    .map((application) => ({
      actorId: String(
        application?.actorId ?? application?.actorRef ?? "",
      ).trim(),
      entries: (Array.isArray(application?.entries)
        ? application.entries
        : []
      )
        .map((entry) => normalizeStatusEntry(entry))
        .filter((entry) => entry.statusId),
    }))
    .filter((application) => application.actorId && application.entries.length);
  button.dataset.ffxivStatusState = "applied";
  button.dataset.appliedActorIds = JSON.stringify(actorIds);
  button.dataset.appliedStatusEntries = JSON.stringify(statusEntries);
  button.dataset.appliedStatusApplications = JSON.stringify(applications);
  button.textContent = undoLabel;
}

function getLinkedEffectApplyTo(effect) {
  const flagged = String(effect?.getFlag("ffxiv", "applyTo") || "")
    .trim()
    .toLowerCase();
  if (flagged === "self" || flagged === "target" || flagged === "self_auto" || flagged === "automation") return flagged;
  return "target";
}

function sanitizeEffectStatuses(statuses) {
  if (!statuses) return [];
  const statusIds = Array.from(statuses)
    .map((id) => String(id ?? "").trim().toLowerCase())
    .map((id) => (id === "ascendent" ? "transcendent" : id))
    .filter(Boolean);
  if (!statusIds.length) return [];
  const validIds = new Set(
    (CONFIG.statusEffects ?? []).map((entry) =>
      String(entry?.id ?? "").trim().toLowerCase(),
    ),
  );
  const sanitized = [];
  for (const id of statusIds) {
    if (!validIds.has(id)) continue;
    if (sanitized.includes(id)) continue;
    sanitized.push(id);
  }
  return sanitized;
}

function buildLinkedActiveEffectDocs(item, effects, options = {}) {
  const autoApply = options.autoApply === true;
  const sourceItemUuid = item.uuid;
  return effects.flatMap((effect) => {
    const sourceData = effect.toObject();
    const statuses = sanitizeEffectStatuses(
      effect.statuses ?? effect._source?.statuses ?? [],
    );
    const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    const statusConfigs = new Map(
      (CONFIG.statusEffects ?? []).map((status) => [
        String(status?.id ?? "").trim().toLowerCase(),
        status,
      ]),
    );
    const withCommonFields = (doc) => {
      delete doc._id;
      doc.origin = sourceItemUuid;
      doc.disabled = false;
      doc.transfer = false;
      doc.showIcon = showAlways;
      doc.displayStatusIcon = true;
      doc.flags = foundry.utils.mergeObject(doc.flags || {}, {
        ffxiv: {
          linkedSourceEffectId: effect.id,
          linkedSourceItemId: item.id,
          linkedSourceItemUuid: sourceItemUuid,
          linkedAutoApply: autoApply,
        },
      });
      return doc;
    };

    if (statuses.length <= 1) {
      const doc = withCommonFields(foundry.utils.deepClone(sourceData));
      doc.statuses = statuses;
      if (statuses.length === 1) {
        const status = statusConfigs.get(statuses[0]);
        const statusImg = status?.img || status?.icon;
        if (statusImg) {
          doc.img = statusImg;
          doc.icon = statusImg;
        }
      }
      return [doc];
    }

    return statuses.map((statusId, index) => {
      const doc = withCommonFields(foundry.utils.deepClone(sourceData));
      doc.statuses = [statusId];
      if (index > 0) {
        if (Array.isArray(doc.changes)) doc.changes = [];
        if (doc.system && Array.isArray(doc.system.changes))
          doc.system.changes = [];
      }
      const status = statusConfigs.get(statusId);
      const statusImg = status?.img || status?.icon;
      if (statusImg) {
        doc.img = statusImg;
        doc.icon = statusImg;
      }
      return doc;
    });
  });
}

function normalizeTagValue(tag) {
  return localizeTag(canonicalizeBakedTag(tag))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseTagSetting(raw) {
  return String(raw ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildTagPool(tags) {
  const pool = {};
  for (const tag of tags) {
    const key = tag.replace(/\s+/g, "-");
    if (!pool[key]) {
      pool[key] = {
        value: key,
        label: tag,
      };
    }
  }
  return pool;
}

async function migrateCustomTagSettings() {
  const categories = [
    { configKey: "customAbilityTags", baseKey: "base_tags_abilities" },
    { configKey: "customTraitTags", baseKey: "base_tags_traits" },
    { configKey: "customConsumableTags", baseKey: "base_tags_consumables" },
  ];

  for (const { configKey, baseKey } of categories) {
    const baseTags = Array.isArray(FFXIV[baseKey]) ? FFXIV[baseKey] : [];
    const normalizedBase = new Set(baseTags.map(normalizeTagValue));
    const raw = game.settings.get("ffxiv", configKey);
    const customTags = parseTagSetting(raw);
    const filtered = customTags.filter(
      (tag) => !normalizedBase.has(normalizeTagValue(tag)),
    );
    const hasChanged =
      filtered.length !== customTags.length ||
      filtered.some((tag, idx) => tag !== customTags[idx]);
    if (!hasChanged) continue;
    await game.settings.set("ffxiv", configKey, filtered.join(","));
  }
}

Hooks.on("ready", function () {
  migrateCustomTagSettings().catch((err) =>
    debugError("FFXIV | Custom tag migration failed:", err),
  );

  const categories = [
    {
      configKey: "customAbilityTags",
      configTarget: "tags_abilities",
      baseKey: "base_tags_abilities",
    },
    {
      configKey: "customTraitTags",
      configTarget: "tags_traits",
      baseKey: "base_tags_traits",
    },
    {
      configKey: "customConsumableTags",
      configTarget: "tags_consumables",
      baseKey: "base_tags_consumables",
    },
  ];

  CONFIG.FFXIV = CONFIG.FFXIV || {};

  for (let { configKey, configTarget, baseKey } of categories) {
    const baseTags = Array.isArray(FFXIV[baseKey]) ? FFXIV[baseKey] : [];
    const raw = game.settings.get("ffxiv", configKey);
    const customTags = parseTagSetting(raw);
    const combinedTags = [...baseTags, ...customTags];
    const deduped = [];
    const seen = new Set();
    for (const tag of combinedTags) {
      const normalized = normalizeTagValue(tag);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(tag.trim());
    }
    CONFIG.FFXIV[configTarget] = buildTagPool(deduped);
  }

  if (game.user.isGM) {
    game.socket.on("system.ffxiv", async (params) => {
      debugLog("get socket");
      const { type, data, userName, gmUserId } = params;
      if (gmUserId && gmUserId !== game.user.id) return;
      const actors = await resolveSocketActors(data);
      switch (type) {
        case FFXIV_MARKER_SOCKET_TYPE:
          try {
            await createMarkerTileFromRequest(data);
          } catch (err) {
            debugError("socket marker placement failed:", err);
          }
          break;
        case "applyEffect": {
          debugLog("status socket");
          const effects = (
            Array.isArray(data.effects)
              ? data.effects
              : [{ effect: data.effect, active: data.active }]
          )
            .map((entry) => ({
              ...entry,
              statusId: String(entry?.statusId ?? entry?.effect?.id ?? "").trim(),
            }))
            .filter((entry) => entry.statusId);
          if (!actors.length || !effects.length) return;
          const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
          if (autoApply) {
            for (const actor of actors) {
              for (const entry of effects) {
                const applied = await applyStatusEntryToActor(actor, entry);
                if (applied) {
                  ui.notifications.info(
                    game.i18n.format(getStatusEntryNotificationKey(entry), {
                      effect: getStatusLabelById(entry.statusId),
                      actor: actor.name,
                    }),
                  );
                }
              }
            }
            break;
          }

          const effectList = effects
            .map((entry) => getStatusLabelById(entry.statusId))
            .join(", ");
          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-apply-effect",
            window: {
              title: game.i18n.localize(
                "FFXIV.Notifications.StatusChangeRequest",
              ),
            },
            content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest", { playerName: userName, effect: effectList })}</p>
                <ul>${actors.map((a) => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: async () => {
                  for (const actor of actors) {
                    for (const entry of effects) {
                      const applied = await applyStatusEntryToActor(actor, entry);
                      if (applied) {
                        ui.notifications.info(
                          game.i18n.format(getStatusEntryNotificationKey(entry), {
                            effect: getStatusLabelById(entry.statusId),
                            actor: actor.name,
                          }),
                        );
                      }
                    }
                  }
                },
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              },
            ],
          }).render(true);
          break;
        }

        case "applyHeal": {
          debugLog("heal socket");
          const heal = data.heal;
          if (!actors.length || !heal) return;
          const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
          if (autoApply) {
            for (const actor of actors) {
              await applyHealingToActor(actor, heal);
            }
            break;
          }

          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-heal",
            window: {
              title: game.i18n.localize(
                "FFXIV.Notifications.HealChangeRequest",
              ),
            },
            content: `<p>${game.i18n.format("FFXIV.Notifications.HealRequest", { playerName: userName, heal: heal })}</p>
                <ul>${actors.map((a) => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: async () => {
                  for (const actor of actors) {
                    await applyHealingToActor(actor, heal);
                  }
                },
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              },
            ],
          }).render(true);
          break;
        }

        case "applyDamage": {
          debugLog("damage socket");
          const damage = data.damage;
          if (!actors.length || !damage) return;
          const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
          const sourceActor = await resolveActorFromReference(
            data.sourceActorUuid ?? data.sourceActorId,
          );
          const sourceItem = await resolveItemFromReference(
            data.sourceItemUuid ?? data.sourceItemId,
            sourceActor,
          );
          if (autoApply) {
            const damageResults = [];
            for (const actor of actors) {
              const result = await applyDamageToActorWithEffects(actor, damage, { sourceActor });
              if (result) damageResults.push(result);
            }
            await applyDamageSourceManaRecovery(sourceActor, sourceItem, damageResults);
            break;
          }

          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-damage",
            window: {
              title: game.i18n.localize(
                "FFXIV.Notifications.DamageChangeRequest",
              ),
            },
            content: `<p>${game.i18n.format("FFXIV.Notifications.DamageRequest", { playerName: userName, damage: damage })}</p>
                <ul>${actors.map((a) => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: async () => {
                  const damageResults = [];
                  for (const actor of actors) {
                    const result = await applyDamageToActorWithEffects(actor, damage, { sourceActor });
                    if (result) damageResults.push(result);
                  }
                  await applyDamageSourceManaRecovery(sourceActor, sourceItem, damageResults);
                },
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              },
            ],
          }).render(true);
          break;
        }
        case "applyLinkedEffects": {
          const effectDocs = Array.isArray(data.effectDocs) ? data.effectDocs : [];
          const removeSourceIds = Array.isArray(data.removeSourceIds) ? data.removeSourceIds : [];
          const removeAllFromSource = data.removeAllFromSource === true;
          const includeAutoApply = data.includeAutoApply === true;
          const sourceItemUuid = String(data.sourceItemUuid ?? "").trim();
          if (!actors.length || (!effectDocs.length && !removeSourceIds.length && !removeAllFromSource)) return;
          const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
          if (autoApply) {
            for (const actor of actors) {
              if (effectDocs.length) await applyLinkedEffectsToActor(actor, effectDocs);
              if (removeSourceIds.length || removeAllFromSource) {
                await removeLinkedEffectsFromActor(actor, sourceItemUuid, removeSourceIds, { includeAutoApply });
              }
            }
            break;
          }

          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-apply-linked-effects",
            window: {
              title: game.i18n.localize("FFXIV.Notifications.StatusChangeRequest"),
            },
            content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest", { playerName: userName, effect: game.i18n.localize("FFXIV.Abilities.LinkedActiveEffects") })}</p>
                <ul>${actors.map((a) => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: async () => {
                  for (const actor of actors) {
                    await applyLinkedEffectsToActor(actor, effectDocs);
                    if (removeSourceIds.length || removeAllFromSource) {
                      await removeLinkedEffectsFromActor(actor, sourceItemUuid, removeSourceIds, { includeAutoApply });
                    }
                  }
                },
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              },
            ],
          }).render(true);
          break;
        }
        case "limitBreakSpend": {
          await consumeLimitBreakSegment();
          break;
        }
        default:
          debugError("socket error : type of request not found", type);
      }
    });
  }
});

async function consumeLimitBreakSegment() {
  if (!game.user?.isGM) return false;
  if (!isLimitBreakActive()) return false;
  const value = getLimitBreakValue();
  if (value <= 0) return false;
  await game.settings.set("ffxiv", "limitBreakValue", value - 1);
  return true;
}

Hooks.on("createChatMessage", async (message, _options, userId) => {
  if (userId !== game.user.id) return;
  if (message.getFlag("ffxiv", "selfAutoLinkedEffectsApplied")) return;

  const content = String(message.content ?? "");
  if (!content.includes("item-card")) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = content;
  const sourceElement =
    wrapper.querySelector(".ffxiv-apply-active-effects") ??
    wrapper.querySelector(".item-card[data-item-id]");
  if (!(sourceElement instanceof HTMLElement)) return;

  const item = await resolveChatAbilityItem(sourceElement);
  if (!item) return;
  const sourceActor = item.parent?.documentName === "Actor"
    ? item.parent
    : await resolveActorFromReference(
      sourceElement.dataset.actorUuid ?? sourceElement.dataset.actorId,
    );
  if (!sourceActor) return;

  const selfAutoEffects = Array.from(item.effects ?? []).filter(
    (effect) => !effect.disabled && getLinkedEffectApplyTo(effect) === "self_auto",
  );
  if (!selfAutoEffects.length) return;

  const isAddEffect = (effect) =>
    String(effect.getFlag("ffxiv", "applyAction") || "add") !== "remove";
  const isRemoveEffect = (effect) =>
    String(effect.getFlag("ffxiv", "applyAction") || "add") === "remove";
  const effectDocs = buildLinkedActiveEffectDocs(
    item,
    selfAutoEffects.filter(isAddEffect),
    { autoApply: true },
  );
  const removeSourceIds = selfAutoEffects
    .filter(isRemoveEffect)
    .map((effect) => effect.id)
    .filter(Boolean);
  if (!effectDocs.length && !removeSourceIds.length) return;

  await message.setFlag("ffxiv", "selfAutoLinkedEffectsApplied", true);
  if (sourceActor.testUserPermission(game.user, "OWNER")) {
    await applyLinkedEffectsToActor(sourceActor, effectDocs);
    if (removeSourceIds.length) {
      await removeLinkedEffectsFromActor(sourceActor, item.uuid, removeSourceIds, { includeAutoApply: true });
    }
    return;
  }

  game.socket.emit("system.ffxiv", {
    type: "applyLinkedEffects",
    data: {
      actorIds: [sourceActor.id],
      actorRefs: [getActorReference(sourceActor)],
      effectDocs,
      removeSourceIds,
      sourceItemUuid: item.uuid,
      includeAutoApply: true,
    },
    userName: game.user.name,
  });
});

Hooks.on("canvasReady", () => {
  try {
    if (!canvas?.interface || typeof canvas.interface.createScrollingText !== "function") return;
    if (canvas.interface.__ffxivCreateScrollingTextWrapped) return;
    const originalCreateScrollingText = canvas.interface.createScrollingText.bind(canvas.interface);
    canvas.interface.createScrollingText = (center, text, options = {}) => {
      try {
        if (options?.ffxivAllowStatusText === true) {
          return originalCreateScrollingText(center, text, options);
        }
        if (typeof text === "string" && Array.isArray(CONFIG.statusEffects) && CONFIG.statusEffects.length) {
          for (const entry of CONFIG.statusEffects) {
            const label = game.i18n.localize(entry.label ?? entry.name ?? entry.id);
            if (label && text.includes(label)) return; // suppress default status scrolling text
          }
        }
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

Hooks.on("renderChatMessageHTML", (message, html) => {
  debugLog("renderChatMessageHTML hook");
  applyFFXIVChatTheme(html);

  const jqueryhtml = $(html);
  const markApplyToChatCard = async ({ kind, amount, count, results = [] }) => {
    const typeKey = kind === "heal" ? "FFXIV.Chat.HealNoun" : "FFXIV.Chat.DamageNoun";
    const resultKey = count === 1
      ? "FFXIV.Chat.ApplyResultSingle"
      : "FFXIV.Chat.ApplyResultPlural";
    const typeLabel = game.i18n.has(typeKey)
      ? game.i18n.localize(typeKey)
      : game.i18n.localize(
        kind === "heal" ? "FFXIV.Chat.Heal" : "FFXIV.Chat.Damage",
      ).toLowerCase();
    const changed = kind === "damage"
      ? results.filter((result) =>
        result && result.resolvedDamage !== result.baseDamage
      )
      : [];
    const resolvedAmounts = results.map((result) => result?.resolvedDamage);
    const sameResolvedAmount =
      kind === "damage" &&
      resolvedAmounts.length === count &&
      resolvedAmounts.every((value) => value === resolvedAmounts[0]);
    let notice = game.i18n.format(
      game.i18n.has(resultKey) ? resultKey : "FFXIV.Chat.ApplyResult",
      {
        type: typeLabel,
        amount: sameResolvedAmount ? resolvedAmounts[0] : amount,
        count: count,
      },
    );
    if (kind === "damage") {
      if (changed.length === 1 && count === 1) {
        notice += ` (${changed[0].baseDamage} -> ${changed[0].resolvedDamage})`;
      } else if (changed.length) {
        const summary = changed
          .map((result) =>
            `${result.actor?.name ?? "Target"}: ${result.baseDamage} -> ${result.resolvedDamage}`
          )
          .join(", ");
        notice += ` (${summary})`;
      }
    }

    const buttonRow = jqueryhtml
      .find(".ffxiv-apply-dmg, .ffxiv-apply-heal")
      .first()
      .parent();
    const resultMarkup = `<div class="ffxiv-apply-result">${notice}</div>`;
    if (buttonRow.length) {
      buttonRow.replaceWith(resultMarkup);
    } else {
      const existing = jqueryhtml.find(".ffxiv-apply-result");
      if (existing.length) existing.text(notice);
      else jqueryhtml.append(resultMarkup);
    }

    const updatedContent = jqueryhtml.find(".message-content").first().html();
    if (updatedContent) await message.update({ content: updatedContent }, { notify: true });
  };

  jqueryhtml.find(".ffxiv-roll-base").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollBase(ev);
  });

  jqueryhtml.find(".ffxiv-roll-alternate").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollAlternate(ev);
  });

  jqueryhtml.find(".ffxiv-roll-hit").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollHit(ev);
  });

  jqueryhtml.find(".ffxiv-roll-direct").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollDirect(ev);
  });

  jqueryhtml.find(".ffxiv-roll-option-direct").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollOptionDirect(ev);
  });

  jqueryhtml.find(".ffxiv-roll-resource-bonus").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollJobResourceBonus(ev);
  });

  jqueryhtml.find(".ffxiv-roll-critical").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollCritical(ev);
  });

  jqueryhtml.find(".ffxiv-roll-critical-alternate").on("click", async (ev) => {
    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (item) await item._rollCriticalAlternate(ev);
  });

  jqueryhtml.find(".ffxiv-show-modifiers").on("click", async (ev) => {
    debugLog("call show modifiers");
    const item = await resolveChatAbilityItem(ev.currentTarget);
    const actor = item?.parent?.documentName === "Actor"
      ? item.parent
      : await resolveActorFromReference(
        ev.currentTarget.dataset.actorUuid ??
        ev.currentTarget.dataset.actorId,
      );
    debugLog(actor);
    if (actor) actor._showModifiers(ev);
  });

  jqueryhtml.find(".ffxiv-apply-heal").on("click", async (ev) => {
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }
    const heal = parseInt(eval(ev.currentTarget.dataset.heal));
    debugLog(ev.currentTarget.dataset);
    const ownActors = [];
    const actorsNeedingGM = [];
    for (const token of targets) {
      const actor = token.actor;
      if (actor.testUserPermission(game.user, "OWNER")) {
        ownActors.push({ actor, token });
      } else {
        actorsNeedingGM.push({ actor, token });
      }
    }
    for (const { actor, token } of ownActors) {
      await applyHealingToActor(actor, heal, { token });
    }
    if (actorsNeedingGM.length > 0) {
      debugLog("Send socket to GM, heal", heal);
      game.socket.emit("system.ffxiv", {
        type: "applyHeal",
        data: {
          actorIds: actorsNeedingGM.map(({ actor }) => actor.id),
          actorRefs: actorsNeedingGM.map(({ actor }) => getActorReference(actor)),
          heal: heal,
          active: ev.currentTarget.dataset.action === "true",
        },
        userName: game.user.name,
      });
      ui.notifications.info(
        game.i18n.localize("FFXIV.Notifications.SendSocket"),
      );
    }

    await markApplyToChatCard({
      kind: "heal",
      amount: heal,
      count: targets.length,
    });
  });
  jqueryhtml.find(".ffxiv-apply-dmg").on("click", async (ev) => {
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }
    const sourceItem = await resolveChatAbilityItem(ev.currentTarget);
    const damage = parseInt(eval(ev.currentTarget.dataset.damage));
    const sourceActor = await resolveActorFromReference(
      ev.currentTarget.dataset.actorUuid ?? ev.currentTarget.dataset.actorId,
    );
    const ownActors = [];
    const actorsNeedingGM = [];
    for (const token of targets) {
      const actor = token.actor;
      if (actor.testUserPermission(game.user, "OWNER")) {
        ownActors.push({ actor, token });
      } else {
        actorsNeedingGM.push({ actor, token });
      }
    }
    const damageResults = [];
    const ownDamageResults = [];
    for (const { actor, token } of ownActors) {
      const result = await applyDamageToActorWithEffects(actor, damage, {
        sourceActor,
        targetToken: token,
      });
      if (result) {
        damageResults.push(result);
        ownDamageResults.push(result);
      }
    }
    await applyDamageSourceManaRecovery(sourceActor, sourceItem, ownDamageResults);
    for (const { actor } of actorsNeedingGM) {
      const result = getDamageWithEffects(actor, damage, { sourceActor });
      if (result) damageResults.push(result);
    }
    if (actorsNeedingGM.length > 0) {
      debugLog("Send socket to GM, damage", damage);
      game.socket.emit("system.ffxiv", {
        type: "applyDamage",
        data: {
          actorIds: actorsNeedingGM.map(({ actor }) => actor.id),
          actorRefs: actorsNeedingGM.map(({ actor }) => getActorReference(actor)),
          damage: damage,
          sourceActorId: sourceActor?.id ?? null,
          sourceActorUuid: sourceActor?.uuid ?? null,
          sourceItemId: sourceItem?.id ?? ev.currentTarget.dataset.itemId ?? null,
          sourceItemUuid: sourceItem?.uuid ?? ev.currentTarget.dataset.itemUuid ?? null,
          active: ev.currentTarget.dataset.action === "true",
        },
        userName: game.user.name,
      });
      ui.notifications.info(
        game.i18n.localize("FFXIV.Notifications.SendSocket"),
      );
    }

    await markApplyToChatCard({
      kind: "damage",
      amount: damage,
      count: targets.length,
      results: damageResults,
    });
  });

  jqueryhtml.find(".ffxiv-apply-status").on("click", async (ev) => {
    const button =
      ev.currentTarget instanceof HTMLButtonElement ? ev.currentTarget : null;
    const currentState = String(button?.dataset?.ffxivStatusState || "apply");
    if (currentState === "applied") {
      let applications = parseJsonStatusApplications(
        button?.dataset?.appliedStatusApplications,
      );
      if (!applications.length) {
        const actorIds = parseJsonIdArray(button?.dataset?.appliedActorIds);
        const statusEntries = parseJsonStatusEntries(
          button?.dataset?.appliedStatusEntries,
        );
        applications = actorIds.map((actorId) => ({
          actorId,
          entries: statusEntries,
        }));
      }
      applications = applications
        .map((application) => ({
          ...application,
          entries: application.entries.map((entry) => ({
            ...entry,
            active: entry.active === false,
          })),
        }))
        .filter((application) => application.entries.length);
      if (!applications.length) {
        setApplyStatusButtonState(button, false);
        return;
      }

      for (const application of applications) {
        const actor = await resolveActorFromReference(application.actorId);
        if (!actor) continue;
        if (actor.testUserPermission(game.user, "OWNER")) {
          for (const entry of application.entries) {
            const applied = await applyStatusEntryToActor(actor, entry);
            if (applied) {
              ui.notifications.info(
                game.i18n.format(getStatusEntryNotificationKey(entry), {
                  effect: getStatusLabelById(entry.statusId),
                  actor: actor.name,
                }),
              );
            }
          }
          continue;
        }
        game.socket.emit("system.ffxiv", {
          type: "applyEffect",
          data: {
            actorIds: [actor.id],
            actorRefs: [getActorReference(actor)],
            effects: application.entries,
          },
          userName: game.user.name,
        });
      }

      setApplyStatusButtonState(button, false);
      return;
    }

    const item = await resolveChatAbilityItem(ev.currentTarget);
    const statusEntries = getStatusEffectEntriesForItem(item, ev.currentTarget);
    if (!statusEntries.length) return;

    const selfEntries = statusEntries.filter((entry) => entry.applyTo === "self");
    const targetEntries = statusEntries.filter((entry) => entry.applyTo !== "self");
    const targets = Array.from(game.user.targets);

    if (targetEntries.length && targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }

    const sourceActor = item?.parent?.documentName === "Actor"
      ? item.parent
      : await resolveActorFromReference(
        ev.currentTarget.dataset.actorUuid ?? ev.currentTarget.dataset.actorId,
      );
    const applications = [];
    let sentSocketRequest = false;

    const applyEntries = async (actor, entries) => {
      if (!actor || !entries.length) return;
      const actorRef = getActorReference(actor);
      if (!actorRef) return;

      if (!actor.testUserPermission(game.user, "OWNER")) {
        game.socket.emit("system.ffxiv", {
          type: "applyEffect",
          data: {
            actorIds: [actor.id],
            actorRefs: [actorRef],
            effects: entries,
          },
          userName: game.user.name,
        });
        applications.push({ actorId: actorRef, entries });
        sentSocketRequest = true;
        return;
      }

      let actorChanged = false;
      for (const entry of entries) {
        const applied = await applyStatusEntryToActor(actor, entry);
        if (applied) {
          actorChanged = true;
          ui.notifications.info(
            game.i18n.format(getStatusEntryNotificationKey(entry), {
              effect: getStatusLabelById(entry.statusId),
              actor: actor.name,
            }),
          );
        }
      }
      if (actorChanged) applications.push({ actorId: actorRef, entries });
    };

    if (selfEntries.length) await applyEntries(sourceActor, selfEntries);
    if (targetEntries.length) {
      debugLog("Apply status effects", targetEntries);
      for (const token of targets) {
        await applyEntries(token.actor, targetEntries);
      }
    }

    if (sentSocketRequest) {
      ui.notifications.info(
        game.i18n.localize("FFXIV.Notifications.SendSocket"),
      );
    }

    if (applications.length) {
      setApplyStatusButtonState(button, true, {
        actorIds: applications.map((application) => application.actorId),
        statusEntries,
        applications,
      });
    }
  });

  jqueryhtml.find(".ffxiv-apply-active-effects").on("click", async (ev) => {
    const button =
      ev.currentTarget instanceof HTMLButtonElement ? ev.currentTarget : null;
    const currentState = String(button?.dataset?.ffxivLinkedState || "apply");
    if (currentState === "applied") {
      let sourceItemUuid = String(
        button?.dataset?.appliedSourceItemUuid ??
        button?.dataset?.itemUuid ??
        "",
      ).trim();
      if (!sourceItemUuid) {
        const sourceItem = await resolveChatAbilityItem(ev.currentTarget);
        sourceItemUuid = String(sourceItem?.uuid ?? "").trim();
      }
      const actorIds = parseJsonIdArray(button?.dataset?.appliedActorIds);
      const sourceEffectIds = parseJsonIdArray(
        button?.dataset?.appliedSourceEffectIds,
      );
      if (!actorIds.length) {
        setApplyActiveEffectsButtonState(button, false);
        return;
      }

      const ownActors = [];
      const actorsNeedingGM = [];
      for (const actorRef of actorIds) {
        const actor = await resolveActorFromReference(actorRef);
        if (!actor) continue;
        if (actor.testUserPermission(game.user, "OWNER")) ownActors.push(actor);
        else actorsNeedingGM.push(actor);
      }

      let removedCount = 0;
      for (const actor of ownActors) {
        removedCount += await removeLinkedEffectsFromActor(
          actor,
          sourceItemUuid,
          sourceEffectIds,
        );
      }

      if (!removedCount) {
        const fallbackCandidates = [];
        const sourceActorRef = String(
          button?.dataset?.actorUuid ?? button?.dataset?.actorId ?? "",
        ).trim();
        if (sourceActorRef) fallbackCandidates.push(sourceActorRef);
        for (const token of game.user.targets ?? []) {
          const ref = getActorReference(token?.actor);
          if (ref) fallbackCandidates.push(ref);
        }
        const uniqueFallbackRefs = Array.from(new Set(fallbackCandidates));
        for (const actorRef of uniqueFallbackRefs) {
          const actor = await resolveActorFromReference(actorRef);
          if (!actor) continue;
          if (!actor.testUserPermission(game.user, "OWNER")) continue;
          removedCount += await removeLinkedEffectsFromActor(
            actor,
            sourceItemUuid,
            sourceEffectIds,
          );
        }
      }

      for (const actor of actorsNeedingGM) {
        game.socket.emit("system.ffxiv", {
          type: "applyLinkedEffects",
          data: {
            actorIds: [actor.id],
            actorRefs: [getActorReference(actor)],
            effectDocs: [],
            removeSourceIds: sourceEffectIds,
            removeAllFromSource: sourceEffectIds.length === 0,
            sourceItemUuid,
          },
          userName: game.user.name,
        });
      }

      setApplyActiveEffectsButtonState(button, false);
      return;
    }

    const item = await resolveChatAbilityItem(ev.currentTarget);
    if (!item) return;
    const sourceItemUuid = item.uuid;

    const sourceActor = item.parent?.documentName === "Actor"
      ? item.parent
      : await resolveActorFromReference(
        ev.currentTarget.dataset.actorUuid ?? ev.currentTarget.dataset.actorId,
      );

    const linkedEffects = Array.from(item.effects ?? []).filter(
      (effect) => !effect.disabled,
    );
    const manualLinkedEffects = linkedEffects.filter((effect) => {
      const applyTo = getLinkedEffectApplyTo(effect);
      return applyTo !== "self_auto" && applyTo !== "automation";
    });
    if (!manualLinkedEffects.length) return;

    const selfEffects = manualLinkedEffects.filter(
      (effect) => getLinkedEffectApplyTo(effect) === "self",
    );
    const targetEffects = manualLinkedEffects.filter(
      (effect) => getLinkedEffectApplyTo(effect) === "target",
    );
    const targets = Array.from(game.user.targets).map((token) => token.actor).filter(Boolean);

    if (!selfEffects.length && targetEffects.length && targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }

    const isAddEffect = (effect) =>
      String(effect.getFlag("ffxiv", "applyAction") || "add") !== "remove";
    const isRemoveEffect = (effect) =>
      String(effect.getFlag("ffxiv", "applyAction") || "add") === "remove";

    const buildDocs = (effects) =>
      buildLinkedActiveEffectDocs(item, effects.filter(isAddEffect));
    const buildRemoveSourceIds = (effects) =>
      effects.filter(isRemoveEffect).map((effect) => effect.id).filter(Boolean);
    const addSourceIds = manualLinkedEffects
      .filter(isAddEffect)
      .map((effect) => effect.id)
      .filter(Boolean);

    const ownActors = [];
    const actorsNeedingGM = [];
    if (sourceActor && selfEffects.length) {
      if (sourceActor.testUserPermission(game.user, "OWNER")) ownActors.push({ actor: sourceActor, effects: selfEffects });
      else actorsNeedingGM.push({ actor: sourceActor, effects: selfEffects });
    }
    for (const actor of targets) {
      if (!targetEffects.length) continue;
      if (actor.testUserPermission(game.user, "OWNER")) ownActors.push({ actor, effects: targetEffects });
      else actorsNeedingGM.push({ actor, effects: targetEffects });
    }

    const affectedActorIds = [];

    for (const { actor, effects } of ownActors) {
      const docs = buildDocs(effects);
      const removeSourceIds = buildRemoveSourceIds(effects);
      if (!docs.length && !removeSourceIds.length) continue;
      const appliedCount = await applyLinkedEffectsToActor(actor, docs);
      if (removeSourceIds.length) {
        await removeLinkedEffectsFromActor(actor, item.uuid, removeSourceIds);
      }
      const actorRef = getActorReference(actor);
      if (appliedCount > 0 && actorRef) affectedActorIds.push(actorRef);
    }

    if (actorsNeedingGM.length > 0) {
      for (const { actor, effects } of actorsNeedingGM) {
        const effectDocs = buildDocs(effects);
        const removeSourceIds = buildRemoveSourceIds(effects);
        if (!effectDocs.length && !removeSourceIds.length) continue;
        const actorRef = getActorReference(actor);
        if (
          actorRef &&
          effectDocs.length &&
          hasApplicableLinkedEffectDocs(actor, effectDocs)
        ) {
          affectedActorIds.push(actorRef);
        }
        game.socket.emit("system.ffxiv", {
          type: "applyLinkedEffects",
          data: {
            actorIds: [actor.id],
            actorRefs: [getActorReference(actor)],
            effectDocs,
            removeSourceIds,
            sourceItemUuid: item.uuid,
          },
          userName: game.user.name,
        });
      }
    }

    if (addSourceIds.length && affectedActorIds.length) {
      setApplyActiveEffectsButtonState(button, true, {
        actorIds: affectedActorIds,
        sourceEffectIds: addSourceIds,
        sourceItemUuid: item.uuid,
      });
    }
  });
});

async function resolveChatAbilityItem(element) {
  const itemUuid = String(element?.dataset?.itemUuid ?? "").trim();
  if (itemUuid) {
    try {
      const byUuid = await fromUuid(itemUuid);
      if (byUuid?.documentName === "Item") return byUuid;
    } catch (_error) { }
  }

  const actorUuid = String(element?.dataset?.actorUuid ?? "").trim();
  if (actorUuid) {
    try {
      const actorDoc = await fromUuid(actorUuid);
      if (actorDoc?.documentName === "Actor") {
        const item = actorDoc.items?.get(element?.dataset?.itemId);
        if (item) return item;
      }
    } catch (_error) { }
  }

  const actorId = String(element?.dataset?.actorId ?? "").trim();
  const itemId = String(element?.dataset?.itemId ?? "").trim();
  const actor = game.actors.get(actorId);
  return actor?.items?.get(itemId) ?? null;
}

function getStatusEffectEntriesForItem(item, element) {
  const embeddedEntries = parseStatusEntriesFromElement(element);
  const sourceEntries =
    Array.isArray(item?.system?.status_effects) &&
      item.system.status_effects.length
      ? item.system.status_effects
      : item?.system?.status_effect
        ? [
          {
            id: item.system.status_effect,
            action: item.system.status_action !== false,
            applyMode:
              item.system.status_apply_mode === "auto" ? "auto" : "manual",
            applyTo: "target",
          },
        ]
        : element?.dataset?.effectId
          ? [
            {
              id: element.dataset.effectId,
              action: element.dataset.action === "true",
              applyMode: "manual",
              applyTo: "target",
            },
          ]
          : [];

  const chosenEntries = sourceEntries.length ? sourceEntries : embeddedEntries;

  return chosenEntries
    .map((entry) => normalizeStatusEntry(entry, element?.dataset?.sourceUuid))
    .filter((entry) => entry.statusId && entry.applyMode !== "auto");
}

function parseStatusEntriesFromElement(element) {
  const raw = element?.dataset?.statusEntries;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    debugError("FFXIV | Failed to parse embedded status entries:", error);
    return [];
  }
}
