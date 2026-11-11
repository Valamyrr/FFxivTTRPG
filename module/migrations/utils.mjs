export const SHOP_TIER_TYPES = new Set(["consumable", "gear", "augment", "minion"]);
export const ACTION_FORMULA_TYPES = new Set([
  "ability",
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
  "augment",
  "minion",
]);
export const HP_COST_MIGRATION_TYPES = new Set([
  "ability",
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
  "consumable",
  "augment",
  "minion",
]);

export function getStrippedAbilityGrantItemData(abilityGrants) {
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

export function normalizeHpCostValue(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
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

export function _migrateActionFormulaFields(itemSystem) {
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

export function getMigratableActorCompendiumPacks() {
  return game.packs.filter(
    (pack) => pack.documentName === "Actor" && !pack.locked,
  );
}

export function getMigratableItemCompendiumPacks() {
  return game.packs.filter(
    (pack) => pack.documentName === "Item" && !pack.locked,
  );
}

export function getItemCompendiumPacks() {
  return game.packs.filter((pack) => pack.documentName === "Item");
}

export function getActorCompendiumPacks() {
  return game.packs.filter((pack) => pack.documentName === "Actor");
}

export async function withCompendiumUnlocked(pack, operation) {
  const wasLocked = Boolean(pack.locked);
  if (wasLocked) await pack.configure({ locked: false });
  try {
    return await operation();
  } finally {
    if (wasLocked) await pack.configure({ locked: true });
  }
}
