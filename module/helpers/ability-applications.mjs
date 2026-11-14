import { applyStatusEffectChange, hasStatus } from "./status-effects.mjs";
import { emitToActiveGM, getActiveGM } from "./socket.mjs";
import { getAbilityDamageResolution, getAbilityDamageTargets } from "./ability-targets.mjs";
import { clearUserTargetsForTiming, TARGET_CLEAR_TIMINGS } from "./target-selection.mjs";
import {
  applyResolvedHealingToActor,
  applyDamageToActorWithEffects,
  getHealingWithEffects,
  applyDamageSourceManaRecovery,
} from "./damage.mjs";
import {
  applyLinkedEffectsToActor,
  removeLinkedEffectsFromActor,
  resolveActorFromReference,
  resolveItemFromReference,
  getLinkedEffectApplyTo,
  buildLinkedActiveEffectDocs,
} from "./linked-effects.mjs";

const pendingAbilityDamageApplications = new Map();

function captureAbilityApplication(actors) {
  return Array.from(new Set(actors.filter(Boolean)), (actor) => ({
    actor,
    resources: Object.fromEntries(["health", "barrier", "mana"].map((key) => [
      key, Number(actor.system?.[key]?.value ?? 0),
    ])),
    effects: new Map(Array.from(actor.effects ?? [], (effect) => [effect.id, effect.toObject()])),
    jobResources: new Map(Array.from(actor.items ?? [])
      .filter((item) => Number(item.system?.job_resources_max) > 0)
      .map((item) => [item.id, (item.system.job_resource_status ?? []).filter(Boolean).length])),
  }));
}

function getAbilityApplicationChanges(states) {
  return states.map(({ actor, resources, effects, jobResources }) => ({
    actorUuid: actor.uuid,
    resources: Object.fromEntries(Object.entries(resources)
      .map(([key, value]) => [key, Number(actor.system?.[key]?.value ?? 0) - value])
      .filter(([, delta]) => delta !== 0)),
    removedEffects: Array.from(effects.values()).filter((effect) => !actor.effects.has(effect._id)),
    addedEffects: Array.from(actor.effects ?? [])
      .filter((effect) => !effects.has(effect.id)).map((effect) => effect.toObject()),
    jobResources: Array.from(jobResources, ([id, count]) => ({
      id,
      delta: (actor.items.get(id)?.system.job_resource_status ?? []).filter(Boolean).length - count,
    })).filter((entry) => entry.delta !== 0),
  })).filter((change) => Object.keys(change.resources).length || change.removedEffects.length ||
    change.addedEffects.length || change.jobResources.length);
}

export async function reverseAbilityApplication(message, applicationId, actorUuid, { redo = false, kind = "damage" } = {}) {
  if (!game.user.isGM) return;
  const previous = pendingAbilityDamageApplications.get(message.id) ?? Promise.resolve();
  const application = previous.catch(() => {}).then(async () => {
    const resolution = message.getFlag("ffxiv", "damageResolution");
    if (kind === "effects" ? message.getFlag("ffxiv", "activeEffectRequest") : resolution?.pendingTargets?.length) return;
    const applicationFlag = kind === "effects" ? "activeEffectApplications" : "damageResolution.applications";
    const applications = foundry.utils.deepClone(message.getFlag("ffxiv", applicationFlag) ?? []);
    const entry = applications.find((result) => result.applicationId === applicationId && result.actorUuid === actorUuid);
    const action = redo ? "redo" : "undo";
    const opposite = redo ? "undo" : "redo";
    if (!entry?.[action] || Boolean(entry.undone) !== redo) return;
    const changes = entry[action];
    const actors = await Promise.all(changes.map((change) => resolveActorFromReference(change.actorUuid)));
    if (actors.some((actor) => !actor)) {
      ui.notifications.warn(game.i18n.localize(redo ? "FFXIV.Chat.RedoApplicationUnavailable" : "FFXIV.Chat.UndoApplicationUnavailable"));
      return;
    }
    const options = {
      ffxivUndoApplication: true,
      ffxivSkipKnockedOutSync: true,
      ffxivSuppressStatusText: true,
      ffxivSuppressRemovalText: true,
    };
    if (entry.reversing !== action) {
      entry[opposite] = [];
      entry.reversing = action;
    }
    const before = captureAbilityApplication(actors);
    try {
      for (const [index, change] of changes.entries()) {
        const actor = actors[index];
        if (!change.resourcesUndone) {
          const updates = {};
          for (const [key, delta] of Object.entries(change.resources)) {
            const resource = actor.system[key];
            const max = key !== "barrier" && Number(resource.max) > 0 ? Number(resource.max) : Infinity;
            updates[`system.${key}.value`] = Math.max(0, Math.min(Number(resource.value) - delta, max));
          }
          if (Object.keys(updates).length) await actor.update(updates, options);
          change.resourcesUndone = true;
          await message.update({ [`flags.ffxiv.${applicationFlag}`]: applications });
        }
        const remove = change.addedEffects.filter((effect) => {
          const current = actor.effects.get(effect._id);
          if (!current || JSON.stringify(current.toObject()) !== JSON.stringify(effect)) return false;
          return kind === "effects" || !effect.statuses?.includes("knocked_out") || Number(actor.system.health.value) > 0;
        }).map((effect) => effect._id);
        if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove, options);
        const restore = change.removedEffects.filter((effect) => !actor.effects.has(effect._id) &&
          (kind === "effects" || !effect.statuses?.includes("knocked_out") || Number(actor.system.health.value) <= 0));
        if (restore.length) await actor.createEmbeddedDocuments("ActiveEffect", restore, { ...options, keepId: true });
        if (!change.jobResourcesUndone) {
          const items = change.jobResources.flatMap(({ id, delta }) => {
            const item = actor.items.get(id);
            if (!item) return [];
            const max = Number(item.system.job_resources_max);
            const count = Math.max(0, Math.min((item.system.job_resource_status ?? []).filter(Boolean).length - delta, max));
            return [{ _id: id, "system.job_resource_status": Array.from({ length: max }, (_, index) => index < count) }];
          });
          if (items.length) await actor.updateEmbeddedDocuments("Item", items, options);
          change.jobResourcesUndone = true;
          await message.update({ [`flags.ffxiv.${applicationFlag}`]: applications });
        }
        if (Object.hasOwn(change.resources, "health") && Number(actor.system.health.value) <= 0 && !hasStatus(actor, "knocked_out"))
          await applyStatusEffectChange(actor, "knocked_out", true);
      }
      entry.undone = !redo;
      delete entry.reversing;
    } finally {
      entry[opposite].push(...getAbilityApplicationChanges(before));
      await message.update({ [`flags.ffxiv.${applicationFlag}`]: applications });
    }
  });
  pendingAbilityDamageApplications.set(message.id, application);
  try {
    await application;
  } finally {
    if (pendingAbilityDamageApplications.get(message.id) === application)
      pendingAbilityDamageApplications.delete(message.id);
  }
}

async function releaseAbilityDamageTargets(message, actorRefs, applicationId) {
  const resolution = message.getFlag("ffxiv", "damageResolution");
  if (applicationId && resolution.pendingApplicationId !== applicationId) return;
  const pendingTargets = resolution.pendingTargets.filter((ref) => !actorRefs.includes(ref));
  await message.update({
    "flags.ffxiv.damageResolution.pendingTargets": pendingTargets,
    "flags.ffxiv.damageResolution.targetsLocked": Boolean(pendingTargets.length),
    "flags.ffxiv.damageResolution.pendingApplicationId": pendingTargets.length ? resolution.pendingApplicationId : null,
  });
}

async function prepareAbilityDamageApplication(message, button, tokens) {
  const resolution = foundry.utils.deepClone(getAbilityDamageResolution(message));
  if (resolution.pendingTargets.length) return null;
  const targets = getAbilityDamageTargets(resolution, tokens);
  const direct = button.dataset.direct === "true";
  const recipients = targets.filter((target) => target.direct === direct);
  if (!recipients.length) {
    if (!targets.length) ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
    return null;
  }
  button.disabled = true;
  for (const control of button.closest("ffxiv-ability-targets")?.querySelectorAll("button") ?? [])
    control.disabled = true;
  const applicationId = foundry.utils.randomID();
  const actorRefs = recipients.map((target) => target.actorUuid);
  resolution.targets = targets;
  resolution.targetsLocked = true;
  resolution.pendingTargets = [...new Set([...resolution.pendingTargets, ...actorRefs])];
  resolution.pendingApplicationId = applicationId;
  await message.update({
    "flags.ffxiv.damageResolution.targets": resolution.targets,
    "flags.ffxiv.damageResolution.targetsLocked": true,
    "flags.ffxiv.damageResolution.pendingTargets": resolution.pendingTargets,
    "flags.ffxiv.damageResolution.pendingApplicationId": applicationId,
    "flags.ffxiv.damageResolution.automaticDirectHit": resolution.automaticDirectHit,
    "flags.ffxiv.damageResolution.hasDirectRoll": resolution.hasDirectRoll,
    "flags.ffxiv.damageResolution.defenseType": resolution.defenseType,
    "flags.ffxiv.damageResolution.useLowerDefense": resolution.useLowerDefense,
    "flags.ffxiv.damageResolution.directFormula": resolution.directFormula,
    "flags.ffxiv.damageResolution.effectSnapshot": resolution.effectSnapshot,
  });
  try {
    if (direct && !resolution.directRoll) {
      const item = await resolveItemFromReference(resolution.sourceItemUuid);
      const result = await item?._evaluateDirectHitRoll({
        critical: resolution.critical,
        effectSnapshot: resolution.effectSnapshot,
      });
      if (!result) {
        await releaseAbilityDamageTargets(message, actorRefs, applicationId);
        return null;
      }
      resolution.directRoll = result.roll.toJSON();
      resolution.directFlavor = result.flavor;
      resolution.buttons = "";
      const content = $("<div>" + message.content + "</div>");
      content.find(".ffxiv-ability-damage").replaceWith(await item._renderAbilityDamage(resolution));
      await message.update({
        content: content.html(),
        rolls: [...message.rolls, result.roll],
        "flags.ffxiv.damageResolution.directRoll": resolution.directRoll,
        "flags.ffxiv.damageResolution.directFlavor": resolution.directFlavor,
        "flags.ffxiv.damageResolution.buttons": "",
      });
      await item._consumeForceCriticalRule(result.forceCriticalRule);
    }
    return { targets: recipients, applicationId };
  } catch (error) {
    await releaseAbilityDamageTargets(message, actorRefs, applicationId);
    throw error;
  }
}

async function applyAbilityResult(message, actorRefs, { direct = false, kind = "damage", applicationId } = {}) {
  const previous = pendingAbilityDamageApplications.get(message.id) ?? Promise.resolve();
  const application = previous.catch(() => {}).then(async () => {
    const resolution = message.getFlag("ffxiv", "damageResolution");
    if (!resolution) return;
    if (!applicationId || resolution.completedApplications?.includes(applicationId)) return;
    if (resolution.pendingApplicationId !== applicationId) return;
    const sourceActor = await resolveActorFromReference(resolution.sourceActorUuid);
    const sourceItem = await resolveItemFromReference(resolution.sourceItemUuid, sourceActor);
    const appliedTargets = [...resolution.appliedTargets];
    const applications = [...(resolution.applications ?? [])];
    const results = [];
    for (const actorRef of new Set(actorRefs)) {
      if (applications.some((entry) => entry.applicationId === applicationId && entry.actorUuid === actorRef)) continue;
      const target = resolution.targets.find((entry) => entry.actorUuid === actorRef);
      if (resolution.targets.length && !target) continue;
      const actor = await resolveActorFromReference(actorRef);
      if (!actor || !actor.testUserPermission(game.user, "OWNER")) continue;
      const hasDirectHit = target?.direct ?? direct;
      const damage = [
        resolution.baseRoll?.total ?? 0,
        hasDirectHit ? resolution.directRoll?.total ?? 0 : 0,
      ];
      const before = captureAbilityApplication([actor, sourceActor]);
      const result = kind === "heal"
        ? await getHealingWithEffects(actor, damage.reduce((total, amount) => total + Number(amount), 0), { sourceActor, sourceItem })
        : await applyDamageToActorWithEffects(actor, damage, { sourceActor, sourceItem });
      if (!result) continue;
      if (kind === "heal") {
        await applyResolvedHealingToActor(actor, result, { sourceActor, sourceItem });
      }
      results.push(result);
      if (!appliedTargets.includes(actorRef)) appliedTargets.push(actorRef);
      applications.push({
        applicationId,
        kind,
        actorUuid: actorRef,
        name: target?.name ?? actor.name,
        undo: getAbilityApplicationChanges(before),
        ...(kind === "heal" ? { resolvedHealing: result.resolvedHealing } : {
          baseDamage: result.baseDamage,
          resolvedDamage: result.resolvedDamage,
        }),
      });
      await message.update({
        "flags.ffxiv.damageResolution.appliedTargets": appliedTargets,
        "flags.ffxiv.damageResolution.applications": applications,
        "flags.ffxiv.damageResolution.healingApplied": kind === "heal" || resolution.healingApplied === true,
      });
    }
    if (kind !== "heal") {
      for (const result of results) {
        const before = captureAbilityApplication([sourceActor]);
        await applyDamageSourceManaRecovery(sourceActor, sourceItem, [result]);
        const entry = applications.find((entry) => entry.applicationId === applicationId && entry.actorUuid === result.actor.uuid);
        entry.undo.push(...getAbilityApplicationChanges(before));
      }
      await message.update({ "flags.ffxiv.damageResolution.applications": applications });
    }
    await message.update({
      "flags.ffxiv.damageResolution.completedApplications": [...(resolution.completedApplications ?? []), applicationId],
    });
  });
  pendingAbilityDamageApplications.set(message.id, application);
  try {
    await application;
  } finally {
    const pending = message.getFlag("ffxiv", "damageResolution.pendingTargets") ?? [];
    if (pending.some((ref) => actorRefs.includes(ref)))
      await releaseAbilityDamageTargets(message, actorRefs, applicationId);
    if (pendingAbilityDamageApplications.get(message.id) === application)
      pendingAbilityDamageApplications.delete(message.id);
  }
}

export async function requestAbilityApplication(message, button, kind) {
  if (button.disabled) return;
  if (!message.getFlag("ffxiv", "damageResolution")) {
    if (!game.user.targets.size) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }
    const sourceItem = await resolveChatAbilityItem(button);
    const sourceActor = await resolveActorFromReference(button.dataset.actorUuid ?? button.dataset.actorId);
    const total = Number(Roll.safeEval(kind === "heal" ? button.dataset.heal : button.dataset.damage));
    if (!Number.isFinite(total)) return;
    const resolution = {
      sourceActorUuid: sourceActor?.uuid ?? "",
      sourceItemUuid: sourceItem?.uuid ?? "",
      baseRoll: { total, formula: String(total) },
      directRoll: null,
      automaticDirectHit: false,
      hasDirectRoll: false,
      targets: [],
      appliedTargets: [],
      pendingTargets: [],
    };
    const content = $("<div>" + message.content + "</div>");
    content.find(".ffxiv-apply-dmg, .ffxiv-apply-heal").first().closest(".ffxiv-chat-buttons")
      .replaceWith("<ffxiv-ability-targets></ffxiv-ability-targets>");
    await message.update({ content: content.html(), "flags.ffxiv.damageResolution": resolution });
  }
  const prepared = await prepareAbilityDamageApplication(message, button, Array.from(game.user.targets ?? []));
  if (!prepared) return;
  const actorRefs = prepared.targets.map((target) => target.actorUuid);
  const applicationId = prepared.applicationId;
  const direct = button.dataset.direct === "true";
  const gm = getActiveGM();
  if (!gm && !game.user.isGM) {
    const actors = await Promise.all(actorRefs.map((ref) => resolveActorFromReference(ref)));
    if (actors.some((actor) => actor && !actor.testUserPermission(game.user, "OWNER"))) {
      await releaseAbilityDamageTargets(message, actorRefs, applicationId);
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoActiveGM"));
      return;
    }
  }
  if (gm && gm.id !== game.user.id) {
    const sent = emitToActiveGM({
      type: kind === "heal" ? "applyHeal" : "applyDamage",
      data: { messageId: message.id, actorRefs, direct, applicationId },
      userName: game.user.name,
    });
    if (sent) {
      clearUserTargetsForTiming(TARGET_CLEAR_TIMINGS.ABILITY);
      ui.notifications.info(game.i18n.localize("FFXIV.Notifications.SendSocket"));
    }
    else await releaseAbilityDamageTargets(message, actorRefs, applicationId);
  } else {
    await applyAbilityResult(message, actorRefs, { direct, kind, applicationId });
    clearUserTargetsForTiming(TARGET_CLEAR_TIMINGS.ABILITY);
  }
}

export async function handleAbilityApplicationRequest(data, actors, userName, kind) {
  const message = game.messages.get(data.messageId);
  const resolution = message?.getFlag("ffxiv", "damageResolution");
  if (!resolution) return;
  if (!data.applicationId || resolution.completedApplications?.includes(data.applicationId)) return;
  if (resolution.pendingApplicationId !== data.applicationId) return;
  const actorRefs = data.actorRefs ?? [];
  const targetList = actors.map((actor) => {
    const target = resolution.targets.find((entry) => entry.actorUuid === actor.uuid);
    const direct = target?.direct ?? data.direct;
    const total = Number(resolution.baseRoll?.total ?? 0) +
      (direct ? Number(resolution.directRoll?.total ?? 0) : 0);
    return `<li>${foundry.utils.escapeHTML(target?.name ?? actor.name)}: ${total}</li>`;
  });
  const accepted = actors.every((actor) => actor.testUserPermission(message.author, "OWNER")) ||
    game.settings.get("ffxiv", "autoApplySocketRequests") ||
    await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(kind === "heal" ? "FFXIV.Notifications.HealChangeRequest" : "FFXIV.Notifications.DamageChangeRequest") },
      content: `<p>${game.i18n.format(kind === "heal" ? "FFXIV.Notifications.AbilityHealingRequest" : "FFXIV.Notifications.AbilityDamageRequest", { playerName: foundry.utils.escapeHTML(userName ?? "") })}</p><ul>${targetList.join("")}</ul>`,
      rejectClose: false,
    });
  if (accepted) await applyAbilityResult(message, actorRefs, { direct: data.direct, kind, applicationId: data.applicationId });
  else {
    const current = message.getFlag("ffxiv", "damageResolution");
    if (current.pendingApplicationId !== data.applicationId) return;
    await message.update({
      "flags.ffxiv.damageResolution.completedApplications": [...(current.completedApplications ?? []), data.applicationId],
    });
    await releaseAbilityDamageTargets(message, actorRefs, data.applicationId);
  }
}

export async function requestAbilityActiveEffects(message, button) {
  if (message.getFlag("ffxiv", "activeEffectRequest")) return;
  const item = await resolveChatAbilityItem(button);
  if (!item) return;
  const sourceActor = item.parent?.documentName === "Actor"
    ? item.parent
    : await resolveActorFromReference(button.dataset.actorUuid ?? button.dataset.actorId);
  const branchKey = item._normalizeEffectKey?.(button.dataset.effectBranch) ?? "";
  const effects = Array.from(item.effects ?? []).filter((effect) => {
    if (effect.disabled) return false;
    const applyTo = getLinkedEffectApplyTo(effect);
    if (applyTo === "self_auto" || applyTo === "automation") return false;
    const effectBranchKey = item._getLinkedEffectBranchKey?.(effect) ?? "";
    return branchKey ? effectBranchKey === branchKey : !effectBranchKey;
  });
  const selfEffects = effects.filter((effect) => getLinkedEffectApplyTo(effect) === "self");
  const targetEffects = effects.filter((effect) => getLinkedEffectApplyTo(effect) === "target");
  const targets = Array.from(game.user.targets ?? []);
  if (!selfEffects.length && targetEffects.length && !targets.length) {
    ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
    return;
  }
  const recipients = new Map();
  const addRecipient = (actor, effects, name = actor?.name) => {
    if (!actor || !effects.length) return;
    const entry = recipients.get(actor.uuid);
    if (entry) entry.effects.push(...effects.filter((effect) => !entry.effects.some((existing) => existing.id === effect.id)));
    else recipients.set(actor.uuid, { actor, effects: [...effects], name });
  };
  addRecipient(sourceActor, selfEffects);
  for (const token of targets) addRecipient(token.actor, targetEffects, token.name);
  const applications = Array.from(recipients.values(), ({ actor, effects, name }) => ({
    actorRef: actor.uuid,
    name,
    sourceItemUuid: item.uuid,
    effectDocs: buildLinkedActiveEffectDocs(item, effects.filter((effect) => effect.getFlag("ffxiv", "applyAction") !== "remove")),
    removeSourceIds: effects.filter((effect) => effect.getFlag("ffxiv", "applyAction") === "remove").map((effect) => effect.id),
  })).filter((entry) => entry.effectDocs.length || entry.removeSourceIds.length);
  if (!applications.length) return;
  const gm = getActiveGM();
  if (!gm && !game.user.isGM && Array.from(recipients.values()).some(({ actor }) => !actor.testUserPermission(game.user, "OWNER"))) {
    ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoActiveGM"));
    return;
  }
  const applicationId = foundry.utils.randomID();
  await message.update({ "flags.ffxiv.activeEffectRequest": { applicationId, applications } });
  if (gm && gm.id !== game.user.id) {
    const sent = emitToActiveGM({
      type: "applyLinkedEffects",
      data: { messageId: message.id, applicationId, actorRefs: applications.map((entry) => entry.actorRef) },
      userName: game.user.name,
    });
    if (sent) ui.notifications.info(game.i18n.localize("FFXIV.Notifications.SendSocket"));
    else await message.update({ "flags.ffxiv.activeEffectRequest": null });
  } else await applyAbilityActiveEffects(message, applicationId);
}

async function applyAbilityActiveEffects(message, applicationId) {
  const previous = pendingAbilityDamageApplications.get(message.id) ?? Promise.resolve();
  const application = previous.catch(() => {}).then(async () => {
    const request = message.getFlag("ffxiv", "activeEffectRequest");
    if (!request || request.applicationId !== applicationId) return;
    const applications = [...(message.getFlag("ffxiv", "activeEffectApplications") ?? [])];
    for (const entry of request.applications) {
      if (applications.some((result) => result.applicationId === applicationId && result.actorUuid === entry.actorRef)) continue;
      const actor = await resolveActorFromReference(entry.actorRef);
      if (!actor || !actor.testUserPermission(game.user, "OWNER")) continue;
      const before = captureAbilityApplication([actor]);
      try {
        await applyLinkedEffectsToActor(actor, entry.effectDocs);
        if (entry.removeSourceIds.length)
          await removeLinkedEffectsFromActor(actor, entry.sourceItemUuid, entry.removeSourceIds);
      } finally {
        const undo = getAbilityApplicationChanges(before);
        if (undo.length) {
          applications.push({ applicationId, actorUuid: actor.uuid, name: entry.name, kind: "effects", undo });
          await message.update({ "flags.ffxiv.activeEffectApplications": applications });
        }
      }
    }
  });
  pendingAbilityDamageApplications.set(message.id, application);
  try {
    await application;
  } finally {
    if (message.getFlag("ffxiv", "activeEffectRequest")?.applicationId === applicationId)
      await message.update({ "flags.ffxiv.activeEffectRequest": null });
    if (pendingAbilityDamageApplications.get(message.id) === application)
      pendingAbilityDamageApplications.delete(message.id);
  }
}

export async function handleAbilityActiveEffectRequest(data, userName) {
  const message = game.messages.get(data.messageId);
  const request = message?.getFlag("ffxiv", "activeEffectRequest");
  if (!request || request.applicationId !== data.applicationId) return;
  const actors = (await Promise.all(request.applications.map((entry) => resolveActorFromReference(entry.actorRef)))).filter(Boolean);
  const accepted = actors.length && (actors.every((actor) => actor.testUserPermission(message.author, "OWNER")) ||
    game.settings.get("ffxiv", "autoApplySocketRequests") ||
    await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FFXIV.Notifications.StatusChangeRequest") },
      content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest", { playerName: foundry.utils.escapeHTML(userName ?? ""), effect: game.i18n.localize("FFXIV.Abilities.LinkedActiveEffects") })}</p><ul>${actors.map((actor) => `<li>${foundry.utils.escapeHTML(actor.name)}</li>`).join("")}</ul>`,
      rejectClose: false,
    }));
  if (accepted) await applyAbilityActiveEffects(message, data.applicationId);
  else if (message.getFlag("ffxiv", "activeEffectRequest")?.applicationId === data.applicationId)
    await message.update({ "flags.ffxiv.activeEffectRequest": null });
}

export async function resolveChatAbilityItem(element) {
  const itemUuid = String(element?.dataset?.itemUuid ?? "").trim();
  if (itemUuid) {
    try {
      const byUuid = await fromUuid(itemUuid);
      if (byUuid?.documentName === "Item") return byUuid;
    } catch (_error) { }
  }

  const actorUuid = String(element?.dataset?.actorUuid ?? "").trim();
  if (actorUuid) {
    try {
      const actorDoc = await fromUuid(actorUuid);
      if (actorDoc?.documentName === "Actor") {
        const item = actorDoc.items?.get(element?.dataset?.itemId);
        if (item) return item;
      }
    } catch (_error) { }
  }

  const actorId = String(element?.dataset?.actorId ?? "").trim();
  const itemId = String(element?.dataset?.itemId ?? "").trim();
  const actor = game.actors.get(actorId);
  return actor?.items?.get(itemId) ?? null;
}
