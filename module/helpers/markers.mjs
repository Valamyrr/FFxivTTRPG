import { debugError } from "./debug.mjs";
import { isLimitBreakActive, toggleLimitBreakGauge } from "./limit-break-hud.mjs";
import { emitToActiveGM, getActiveGM } from "./socket.mjs";
import { getHookHTMLElement } from "./ui.mjs";

export const FFXIV_MARKER_SOCKET_TYPE = "placeMarkerTile";
const FFXIV_REGION_MARKER_OVERLAY = Symbol("ffxivRegionMarkerOverlay");
const FFXIV_REGION_MARKER_MASK = Symbol("ffxivRegionMarkerMask");
const markerDialogs = new WeakSet();
let activeRegionMarkerRotation = null;

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

async function openMarkerPlacementTool(assignedMarker = null) {
  if (!canvas.scene) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"),
    );
    return;
  }

  const marker = assignedMarker ?? (await configureMarkerShape());
  if (!marker) return;

  const gridSize = canvas.grid.size;
  const rendered = renderMarkerDataUrl(marker, gridSize);
  if (!rendered) {
    ui.notifications.warn(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.EmptyShape"),
    );
    return;
  }

  try {
    if (marker.targeted) {
      ui.notifications.info(
        game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToken"),
      );
      const target = await previewTargetedMarkerPlacement(rendered);
      if (!target) return;
      await requestMarkerTileCreation({
        texture: createMarkerTileTexture(rendered.src),
        x: target.x,
        y: target.y,
        width: rendered.width,
        height: rendered.height,
        z: 100,
        rotation: 0,
        hidden: false,
        locked: false,
        flags: {
          ffxiv: {
            markerPlacement: {
              mode: marker.mode,
              targeted: true,
              tokenId: target.token.document.id,
            },
          },
        },
      });
      return;
    }

    ui.notifications.info(
      game.i18n.localize("FFXIV.MarkerPlacement.Instructions.ClickToPlace"),
    );
    const position = await previewMarkerPlacement(rendered);
    if (!position) return;
    await requestMarkerTileCreation({
      texture: createMarkerTileTexture(rendered.src),
      x: position.x,
      y: position.y,
      width: rendered.width,
      height: rendered.height,
      z: 100,
      rotation: 0,
      hidden: false,
      locked: false,
      flags: {
        ffxiv: {
          markerPlacement: {
            mode: marker.mode,
            targeted: false,
          },
        },
      },
    });
  } catch (err) {
    debugError("Marker placement failed:", err);
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.TileFailed"),
    );
  }
}

export async function openRegionMarkerPlacementTool(assignedMarker = null) {
  if (!canvas.scene) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoScene"),
    );
    return false;
  }

  const marker = assignedMarker ?? (await configureMarkerShape({ region: true }));
  if (!marker) return false;
  const bounds = getMarkerBounds(marker.state);
  if (!bounds) {
    ui.notifications.warn(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.EmptyShape"),
    );
    return false;
  }

  const gridSize = canvas.grid.size;
  const widthCells = bounds.maxX - bounds.minX + 1;
  const heightCells = bounds.maxY - bounds.minY + 1;
  const centerX = Math.floor(widthCells / 2);
  const centerY = Math.floor(heightCells / 2);
  let placementShape;
  if (marker.shape === "circle") {
    placementShape = {
      type: "circle",
      x: 0,
      y: 0,
      radius: marker.radius * gridSize,
      gridBased: false,
    };
  } else {
    const baseOffset = canvas.grid.getOffset({ x: 0, y: 0 });
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
    placementShape = {
      type: "grid",
      offsets,
      origin: { x: 0, y: 0 },
    };
  }
  const color =
    marker.mode === "tankbuster"
      ? "#b22222"
      : marker.type === "enemy"
        ? "#ffa500"
        : "#66ffff";
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
      create: false,
      allowRotation: true,
      attachToToken: marker.targeted,
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
    if (!placement) return false;

    const shapes = placement.shapes.flatMap(simplifyPlacedMarkerShape);
    const regionData = createMarkerRegionData({
      marker,
      color,
      shapes,
      attachment: placement.attachment.token?.id ?? null,
      levels: Array.from(placement.levels),
      hidden: placement.hidden,
    });
    await canvas.scene.createEmbeddedDocuments("Region", [regionData], {
      controlObject: true,
    });
    return true;
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

function simplifyPlacedMarkerShape(shape) {
  if (shape.type !== "grid" || !canvas.grid.isSquare) {
    return [shape.toObject()];
  }

  const origin = { x: shape.origin.x, y: shape.origin.y };
  const polygons = Array.from(shape.polygonTree, (node) => ({
    type: "polygon",
    points: simplifyMarkerPolygonPoints(node.points),
    origin,
    hole: node.isHole,
  })).filter((polygon) => polygon.points.length >= 6);
  return polygons.length ? polygons : [shape.toObject()];
}

function simplifyMarkerPolygonPoints(points) {
  const vertices = [];
  for (let index = 0; index < points.length; index += 2) {
    const vertex = {
      x: Math.round(points[index] * 1000) / 1000,
      y: Math.round(points[index + 1] * 1000) / 1000,
    };
    const previous = vertices.at(-1);
    if (previous?.x === vertex.x && previous.y === vertex.y) continue;
    vertices.push(vertex);
  }
  if (
    vertices.length > 1
    && vertices[0].x === vertices.at(-1).x
    && vertices[0].y === vertices.at(-1).y
  ) {
    vertices.pop();
  }
  if (vertices.length <= 3) return vertices.flatMap(({ x, y }) => [x, y]);

  return vertices
    .filter((vertex, index) => {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const next = vertices[(index + 1) % vertices.length];
      return Math.abs(
        (vertex.x - previous.x) * (next.y - vertex.y)
        - (vertex.y - previous.y) * (next.x - vertex.x),
      ) > 0.001;
    })
    .flatMap(({ x, y }) => [x, y]);
}

function createMarkerRegionData({
  marker,
  color,
  shape,
  shapes,
  attachment = null,
  levels = [canvas.level.id],
  hidden = false,
}) {
  return {
    name: game.i18n.localize("FFXIV.MarkerPlacement.RegionName"),
    color,
    shapes: shapes ?? [shape],
    levels,
    attachment: { token: attachment },
    restriction: { enabled: false },
    highlightMode: "shapes",
    displayMeasurements: false,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    hidden,
    ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: {
      ffxiv: {
        markerPlacement: {
          mode: marker.mode,
          targeted: marker.targeted,
          followRotation: marker.followRotation,
          opacity: marker.opacity,
        },
      },
    },
  };
}

function drawRegionMarkerOverlay(region) {
  const marker = region.document.getFlag("ffxiv", "markerPlacement");
  let overlay = region[FFXIV_REGION_MARKER_OVERLAY];
  if (!marker) {
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
  drawRegionMarkerMask(mask, region.document.shapes);
  overlay.mask = mask;
  overlay.clear();
  overlay.eventMode = "none";

  const bounds = region.bounds;
  if (!bounds.width || !bounds.height) return;
  const alpha = Math.max(0.35, Number(marker.opacity) || 0.8);

  for (const area of getRegionMarkerAreas(region.document.shapes, bounds)) {
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

function getRegionMarkerAreas(shapes, fallback) {
  if (shapes.length === 1 && shapes[0].type === "circle") {
    const shape = shapes[0];
    return [{
      x: shape.x - shape.radius,
      y: shape.y - shape.radius,
      width: shape.radius * 2,
      height: shape.radius * 2,
    }];
  }

  const rectangles = shapes
    .filter((shape) => shape.type === "rectangle" && !shape.hole)
    .map((shape) => ({
      x: shape.x - shape.width * shape.anchorX,
      y: shape.y - shape.height * shape.anchorY,
      width: shape.width,
      height: shape.height,
    }));
  if (rectangles.length) return mergeConnectedMarkerAreas(rectangles);

  const polygons = shapes
    .filter((shape) => shape.type === "polygon" && !shape.hole)
    .map((shape) => {
      const points = shape.points;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let index = 0; index < points.length; index += 2) {
        minX = Math.min(minX, points[index]);
        minY = Math.min(minY, points[index + 1]);
        maxX = Math.max(maxX, points[index]);
        maxY = Math.max(maxY, points[index + 1]);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    });
  if (polygons.length) return polygons;

  const gridShape = shapes.find((shape) => shape.type === "grid");
  if (gridShape) {
    const cells = gridShape.offsets.map((offset) => {
      const center = canvas.grid.getCenterPoint(offset);
      return {
        x: center.x - canvas.grid.sizeX / 2,
        y: center.y - canvas.grid.sizeY / 2,
        width: canvas.grid.sizeX,
        height: canvas.grid.sizeY,
      };
    });
    return mergeConnectedMarkerAreas(cells);
  }
  return [fallback];
}

function mergeConnectedMarkerAreas(rectangles) {
  const parents = rectangles.map((_, index) => index);
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const overlaps = (a, b) => {
    const overlapX =
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY =
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return (
      (overlapX > 0 && overlapY >= 0) ||
      (overlapY > 0 && overlapX >= 0)
    );
  };
  for (let left = 0; left < rectangles.length; left++) {
    for (let right = left + 1; right < rectangles.length; right++) {
      if (overlaps(rectangles[left], rectangles[right])) union(left, right);
    }
  }

  const bounds = new Map();
  for (let index = 0; index < rectangles.length; index++) {
    const area = rectangles[index];
    const root = find(index);
    const current = bounds.get(root);
    if (!current) {
      bounds.set(root, {
        minX: area.x,
        minY: area.y,
        maxX: area.x + area.width,
        maxY: area.y + area.height,
      });
      continue;
    }
    current.minX = Math.min(current.minX, area.x);
    current.minY = Math.min(current.minY, area.y);
    current.maxX = Math.max(current.maxX, area.x + area.width);
    current.maxY = Math.max(current.maxY, area.y + area.height);
  }
  return Array.from(bounds.values(), ({ minX, minY, maxX, maxY }) => ({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }));
}

function drawRegionMarkerMask(graphics, shapes) {
  graphics.clear();
  graphics.beginFill(0xffffff);
  for (const shape of shapes.filter((entry) => !entry.hole)) {
    shape.drawShape(graphics);
  }
  for (const shape of shapes.filter((entry) => entry.hole)) {
    graphics.beginHole();
    shape.drawShape(graphics);
    graphics.endHole();
  }
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

async function requestMarkerTileCreation(tileData) {
  if (game.user.isGM)
    return createMarkerTileFromRequest({
      sceneId: canvas.scene.id,
      tileData,
    });

  const gm = getActiveGM();
  if (!gm) {
    ui.notifications.error(
      game.i18n.localize("FFXIV.MarkerPlacement.Errors.NoGM"),
    );
    return null;
  }

  emitToActiveGM({
    type: FFXIV_MARKER_SOCKET_TYPE,
    userName: game.user.name,
    gmUserId: gm.id,
    data: {
      sceneId: canvas.scene.id,
      tileData,
    },
  });
  ui.notifications.info(
    game.i18n.localize("FFXIV.MarkerPlacement.Instructions.RequestSent"),
  );
  return null;
}

export async function createMarkerTileFromRequest({ sceneId, tileData }) {
  return createMarkerTile(sceneId, foundry.utils.deepClone(tileData));
}

function createMarkerTileTexture(src) {
  return {
    src,
    anchorX: 0,
    anchorY: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

async function createMarkerTile(sceneId, tileData) {
  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found.`);
  const result = await scene.createEmbeddedDocuments("Tile", [tileData]);
  return result[0] ?? null;
}

async function configureMarkerShape({ region = false } = {}) {
  const size = 15;
  const center = Math.floor(size / 2);
  const state = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  for (let y = center - 2; y <= center + 2; y++) {
    for (let x = center - 2; x <= center + 2; x++) state[y][x] = true;
  }
  const geometry = { shape: "grid", radius: null };
  let selection = {
    state,
    opacity: 0.8,
    type: "enemy",
    mode: "standard",
    targeted: false,
    followRotation: true,
    shape: "grid",
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
            <option value="enemy" selected>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Enemy")}</option>
            <option value="allied">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Ally")}</option>
          </select>
        </div>
        ${region ? "" : `<div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Opacity")}</label>
          <input type="range" id="ffxiv-marker-opacity" min="0" max="100" value="80">
          <span id="ffxiv-marker-opacity-value">80%</span>
        </div>`}
        <div class="ffxiv-marker-row" style="display: flex; align-items: center; gap: 8px;">
          <label>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Mode")}</label>
          <select id="ffxiv-marker-mode">
            <option value="standard" selected>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Standard")}</option>
            <option value="stack">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Stack")}</option>
            <option value="knockback">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Knockback")}</option>
            <option value="tankbuster">${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Tankbuster")}</option>
          </select>
        </div>
        <label class="ffxiv-marker-checkbox">
          <span class="ffxiv-marker-checkbox-control">
            <input type="checkbox" id="ffxiv-marker-targeted">
            <span class="checkmark"></span>
          </span>
          <span>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Targeted")}</span>
        </label>
        ${region ? `<label class="ffxiv-marker-checkbox">
          <span class="ffxiv-marker-checkbox-control">
            <input type="checkbox" id="ffxiv-marker-follow-rotation" checked disabled>
            <span class="checkmark"></span>
          </span>
          <span>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.FollowRotation")}</span>
        </label>
        <label class="ffxiv-marker-checkbox">
          <span class="ffxiv-marker-checkbox-control">
            <input type="checkbox" id="ffxiv-marker-circle">
            <span class="checkmark"></span>
          </span>
          <span>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Circle")}</span>
        </label>` : ""}
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
        ${region ? `<strong>${game.i18n.localize("FFXIV.MarkerPlacement.Custom.Title")}</strong>
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
        </div>` : ""}
        <strong>${game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Presets")}</strong>
	        <div class="ffxiv-marker-presets" style="display: flex; flex-direction: column; gap: 8px;">
	          <div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-span="1" data-mode="standard">Standard 3x3</button>
	            <button type="button" data-span="2" data-mode="standard">Standard 5x5</button>
	          </div>
	          ${region ? "" : `<div class="ffxiv-marker-preset-row" style="display: flex; gap: 8px;">
	            <button type="button" data-circle-span="2" data-mode="standard">Circle 5x5</button>
	            <button type="button" data-circle-span="3" data-mode="standard">Circle 7x7</button>
	          </div>`}
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
      title: game.i18n.localize(
        region
          ? "FFXIV.MarkerPlacement.Title"
          : "FFXIV.MarkerPlacement.ClassicTitle",
      ),
      resizable: true,
    },
    position: { width: 760 },
    content: wrapper,
    buttons: [
      {
        action: "create",
        label: game.i18n.localize("FFXIV.MarkerPlacement.Dialog.Button.Place"),
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
  const previewContainer = preview.closest(".ffxiv-marker-preview");
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
  const getOpacity = () => (opacity ? Number(opacity.value) / 100 : 0.8);
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
  const updatePreview = () => {
    updateSelection();
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
    const image = new Image();
    image.onload = () => {
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
  const configureCirclePreset = (span, presetMode) => {
    geometry.shape = "circle";
    geometry.radius = span + 0.5;
    for (const row of state) row.fill(false);
    if (span === 1) {
      state[center][center] = true;
      state[center - 1][center] = true;
      state[center + 1][center] = true;
      state[center][center - 1] = true;
      state[center][center + 1] = true;
      mode.value = presetMode;
      type.disabled = presetMode === "tankbuster";
      updateCells();
      updatePreview();
      return;
    }
    const radius = span + 0.5;
    for (let y = center - span; y <= center + span; y++) {
      for (let x = center - span; x <= center + span; x++) {
        state[y][x] = Math.hypot(x - center, y - center) < radius;
      }
    }
    mode.value = presetMode;
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
  element
    .querySelectorAll("[data-circle-span][data-mode]")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        configureCirclePreset(
          Number(button.dataset.circleSpan),
          button.dataset.mode,
        );
      });
    });
  opacity?.addEventListener("input", () => {
    opacityValue.textContent = `${opacity.value}%`;
    updatePreview();
  });
  type.addEventListener("change", (event) => {
    event.stopPropagation();
    updateCells();
    updatePreview();
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
    ctx.globalAlpha = marker.opacity;
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    ctx.clip();
    drawMarkerOverlays(ctx, cropped, gridSize, marker);
    ctx.restore();
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

  ctx.globalAlpha = marker.opacity;
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
  drawMarkerOverlays(ctx, cropped, gridSize, marker);
  ctx.restore();
  return {
    src: canvasElement.toDataURL("image/webp"),
    width,
    height,
    widthCells,
    heightCells,
  };
}

function getMarkerBounds(state) {
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

async function previewMarkerPlacement(rendered) {
  const sprite = await createMarkerPreviewSprite(rendered);
  sprite.width = rendered.width;
  sprite.height = rendered.height;
  sprite.alpha = 0.65;
  sprite.eventMode = "none";
  canvas.stage.addChild(sprite);

  const snap = (event) => {
    const gridSize = canvas.grid.size;
    const pos = getCanvasEventPosition(event);
    const cellX = Math.floor(pos.x / gridSize);
    const cellY = Math.floor(pos.y / gridSize);
    sprite.x = (cellX - Math.floor(rendered.widthCells / 2)) * gridSize;
    sprite.y = (cellY - Math.floor(rendered.heightCells / 2)) * gridSize;
    return { x: sprite.x, y: sprite.y };
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onClick);
      canvas.stage.off("rightdown", onCancel);
      canvas.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    };
    const onMove = (event) => snap(event);
    const onClick = (event) => {
      const position = snap(event);
      cleanup();
      resolve(position);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.once("pointerdown", onClick);
    canvas.stage.once("rightdown", onCancel);
  });
}

async function previewTargetedMarkerPlacement(rendered) {
  const sprite = await createMarkerPreviewSprite(rendered);
  sprite.width = rendered.width;
  sprite.height = rendered.height;
  sprite.alpha = 0.65;
  sprite.eventMode = "none";
  sprite.visible = false;
  canvas.stage.addChild(sprite);

  const positionForEvent = (event) => {
    const pos = getCanvasEventPosition(event);
    const token = canvas.tokens.placeables.find(
      (placeable) =>
        pos.x >= placeable.x &&
        pos.x <= placeable.x + placeable.w &&
        pos.y >= placeable.y &&
        pos.y <= placeable.y + placeable.h,
    );
    if (token) {
      sprite.visible = true;
      sprite.x = token.x + token.w / 2 - rendered.width / 2;
      sprite.y = token.y + token.h / 2 - rendered.height / 2;
      return { token, x: sprite.x, y: sprite.y };
    }
    sprite.visible = false;
    return null;
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onClick);
      canvas.stage.off("rightdown", onCancel);
      canvas.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    };
    const onMove = (event) => positionForEvent(event);
    const onClick = (event) => {
      const target = positionForEvent(event);
      if (!target) return;
      cleanup();
      resolve(target);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.once("pointerdown", onClick);
    canvas.stage.once("rightdown", onCancel);
  });
}

async function createMarkerPreviewSprite(rendered) {
  const texture = PIXI.Texture.fromURL
    ? await PIXI.Texture.fromURL(rendered.src)
    : PIXI.Texture.from(rendered.src);
  return new PIXI.Sprite(texture);
}

function getCanvasEventPosition(event) {
  if (event.data?.getLocalPosition)
    return event.data.getLocalPosition(canvas.stage);
  if (event.getLocalPosition) return event.getLocalPosition(canvas.stage);
  if (event.global)
    return canvas.stage.worldTransform.applyInverse(event.global);
  return canvas.mousePosition;
}

function updateTargetedMarkersForToken(tokenDocument, tokenPosition) {
  const scene = tokenDocument.parent;
  if (!scene || canvas.scene?.id !== scene.id) return;
  for (const tile of scene.tiles) {
    const marker = tile.getFlag("ffxiv", "markerPlacement");
    if (!marker?.targeted || marker.tokenId !== tokenDocument.id) continue;
    const position = getCenteredMarkerPosition(tile, tokenPosition);
    tile
      .update({
        x: position.x,
        y: position.y,
      })
      .catch((err) => debugError("Failed to move targeted marker:", err));
  }
}

function getCenteredMarkerPosition(tile, tokenPosition) {
  const gridSize = canvas.grid.size;
  const tokenWidth = (tokenPosition.width ?? 1) * gridSize;
  const tokenHeight = (tokenPosition.height ?? 1) * gridSize;
  return {
    x: Math.round(tokenPosition.x + tokenWidth / 2 - tile.width / 2),
    y: Math.round(tokenPosition.y + tokenHeight / 2 - tile.height / 2),
  };
}

export function registerMarkerHooks() {
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

  Hooks.on("preUpdateToken", (token, changes, options) => {
    if (!("rotation" in changes)) return;
    const hasFixedMarker = Array.from(token.attachments.regions).some((region) => {
      const marker = region.getFlag("ffxiv", "markerPlacement");
      return marker?.targeted && marker.followRotation === false;
    });
    if (hasFixedMarker) options.ffxivPriorRotation = token.rotation;
  });

  Hooks.on("updateToken", async (token, changes, options) => {
    if (!("rotation" in changes) || !Number.isFinite(options.ffxivPriorRotation))
      return;
    const rotation = token.rotation - options.ffxivPriorRotation;
    if (!rotation) return;
    const pivot = token.getMovementOrigin(token._source);
    const updates = [];
    for (const region of token.attachments.regions) {
      const marker = region.getFlag("ffxiv", "markerPlacement");
      if (!marker?.targeted || marker.followRotation !== false) continue;
      updates.push({
        _id: region.id,
        shapes: region.shapes.map((source) => {
          const shape = source.clone();
          shape.rotate(-rotation, { pivot });
          return shape.toObject();
        }),
      });
    }
    if (updates.length)
      await token.parent.updateEmbeddedDocuments("Region", updates);
  });

  Hooks.on("renderSceneControls", (app, html) => {
    const element = getHookHTMLElement(html, app);
    const button = element?.querySelector?.(
      'button.tool[data-tool="ffxivRegionMarker"]',
    );
    if (!button || button.dataset.ffxivClassicMarkerBound) return;
    button.dataset.ffxivClassicMarkerBound = "true";
    button.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openMarkerPlacementTool();
    });
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    const regionMarkerTool = {
      name: "ffxivRegionMarker",
      title: game.i18n.localize("FFXIV.MarkerPlacement.RegionTitle"),
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
          {
            heading: "FFXIV.MarkerPlacement.Toolclip.Classic",
            reference: "CONTROLS.RightClick",
          },
        ],
      },
      onChange: async (_event, active) => {
        if (!active) return;
        await openRegionMarkerPlacementTool();
      },
    };
    const tools = {
      ffxivRegionMarker: regionMarkerTool,
      ffxivClearMarkers: {
        name: "ffxivClearMarkers",
        title: game.i18n.localize("FFXIV.MarkerPlacement.Clear.Title"),
        icon: "fa-solid fa-trash",
        order: 2,
        visible: game.user?.isGM,
        button: true,
        onChange: async (_event, active) => {
          if (!active) return;
          await clearPlacedMarkers();
        },
      },
    };

    if (game.user?.isGM) {
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
      order:
        Number(controls.regions?.order ?? controls.region?.order ?? 5) + 0.1,
      visible: Object.values(tools).some((tool) => tool.visible),
      tools,
    };
  });

  Hooks.on("moveToken", (tokenDocument, movement) => {
    if (!game.user.isGM) return;
    const destination = movement?.destination;
    if (!destination) return;
    updateTargetedMarkersForToken(tokenDocument, destination);
  });

  Hooks.on("updateToken", (tokenDocument, changes) => {
    if (!game.user.isGM) return;
    if (
      !("width" in changes || "height" in changes) ||
      "x" in changes ||
      "y" in changes
    )
      return;
    updateTargetedMarkersForToken(tokenDocument, tokenDocument);
  });
}
