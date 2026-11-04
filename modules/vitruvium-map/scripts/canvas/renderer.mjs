import { resolveStyle } from "../data/store.mjs";
import {
  catmullRom, meander, ribbon, dashPolyline, cellsOutline, groupRings, labelPoint, midpoint,
  pointInRings, distToPolyline, dist, flat, bounds
} from "../geometry/geometry.mjs";

const color = c => {
  try { return foundry.utils.Color.from(c ?? "#ffffff").valueOf(); }
  catch { return 0xffffff; }
};

/* ---------------------------------------------------------------- */
/*  Геометрия элементов в координатах сцены                          */
/* ---------------------------------------------------------------- */

/** Сглаженная кривая линии с извилистостью. Кэшируется по ключу. */
export function lineCurve(state, style) {
  const pts = state.system.geometry?.points ?? [];
  if ( pts.length < 2 ) return pts;
  return catmullRom(meander(pts, style.meander ?? 0, state.id), 6);
}

/** Многоугольник клетки сетки. */
function cellPolygon(i, j) {
  return canvas.grid.getVertices({ i, j }).map(p => [p.x, p.y]);
}

/* Clipper работает с целыми числами, поэтому координаты умножаются на SCALE. */
const SCALE = 100;
const toClipper = ring => ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromClipper = path => path.map(p => [p.X / SCALE, p.Y / SCALE]);

function clip(type, subject, clipPaths, subjFill, clipFill) {
  const C = globalThis.ClipperLib;
  const c = new C.Clipper();
  c.AddPaths(subject.map(toClipper), C.PolyType.ptSubject, true);
  if ( clipPaths.length ) c.AddPaths(clipPaths.map(toClipper), C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(type, out, subjFill, clipFill);
  return out.map(fromClipper);
}

/** Форма области без учёта соседей: клетки плюс свободные куски. Кольца с правильным обходом. */
export function areaOwnRings(state) {
  const g = state.system.geometry ?? {};
  const cells = (g.cells ?? []).map(([i, j]) => cellPolygon(i, j));
  const cellRings = cells.length ? cellsOutline(cells) : [];
  const shapes = (g.shapes ?? []).filter(s => s.length >= 3);
  const C = globalThis.ClipperLib;
  if ( !C ) return cellRings.concat(shapes);
  const EO = C.PolyFillType.pftEvenOdd, NZ = C.PolyFillType.pftNonZero;
  // Клетки нормализуем по чётно-нечётному правилу (дыры в них уже идут обратным обходом).
  // Свободные куски хранятся с согласованным обходом (дыры — обратным), их складываем по ненулевому.
  // В конце всё вместе по ненулевому правилу, чтобы перекрытие клеток и куска не вырезалось.
  const parts = [];
  if ( cellRings.length ) parts.push(...clip(C.ClipType.ctUnion, cellRings, [], EO, EO));
  if ( shapes.length ) parts.push(...clip(C.ClipType.ctUnion, shapes, [], NZ, NZ));
  if ( !parts.length ) return [];
  return clip(C.ClipType.ctUnion, parts, [], NZ, NZ);
}

/**
 * Видимые формы областей с учётом замены.
 * Внутри одного слоя и одного типа области идут по sort: область с blend = replace
 * вырезает себя из всех, что ниже. Данные при этом не меняются.
 */
export function visibleAreaRings(areas, ownCache) {
  const C = globalThis.ClipperLib;
  const out = new Map();
  const groups = new Map();
  for ( const a of areas ) {
    const k = `${a.system.layerId}|${a.system.typeId}`;
    if ( !groups.has(k) ) groups.set(k, []);
    groups.get(k).push(a);
  }
  for ( const list of groups.values() ) {
    list.sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0) || a.id.localeCompare(b.id));
    for ( let n = 0; n < list.length; n++ ) {
      const own = ownCache(list[n]);
      const cutters = list.slice(n + 1).filter(b => b.system.blend !== "overlay").flatMap(b => ownCache(b));
      if ( !C || !cutters.length || !own.length ) { out.set(list[n].id, own); continue; }
      const NZ = C.PolyFillType.pftNonZero;
      out.set(list[n].id, clip(C.ClipType.ctDifference, own, cutters, NZ, NZ));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/*  Рисование                                                        */
/* ---------------------------------------------------------------- */

function makeLabel(text, size, fill) {
  const PreciseText = foundry.canvas.containers.PreciseText;
  const style = PreciseText.getTextStyle({ fontSize: size, fill: color(fill), strokeThickness: Math.max(3, size / 6), stroke: 0x111111 });
  const t = new PreciseText(text ?? "", style);
  t.anchor.set(0.5, 0.5);
  return t;
}

function drawRings(g, rings) {
  for ( const shape of groupRings(rings) ) {
    g.drawPolygon(flat(shape.outer));
    for ( const h of shape.holes ) {
      g.beginHole();
      g.drawPolygon(flat(h));
      g.endHole();
    }
  }
}

/**
 * Рисует все элементы карты в один контейнер.
 * Кэш собственных форм областей живёт между перерисовками и сбрасывается по изменению элемента.
 */
export default class MapRenderer {
  constructor() {
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.areasLayer = this.container.addChild(new PIXI.Container());
    this.linesLayer = this.container.addChild(new PIXI.Container());
    this.objectsLayer = this.container.addChild(new PIXI.Container());
    this.ghostLayer = this.container.addChild(new PIXI.Container());
    this.labelsLayer = this.container.addChild(new PIXI.Container());
    this.selectLayer = this.container.addChild(new PIXI.Container());
    this.areasLayer.zIndex = 0; this.linesLayer.zIndex = 1; this.objectsLayer.zIndex = 2;
    this.ghostLayer.zIndex = 3; this.labelsLayer.zIndex = 4; this.selectLayer.zIndex = 5;
    /** id → { key, rings } */
    this._own = new Map();
    /** Последние данные для попаданий мышью. */
    this.hit = { objects: [], lines: [], areas: [] };
    this.visible = new Map();
  }

  destroy() {
    this.container.destroy({ children: true });
  }

  _ownRings(state) {
    const g = state.system.geometry ?? {};
    const k = JSON.stringify([g.cells, g.shapes, canvas.grid?.size, canvas.grid?.type]);
    const cached = this._own.get(state.id);
    if ( cached?.key === k ) return cached.rings;
    const rings = areaOwnRings(state);
    this._own.set(state.id, { key: k, rings });
    return rings;
  }

  /**
   * Полная перерисовка.
   * states — Map id → состояние; types, layers — из атласа; ghosts — [{ state, mode }].
   */
  draw(states, { types, layers, ghosts = [], selectedId = null }) {
    for ( const l of [this.areasLayer, this.linesLayer, this.objectsLayer, this.ghostLayer, this.labelsLayer, this.selectLayer] ) {
      for ( const c of l.removeChildren() ) c.destroy({ children: true });
    }
    const layerOrder = new Map(layers.map((l, i) => [l.id, i]));
    const hidden = new Set(layers.filter(l => l.visible === false).map(l => l.id));
    const all = [...states.values()];
    const areas = all.filter(s => s.system.kind === "area" && !hidden.has(s.system.layerId))
      .sort((a, b) => (layerOrder.get(a.system.layerId) ?? 99) - (layerOrder.get(b.system.layerId) ?? 99) || (a.system.sort ?? 0) - (b.system.sort ?? 0));
    const lines = all.filter(s => s.system.kind === "line");
    const objects = all.filter(s => s.system.kind === "object");

    // Чистим кэш от удалённых.
    for ( const id of this._own.keys() ) if ( !states.has(id) ) this._own.delete(id);
    this.visible = visibleAreaRings(areas, s => this._ownRings(s));

    this.hit = { objects: [], lines: [], areas: [] };
    for ( const a of areas ) this._drawArea(a, resolveStyle(a, types));
    for ( const l of lines ) this._drawLine(l, resolveStyle(l, types));
    for ( const o of objects ) this._drawObject(o, resolveStyle(o, types));
    for ( const gh of ghosts ) this._drawGhost(gh.state, gh.mode, types);
    if ( selectedId && states.has(selectedId) ) this._drawSelection(states.get(selectedId), types);
  }

  _drawArea(state, style) {
    const rings = this.visible.get(state.id) ?? [];
    if ( !rings.length ) return;
    const g = new PIXI.Graphics();
    g.beginFill(color(style.color), style.alpha ?? 0.3);
    drawRings(g, rings);
    g.endFill();
    if ( style.borderWidth > 0 ) {
      g.lineStyle({ width: style.borderWidth, color: color(style.borderColor ?? style.color), alpha: style.borderAlpha ?? 1, join: PIXI.LINE_JOIN.ROUND });
      for ( const r of rings ) g.drawPolygon(flat(r));
    }
    this.areasLayer.addChild(g);
    const p = labelPoint(rings);
    if ( p && state.name ) {
      const t = makeLabel(state.name, style.labelSize ?? 28, style.labelColor);
      t.position.set(p[0], p[1]);
      this.labelsLayer.addChild(t);
    }
    this.hit.areas.push({ id: state.id, rings });
  }

  _drawLine(state, style) {
    const curve = lineCurve(state, style);
    if ( curve.length < 2 ) return;
    const g = new PIXI.Graphics();
    const dashed = style.dash > 0 && style.gap > 0;
    const wMax = Math.max(style.widthStart ?? 2, style.widthEnd ?? 2);
    if ( style.outlineWidth > 0 ) {
      g.lineStyle({ width: wMax + (2 * style.outlineWidth), color: color(style.outlineColor), alpha: style.alpha ?? 1, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND });
      g.moveTo(...curve[0]);
      for ( const p of curve.slice(1) ) g.lineTo(...p);
    }
    if ( dashed ) {
      g.lineStyle({ width: wMax, color: color(style.color), alpha: style.alpha ?? 1, cap: PIXI.LINE_CAP.BUTT });
      for ( const part of dashPolyline(curve, style.dash, style.gap) ) {
        g.moveTo(...part[0]);
        for ( const p of part.slice(1) ) g.lineTo(...p);
      }
    } else if ( (style.widthStart ?? 2) !== (style.widthEnd ?? 2) ) {
      g.lineStyle(0);
      g.beginFill(color(style.color), style.alpha ?? 1);
      g.drawPolygon(flat(ribbon(curve, style.widthStart ?? 2, style.widthEnd ?? 2)));
      g.endFill();
    } else {
      g.lineStyle({ width: wMax, color: color(style.color), alpha: style.alpha ?? 1, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND });
      g.moveTo(...curve[0]);
      for ( const p of curve.slice(1) ) g.lineTo(...p);
    }
    this.linesLayer.addChild(g);
    const m = midpoint(curve);
    if ( m && state.name && style.labelSize > 0 ) {
      const t = makeLabel(state.name, style.labelSize, style.labelColor);
      t.position.set(m[0], m[1] - wMax - (style.labelSize * 0.6));
      this.labelsLayer.addChild(t);
    }
    this.hit.lines.push({ id: state.id, curve, width: wMax });
  }

  _drawObject(state, style) {
    const { x = 0, y = 0 } = state.system.geometry ?? {};
    const size = style.size ?? 48;
    const c = new PIXI.Container();
    c.position.set(x, y);
    const bg = new PIXI.Graphics();
    bg.beginFill(0x111111, 0.55).lineStyle(2, color(style.color), 0.9).drawCircle(0, 0, size * 0.55).endFill();
    c.addChild(bg);
    if ( style.icon ) {
      const tex = foundry.canvas.getTexture?.(style.icon);
      const sprite = new PIXI.Sprite(tex ?? PIXI.Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.width = sprite.height = size * 0.75;
      sprite.tint = color(style.color);
      c.addChild(sprite);
      if ( !tex ) {
        foundry.canvas.loadTexture(style.icon).then(t => {
          if ( !t || sprite.destroyed ) return;
          sprite.texture = t;
          sprite.width = sprite.height = size * 0.75;
        }).catch(() => {});
      }
    }
    this.objectsLayer.addChild(c);
    if ( state.name ) {
      const t = makeLabel(state.name, style.labelSize ?? 22, style.labelColor);
      t.position.set(x, y + (size * 0.55) + ((style.labelSize ?? 22) * 0.7));
      this.labelsLayer.addChild(t);
    }
    this.hit.objects.push({ id: state.id, x, y, r: size * 0.55 });
  }

  /** Призрак правки: create — зелёный, update — жёлтый, delete — красный. */
  _drawGhost(state, mode, types) {
    const tint = { create: 0x5fcf6f, update: 0xe8c27a, delete: 0xff6a5a }[mode] ?? 0xffffff;
    const style = resolveStyle(state, types);
    const g = new PIXI.Graphics();
    const kind = state.system.kind;
    if ( kind === "area" ) {
      const rings = this._ownRings(state);
      g.beginFill(tint, 0.18);
      drawRings(g, rings);
      g.endFill();
      g.lineStyle({ width: 4, color: tint, alpha: 0.95 });
      for ( const r of rings ) g.drawPolygon(flat(r));
    } else if ( kind === "line" ) {
      const curve = lineCurve(state, style);
      if ( curve.length >= 2 ) {
        g.lineStyle({ width: Math.max(style.widthStart ?? 2, style.widthEnd ?? 2) + 8, color: tint, alpha: 0.55, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
        g.moveTo(...curve[0]);
        for ( const p of curve.slice(1) ) g.lineTo(...p);
      }
    } else {
      const { x = 0, y = 0 } = state.system.geometry ?? {};
      g.lineStyle({ width: 4, color: tint, alpha: 0.95 }).drawCircle(x, y, ((style.size ?? 48) * 0.55) + 8);
    }
    this.ghostLayer.addChild(g);
  }

  _drawSelection(state, types) {
    const style = resolveStyle(state, types);
    const g = new PIXI.Graphics();
    const sel = 0xffffff;
    const kind = state.system.kind;
    if ( kind === "object" ) {
      const { x = 0, y = 0 } = state.system.geometry ?? {};
      g.lineStyle({ width: 2, color: sel, alpha: 0.9 }).drawCircle(x, y, ((style.size ?? 48) * 0.55) + 6);
    } else if ( kind === "line" ) {
      for ( const [x, y] of state.system.geometry?.points ?? [] ) {
        g.lineStyle({ width: 2, color: 0x111111 }).beginFill(sel, 1).drawCircle(x, y, 7).endFill();
      }
    } else {
      const rings = this.visible.get(state.id) ?? this._ownRings(state);
      g.lineStyle({ width: 3, color: sel, alpha: 0.9 });
      for ( const r of rings ) g.drawPolygon(flat(r));
    }
    this.selectLayer.addChild(g);
  }

  /** Что лежит под точкой: объект, потом линия, потом верхняя область. */
  hitTest(pt, tolerance = 8) {
    const p = [pt.x, pt.y];
    const o = this.hit.objects.findLast(h => dist(p, [h.x, h.y]) <= h.r + 2);
    if ( o ) return o.id;
    const l = this.hit.lines.findLast(h => distToPolyline(p, h.curve) <= (h.width / 2) + tolerance);
    if ( l ) return l.id;
    const a = this.hit.areas.findLast(h => pointInRings(p, h.rings));
    return a?.id ?? null;
  }

  /** Границы элемента в координатах сцены, чтобы навести камеру. */
  boundsOf(state, types) {
    const kind = state.system.kind;
    if ( kind === "object" ) {
      const { x = 0, y = 0 } = state.system.geometry ?? {};
      return { x: x - 100, y: y - 100, width: 200, height: 200 };
    }
    if ( kind === "line" ) return bounds(state.system.geometry?.points ?? []);
    return bounds((this.visible.get(state.id) ?? this._ownRings(state)).flat());
  }
}
