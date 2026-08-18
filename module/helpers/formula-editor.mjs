export function registerFormulaEditorContexts() {
  const localize = (key) => game.i18n.localize(key);
  const target = localize("FFXIV.Abilities.Target");
  const maximum = localize("FFXIV.Maximum");
  const attributes = {
    str: localize("FFXIV.Attributes.Strength.long"),
    dex: localize("FFXIV.Attributes.Dexterity.long"),
    vit: localize("FFXIV.Attributes.Vitality.long"),
    int: localize("FFXIV.Attributes.Intelligence.long"),
    mnd: localize("FFXIV.Attributes.Mind.long"),
    def: localize("FFXIV.Attributes.Defense"),
    mdef: localize("FFXIV.Attributes.MagicDefense"),
    vigilance: localize("FFXIV.Attributes.Vigilance"),
    speed: localize("FFXIV.Attributes.Speed"),
    dmg: localize("FFXIV.Damages"),
    cdmg: localize("FFXIV.CriticalDamage"),
    hit: localize("FFXIV.BonusToHit"),
  };
  const resources = {
    health: localize("FFXIV.Health.long"),
    barrier: localize("FFXIV.Health.barrier"),
    mana: localize("FFXIV.Mana.long"),
  };
  const labels = {};

  for (const [path, label] of Object.entries(attributes)) {
    labels[path] = label;
    labels[`target.${path}`] = `${target}: ${label}`;
  }
  for (const [path, label] of Object.entries(resources)) {
    labels[`${path}.value`] = label;
    labels[`${path}.max`] = `${label}: ${maximum}`;
    labels[`target.${path}.value`] = `${target}: ${label}`;
    labels[`target.${path}.max`] = `${target}: ${label}: ${maximum}`;
  }

  CONFIG.formulaEditor.contexts["ffxiv-ability"] = { labels };
}
