import { getEffectStackCount, getEffectStackKey } from "./helpers/stacking.mjs";

export class FFXIVActiveEffect extends ActiveEffect {
  prepareBaseData() {
    const stacks = getEffectStackKey(this) ? getEffectStackCount(this) : 1;
    if (getEffectStackKey(this) && this._source.system?.changes) {
      this.system.changes = this._source.system.changes.flatMap((change) =>
        Array.from({ length: change.key?.startsWith("system.") ? stacks : 1 }, () => foundry.utils.deepClone(change)),
      );
      this.constructor._shimChanges(this.system.changes);
    }
    super.prepareBaseData();
  }

  getReplacementData(baseData) {
    const sourceItem = this._getSourceItem();
    if (!sourceItem) return super.getReplacementData(baseData);
    const sourceSystem = sourceItem.system?.toObject?.() ?? {};

    return {
      ...super.getReplacementData(baseData),
      sourceItem: {
        id: sourceItem.id,
        name: sourceItem.name,
        type: sourceItem.type,
        system: sourceSystem,
      },
    };
  }

  _getSourceItem() {
    if (this.parent?.documentName === "Item") return this.parent;

    const sourceItemId = String(
      this.getFlag("ffxiv", "linkedSourceItemId") ?? "",
    ).trim();
    if (sourceItemId && this.parent?.documentName === "Actor") {
      const sourceItem = this.parent.items.get(sourceItemId);
      if (sourceItem) return sourceItem;
    }

    const references = [
      this.getFlag("ffxiv", "linkedSourceItemUuid"),
      this.origin,
    ];
    for (const reference of references) {
      const uuid = String(reference ?? "").trim();
      if (!uuid) continue;
      let sourceItem;
      try {
        sourceItem = fromUuidSync(uuid);
      } catch {
        continue;
      }
      if (sourceItem?.documentName === "Item") return sourceItem;
    }

    return null;
  }
}
