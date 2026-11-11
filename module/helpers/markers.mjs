import { debugError } from "./debug.mjs";
import { isLimitBreakActive, toggleLimitBreakGauge } from "./limit-break-hud.mjs";

const FFXIV_REGION_MARKER_OVERLAY = Symbol("ffxivRegionMarkerOverlay");
const FFXIV_REGION_MARKER_MASK = Symbol("ffxivRegionMarkerMask");
const markerDialogs = new WeakSet();
let activeRegionMarkerRotation = null;
let cancelMarkerEdit = null;

export function registerMarkerPlacementKeybindings() {
  const { SHIFT } = foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS;
  game.keybindings.register("ffxiv", "rotateRegionMarkerClockwise", {
    name: "FFXIV.Keybindings.RotateRegionMarkerClockwise",
    hint: "FFXIV.Keybindings.RotateRegionMarkerClockwiseHint",
    editable: [{ key: "KeyR" }],
    onDown: () => activeRegionMarkerRotation?.(1) ?? false,
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
  });
  game.keybindings.register("ffxiv", "rotateRegionMarkerCounterclockwise", {
    name: "FFXIV.Keybindings.RotateRegionMarkerCounterclockwise",
    hint: "FFXIV.Keybindings.RotateRegionMarkerCounterclockwiseHint",
    editable: [{ key: "KeyR", modifiers: [SHIFT] }],
    onDown: () => activeRegionMarkerRotation?.(-1) ?? false,
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
  });
}

function formatMarkerPlacementKeybinding(action) {
  const binding = game.keybindings.get("ffxiv", action)?.[0];
  if (!binding)
    return game.i18n.localize("FFXIV.MarkerPlacement.Instructions.Unbound");
  const KeyboardManager = foundry.helpers.interaction.KeyboardManager;
  const key = binding.logicalKey ?? binding.key;
  const parts = (binding.modifiers ?? []).flatMap((modifier) =>
    KeyboardManager.MODIFIER_CODES[modifier]?.includes(key)
      ? []
      : [KeyboardManager.getKeycodeDisplayString(modifier)],
  );
  parts.push(KeyboardManager.getKeycodeDisplayString(key));
  return parts.join(" + ");
}

async function clearPlacedMarkers() {
  const scene = canvas.scene;
  if (!scene || !game.user?.isGM) return;
  const regionIds = scene.regions
    .filter((region) => region.getFlag("ffxiv", "markerPlacement"))
    .map((region) => region.id);
  const tileIds = scene.tiles
    .filter((tile) => tile.getFlag("ffxiv", "markerPlacement"))
    .map((tile) => tile.id);
  if (!regionIds.length && !tileIds.length) {
    ui.notifications.info(
      game.i18n.localize("FFXIV.MarkerPlacement.Clear.None"),
    );
    return;
  }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: {
      title: game.i18n.localize("FFXIV.MarkerPlacement.Clear.Title"),
    },
    content: `<p>${game.i18n.format(
      regionIds.length + tileIds.length === 1
        ? "FFXIV.MarkerPlacement.Clear.ConfirmOne"
        : "FFXIV.MarkerPlacement.Clear.ConfirmMany",
      { count: regionIds.length + tileIds.length },
    )}</p>`,
  });
  if (!confirmed) return;
  if (regionIds.length)
    await scene.deleteEmbeddedDocuments("Region", regionIds);
  if (tileIds.length) await scene.deleteEmbeddedDocuments("Tile", tileIds);
}

async function openMarkerEditTool() {
  cancelMarkerEdit?.();
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"),
    );
    return;
  }
  const markers = scene.regions.filter(
    (region) => region.getFlag("ffxiv", "markerPlacement")
      && region.canUserModify(game.user, "update"),
  );
  if (!markers.length) {
    ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Edit.None"));
    return;
  }
  canvas.regions.activate({ tool: "select" });
  ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Edit.Instructions"));
  const region = await selectMarkerToEdit(scene);
  if (!region) return;
  try {
    const initial = getPlacedMarkerData(region);
    const marker = await configureMarkerShape(initial.marker);
    if (!marker || canvas.scene !== scene || !scene.regions.has(region.id)
      || !region.canUserModify(game.user, "update")) return;
    if (!getMarkerBounds(marker.state)) {
      ui.notifications.warn(game.i18n.localize("FFXIV.MarkerPlacement.Errors.EmptyShape"));
      return;
    }
    const updates = {
      color: getMarkerColor(marker),
      "flags.ffxiv.markerPlacement": {
        type: marker.type,
        mode: marker.mode,
        targeted: marker.targeted,
        followRotation: marker.followRotation,
        opacity: marker.opacity,
      },
    };
    if (marker.shape !== initial.marker.shape
      || !foundry.utils.equals(marker.state, initial.marker.state)) {
      if (marker.shape !== "circle" && canvas.grid.isGridless) {
        ui.notifications.warn(game.i18n.localize("FFXIV.MarkerPlacement.Errors.GridRequired"));
        return;
      }
      updates.shapes = [createMarkerShape(marker, initial.origin)];
    }
    if (!marker.targeted) updates.attachment = { token: null };
    else if (!region.attachment.token) {
      ui.notifications.info(game.i18n.localize("FFXIV.MarkerPlacement.Edit.ClickToken"));
      const placement = await canvas.regions.placeRegion(createMarkerRegionData({
        marker,
        color: getMarkerColor(marker),
        shape: createMarkerShape(marker),
      }), {
        create: false,
        attachToToken: true,
        preConfirm: ({ document }) => Boolean(document.attachment.token),
      });
      if (!placement || canvas.scene !== scene || !scene.regions.has(region.id)) return;
      updates.shapes = placement.shapes.map((shape) => shape.toObject());
      updates.attachment = { token: placement.attachment.token.id };
      updates.levels = Array.from(placement.levels);
      updates.hidden = placement.hidden;
    }
    await region.update(updates);
  } catch (err) {
    debugError("Marker edit failed:", err);
    ui.notifications.error(game.i18n.localize("FFXIV.MarkerPlacement.Errors.EditFailed"));
  } finally {
    ui.controls.activate?.({ control: "ffxiv" });
  }
}

function selectMarkerToEdit(scene) {
  const stage = canvas.stage;
  return new Promise((resolve) => {
    const finish = (region) => {
      stage.off("pointerdowncapture", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      Hooks.off("canvasTearDown", teardownHook);
      Hooks.off("deactivateRegionLayer", deactivateHook);
      if (cancelMarkerEdit === cancel) cancelMarkerEdit = null;
      resolve(region);
    };
    const cancel = () => finish(null);
    const onPointerDown = (event) => {
      if (event.button === 2) {
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.button !== 0 || canvas.scene !== scene) return;
      const position = event.getLocalPosition(canvas.regions);
      const region = scene.regions.filter((candidate) =>
        candidate.getFlag("ffxiv", "markerPlacement")
        && candidate.canUserModify(game.user, "update")
        && candidate.object?.visible
        && candidate.object.animationState.polygonTree.testPoint(position),
      ).reverse().sort((left, right) => right.object.zIndex - left.object.zIndex)[0];
      if (!region) return;
      event.stopPropagation();
      finish(region);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    const teardownHook = Hooks.on("canvasTearDown", cancel);
    const deactivateHook = Hooks.on("deactivateRegionLayer", cancel);
    cancelMarkerEdit = cancel;
    stage.on("pointerdowncapture", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
  });
}

function getPlacedMarkerData(region) {
  const marker = region.getFlag("ffxiv", "markerPlacement");
  const shape = region.shapes.length === 1 ? region.shapes[0] : null;
  let offsets = [];
  let origin;
  if (shape?.type === "circle") {
    origin = { x: shape.x, y: shape.y };
    const diameter = Math.max(1, Math.ceil(shape.radius * 2 / canvas.grid.size));
    for (let i = 0; i < diameter; i++) {
      for (let j = 0; j < diameter; j++) offsets.push({ i, j });
    }
  } else {
    if (shape?.type === "grid") offsets = Array.from(shape.offsets);
    else {
      const [i0, j0, i1, j1] = canvas.grid.getOffsetRange(region.polygonTree.bounds);
      for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
          if (region.polygonTree.testPoint(canvas.grid.getCenterPoint({ i, j }))) {
            offsets.push({ i, j });
          }
        }
      }
    }
    if (!offsets.length) offsets.push(canvas.grid.getOffset(region.polygonTree.bounds.center));
  }
  const minI = Math.min(...offsets.map((offset) => offset.i));
  const minJ = Math.min(...offsets.map((offset) => offset.j));
  const height = Math.max(...offsets.map((offset) => offset.i)) - minI + 1;
  const width = Math.max(...offsets.map((offset) => offset.j)) - minJ + 1;
  const centerOffset = { i: minI + Math.floor(height / 2), j: minJ + Math.floor(width / 2) };
  origin ??= canvas.grid.getCenterPoint(centerOffset);
  const size = Math.max(15, height, width);
  const center = Math.floor(size / 2);
  const state = Array.from({ length: size }, () => Array(size).fill(false));
  for (const offset of offsets) {
    state[center + offset.i - centerOffset.i][center + offset.j - centerOffset.j] = true;
  }
  return {
    origin,
    marker: {
      state,
      type: marker.type ?? (Number(region.color) === 0x66ffff ? "allied" : "enemy"),
      mode: marker.mode ?? "standard",
      opacity: marker.opacity ?? 0.75,
      targeted: Boolean(region.attachment.token),
      followRotation: marker.followRotation !== false,
      shape: shape?.type === "circle" ? "circle" : "grid",
      radius: shape?.type === "circle" ? shape.radius / canvas.grid.size : null,
    },
  };
}

function getMarkerColor(marker) {
  return marker.mode === "tankbuster"
    ? "#b22222"
    : marker.type === "allied"
      ? "#66ffff"
      : "#ffa500";
}

export async function openMarkerPlacementTool(assignedMarker = null) {
  cancelMarkerEdit?.();
  if (!canvas.scene) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"),
    );
    return false;
  }
  if (!game.user.hasPermission("REGION_CREATE")) {
    ui.notifications.warn(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoPermission"),
    );
    return false;
  }

  const marker = assignedMarker ?? (await configureMarkerShape());
  if (!marker) return false;
  const bounds = getMarkerBounds(marker.state);
  if (!bounds) {
    ui.notifications.warn(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.EmptyShape"),
    );
    return false;
  }

  if (marker.shape !== "circle" && canvas.grid.isGridless) {
    ui.notifications.warn(game.i18n.localize("FFXIV.MarkerPlacement.Errors.GridRequired"));
    return false;
  }
  const placementShape = createMarkerShape(marker);
  const color = getMarkerColor(marker);
  const placementData = createMarkerRegionData({
    marker,
    color,
    shape: placementShape,
  });
  try {
    ui.notifications.info(
      game.i18n.format(
        marker.targeted
          ? "FFXIV.MarkerPlacement.Instructions.RegionClickToken"
          : "FFXIV.MarkerPlacement.Instructions.RegionClickToPlace",
        {
          clockwise: formatMarkerPlacementKeybinding(
            "rotateRegionMarkerClockwise",
          ),
          counterclockwise: formatMarkerPlacementKeybinding(
            "rotateRegionMarkerCounterclockwise",
          ),
        },
      ),
    );
    const placementPromise = canvas.regions.placeRegion(placementData, {
      allowRotation: true,
      attachToToken: marker.targeted,
      preConfirm: ({ document }) =>
        !marker.targeted || Boolean(document.attachment.token),
      preSkip: ({ event }) => (event.button !== 0 ? false : undefined),
    });
    const rotationHandler = (direction) => {
      canvas.regions._onMouseWheel({ delta: direction, shiftKey: false });
      return true;
    };
    activeRegionMarkerRotation = rotationHandler;
    const stage = canvas.stage;
    let rightPress = null;
    const onPointerDown = (event) => {
      if (event.button !== 2) return;
      rightPress = {
        x: event.global.x,
        y: event.global.y,
        time: performance.now(),
        moved: false,
      };
    };
    const onPointerMove = (event) => {
      if (!rightPress) return;
      if (Math.hypot(event.global.x - rightPress.x, event.global.y - rightPress.y) > 5) {
        rightPress.moved = true;
      }
    };
    const onPointerUp = (event) => {
      if (event.button !== 2 || !rightPress) return;
      const press = rightPress;
      rightPress = null;
      if (!press.moved && performance.now() - press.time <= 350) {
        canvas.regions._cancelPlacement();
      }
    };
    stage.on("pointerdown", onPointerDown);
    stage.on("pointermove", onPointerMove);
    stage.on("pointerup", onPointerUp);
    stage.on("pointerupoutside", onPointerUp);
    let placement;
    try {
      placement = await placementPromise;
    } finally {
      stage.off("pointerdown", onPointerDown);
      stage.off("pointermove", onPointerMove);
      stage.off("pointerup", onPointerUp);
      stage.off("pointerupoutside", onPointerUp);
      if (activeRegionMarkerRotation === rotationHandler)
        activeRegionMarkerRotation = null;
    }
    if (placement) {
      await game.settings
        .set(
          "ffxiv",
          "markerOpacity",
          placement.getFlag("ffxiv", "markerPlacement").opacity,
        )
        .catch((err) => debugError("Failed to save marker opacity:", err));
    }
    return Boolean(placement);
  } catch (err) {
    debugError("Region marker placement failed:", err);
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.RegionFailed"),
    );
    return false;
  } finally {
    ui.controls.activate?.({ control: "ffxiv" });
  }
}

function createMarkerShape(marker, origin = { x: 0, y: 0 }) {
  const bounds = getMarkerBounds(marker.state);
  const gridSize = canvas.grid.size;
  const widthCells = bounds.maxX - bounds.minX + 1;
  const heightCells = bounds.maxY - bounds.minY + 1;
  const centerX = Math.floor(widthCells / 2);
  const centerY = Math.floor(heightCells / 2);
  if (marker.shape === "circle") {
    return {
      type: "circle",
      x: origin.x,
      y: origin.y,
      radius: (marker.radius ?? Math.max(widthCells, heightCells) / 2) * gridSize,
      gridBased: false,
    };
  } else {
    const baseOffset = canvas.grid.getOffset(origin);
    const offsets = [];
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!marker.state[y][x]) continue;
        offsets.push({
          i: baseOffset.i + y - bounds.minY - centerY,
          j: baseOffset.j + x - bounds.minX - centerX,
        });
      }
    }
    return {
      type: "grid",
      offsets,
      origin: { x: origin.x, y: origin.y },
    };
  }
}

function createMarkerRegionData({ marker, color, shape }) {
  return {
    name: game.i18n.localize("FFXIV.MarkerPlacement.RegionName"),
    color,
    shapes: [shape],
    levels: [canvas.level.id],
    restriction: { enabled: false },
    highlightMode: "shapes",
    displayMeasurements: false,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: {
      ffxiv: {
        markerPlacement: {
          type: marker.type,
          mode: marker.mode,
          targeted: marker.targeted,
          followRotation: marker.followRotation,
          opacity: marker.opacity ?? game.settings.get("ffxiv", "markerOpacity"),
        },
      },
    },
  };
}

function drawRegionMarkerOverlay(region) {
  const marker = region.document.getFlag("ffxiv", "markerPlacement");
  let overlay = region[FFXIV_REGION_MARKER_OVERLAY];
  if (!marker) {
    if (overlay) {
      const highlight = region.layer._highlights.children.find(
        (mesh) => mesh.region === region,
      );
      if (highlight) highlight.alpha = 0.5;
    }
    overlay?.destroy();
    region[FFXIV_REGION_MARKER_MASK]?.destroy();
    delete region[FFXIV_REGION_MARKER_OVERLAY];
    delete region[FFXIV_REGION_MARKER_MASK];
    return;
  }

  overlay ??= region.addChild(new PIXI.Graphics());
  region[FFXIV_REGION_MARKER_OVERLAY] = overlay;
  let mask = region[FFXIV_REGION_MARKER_MASK];
  mask ??= region.addChild(new PIXI.Graphics());
  region[FFXIV_REGION_MARKER_MASK] = mask;
  const polygonTree = region.animationState.polygonTree;
  drawRegionMarkerMask(mask, polygonTree);
  overlay.mask = mask;
  overlay.clear();
  overlay.eventMode = "none";
  const opacity = Math.clamp(marker.opacity ?? 0.75, 0, 1);
  overlay.alpha = opacity;
  const highlight = region.layer._highlights.children.find(
    (mesh) => mesh.region === region,
  );
  if (highlight) highlight.alpha = opacity;

  const bounds = region.bounds;
  if (!bounds.width || !bounds.height) return;
  const alpha = 1;

  for (const node of polygonTree) {
    if (node.isHole) continue;
    const area = node.bounds;
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    const size = Math.min(canvas.grid.size, area.width, area.height);

    if (marker.mode === "stack") {
      const halfExtent = Math.min(
        Math.min(area.width, area.height) / 2,
        canvas.grid.size * 3,
      );
      const armLength = Math.max(0, halfExtent - canvas.grid.size / 2);
      const chevronLength =
        armLength > 0
          ? Math.min(canvas.grid.size * 0.65, armLength * 0.55)
          : canvas.grid.size * 0.4;
      const step =
        armLength > 0
          ? Math.max(0, (armLength - chevronLength) / 3)
          : chevronLength * 0.18;
      const distance =
        armLength > 0
          ? halfExtent - chevronLength / 2
          : chevronLength * 0.9;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        drawRegionStackChevrons(
          overlay,
          centerX + dx * distance,
          centerY + dy * distance,
          -dx,
          -dy,
          chevronLength,
          step,
          alpha,
        );
      }
    }

    if (marker.mode === "knockback") {
      drawRegionKnockbackPattern(
        overlay,
        centerX,
        centerY,
        Math.min(area.width, area.height) / 2,
        canvas.grid.size,
        alpha,
      );
    }

    if (marker.mode === "tankbuster") {
      drawTankbusterCautionRing(overlay, centerX, centerY, size, alpha);
      drawTankbusterChevron(overlay, centerX, centerY - size * 1.05, size * 0.55);
      drawTankbusterChevron(overlay, centerX, centerY - size * 0.45, size * 0.75);
    }
  }
}

function drawRegionMarkerMask(graphics, polygonTree) {
  graphics.clear();
  graphics.beginFill(0xffffff);
  polygonTree.drawShape(graphics);
  graphics.endFill();
}

function drawRegionKnockbackPattern(
  graphics,
  x,
  y,
  halfExtent,
  gridSize,
  alpha,
) {
  const reach = Math.min(halfExtent * 0.82, gridSize * 3);
  const ringCount = reach >= gridSize * 1.75 ? 3 : 2;
  const innerRadius = Math.min(gridSize * 0.85, reach * 0.7);
  const colors = [0xfff4bd, 0xffd166, 0xff5a36];
  for (let ring = 0; ring < ringCount; ring++) {
    const chevronCount = ring === 0 ? 8 : ringCount === 3 ? 12 : 10;
    const radius =
      innerRadius +
      (ringCount === 1
        ? 0
        : (ring / (ringCount - 1)) * Math.max(0, reach - innerRadius));
    for (let index = 0; index < chevronCount; index++) {
      const angle = (index / chevronCount) * Math.PI * 2;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      drawRegionChevron(
        graphics,
        x + ux * radius,
        y + uy * radius,
        ux,
        uy,
        gridSize * (ring === 0 ? 0.26 : ringCount === 3 ? 0.3 : 0.32),
        colors[ring],
        ring === 0 ? 1 : alpha,
      );
    }
  }
}

function drawRegionStackChevrons(
  graphics,
  x,
  y,
  ux,
  uy,
  chevronLength,
  step,
  alpha,
) {
  const colors = [0xd9362b, 0xf06a2a, 0xffcf35, 0xffffff];
  for (let index = 0; index < colors.length; index++) {
    drawRegionChevron(
      graphics,
      x + ux * index * step,
      y + uy * index * step,
      ux,
      uy,
      chevronLength,
      colors[index],
      index === colors.length - 1 ? 1 : alpha,
    );
  }
}

function drawRegionChevron(graphics, x, y, ux, uy, size, color, alpha) {
  const px = -uy;
  const py = ux;
  const tipX = x + ux * size * 0.5;
  const tipY = y + uy * size * 0.5;
  const backX = x - ux * size * 0.5;
  const backY = y - uy * size * 0.5;
  const notchX = x + ux * size * 0.12;
  const notchY = y + uy * size * 0.12;
  graphics.beginFill(color, alpha);
  graphics.drawPolygon([
    tipX,
    tipY,
    backX + px * size * 0.5,
    backY + py * size * 0.5,
    backX + px * size * 0.22,
    backY + py * size * 0.22,
    notchX,
    notchY,
    backX - px * size * 0.22,
    backY - py * size * 0.22,
    backX - px * size * 0.5,
    backY - py * size * 0.5,
  ]);
  graphics.endFill();
}

function drawTankbusterCautionRing(graphics, x, y, size, alpha) {
  const segments = 20;
  for (const radius of [size * 0.65, size]) {
    for (let index = 0; index < segments; index++) {
      const start = (index / segments) * Math.PI * 2;
      const end = ((index + 1) / segments) * Math.PI * 2;
      graphics.lineStyle(size * 0.14, index % 2 ? 0x220000 : 0xff315f, alpha);
      graphics.arc(x, y, radius, start, end);
    }
  }
}

function drawTankbusterChevron(graphics, x, y, size) {
  const halfWidth = size * 0.65;
  const thickness = size * 0.28;
  graphics.lineStyle(Math.max(2, size * 0.1), 0xff315f, 1);
  graphics.beginFill(0xf5f5f5, 1);
  graphics.drawPolygon([
    x - halfWidth,
    y - thickness,
    x,
    y + halfWidth * 0.65,
    x + halfWidth,
    y - thickness,
    x + halfWidth - thickness,
    y - thickness * 2,
    x,
    y + halfWidth * 0.65 - thickness * 1.4,
    x - halfWidth + thickness,
    y - thickness * 2,
  ]);
  graphics.endFill();
}

async function configureMarkerShape(initialMarker = null) {
  const opacity = initialMarker?.opacity ?? game.settings.get("ffxiv", "markerOpacity");
  const size = initialMarker?.state.length ?? 15;
  const center = Math.floor(size / 2);
  const state = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  if (initialMarker) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) state[y][x] = Boolean(initialMarker.state[y]?.[x]);
    }
  } else {
    for (let y = center - 2; y <= center + 2; y++) {
      for (let x = center - 2; x <= center + 2; x++) state[y][x] = true;
    }
  }
  const geometry = {
    shape: initialMarker?.shape ?? "grid",
    radius: initialMarker?.radius ?? null,
  };
  let selection = {
    opacity,
    type: "enemy",
    mode: "standard",
    targeted: false,
    followRotation: true,
    shape: "grid",
    ...initialMarker,
    state,
  };
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <style>
      .ffxiv-marker-config { display: flex; gap: 16px; overflow-x: auto; }
      .ffxiv-marker-panel { display: flex; flex-direction: column; gap: 8px; }
      .ffxiv-marker-row { display: flex; align-items: center; gap: 8px; }
      .ffxiv-marker-grid { display: grid; grid-template-columns: repeat(${size}, 24px); }
      .ffxiv-marker-cell { width: 24px; height: 24px; border: 1px solid #888; background: #222; cursor: pointer; }
      .ffxiv-marker-cell.selected.enemy { background: orange; }
      .ffxiv-marker-cell.selected.allied { background: #66ffff; }
      .ffxiv-marker-presets { display: flex; flex-direction: column; gap: 8px; }
      .ffxiv-marker-preset-row { display: flex; gap: 8px; }
	      .ffxiv-marker-preview { overflow: hidden; max-width: 260px; max-height: 260px; border: 0; background: transparent; width: fit-content; height: fit-content; padding: 6px; }
      .ffxiv-marker-preview canvas { display: block; }
    </style>
    <div class="ffxiv-marker-config" style="display: flex; gap: 16px; overflow-x: auto; align-items: flex-start;">
      <div class="ffxiv-marker-panel" style="display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto;">
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Source")}</label>
          <select id="ffxiv-marker-type">
            <option value="enemy"${selection.type === "enemy" ? " selected" : ""}>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Enemy")}</option>
            <option value="allied"${selection.type === "allied" ? " selected" : ""}>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Ally")}</option>
          </select>
        </div>
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Opacity")}</label>
          <input type="range" id="ffxiv-marker-opacity" min="0" max="100" value="${Math.round(opacity * 100)}">
          <span id="ffxiv-marker-opacity-value">${Math.round(opacity * 100)}%</span>
        </div>
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Mode")}</label>
          <select id="ffxiv-marker-mode">
            <option value="standard"${selection.mode === "standard" ? " selected" : ""}>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Standard")}</option>
            <option value="stack"${selection.mode === "stack" ? " selected" : ""}>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Stack")}</option>
            <option value="knockback"${selection.mode === "knockback" ? " selected" : ""}>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Knockback")}</option>
            <option value="tankbuster"${selection.mode === "tankbuster" ? " selected" : ""}>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Tankbuster")}</option>
          </select>
        </div>
        <label class="ffxiv-marker-checkbox">
          <span class="ffxiv-marker-checkbox-control">
            <input type="checkbox" id="ffxiv-marker-targeted"${selection.targeted ? " checked" : ""}>
            <span class="checkmark"></span>
          </span>
          <span>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Targeted")}</span>
        </label>
        <label class="ffxiv-marker-checkbox">
          <span class="ffxiv-marker-checkbox-control">
            <input type="checkbox" id="ffxiv-marker-follow-rotation"${selection.followRotation ? " checked" : ""}${selection.targeted ? "" : " disabled"}>
            <span class="checkmark"></span>
          </span>
          <span>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.FollowRotation")}</span>
        </label>
        <label class="ffxiv-marker-checkbox">
          <span class="ffxiv-marker-checkbox-control">
            <input type="checkbox" id="ffxiv-marker-circle"${selection.shape === "circle" ? " checked" : ""}>
            <span class="checkmark"></span>
          </span>
          <span>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Circle")}</span>
        </label>
        <div class="ffxiv-marker-grid" style="display: grid; grid-template-columns: repeat(${size}, 24px); flex: 0 0 auto;">
          ${state
      .flatMap((row, y) =>
        row.map(
          (_on, x) =>
            `<div class="ffxiv-marker-cell" data-x="${x}" data-y="${y}" style="width: 24px; height: 24px; box-sizing: border-box; border: 1px solid #888; background: ${state[y][x] ? "orange" : "#222"}; cursor: pointer;"></div>`,
        ),
      )
      .join("")}
        </div>
      </div>
      <div class="ffxiv-marker-panel" style="display: flex; flex-direction: column; gap: 8px; flex: 0 0 260px;">
        <strong>${game.i18n.localize("FFXIV.MarkerPlacement.Custom.Title")}</strong>
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <select id="ffxiv-marker-custom" style="min-width: 0; flex: 1;">
            <option value="">${game.i18n.localize("FFXIV.MarkerPlacement.Custom.New")}</option>
          </select>
          <button type="button" id="ffxiv-marker-save" data-tooltip="${game.i18n.localize("FFXIV.MarkerPlacement.Custom.Save")}">
            <i class="fa-solid fa-floppy-disk"></i>
          </button>
          <button type="button" id="ffxiv-marker-delete" data-tooltip="${game.i18n.localize("FFXIV.MarkerPlacement.Custom.Delete")}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <strong>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Presets")}</strong>
	        <div class="ffxiv-marker-presets" style="display: flex; flex-direction: column; gap: 8px;">
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="standard">Standard 3x3</button>
	            <button type="button" data-span="2" data-mode="standard">Standard 5x5</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="stack">Stack 3x3</button>
	            <button type="button" data-span="2" data-mode="stack">Stack 5x5</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="knockback">Knockback 3x3</button>
	            <button type="button" data-span="2" data-mode="knockback">Knockback 5x5</button>
	          </div>
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="tankbuster">Tank Buster 3x3</button>
	            <button type="button" data-span="2" data-mode="tankbuster">Tank Buster 5x5</button>
	          </div>
        </div>
        <strong>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Preview")}</strong>
	        <div class="ffxiv-marker-preview" style="overflow: hidden; max-width: 260px; max-height: 260px; border: 0; background: transparent; width: fit-content; height: fit-content; padding: 6px;"><canvas id="ffxiv-marker-preview" style="display: block;"></canvas></div>
      </div>
    </div>`;

  initializeMarkerShapeDialog(
    wrapper,
    null,
    state,
    center,
    geometry,
    (selectionValue) => {
      selection = selectionValue;
    },
  );
  const confirmed = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.localize(initialMarker
        ? "FFXIV.MarkerPlacement.Edit.Title"
        : "FFXIV.MarkerPlacement.Title"),
      resizable: true,
    },
    position: { width: 760 },
    content: wrapper,
    buttons: [
      {
        action: "create",
        label: game.i18n.localize(initialMarker
          ? "FFXIV.MarkerPlacement.Edit.Save"
          : "FFXIV.MarkerPlacement.Dialog.Button.Place"),
        icon: "fas fa-check",
        default: true,
        callback: () => true,
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fas fa-times",
        callback: () => false,
      },
    ],
    render: (app, html) => {
      initializeMarkerShapeDialog(
        app,
        html,
        state,
        center,
        geometry,
        (selectionValue) => {
          selection = selectionValue;
        },
      );
    },
  });

  if (!confirmed) return null;
  return selection;
}

export function initializeMarkerShapeDialog(
  app,
  html,
  state,
  center,
  geometry,
  setSelection,
  dialogKey,
) {
  const element = getDialogElement(app, html, dialogKey);
  if (!element) return false;
  if (markerDialogs.has(element)) return true;
  markerDialogs.add(element);
  const cells = Array.from(element.querySelectorAll(".ffxiv-marker-cell"));
  const type = element.querySelector("#ffxiv-marker-type");
  const opacity = element.querySelector("#ffxiv-marker-opacity");
  const opacityValue = element.querySelector("#ffxiv-marker-opacity-value");
  const mode = element.querySelector("#ffxiv-marker-mode");
  const targeted = element.querySelector("#ffxiv-marker-targeted");
  const followRotation = element.querySelector(
    "#ffxiv-marker-follow-rotation",
  );
  const circle = element.querySelector("#ffxiv-marker-circle");
  const custom = element.querySelector("#ffxiv-marker-custom");
  const saveCustom = element.querySelector("#ffxiv-marker-save");
  const deleteCustom = element.querySelector("#ffxiv-marker-delete");
  const preview = element.querySelector("#ffxiv-marker-preview");
  const previewContainer = preview?.closest(".ffxiv-marker-preview");
  if (
    !cells.length ||
    !type ||
    !mode ||
    !targeted ||
    !preview
  ) {
    markerDialogs.delete(element);
    return false;
  }
  const getOpacity = () => Math.clamp(Number(opacity?.value ?? 75) / 100, 0, 1);
  type.disabled = mode.value === "tankbuster";
  const updateGeometry = () => {
    geometry.shape = circle?.checked ? "circle" : "grid";
    const bounds = getMarkerBounds(state);
    geometry.radius =
      geometry.shape === "circle" && bounds
        ? Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1) / 2
        : null;
  };
  const updateSelection = () => {
    updateGeometry();
    setSelection({
      state,
      opacity: getOpacity(),
      type: type.value,
      mode: mode.value,
      targeted: targeted.checked,
      followRotation: followRotation?.checked ?? true,
      shape: geometry.shape,
      radius: geometry.radius,
    });
  };

  const updateCells = () => {
    for (const cell of cells) {
      const on = state[Number(cell.dataset.y)][Number(cell.dataset.x)];
      cell.classList.toggle("selected", on);
      cell.classList.toggle("enemy", on && type.value === "enemy");
      cell.classList.toggle("allied", on && type.value === "allied");
      cell.style.background = !on
        ? "#222"
        : type.value === "enemy"
          ? "orange"
          : "#66ffff";
    }
  };
  let previewImage = null;
  const updatePreview = () => {
    previewImage = null;
    updateSelection();
    if (opacityValue) opacityValue.textContent = `${Math.round(getOpacity() * 100)}%`;
    const rendered = renderMarkerDataUrl(
      {
        state,
        opacity: getOpacity(),
        type: type.value,
        mode: mode.value,
        targeted: targeted.checked,
        followRotation: followRotation?.checked ?? true,
        shape: geometry.shape,
        radius: geometry.radius,
      },
      Math.max(24, Math.round(canvas.grid.size / 3)),
    );
    if (!rendered) {
      preview.width = 1;
      preview.height = 1;
      if (previewContainer) {
        previewContainer.style.width = "fit-content";
        previewContainer.style.height = "fit-content";
      }
      return;
    }
    const image = new Image();
    previewImage = image;
    image.onload = () => {
      if (previewImage !== image) return;
      preview.width = rendered.width;
      preview.height = rendered.height;
      const displayWidth = Math.min(220, rendered.width);
      const displayHeight = rendered.height * (displayWidth / rendered.width);
      preview.style.width = `${displayWidth}px`;
      preview.style.height = `${displayHeight}px`;
      if (previewContainer) {
        previewContainer.style.width = `${displayWidth + 12}px`;
        previewContainer.style.height = `${Math.min(260, displayHeight + 12)}px`;
        previewContainer.style.background = "transparent";
        previewContainer.style.border = "0";
        previewContainer.style.overflow = "hidden";
        previewContainer.style.padding = "6px";
      }
      const ctx = preview.getContext("2d");
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.drawImage(image, 0, 0);
    };
    image.src = rendered.src;
  };
  const getCustomMarkers = () =>
    foundry.utils.deepClone(game.settings.get("ffxiv", "customMarkers") ?? {});
  const refreshCustomMarkers = (selected = "") => {
    if (!custom) return;
    const markers = getCustomMarkers();
    custom.replaceChildren(
      new Option(
        game.i18n.localize("FFXIV.MarkerPlacement.Custom.New"),
        "",
      ),
      ...Object.keys(markers)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => new Option(name, name)),
    );
    custom.value = selected in markers ? selected : "";
    deleteCustom.disabled = !custom.value;
  };
  const loadCustomMarker = (name) => {
    const marker = getCustomMarkers()[name];
    if (!marker) return;
    for (let y = 0; y < state.length; y++) {
      for (let x = 0; x < state[y].length; x++) {
        state[y][x] = Boolean(marker.state?.[y]?.[x]);
      }
    }
    type.value = marker.type === "allied" ? "allied" : "enemy";
    mode.value = ["standard", "stack", "knockback", "tankbuster"].includes(
      marker.mode,
    )
      ? marker.mode
      : "standard";
    targeted.checked = Boolean(marker.targeted);
    if (opacity) opacity.value = Math.round((marker.opacity ?? 0.75) * 100);
    if (followRotation) {
      followRotation.checked = marker.followRotation !== false;
      followRotation.disabled = !targeted.checked;
    }
    if (circle) circle.checked = Boolean(marker.circle);
    type.disabled = mode.value === "tankbuster";
    updateCells();
    updatePreview();
  };
  const configurePreset = (span, presetMode) => {
    for (const row of state) row.fill(false);
    for (let y = center - span; y <= center + span; y++) {
      for (let x = center - span; x <= center + span; x++) state[y][x] = true;
    }
    mode.value = presetMode;
    if (custom) custom.value = "";
    if (deleteCustom) deleteCustom.disabled = true;
    type.disabled = presetMode === "tankbuster";
    updateCells();
    updatePreview();
  };
  let dragging = false;
  let initial = false;
  const toggleCell = (cell) => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    state[y][x] = !state[y][x];
    updateCells();
    updatePreview();
  };

  for (const cell of cells) {
    cell.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      initial = state[Number(cell.dataset.y)][Number(cell.dataset.x)];
      toggleCell(cell);
    });
    cell.addEventListener("pointerenter", () => {
      if (!dragging) return;
      if (state[Number(cell.dataset.y)][Number(cell.dataset.x)] === initial)
        toggleCell(cell);
    });
  }
  window.addEventListener("pointerup", () => (dragging = false), {
    signal: html?.options?.signal,
  });
  element.querySelectorAll("[data-span][data-mode]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      configurePreset(Number(button.dataset.span), button.dataset.mode);
    });
  });
  type.addEventListener("change", (event) => {
    event.stopPropagation();
    updateCells();
    updatePreview();
  });
  opacity?.addEventListener("input", () => {
    updatePreview();
  });
  opacity?.addEventListener("change", () => {
    game.settings
      .set("ffxiv", "markerOpacity", getOpacity())
      .catch((err) => debugError("Failed to save marker opacity:", err));
  });
  mode.addEventListener("change", (event) => {
    event.stopPropagation();
    type.disabled = mode.value === "tankbuster";
    updatePreview();
  });
  targeted.addEventListener("change", (event) => {
    event.stopPropagation();
    if (followRotation) followRotation.disabled = !targeted.checked;
    updatePreview();
  });
  followRotation?.addEventListener("change", (event) => {
    event.stopPropagation();
    updatePreview();
  });
  circle?.addEventListener("change", (event) => {
    event.stopPropagation();
    updatePreview();
  });
  custom?.addEventListener("change", () => {
    deleteCustom.disabled = !custom.value;
    if (custom.value) loadCustomMarker(custom.value);
  });
  saveCustom?.addEventListener("click", async (event) => {
    event.preventDefault();
    let name = custom.value;
    if (!name) {
      try {
        name = await foundry.applications.api.DialogV2.prompt({
          window: {
            title: game.i18n.localize("FFXIV.MarkerPlacement.Custom.NameTitle"),
          },
          content: `<input type="text" name="name" required autofocus>`,
          ok: {
            label: game.i18n.localize("FFXIV.MarkerPlacement.Custom.Save"),
            callback: (_event, button) =>
              button.form.elements.name.value.trim(),
          },
        });
      } catch {
        return;
      }
      if (!name) return;
    }
    const markers = getCustomMarkers();
    markers[name] = {
      state: state.map((row) => Array.from(row, Boolean)),
      opacity: getOpacity(),
      type: type.value,
      mode: mode.value,
      targeted: targeted.checked,
      followRotation: followRotation?.checked ?? true,
      circle: Boolean(circle?.checked),
    };
    await game.settings.set("ffxiv", "customMarkers", markers);
    refreshCustomMarkers(name);
  });
  deleteCustom?.addEventListener("click", async (event) => {
    event.preventDefault();
    const name = custom.value;
    if (!name) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.localize("FFXIV.MarkerPlacement.Custom.Delete"),
      },
      content: `<p>${game.i18n.format(
        "FFXIV.MarkerPlacement.Custom.DeleteConfirm",
        { name },
      )}</p>`,
    });
    if (!confirmed) return;
    const markers = getCustomMarkers();
    delete markers[name];
    await game.settings.set("ffxiv", "customMarkers", markers);
    refreshCustomMarkers();
  });
  refreshCustomMarkers();
  updateCells();
  updatePreview();
  return true;
}

function getDialogElement(app, html, dialogKey) {
  const keyedElement = dialogKey
    ? document.querySelector(`[data-ffxiv-marker-dialog="${dialogKey}"]`)
    : null;
  const visibleMarkerElements = Array.from(
    document.querySelectorAll(".ffxiv-marker-config"),
  ).filter((element) => element.offsetParent !== null);
  const candidates = [
    keyedElement,
    html,
    html?.element,
    html?.element?.[0],
    html?.target,
    html?.currentTarget,
    html?.[0],
    app,
    app?.element,
    app?.element?.[0],
    app?.target,
    app?.currentTarget,
    app?.[0],
    visibleMarkerElements.at(-1),
    visibleMarkerElements
      .at(-1)
      ?.closest(".app, .application, .window-app, .dialog"),
  ];

  return (
    candidates.find(
      (element) =>
        element instanceof HTMLElement &&
        element.querySelector?.("#ffxiv-marker-preview"),
    ) ?? null
  );
}

export function renderMarkerDataUrl(marker, gridSize) {
  const bounds = getMarkerBounds(marker.state);
  if (!bounds) return null;
  const opacity = Math.clamp(marker.opacity ?? 0.75, 0, 1);
  const cropped = marker.state
    .slice(bounds.minY, bounds.maxY + 1)
    .map((row) => row.slice(bounds.minX, bounds.maxX + 1));
  if (marker.shape === "circle" && marker.radius) {
    const diameter = marker.radius * 2;
    const width = diameter * gridSize;
    const height = width;
    const canvasElement = document.createElement("canvas");
    canvasElement.width = width;
    canvasElement.height = height;
    const ctx = canvasElement.getContext("2d");
    const baseColor =
      marker.mode === "tankbuster"
        ? "firebrick"
        : marker.type === "enemy"
          ? "orange"
          : "#66ffff";
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    ctx.clip();
    drawMarkerOverlays(ctx, cropped, gridSize, { ...marker, opacity: 1 });
    ctx.restore();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillRect(0, 0, width, height);
    return {
      src: canvasElement.toDataURL("image/webp"),
      width,
      height,
      widthCells: diameter,
      heightCells: diameter,
    };
  }
  const widthCells = cropped[0].length;
  const heightCells = cropped.length;
  const width = widthCells * gridSize;
  const height = heightCells * gridSize;
  const canvasElement = document.createElement("canvas");
  canvasElement.width = width;
  canvasElement.height = height;
  const ctx = canvasElement.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const isOn = (x, y) =>
    y >= 0 && y < heightCells && x >= 0 && x < widthCells && cropped[y][x];
  const baseColor =
    marker.mode === "tankbuster"
      ? "firebrick"
      : marker.type === "enemy"
        ? "orange"
        : "#66ffff";

  ctx.fillStyle = baseColor;
  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      if (!cropped[y][x]) continue;
      drawMarkerCell(ctx, x * gridSize, y * gridSize, gridSize, [
        isOn(x, y - 1),
        isOn(x - 1, y),
        isOn(x + 1, y),
        isOn(x, y + 1),
      ]);
      ctx.fill();
    }
  }

  ctx.save();
  ctx.beginPath();
  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      if (cropped[y][x]) ctx.rect(x * gridSize, y * gridSize, gridSize, gridSize);
    }
  }
  ctx.clip();
  drawMarkerOverlays(ctx, cropped, gridSize, { ...marker, opacity: 1 });
  ctx.restore();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillRect(0, 0, width, height);
  return {
    src: canvasElement.toDataURL("image/webp"),
    width,
    height,
    widthCells,
    heightCells,
  };
}

function getMarkerBounds(state) {
  if (!Array.isArray(state) || !state.length || !state[0]?.length) return null;
  let minX = state[0].length;
  let minY = state.length;
  let maxX = -1;
  let maxY = -1;
  state.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }),
  );
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function drawMarkerCell(ctx, x, y, size, [top, left, right, bottom]) {
  const radius = size / 4;
  ctx.beginPath();
  ctx.moveTo(x + (top || left ? 0 : radius), y);
  if (!top && !left) ctx.arcTo(x, y, x, y + radius, radius);
  ctx.lineTo(x, y + (bottom || left ? size : size - radius));
  if (!bottom && !left) ctx.arcTo(x, y + size, x + radius, y + size, radius);
  ctx.lineTo(x + (bottom || right ? size : size - radius), y + size);
  if (!bottom && !right)
    ctx.arcTo(x + size, y + size, x + size, y + size - radius, radius);
  ctx.lineTo(x + size, y + (top || right ? 0 : radius));
  if (!top && !right) ctx.arcTo(x + size, y, x + size - radius, y, radius);
  ctx.closePath();
}

function drawMarkerOverlays(ctx, cropped, gridSize, marker) {
  for (const area of getMarkerComponentAreas(cropped, gridSize)) {
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;

    if (marker.mode === "stack") {
      const halfExtent = Math.min(
        Math.min(area.width, area.height) / 2,
        gridSize * 3,
      );
      const armLength = Math.max(0, halfExtent - gridSize / 2);
      const chevronLength =
        armLength > 0
          ? Math.min(gridSize * 0.65, armLength * 0.55)
          : gridSize * 0.4;
      const step =
        armLength > 0
          ? Math.max(0, (armLength - chevronLength) / 3)
          : chevronLength * 0.18;
      const distance =
        armLength > 0
          ? halfExtent - chevronLength / 2
          : chevronLength * 0.9;
      for (const { dx, dy } of [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ]) {
        drawCanvasStackChevrons(
          ctx,
          cx + dx * distance,
          cy + dy * distance,
          -dx,
          -dy,
          chevronLength,
          step,
          marker.opacity,
        );
      }
    }

    if (marker.mode === "knockback") {
      drawCanvasKnockbackPattern(
        ctx,
        cx,
        cy,
        Math.min(area.width, area.height) / 2,
        gridSize,
        marker.opacity,
      );
    }

    if (marker.mode === "tankbuster") {
      drawCanvasTankbusterCautionRing(ctx, cx, cy, gridSize, marker.opacity);
      drawCanvasTankbusterChevron(
        ctx,
        cx,
        cy - gridSize * 1.05,
        gridSize * 0.55,
      );
      drawCanvasTankbusterChevron(
        ctx,
        cx,
        cy - gridSize * 0.45,
        gridSize * 0.75,
      );
    }
  }

  ctx.globalAlpha = 1;
}

function getMarkerComponentAreas(state, gridSize) {
  const visited = state.map((row) => row.map(() => false));
  const areas = [];
  for (let startY = 0; startY < state.length; startY++) {
    for (let startX = 0; startX < state[startY].length; startX++) {
      if (!state[startY][startX] || visited[startY][startX]) continue;
      const queue = [[startX, startY]];
      visited[startY][startX] = true;
      let minX = startX;
      let minY = startY;
      let maxX = startX;
      let maxY = startY;
      while (queue.length) {
        const [x, y] = queue.pop();
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        for (const [nextX, nextY] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (
            !state[nextY]?.[nextX] ||
            visited[nextY]?.[nextX]
          )
            continue;
          visited[nextY][nextX] = true;
          queue.push([nextX, nextY]);
        }
      }
      areas.push({
        x: minX * gridSize,
        y: minY * gridSize,
        width: (maxX - minX + 1) * gridSize,
        height: (maxY - minY + 1) * gridSize,
      });
    }
  }
  return areas;
}

function drawCanvasKnockbackPattern(
  ctx,
  x,
  y,
  halfExtent,
  gridSize,
  alpha,
) {
  const reach = Math.min(halfExtent * 0.82, gridSize * 3);
  const ringCount = reach >= gridSize * 1.75 ? 3 : 2;
  const innerRadius = Math.min(gridSize * 0.85, reach * 0.7);
  const colors = ["#fff4bd", "#ffd166", "#ff5a36"];
  for (let ring = 0; ring < ringCount; ring++) {
    const chevronCount = ring === 0 ? 8 : ringCount === 3 ? 12 : 10;
    const radius =
      innerRadius +
      (ringCount === 1
        ? 0
        : (ring / (ringCount - 1)) * Math.max(0, reach - innerRadius));
    for (let index = 0; index < chevronCount; index++) {
      const angle = (index / chevronCount) * Math.PI * 2;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      drawCanvasChevron(
        ctx,
        x + ux * radius,
        y + uy * radius,
        ux,
        uy,
        gridSize * (ring === 0 ? 0.26 : ringCount === 3 ? 0.3 : 0.32),
        colors[ring],
        ring === 0 ? 1 : alpha,
      );
    }
  }
  ctx.globalAlpha = 1;
}

function drawCanvasChevron(ctx, x, y, ux, uy, size, color, alpha) {
  const px = -uy;
  const py = ux;
  const tipX = x + ux * size * 0.5;
  const tipY = y + uy * size * 0.5;
  const backX = x - ux * size * 0.5;
  const backY = y - uy * size * 0.5;
  const notchX = x + ux * size * 0.12;
  const notchY = y + uy * size * 0.12;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + px * size * 0.5, backY + py * size * 0.5);
  ctx.lineTo(backX + px * size * 0.22, backY + py * size * 0.22);
  ctx.lineTo(notchX, notchY);
  ctx.lineTo(backX - px * size * 0.22, backY - py * size * 0.22);
  ctx.lineTo(backX - px * size * 0.5, backY - py * size * 0.5);
  ctx.closePath();
  ctx.fill();
}

function drawCanvasStackChevrons(
  ctx,
  x,
  y,
  ux,
  uy,
  chevronLength,
  step,
  alpha,
) {
  const colors = ["#d9362b", "#f06a2a", "#ffcf35", "#ffffff"];
  for (let index = 0; index < colors.length; index++) {
    const cx = x + ux * index * step;
    const cy = y + uy * index * step;
    const length = chevronLength;
    const px = -uy;
    const py = ux;
    const tipX = cx + ux * length * 0.5;
    const tipY = cy + uy * length * 0.5;
    const backX = cx - ux * length * 0.5;
    const backY = cy - uy * length * 0.5;
    const notchX = cx + ux * length * 0.12;
    const notchY = cy + uy * length * 0.12;
    ctx.globalAlpha = index === colors.length - 1 ? 1 : alpha;
    ctx.fillStyle = colors[index];
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(backX + px * length * 0.5, backY + py * length * 0.5);
    ctx.lineTo(backX + px * length * 0.22, backY + py * length * 0.22);
    ctx.lineTo(notchX, notchY);
    ctx.lineTo(backX - px * length * 0.22, backY - py * length * 0.22);
    ctx.lineTo(backX - px * length * 0.5, backY - py * length * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCanvasTankbusterCautionRing(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = size * 0.14;
  for (const radius of [size * 0.65, size]) {
    ctx.strokeStyle = "#ff315f";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#220000";
    ctx.setLineDash([size * 0.22, size * 0.22]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanvasTankbusterChevron(ctx, x, y, size) {
  const halfWidth = size * 0.65;
  const thickness = size * 0.28;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#f5f5f5";
  ctx.strokeStyle = "#ff315f";
  ctx.lineWidth = Math.max(2, size * 0.1);
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, y - thickness);
  ctx.lineTo(x, y + halfWidth * 0.65);
  ctx.lineTo(x + halfWidth, y - thickness);
  ctx.lineTo(x + halfWidth - thickness, y - thickness * 2);
  ctx.lineTo(x, y + halfWidth * 0.65 - thickness * 1.4);
  ctx.lineTo(x - halfWidth + thickness, y - thickness * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function registerMarkerHooks() {
  Hooks.on("preUpdateRegion", (region, changes) => {
    const marker = region.getFlag("ffxiv", "markerPlacement");
    if (!marker) return;
    const updates = foundry.utils.expandObject(changes);
    if (foundry.utils.hasProperty(updates, "attachment.token")) {
      foundry.utils.setProperty(
        changes,
        "flags.ffxiv.markerPlacement.targeted",
        Boolean(updates.attachment.token),
      );
    }
    const markerChanges = updates.flags?.ffxiv?.markerPlacement;
    if (markerChanges && ("type" in markerChanges || "mode" in markerChanges)) {
      changes.color = getMarkerColor({
        ...marker,
        type: marker.type ?? (Number(region.color) === 0x66ffff ? "allied" : "enemy"),
        ...markerChanges,
      });
    }
  });

  Hooks.on("updateRegion", (region, changes, _options, userId) => {
    if (userId !== game.user.id || !region.getFlag("ffxiv", "markerPlacement"))
      return;
    const opacity = foundry.utils.expandObject(changes).flags?.ffxiv?.markerPlacement?.opacity;
    if (opacity === undefined) return;
    game.settings
      .set("ffxiv", "markerOpacity", opacity)
      .catch((err) => debugError("Failed to save marker opacity:", err));
  });

  Hooks.on("drawRegion", (region) => {
    drawRegionMarkerOverlay(region);
  });

  Hooks.on("refreshRegion", (region) => {
    drawRegionMarkerOverlay(region);
  });

  Hooks.on("destroyRegion", (region) => {
    region[FFXIV_REGION_MARKER_OVERLAY]?.destroy();
    region[FFXIV_REGION_MARKER_MASK]?.destroy();
    delete region[FFXIV_REGION_MARKER_OVERLAY];
    delete region[FFXIV_REGION_MARKER_MASK];
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    const regionMarkerTool = {
      name: "ffxivRegionMarker",
      title: game.i18n.localize("FFXIV.MarkerPlacement.Title"),
      icon: "fa-solid fa-bullseye",
      order: 1,
      visible: game.user?.hasPermission("REGION_CREATE"),
      button: true,
      toolclip: {
        heading: "FFXIV.MarkerPlacement.Toolclip.Heading",
        items: [
          { paragraph: "FFXIV.MarkerPlacement.Toolclip.Description" },
          {
            heading: "FFXIV.MarkerPlacement.Toolclip.Region",
            reference: "CONTROLS.Click",
          },
        ],
      },
      onChange: async (_event, active) => {
        if (!active) return;
        await openMarkerPlacementTool();
      },
    };
    const tools = {
      ffxivRegionMarker: regionMarkerTool,
      ffxivEditMarker: {
        name: "ffxivEditMarker",
        title: game.i18n.localize("FFXIV.MarkerPlacement.Edit.Title"),
        icon: "fa-solid fa-pen-to-square",
        order: 2,
        visible: game.user?.hasPermission("REGION_CREATE") || canvas.scene?.regions.some(
          (region) => region.getFlag("ffxiv", "markerPlacement")
            && region.canUserModify(game.user, "update"),
        ),
        button: true,
        onChange: async (_event, active) => {
          if (!active) return;
          await openMarkerEditTool();
        },
      },
      ffxivClearMarkers: {
        name: "ffxivClearMarkers",
        title: game.i18n.localize("FFXIV.MarkerPlacement.Clear.Title"),
        icon: "fa-solid fa-trash",
        order: 3,
        visible: game.user?.isGM,
        button: true,
        onChange: async (_event, active) => {
          if (!active) return;
          await clearPlacedMarkers();
        },
      },
    };

    if (game.user?.isGM) {
      tools.select = {
        ...controls.regions.tools.select,
        order: -1,
      };
      tools.ffxivLimitBreak = {
        name: "ffxivLimitBreak",
        title: game.i18n.localize("FFXIV.LimitBreak.Control"),
        icon: "fa-regular fa-swords",
        order: 0,
        visible: true,
        button: true,
        active: isLimitBreakActive(),
        onChange: async (_event, active) => {
          if (!active) return;
          await toggleLimitBreakGauge();
        },
      };
    }

    controls.ffxiv = {
      name: "ffxiv",
      title: "Final Fantasy XIV Tools",
      icon: "ffxiv-control-icon",
      layer: game.user?.isGM ? "regions" : undefined,
      activeTool: game.user?.isGM ? "select" : undefined,
      onChange: (_event, active) => {
        if (!active || !game.user?.isGM || canvas.regions.active) return;
        canvas.regions.activate();
        ui.controls.activate({ control: "ffxiv", tool: "select" });
      },
      onToolChange: () => {
        if (game.user?.isGM) canvas.regions.setAllRenderFlags({ refreshState: true });
      },
      order:
        Number(controls.tokens?.order ?? controls.token?.order ?? 2) + 0.1,
      visible: Object.values(tools).some((tool) => tool.visible),
      tools,
    };
  });
}
