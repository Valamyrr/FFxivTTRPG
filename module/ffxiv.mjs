// Import document classes.
import { FFXIVActor } from './actors/actor.mjs';
import { FFXIVCombat } from './combat.mjs';
import { FFXIVItem } from './items/item.mjs';
import { registerDataModels } from './data-models.mjs';
// Import sheet classes.
import { FFXIVActorSheet } from './actors/actor-sheet.mjs';
import { FFXIVItemSheet } from './items/item-sheet.mjs';
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { FF_XIV } from './helpers/config.mjs';
import { debugError, debugLog } from "./helpers/debug.mjs";

import { SettingsHelpers } from "./helpers/settings.mjs";
import { updateStatusEffects } from "./helpers/status_effects.mjs";
import { registerEscapeHandler } from "./helpers/escape.mjs";
import { formatShopTierDisplay, normalizeShopTier } from "./helpers/shop-tier.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */


Hooks.once('init', function () {
  registerDataModels();
  SettingsHelpers.initSettings();
  debugLog("FFXIV | Init");
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.ffxivttrpg = {
    FFXIVActor,
    FFXIVItem
  };

  // Add custom constants for configuration.
  CONFIG.FF_XIV = FF_XIV;

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
  DocumentSheetConfig.unregisterSheet(Actor, 'core', foundry.appv1.sheets.ActorSheet);

  DocumentSheetConfig.registerSheet(Actor, 'ffxiv', FFXIVActorSheet, {
    types: ['character', 'pet', 'npc'],
    makeDefault: true,
    label: 'FFXIV.SheetLabels.Actor',
  });

  DocumentSheetConfig.unregisterSheet(Item, 'core', foundry.appv1.sheets.ItemSheet);
  DocumentSheetConfig.registerSheet(Item, 'ffxiv', FFXIVItemSheet, {
    makeDefault: true,
    label: 'FFXIV.SheetLabels.Item',
  });

  CONFIG.Item.typeLabels = {
    consumable: game.i18n.localize("FFXIV.ItemType.consumable"),
    limit_break: game.i18n.localize("FFXIV.ItemType.limit_break"),
    primary_ability: game.i18n.localize("FFXIV.ItemType.primary_ability"),
    secondary_ability: game.i18n.localize("FFXIV.ItemType.secondary_ability"),
    instant_ability: game.i18n.localize("FFXIV.ItemType.instant_ability"),
    trait: game.i18n.localize("FFXIV.ItemType.trait"),
    currency: game.i18n.localize("FFXIV.ItemType.currency"),
    title: game.i18n.localize("FFXIV.ItemType.title"),
    gear: game.i18n.localize("FFXIV.ItemType.gear"),
    minion: game.i18n.localize("FFXIV.ItemType.minion"),
    augment: game.i18n.localize("FFXIV.ItemType.augment"),
    job: game.i18n.localize("FFXIV.ItemType.job")
  };

  CONFIG.Actor.typeLabels = {
    character: game.i18n.localize("FFXIV.ActorType.character"),
    npc: game.i18n.localize("FFXIV.ActorType.npc"),
    pet: game.i18n.localize("FFXIV.ActorType.pet")
  };

  updateStatusEffects()
  registerEscapeHandler();

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

Handlebars.registerHelper('toLowerCase', function (str) {
  return str.toLowerCase();
});

Handlebars.registerHelper('range', function(end) {
    return Array.from({ length: end }, (_, i) => i+1);
  });

Handlebars.registerHelper('isOccupied', function(items, position) {
  return items.some(item => item.system.position == position);
});

Handlebars.registerHelper('add', function(a, b) {
  const left = Number(a);
  const right = Number(b);
  return (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0);
});
Handlebars.registerHelper('sub', function(a, b) {
  const left = Number(a);
  const right = Number(b);
  return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
});
Handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});
Handlebars.registerHelper('not', function(a) {
  return !a
});
Handlebars.registerHelper('or', function(a, b) {
  return a || b;
});
Handlebars.registerHelper('and', function(a, b) {
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

Handlebars.registerHelper("shopTierDisplay", function (systemOrTier, maybeCustom) {
  if (systemOrTier && typeof systemOrTier === "object" && !Array.isArray(systemOrTier)) {
    return formatShopTierDisplay(systemOrTier.shop_tier, systemOrTier.shop_tier_custom, game.i18n);
  }
  return formatShopTierDisplay(systemOrTier, maybeCustom, game.i18n);
});

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
    "1": "basic",
    "2": "green",
    "3": "aetherial",
    "4": "blue",
    "5": "relic",
    "6": "unique",
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

const BAKED_ACTION_TAG_LABELS = {
  primary_ability: "FFXIV.Tags.Primary",
  secondary_ability: "FFXIV.Tags.Secondary",
  instant_ability: "FFXIV.Tags.Instant",
  limit_break: "FFXIV.ItemType.limit_break",
};
const BAKED_ACTION_TAGS = new Set(["primary", "secondary", "instant", "limit break", "limit-break"]);

function isBakedActionTag(tag) {
  return BAKED_ACTION_TAGS.has(String(tag ?? "").trim().toLowerCase());
}

Handlebars.registerHelper("actionTags", function (type, tags) {
  const bakedTag = BAKED_ACTION_TAG_LABELS[type];
  const customTags = Array.isArray(tags) ? tags.filter(tag => !isBakedActionTag(tag)) : [];
  return bakedTag ? [bakedTag, ...customTags] : customTags;
});

Handlebars.registerHelper("customActionTags", function (tags) {
  return Array.isArray(tags) ? tags.filter(tag => !isBakedActionTag(tag)) : [];
});

Handlebars.registerHelper("hasCustomActionTags", function (tags) {
  return Array.isArray(tags) && tags.some(tag => !isBakedActionTag(tag));
});

Handlebars.registerHelper("bakedActionTag", function (type) {
  return BAKED_ACTION_TAG_LABELS[type] ?? "";
});
Handlebars.registerHelper('superior', function(a, b) {
  return a > b;
});
Handlebars.registerHelper('inferior', function(a, b) {
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

function getCharacterTabIcon(settingKey) {
  const configured = game.settings.get("ffxiv", settingKey);
  if (typeof configured === "string") {
    const normalized = configured.trim();
    if (normalized && normalized !== "null" && normalized !== "undefined") return normalized;
  }
  return DEFAULT_TAB_ICONS[settingKey];
}

const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_moveItem: "systems/ffxiv/assets/sfx/ffxiv-obtain-item.mp3",
  soundNotificationFFXIV_enterChat: "systems/ffxiv/assets/sfx/ffxiv-full-party.mp3",
  soundNotificationFFXIV_openSheet: "systems/ffxiv/assets/sfx/ffxiv-switch-target.mp3",
  soundNotificationFFXIV_closeSheet: "systems/ffxiv/assets/sfx/ffxiv-untarget.mp3",
};
const FFXIV_BARRIER_OVERLAY_KEY = "ffxivBarrierOverlay";
const FFXIV_MANA_OVERLAY_KEY = "ffxivManaOverlay";

function playConfiguredSound(setting) {
  const src = game.settings.get("ffxiv", setting) || DEFAULT_SOUNDS[setting];
  if (!game.settings.get("ffxiv", "soundNotificationFFXIV") || !src) return;
  foundry.audio.AudioHelper.play({ src, volume: 1, autoplay: true, loop: false });
}

Handlebars.registerHelper("characterTabs", function(settings){
  let items = [
    { tab: "abilities", label: game.i18n.localize("FFXIV.Abilities.Abilities"), icon: getCharacterTabIcon("imgTabAbilities") },
    { tab: "attributes", label: game.i18n.localize("FFXIV.Attributes.Attributes"), icon: getCharacterTabIcon("imgTabAttributes") },
    { tab: "roleplay", label: game.i18n.localize("FFXIV.CharacterSheet.Character"), icon: getCharacterTabIcon("imgTabRoleplay") },
  ];
  if (settings.showGear) items.push({ tab: "gear", label: game.i18n.localize("FFXIV.CharacterSheet.Gear"), icon: getCharacterTabIcon("imgTabGear") });
  items.push({ tab: "items", label: game.i18n.localize("FFXIV.CharacterSheet.Inventory"), icon: getCharacterTabIcon("imgTabItems") })
  items.push({ tab: "companions", label: game.i18n.localize("FFXIV.CharacterSheet.Companions"), icon: getCharacterTabIcon("imgTabCompanions") })
  items.push({ tab: "settings", label: game.i18n.localize("FFXIV.CharacterSheet.Config"), icon: getCharacterTabIcon("imgTabSettings") })
  return items;
})

Handlebars.registerHelper("getPetData", function(pets, id) {
  return pets.find(p => p._id === id);
});

Handlebars.registerHelper('repeat', function(n, options) {
    let content = '';
    for (let i = 0; i < n; i++) {
        content += options.fn({index: i});
    }
    return content;
});
Handlebars.registerHelper("object", function ({ hash }) {
  return hash;
});
Handlebars.registerHelper('reverse', function(array) {
  return array.slice().reverse(); // Reverse a copy of the array
});
Handlebars.registerHelper("labelize", function ( category, value ) {
  const configCategory = FF_XIV[category]
  const configValue = configCategory ? configCategory[value] : null
  return configValue ? configValue.label : value
});
Handlebars.registerHelper("delabelize", function ( category, label ) {
  const configCategory = FF_XIV[category];
  if (!configCategory) return "";
  for (const key in configCategory) {
    if (configCategory[key].label === label) {
      return configCategory[key].value;
    }
  }
  return "";
});

Handlebars.registerHelper('buildInventoryGrid', function(items, gridSize) {
  const grid = new Array(gridSize).fill(null); // Create an array of size gridSize filled with null
  items.forEach(item => {
    if ( CONFIG.FF_XIV.inventory_items.indexOf(item.type) > -1 ){ //Check item is inventoriable
      const pos = item.system.position;
      if ( pos >= 1 && pos <= gridSize ) { // Check if position is between 1 and gridSize
        grid[pos - 1] = item; // Place item in its position (0-indexed)
      }
    }
  });

  return grid; // Return the filled grid array
});
Handlebars.registerHelper("sortAbilities", function (items, order, type) {
  if (!order || !order[type] || !Array.isArray(order[type])) {
    return items.filter((i) => i.type === type); // no saved order, return as is
  }

  return items
  .filter((i) => i.type === type)
  .sort((a, b) => {
    const indexA = order[type].indexOf(a._id);
    const indexB = order[type].indexOf(b._id);

    return (indexA === -1 ? 9999 : indexA) - (indexB === -1 ? 9999 : indexB);
  });

});

Handlebars.registerHelper("sortPets", function (pets, order) {
  if (!order || !Array.isArray(order)) {
    return pets
  }
  return pets
  .sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    return (indexA === -1 ? 9999 : indexA) - (indexB === -1 ? 9999 : indexB);
  });
});
Handlebars.registerHelper("getActor", function (actorId) {
  return game.actors?.get(actorId)
});

Handlebars.registerHelper("gearBonuses", function (items) {
    const gearLabels = Object.values(CONFIG.FF_XIV.gear_subcategories).map(g => g.label);
    const getGearPosition = (category) => {
      let index = gearLabels.indexOf(category);
      return index !== -1 ? index : 999;
    };

    return items
        .filter(item => item.system?.equipped)
        .sort((a, b) => getGearPosition(a.system.category) - getGearPosition(b.system.category));
});
Handlebars.registerHelper("getAttributeBonus", function (gearItems, attrKey) {
    if (!gearItems || gearItems.length === 0) return []; // Prevent errors
    const modifiersList = Object.assign({},CONFIG.FF_XIV.attributes,CONFIG.FF_XIV.characteristics)
    return gearItems.map(item => {
        const modifierEntry = item.system?.modifiers?.find(mod => mod[0] === modifiersList[attrKey]?.label);
        return modifierEntry ? modifierEntry[1] : "-";
    });
});
Handlebars.registerHelper("attributeList", function () {
    return Object.keys(Object.assign({},CONFIG.FF_XIV.attributes,CONFIG.FF_XIV.characteristics));
});
Handlebars.registerHelper("hasItemType", function (items, type) {
  if (!items) return false;
  return items.some(item => item.type === type);
});


/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once('ready', function () {
  installTokenBarrierOverlay();

  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => {
    if (!isFFXIVItemHotbarDrop(data)) return;
    createItemMacro(data, slot);
    return false;
  });

  // Color Scheme to use with css variables
  if (game.settings.get("ffxiv","overrideColorScheme")){
    CONFIG.theme = "blue"
  }else{
    if (game.settings.get('core', 'uiConfig').colorScheme.applications){
      CONFIG.theme = game.settings.get('core', 'uiConfig').colorScheme.applications
    }else{
      CONFIG.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  }

  if (game.user.isGM) {
    migrateLegacyPetTraits();
    migrateLegacyShopTiers();
  }

});

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

async function migrateLegacyPetTraits() {
  for (const pet of game.actors.filter(actor => actor.type === "pet")) {
    const sourceTraits = pet._source?.system?.traits ?? pet.toObject(false).system?.traits ?? pet.system?.traits;
    const traits = typeof sourceTraits === "string" ? sourceTraits : "";
    if (!hasStringContent(traits)) continue;
    const hasMigrated = pet.items.some(item => item.type === "trait" && item.flags?.ffxiv?.migratedTrait);
    if (hasMigrated) continue;

    const traitItemData = {
      name: "Migrated Trait",
      type: "trait",
      img: "icons/svg/aura.svg",
      system: {
        description: traits,
        tags: [],
        activable: false,
        modifiers: [],
        source: "",
        level: 0
      },
      flags: {
        ffxiv: {
          migratedTrait: true
        }
      }
    };

    try {
      await pet.createEmbeddedDocuments("Item", [traitItemData]);
      await pet.update({ "system.traits": "" });
      debugLog(`FFXIV | Migrated traits for pet ${pet.name}`);
    } catch (error) {
      console.error("FFXIV | Pet trait migration failed for", pet.name, error);
    }
  }
}

const SHOP_TIER_MIGRATION_VERSION = "2026-05-shop-tier-v1";
const SHOP_TIER_TYPES = new Set(["consumable", "gear", "augment", "minion"]);

async function migrateLegacyShopTiers() {
  const currentVersion = game.settings.get("ffxiv", "shopTierMigrationVersion");
  if (currentVersion === SHOP_TIER_MIGRATION_VERSION) return;

  const worldItemUpdates = [];
  const actorItemUpdates = [];
  let pendingCount = 0;
  let inProgressNotification = null;

  try {
    for (const item of game.items) {
      if (!SHOP_TIER_TYPES.has(item.type)) continue;
      const nextTier = normalizeShopTier(item.system.shop_tier, item.system.shop_tier_custom);
      if (item.system.shop_tier === nextTier.shop_tier && (item.system.shop_tier_custom ?? "") === nextTier.shop_tier_custom) continue;
      worldItemUpdates.push({ item, nextTier });
      pendingCount++;
    }

    for (const actor of game.actors) {
      const updates = [];
      for (const item of actor.items) {
        if (!SHOP_TIER_TYPES.has(item.type)) continue;
        const nextTier = normalizeShopTier(item.system.shop_tier, item.system.shop_tier_custom);
        if (item.system.shop_tier === nextTier.shop_tier && (item.system.shop_tier_custom ?? "") === nextTier.shop_tier_custom) continue;

        updates.push({
          _id: item.id,
          "system.shop_tier": nextTier.shop_tier,
          "system.shop_tier_custom": nextTier.shop_tier_custom
        });
      }

      if (!updates.length) continue;
      actorItemUpdates.push({ actor, updates });
      pendingCount += updates.length;
    }

    if (pendingCount === 0) {
      await game.settings.set("ffxiv", "shopTierMigrationVersion", SHOP_TIER_MIGRATION_VERSION);
      return;
    }

    inProgressNotification = ui.notifications?.warn(
      game.i18n.localize("FFXIV.Notifications.ShopTierMigrationInProgress"),
      { permanent: true }
    );

    for (const { item, nextTier } of worldItemUpdates) {
      await item.update({
        "system.shop_tier": nextTier.shop_tier,
        "system.shop_tier_custom": nextTier.shop_tier_custom
      }, { render: false });
    }

    for (const { actor, updates } of actorItemUpdates) {
      await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    }

    await game.settings.set("ffxiv", "shopTierMigrationVersion", SHOP_TIER_MIGRATION_VERSION);
    ui.notifications.info(game.i18n.localize("FFXIV.Notifications.ShopTierMigrationComplete"));

  } catch (error) {
    console.error("FFXIV | Shop tier migration failed", error);
    ui.notifications.error(game.i18n.localize("FFXIV.Notifications.ShopTierMigrationFailed"));
  } finally {
    if (inProgressNotification) {
      if (typeof ui.notifications?.remove === "function") {
        ui.notifications.remove(inProgressNotification.id ?? inProgressNotification);
      }
      else if (typeof inProgressNotification.remove === "function") inProgressNotification.remove();
    }
  }
}

function getFFXIVTheme() {
  if (game.settings.get("ffxiv","overrideColorScheme")) return "blue";
  return game.settings.get('core', 'uiConfig').colorScheme.applications
    || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
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

  const uuid = data.uuid || (data.actorId && data.itemId ? `Actor.${data.actorId}.Item.${data.itemId}` : null);
  if (!uuid) return;

  const item = await fromUuid(uuid);
  if (!item) return ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.MacroItemMissing"));
  const folder = await getPlayerMacroFolder(item);

  const command = `const item = await fromUuid("${uuid}");
if (!item) return ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.MacroItemMissing"));
return item.roll?.();`;

  let macro = game.macros.find(m => m.name === item.name && m.command === command && m.folder?.id === folder?.id);
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command,
      folder: folder?.id,
      flags: { ffxiv: { itemUuid: uuid } }
    });
  }

  game.user.assignHotbarMacro(macro, slot);
  return false;
}

async function getPlayerMacroFolder(item) {
  const parentFolder = await getOrCreateMacroFolder("Player Macros");
  const actorName = item.parent?.documentName === "Actor" ? item.parent.name : game.user.character?.name || game.user.name;
  return getOrCreateMacroFolder(actorName, parentFolder);
}

async function getOrCreateMacroFolder(name, parent = null) {
  const parentId = parent?.id ?? null;
  const existing = game.folders.find(folder =>
    folder.type === "Macro"
    && folder.name === name
    && (folder.folder?.id ?? folder.parent ?? null) === parentId
  );
  if (existing) return existing;

  return Folder.create({
    name,
    type: "Macro",
    folder: parentId
  });
}

/* -------------------------------------------- */
/*  Render Actor Sheet Hook                     */
/* -------------------------------------------- */

let isDraggingItem = false;
Hooks.on('renderActorSheet', async (app, html, data) => {
  if (app instanceof FFXIVActorSheet) return;
  const actor = app.actor;
  const isOwner = actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  if (isDraggingItem && !isOwner) return;
  const items = actor.items.contents;

  // Step 1: Get all current positions and identify invalid ones
  const occupiedPositions = new Set();
  const itemsToUpdate = [];

  // Iterate through the items and check for duplicates or invalid positions
  items.forEach(item => {
    if (FF_XIV.inventory_items.indexOf(item.type) > -1){
        const position = Number(item.system.position) || 0;
        if (occupiedPositions.has(position) || position === 0) {
          // Invalid or duplicate position, needs to be updated
          itemsToUpdate.push(item);
        } else {
          // Valid unique position, mark it as occupied
          occupiedPositions.add(position);
        }
    }
  });

  // Step 2: Assign the next available position to items with invalid positions
  let nextFreePosition = 1;
  itemsToUpdate.forEach(item => {
    if (CONFIG.FF_XIV.inventory_items.indexOf(item.type) > -1){
      // Find the next free position
      while (occupiedPositions.has(nextFreePosition)) {
        nextFreePosition++;
      }

      // Update the item with the new position
      item.update({ 'system.position': nextFreePosition });
      occupiedPositions.add(nextFreePosition); // Mark the new position as occupied
    }
  });

  // Step 3: Re-render the inventory grid if changes were made
  if (itemsToUpdate.length > 0) {
    app.render();
  }
});

let draggedItem = null;

Hooks.on('renderActorSheet', (app, html, data) => {
  if (app instanceof FFXIVActorSheet) return;
  const actor = app.actor;
  const isOwner = actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  if(!isOwner) return;

  html.find('.inventory-item').off('dragstart drop dragover');

  // Handle drag start
  html.find('.inventory-item').on('dragstart', event => {
    debugLog('Drag started:', event.currentTarget.dataset.itemId);
    draggedItem = {
      id: event.currentTarget.dataset.itemId,
      position: event.currentTarget.dataset.itemPosition
    };
    isDraggingItem = true;
    const dragGhost = event.currentTarget.cloneNode(true);
    dragGhost.querySelector('.item-tooltip').style.display = 'none';
    dragGhost.querySelector('.item-quantity').style.display = 'none';

    dragGhost.style.position = 'absolute';
    dragGhost.style.top = '-1000px';
    document.body.appendChild(dragGhost);

    event.originalEvent.dataTransfer.setDragImage(dragGhost, 0, 0);

    setTimeout(() => {
      document.body.removeChild(dragGhost);
    }, 0);

    const item = actor.items.get(event.currentTarget.dataset.itemId);
    event.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({
      type: "Item",
      uuid: item.uuid
    }));
  });



  // Handle drag over (for both items and empty slots)
  html.find('.inventory-item').on('dragover', event => {
    debugLog('Drag over:', event.currentTarget.dataset.itemId || 'empty slot');
  });

  // Handle drop event (for both items and empty slots)
  html.find('.inventory-item').on('drop', async event => {
    event.preventDefault();
    debugLog(event);

    const targetPosition = event.currentTarget.dataset.itemPosition;

    debugLog('Dropped on:', targetPosition || 'empty slot');

    // If dropped on an empty slot, there's no item ID
    const targetItemId = event.currentTarget.dataset.itemId;

    const draggedItemData = actor.items.get(draggedItem.id);

    if (targetItemId) {
      // If there's an item in the target slot, swap the items
      const targetItemData = actor.items.get(targetItemId);
      await draggedItemData.update({ 'system.position': targetPosition });
      await targetItemData.update({ 'system.position': draggedItem.position });
    } else {
      // If it's an empty slot, move the dragged item there
      await draggedItemData.update({ 'system.position': targetPosition });
    }

    playConfiguredSound("soundNotificationFFXIV_moveItem");

    // Re-render the inventory after dropping
    app.render();
  });
});


Hooks.on("preCreateItem", (itemData, options, userId) => {
  //Default Images for Items
  if (!itemData.img || itemData.img === "icons/svg/item-bag.svg") {
    const defaultImages = {

    };
    const defaultImg = defaultImages[itemData.type] || "icons/svg/item-bag.svg";
    itemData.updateSource({ img: defaultImg });
  }
  //Currencies should be added, not split in several piles
  if (itemData.type !== "currency") return;
  const actor = itemData.parent;
  if (!actor) return;
  const existingCurrency = actor.items.find(i => i.type === "currency" && i.name === itemData.name);
  if (existingCurrency){
    const addedQty = parseInt(itemData.system?.quantity) ?? 0;
    const oldQty = parseInt(existingCurrency.system?.quantity) ?? 0;
    existingCurrency.update({ "system.quantity": parseInt(oldQty + addedQty) });
    return false
  };

});

Hooks.on("userConnected", (player, login, data) => {
  if(login && !game.paused){ //If the game is paused or the player logouts, do not play anything
    ui.notifications.info(game.i18n.format("FFXIV.Notifications.NewPlayer", {playerName: player.name}));
    playConfiguredSound("soundNotificationFFXIV_enterChat");
  }
});

Hooks.on("renderActorSheet", (app, html, data) => {
  if (app instanceof FFXIVActorSheet) return;
  playConfiguredSound("soundNotificationFFXIV_openSheet");
  const actorSheet = app.actor.sheet;
  html.on('click', '.abilities-sub-tabs .sub-tab', actorSheet._displayAbilityTab.bind(actorSheet))
  html.on('click', '.companions-sub-tabs .companions-sub-tab', actorSheet._displayCompanionTab.bind(actorSheet))

});

Hooks.on("updateItem", (item, diff, options, userId) => {
  refreshOwnedItemActorSheets(item, { preserveTopWindow: true })
    .catch(err => debugError("FFXIV | Failed to refresh actor sheet after item update", err));
});

Hooks.on("closeItemSheet", (app) => {
  refreshOwnedItemActorSheets(app?.item)
    .catch(err => debugError("FFXIV | Failed to refresh actor sheet after item sheet close", err));
});

async function refreshOwnedItemActorSheets(item, { preserveTopWindow = false } = {}) {
  if (!item?.parent || item.parent.documentName !== "Actor") return;

  const sheets = new Set();
  if (item.parent.sheet?.rendered) sheets.add(item.parent.sheet);
  for (const sheet of Object.values(ui.windows)) {
    if (sheet instanceof FFXIVActorSheet && sheet.actor?.id === item.parent.id && sheet.rendered) {
      sheets.add(sheet);
    }
  }
  if (!sheets.size) return;

  const restoreTopWindow = preserveTopWindow ? captureTopWindowRestore() : null;
  for (const sheet of sheets) {
    if (sheet instanceof FFXIVActorSheet && typeof sheet._captureSheetScroll === "function") {
      sheet._captureSheetScroll();
    }
  }

  for (const sheet of sheets) {
    await sheet.render({ force: true, focus: false });
  }

  for (const sheet of sheets) {
    if (sheet instanceof FFXIVActorSheet && typeof sheet._restoreSheetScroll === "function") {
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
    const highestZIndex = getApplicationElements()
      .reduce((highest, element) => Math.max(highest, getZIndex(element)), 0);
    topElement.style.zIndex = String(highestZIndex + 1);
  };
}

function getTopApplicationElement() {
  return getApplicationElements()
    .sort((a, b) => getZIndex(b) - getZIndex(a))[0] ?? null;
}

function getApplicationElements() {
  const apps = [
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications.instances?.values?.() ?? []),
  ];

  return [...new Set(apps)]
    .map(getApplicationElement)
    .filter(element => element && document.body.contains(element));
}

function getApplicationElement(app) {
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  if (app?.id) return document.getElementById(app.id);
  if (Number.isFinite(app?.appId)) return document.querySelector(`[data-appid="${app.appId}"]`);
  return null;
}

function getZIndex(element) {
  const zIndex = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex : 0;
}

Hooks.on("closeActorSheet", (hookEvent, html) => {
  if (hookEvent instanceof FFXIVActorSheet) return;
  playConfiguredSound("soundNotificationFFXIV_closeSheet");
})

Hooks.on("renderChatLog", (app, html) => {
  applyFFXIVChatTheme(html);
  document.querySelector("section#chat.sidebar-tab")?.classList.add("chat-ffxiv", `${getFFXIVTheme()}_theme`);
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
    }
    if (row && attribute) barRows[attribute] = row;
  }

  if (tokenDocument.actor?.type !== "character") {
    element.querySelector(".attribute.ffxiv-mana-hud")?.remove();
    return;
  }

  const barsContainer = barRows.health?.parentElement
    ?? barRows.barrier?.parentElement
    ?? element.querySelector(".col.right")
    ?? element;

  if (barRows.health) barRows.health.classList.add("ffxiv-hud-health");
  if (barRows.barrier) barRows.barrier.classList.add("ffxiv-hud-barrier");

  if (barRows.barrier) barsContainer.appendChild(barRows.barrier);
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
    const manaMax = Math.max(0, Number(tokenDocument.actor?.system?.mana?.max ?? 5) || 5);
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
        const manaCap = Math.max(0, Number(tokenDocument.actor?.system?.mana?.max ?? 5) || 5);
        const nextValue = Math.max(0, Math.min(next, manaCap));
        manaInput.value = String(nextValue);
        if (nextValue === current) return;
        await tokenDocument.actor.update({ "system.mana.value": nextValue }, { render: false });
        refreshActorTokenBars(tokenDocument.actor);
      };

      manaInput.addEventListener("change", () => { void applyMana(); });
      manaInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        manaInput.blur();
      });
      manaInput.addEventListener("blur", () => { void applyMana(); });
    }
  }

  barsContainer.appendChild(manaRow);
});

Hooks.on("updateActor", (actor, changes) => {
  if (actor?.type !== "character") return;
  const manaChanged = foundry.utils.hasProperty(changes, "system.mana.value")
    || foundry.utils.hasProperty(changes, "system.mana.max");
  if (!manaChanged) return;
  refreshActorTokenBars(actor);
});

function installTokenBarrierOverlay() {
  const tokenProto = foundry.canvas.placeables.Token?.prototype;
  if (!tokenProto || tokenProto._ffxivBarrierOverlayPatched) return;

  const originalDrawBars = tokenProto.drawBars;
  tokenProto.drawBars = function (...args) {
    const result = originalDrawBars.apply(this, args);
    drawFFXIVBarrierOverlay(this);
    drawFFXIVManaOverlay(this);
    return result;
  };

  tokenProto._ffxivBarrierOverlayPatched = true;
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
  const barrierValue = Math.max(Number(token.actor.system?.barrier?.value) || 0, 0);
  if (barrierValue <= 0) return;

  const startPct = Math.clamp(currentHealth, 0, maxHealth) / maxHealth;
  const barrierPct = barrierValue / maxHealth;
  const insidePct = Math.clamp(Math.min(barrierPct, 1 - startPct), 0, 1);
  const overflowPct = Math.max(barrierPct - insidePct, 0);
  const overflowDisplayPct = Math.min(overflowPct, 1);

  const { width, height } = token.document.getSize();
  const scale = canvas.dimensions.uiScale;
  const barHeight = 8 * (token.document.height >= 2 ? 1.5 : 1) * scale;
  const barY = (healthBarName === "bar1") ? (height - barHeight) : 0;
  const barWidth = width;
  const barrierColor = 0xffd54f;

  overlay.position.set(0, 0);
  overlay.lineStyle(scale, 0x000000, 0.85);
  if (insidePct > 0) {
    overlay.beginFill(barrierColor, 0.95);
    overlay.drawRoundedRect(startPct * barWidth, barY, insidePct * barWidth, barHeight, 2 * scale);
  }

  if (overflowDisplayPct > 0) {
    const overflowHeight = Math.max(2 * scale, barHeight * 0.45);
    const overflowY = barY - overflowHeight - (0.5 * scale);
    overlay.beginFill(barrierColor, 0.95);
    overlay.drawRoundedRect(0, overflowY, overflowDisplayPct * barWidth, overflowHeight, 2 * scale);
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
  const barY = height + (2 * scale);
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
    if (!token?.actor || token.actor.type !== "character") continue;
    if (token.actor === actor || token.actor.id === actor.id) {
      if (typeof token.drawBars === "function") token.drawBars();
      else token.renderFlags?.set?.({ refreshBars: true });
    }
  }
}

function getHookHTMLElement(html, app) {
  return html instanceof HTMLElement ? html
    : html?.[0] instanceof HTMLElement ? html[0]
    : html?.element instanceof HTMLElement ? html.element
    : html?.element?.[0] instanceof HTMLElement ? html.element[0]
    : app?.element instanceof HTMLElement ? app.element
    : app?.element?.[0] instanceof HTMLElement ? app.element[0]
    : null;
}

const FFXIV_MARKER_SOCKET_TYPE = "placeMarkerTile";
const markerDialogs = new WeakSet();

Hooks.on("getSceneControlButtons", (controls) => {
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
    }
  };
  controls.tiles.tools = insertSceneToolAfterSelect(controls.tiles.tools, "ffxivMarker", markerTool);
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

async function openMarkerPlacementTool() {
  if (!canvas.scene) {
    ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"));
    return;
  }

  const marker = await configureMarkerShape();
  if (!marker) return;

  const gridSize = canvas.grid.size;
  const rendered = renderMarkerDataUrl(marker, gridSize);
  if (!rendered) {
    ui.notifications.warn(game.i18n.localize("FFXIV.MarkerPlacement.Errors.EmptyShape"));
    return;
  }

  try {
    if (marker.targeted) {
      ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToken"));
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
              tokenId: target.token.document.id
            }
          }
        }
      });
      return;
    }

    ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToPlace"));
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
            targeted: false
          }
        }
      }
    });
  } catch (err) {
    debugError("Marker placement failed:", err);
    ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.TileFailed"));
  }
}

async function requestMarkerTileCreation(tileData) {
  if (game.user.isGM) return createMarkerTileFromRequest({
    sceneId: canvas.scene.id,
    tileData
  });

  const gm = game.users.find(user => user.active && user.isGM);
  if (!gm) {
    ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoGM"));
    return null;
  }

  game.socket.emit("system.ffxiv", {
    type: FFXIV_MARKER_SOCKET_TYPE,
    userName: game.user.name,
    gmUserId: gm.id,
    data: {
      sceneId: canvas.scene.id,
      tileData
    }
  });
  ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Instructions.RequestSent"));
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
    scaleY: 1
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
  const state = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  for (let y = center - 2; y <= center + 2; y++) {
    for (let x = center - 2; x <= center + 2; x++) state[y][x] = true;
  }
  let selection = {
    state,
    opacity: 0.8,
    type: "enemy",
    mode: "standard",
    targeted: false
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
          ${state.flatMap((row, y) => row.map((_on, x) =>
            `<div class="ffxiv-marker-cell" data-x="${x}" data-y="${y}" style="width: 24px; height: 24px; box-sizing: border-box; border: 1px solid #888; background: ${state[y][x] ? "orange" : "#222"}; cursor: pointer;"></div>`
          )).join("")}
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

  initializeMarkerShapeDialog(wrapper, null, state, center, selectionValue => {
    selection = selectionValue;
  });
  const confirmed = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("FFXIV.MarkerPlacement.Title"), resizable: true },
    position: { width: 760 },
    content: wrapper,
    buttons: [
      { action: "create", label: game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Button.Place"), icon: "fas fa-check", default: true, callback: () => true },
      { action: "cancel", label: "Cancel", icon: "fas fa-times", callback: () => false }
    ],
    render: (app, html) => {
      initializeMarkerShapeDialog(app, html, state, center, selectionValue => {
        selection = selectionValue;
      });
    }
  });

  if (!confirmed) return null;
  return selection;
}

function initializeMarkerShapeDialog(app, html, state, center, setSelection, dialogKey) {
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
  if (!cells.length || !type || !opacity || !opacityValue || !mode || !targeted || !preview) {
    markerDialogs.delete(element);
    return false;
  }
  const updateSelection = () => {
    setSelection({
      state,
      opacity: Number(opacity.value) / 100,
      type: type.value,
      mode: mode.value,
      targeted: targeted.checked
    });
  };

  const updateCells = () => {
    for (const cell of cells) {
      const on = state[Number(cell.dataset.y)][Number(cell.dataset.x)];
      cell.classList.toggle("selected", on);
      cell.classList.toggle("enemy", on && type.value === "enemy");
      cell.classList.toggle("allied", on && type.value === "allied");
      cell.style.background = !on ? "#222" : type.value === "enemy" ? "orange" : "#66ffff";
    }
  };
  const updatePreview = () => {
    updateSelection();
    const rendered = renderMarkerDataUrl({
      state,
      opacity: Number(opacity.value) / 100,
      type: type.value,
      mode: mode.value,
      targeted: targeted.checked
    }, Math.max(24, Math.round(canvas.grid.size / 3)));
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
  const toggleCell = cell => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    state[y][x] = !state[y][x];
    updateCells();
    updatePreview();
  };

  for (const cell of cells) {
    cell.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      initial = state[Number(cell.dataset.y)][Number(cell.dataset.x)];
      toggleCell(cell);
    });
    cell.addEventListener("pointerenter", () => {
      if (!dragging) return;
      if (state[Number(cell.dataset.y)][Number(cell.dataset.x)] === initial) toggleCell(cell);
    });
  }
  window.addEventListener("pointerup", () => dragging = false, { signal: html?.options?.signal });
	  element.querySelectorAll("[data-span][data-mode]").forEach(button => {
	    button.addEventListener("click", event => {
	      event.preventDefault();
	      configurePreset(Number(button.dataset.span), button.dataset.mode);
	    });
	  });
	  element.querySelectorAll("[data-circle-span][data-mode]").forEach(button => {
	    button.addEventListener("click", event => {
	      event.preventDefault();
	      configureCirclePreset(Number(button.dataset.circleSpan), button.dataset.mode);
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
  const keyedElement = dialogKey ? document.querySelector(`[data-ffxiv-marker-dialog="${dialogKey}"]`) : null;
  const visibleMarkerElements = Array.from(document.querySelectorAll(".ffxiv-marker-config"))
    .filter(element => element.offsetParent !== null);
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
    visibleMarkerElements.at(-1)?.closest(".app, .application, .window-app, .dialog")
  ];

  return candidates.find(element =>
    element instanceof HTMLElement && element.querySelector?.("#ffxiv-marker-preview")
  ) ?? null;
}

function renderMarkerDataUrl(marker, gridSize) {
  const bounds = getMarkerBounds(marker.state);
  if (!bounds) return null;
  const cropped = marker.state.slice(bounds.minY, bounds.maxY + 1)
    .map(row => row.slice(bounds.minX, bounds.maxX + 1));
  const widthCells = cropped[0].length;
  const heightCells = cropped.length;
  const width = widthCells * gridSize;
  const height = heightCells * gridSize;
  const canvasElement = document.createElement("canvas");
  canvasElement.width = width;
  canvasElement.height = height;
  const ctx = canvasElement.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const isOn = (x, y) => y >= 0 && y < heightCells && x >= 0 && x < widthCells && cropped[y][x];
  const baseColor = marker.mode === "tankbuster" ? "firebrick" : marker.type === "enemy" ? "orange" : "#66ffff";

  ctx.globalAlpha = marker.opacity;
  ctx.fillStyle = baseColor;
  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      if (!cropped[y][x]) continue;
      drawMarkerCell(ctx, x * gridSize, y * gridSize, gridSize, [
        isOn(x, y - 1),
        isOn(x - 1, y),
        isOn(x + 1, y),
        isOn(x, y + 1)
      ]);
      ctx.fill();
    }
  }

  drawMarkerOverlays(ctx, cropped, width, height, gridSize, marker);
  return { src: canvasElement.toDataURL("image/webp"), width, height, widthCells, heightCells };
}

function getMarkerBounds(state) {
  let minX = state[0].length;
  let minY = state.length;
  let maxX = -1;
  let maxY = -1;
  state.forEach((row, y) => row.forEach((value, x) => {
    if (!value) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }));
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
  if (!bottom && !right) ctx.arcTo(x + size, y + size, x + size, y + size - radius, radius);
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
    for (const { dx, dy } of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]) {
      for (let step = 1; step <= 2; step++) {
        const x = centerX + dx * step;
        const y = centerY + dy * step;
        if (!cropped[y]?.[x]) break;
        drawMarkerArrow(ctx, x * gridSize + gridSize / 2, y * gridSize + gridSize / 2, width / 2, height / 2, gridSize * 0.4, "yellow", step === 1 ? marker.opacity : marker.opacity * 0.5, true);
      }
    }
  }

  if (marker.mode === "knockback") {
    for (let y = 0; y < heightCells; y++) {
      for (let x = 0; x < widthCells; x++) {
        if (!cropped[y][x] || (x === centerX && y === centerY)) continue;
        drawMarkerArrow(ctx, x * gridSize + gridSize / 2, y * gridSize + gridSize / 2, width / 2, height / 2, gridSize * 0.6, "#8b4513", marker.opacity * 0.5, false);
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

function drawMarkerArrow(ctx, tileX, tileY, originX, originY, length, color, alpha, inward) {
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

  const snap = event => {
    const gridSize = canvas.grid.size;
    const pos = getCanvasEventPosition(event);
    const cellX = Math.floor(pos.x / gridSize);
    const cellY = Math.floor(pos.y / gridSize);
    sprite.x = (cellX - Math.floor(rendered.widthCells / 2)) * gridSize;
    sprite.y = (cellY - Math.floor(rendered.heightCells / 2)) * gridSize;
    return { x: sprite.x, y: sprite.y };
  };

  return new Promise(resolve => {
    const cleanup = () => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onClick);
      canvas.stage.off("rightdown", onCancel);
      canvas.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    };
    const onMove = event => snap(event);
    const onClick = event => {
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

  const positionForEvent = event => {
    const pos = getCanvasEventPosition(event);
    const token = canvas.tokens.placeables.find(placeable =>
      pos.x >= placeable.x && pos.x <= placeable.x + placeable.w
      && pos.y >= placeable.y && pos.y <= placeable.y + placeable.h
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

  return new Promise(resolve => {
    const cleanup = () => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onClick);
      canvas.stage.off("rightdown", onCancel);
      canvas.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    };
    const onMove = event => positionForEvent(event);
    const onClick = event => {
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
  if (event.data?.getLocalPosition) return event.data.getLocalPosition(canvas.stage);
  if (event.getLocalPosition) return event.getLocalPosition(canvas.stage);
  if (event.global) return canvas.stage.worldTransform.applyInverse(event.global);
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
  if (!("width" in changes || "height" in changes) || "x" in changes || "y" in changes) return;
  updateTargetedMarkersForToken(tokenDocument, tokenDocument);
});

function updateTargetedMarkersForToken(tokenDocument, tokenPosition) {
  const scene = tokenDocument.parent;
  if (!scene || canvas.scene?.id !== scene.id) return;
  for (const tile of scene.tiles) {
    const marker = tile.getFlag("ffxiv", "markerPlacement");
    if (!marker?.targeted || marker.tokenId !== tokenDocument.id) continue;
    const position = getCenteredMarkerPosition(tile, tokenPosition);
    tile.update({
      x: position.x,
      y: position.y
    }).catch(err => debugError("Failed to move targeted marker:", err));
  }
}

function getCenteredMarkerPosition(tile, tokenPosition) {
  const gridSize = canvas.grid.size;
  const tokenWidth = (tokenPosition.width ?? 1) * gridSize;
  const tokenHeight = (tokenPosition.height ?? 1) * gridSize;
  return {
    x: Math.round(tokenPosition.x + tokenWidth / 2 - tile.width / 2),
    y: Math.round(tokenPosition.y + tokenHeight / 2 - tile.height / 2)
  };
}

function applyDamageToActor(actor, damage) {
  const incomingDamage = Math.max(Number.parseInt(damage, 10) || 0, 0);
  const barrier = Math.max(Number(actor.system.barrier?.value) || 0, 0);
  const healthDamage = Math.max(incomingDamage - barrier, 0);
  const updates = {
    "system.health.value": Math.max((Number(actor.system.health?.value) || 0) - healthDamage, 0)
  };

  if (barrier > 0) {
    updates["system.barrier.value"] = Math.max(barrier - incomingDamage, 0);
  }

  return actor.update(updates);
}

function normalizeTagValue(tag) {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseTagSetting(raw) {
  return String(raw ?? "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}

function buildTagPool(tags) {
  const pool = {};
  for (const tag of tags) {
    const key = tag.replace(/\s+/g, "-");
    if (!pool[key]) {
      pool[key] = {
        value: key,
        label: tag
      };
    }
  }
  return pool;
}

async function migrateCustomTagSettings() {
  const categories = [
    { configKey: "customAbilityTags", baseKey: "base_tags_abilities" },
    { configKey: "customTraitTags", baseKey: "base_tags_traits" },
    { configKey: "customConsumableTags", baseKey: "base_tags_consumables" }
  ];

  for (const { configKey, baseKey } of categories) {
    const baseTags = Array.isArray(FF_XIV[baseKey]) ? FF_XIV[baseKey] : [];
    const normalizedBase = new Set(baseTags.map(normalizeTagValue));
    const raw = game.settings.get("ffxiv", configKey);
    const customTags = parseTagSetting(raw);
    const filtered = customTags.filter(tag => !normalizedBase.has(normalizeTagValue(tag)));
    const hasChanged = filtered.length !== customTags.length || filtered.some((tag, idx) => tag !== customTags[idx]);
    if (!hasChanged) continue;
    await game.settings.set("ffxiv", configKey, filtered.join(","));
  }
}

Hooks.on("ready", function(){
  migrateCustomTagSettings().catch(err => debugError("FFXIV | Custom tag migration failed:", err));

  const categories = [
    { configKey: "customAbilityTags", configTarget: "tags_abilities", baseKey: "base_tags_abilities" },
    { configKey: "customTraitTags", configTarget: "tags_traits", baseKey: "base_tags_traits" },
    { configKey: "customConsumableTags", configTarget: "tags_consumables", baseKey: "base_tags_consumables" }
  ];

  CONFIG.FF_XIV = CONFIG.FF_XIV || {};

  for (let { configKey, configTarget, baseKey } of categories) {
    const baseTags = Array.isArray(FF_XIV[baseKey]) ? FF_XIV[baseKey] : [];
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
    CONFIG.FF_XIV[configTarget] = buildTagPool(deduped);
  }


  if (game.user.isGM) {
    game.socket.on("system.ffxiv", async (params) => {
      debugLog("get socket");
      const {type, data, userName, gmUserId } = params;
      if (gmUserId && gmUserId !== game.user.id) return;
      const actors = data.actorIds?.map(id => game.actors.get(id)).filter(Boolean) ?? [];
      switch (type) {
        case FFXIV_MARKER_SOCKET_TYPE:
          try {
            await createMarkerTileFromRequest(data);
          } catch (err) {
            debugError("socket marker placement failed:", err);
          }
          break;
        case "applyEffect":
          debugLog("status socket");
          const effects = (Array.isArray(data.effects) ? data.effects : [{ effect: data.effect, active: data.active }])
            .filter(entry => entry.effect);
          if (!actors || !effects.length) return;
          const effectList = effects.map(entry => game.i18n.localize(entry.effect.label)).join(", ");
          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-apply-effect",
            window: {title: game.i18n.localize("FFXIV.Notifications.StatusChangeRequest")},
            content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest",{playerName:userName, effect: effectList})}</p>
                <ul>${actors.map(a => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
	                callback: (event, button) => {
	                  for (const actor of actors) {
	                    for (const { effect, active } of effects) {
	                      actor.toggleStatusEffect(effect.id, {active});
	                      ui.notifications.info(game.i18n.format("FFXIV.Notifications.EffectApplied", {effect: game.i18n.localize(effect.label), actor: actor.name }));
	                    }
	                  }
	                }
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              }
            ]
          }).render(true);
          break;

        case "applyHeal":
          debugLog("heal socket");
          const heal = data.heal
          debugLog(actors,!actors);
          debugLog(heal,!heal);
          if (!actors || !heal) return;
          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-heal",
            window: {title: game.i18n.localize("FFXIV.Notifications.HealChangeRequest")},
            content: `<p>${game.i18n.format("FFXIV.Notifications.HealRequest",{playerName:userName, heal: heal})}</p>
                <ul>${actors.map(a => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: (event, button) => {
                  for (const actor of actors) {
                    const health = Math.min( actor.system.health.value + parseInt(heal), actor.system.health.max )
                    actor.update({"system.health.value":health})
                  }
                }
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              }
            ]
          }).render(true);
          break;

        case "applyDamage":
          debugLog("damage socket");
          const damage = data.damage
          if (!actors || !damage) return;
          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-damage",
            window: {title: game.i18n.localize("FFXIV.Notifications.DamageChangeRequest")},
            content: `<p>${game.i18n.format("FFXIV.Notifications.DamageRequest",{playerName:userName, damage: damage})}</p>
                <ul>${actors.map(a => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: (event, button) => {
                  for (const actor of actors) {
                    applyDamageToActor(actor, damage);
                  }
                }
              },
              {
                label: game.i18n.localize("FFXIV.Sockets.Decline"),
                action: "decline",
                type: "submit",
              }
            ]
          }).render(true);
          break;
        default:
          debugError("socket error : type of request not found", type);

      }
    });
  }

})

Hooks.on("renderChatMessageHTML", (message, html, data) => {
  applyFFXIVChatTheme(html);

  const jqueryhtml = $(html)
  const markApplyToChatCard = async ({ kind, amount, count }) => {
    const typeKey = kind === "heal" ? "FFXIV.Chat.Heal" : "FFXIV.Chat.Damage";
    const notice = game.i18n.format("FFXIV.Chat.ApplyResult", {
      type: game.i18n.localize(typeKey),
      amount: amount,
      count: count
    });

    jqueryhtml.find(".ffxiv-apply-dmg, .ffxiv-apply-heal")
      .prop("disabled", true)
      .addClass("ffxiv-apply-used");

    const existing = jqueryhtml.find(".ffxiv-apply-result");
    if (existing.length) {
      existing.text(notice);
    } else {
      const buttonRow = jqueryhtml.find(".ffxiv-apply-dmg, .ffxiv-apply-heal").first().parent();
      if (buttonRow.length) {
        buttonRow.after(`<div class="ffxiv-apply-result">${notice}</div>`);
      } else {
        jqueryhtml.append(`<div class="ffxiv-apply-result">${notice}</div>`);
      }
    }

    const updatedContent = jqueryhtml.find(".message-content").first().html();
    if (updatedContent) await message.update({ content: updatedContent });
  };

  jqueryhtml.find(".ffxiv-roll-base").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    if (item) item._rollBase(ev);
  });

  jqueryhtml.find(".ffxiv-roll-alternate").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    if (item) item._rollAlternate(ev);
  });

  jqueryhtml.find(".ffxiv-roll-hit").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    if (item) item._rollHit(ev);
  });

  jqueryhtml.find(".ffxiv-roll-direct").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    if (item) item._rollDirect(ev);
  });

  jqueryhtml.find(".ffxiv-roll-critical").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    if (item) item._rollCritical(ev);
  });

  jqueryhtml.find(".ffxiv-roll-critical-alternate").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    if (item) item._rollCriticalAlternate(ev);
  });

  jqueryhtml.find(".ffxiv-show-modifiers").on("click", async ev => {
    debugLog("call show modifiers");
    const itemId = ev.currentTarget.dataset.itemId;
    debugLog(itemId);
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    debugLog(actor);
    if (actor) actor._showModifiers(ev);
  });

  jqueryhtml.find(".ffxiv-apply-heal").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
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
        ownActors.push(actor);
      } else {
        actorsNeedingGM.push(actor);
      }
    }
    for (const actor of ownActors) {
      const health = Math.min( actor.system.health.value + parseInt(heal), actor.system.health.max)
      actor.update({"system.health.value": health})
    }
    if (actorsNeedingGM.length > 0) {
      debugLog("Send socket to GM, heal",heal);
      game.socket.emit("system.ffxiv", {
        type: "applyHeal",
        data: {
          actorIds: actorsNeedingGM.map(a => a.id),
          heal: heal,
          active: ev.currentTarget.dataset.action === 'true'
        },
        userName: game.user.name
      });
      ui.notifications.info(game.i18n.localize("FFXIV.Notifications.SendSocket"))
    }

    await markApplyToChatCard({ kind: "heal", amount: heal, count: targets.length });

  });
  jqueryhtml.find(".ffxiv-apply-dmg").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }
    const damage = parseInt(eval(ev.currentTarget.dataset.damage));
    const ownActors = [];
    const actorsNeedingGM = [];
    for (const token of targets) {
      const actor = token.actor;
      if (actor.testUserPermission(game.user, "OWNER")) {
        ownActors.push(actor);
      } else {
        actorsNeedingGM.push(actor);
      }
    }
    for (const actor of ownActors) {
      applyDamageToActor(actor, damage);
    }
    if (actorsNeedingGM.length > 0) {
      debugLog("Send socket to GM, damage",damage);
      game.socket.emit("system.ffxiv", {
        type: "applyDamage",
        data: {
          actorIds: actorsNeedingGM.map(a => a.id),
          damage: damage,
          active: ev.currentTarget.dataset.action === 'true'
        },
        userName: game.user.name
      });
      ui.notifications.info(game.i18n.localize("FFXIV.Notifications.SendSocket"))
    }

    await markApplyToChatCard({ kind: "damage", amount: damage, count: targets.length });
  });

  jqueryhtml.find(".ffxiv-apply-status").on("click", async ev => {
    const itemId = ev.currentTarget.dataset.itemId;
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    const item = actor?.items?.get(itemId);
    const statusEntries = getStatusEffectEntriesForItem(item, ev.currentTarget);
    const targets = Array.from(game.user.targets);

    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }
    if (!statusEntries.length) return;

    const ownActors = [];
    const actorsNeedingGM = [];

    for (const token of targets) {
      const actor = token.actor;
      if (actor.testUserPermission(game.user, "OWNER")) {
        ownActors.push(actor);
      } else {
        actorsNeedingGM.push(actor);
      }
    }

    for (const actor of ownActors) {
      for (const { effect, active } of statusEntries) {
        await actor.toggleStatusEffect(effect.id, { active });
        ui.notifications.info(game.i18n.format("FFXIV.Notifications.EffectApplied", {effect: game.i18n.localize(effect.label), actor: actor.name }));
      }
    }

    if (actorsNeedingGM.length > 0) {
      debugLog("Send socket to GM, statusEffects", statusEntries);
      game.socket.emit("system.ffxiv", {
        type: "applyEffect",
        data: {
          actorIds: actorsNeedingGM.map(a => a.id),
          effects: statusEntries
        },
        userName: game.user.name
      });
      ui.notifications.info(game.i18n.localize("FFXIV.Notifications.SendSocket"))
    }

  });

});

function getStatusEffectEntriesForItem(item, element) {
  const sourceEntries = Array.isArray(item?.system?.status_effects) && item.system.status_effects.length
    ? item.system.status_effects
    : item?.system?.status_effect
      ? [{ id: item.system.status_effect, action: item.system.status_action !== false }]
      : element?.dataset?.effectId
        ? [{ id: element.dataset.effectId, action: element.dataset.action === "true" }]
        : [];

  return sourceEntries
    .map(entry => ({
      effect: CONFIG.statusEffects.find(effect => effect.id === entry?.id),
      active: entry?.action !== false
    }))
    .filter(entry => entry.effect);
}
