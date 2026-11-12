import { debugError, debugLog } from "./debug.mjs";
import { emitToActiveGM } from "./socket.mjs";
import { renderAbilityApplications } from "./ability-targets.mjs";
import { maintainChatScroll, prepareChatRolls } from "./chat-message.mjs";
import { applyFFXIVChatTheme } from "./ui.mjs";
import {
  reverseAbilityApplication,
  requestAbilityApplication,
  requestAbilityActiveEffects,
  resolveChatAbilityItem,
} from "./ability-applications.mjs";
import {
  normalizeStatusEntry,
  applyStatusEntryToActor,
  getStatusLabelById,
  getStatusEntryNotificationKey,
  applyLinkedEffectsToActor,
  removeLinkedEffectsFromActor,
  parseJsonIdArray,
  parseJsonStatusEntries,
  parseJsonStatusApplications,
  getActorReference,
  resolveActorFromReference,
  setApplyStatusButtonState,
  getLinkedEffectApplyTo,
  buildLinkedActiveEffectDocs,
} from "./linked-effects.mjs";

export function shouldSuppressDefaultStatusText(text) {
  if (typeof text !== "string") return false;
  return (text.startsWith("+(") || text.startsWith("−(")) && text.endsWith(")");
}

function getStatusEffectEntriesForItem(item, element) {
  const embeddedEntries = parseStatusEntriesFromElement(element);
  const sourceEntries =
    Array.isArray(item?.system?.status_effects) &&
      item.system.status_effects.length
      ? item.system.status_effects
      : item?.system?.status_effect
        ? [
          {
            id: item.system.status_effect,
            action: item.system.status_action !== false,
            applyMode:
              item.system.status_apply_mode === "auto" ? "auto" : "manual",
            applyTo: "target",
          },
        ]
        : element?.dataset?.effectId
          ? [
            {
              id: element.dataset.effectId,
              action: element.dataset.action === "true",
              applyMode: "manual",
              applyTo: "target",
            },
          ]
          : [];

  const chosenEntries = sourceEntries.length ? sourceEntries : embeddedEntries;

  return chosenEntries
    .map((entry) => normalizeStatusEntry(entry, element?.dataset?.sourceUuid))
    .filter((entry) => entry.statusId && entry.applyMode !== "auto");
}

function parseStatusEntriesFromElement(element) {
  const raw = element?.dataset?.statusEntries;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    debugError("FFXIV | Failed to parse embedded status entries:", error);
    return [];
  }
}

export function registerChatMessageCreation() {
  Hooks.on("createChatMessage", async (message, _options, userId) => {
    if (userId !== game.user.id) return;
    if (message.getFlag("ffxiv", "selfAutoLinkedEffectsApplied")) return;

    const content = String(message.content ?? "");
    if (!content.includes("item-card")) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = content;
    const sourceElement =
      wrapper.querySelector(".ffxiv-apply-active-effects") ??
      wrapper.querySelector(".item-card[data-item-id]");
    if (!(sourceElement instanceof HTMLElement)) return;

    const item = await resolveChatAbilityItem(sourceElement);
    if (!item) return;
    const sourceActor = item.parent?.documentName === "Actor"
      ? item.parent
      : await resolveActorFromReference(
        sourceElement.dataset.actorUuid ?? sourceElement.dataset.actorId,
      );
    if (!sourceActor) return;

    const selfAutoEffects = Array.from(item.effects ?? []).filter(
      (effect) => !effect.disabled && getLinkedEffectApplyTo(effect) === "self_auto",
    );
    if (!selfAutoEffects.length) return;

    const isAddEffect = (effect) =>
      String(effect.getFlag("ffxiv", "applyAction") || "add") !== "remove";
    const isRemoveEffect = (effect) =>
      String(effect.getFlag("ffxiv", "applyAction") || "add") === "remove";
    const effectDocs = buildLinkedActiveEffectDocs(
      item,
      selfAutoEffects.filter(isAddEffect),
      { autoApply: true },
    );
    const removeSourceIds = selfAutoEffects
      .filter(isRemoveEffect)
      .map((effect) => effect.id)
      .filter(Boolean);
    if (!effectDocs.length && !removeSourceIds.length) return;

    if (sourceActor.testUserPermission(game.user, "OWNER")) {
      await applyLinkedEffectsToActor(sourceActor, effectDocs);
      if (removeSourceIds.length) {
        await removeLinkedEffectsFromActor(sourceActor, item.uuid, removeSourceIds, { includeAutoApply: true });
      }
      await message.setFlag("ffxiv", "selfAutoLinkedEffectsApplied", true);
      return;
    }

    const sent = emitToActiveGM({
      type: "applyLinkedEffects",
      data: {
        actorIds: [sourceActor.id],
        actorRefs: [getActorReference(sourceActor)],
        effectDocs,
        removeSourceIds,
        sourceItemUuid: item.uuid,
        includeAutoApply: true,
      },
      userName: game.user.name,
    });
    if (sent) {
      await message.setFlag("ffxiv", "selfAutoLinkedEffectsApplied", true);
    }
  });
}

export function registerChatMessageRendering() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    debugLog("renderChatMessageHTML hook");
    applyFFXIVChatTheme(html);

    maintainChatScroll(message.id);

    const jqueryhtml = $(html);
    const activeEffectRequest = message.getFlag("ffxiv", "activeEffectRequest");
    jqueryhtml.find(".ffxiv-apply-active-effects").prop("disabled", Boolean(activeEffectRequest));
    jqueryhtml.find(".ffxiv-active-effect-applications").remove();
    const activeEffectApplications = message.getFlag("ffxiv", "activeEffectApplications") ?? [];
    if (activeEffectApplications.length) {
      jqueryhtml.find(".message-content").first().append(
        `<div class="ffxiv-active-effect-applications">${renderAbilityApplications(activeEffectApplications, { pending: Boolean(activeEffectRequest) })}</div>`,
      );
    }
    const damageResolution = message.getFlag("ffxiv", "damageResolution");
    if (damageResolution) {
      const card = html.querySelector(".ffxiv-ability-damage");
      const row = card?.querySelector(".ffxiv-apply-ability-damage")?.closest(".ffxiv-chat-buttons");
      if (row && !card.querySelector("ffxiv-ability-targets")) {
        let first = row.previousElementSibling;
        while (first && !first.matches("hr")) first = first.previousElementSibling;
        if (first) {
          card.insertBefore(document.createElement("ffxiv-ability-targets"), first);
          for (let node = first; node;) {
            const next = node.nextSibling;
            if (node instanceof HTMLElement && node.classList.contains("ffxiv-chat-buttons") &&
              !node.querySelector(".ffxiv-apply-ability-damage, .ffxiv-apply-heal")) break;
            node.remove();
            node = next;
          }
        }
      }
      const unavailable = new Set([
        ...damageResolution.appliedTargets,
        ...damageResolution.pendingTargets,
      ]);
      if (damageResolution.targetsLocked || unavailable.size || damageResolution.healingApplied) {
        jqueryhtml.find(".ffxiv-roll-direct, .ffxiv-roll-critical, .ffxiv-roll-option-direct, .ffxiv-roll-critical-alternate")
          .prop("disabled", true);
      }
    }
    prepareChatRolls(message, html);
    jqueryhtml.on("click", '.dice-roll[data-action="expandRoll"]', (event) => {
      maintainChatScroll(message.id, { roll: event.currentTarget });
      event.currentTarget.setAttribute("aria-expanded", String(!event.currentTarget.classList.contains("expanded")));
    });
    jqueryhtml.on("keydown", '.dice-roll[data-action="expandRoll"]', (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.click();
    });

    jqueryhtml.find(".ffxiv-roll-base").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollBase(ev);
    });

    jqueryhtml.find(".ffxiv-roll-alternate").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollAlternate(ev);
    });

    jqueryhtml.find(".ffxiv-roll-hit").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollHit(ev);
    });

    jqueryhtml.find(".ffxiv-roll-direct").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollDirect(ev);
    });

    jqueryhtml.find(".ffxiv-roll-option-direct").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollOptionDirect(ev);
    });

    jqueryhtml.find(".ffxiv-roll-resource-bonus").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollJobResourceBonus(ev);
    });

    jqueryhtml.find(".ffxiv-roll-ability-branch").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollAbilityBranch(ev);
    });

    jqueryhtml.find(".ffxiv-show-ability-branch").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._showAbilityBranch(ev);
    });

    jqueryhtml.find(".ffxiv-roll-critical").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollCritical(ev);
    });

    jqueryhtml.find(".ffxiv-roll-critical-alternate").on("click", async (ev) => {
      const item = await resolveChatAbilityItem(ev.currentTarget);
      if (item) await item._rollCriticalAlternate(ev);
    });

    jqueryhtml.find(".ffxiv-show-modifiers").on("click", async (ev) => {
      debugLog("call show modifiers");
      const item = await resolveChatAbilityItem(ev.currentTarget);
      const actor = item?.parent?.documentName === "Actor"
        ? item.parent
        : await resolveActorFromReference(
          ev.currentTarget.dataset.actorUuid ??
          ev.currentTarget.dataset.actorId,
        );
      debugLog(actor);
      if (actor) actor._showModifiers(ev);
    });

    jqueryhtml.on("click", ".ffxiv-apply-heal, .ffxiv-apply-dmg, .ffxiv-apply-ability-damage", async (ev) => {
      await requestAbilityApplication(message, ev.currentTarget,
        ev.currentTarget.classList.contains("ffxiv-apply-heal") ? "heal" : "damage");
    });

    jqueryhtml.on("click", ".ffxiv-undo-application, .ffxiv-redo-application", async (ev) => {
      const button = ev.currentTarget;
      if (button.disabled || !game.user.isGM) return;
      button.disabled = true;
      try {
        await reverseAbilityApplication(message, button.dataset.applicationId, button.dataset.actorUuid, {
          redo: button.classList.contains("ffxiv-redo-application"),
          kind: button.dataset.kind,
        });
      } finally {
        button.disabled = false;
      }
    });

  jqueryhtml.find(".ffxiv-undo-status-effect").on("click", async (ev) => {
    ev.stopPropagation();
    const button = ev.currentTarget;
    const undoData = button.closest('.fxiv-status-effect-applied')?.dataset?.undoStatus;
    const undoId = button.closest('.fxiv-status-effect-applied')?.dataset?.undoId;
    if (!undoData || !undoId) return;

    try {
      const data = JSON.parse(undoData);
      const actor = await resolveActorFromReference(data.actorId);
      if (!actor) return;

      const entry = {
        statusId: data.statusId,
        active: false,
        stacks: data.stacks,
        sourceUuid: data.sourceUuid,
        applyTo: data.applyTo,
        allSources: true,
      };

      const applied = await applyStatusEntryToActor(actor, entry);
      if (applied) {
        const chatCard = button.closest('.chat-message');
        if (chatCard) {
          const message = game.messages.get(chatCard.dataset.messageId);
          if (message) {
            const effectLabel = data.stacks > 1 ? `${getStatusLabelById(data.statusId)} (${data.stacks})` : getStatusLabelById(data.statusId);
            const removedText = `<div class="effect fxiv-status-effect-applied"><span class="fxiv-status-effect-text"><strong>${effectLabel}</strong> removed from ${actor.name}.</span></div>`;

            // Use the unique ID to find and replace in message content
            const regex = new RegExp(`<div[^>]*data-undo-id="${undoId}"[^>]*>.*?</div>`, 's');
            const newContent = message.content.replace(regex, removedText);

            await message.update({
              content: newContent
            });
          }
        } else {
          const effectLabel = data.stacks > 1 ? `${getStatusLabelById(data.statusId)} (${data.stacks})` : getStatusLabelById(data.statusId);
          ui.notifications.info(
            game.i18n.format("FFXIV.Notifications.EffectRemoved", {
              effect: effectLabel,
              actor: actor.name,
            }),
          );
        }
      }
    } catch (err) {
      console.error("Failed to undo status effect:", err);
    }
  });

  jqueryhtml.find(".ffxiv-apply-status").on("click", async (ev) => {
      const button =
        ev.currentTarget instanceof HTMLButtonElement ? ev.currentTarget : null;
      const currentState = String(button?.dataset?.ffxivStatusState || "apply");
      if (currentState === "applied") {
        let applications = parseJsonStatusApplications(
          button?.dataset?.appliedStatusApplications,
        );
        if (!applications.length) {
          const actorIds = parseJsonIdArray(button?.dataset?.appliedActorIds);
          const statusEntries = parseJsonStatusEntries(
            button?.dataset?.appliedStatusEntries,
          );
          applications = actorIds.map((actorId) => ({
            actorId,
            entries: statusEntries,
          }));
        }
        applications = applications
          .map((application) => ({
            ...application,
            entries: application.entries.map((entry) => ({
              ...entry,
              active: entry.active === false,
            })),
          }))
          .filter((application) => application.entries.length);
        if (!applications.length) {
          setApplyStatusButtonState(button, false);
          return;
        }

        const socketApplications = [];
        const appliedEffects = [];
        for (const application of applications) {
          const actor = await resolveActorFromReference(application.actorId);
          if (!actor) continue;
          if (actor.testUserPermission(game.user, "OWNER")) {
            for (const entry of application.entries) {
              const applied = await applyStatusEntryToActor(actor, entry);
              if (applied) {
                const stacks = entry?.stacks ? Number.parseInt(entry.stacks, 10) : 1;
                const effectLabel = stacks > 1 ? `${getStatusLabelById(entry.statusId)} (${stacks})` : getStatusLabelById(entry.statusId);
                const key = getStatusEntryNotificationKey(entry);
                const isRemoved = key.includes('Removed');
                appliedEffects.push({
                  effect: effectLabel,
                  actor: actor.name,
                  isRemoved,
                  statusId: entry.statusId,
                  actorId: actor.uuid,
                  sourceUuid: entry.sourceUuid,
                  stacks: stacks,
                  applyTo: entry.applyTo,
                });
              }
            }
            continue;
          }
          socketApplications.push({
            actorId: actor.id,
            actorRef: getActorReference(actor),
            effects: application.entries,
          });
        }

        if (appliedEffects.length) {
          const chatCard = button.closest('.chat-message');
          if (chatCard) {
            const message = game.messages.get(chatCard.dataset.messageId);
            if (message) {
              const messageId = message.id;
              const effectText = appliedEffects
                .map(({ effect, actor, isRemoved, statusId, actorId, sourceUuid, stacks, applyTo }, index) =>
                  `<div class="effect fxiv-status-effect-applied" data-undo-id="${messageId}-${index}" data-undo-status='{"statusId":"${statusId}","actorId":"${actorId}","sourceUuid":"${sourceUuid}","stacks":${stacks},"applyTo":"${applyTo}"}'>
                  <span class="fxiv-status-effect-text"><strong>${effect}</strong> ${isRemoved ? 'removed from' : 'applied to'} ${actor}.</span>
                  <button class="ffxiv-undo-status-effect">
                    <i class="fas fa-undo"></i>
                  </button>
                </div>`
                )
                .join("");

              await message.update({
                content: message.content + `<div class="item-dialog-effects fxiv-status-effects">${effectText}</div>`
              });

              setTimeout(() => {
                const scrollContainer = chatCard.closest('.chat-log') ||
                                        chatCard.closest('#chat-log') ||
                                        document.querySelector('.chat-log') ||
                                        document.querySelector('#chat-log');

                if (scrollContainer) {
                  const previousScrollTop = scrollContainer.scrollTop;
                  const previousScrollHeight = scrollContainer.scrollHeight;
                  const wasNearBottom = previousScrollTop + scrollContainer.clientHeight >= previousScrollHeight - 10;

                  if (wasNearBottom) {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                  }
                }
              }, 50);
            }
          } else {
            for (const { effect, actor, isRemoved } of appliedEffects) {
              const key = isRemoved ? "FFXIV.Notifications.EffectRemoved" : "FFXIV.Notifications.EffectApplied";
              ui.notifications.info(
                game.i18n.format(key, {
                  effect,
                  actor,
                }),
              );
            }
          }
        }

        if (socketApplications.length) {
          const sent = emitToActiveGM({
            type: "applyEffect",
            data: { applications: socketApplications },
            userName: game.user.name,
          });
          if (!sent) return;
        }

        setApplyStatusButtonState(button, false);
        return;
      }

      const item = await resolveChatAbilityItem(ev.currentTarget);
      const statusEntries = getStatusEffectEntriesForItem(item, ev.currentTarget);
      if (!statusEntries.length) return;

      const selfEntries = statusEntries.filter((entry) => entry.applyTo === "self");
      const targetEntries = statusEntries.filter((entry) => entry.applyTo !== "self");
      const targets = Array.from(game.user.targets);

      if (targetEntries.length && targets.length === 0) {
        ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
        return;
      }

      const sourceActor = item?.parent?.documentName === "Actor"
        ? item.parent
        : await resolveActorFromReference(
          ev.currentTarget.dataset.actorUuid ?? ev.currentTarget.dataset.actorId,
        );
      const applications = [];
      const socketApplications = [];
      let sentSocketRequest = false;

      const applyEntries = async (actor, entries) => {
        if (!actor || !entries.length) return;
        const actorRef = getActorReference(actor);
        if (!actorRef) return;

        if (!actor.testUserPermission(game.user, "OWNER")) {
          socketApplications.push({
            actorId: actor.id,
            actorRef,
            effects: entries,
          });
          return;
        }

        let actorChanged = false;
        const appliedEffects = [];
        for (const entry of entries) {
          const applied = await applyStatusEntryToActor(actor, entry);
          if (applied) {
            actorChanged = true;
            const stacks = entry?.stacks ? Number.parseInt(entry.stacks, 10) : 1;
            const effectLabel = stacks > 1 ? `${getStatusLabelById(entry.statusId)} (${stacks})` : getStatusLabelById(entry.statusId);
            appliedEffects.push({
              effect: effectLabel,
              actor: actor.name,
              statusId: entry.statusId,
              actorId: actor.uuid,
              sourceUuid: entry.sourceUuid,
              stacks: stacks,
              applyTo: entry.applyTo,
            });
          }
        }
        if (actorChanged) {
          applications.push({ actorId: actorRef, entries });
          if (appliedEffects.length) {
            const chatCard = ev.currentTarget.closest('.chat-message');
            if (chatCard) {
              const message = game.messages.get(chatCard.dataset.messageId);
              if (message) {
                const messageId = message.id;
                const effectText = appliedEffects
                  .map(({ effect, actor, statusId, actorId, sourceUuid, stacks, applyTo }, index) =>
                    `<div class="effect fxiv-status-effect-applied" data-undo-id="${messageId}-${index}" data-undo-status='{"statusId":"${statusId}","actorId":"${actorId}","sourceUuid":"${sourceUuid}","stacks":${stacks},"applyTo":"${applyTo}"}'>
                    <span class="fxiv-status-effect-text"><strong>${effect}</strong> applied to ${actor}.</span>
                    <button class="ffxiv-undo-status-effect">
                      <i class="fas fa-undo"></i>
                    </button>
                  </div>`
                  )
                  .join("");

                await message.update({
                  content: message.content + `<div class="item-dialog-effects fxiv-status-effects">${effectText}</div>`
                });

                setTimeout(() => {
                  const scrollContainer = chatCard.closest('.chat-log') ||
                                          chatCard.closest('#chat-log') ||
                                          document.querySelector('.chat-log') ||
                                          document.querySelector('#chat-log');

                  if (scrollContainer) {
                    const previousScrollTop = scrollContainer.scrollTop;
                    const previousScrollHeight = scrollContainer.scrollHeight;
                    const wasNearBottom = previousScrollTop + scrollContainer.clientHeight >= previousScrollHeight - 10;

                    if (wasNearBottom) {
                      scrollContainer.scrollTop = scrollContainer.scrollHeight;
                    }
                  }
                }, 50);
              }
            } else {
              for (const { effect, actor } of appliedEffects) {
                ui.notifications.info(
                  game.i18n.format("FFXIV.Notifications.EffectApplied", {
                    effect,
                    actor,
                  }),
                );
              }
            }
          }
        }
      };

      if (selfEntries.length) await applyEntries(sourceActor, selfEntries);
      if (targetEntries.length) {
        debugLog("Apply status effects", targetEntries);
        for (const token of targets) {
          await applyEntries(token.actor, targetEntries);
        }
      }

      if (socketApplications.length) {
        sentSocketRequest = emitToActiveGM({
          type: "applyEffect",
          data: { applications: socketApplications },
          userName: game.user.name,
        });
        if (sentSocketRequest) {
          for (const application of socketApplications) {
            applications.push({
              actorId: application.actorRef,
              entries: application.effects,
            });
          }
        }
      }

      if (sentSocketRequest) {
        ui.notifications.info(
          game.i18n.localize("FFXIV.Notifications.SendSocket"),
        );
      }

      if (applications.length) {
        setApplyStatusButtonState(button, true, {
          actorIds: applications.map((application) => application.actorId),
          statusEntries,
          applications,
        });
      }
    });

    jqueryhtml.find(".ffxiv-apply-active-effects").on("click", async (ev) => {
      const button = ev.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      try {
        await requestAbilityActiveEffects(message, button);
      } finally {
        button.disabled = false;
      }
    });
  });
}
