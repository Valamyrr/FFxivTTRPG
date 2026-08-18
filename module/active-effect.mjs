export class FFXIVActiveEffect extends ActiveEffect {
  getReplacementData(baseData) {
    const sourceItem = this._getSourceItem();
    if (!sourceItem) return super.getReplacementData(baseData);
    const sourceData = sourceItem.toObject(false);

    return {
      ...super.getReplacementData(baseData),
      sourceItem: {
        id: sourceItem.id,
        name: sourceItem.name,
        type: sourceItem.type,
        system: sourceData.system ?? {},
      },
    };
  }

  _getSourceItem() {
    if (this.parent?.documentName === "Item") return this.parent;

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

    const sourceItemId = String(
      this.getFlag("ffxiv", "linkedSourceItemId") ?? "",
    ).trim();
    if (sourceItemId && this.parent?.documentName === "Actor") {
      return this.parent.items.get(sourceItemId) ?? null;
    }

    return null;
  }
}
