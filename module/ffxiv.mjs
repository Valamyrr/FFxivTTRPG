// Import document classes.
import { FfxivActor } from './actors/actor.mjs';
import { FfxivItem } from './items/item.mjs';
// Import sheet classes.
import { FfxivActorSheet } from './actors/actor-sheet.mjs';
import { FfxivItemSheet } from './items/item-sheet.mjs';
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { FF_XIV } from './helpers/config.mjs';

import { SettingsHelpers } from "./helpers/settings.mjs";
import { updateStatusEffects } from "./helpers/status_effects.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */


Hooks.once('init', function () {
  console.log("FFXIV | Initilisation du Système")
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.ffxivttrpg = {
    FfxivActor,
    FfxivItem
  };

  // Add custom constants for configuration.
  CONFIG.FF_XIV = FF_XIV;

  // Define custom Document classes
  CONFIG.Actor.documentClass = FfxivActor;
  CONFIG.Item.documentClass = FfxivItem;

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register sheet application classes
  console.log("FFXIV | Enregistrement des feuilles")
  foundry.documents.collections.Actors.unregisterSheet('core', foundry.appv1.sheets.ActorSheet);
  foundry.documents.collections.Actors.registerSheet('ffxiv', FfxivActorSheet, {
    makeDefault: true,
    label: 'FFXIV.SheetLabels.Actor',
  });
  foundry.documents.collections.Items.unregisterSheet('core', foundry.appv1.sheets.ItemSheet);
  foundry.documents.collections.Items.registerSheet('ffxiv', FfxivItemSheet, {
    makeDefault: true,
    label: 'FFXIV.SheetLabels.Item',
  });

  SettingsHelpers.initSettings()


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
    augment: game.i18n.localize("FFXIV.ItemType.augment")
  };

  CONFIG.Actor.typeLabels = {
    character: game.i18n.localize("FFXIV.ActorType.character"),
    npc: game.i18n.localize("FFXIV.ActorType.npc"),
    pet: game.i18n.localize("FFXIV.ActorType.pet")
  };

  updateStatusEffects()

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
  return a + b;
});
Handlebars.registerHelper('sub', function(a, b) {
  return a - b;
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
Handlebars.registerHelper("characterTabs", function(settings){
  let items = [
    { tab: "abilities", label: game.i18n.localize("FFXIV.Abilities.Abilities"), icon: game.settings.get("ffxiv", "imgTabAbilities") },
    { tab: "attributes", label: game.i18n.localize("FFXIV.Attributes.Attributes"), icon: game.settings.get("ffxiv", "imgTabAttributes") },
    { tab: "roleplay", label: game.i18n.localize("FFXIV.CharacterSheet.Character"), icon: game.settings.get("ffxiv", "imgTabRoleplay") },
  ];
  if (settings.showGear) items.push({ tab: "gear", label: game.i18n.localize("FFXIV.CharacterSheet.Gear"), icon: game.settings.get("ffxiv", "imgTabGear") });
  items.push({ tab: "items", label: game.i18n.localize("FFXIV.CharacterSheet.Inventory"), icon: game.settings.get("ffxiv", "imgTabItems") })
  items.push({ tab: "companions", label: game.i18n.localize("FFXIV.CharacterSheet.Companions"), icon: game.settings.get("ffxiv", "imgTabCompanions") })
  items.push({ tab: "settings", label: game.i18n.localize("FFXIV.CharacterSheet.Config"), icon: game.settings.get("ffxiv", "imgTabSettings") })
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
  if(game.settings.get('ffxiv','useRarity')){
    const configCategory = FF_XIV[category]
    for (const key in configCategory) {
      if (configCategory[key].label === label) {
          return configCategory[key].value;
      }
    }
    console.error("FFXIV | cannot find label for "+label+" in "+category)
    return "label error"
  }else{
    return ""
  }

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
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => createItemMacro(data, slot));

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

});

/* -------------------------------------------- */
/*  Render Actor Sheet Hook                     */
/* -------------------------------------------- */

let isDraggingItem = false;
Hooks.on('renderActorSheet', async (app, html, data) => {
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
  const actor = app.actor;
  const isOwner = actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  if(!isOwner) return;

  html.find('.inventory-item').off('dragstart drop dragover');

  // Handle drag start
  html.find('.inventory-item').on('dragstart', event => {
    console.log('Drag started:', event.currentTarget.dataset.itemId);
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
    console.log('Drag over:', event.currentTarget.dataset.itemId || 'empty slot');
  });

  // Handle drop event (for both items and empty slots)
  html.find('.inventory-item').on('drop', async event => {
    event.preventDefault();
    console.log(event)

    const targetPosition = event.currentTarget.dataset.itemPosition;

    console.log('Dropped on:', targetPosition || 'empty slot');

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

    if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_moveItem')){
      foundry.audio.AudioHelper.play({
        src: game.settings.get('ffxiv', 'soundNotificationFFxiv_moveItem'),
        volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
        autoplay: true,
        loop: false
      });
    }

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
    if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_enterChat')){
      foundry.audio.AudioHelper.play({
        src: game.settings.get('ffxiv', 'soundNotificationFFxiv_enterChat'),
        volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
        autoplay: true,
        loop: false
      });
    }
  }
});

Hooks.on("renderActorSheet", (app, html, data) => {
  if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_openSheet')){
    foundry.audio.AudioHelper.play({
      src: game.settings.get('ffxiv', 'soundNotificationFFxiv_openSheet'),
      volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
      autoplay: true,
      loop: false
    });
  }
  const actorSheet = app.actor.sheet;
  html.on('click', '.abilities-sub-tabs .sub-tab', actorSheet._displayAbilityTab.bind(actorSheet))
  html.on('click', '.companions-sub-tabs .companions-sub-tab', actorSheet._displayCompanionTab.bind(actorSheet))

});

Hooks.on("closeActorSheet", (hookEvent, html) => {
  if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_closeSheet')){
    foundry.audio.AudioHelper.play({
      src: game.settings.get('ffxiv', 'soundNotificationFFxiv_closeSheet'),
      volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
      autoplay: true,
      loop: false
    });
  }
})

Hooks.on("renderChatLog", (app, html) => {
  let theme;
  if (game.settings.get("ffxiv","overrideColorScheme")){
    theme = "blue"
  }else{
    if (game.settings.get('core', 'uiConfig').colorScheme.applications){
      theme = game.settings.get('core', 'uiConfig').colorScheme.applications
    }else{
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  }
  $("section#chat.sidebar-tab").addClass("chat-ffxiv").addClass(theme+'_theme')
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!controls.tiles?.tools) return;

  controls.tiles.tools.ffxivMarker = {
    name: "ffxivMarker",
    title: game.i18n.localize("FFXIV.MarkerPlacement.Title"),
    icon: "fas fa-map-marker-alt",
    visible: game.user.isGM,
    button: true,
    onChange: async (event, active) => {
      if (!active) return;

      const ASSET_GRID_SIZE = 300;
      const gridSize = canvas.grid.size;

      if (!canvas.scene) {
        ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"));
        return;
      }

      ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToPlace"));

      const getClick = () =>
        new Promise((resolve) => {
          const handler = (event) => {
            canvas.stage.off("mousedown", handler);
            const pos = event.data.getLocalPosition(canvas.stage);
            const snappedX = Math.floor(pos.x / gridSize) * gridSize;
            const snappedY = Math.floor(pos.y / gridSize) * gridSize;
            resolve({ x: snappedX, y: snappedY });
          };
          canvas.stage.once("mousedown", handler);
        });

      const { x, y } = await getClick();

      const iconPackModule = game.modules.get("ffxiv-ttrpg-icons-pack");
      const defaultDirectory = iconPackModule?.active
        ? "modules/ffxiv-ttrpg-icons-pack/ffxiv/markers"
        : "";

      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;

      new FilePickerImpl({
        type: "image",
        current: defaultDirectory,
        callback: async (path) => {
          try {
            const tex = await foundry.canvas.loadTexture(path);
            const nativeWidth = tex.width;
            const nativeHeight = tex.height;

            const widthGrids = Math.round(nativeWidth / ASSET_GRID_SIZE);
            const heightGrids = Math.round(nativeHeight / ASSET_GRID_SIZE);
            const tileWidth = widthGrids * gridSize;
            const tileHeight = heightGrids * gridSize;

            new foundry.applications.api.DialogV2({
              window: { title: game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Title") },
              content: `
                <p>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Description")}</p>
                <form>
                  <label><input type="radio" name="marker" value="enemy" checked>
                    ${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Enemy")}
                  </label><br/>
                  <label><input type="radio" name="marker" value="ally">
                    ${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Ally")}
                  </label><br/>
                </form>
              `,
              buttons: [{
                action: "place",
                label: game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Button.Place"),
                icon: "fas fa-check",
                default: true,
                callback: (event, button) => button.form.elements.marker.value
              }],
              submit: async (role) => {
                const isAlly = role === "ally";
                const tintColor = isAlly ? "#00ccff" : null;

                const tileData = {
                  texture: { src: path, tint: tintColor },
                  x,
                  y,
                  width: tileWidth,
                  height: tileHeight,
                  z: 100,
                  rotation: 0,
                  hidden: false,
                  locked: false
                };

                const result = await canvas.scene.createEmbeddedDocuments("Tile", [tileData]);
                if (!result.length) throw new Error("No tile was created.");
              }
            }).render(true);

          } catch (err) {
            console.error("Tile creation failed:", err);
            ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.TileFailed"));
          }
        }
      }).render(true);
    }
  };
});


Hooks.on("ready", function(){
  const categories = [
    { configKey: "customAbilityTags", configTarget: "tags_abilities"},
    { configKey: "customTraitTags", configTarget: "tags_traits"},
    { configKey: "customConsumableTags", configTarget: "tags_consumables"}
  ];

  CONFIG.FF_XIV = CONFIG.FF_XIV || {};

  for (let { configKey, configTarget, labelPrefix } of categories) {
    CONFIG.FF_XIV[configTarget] = CONFIG.FF_XIV[configTarget] || {};

    const raw = game.settings.get("ffxiv", configKey);
    const tags = raw.split(",").map(t => t.trim()).filter(Boolean);

    for (let tag of tags) {
      const key = tag.replace(/\s+/g, "-");
      if (!CONFIG.FF_XIV[configTarget][key]) {
        CONFIG.FF_XIV[configTarget][key] = {
          value: key,
          label: key
        };
      }
    }
  }


  // Seulement si MJ
  if (game.user.isGM) {
    game.socket.on("system.ffxiv", async (params) => {
      console.log("get socket")
      const {type, data, userName } = params;
      switch (type) {
        case "applyEffect":

          const actors = data.actorIds.map(id => game.actors.get(id)).filter(Boolean);
          const effect = data.effect

          if (!actors || !effect) return;

          new foundry.applications.api.DialogV2({
            id: "gamemaster-socket-apply-effect",
            window: {title: game.i18n.localize("FFXIV.Notifications.StatusChangeRequest")},
            content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest",{playerName:userName, effect: game.i18n.localize(effect.label)})}</p>
                <ul>${actors.map(a => `<li>${a.name}</li>`).join("")}</ul>`,
            buttons: [
              {
                label: game.i18n.localize("FFXIV.Sockets.Accept"),
                action: "accept",
                type: "submit",
                callback: (event, button) => {
                  for (const actor of actors) {
                    actor.toggleStatusEffect(effect.id, {active: data.active});
                    ui.notifications.info(game.i18n.format("FFXIV.Notifications.EffectApplied", {effect: game.i18n.localize(effect.label), actor: actor.name }));
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

      }
    });
  }

})

Hooks.on("renderChatMessageHTML", (message, html, data) => {
  const jqueryhtml = $(html)
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
    console.log("call show modifiers")
    const itemId = ev.currentTarget.dataset.itemId;
    console.log(itemId)
    const actor = game.actors.get(ev.currentTarget.dataset.actorId);
    console.log(actor)
    if (actor) actor._showModifiers(ev);
  });

  jqueryhtml.find(".ffxiv-apply-status").on("click", async ev => {
    const status_effect = CONFIG.statusEffects.find(e => e.id === ev.currentTarget.dataset.effectId);
    const targets = Array.from(game.user.targets);

    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }

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
      await actor.toggleStatusEffect(status_effect.id, { active: true });
      ui.notifications.info(game.i18n.format("FFXIV.Notifications.EffectApplied", {effect: game.i18n.localize(status_effect.label), actor: actor.name }));
    }

    if (actorsNeedingGM.length > 0) {
      console.log("Send socket to GM","applyEffect",status_effect)
      game.socket.emit("system.ffxiv", {
        type: "applyEffect",
        data: {
          actorIds: actorsNeedingGM.map(a => a.id),
          effect: status_effect,
          active: ev.currentTarget.dataset.action === 'true'
        },
        userName: game.user.name
      });
      ui.notifications.info(game.i18n.localize("FFXIV.Notifications.SendSocket"))
    }

  });

});
