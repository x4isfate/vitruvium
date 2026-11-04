import { MODULE_ID } from "../constants.mjs";
import {
  getAtlas, ensureAtlas, effectiveStates, atlasStates, getTypes, getLayers, getDraft, commit, pendingClaimOps
} from "../data/store.mjs";
import { draftOps, randomId } from "../review/ops.mjs";
import { simplify, roundPoints, pointInRing, dist, flat } from "../geometry/geometry.mjs";
import MapRenderer from "./renderer.mjs";
import MapPalette from "./palette.mjs";

const { InteractionLayer } = foundry.canvas.layers;

export const LAYER_NAME = "vitruviumMap";

/** Инструменты панели слева. */
export const TOOLS = ["select", "object", "line", "area", "erase"];

/**
 * Слой карты. Рисует атлас (с черновиком игрока поверх) и принимает мышь,
 * когда в панели слева выбрана группа «Карта мира».
 */
export default class MapLayer extends InteractionLayer {
  constructor() {
    super();
    this.renderer = null;
    this.preview = null;
    /** Выбранный элемент. */
    this.selectedId = null;
    /** Тип по умолчанию для нового элемента каждого вида и слой для новых областей. */
    this.choice = { object: null, line: null, area: null, layerId: null };
    /** Элементы, которые сейчас меняются мышью: id → состояние. */
    this.working = new Map();
    /** Призраки, которые показывает очередь мастера: [{ state, mode }]. */
    this.reviewGhosts = [];
    /** Точки рисуемой линии. */
    this.linePoints = [];
    this._drag = null;
    this._frame = null;
    this.palette = new MapPalette(this);
  }

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: LAYER_NAME, zIndex: 150 });
  }

  /** Группа инструментов в панели слева (Foundry 14 собирает их со слоёв). */
  static prepareSceneControls() {
    const t = (name, icon, order, extra = {}) => ({
      name, order, icon,
      title: `VMAP.Tool.${name}`,
      ...extra
    });
    return {
      name: LAYER_NAME,
      order: 9,
      title: "VMAP.Control.title",
      icon: "fa-solid fa-map-location-dot",
      layer: LAYER_NAME,
      visible: true,
      activeTool: "select",
      onToolChange: () => canvas[LAYER_NAME]?._onToolChanged(),
      tools: {
        select: t("select", "fa-solid fa-arrow-pointer", 1),
        object: t("object", "fa-solid fa-location-dot", 2),
        line: t("line", "fa-solid fa-route", 3),
        area: t("area", "fa-solid fa-draw-polygon", 4),
        erase: t("erase", "fa-solid fa-eraser", 5),
        claims: t("claims", "fa-solid fa-scroll", 6, {
          button: true,
          onChange: () => game.modules.get(MODULE_ID).api.openClaims()
        }),
        atlas: t("atlas", "fa-solid fa-swatchbook", 7, {
          button: true,
          visible: game.user.isGM,
          onChange: () => game.modules.get(MODULE_ID).api.openAtlasConfig()
        })
      }
    };
  }

  get tool() {
    const name = ui.controls?.tool?.name ?? game.activeTool;
    return TOOLS.includes(name) ? name : "select";
  }

  /* ------------------------------------------------------------ */
  /*  Жизненный цикл                                               */
  /* ------------------------------------------------------------ */

  /** @override */
  async _draw(options) {
    await super._draw(options);
    this.renderer = new MapRenderer();
    const below = game.settings.get(MODULE_ID, "renderBelowTokens") && canvas.primary;
    if ( below ) {
      // Внутри основной группы сцены: над фоном и плитками, под токенами.
      const c = this.renderer.container;
      c.elevation = 0;
      c.sortLayer = 650;
      c.sort = 0;
      c.zIndex = 0;
      canvas.primary.addChild(c);
    } else {
      this.addChild(this.renderer.container);
    }
    this.preview = this.addChild(new PIXI.Graphics());
    this.refresh();
  }

  /** @override */
  async _tearDown(options) {
    this.palette.close();
    if ( this.renderer ) {
      this.renderer.container.parent?.removeChild(this.renderer.container);
      this.renderer.destroy();
    }
    this.renderer = null;
    this.preview = null;
    this.working.clear();
    this.linePoints = [];
    return super._tearDown(options);
  }

  /** @override */
  _activate() {
    super._activate?.();
    this._onMove = () => this._drawPreview();
    canvas.stage.on("pointermove", this._onMove);
    if ( game.user.isGM && canvas.scene && !getAtlas(canvas.scene) ) ensureAtlas(canvas.scene).then(() => this.refresh());
    this.palette.render();
  }

  /** @override */
  _deactivate() {
    super._deactivate?.();
    if ( this._onMove ) canvas.stage.off("pointermove", this._onMove);
    this.linePoints = [];
    this.preview?.clear();
    this.palette.close();
  }

  _onToolChanged() {
    this.linePoints = [];
    this.preview?.clear();
    this.palette.render();
  }

  /* ------------------------------------------------------------ */
  /*  Данные для рисования                                         */
  /* ------------------------------------------------------------ */

  get atlas() { return getAtlas(canvas.scene); }
  get types() { return getTypes(this.atlas); }
  get layers() { return getLayers(this.atlas); }

  /** Что видит этот пользователь, плюс то, что сейчас тащится мышью. */
  currentStates() {
    const states = effectiveStates(canvas.scene);
    for ( const [id, s] of this.working ) states.set(id, s);
    return states;
  }

  getState(id) {
    return this.currentStates().get(id) ?? null;
  }

  /** Призраки: черновик игрока и заявки, которые мастер смотрит в очереди. */
  ghosts() {
    const out = [...this.reviewGhosts];
    if ( !game.user.isGM && canvas.scene ) {
      const base = atlasStates(this.atlas);
      const ops = [...pendingClaimOps(game.user, canvas.scene.id), ...draftOps(getDraft(game.user, canvas.scene.id))];
      for ( const op of ops ) {
        const state = op.action === "delete" ? base.get(op.id) : op.state;
        if ( state ) out.push({ state: { ...state, id: op.id }, mode: op.action });
      }
    }
    return out;
  }

  /** Перерисовать карту. Вызовы в одном кадре склеиваются. */
  refresh() {
    if ( this._frame ) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      if ( !this.renderer ) return;
      const states = this.currentStates();
      if ( this.selectedId && !states.has(this.selectedId) ) this.selectedId = null;
      this.renderer.draw(states, {
        types: this.types, layers: this.layers, ghosts: this.ghosts(),
        selectedId: this.active ? this.selectedId : null
      });
      if ( this.active ) this.palette.render();
    });
  }

  select(id) {
    this.selectedId = id;
    this.refresh();
    this.palette.render();
  }

  /* ------------------------------------------------------------ */
  /*  Создание элементов                                           */
  /* ------------------------------------------------------------ */

  /** Тип по умолчанию для вида: выбранный в палитре или первый подходящий. */
  typeFor(kind) {
    const types = this.types.filter(t => t.kind === kind);
    return types.find(t => t.id === this.choice[kind]) ?? types[0] ?? null;
  }

  layerForNewArea() {
    const layers = this.layers;
    return layers.find(l => l.id === this.choice.layerId) ?? layers[0] ?? null;
  }

  newState(kind, geometry) {
    const type = this.typeFor(kind);
    const sys = {
      kind, typeId: type?.id ?? "", demiurge: "", statuses: [], aspects: [], style: {}, geometry,
      layerId: "", blend: "replace", sort: 0, links: [], rev: 0
    };
    if ( kind === "area" ) {
      sys.layerId = this.layerForNewArea()?.id ?? "";
      const areas = [...this.currentStates().values()].filter(s => s.system.kind === "area");
      sys.sort = areas.reduce((m, s) => Math.max(m, s.system.sort ?? 0), 0) + 1;
    }
    return { id: randomId(), name: type?.name ?? game.i18n.localize(`VMAP.Kind.${kind}`), text: "", system: sys };
  }

  /* ------------------------------------------------------------ */
  /*  Мышь                                                         */
  /* ------------------------------------------------------------ */

  /** @override */
  _canDragLeftStart(user, event) {
    return true;
  }

  /** @override */
  async _onClickLeft(event) {
    const pt = event.interactionData.origin;
    const tool = this.tool;
    if ( tool === "select" ) return this.select(this.renderer?.hitTest(pt) ?? null);
    if ( tool === "object" ) {
      const state = this.newState("object", { x: Math.round(pt.x), y: Math.round(pt.y) });
      this.working.set(state.id, state);
      this.select(state.id);
      await commit({ action: "create", id: state.id, state });
      this.working.delete(state.id);
      this.refresh();
      return game.modules.get(MODULE_ID).api.openFeature(state.id);
    }
    if ( tool === "line" ) {
      this.linePoints.push([Math.round(pt.x), Math.round(pt.y)]);
      return this._drawPreview();
    }
    if ( tool === "area" || tool === "erase" ) {
      if ( canvas.grid.isGridless ) return;
      return this._paintCells([pt], tool === "erase", true);
    }
  }

  /** @override */
  _onClickLeft2(event) {
    const tool = this.tool;
    if ( tool === "line" ) return this.finishLine();
    const id = this.renderer?.hitTest(event.interactionData.origin);
    if ( id ) {
      this.select(id);
      game.modules.get(MODULE_ID).api.openFeature(id);
    }
  }

  /** @override */
  _onClickRight(event) {
    if ( this.tool === "line" && this.linePoints.length ) {
      this.linePoints.pop();
      this._drawPreview();
      return;
    }
    // Правый щелчок по опорной точке выбранной линии удаляет её.
    const sel = this.selectedId ? this.getState(this.selectedId) : null;
    if ( sel?.system.kind === "line" ) {
      const pts = sel.system.geometry?.points ?? [];
      const idx = this._handleAt(pts, event.interactionData.origin);
      if ( idx >= 0 && pts.length > 2 ) {
        const next = foundry.utils.deepClone(sel);
        next.system.geometry.points.splice(idx, 1);
        commit({ action: "update", id: sel.id, state: next });
      }
    }
  }

  /** @override */
  _onDragLeftStart(event) {
    const origin = event.interactionData.origin;
    const tool = this.tool;
    const alt = event.altKey || game.keyboard?.isModifierActive?.("Alt");
    this._drag = null;
    if ( tool === "select" ) {
      const sel = this.selectedId ? this.getState(this.selectedId) : null;
      if ( sel?.system.kind === "line" ) {
        const idx = this._handleAt(sel.system.geometry?.points ?? [], origin);
        if ( idx >= 0 ) { this._drag = { mode: "point", id: sel.id, idx }; return; }
      }
      const id = this.renderer?.hitTest(origin);
      const state = id ? this.getState(id) : null;
      if ( state?.system.kind === "object" ) {
        this.select(id);
        this._drag = { mode: "move", id, dx: origin.x - state.system.geometry.x, dy: origin.y - state.system.geometry.y };
      }
      return;
    }
    if ( tool === "area" || tool === "erase" ) {
      if ( alt || canvas.grid.isGridless ) { this._drag = { mode: "free", erase: tool === "erase", path: [[origin.x, origin.y]] }; return; }
      this._drag = { mode: "paint", erase: tool === "erase" };
      this._paintCells([origin], tool === "erase", false);
    }
  }

  /** @override */
  _onDragLeftMove(event) {
    const d = this._drag;
    if ( !d ) return;
    const dest = event.interactionData.destination;
    if ( d.mode === "move" ) {
      const s = foundry.utils.deepClone(this.getState(d.id));
      s.system.geometry.x = Math.round(dest.x - d.dx);
      s.system.geometry.y = Math.round(dest.y - d.dy);
      this.working.set(d.id, s);
      this.refresh();
    } else if ( d.mode === "point" ) {
      const s = foundry.utils.deepClone(this.getState(d.id));
      s.system.geometry.points[d.idx] = [Math.round(dest.x), Math.round(dest.y)];
      this.working.set(d.id, s);
      this.refresh();
    } else if ( d.mode === "paint" ) {
      this._paintCells([dest], d.erase, false);
    } else if ( d.mode === "free" ) {
      const last = d.path.at(-1);
      if ( dist(last, [dest.x, dest.y]) > 4 ) d.path.push([dest.x, dest.y]);
      this._drawPreview();
    }
  }

  /** @override */
  async _onDragLeftDrop(event) {
    const d = this._drag;
    this._drag = null;
    if ( !d ) return;
    if ( d.mode === "free" ) return this._finishFree(d);
    await this._commitWorking();
  }

  /** @override */
  _onDragLeftCancel(event) {
    this._drag = null;
    this.working.clear();
    this.preview?.clear();
    this.refresh();
  }

  /** @override */
  _onDeleteKey(event) {
    if ( !this.selectedId ) return false;
    this.deleteFeature(this.selectedId);
    return true;
  }

  /** @override */
  _onDismissKey(event) {
    if ( this.linePoints.length ) {
      this.linePoints = [];
      this.preview?.clear();
      return true;
    }
    if ( this.selectedId ) { this.select(null); return true; }
    return false;
  }

  /* ------------------------------------------------------------ */
  /*  Действия                                                     */
  /* ------------------------------------------------------------ */

  _handleAt(points, pt) {
    const r = 12 / (canvas.stage.scale.x || 1);
    return points.findIndex(([x, y]) => Math.hypot(x - pt.x, y - pt.y) <= r);
  }

  /** Сохранить всё, что тащилось мышью. Новые элементы создаются, остальные правятся. */
  async _commitWorking() {
    const base = effectiveStates(canvas.scene);
    const jobs = [...this.working.values()].map(s => commit({ action: base.has(s.id) ? "update" : "create", id: s.id, state: s }));
    await Promise.all(jobs);
    this.working.clear();
    this.refresh();
  }

  /** Целевая область для кисти: выбранная или новая. */
  _targetArea(createIfMissing) {
    const sel = this.selectedId ? (this.working.get(this.selectedId) ?? this.getState(this.selectedId)) : null;
    if ( sel?.system.kind === "area" ) return foundry.utils.deepClone(sel);
    if ( !createIfMissing ) return null;
    const s = this.newState("area", { cells: [], shapes: [], grid: { type: canvas.grid.type, size: canvas.grid.size } });
    this.selectedId = s.id;
    return s;
  }

  /** Закрасить или стереть клетки под точками. */
  async _paintCells(points, erase, commitNow) {
    const area = this._targetArea(!erase);
    if ( !area ) {
      if ( erase ) ui.notifications.info(game.i18n.localize("VMAP.Notify.selectAreaToErase"));
      return;
    }
    const g = area.system.geometry;
    g.cells ??= [];
    const has = new Set(g.cells.map(c => `${c[0]},${c[1]}`));
    let changed = false;
    for ( const p of points ) {
      const { i, j } = canvas.grid.getOffset({ x: p.x, y: p.y });
      const k = `${i},${j}`;
      if ( erase && has.has(k) ) { g.cells = g.cells.filter(c => `${c[0]},${c[1]}` !== k); has.delete(k); changed = true; }
      else if ( !erase && !has.has(k) ) { g.cells.push([i, j]); has.add(k); changed = true; }
    }
    if ( !changed && !commitNow ) return;
    this.working.set(area.id, area);
    this.refresh();
    if ( commitNow ) await this._commitWorking();
  }

  /** Конец свободного рисования с Alt. */
  async _finishFree(d) {
    this.preview?.clear();
    const path = roundPoints(simplify(d.path, 3));
    if ( path.length < 3 ) return;
    const area = this._targetArea(!d.erase);
    if ( !area ) {
      ui.notifications.info(game.i18n.localize("VMAP.Notify.selectAreaToErase"));
      return;
    }
    const g = area.system.geometry;
    g.shapes ??= [];
    if ( d.erase ) {
      // Стираем клетки, чей центр внутри контура, и вырезаем контур из свободных кусков.
      g.cells = (g.cells ?? []).filter(([i, j]) => {
        const c = canvas.grid.getCenterPoint({ i, j });
        return !pointInRing([c.x, c.y], path);
      });
      g.shapes = subtractShape(g.shapes, path);
    } else {
      g.shapes.push(orient(path));
    }
    this.working.set(area.id, area);
    await this._commitWorking();
  }

  /** Закончить линию (двойной щелчок или кнопка в палитре). */
  async finishLine() {
    let pts = this.linePoints;
    // Двойной щелчок сначала добавил точку обычным щелчком: убираем дубль.
    if ( pts.length >= 2 && dist(pts.at(-1), pts.at(-2)) < 6 ) pts = pts.slice(0, -1);
    this.linePoints = [];
    this.preview?.clear();
    if ( pts.length < 2 ) return;
    const state = this.newState("line", { points: pts });
    this.working.set(state.id, state);
    this.select(state.id);
    await this._commitWorking();
    game.modules.get(MODULE_ID).api.openFeature(state.id);
  }

  async deleteFeature(id) {
    const state = this.getState(id);
    if ( !state ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("VMAP.Feature.delete") },
      content: `<p>${game.i18n.format("VMAP.Feature.deleteConfirm", { name: foundry.utils.escapeHTML?.(state.name) ?? state.name })}</p>`,
      rejectClose: false
    });
    if ( !ok ) return;
    if ( this.selectedId === id ) this.selectedId = null;
    await commit({ action: "delete", id, name: state.name });
    this.refresh();
  }

  /** Навести камеру на элемент. */
  panTo(id) {
    const state = this.getState(id);
    if ( !state || !this.renderer ) return;
    const b = this.renderer.boundsOf(state, this.types);
    canvas.animatePan({ x: b.x + (b.width / 2), y: b.y + (b.height / 2) });
    this.select(id);
  }

  /** Линия в процессе и след свободной кисти. */
  _drawPreview() {
    const g = this.preview;
    if ( !g ) return;
    g.clear();
    const mouse = canvas.mousePosition;
    if ( this.tool === "line" && this.linePoints.length ) {
      const pts = mouse ? [...this.linePoints, [mouse.x, mouse.y]] : this.linePoints;
      g.lineStyle({ width: 3, color: 0xffffff, alpha: 0.8 });
      g.moveTo(...pts[0]);
      for ( const p of pts.slice(1) ) g.lineTo(...p);
      for ( const [x, y] of this.linePoints ) g.beginFill(0xffffff, 1).drawCircle(x, y, 5).endFill();
    }
    if ( this._drag?.mode === "free" && this._drag.path.length > 1 ) {
      const c = this._drag.erase ? 0xff6a5a : 0xffffff;
      g.lineStyle({ width: 3, color: c, alpha: 0.9 });
      g.beginFill(c, 0.12).drawPolygon(flat(this._drag.path)).endFill();
    }
  }
}

/** Обход нового куска как у внешних контуров Clipper, чтобы дыры после вычитания читались верно. */
function orient(path) {
  const C = globalThis.ClipperLib;
  if ( !C ) return path;
  const pts = path.map(([x, y]) => ({ X: x, Y: y }));
  return C.Clipper.Orientation(pts) ? path : path.slice().reverse();
}

/** Вычитание контура из свободных кусков области через ClipperLib. */
function subtractShape(shapes, cut) {
  const C = globalThis.ClipperLib;
  if ( !C || !shapes.length ) return shapes;
  const S = 100;
  const to = r => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  const c = new C.Clipper();
  c.AddPaths(shapes.map(to), C.PolyType.ptSubject, true);
  c.AddPath(to(cut), C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(C.ClipType.ctDifference, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out.map(p => p.map(q => [Math.round(q.X / S), Math.round(q.Y / S)])).filter(r => r.length >= 3);
}
