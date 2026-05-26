export const SHOP_TIER_VALUES = Object.freeze({
  LOW: "1",
  AVERAGE: "2",
  HIGH: "3",
  SPECIAL: "99",
  CUSTOM: "custom"
});

const CANONICAL_TIERS = Object.freeze({
  [SHOP_TIER_VALUES.LOW]: "FFXIV.ShopTier.Low",
  [SHOP_TIER_VALUES.AVERAGE]: "FFXIV.ShopTier.Average",
  [SHOP_TIER_VALUES.HIGH]: "FFXIV.ShopTier.High",
  [SHOP_TIER_VALUES.SPECIAL]: "FFXIV.ShopTier.Special"
});

const NORMALIZED_TEXT_MAP = Object.freeze({
  low: SHOP_TIER_VALUES.LOW,
  average: SHOP_TIER_VALUES.AVERAGE,
  high: SHOP_TIER_VALUES.HIGH,
  special: SHOP_TIER_VALUES.SPECIAL
});

function normalizeLooseText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function parseNumericTier(value) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric)) return "";
  if (numeric === 1) return SHOP_TIER_VALUES.LOW;
  if (numeric === 2) return SHOP_TIER_VALUES.AVERAGE;
  if (numeric === 3) return SHOP_TIER_VALUES.HIGH;
  if (numeric === 99) return SHOP_TIER_VALUES.SPECIAL;
  return "";
}

export function normalizeShopTier(shopTierRaw, customRaw = "") {
  const sourceTier = shopTierRaw ?? "";
  const sourceCustom = String(customRaw ?? "").trim();
  const trimmedTier = String(sourceTier).trim();

  if (!trimmedTier && !sourceCustom) return { shop_tier: "", shop_tier_custom: "" };

  if (trimmedTier === SHOP_TIER_VALUES.CUSTOM) {
    return {
      shop_tier: SHOP_TIER_VALUES.CUSTOM,
      shop_tier_custom: sourceCustom
    };
  }

  if (Object.hasOwn(CANONICAL_TIERS, trimmedTier)) {
    return { shop_tier: trimmedTier, shop_tier_custom: "" };
  }

  const numericTier = parseNumericTier(trimmedTier);
  if (numericTier) return { shop_tier: numericTier, shop_tier_custom: "" };

  const normalizedText = normalizeLooseText(trimmedTier);
  if (normalizedText.includes("special")) return { shop_tier: SHOP_TIER_VALUES.SPECIAL, shop_tier_custom: "" };
  if (normalizedText.includes("average")) return { shop_tier: SHOP_TIER_VALUES.AVERAGE, shop_tier_custom: "" };
  if (normalizedText.includes("high")) return { shop_tier: SHOP_TIER_VALUES.HIGH, shop_tier_custom: "" };
  if (normalizedText.includes("low")) return { shop_tier: SHOP_TIER_VALUES.LOW, shop_tier_custom: "" };

  const embeddedNumber = normalizedText.match(/\d+/)?.[0];
  const embeddedNumericTier = embeddedNumber ? parseNumericTier(embeddedNumber) : "";
  if (embeddedNumericTier) return { shop_tier: embeddedNumericTier, shop_tier_custom: "" };

  const mappedTextTier = NORMALIZED_TEXT_MAP[normalizedText];
  if (mappedTextTier) return { shop_tier: mappedTextTier, shop_tier_custom: "" };

  const fallbackCustom = sourceCustom || trimmedTier;
  return {
    shop_tier: SHOP_TIER_VALUES.CUSTOM,
    shop_tier_custom: fallbackCustom
  };
}

export function formatShopTierDisplay(shopTierRaw, customRaw = "", i18n = null) {
  const normalized = normalizeShopTier(shopTierRaw, customRaw);
  if (!normalized.shop_tier) return "";

  if (normalized.shop_tier === SHOP_TIER_VALUES.CUSTOM) return normalized.shop_tier_custom || "";

  const labelKey = CANONICAL_TIERS[normalized.shop_tier];
  if (!labelKey) return "";
  return i18n?.localize ? i18n.localize(labelKey) : labelKey;
}

export function getShopTierChoices() {
  return {
    [SHOP_TIER_VALUES.LOW]: { value: SHOP_TIER_VALUES.LOW, label: "FFXIV.ShopTier.Low" },
    [SHOP_TIER_VALUES.AVERAGE]: { value: SHOP_TIER_VALUES.AVERAGE, label: "FFXIV.ShopTier.Average" },
    [SHOP_TIER_VALUES.HIGH]: { value: SHOP_TIER_VALUES.HIGH, label: "FFXIV.ShopTier.High" },
    [SHOP_TIER_VALUES.SPECIAL]: { value: SHOP_TIER_VALUES.SPECIAL, label: "FFXIV.ShopTier.Special" },
    [SHOP_TIER_VALUES.CUSTOM]: { value: SHOP_TIER_VALUES.CUSTOM, label: "FFXIV.ShopTier.Custom" }
  };
}
