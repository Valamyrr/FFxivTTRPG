import {
  applyStatusEffectChange,
  canActorRecover,
  getHighestStatusStackCount,
} from "./helpers/status-effects.mjs";
import {
  fillActorJobResource,
  findActorTrait,
  normalizeJobResourceName,
} from "./helpers/job-resources.mjs";

const ADVENTURER_STEP_MP_RECOVERY = 2;

const STEP_END_STATUS_ICONS = {
  dot: "systems/ffxiv/assets/effects/dot.webp",
  revivify: "systems/ffxiv/assets/effects/revivify.webp",
};

export function getTurnStep(combatant) {
  const actorType = combatant?.actor?.type;
  const disposition = combatant?.token?.disposition;
  if (actorType === "character" || actorType === "pet") return 0;
  if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return 0;
  return 1;
}

export class FFXIVCombat extends Combat {
  /** @override */
  async startCombat() {
    return this._withActorSheetScroll(async () => {
      this._ffxivResolvedStepEnds = new Set();
      await this._confirmResetLimitations();
      await this._resetEncounterStatusFlags();
      const startedCombat = await super.startCombat();
      await this._applyStartingMpOverrides();
      await this._applyEncounterStartJobAutomation();
      return startedCombat;
    });
  }

  /** @override */
  _sortCombatants(a, b) {
    const stepDifference = getTurnStep(a) - getTurnStep(b);
    if (stepDifference !== 0) return stepDifference;

    const orderA = Number(a.initiative);
    const orderB = Number(b.initiative);
    const hasOrderA = Number.isFinite(orderA);
    const hasOrderB = Number.isFinite(orderB);
    if (hasOrderA && hasOrderB && orderA !== orderB) return orderA - orderB;
    if (hasOrderA !== hasOrderB) return hasOrderA ? -1 : 1;

    return String(a.name ?? "").localeCompare(
      String(b.name ?? ""),
      game.i18n.lang,
    );
  }

  /** @override */
  async rollInitiative(ids, options = {}) {
    const requested = new Set(Array.isArray(ids) ? ids : [ids]);
    const combatants = this.combatants
      .filter((combatant) => requested.has(combatant.id))
      .sort(this._sortCombatants.bind(this));
    if (!combatants.length) return this;

    const nextOrder = new Map();
    const updates = combatants.map((combatant) => {
      const step = getTurnStep(combatant);
      if (!nextOrder.has(step)) {
        nextOrder.set(step, this._getNextTurnOrder(step, requested));
      }
      const initiative = nextOrder.get(step);
      nextOrder.set(step, initiative + 1);
      return { _id: combatant.id, initiative };
    });

    await this.updateEmbeddedDocuments("Combatant", updates, options);
    return this;
  }

  async reorderCombatant(combatantId, direction) {
    const combatant = this.combatants.get(combatantId);
    if (!combatant) return this;

    const step = getTurnStep(combatant);
    const stepCombatants = this.turns.filter(
      (entry) => getTurnStep(entry) === step,
    );
    const currentIndex = stepCombatants.findIndex(
      (entry) => entry.id === combatant.id,
    );
    const targetIndex = currentIndex + Math.sign(Number(direction));
    if (
      currentIndex === -1 ||
      targetIndex < 0 ||
      targetIndex >= stepCombatants.length
    )
      return this;

    const reordered = stepCombatants.slice();
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    const usedOrders = stepCombatants
      .map((entry) => Number(entry.initiative))
      .filter(Number.isFinite);
    const firstOrder = usedOrders.length ? Math.min(...usedOrders) : 1;
    const updates = reordered.map((entry, index) => ({
      _id: entry.id,
      initiative: firstOrder + index,
    }));

    await this.updateEmbeddedDocuments("Combatant", updates);
    return this;
  }

  /** @override */
  async nextTurn() {
    return this._withActorSheetScroll(async () => {
      await this._resolveCurrentStepEnd();
      this._ffxivAdvancingTurn = true;
      try {
        return await super.nextTurn();
      } finally {
        this._ffxivAdvancingTurn = false;
      }
    });
  }

  /** @override */
  async previousTurn() {
    return this._withActorSheetScroll(() => super.previousTurn());
  }

  /** @override */
  async nextRound() {
    return this._withActorSheetScroll(async () => {
      if (!this._ffxivAdvancingTurn) await this._resolveRemainingStepEnds();
      return super.nextRound();
    });
  }

  /** @override */
  async previousRound() {
    return this._withActorSheetScroll(() => super.previousRound());
  }

  /** @override */
  async _onEndTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onEndTurn(combatant, context);
      if (combatant?.actor) await this._removeTurnEndStatuses(combatant.actor);
      if (combatant?.actor?.type !== "character") return;
      await this._removeInvokingStatus(combatant.actor);
    });
  }

  /** @override */
  async _onStartTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onStartTurn(combatant, context);
      if (combatant?.actor) await this._removeTurnStartStatuses(combatant.actor);
      if (combatant?.actor?.type !== "npc") return;
      await this._removeInvokingStatus(combatant.actor);
    });
  }

  async _removeInvokingStatus(actor) {
    if (!actor.statuses?.has("invoking")) return;
    await actor.toggleStatusEffect("invoking", {
      active: false,
      render: false,
    });
  }

  async _removeTurnStartStatuses(actor) {
    await applyStatusEffectChange(actor, "transcendent", false);
  }

  async _removeTurnEndStatuses(actor) {
    await this._deleteStatuses(actor, [
      "drain",
      "enmity",
      "heavy",
      "paralysis",
      "silence",
    ]);
  }

  async _resolveCurrentStepEnd() {
    const combatant = this.combatant;
    if (!combatant || !this._isLastCombatantInStep(combatant)) return;
    await this._resolveStepEndOnce(getTurnStep(combatant));
  }

  async _resolveRemainingStepEnds() {
    const round = this.round;
    const steps = this._getCombatSteps();
    const currentStep = this.combatant ? getTurnStep(this.combatant) : steps[0];
    for (const step of steps) {
      if (step < currentStep) continue;
      await this._resolveStepEndOnce(step, round);
    }
  }

  _getCombatSteps() {
    return Array.from(
      new Set(this.combatants.map((combatant) => getTurnStep(combatant))),
    ).sort((a, b) => a - b);
  }

  _isLastCombatantInStep(combatant) {
    const step = getTurnStep(combatant);
    const stepCombatants = this.turns.filter(
      (entry) => getTurnStep(entry) === step,
    );
    return stepCombatants[stepCombatants.length - 1]?.id === combatant.id;
  }

  async _resolveStepEnd(step) {
    const actors = this._getStepActors(step);
    if (!actors.length) return;

    const updates = [];
    const messages = [];
    const updatedActorIds = new Set();
    for (const actor of actors) {
      const result = this._getStepEndHealthResult(actor, step);
      if (!result.changed && !result.statusEffectsResolved) continue;
      if (result.changed) {
        updatedActorIds.add(actor.id);
        const updateData = {};
        if (result.nextHealth !== result.currentHealth) {
          updateData["system.health.value"] = result.nextHealth;
        }
        if (result.nextBarrier !== result.currentBarrier) {
          updateData["system.barrier.value"] = result.nextBarrier;
        }
        if (result.nextMana !== result.currentMana) {
          updateData["system.mana.value"] = result.nextMana;
        }
        updates.push((async () => {
          await actor.update(updateData, {
            render: false,
            ffxivSkipActorSheetRefresh: true,
            ffxivSkipKnockedOutSync: true,
          });
          if (result.currentHealth > 0 && result.nextHealth <= 0) {
            await applyStatusEffectChange(actor, "knocked_out", true);
          }
        })());
      }
      if (this._shouldReportStepEndResult(result)) {
        messages.push({ actor, ...result });
      }
    }

    await this._removeStepEndStatuses();
    if (!updates.length && !messages.length) return;
    if (updates.length) {
      await Promise.all(updates);
      await this._refreshActorSheets(
        this._captureActorSheetScroll(),
        updatedActorIds,
      );
    }
    await this._createStepEndStatusMessage(step, messages);
  }

  async _resolveStepEndOnce(step, round = this.round) {
    this._ffxivResolvedStepEnds ??= new Set();
    const key = this._getResolvedStepEndKey(step, round);
    if (this._ffxivResolvedStepEnds.has(key)) return;
    this._ffxivResolvedStepEnds.add(key);
    try {
      await this._resolveStepEnd(step);
    } catch (error) {
      this._ffxivResolvedStepEnds.delete(key);
      throw error;
    }
  }

  _getResolvedStepEndKey(step, round = this.round) {
    return `${this.id ?? this.uuid ?? "combat"}:${round ?? 0}:${step}`;
  }

  _shouldReportStepEndResult(result) {
    if (result.currentHealth <= 0 && result.nextHealth <= 0) return false;
    return result.statusEffectsResolved;
  }

  _getStepActors(step) {
    const actors = new Map();
    for (const combatant of this.combatants) {
      if (getTurnStep(combatant) !== step) continue;
      const actor = combatant.actor;
      const actorRef = actor?.uuid ?? actor?.id;
      if (!actor || actors.has(actorRef)) continue;
      actors.set(actorRef, actor);
    }
    return Array.from(actors.values());
  }

  _getStepEndHealthResult(actor, step) {
    const currentHealth = Number(actor.system?.health?.value ?? 0);
    const currentBarrier = Math.max(Number(actor.system?.barrier?.value) || 0, 0);
    const currentMana = Number(actor.system?.mana?.value ?? 0);
    const maxMana = Number(actor.system?.mana?.max);
    const manaCap = Number.isFinite(maxMana) && maxMana > 0 ? maxMana : 5;
    const maxHealth = Number(actor.system?.health?.max);
    const healthCap = Number.isFinite(maxHealth) && maxHealth > 0
      ? maxHealth
      : Number.POSITIVE_INFINITY;
    const dotDamage = getHighestStatusStackCount(actor, "dot");
    const revivifyHealing = getHighestStatusStackCount(actor, "revivify");
    const availableRevivifyHealing = canActorRecover(actor)
      ? revivifyHealing
      : 0;
    const dotFirstResult = this._applyStepEndDOT(
      currentHealth,
      currentBarrier,
      dotDamage,
    );
    const isAdventurerStep = step === 0;
    const dotWouldKnockOut = dotFirstResult.nextHealth <= 0 &&
      dotFirstResult.healthDamage > 0;
    const revivifyWouldFill = availableRevivifyHealing > 0 &&
      currentHealth + availableRevivifyHealing >= healthCap;
    const dotAfterRevivify = isAdventurerStep
      ? dotWouldKnockOut
      : revivifyWouldFill;

    let nextHealth = currentHealth;
    let nextBarrier = currentBarrier;
    let resolvedRevivifyHealing = 0;
    let nextMana = currentMana;
    let manaRecovery = 0;

    if (dotAfterRevivify) {
      if (availableRevivifyHealing > 0) {
        nextHealth = this._applyStepEndRevivify(
          nextHealth,
          availableRevivifyHealing,
          healthCap,
        );
        resolvedRevivifyHealing = availableRevivifyHealing;
      }
      const dotResult = this._applyStepEndDOT(nextHealth, nextBarrier, dotDamage);
      nextHealth = dotResult.nextHealth;
      nextBarrier = dotResult.nextBarrier;
    } else {
      nextHealth = dotFirstResult.nextHealth;
      nextBarrier = dotFirstResult.nextBarrier;
      if (availableRevivifyHealing > 0 && !dotWouldKnockOut) {
        nextHealth = this._applyStepEndRevivify(
          nextHealth,
          availableRevivifyHealing,
          healthCap,
        );
        resolvedRevivifyHealing = availableRevivifyHealing;
      }
    }

    if (isAdventurerStep && actor.type === "character" && canActorRecover(actor)) {
      manaRecovery = this._getAdventurerStepMpRecovery(actor);
      if (manaRecovery > 0) nextMana = Math.min(currentMana + manaRecovery, manaCap);
      manaRecovery = Math.max(nextMana - currentMana, 0);
    }

    const changed =
      nextHealth !== currentHealth ||
      nextBarrier !== currentBarrier ||
      nextMana !== currentMana;
    const statusEffectsResolved = changed ||
      (dotDamage > 0 && resolvedRevivifyHealing > 0);

    return {
      changed,
      statusEffectsResolved,
      currentHealth,
      nextHealth,
      currentBarrier,
      nextBarrier,
      currentMana,
      nextMana,
      dotDamage,
      revivifyHealing: resolvedRevivifyHealing,
      manaRecovery,
      dotAfterRevivify,
    };
  }

  _getAdventurerStepMpRecovery(actor) {
    let recovery = ADVENTURER_STEP_MP_RECOVERY;
    let multiplier = 1;
    let override = null;
    let suppressed = false;

    for (const effect of actor?.allApplicableEffects?.() ?? []) {
      if (!effect || effect.disabled) continue;

      const data = foundry.utils.getProperty(effect, "flags.ffxiv.mpRecovery") ?? {};
      if (data.suppress === true) suppressed = true;
      const flat = Number(data.flat);
      if (Number.isFinite(flat)) recovery += flat;
      const mult = Number(data.mult);
      if (Number.isFinite(mult)) multiplier *= mult;
      const overrideValue = Number(data.override);
      if (Number.isFinite(overrideValue)) override = overrideValue;

      for (const change of effect.changes ?? []) {
        const key = String(change?.key ?? "").trim().toLowerCase();
        if (!key.startsWith("flags.ffxiv.mprecovery.")) continue;

        const mode = this._normalizeActiveEffectChangeMode(change?.mode);
        const rawValue = String(change?.value ?? "").trim();
        const value = Number(rawValue);
        if (key === "flags.ffxiv.mprecovery.suppress") {
          suppressed ||= ["true", "1", "yes"].includes(rawValue.toLowerCase());
          continue;
        }
        if (!Number.isFinite(value)) continue;

        if (key === "flags.ffxiv.mprecovery.flat") {
          if (mode === "multiply") recovery *= value;
          else if (mode === "override") recovery = value;
          else if (mode === "subtract") recovery -= value;
          else recovery += value;
        }
        if (key === "flags.ffxiv.mprecovery.mult") {
          if (mode === "add") multiplier += value;
          else if (mode === "override") multiplier = value;
          else if (mode === "subtract") multiplier -= value;
          else multiplier *= value;
        }
        if (key === "flags.ffxiv.mprecovery.override") {
          override = value;
        }
      }
    }

    if (suppressed) return 0;
    const total = override === null ? recovery * multiplier : override;
    return Math.max(Math.floor(total), 0);
  }

  _normalizeActiveEffectChangeMode(mode) {
    if (typeof mode === "string" && mode) return mode.toLowerCase();
    const legacy = Number.parseInt(mode, 10);
    switch (legacy) {
      case 1:
        return "multiply";
      case 2:
        return "add";
      case 5:
        return "override";
      default:
        return "add";
    }
  }

  _applyStepEndDOT(health, barrier, damage) {
    const barrierDamage = Math.min(barrier, damage);
    const healthDamage = Math.max(damage - barrier, 0);
    return {
      nextHealth: Math.max(health - healthDamage, 0),
      nextBarrier: barrier - barrierDamage,
      healthDamage,
    };
  }

  _applyStepEndRevivify(health, healing, healthCap) {
    return Math.max(0, Math.min(health + healing, healthCap));
  }

  async _removeStepEndStatuses() {
    const actors = this._getStepActors(0).concat(this._getStepActors(1));
    for (const actor of actors) {
      await this._deleteStatuses(actor, ["enmity"]);
    }
  }

  async _deleteStatuses(actor, statusIds) {
    if (!actor?.effects?.size) return;
    const statusSet = new Set(statusIds);
    const ids = actor.effects
      .filter((effect) => {
        const statuses = effect?.statuses;
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
  }

  async _createStepEndStatusMessage(step, results) {
    if (!results.length) return;
    const stepLabel = step === 0
      ? game.i18n.localize("FFXIV.Combat.AdventurerStep")
      : game.i18n.localize("FFXIV.Combat.EnemyStep");
    const rows = results.map((result) => {
      const parts = [];
      if (result.revivifyHealing > 0 && result.dotAfterRevivify) {
        parts.push(
          this._formatStepEndStatusEffect("revivify", result.revivifyHealing),
        );
      }
      if (result.dotDamage > 0) {
        parts.push(this._formatStepEndStatusEffect("dot", result.dotDamage));
      }
      if (result.revivifyHealing > 0 && !result.dotAfterRevivify) {
        parts.push(
          this._formatStepEndStatusEffect("revivify", result.revivifyHealing),
        );
      }
      const resourceChanges = [];
      if (result.nextHealth !== result.currentHealth) {
        resourceChanges.push(`${result.currentHealth} -> ${result.nextHealth}`);
      }
      if (result.nextBarrier !== result.currentBarrier) {
        resourceChanges.push(`${game.i18n.localize("FFXIV.Health.barrier")} ${result.currentBarrier} -> ${result.nextBarrier}`);
      }
      if (result.nextMana !== result.currentMana) {
        resourceChanges.push(`${game.i18n.localize("FFXIV.Mana.long")} ${result.currentMana} -> ${result.nextMana}`);
      }
      if (!resourceChanges.length) {
        resourceChanges.push(`${result.currentHealth} -> ${result.nextHealth}`);
      }
      const effectsText = parts.length ? `${parts.join(", ")} ` : "";
      return `<li><strong>${result.actor.name}</strong>: ${effectsText}(${resourceChanges.join(", ")})</li>`;
    }).join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ scene: canvas?.scene }),
      flavor: game.i18n.format("FFXIV.Combat.StepEndStatusEffects", {
        step: stepLabel,
      }),
      content: `<ul class="ffxiv-step-status-results">${rows}</ul>`,
    });
  }

  _formatStepEndStatusEffect(statusId, amount) {
    const icon = STEP_END_STATUS_ICONS[statusId];
    const labelKey = statusId === "revivify"
      ? "FFXIV.Effects.Revivify"
      : "FFXIV.Effects.DOT";
    const label = game.i18n.localize(labelKey);
    const classes = `ffxiv-step-status-effect ffxiv-step-status-${statusId}`;
    return `<span class="${classes}"><img src="${icon}" alt="${label}" title="${label}" />${amount}</span>`;
  }

  _getNextTurnOrder(step, excludedIds) {
    const used = this.combatants
      .filter(
        (combatant) =>
          getTurnStep(combatant) === step && !excludedIds.has(combatant.id),
      )
      .map((combatant) => Number(combatant.initiative))
      .filter(Number.isFinite);
    return used.length ? Math.max(...used) + 1 : 1;
  }

  async _applyStartingMpOverrides() {
    const characterActors = new Map();
    for (const combatant of this.combatants) {
      const actor = combatant?.actor;
      if (!actor || actor.type !== "character" || characterActors.has(actor.id))
        continue;
      characterActors.set(actor.id, actor);
    }

    for (const actor of characterActors.values()) {
      const override = this._getStartingMpOverride(actor);
      if (!Number.isFinite(override)) continue;
      await actor.update({ "system.mana.value": override });
    }
  }

  _getStartingMpOverride(actor) {
    let highestOverride = null;
    for (const item of actor.items) {
      if (item.type !== "augment") continue;
      if (item.system.equipped !== true) continue;

      const overrideValue = item.system.starting_mp_override;
      if (
        overrideValue === null ||
        overrideValue === undefined ||
        overrideValue === ""
      )
        continue;
        
      const numericOverride = Number(overrideValue);
      if (!Number.isFinite(numericOverride)) continue;

      highestOverride =
        highestOverride === null
          ? numericOverride
          : Math.max(highestOverride, numericOverride);
    }
    return highestOverride;
  }

  async _applyEncounterStartJobAutomation() {
    const actors = this._getUniqueCombatActors();
    for (const actor of actors.values()) {
      if (findActorTrait(actor, "Deep Meditation")) {
        await fillActorJobResource(actor, "Chakra", { render: false });
      }
      if (findActorTrait(actor, "Sect Mastery")) {
        await this._grantEncounterFormlessFist(actor);
      }
    }
  }

  _getUniqueCombatActors() {
    const actors = new Map();
    for (const combatant of this.combatants) {
      const actor = combatant?.actor;
      const actorRef = actor?.uuid ?? actor?.id;
      if (!actor || actors.has(actorRef)) continue;
      actors.set(actorRef, actor);
    }
    return actors;
  }

  async _grantEncounterFormlessFist(actor) {
    await this._removeActorNamedEffects(actor, [
      "opo_opo_form",
      "raptor_form",
      "coeurl_form",
      "formless_fist",
    ]);

    const trait = findActorTrait(actor, "Formless Fist") ?? findActorTrait(actor, "Sect Mastery");
    const icon =
      trait?.img ??
      "modules/ffxiv-ttrpg-icons-pack/ffxiv/icons/MNK/FormlessFist.webp";
    const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    const effectData = {
      name: "Formless Fist",
      img: icon,
      icon,
      origin: trait?.uuid ?? "",
      disabled: false,
      transfer: false,
      statuses: [],
      displayStatusIcon: false,
      showIcon: showAlways,
      flags: {
        ffxiv: {
          abilityEffectRule: true,
          effectKey: "formless_fist",
          sourceItemUuid: trait?.uuid ?? "",
          check: {
            advantage: {
              amount: 1,
              tags: ["FFXIV.Tags.Physical"],
            },
          },
        },
      },
      duration: this._getEncounterEffectDuration(2),
    };
    await actor.createEmbeddedDocuments("ActiveEffect", [effectData], {
      render: false,
    });
  }

  _getEncounterEffectDuration(turns) {
    const duration = {
      turns,
      startTime: game.time?.worldTime ?? null,
      combat: this.id,
      startRound: this.round ?? null,
      startTurn: this.turn ?? null,
    };
    return duration;
  }

  async _removeActorNamedEffects(actor, keys) {
    if (!actor?.effects?.size) return;
    const normalizedKeys = new Set(keys.map((key) => normalizeJobResourceName(key)));
    const ids = actor.effects
      .filter((effect) => {
        if (!effect || effect.disabled) return false;
        const key =
          effect.getFlag?.("ffxiv", "effectKey") ??
          foundry.utils.getProperty(effect, "flags.ffxiv.effectKey") ??
          effect.name;
        return normalizedKeys.has(normalizeJobResourceName(key));
      })
      .map((effect) => effect.id)
      .filter(Boolean);
    if (ids.length)
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {
        render: false,
        ffxivSuppressRemovalText: true,
      });
  }

  async _resetEncounterStatusFlags() {
    const actors = this._getUniqueCombatActors();
    for (const actor of actors.values()) {
      if (actor.getFlag("ffxiv", "stunnedInEncounter") !== undefined) {
        await actor.unsetFlag("ffxiv", "stunnedInEncounter");
      }
    }
  }

  async _confirmResetLimitations() {
    if (!game.user.isGM) return;
    if (!this._hasLimitedAbilities()) return;

    const confirmed = await foundry.applications.api.DialogV2.wait({
      id: `ffxiv-reset-limitations-${this.id}`,
      window: { title: game.i18n.localize("FFXIV.Dialogs.ResetLimitationsTitle") },
      content: `<p>${game.i18n.localize("FFXIV.Dialogs.ResetLimitations")}</p>`,
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "yes",
          type: "submit",
          default: true,
          callback: () => true,
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "no",
          type: "cancel",
          callback: () => false,
        },
      ],
    });

    if (confirmed) await this._resetActorLimitations();
  }

  _hasLimitedAbilities() {
    return game.actors.filter((actor) =>
      actor.items.filter((item) => this._hasLimitations(item)).length > 0,
    ).length > 0;
  }

  async _resetActorLimitations() {
    const sheets = this._captureActorSheetScroll();
    const updatedActors = new Set();
    for (const actor of game.actors) {
      const updates = [];
      for (const item of actor.items) {
        if (!this._hasLimitations(item)) continue;

        const max = Number.parseInt(item.system.limitations_max, 10);
        const limitationsStatus = new Array(max).fill(false);
        const currentStatus = Array.isArray(item.system.limitations_status)
          ? item.system.limitations_status.slice(0, max)
          : [];
        while (currentStatus.length < max) currentStatus.push(false);
        if (currentStatus.every((status) => !status)) continue;

        updates.push({
          _id: item.id,
          "system.limitations_status": limitationsStatus,
        });
      }

      if (updates.length) {
        updatedActors.add(actor.id);
        await actor.updateEmbeddedDocuments("Item", updates, {
          render: false,
          ffxivSkipActorSheetRefresh: true,
        });
      }
    }

    await this._refreshActorSheets(sheets, updatedActors);
  }

  _hasLimitations(item) {
    if (item.type !== "ability") return false;
    const max = Number.parseInt(item.system?.limitations_max, 10);
    return Number.isFinite(max) && max > 0;
  }

  async _withActorSheetScroll(operation) {
    const sheets = this._captureActorSheetScroll();
    try {
      return await operation();
    } finally {
      this._restoreActorSheetScroll(sheets);
    }
  }

  _captureActorSheetScroll() {
    const apps = new Set([
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ]);
    for (const actor of game.actors) {
      for (const app of Object.values(actor.apps ?? {})) {
        apps.add(app);
      }
    }

    return Array.from(apps)
      .filter((app) => app.rendered && app.actor?.documentName === "Actor")
      .map((app) => {
        app._captureSheetScroll?.();
        return {
          sheet: app,
          scroll: foundry.utils.deepClone(app._pendingSheetScrollPositions ?? []),
        };
      });
  }

  async _refreshActorSheets(sheets, actorIds) {
    for (const { sheet, scroll } of sheets) {
      if (!actorIds.has(sheet.actor?.id)) continue;
      sheet._pendingSheetScrollPositions = foundry.utils.deepClone(scroll);
      await sheet.render({ force: true, focus: false });
      this._restoreActorSheetScroll([{ sheet, scroll }]);
    }
  }

  _restoreActorSheetScroll(sheets) {
    for (const { sheet, scroll } of sheets) {
      if (!scroll?.length) continue;
      const pending = foundry.utils.deepClone(scroll);
      sheet._pendingSheetScrollPositions = pending;
      const restore = () => {
        this._applyActorSheetScroll(sheet, scroll);
      };
      requestAnimationFrame(() => {
        restore();
        setTimeout(restore, 50);
        setTimeout(restore, 150);
        setTimeout(() => {
          restore();
          if (sheet._pendingSheetScrollPositions === pending) {
            sheet._pendingSheetScrollPositions = null;
          }
        }, 300);
      });
    }
  }

  _applyActorSheetScroll(sheet, scroll) {
    for (const position of scroll) {
      const root = sheet.element;
      const element = root?.matches?.(position.selector)
        ? root
        : root?.querySelector(position.selector);
      if (!element) continue;
      element.scrollTop = position.scrollTop;
      element.scrollLeft = position.scrollLeft;
    }
  }
}
