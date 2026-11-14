import { debugError } from "./helpers/debug.mjs";

export class FFXIVRegionLayer extends foundry.canvas.layers.RegionLayer {
  _onMouseWheel(event) {
    const region = this.hover;
    const document = region?.document;
    if (!event.shiftKey || this._placementContext || this._mouseWheelContext
      || !document?.getFlag("ffxiv", "markerPlacement") || document.shapes.length !== 1) {
      return super._onMouseWheel(event);
    }
    if (!region.controlled || this.preview.children.length || document.locked
      || !document.canUserModify(game.user, "update") || document.shapes[0].hasRotationalSymmetry) return;
    if (game.paused && !game.user.isGM) {
      ui.notifications.warn("GAME.PausedWarning", { localize: true });
      return;
    }
    const preview = region.clone();
    preview._previewType = "wheel";
    preview._onDragStart();
    this.preview.addChild(preview);
    preview.draw();
    this._mouseWheelContext = { preview, shape: document.shapes[0].clone() };
    window.addEventListener("keyup", this._onMarkerMouseWheelKeyUp);
    return super._onMouseWheel(event);
  }

  _onMarkerMouseWheelKeyUp = () => {
    if (game.keyboard.isModifierActive("CONTROL") || game.keyboard.isModifierActive("SHIFT")) return;
    this._commitMarkerMouseWheel().catch((err) => {
      debugError("Marker rotation failed:", err);
      ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.EditFailed"));
    });
  };

  async _commitMarkerMouseWheel() {
    window.removeEventListener("keyup", this._onMarkerMouseWheelKeyUp);
    if (!this._mouseWheelContext) return;
    const updates = this._prepareMouseWheelUpdate();
    const { preview, shape } = this._mouseWheelContext;
    this._mouseWheelContext = null;
    try {
      if (game.paused && !game.user.isGM) {
        ui.notifications.warn("GAME.PausedWarning", { localize: true });
        return;
      }
      await shape.parent.update(updates);
    } finally {
      if (!preview.destroyed) {
        preview._onDragEnd();
        preview.destroy({ children: true });
      }
    }
  }

  _cancelMouseWheel() {
    window.removeEventListener("keyup", this._onMarkerMouseWheelKeyUp);
    return super._cancelMouseWheel();
  }
}
