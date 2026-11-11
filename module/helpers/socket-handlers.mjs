import { isAbilityAutomationEnabled } from "./automation.mjs";
import { FFXIV } from "./config.mjs";
import { debugError, debugLog } from "./debug.mjs";
import { createSummonTokenFromRequest, FFXIV_SUMMON_SOCKET_TYPE } from "./summons.mjs";
import { RULE_SOCKET_TYPE } from "./rules.mjs";
import { FFXIV_MARKER_SOCKET_TYPE, createMarkerTileFromRequest } from "./markers.mjs";
import {
  applyResolvedHealingToActor,
  applyDamageToActorWithEffects,
  applyResolvedDamageToActor,
  getHealingWithEffects,
  applyDamageSourceManaRecovery,
} from "./damage.mjs";
import {
  handleAbilityApplicationRequest,
  handleAbilityActiveEffectRequest,
} from "./ability-applications.mjs";
import {
  applyStatusEntryToActor,
  getStatusLabelById,
  getStatusEntryNotificationKey,
  applyLinkedEffectsToActor,
  removeLinkedEffectsFromActor,
  getActorReference,
  resolveActorFromReference,
  resolveItemFromReference,
  resolveSocketActors,
} from "./linked-effects.mjs";
import { normalizeTagValue, parseTagSetting, buildTagPool } from "./ability-subtype.mjs";
import { migrateCustomTagSettings } from "../migrations/legacy-data.mjs";
import { consumeLimitBreakSegment } from "./limit-break-hud.mjs";

export function registerSystemSocketHooks() {
  Hooks.on("ready", function () {
    migrateCustomTagSettings().catch((err) =>
      debugError("FFXIV | Custom tag migration failed:", err),
    );

    const categories = [
      {
        configKey: "customAbilityTags",
        configTarget: "tags_abilities",
        baseKey: "base_tags_abilities",
      },
      {
        configKey: "customTraitTags",
        configTarget: "tags_traits",
        baseKey: "base_tags_traits",
      },
      {
        configKey: "customConsumableTags",
        configTarget: "tags_consumables",
        baseKey: "base_tags_consumables",
      },
    ];

    CONFIG.FFXIV = CONFIG.FFXIV || {};

    for (let { configKey, configTarget, baseKey } of categories) {
      const baseTags = Array.isArray(FFXIV[baseKey]) ? FFXIV[baseKey] : [];
      const raw = game.settings.get("ffxiv", configKey);
      const customTags = parseTagSetting(raw);
      const combinedTags = [...baseTags, ...customTags];
      const deduped = [];
      const seen = new Set();
      for (const tag of combinedTags) {
        const normalized = normalizeTagValue(tag);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(tag.trim());
      }
      CONFIG.FFXIV[configTarget] = buildTagPool(deduped);
    }

    if (game.user.isGM) {
      game.socket.on("system.ffxiv", async (params) => {
        debugLog("get socket");
        const { type, data, userName, gmUserId } = params;
        if (!gmUserId || gmUserId !== game.user.id || type === RULE_SOCKET_TYPE) return;
        const actors = await resolveSocketActors(data);
        if (data.messageId && ["applyDamage", "applyHeal"].includes(type)) {
          await handleAbilityApplicationRequest(data, actors, userName, type === "applyHeal" ? "heal" : "damage");
          return;
        }
        if (data.messageId && type === "applyLinkedEffects") {
          await handleAbilityActiveEffectRequest(data, userName);
          return;
        }
        switch (type) {
          case "applyResourceRule": {
            const sourceItem = await resolveItemFromReference(data.sourceItemUuid);
            if (!sourceItem || !isAbilityAutomationEnabled()) break;
            // Only execute resource rules that are actually configured on the item.
            const rule = sourceItem
              ._getEffectRules()
              .find(
                (entry) =>
                  entry.action === "resource" &&
                  entry.applyTo === "target" &&
                  JSON.stringify(entry) === JSON.stringify(data.rule),
              );
            if (!rule) break;
            const apply = async () => {
              for (const actor of actors) {
                await sourceItem._applyEffectRule(actor, rule, data.context ?? {});
              }
            };
            if (game.settings.get("ffxiv", "autoApplySocketRequests")) await apply();
            else
              new foundry.applications.api.DialogV2({
                window: {
                  title: game.i18n.localize("FFXIV.Abilities.AutomationResource"),
                },
                content: `<p>${foundry.utils.escapeHTML(userName ?? "")}: ${foundry.utils.escapeHTML(sourceItem.name)}</p><ul>${actors.map((actor) => `<li>${foundry.utils.escapeHTML(actor.name)}</li>`).join("")}</ul>`,
                buttons: [
                  {
                    action: "accept",
                    label: game.i18n.localize("FFXIV.Sockets.Accept"),
                    callback: apply,
                  },
                  {
                    action: "decline",
                    label: game.i18n.localize("FFXIV.Sockets.Decline"),
                  },
                ],
              }).render(true);
            break;
          }
          case FFXIV_MARKER_SOCKET_TYPE:
            try {
              await createMarkerTileFromRequest(data);
            } catch (err) {
              debugError("socket marker placement failed:", err);
            }
            break;
          case FFXIV_SUMMON_SOCKET_TYPE:
            try {
              await createSummonTokenFromRequest(data);
            } catch (err) {
              debugError("socket summon actor failed:", err);
            }
            break;
          case "applyEffect": {
            debugLog("status socket");
            const normalizeEffects = (entries) => (Array.isArray(entries) ? entries : [])
              .map((entry) => ({
                ...entry,
                statusId: String(entry?.statusId ?? entry?.effect?.id ?? "").trim(),
              }))
              .filter((entry) => entry.statusId);
            const applications = [];
            if (Array.isArray(data.applications)) {
              for (const application of data.applications) {
                const actor = await resolveActorFromReference(
                  application.actorRef ?? application.actorUuid ?? application.actorId,
                );
                const effects = normalizeEffects(application.effects);
                if (actor && effects.length) applications.push({ actor, effects });
              }
            } else {
              const effects = normalizeEffects(
                Array.isArray(data.effects)
                  ? data.effects
                  : [{ effect: data.effect, active: data.active }],
              );
              for (const actor of actors) {
                if (effects.length) applications.push({ actor, effects });
              }
            }
            if (!applications.length) return;
            const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
            if (autoApply) {
              for (const { actor, effects } of applications) {
                for (const entry of effects) {
                  const applied = await applyStatusEntryToActor(actor, entry);
                  if (applied) {
                    ui.notifications.info(
                      game.i18n.format(getStatusEntryNotificationKey(entry), {
                        effect: getStatusLabelById(entry.statusId),
                        actor: actor.name,
                      }),
                    );
                  }
                }
              }
              break;
            }

            const effectList = Array.from(new Set(
              applications.flatMap(({ effects }) =>
                effects.map((entry) => getStatusLabelById(entry.statusId))),
            )).join(", ");
            new foundry.applications.api.DialogV2({
              id: "gamemaster-socket-apply-effect",
              window: {
                title: game.i18n.localize(
                  "FFXIV.Notifications.StatusChangeRequest",
                ),
              },
              content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest", { playerName: userName, effect: effectList })}</p>
                <ul>${applications.map(({ actor, effects }) => {
                    const labels = effects
                      .map((entry) => getStatusLabelById(entry.statusId))
                      .join(", ");
                    return `<li>${actor.name}: ${labels}</li>`;
                  }).join("")}</ul>`,
              buttons: [
                {
                  label: game.i18n.localize("FFXIV.Sockets.Accept"),
                  action: "accept",
                  type: "submit",
                  callback: async () => {
                    for (const { actor, effects } of applications) {
                      for (const entry of effects) {
                        const applied = await applyStatusEntryToActor(actor, entry);
                        if (applied) {
                          ui.notifications.info(
                            game.i18n.format(getStatusEntryNotificationKey(entry), {
                              effect: getStatusLabelById(entry.statusId),
                              actor: actor.name,
                            }),
                          );
                        }
                      }
                    }
                  },
                },
                {
                  label: game.i18n.localize("FFXIV.Sockets.Decline"),
                  action: "decline",
                  type: "submit",
                },
              ],
            }).render(true);
            break;
          }

          case "applyHeal": {
            debugLog("heal socket");
            const sourceActor = await resolveActorFromReference(
              data.sourceActorUuid ?? data.sourceActorId,
            );
            const sourceItem = await resolveItemFromReference(
              data.sourceItemUuid ?? data.sourceItemId,
              sourceActor,
            );
            const applications = [];
            if (Array.isArray(data.applications)) {
              for (const application of data.applications) {
                const actor = await resolveActorFromReference(
                  application.actorRef ?? application.actorUuid ?? application.actorId,
                );
                const heal = Math.max(Number.parseInt(application.heal, 10) || 0, 0);
                const resolvedHealing = Math.max(
                  Number.parseInt(application.resolvedHealing ?? heal, 10) || 0,
                  0,
                );
                if (actor && heal > 0) {
                  applications.push({
                    actor,
                    healing: {
                      actor,
                      baseHealing: Math.max(
                        Number.parseInt(application.baseHealing ?? heal, 10) || 0,
                        0,
                      ),
                      resolvedHealing,
                    },
                  });
                }
              }
            } else {
              const heal = Math.max(Number.parseInt(data.heal, 10) || 0, 0);
              if (heal > 0) {
                for (const actor of actors) {
                  const healing = await getHealingWithEffects(actor, heal, {
                    sourceActor,
                    sourceItem,
                  });
                  applications.push({ actor, healing });
                }
              }
            }
            if (!applications.length) return;
            const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
            if (autoApply) {
              for (const { actor, healing } of applications) {
                await applyResolvedHealingToActor(actor, healing, { sourceActor, sourceItem });
              }
              break;
            }

            const requestedHeal = Array.from(new Set(
              applications.map(({ healing }) => healing.resolvedHealing),
            )).join(", ");
            new foundry.applications.api.DialogV2({
              id: "gamemaster-socket-heal",
              window: {
                title: game.i18n.localize(
                  "FFXIV.Notifications.HealChangeRequest",
                ),
              },
              content: `<p>${game.i18n.format("FFXIV.Notifications.HealRequest", { playerName: userName, heal: requestedHeal })}</p>
                <ul>${applications.map(({ actor, healing }) => `<li>${actor.name}: ${healing.resolvedHealing}</li>`).join("")}</ul>`,
              buttons: [
                {
                  label: game.i18n.localize("FFXIV.Sockets.Accept"),
                  action: "accept",
                  type: "submit",
                  callback: async () => {
                    for (const { actor, healing } of applications) {
                      await applyResolvedHealingToActor(actor, healing, {
                        sourceActor,
                        sourceItem,
                      });
                    }
                  },
                },
                {
                  label: game.i18n.localize("FFXIV.Sockets.Decline"),
                  action: "decline",
                  type: "submit",
                },
              ],
            }).render(true);
            break;
          }

          case "applyDamage": {
            debugLog("damage socket");
            const damage = Math.max(Number.parseInt(data.damage, 10) || 0, 0);
            const sourceActor = await resolveActorFromReference(
              data.sourceActorUuid ?? data.sourceActorId,
            );
            const sourceItem = await resolveItemFromReference(
              data.sourceItemUuid ?? data.sourceItemId,
              sourceActor,
            );
            const applications = [];
            if (Array.isArray(data.applications)) {
              for (const application of data.applications) {
                const actor = await resolveActorFromReference(
                  application.actorRef ?? application.actorUuid ?? application.actorId,
                );
                const resolvedDamage = Math.max(
                  Number.parseInt(application.resolvedDamage ?? application.damage, 10) || 0,
                  0,
                );
                if (!actor) continue;
                applications.push({
                  actor,
                  result: {
                    actor,
                    baseDamage: Math.max(
                      Number.parseInt(application.baseDamage ?? damage, 10) || 0,
                      0,
                    ),
                    modifiedDamage: Math.max(
                      Number.parseInt(application.modifiedDamage ?? resolvedDamage, 10) || 0,
                      0,
                    ),
                    resolvedDamage,
                    preventedDamage: Math.max(
                      Number.parseInt(application.preventedDamage, 10) || 0,
                      0,
                    ),
                    consumedEffectIds: Array.isArray(application.consumedEffectIds)
                      ? application.consumedEffectIds
                      : [],
                  },
                });
              }
            }
            if (!applications.length && (!actors.length || !damage)) return;

            const applyApplications = async () => {
              const damageResults = [];
              if (applications.length) {
                for (const { actor, result } of applications) {
                  await applyResolvedDamageToActor(actor, result, { sourceActor });
                  damageResults.push(result);
                }
              } else {
                for (const actor of actors) {
                  const result = await applyDamageToActorWithEffects(actor, damage, {
                    sourceActor,
                    sourceItem,
                  });
                  if (result) damageResults.push(result);
                }
              }
              await applyDamageSourceManaRecovery(sourceActor, sourceItem, damageResults);
            };

            const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
            if (autoApply) {
              await applyApplications();
              break;
            }

            const targetList = applications.length
              ? applications.map(({ actor, result }) => `<li>${actor.name}: ${result.resolvedDamage}</li>`)
              : actors.map((a) => `<li>${a.name}</li>`);
            new foundry.applications.api.DialogV2({
              id: "gamemaster-socket-damage",
              window: {
                title: game.i18n.localize(
                  "FFXIV.Notifications.DamageChangeRequest",
                ),
              },
              content: `<p>${game.i18n.format("FFXIV.Notifications.DamageRequest", { playerName: userName, damage: damage })}</p>
                <ul>${targetList.join("")}</ul>`,
              buttons: [
                {
                  label: game.i18n.localize("FFXIV.Sockets.Accept"),
                  action: "accept",
                  type: "submit",
                  callback: applyApplications,
                },
                {
                  label: game.i18n.localize("FFXIV.Sockets.Decline"),
                  action: "decline",
                  type: "submit",
                },
              ],
            }).render(true);
            break;
          }
          case "applyLinkedEffects": {
            const applications = [];
            const requests = Array.isArray(data.applications)
              ? data.applications
              : actors.map((actor) => ({ ...data, actorRef: getActorReference(actor) }));
            for (const request of requests) {
              const actor = await resolveActorFromReference(
                request.actorRef ?? request.actorUuid ?? request.actorId,
              );
              const effectDocs = Array.isArray(request.effectDocs) ? request.effectDocs : [];
              const removeSourceIds = Array.isArray(request.removeSourceIds) ? request.removeSourceIds : [];
              const removeAllFromSource = request.removeAllFromSource === true;
              if (!actor || (!effectDocs.length && !removeSourceIds.length && !removeAllFromSource)) continue;
              applications.push({
                actor,
                effectDocs,
                removeSourceIds,
                removeAllFromSource,
                includeAutoApply: request.includeAutoApply === true,
                sourceItemUuid: String(request.sourceItemUuid ?? "").trim(),
              });
            }
            if (!applications.length) return;
            const applyApplications = async () => {
              for (const application of applications) {
                await applyLinkedEffectsToActor(application.actor, application.effectDocs);
                if (application.removeSourceIds.length || application.removeAllFromSource) {
                  await removeLinkedEffectsFromActor(
                    application.actor,
                    application.sourceItemUuid,
                    application.removeSourceIds,
                    { includeAutoApply: application.includeAutoApply },
                  );
                }
              }
            };
            const autoApply = !!game.settings.get("ffxiv", "autoApplySocketRequests");
            if (autoApply) {
              await applyApplications();
              break;
            }

            new foundry.applications.api.DialogV2({
              id: "gamemaster-socket-apply-linked-effects",
              window: {
                title: game.i18n.localize("FFXIV.Notifications.StatusChangeRequest"),
              },
              content: `<p>${game.i18n.format("FFXIV.Notifications.EffectRequest", { playerName: userName, effect: game.i18n.localize("FFXIV.Abilities.LinkedActiveEffects") })}</p>
                <ul>${applications.map(({ actor }) => `<li>${actor.name}</li>`).join("")}</ul>`,
              buttons: [
                {
                  label: game.i18n.localize("FFXIV.Sockets.Accept"),
                  action: "accept",
                  type: "submit",
                  callback: applyApplications,
                },
                {
                  label: game.i18n.localize("FFXIV.Sockets.Decline"),
                  action: "decline",
                  type: "submit",
                },
              ],
            }).render(true);
            break;
          }
          case "limitBreakSpend": {
            await consumeLimitBreakSegment();
            break;
          }
          default:
            debugError("socket error : type of request not found", type);
        }
      });
    }
  });
}
