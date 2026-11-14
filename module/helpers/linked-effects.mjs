import { getTurnsUntilActorTurnEnd } from "./effect-utils.mjs";
import { FFXIVItem } from "../items/item.mjs";
import {
  COMATOSE_ALLOWED_STATUS_IDS,
  KNOCKED_OUT_ALLOWED_STATUS_IDS,
  applyStatusEffectChange,
  applyStatusEffectStackDelta,
  applyStatusEffectStackValue,
  hasStatus,
  isEliteFoeBlockedStatus,
  isNegativeStatusEffect,
  isAdditiveStackableStatusEffect,
  isStackableStatusEffect,
  markPetrifiedAppliedThisTurn,
  removeEnmityInflictedByActor,
} from "./status-effects.mjs";
import { clearActorJobResources } from "./job-resources.mjs";

function normalizeStatusEntryStacks(entry) {
  const parsed = Number.parseInt(entry?.stacks, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeStatusEntryApplyTo(entry) {
  return String(entry?.applyTo ?? "").trim().toLowerCase() === "self"
    ? "self"
    : "target";
}

export function normalizeStatusEntry(entry, fallbackSourceUuid = null) {
  return {
    statusId: String(
      entry?.statusId ?? entry?.id ?? entry?.effect?.id ?? "",
    ).trim(),
    active: entry?.active !== undefined
      ? entry.active !== false
      : entry?.action !== false,
    applyMode: entry?.applyMode === "auto" ? "auto" : "manual",
    applyTo: normalizeStatusEntryApplyTo(entry),
    stacks: normalizeStatusEntryStacks(entry),
    allSources: entry?.allSources === true,
    duration: entry?.duration ?? null,
    sourceUuid:
      String(entry?.sourceUuid ?? fallbackSourceUuid ?? "").trim() || null,
  };
}

export async function applyStatusEntryToActor(actor, entry) {
  const statusId = String(entry?.statusId ?? entry?.effect?.id ?? "").trim();
  if (!actor || !statusId) return;
  const stacks = normalizeStatusEntryStacks(entry);
  const isActive = entry.active !== false;
  const origin = String(entry?.sourceUuid ?? "").trim() || null;
  const duration = entry?.duration ?? null;

  if (!isActive && entry?.allSources === true) {
    return (await deleteActorStatuses(actor, [statusId])) > 0;
  }

  if (isStackableStatusEffect(statusId)) {
    let result;
    if (isAdditiveStackableStatusEffect(statusId)) {
      const delta = isActive ? stacks : -stacks;
      result = await applyStatusEffectStackDelta(actor, statusId, delta, { origin, duration });
    } else {
      result = await applyStatusEffectStackValue(actor, statusId, isActive ? stacks : 0, {
        origin,
        duration,
      });
    }
    return result !== false;
  }
  const result = await applyStatusEffectChange(actor, statusId, isActive, { origin, duration });
  return result !== false;
}

export function getStatusLabelById(statusId) {
  const effect = CONFIG.statusEffects?.find((entry) => entry.id === statusId);
  if (!effect) return statusId;
  return game.i18n.localize(effect.label ?? effect.name ?? statusId);
}

export function getStatusEntryNotificationKey(entry) {
  return entry?.active === false
    ? "FFXIV.Notifications.EffectRemoved"
    : "FFXIV.Notifications.EffectApplied";
}

export async function applyLinkedEffectsToActor(actor, effectDocs) {
  if (!actor || !Array.isArray(effectDocs) || !effectDocs.length) return;
  let normalizedEffectDocs = effectDocs.map((doc) =>
    prepareLinkedActiveEffectDuration(actor, foundry.utils.deepClone(doc)),
  );
  normalizedEffectDocs = await prepareLinkedActiveEffectStatusRules(
    actor,
    normalizedEffectDocs,
  );
  if (!normalizedEffectDocs.length) return 0;

  const replacementSources = normalizedEffectDocs
    .filter((doc) => !isLinkedEffectDocAdditiveStackable(doc))
    .map((doc) => {
      const sourceEffectId = String(foundry.utils.getProperty(doc, "flags.ffxiv.linkedSourceEffectId") ?? "").trim();
      if (!sourceEffectId) return null;
      const sourceItemUuid = String(foundry.utils.getProperty(doc, "flags.ffxiv.linkedSourceItemUuid") ?? doc.origin ?? "").trim();
      const sourceItemId = String(foundry.utils.getProperty(doc, "flags.ffxiv.linkedSourceItemId") ?? getItemIdFromUuid(sourceItemUuid)).trim();
      return { sourceEffectId, sourceItemUuid, sourceItemId };
    })
    .filter(Boolean);

  if (replacementSources.length && actor.effects?.size) {
    const ids = actor.effects
      .filter((effect) => {
        const linkedId = String(effect.getFlag("ffxiv", "linkedSourceEffectId") ?? "").trim();
        if (!linkedId) return false;
        const origin = String(effect.origin ?? "").trim();
        const originItemId = getItemIdFromUuid(origin);
        const flaggedSourceUuid = String(effect.getFlag("ffxiv", "linkedSourceItemUuid") ?? "").trim();
        const flaggedSourceItemId = String(effect.getFlag("ffxiv", "linkedSourceItemId") ?? "").trim();
        return replacementSources.some(({ sourceEffectId, sourceItemUuid, sourceItemId }) => {
          if (linkedId !== sourceEffectId) return false;
          if (!sourceItemUuid && !sourceItemId) return true;
          if (sourceItemUuid && (origin === sourceItemUuid || flaggedSourceUuid === sourceItemUuid)) return true;
          if (!sourceItemId) return false;
          if (originItemId === sourceItemId || flaggedSourceItemId === sourceItemId) return true;
          return getItemIdFromUuid(flaggedSourceUuid) === sourceItemId;
        });
      })
      .map((effect) => effect.id)
      .filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
  }
  const created = await actor.createEmbeddedDocuments("ActiveEffect", normalizedEffectDocs, { render: false });

  const appliedStatuses = new Set(
    normalizedEffectDocs.flatMap((doc) => getLinkedEffectDocStatuses(doc)),
  );
  if (appliedStatuses.has("stun")) {
    await actor.setFlag("ffxiv", "stunnedInEncounter", true);
  }
  if (appliedStatuses.has("petrified")) {
    await markPetrifiedAppliedThisTurn(actor);
  }
  if (appliedStatuses.has("knocked_out")) {
    await deleteActorStatuses(actor, getKnockedOutBlockedStatusIds());
    await removeEnmityInflictedByActor(actor);
    await clearActorJobResources(actor);
  }
  return created.length;
}

async function prepareLinkedActiveEffectStatusRules(actor, effectDocs) {
  const preparedDocs = [];
  let removeWeakness = false;
  let appliedComatose = false;

  for (const doc of effectDocs) {
    const statuses = getLinkedEffectDocStatuses(doc);
    doc.statuses = statuses;

    if (!statuses.length) {
      preparedDocs.push(doc);
      continue;
    }

    if (
      hasStatus(actor, "knocked_out") &&
      statuses.some((statusId) => !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(statusId))
    )
      continue;

    if (
      hasStatus(actor, "comatose") &&
      statuses.some((statusId) => !COMATOSE_ALLOWED_STATUS_IDS.has(statusId))
    )
      continue;

    if (
      hasStatus(actor, "transcendent") &&
      statuses.some((statusId) => isNegativeStatusEffect(statusId))
    )
      continue;

    if (statuses.some((statusId) => isEliteFoeBlockedStatus(actor, statusId)))
      continue;

    if (
      statuses.includes("dot") &&
      isThunderSpellEffect(doc) &&
      hasThunderSpellDotFromSource(actor, getLinkedEffectSourceActorUuid(doc))
    )
      continue;

    if (statuses.length === 1 && statuses[0] === "weakness") {
      if (hasStatus(actor, "brink_death")) {
        setLinkedEffectDocStatus(doc, "comatose");
        appliedComatose = true;
        preparedDocs.push(doc);
        continue;
      }
      if (hasStatus(actor, "weakness")) {
        setLinkedEffectDocStatus(doc, "brink_death");
        removeWeakness = true;
        preparedDocs.push(doc);
        continue;
      }
    }

    if (
      statuses.includes("stun") &&
      (hasStatus(actor, "stun") ||
        actor.getFlag("ffxiv", "stunnedInEncounter") === true)
    )
      continue;

    if (statuses.includes("comatose")) appliedComatose = true;
    preparedDocs.push(doc);
  }

  if (appliedComatose) {
    await deleteActorStatuses(actor, getComatoseBlockedStatusIds());
    return preparedDocs.filter((doc) => {
      const statuses = getLinkedEffectDocStatuses(doc);
      return (
        !statuses.length ||
        statuses.every((statusId) =>
          COMATOSE_ALLOWED_STATUS_IDS.has(statusId),
        )
      );
    });
  }

  if (preparedDocs.some((doc) => getLinkedEffectDocStatuses(doc).includes("knocked_out"))) {
    await deleteActorStatuses(actor, getKnockedOutBlockedStatusIds());
    return preparedDocs.filter((doc) => {
      const statuses = getLinkedEffectDocStatuses(doc);
      return (
        !statuses.length ||
        statuses.every((statusId) =>
          KNOCKED_OUT_ALLOWED_STATUS_IDS.has(statusId),
        )
      );
    });
  }

  if (removeWeakness) await deleteActorStatuses(actor, ["weakness"]);
  return preparedDocs;
}

function getLinkedEffectDocStatuses(doc) {
  return sanitizeEffectStatuses(doc?.statuses ?? []);
}

function isThunderSpellEffect(effect) {
  if (foundry.utils.getProperty(effect, "flags.ffxiv.thunderSpell") === true)
    return true;
  const origin = String(effect?.origin ?? "").trim();
  const source = origin ? fromUuidSync(origin) : null;
  return source?.type === "ability" &&
    Array.from(source.system?.tags ?? []).some((tag) =>
      FFXIVItem._tagMatches(tag, ["FFXIV.Tags.ThunderSpell"]),
    );
}

function getLinkedEffectSourceActorUuid(effect) {
  const flagged = String(
    foundry.utils.getProperty(effect, "flags.ffxiv.linkedSourceActorUuid") ?? "",
  ).trim();
  if (flagged) return flagged;
  const origin = String(effect?.origin ?? "").trim();
  const source = origin ? fromUuidSync(origin) : null;
  return source?.parent?.documentName === "Actor" ? source.parent.uuid : null;
}

function hasThunderSpellDotFromSource(actor, sourceActorUuid) {
  if (!sourceActorUuid) return false;
  return Array.from(actor?.effects ?? []).some((effect) =>
    !effect.disabled &&
    effect.statuses instanceof Set &&
    effect.statuses.has("dot") &&
    isThunderSpellEffect(effect) &&
    getLinkedEffectSourceActorUuid(effect) === sourceActorUuid,
  );
}

function isLinkedEffectDocAdditiveStackable(doc) {
  return getLinkedEffectDocStatuses(doc).some((statusId) =>
    isAdditiveStackableStatusEffect(statusId),
  );
}

function setLinkedEffectDocStatus(doc, statusId) {
  doc.statuses = [statusId];
  const status = (CONFIG.statusEffects ?? []).find(
    (entry) => String(entry?.id ?? "").trim().toLowerCase() === statusId,
  );
  const statusImg = status?.img || status?.icon;
  if (statusImg) {
    doc.img = statusImg;
    doc.icon = statusImg;
  }
  return doc;
}

function getComatoseBlockedStatusIds() {
  return (CONFIG.statusEffects ?? [])
    .map((entry) => String(entry?.id ?? "").trim().toLowerCase())
    .filter(
      (statusId) =>
        statusId && !COMATOSE_ALLOWED_STATUS_IDS.has(statusId),
    );
}

function getKnockedOutBlockedStatusIds() {
  return (CONFIG.statusEffects ?? [])
    .map((entry) => String(entry?.id ?? "").trim().toLowerCase())
    .filter(
      (statusId) =>
        statusId && !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(statusId),
    );
}

async function deleteActorStatuses(actor, statusIds) {
  if (!actor?.effects?.size) return 0;
  const statusSet = new Set(statusIds);
  const ids = actor.effects
    .filter((effect) => {
      if (!effect || effect.disabled) return false;
      const statuses = effect.statuses;
      return (
        statuses instanceof Set &&
        Array.from(statuses).some((statusId) => statusSet.has(statusId))
      );
    })
    .map((effect) => effect.id)
    .filter(Boolean);
  if (ids.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
  }
  return ids.length;
}

function prepareLinkedActiveEffectDuration(actor, doc) {
  const combat = game.combat;
  if (combat?.started && combat.turns?.length) {
    const combatantExpiry = {
      combatId: combat.id,
      combatantId: combat.combatant?.id ?? null,
      round: combat.round ?? 0,
      turn: combat.turn ?? 0,
    };
    if (foundry.utils.getProperty(doc, "flags.ffxiv.expireAtCombatantTurnEnd") === true) {
      foundry.utils.setProperty(doc, "flags.ffxiv.expireAtCombatantTurnEnd", combatantExpiry);
    }
    if (foundry.utils.getProperty(doc, "flags.ffxiv.expireAtCombatantTurnStart") === true) {
      foundry.utils.setProperty(doc, "flags.ffxiv.expireAtCombatantTurnStart", combatantExpiry);
    }
  }

  if (!doc.duration || typeof doc.duration !== "object") return doc;

  doc.duration.startTime = game.time?.worldTime ?? null;

  if (!combat?.started || !combat.turns?.length) {
    doc.duration.startRound = null;
    doc.duration.startTurn = null;
    return doc;
  }

  doc.duration.combat = combat.id;
  doc.duration.startRound = combat.round ?? 0;
  doc.duration.startTurn = combat.turn ?? 0;

  const offset = getTurnsUntilActorTurnEnd(actor, combat) - 1;
  if (offset <= 0) return doc;

  const turns = Number(doc.duration.turns);
  if (Number.isFinite(turns) && turns > 0) {
    doc.duration.turns = turns + offset;
    return doc;
  }

  const units = String(doc.duration.units ?? "").toLowerCase();
  const value = Number(doc.duration.value);
  if (Number.isFinite(value) && value > 0 && (units === "turn" || units === "turns")) {
    doc.duration.value = value + offset;
  }
  return doc;
}

function getItemIdFromUuid(uuid) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(".");
  const itemIndex = parts.lastIndexOf("Item");
  return itemIndex >= 0 ? String(parts[itemIndex + 1] ?? "").trim() : "";
}

export async function removeLinkedEffectsFromActor(actor, sourceItemUuid, sourceEffectIds = [], options = {}) {
  if (!actor?.effects?.size) return 0;
  const includeAutoApply = options.includeAutoApply === true;
  const normalizedSourceUuid = String(sourceItemUuid ?? "").trim();
  const sourceItemId = getItemIdFromUuid(normalizedSourceUuid);
  const idSet = new Set((Array.isArray(sourceEffectIds) ? sourceEffectIds : []).map(String));
  const sourceEffectIdsProvided = idSet.size > 0;
  const hasSourceIdentity = Boolean(normalizedSourceUuid || sourceItemId);

  const effectsToDelete = actor.effects.filter((effect) => {
    const linkedId = String(effect.getFlag("ffxiv", "linkedSourceEffectId") ?? "").trim();
    const linkedAutoApply = effect.getFlag("ffxiv", "linkedAutoApply") === true;
    const origin = String(effect.origin ?? "").trim();
    const originItemId = getItemIdFromUuid(origin);
    const flaggedSourceUuid = String(effect.getFlag("ffxiv", "linkedSourceItemUuid") ?? "").trim();
    const flaggedSourceItemId = String(effect.getFlag("ffxiv", "linkedSourceItemId") ?? "").trim();

    const matchesSourceIdentity = (() => {
      if (!hasSourceIdentity) return false;
      if (origin && normalizedSourceUuid && origin === normalizedSourceUuid) return true;
      if (flaggedSourceUuid && normalizedSourceUuid && flaggedSourceUuid === normalizedSourceUuid) {
        return true;
      }
      if (sourceItemId) {
        if (originItemId && originItemId === sourceItemId) return true;
        if (flaggedSourceItemId && flaggedSourceItemId === sourceItemId) return true;
        const flaggedSourceUuidItemId = getItemIdFromUuid(flaggedSourceUuid);
        if (flaggedSourceUuidItemId && flaggedSourceUuidItemId === sourceItemId) return true;
      }
      return false;
    })();

    if (sourceEffectIdsProvided) {
      if (linkedAutoApply && !includeAutoApply) return false;
      if (linkedId && idSet.has(linkedId)) return true;
      // Legacy safety: allow source-based fallback even when per-effect ids are missing or mismatched.
      if (matchesSourceIdentity) return true;
      return false;
    }

    if (matchesSourceIdentity) return true;
    return !hasSourceIdentity && Boolean(linkedId);
  });
  const ids = effectsToDelete.map((effect) => effect.id).filter(Boolean);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
  return ids.length;
}

export function parseJsonIdArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

export function parseJsonStatusEntries(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeStatusEntry(entry))
      .filter((entry) => entry.statusId);
  } catch (_error) {
    return [];
  }
}

export function parseJsonStatusApplications(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((application) => ({
        actorId: String(
          application?.actorId ?? application?.actorRef ?? "",
        ).trim(),
        entries: (Array.isArray(application?.entries)
          ? application.entries
          : []
        )
          .map((entry) => normalizeStatusEntry(entry))
          .filter((entry) => entry.statusId),
      }))
      .filter((application) => application.actorId && application.entries.length);
  } catch (_error) {
    return [];
  }
}

export function getActorReference(actor) {
  return String(actor?.uuid ?? actor?.id ?? "").trim();
}

export async function resolveActorFromReference(ref) {
  const value = String(ref ?? "").trim();
  if (!value) return null;
  if (value.includes(".")) {
    try {
      const doc = await fromUuid(value);
      if (doc?.documentName === "Actor") return doc;
      if (doc?.actor?.documentName === "Actor") return doc.actor;
    } catch (_error) { }
  }
  return game.actors.get(value) ?? null;
}

export async function resolveItemFromReference(ref, actor = null) {
  const value = String(ref ?? "").trim();
  if (!value) return null;
  if (value.includes(".")) {
    try {
      const doc = await fromUuid(value);
      if (doc?.documentName === "Item") return doc;
    } catch (_error) { }
  }
  return actor?.items?.get(value) ?? game.items?.get(value) ?? null;
}

export async function resolveSocketActors(data = {}) {
  data = data ?? {};
  const refs =
    Array.isArray(data.actorRefs) && data.actorRefs.length
      ? data.actorRefs
      : data.actorIds;
  const actors = [];
  const seen = new Set();
  for (const ref of refs ?? []) {
    const actor = await resolveActorFromReference(ref);
    const key = String(actor?.uuid ?? actor?.id ?? "").trim();
    if (!actor || !key || seen.has(key)) continue;
    seen.add(key);
    actors.push(actor);
  }
  return actors;
}

export function setApplyStatusButtonState(button, applied, options = {}) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!applied) {
    button.dataset.ffxivStatusState = "apply";
    delete button.dataset.appliedActorIds;
    delete button.dataset.appliedStatusEntries;
    delete button.dataset.appliedStatusApplications;
    return;
  }

  const actorIds = Array.from(
    new Set(
      (Array.isArray(options.actorIds) ? options.actorIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  );
  const statusEntries = (Array.isArray(options.statusEntries) ? options.statusEntries : [])
    .map((entry) => normalizeStatusEntry(entry))
    .filter((entry) => entry.statusId);
  const applications = (Array.isArray(options.applications) ? options.applications : [])
    .map((application) => ({
      actorId: String(
        application?.actorId ?? application?.actorRef ?? "",
      ).trim(),
      entries: (Array.isArray(application?.entries)
        ? application.entries
        : []
      )
        .map((entry) => normalizeStatusEntry(entry))
        .filter((entry) => entry.statusId),
    }))
    .filter((application) => application.actorId && application.entries.length);
  button.dataset.ffxivStatusState = "applied";
  button.dataset.appliedActorIds = JSON.stringify(actorIds);
  button.dataset.appliedStatusEntries = JSON.stringify(statusEntries);
  button.dataset.appliedStatusApplications = JSON.stringify(applications);
}

export function getLinkedEffectApplyTo(effect) {
  const flagged = String(effect?.getFlag("ffxiv", "applyTo") || "")
    .trim()
    .toLowerCase();
  if (flagged === "self" || flagged === "target" || flagged === "self_auto" || flagged === "automation") return flagged;
  return "target";
}

function sanitizeEffectStatuses(statuses) {
  if (!statuses) return [];
  const statusIds = Array.from(statuses)
    .map((id) => String(id ?? "").trim().toLowerCase())
    .map((id) => (id === "ascendent" ? "transcendent" : id))
    .filter(Boolean);
  if (!statusIds.length) return [];
  const validIds = new Set(
    (CONFIG.statusEffects ?? []).map((entry) =>
      String(entry?.id ?? "").trim().toLowerCase(),
    ),
  );
  const sanitized = [];
  for (const id of statusIds) {
    if (!validIds.has(id)) continue;
    if (sanitized.includes(id)) continue;
    sanitized.push(id);
  }
  return sanitized;
}

export function buildLinkedActiveEffectDocs(item, effects, options = {}) {
  const autoApply = options.autoApply === true;
  const sourceItemUuid = item.uuid;
  const thunderSpell = item.type === "ability" &&
    Array.from(item.system?.tags ?? []).some((tag) =>
      FFXIVItem._tagMatches(tag, ["FFXIV.Tags.ThunderSpell"]),
    );
  return effects.flatMap((effect) => {
    const sourceData = effect.toObject();
    const statuses = sanitizeEffectStatuses(
      effect.statuses ?? effect._source?.statuses ?? [],
    );
    const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    const statusConfigs = new Map(
      (CONFIG.statusEffects ?? []).map((status) => [
        String(status?.id ?? "").trim().toLowerCase(),
        status,
      ]),
    );
    const withCommonFields = (doc) => {
      delete doc._id;
      doc.origin = sourceItemUuid;
      doc.disabled = false;
      doc.transfer = false;
      doc.showIcon = showAlways;
      doc.displayStatusIcon = true;
      doc.flags = foundry.utils.mergeObject(doc.flags || {}, {
        ffxiv: {
          linkedSourceEffectId: effect.id,
          linkedSourceItemId: item.id,
          linkedSourceItemUuid: sourceItemUuid,
          linkedSourceActorUuid:
            item.parent?.documentName === "Actor" ? item.parent.uuid : null,
          linkedAutoApply: autoApply,
          thunderSpell,
        },
      });
      return doc;
    };

    if (statuses.length <= 1) {
      const doc = withCommonFields(foundry.utils.deepClone(sourceData));
      doc.statuses = statuses;
      if (statuses.length === 1) {
        const status = statusConfigs.get(statuses[0]);
        const statusImg = status?.img || status?.icon;
        if (statusImg) {
          doc.img = statusImg;
          doc.icon = statusImg;
        }
      }
      return [doc];
    }

    return statuses.map((statusId, index) => {
      const doc = withCommonFields(foundry.utils.deepClone(sourceData));
      doc.statuses = [statusId];
      if (index > 0) {
        if (Array.isArray(doc.changes)) doc.changes = [];
        if (doc.system && Array.isArray(doc.system.changes))
          doc.system.changes = [];
      }
      const status = statusConfigs.get(statusId);
      const statusImg = status?.img || status?.icon;
      if (statusImg) {
        doc.img = statusImg;
        doc.icon = statusImg;
      }
      return doc;
    });
  });
}
