export class FFXIVTokenDocument extends foundry.documents.TokenDocument {
  static async _preUpdateOperation(documents, operation, user) {
    const allowed = await super._preUpdateOperation(documents, operation, user);
    if (allowed === false) return false;
    if (!operation._regionUpdates) return;

    for (const token of documents) {
      const movement = operation._movement?.[token.id];
      const from = token.getMovementOrigin(movement?.origin ?? token._source);
      const to = movement
        ? token.getMovementOrigin(movement.destination)
        : from;
      for (const region of token.attachments.regions) {
        const marker = region.getFlag("ffxiv", "markerPlacement");
        const updates = operation._regionUpdates?.[region.id];
        if (
          !marker?.targeted ||
          marker.followRotation !== false ||
          !updates?.shapes
        )
          continue;
        updates.shapes = region.shapes.map((source) => {
          const shape = source.clone();
          if (from.x !== to.x || from.y !== to.y) {
            shape.move({
              x: shape.origin.x + to.x - from.x,
              y: shape.origin.y + to.y - from.y,
            });
          }
          return shape.toObject();
        });
        updates._shapeConstraints = region._computeShapeConstraints(updates);
      }
    }
  }
}

