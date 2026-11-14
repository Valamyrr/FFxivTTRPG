import { normalizeShopTier } from "../helpers/shop-tier.mjs";
import {
  ABILITY_SUBTYPE_TYPES,
  getAbilitySubtype,
  ensureAbilitySubtypeTags,
} from "../helpers/ability-subtype.mjs";
import {
  SHOP_TIER_TYPES,
  ACTION_FORMULA_TYPES,
  HP_COST_MIGRATION_TYPES,
  getStrippedAbilityGrantItemData,
  normalizeHpCostValue,
  _migrateActionFormulaFields,
  getMigratableItemCompendiumPacks,
  getActorCompendiumPacks,
  withCompendiumUnlocked,
} from "./utils.mjs";

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

export async function migrateAbilityItemTypes({ onProgress = null } = {}) {
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
