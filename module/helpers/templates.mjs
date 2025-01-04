/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  return loadTemplates([
    // Actor partials.
    'systems/ffxiv/templates/actor/parts/actor-items.hbs',
    'systems/ffxiv/templates/actor/parts/actor-settings.hbs',
    'systems/ffxiv/templates/actor/parts/actor-sidebar.hbs',
    'systems/ffxiv/templates/actor/parts/actor-abilities.hbs',
    'systems/ffxiv/templates/actor/parts/actor-attributes.hbs',
    'systems/ffxiv/templates/actor/parts/tabs.hbs',
    // Item partials
    'systems/ffxiv/templates/item/parts/box.hbs',
    // Item user-side
    'systems/ffxiv/templates/item/item-sheet-dialog.hbs',
  ]);
};
