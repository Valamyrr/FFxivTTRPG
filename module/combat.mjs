function getTurnStep(combatant) {
  const actorType = combatant?.actor?.type;
  const disposition = combatant?.token?.disposition;
  if (actorType === "character" || actorType === "pet") return 0;
  if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return 0;
  return 1;
}

export class FFXIVCombat extends Combat {
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

    return String(a.name ?? "").localeCompare(String(b.name ?? ""), game.i18n.lang);
  }

  /** @override */
  async rollInitiative(ids, options = {}) {
    const requested = new Set(Array.isArray(ids) ? ids : [ids]);
    const combatants = this.combatants
      .filter(combatant => requested.has(combatant.id))
      .sort(this._sortCombatants.bind(this));
    if (!combatants.length) return this;

    const nextOrder = new Map();
    const updates = combatants.map(combatant => {
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

  /** @override */
  async _onEndTurn(combatant, context) {
    await super._onEndTurn(combatant, context);
    if (combatant?.actor?.type !== "character") return;
    await this._removeInvokingStatus(combatant.actor);
  }

  /** @override */
  async _onStartTurn(combatant, context) {
    await super._onStartTurn(combatant, context);
    if (combatant?.actor?.type !== "npc") return;
    await this._removeInvokingStatus(combatant.actor);
  }

  async _removeInvokingStatus(actor) {
    if (!actor.statuses?.has("invoking")) return;
    await actor.toggleStatusEffect("invoking", { active: false });
  }

  _getNextTurnOrder(step, excludedIds) {
    const used = this.combatants
      .filter(combatant => getTurnStep(combatant) === step && !excludedIds.has(combatant.id))
      .map(combatant => Number(combatant.initiative))
      .filter(Number.isFinite);
    return used.length ? Math.max(...used) + 1 : 1;
  }
}
