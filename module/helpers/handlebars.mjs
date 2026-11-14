import { FFXIV } from "./config.mjs";
import { formatShopTierDisplay } from "./shop-tier.mjs";
import {
  getAbilitySubtype,
  localizeTag,
  normalizeActionTag,
  normalizeComboName,
  normalizeTagValue,
} from "./ability-subtype.mjs";

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

function isBakedActionTag(tag) {
  return [tag, localizeTag(tag)].some((value) =>
    BAKED_ACTION_TAGS.has(normalizeActionTag(value)),
  );
}

function normalizeComboStep(step) {
  return String(step ?? "")
    .trim()
    .replace(/^\((.*)\)$/u, "$1")
    .trim();
}

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
    if (normalized && normalized !== "null" && normalized !== "undefined")
      return normalized;
  }
  return DEFAULT_TAB_ICONS[settingKey];
}

export function registerHandlebarsHelpers() {
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
    return text.length > 0 && text !== "-";
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

  Handlebars.registerHelper("actionTags", function (type, tags) {
    const effectiveType =
      type === "ability" ? getAbilitySubtype({ type, system: { tags } }) : type;
    const bakedTag = BAKED_ACTION_TAG_LABELS[effectiveType];
    const customTags = Array.isArray(tags)
      ? tags.filter((tag) => !isBakedActionTag(tag))
      : [];
    return bakedTag ? [bakedTag, ...customTags] : customTags;
  });

  Handlebars.registerHelper("comboChain", function (combo, currentName) {
    const source = normalizeComboStep(combo);
    const steps = source ? [source] : [];
    const current = normalizeComboStep(currentName);
    if (
      current &&
      !steps.some((step) => normalizeComboName(step) === normalizeComboName(current))
    ) {
      steps.push(current);
    }

    return steps.map((name) => ({
      name,
      current: current && normalizeComboName(name) === normalizeComboName(current),
    }));
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
}
