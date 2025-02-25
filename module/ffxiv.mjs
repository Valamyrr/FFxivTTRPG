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
import { LEVELS } from './helpers/levels.mjs';

import { register_controls } from "./helpers/controls.js";
/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */
console.log("FFXIV | Initilisation du Système")

Hooks.once('init', function () {
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
  Actors.unregisterSheet('core', ActorSheet);
  Actors.registerSheet('ffxiv', FfxivActorSheet, {
    makeDefault: true,
    label: 'FF_XIV.SheetLabels.Actor',
  });
  Items.unregisterSheet('core', ItemSheet);
  Items.registerSheet('ffxiv', FfxivItemSheet, {
    makeDefault: true,
    label: 'FF_XIV.SheetLabels.Item',
  });

  SettingsHelpers.initSettings()

  if(game.settings.get('ffxiv', 'toggleExperience')){
    CONFIG.LEVELS = LEVELS;
  }

  CONFIG.Item.typeLabels = {
    consumable: game.i18n.localize("FFXIV.ItemType.consumable"),
    limit_break: game.i18n.localize("FFXIV.ItemType.limit_break"),
    primary_ability: game.i18n.localize("FFXIV.ItemType.primary_ability"),
    secondary_ability: game.i18n.localize("FFXIV.ItemType.secondary_ability"),
    instant_ability: game.i18n.localize("FFXIV.ItemType.instant_ability"),
    trait: game.i18n.localize("FFXIV.ItemType.trait"),
    currency: game.i18n.localize("FFXIV.ItemType.currency"),
    title: game.i18n.localize("FFXIV.ItemType.title"),
    gear: game.i18n.localize("FFXIV.ItemType.gear")
  };

  CONFIG.Actor.typeLabels = {
    character: game.i18n.localize("FFXIV.ActorType.character"),
    npc: game.i18n.localize("FFXIV.ActorType.npc"),
  };

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
Handlebars.registerHelper("array", function () {
  return Array.from(arguments).slice(0, arguments.length - 1);
});
Handlebars.registerHelper("characterTabs", function(settings){
  let items = [
    { tab: "abilities", label: game.i18n.localize("FFXIV.Abilities.Abilities"), icon: "fight" },
    { tab: "roleplay", label: game.i18n.localize("FFXIV.Attributes.Attributes"), icon: "character" },
  ];
  if (settings.showGear) items.push({ tab: "gear", label: game.i18n.localize("FFXIV.CharacterSheet.Gear"), icon: "gear" });
  items.push({ tab: "items", label: game.i18n.localize("FFXIV.CharacterSheet.Inventory"), icon: "inventory" })
  items.push({ tab: "settings", label: game.i18n.localize("FFXIV.CharacterSheet.Config"), icon: "configuration" })
  return items;
})
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
  const configCategory = FF_XIV[category]
  for (const key in configCategory) {
    if (configCategory[key].label === label) {
        return configCategory[key].value;
    }
  }
  console.error("FFXIV | cannot find label for "+label+" in "+category)
  return "label error"
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




/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once('ready', function () {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => createItemMacro(data, slot));

  // Color Scheme to use with css variables
  if (game.settings.get("core", "colorScheme") == "") {
    CONFIG.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }else{
    CONFIG.theme = game.settings.get("core", "colorScheme")
  }
});

/* -------------------------------------------- */
/*  Render Actor Sheet Hook                     */
/* -------------------------------------------- */

Hooks.on('renderActorSheet', async (app, html, data) => {
  const actor = app.actor;
  const items = actor.items.contents;

  // Step 1: Get all current positions and identify invalid ones
  const occupiedPositions = new Set();
  const itemsToUpdate = [];

  // Iterate through the items and check for duplicates or invalid positions
  items.forEach(item => {
    if (FF_XIV.inventory_items.indexOf(item.type) > -1){
        const position = item.system.position.toString() || 0;
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
      while (occupiedPositions.has(nextFreePosition.toString())) {
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

  html.find('.inventory-item').off('dragstart drop dragover');

  // Handle drag start
  html.find('.inventory-item').on('dragstart', event => {
    console.log('Drag started:', event.currentTarget.dataset.itemId);
    draggedItem = {
      id: event.currentTarget.dataset.itemId,
      position: event.currentTarget.dataset.itemPosition
    };
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

    event.originalEvent.dataTransfer.setData('text/plain', draggedItem.id);
  });



  // Handle drag over (for both items and empty slots)
  html.find('.inventory-item').on('dragover', event => {
    event.preventDefault(); // Allow the drop by preventing default
    console.log('Drag over:', event.currentTarget.dataset.itemId || 'empty slot');
  });

  // Handle drop event (for both items and empty slots)
  html.find('.inventory-item').on('drop', async event => {
    event.preventDefault();

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

    if(game.settings.get('ffxiv', 'soundNotificationFFxiv')){
      foundry.audio.AudioHelper.play({
          src: "systems/ffxiv/assets/sounds/move_inventory.wav", // Ensure this path is valid
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
      limit_break: "systems/ffxiv/assets/default_img/limit_break.png",
      title: "systems/ffxiv/assets/default_img/default-title.png",
      trait: "systems/ffxiv/assets/default_img/default-trait.png"
    };
    const defaultImg = defaultImages[itemData.type] || "icons/svg/item-bag.svg";
    itemData.updateSource({ img: defaultImg });
  }
});

Hooks.on("userConnected", (player, login, data) => {
  if(login && !game.paused){ //If the game is paused or the player logouts, do not play anything
    ui.notifications.info(game.i18n.format("FFXIV.Notifications.NewPlayer", {playerName: player.name}));
    if(game.settings.get('ffxiv', 'soundNotificationFFxiv')){
      foundry.audio.AudioHelper.play({
          src: "systems/ffxiv/assets/sounds/enter_chat.wav", // Ensure this path is valid
          volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
          autoplay: true,
          loop: false
      });
    }
  }
});

Hooks.on("renderActorSheet", (hookEvent, actorData, sheetData) => {
  if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && !hookEvent.actor._sheetOpened){
    foundry.audio.AudioHelper.play({
        src: "systems/ffxiv/assets/sounds/sheet_open.wav", // Ensure this path is valid
        volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
        autoplay: true,
        loop: false
    });
    hookEvent.actor._sheetOpened = true;
  }
});

Hooks.on("closeActorSheet", (hookEvent, html) => {
  if(game.settings.get('ffxiv', 'soundNotificationFFxiv')){
    foundry.audio.AudioHelper.play({
        src: "systems/ffxiv/assets/sounds/sheet_close.wav", // Ensure this path is valid
        volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
        autoplay: true,
        loop: false
    });
    hookEvent.actor._sheetOpened = false;
  }
})

Hooks.on("renderChatLog", (app, html) => {
  let theme = game.settings.get("core", "colorScheme")
  if (theme == "") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  $("section#chat.sidebar-tab").addClass("chat-ffxiv").addClass(theme+'_theme')
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) {
      return;
  }
  register_controls(controls);
});
