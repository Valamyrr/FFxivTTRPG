import { debugLog } from "../helpers/debug.mjs";
import { normalizeShopTier } from "../helpers/shop-tier.mjs";
import { canonicalizeBakedTags, normalizeComboName } from "../helpers/ability-subtype.mjs";
import {
  migrateLegacyPetTraits,
  refreshSceneActorStatusEffectsForLegacyIcons,
} from "./legacy-data.mjs";
import {
  SHOP_TIER_TYPES,
  ACTION_FORMULA_TYPES,
  HP_COST_MIGRATION_TYPES,
  normalizeHpCostValue,
  _migrateActionFormulaFields,
  getMigratableItemCompendiumPacks,
  getItemCompendiumPacks,
  getActorCompendiumPacks,
  withCompendiumUnlocked,
} from "./utils.mjs";
import { migrateAbilityItemTypes } from "./item-types.mjs";

const COMBO_MIGRATION_TYPES = new Set([
  "ability",
  "primary_ability",
  "secondary_ability",
  "instant_ability",
]);
const LEGACY_COMBO_MIGRATION_FLAGS = [
  "flags.ffxiv.comboFromMigration20",
  "flags.ffxiv.comboFromMigration22",
];
const COMBO_MIGRATION_FLAG = "flags.ffxiv.comboFromMigration22";
const ITEM_LEVEL_TYPES = new Set(["consumable", "gear", "augment", "job"]);
const ITEM_DATA_MIGRATION_VERSION = "23";

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

function getRemovedItemLevelGrantPatch(abilityGrants) {
  const entries = Array.isArray(abilityGrants)
    ? abilityGrants
    : abilityGrants && typeof abilityGrants === "object"
      ? Object.values(abilityGrants)
      : [];
  if (!entries.length) return null;

  let changed = false;
  const nextGrants = entries.map((grant) => {
    const item = grant?.item;
    if (
      !item?.system ||
      ITEM_LEVEL_TYPES.has(item.type) ||
      !Object.hasOwn(item.system, "level")
    )
      return grant;

    changed = true;
    const nextItem = {
      ...item,
      system: { ...item.system },
    };
    delete nextItem.system.level;
    return {
      ...grant,
      item: nextItem,
    };
  });

  return changed ? nextGrants : null;
}

function getRemovedItemLevelPatch(itemLike) {
  const updates = {};
  if (
    itemLike?.system &&
    !ITEM_LEVEL_TYPES.has(itemLike.type) &&
    Object.hasOwn(itemLike.system, "level")
  ) {
    updates["system.-=level"] = null;
  }

  const nextGrants = getRemovedItemLevelGrantPatch(
    itemLike?.system?.ability_grants,
  );
  if (nextGrants) updates["system.ability_grants"] = nextGrants;

  return Object.keys(updates).length ? updates : null;
}

function migrateRemovedItemLevelSource(itemSource) {
  const patch = getRemovedItemLevelPatch(itemSource);
  if (!patch) return { item: itemSource, changed: false };

  const nextItem = foundry.utils.deepClone(itemSource);
  for (const [path, value] of Object.entries(patch)) {
    if (path === "system.-=level") {
      if (nextItem.system && typeof nextItem.system === "object") {
        delete nextItem.system.level;
      }
      continue;
    }
    foundry.utils.setProperty(nextItem, path, value);
  }

  return { item: nextItem, changed: true };
}

async function migrateRemovedItemLevelFields() {
  const worldUpdates = [];
  let updatedActorItems = 0;
  let updatedCompendiumItems = 0;
  let updatedActorCompendiumItems = 0;

  for (const item of game.items) {
    const patch = getRemovedItemLevelPatch(item.toObject(false));
    if (!patch) continue;
    worldUpdates.push({ _id: item.id, ...patch });
  }

  if (worldUpdates.length) {
    await Item.updateDocuments(worldUpdates, { render: false });
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      const patch = getRemovedItemLevelPatch(item.toObject(false));
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
      const patch = getRemovedItemLevelPatch(item.toObject(false));
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
        const migrated = migrateRemovedItemLevelSource(itemSource);
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

export async function migrateItemDataStructure({ force = false } = {}) {
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

    if (migrationVersion <= 21) {
      reportPhase("FFXIV.Notifications.ItemMigrationPhaseComboStart");
      showMigrationProgress(
        99,
        "FFXIV.Notifications.ItemMigrationPhaseComboStart",
      );
      const comboStats = await migrateLegacyComboFields();
      reportPhase("FFXIV.Notifications.ItemMigrationPhaseComboDone", comboStats);
      showMigrationProgress(
        99,
        "FFXIV.Notifications.ItemMigrationPhaseComboDone",
        comboStats,
      );
    }

    if (migrationVersion <= 22) {
      reportPhase("FFXIV.Notifications.ItemMigrationPhaseLevelFieldStart");
      showMigrationProgress(
        99,
        "FFXIV.Notifications.ItemMigrationPhaseLevelFieldStart",
      );
      const levelFieldStats = await migrateRemovedItemLevelFields();
      reportPhase(
        "FFXIV.Notifications.ItemMigrationPhaseLevelFieldDone",
        levelFieldStats,
      );
      showMigrationProgress(
        99,
        "FFXIV.Notifications.ItemMigrationPhaseLevelFieldDone",
        levelFieldStats,
      );
    }

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

function splitLegacyComboTargets(combo) {
  return String(combo ?? "")
    .split(/\s+or\s+/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

function hasLegacyComboMigrationFlag(item) {
  return LEGACY_COMBO_MIGRATION_FLAGS.some((flag) =>
    foundry.utils.getProperty(item, flag),
  );
}

function addLegacyComboLinksFromItems(items, comboLinks) {
  const entries = Array.from(items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => COMBO_MIGRATION_TYPES.has(item?.type));
  const byName = new Map();
  for (const entry of entries) {
    const name = normalizeComboName(entry.item.name);
    if (name && !byName.has(name)) byName.set(name, entry);
  }

  for (const sourceEntry of entries) {
    const source = sourceEntry.item;
    if (hasLegacyComboMigrationFlag(source)) continue;
    const targets = splitLegacyComboTargets(source.system?.combo);
    if (!targets.length) continue;
    const targetEntries = targets
      .map((name) => byName.get(normalizeComboName(name)))
      .filter(Boolean);
    if (targetEntries.length !== targets.length) continue;
    if (
      targetEntries.some((targetEntry) => targetEntry.index <= sourceEntry.index)
    )
      continue;
    const sourceName = String(source.name ?? "").trim();
    if (!sourceName) continue;
    const sourceKey = normalizeComboName(sourceName);
    if (!comboLinks.has(sourceKey)) {
      comboLinks.set(sourceKey, { sourceName, targets: new Set() });
    }
    const entry = comboLinks.get(sourceKey);
    for (const target of targets) entry.targets.add(target);
  }
}

function addLegacyComboLinksFromGrantItems(itemLike, comboLinks) {
  if (!["job", "augment"].includes(itemLike?.type)) return;
  const rawGrants = Array.isArray(itemLike.system?.ability_grants)
    ? itemLike.system.ability_grants
    : Object.values(itemLike.system?.ability_grants || {});
  const grantItems = rawGrants
    .map((grant) => grant?.item)
    .filter((item) => item && typeof item === "object");
  addLegacyComboLinksFromItems(grantItems, comboLinks);
}

function getItemSourceId(item, index = null) {
  return item.id ?? item._id ?? (index === null ? null : `__combo_${index}`);
}

function getLegacyComboMigrationUpdates(items, comboLinks = null) {
  const entries = Array.from(items ?? [])
    .map((item, index) => ({ item, id: getItemSourceId(item, index), index }))
    .filter(({ item }) => COMBO_MIGRATION_TYPES.has(item?.type));
  const byName = new Map();
  for (const entry of entries) {
    const { item } = entry;
    const name = normalizeComboName(item.name);
    if (name && !byName.has(name)) byName.set(name, entry);
  }

  const updatesById = new Map();
  const ensureUpdate = (item) => {
    const entry = entries.find(({ item: entryItem }) => entryItem === item);
    const id = entry?.id;
    if (!id) return null;
    if (!updatesById.has(id)) updatesById.set(id, { _id: id });
    return updatesById.get(id);
  };

  for (const sourceEntry of entries) {
    const { item: source, id: sourceId, index: sourceIndex } = sourceEntry;
    if (hasLegacyComboMigrationFlag(source)) continue;
    if (comboLinks && !comboLinks.has(normalizeComboName(source.name))) continue;
    const combo = String(source.system?.combo ?? "").trim();
    if (!combo) continue;

    const targetNames = splitLegacyComboTargets(combo);
    const targetEntries = targetNames
      .map((name) => byName.get(normalizeComboName(name)))
      .filter((target) => {
        if (!target) return false;
        return target.id !== sourceId && target.index > sourceIndex;
      });
    if (targetEntries.length !== targetNames.length) continue;
    const targets = targetEntries.map(({ item }) => item);

    const sourceUpdate = ensureUpdate(source);
    if (sourceUpdate) {
      sourceUpdate["system.combo"] = "";
      sourceUpdate[COMBO_MIGRATION_FLAG] = true;
    }
    for (const target of targets) {
      const targetUpdate = ensureUpdate(target);
      if (targetUpdate) {
        targetUpdate["system.combo"] = source.name;
        targetUpdate[COMBO_MIGRATION_FLAG] = true;
      }
    }
  }

  if (comboLinks) {
    for (const { sourceName, targets } of comboLinks.values()) {
      for (const targetName of targets) {
        const target = byName.get(normalizeComboName(targetName));
        if (!target) continue;
        const targetUpdate = ensureUpdate(target.item);
        if (!targetUpdate) continue;
        targetUpdate["system.combo"] = sourceName;
        targetUpdate[COMBO_MIGRATION_FLAG] = true;
      }
    }
  }

  return Array.from(updatesById.values()).filter((update) =>
    Object.keys(update).some((key) => key !== "_id"),
  );
}

function migrateLegacyComboItemSources(itemSources, comboLinks = null) {
  const items = Array.isArray(itemSources)
    ? foundry.utils.deepClone(itemSources)
    : [];
  const updates = getLegacyComboMigrationUpdates(items, comboLinks);
  if (!updates.length) return { items, changed: 0 };

  const updatesById = new Map(updates.map((update) => [update._id, update]));
  let changed = 0;
  for (const [index, item] of items.entries()) {
    const update = updatesById.get(getItemSourceId(item, index));
    if (!update) continue;
    for (const [path, value] of Object.entries(update)) {
      if (path === "_id") continue;
      foundry.utils.setProperty(item, path, value);
    }
    changed += 1;
  }

  return { items, changed };
}

function getLegacyComboGrantPatch(itemLike, comboLinks = null) {
  if (!["job", "augment"].includes(itemLike?.type)) return null;
  const rawGrants = Array.isArray(itemLike.system?.ability_grants)
    ? itemLike.system.ability_grants
    : Object.values(itemLike.system?.ability_grants || {});
  if (!rawGrants.length) return null;

  const nextGrants = foundry.utils.deepClone(rawGrants);
  const grantItems = nextGrants
    .map((grant) => grant?.item)
    .filter((item) => item && typeof item === "object");
  const migrated = migrateLegacyComboItemSources(grantItems, comboLinks);
  if (!migrated.changed) return null;

  let itemIndex = 0;
  for (const grant of nextGrants) {
    if (!grant?.item || typeof grant.item !== "object") continue;
    grant.item = migrated.items[itemIndex];
    itemIndex += 1;
  }

  return { "system.ability_grants": nextGrants };
}

async function collectLegacyComboLinks() {
  const comboLinks = new Map();
  addLegacyComboLinksFromItems(game.items, comboLinks);
  for (const item of game.items) addLegacyComboLinksFromGrantItems(item, comboLinks);

  return comboLinks;
}

async function migrateLegacyComboFields() {
  let updatedWorldItems = 0;
  const comboLinks = await collectLegacyComboLinks();

  const worldUpdates = getLegacyComboMigrationUpdates(game.items, comboLinks);
  for (const item of game.items) {
    const patch = getLegacyComboGrantPatch(item, comboLinks);
    if (!patch) continue;
    worldUpdates.push({ _id: item.id, ...patch });
  }
  if (worldUpdates.length) {
    await Item.updateDocuments(worldUpdates, { render: false });
    updatedWorldItems = worldUpdates.length;
  }

  return {
    updatedWorldItems,
  };
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
