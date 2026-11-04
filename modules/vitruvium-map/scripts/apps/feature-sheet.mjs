import { MODULE_ID } from "../constants.mjs";
import { commit, getTypes, getLayers, getAtlas, getDraft, revOf, pendingClaimOps } from "../data/store.mjs";
import { statusToAspect, randomId, formatStatus } from "../review/ops.mjs";
import { pointInRings } from "../geometry/geometry.mjs";
import { LAYER_NAME } from "../canvas/map-layer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Поля вида, которые можно переопределить у элемента, по видам. */
const STYLE_FIELDS = {
  object: [["icon", "text"], ["color", "color"], ["size", "number"], ["labelSize", "number"]],
  line: [["color", "color"], ["widthStart", "number"], ["widthEnd", "number"], ["dash", "number"], ["gap", "number"],
    ["meander", "number"], ["outlineWidth", "number"], ["outlineColor", "color"], ["labelSize", "number"]],
  area: [["color", "color"], ["alpha", "number"], ["borderColor", "color"], ["borderWidth", "number"], ["labelSize", "number"]]
};
export { STYLE_FIELDS };

const blankStatus = () => ({ id: randomId(), name: "", value: null, max: null });

/**
 * Лист элемента карты. Работает с копией состояния: мастер сохраняет прямо в атлас,
 * игрок — в свой черновик. Каждое изменение поля сохраняется сразу.
 */
export default class FeatureSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  static #open = new Map();

  /** Открыть лист элемента (один на элемент). */
  static open(id) {
    const existing = FeatureSheet.#open.get(id);
    if ( existing ) { existing.render({ force: true }); existing.bringToFront?.(); return existing; }
    const layer = canvas[LAYER_NAME];
    const state = layer?.getState(id);
    if ( !state ) {
      ui.notifications.warn(game.i18n.localize("VMAP.Notify.featureMissing"));
      return null;
    }
    const app = new FeatureSheet({ featureId: id });
    FeatureSheet.#open.set(id, app);
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.featureId = options.featureId;
    this.state = foundry.utils.deepClone(canvas[LAYER_NAME].getState(this.featureId));
    this._save = foundry.utils.debounce(() => this._commit(), 350);
  }

  static DEFAULT_OPTIONS = {
    id: "vmap-feature-{id}",
    classes: ["vitruvium", "vmap-sheet"],
    tag: "form",
    window: { resizable: true, icon: "fa-solid fa-map-location-dot" },
    position: { width: 560, height: 720 },
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      addStatus: FeatureSheet.#onAddStatus,
      removeStatus: FeatureSheet.#onRemoveStatus,
      toggleLevel: FeatureSheet.#onToggleLevel,
      toAspect: FeatureSheet.#onToAspect,
      addAspect: FeatureSheet.#onAddAspect,
      removeAspect: FeatureSheet.#onRemoveAspect,
      addLink: FeatureSheet.#onAddLink,
      removeLink: FeatureSheet.#onRemoveLink,
      openLink: FeatureSheet.#onOpenLink,
      pan: FeatureSheet.#onPan,
      deleteFeature: FeatureSheet.#onDelete,
      pickIcon: FeatureSheet.#onPickIcon,
      clearStyle: FeatureSheet.#onClearStyle
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/feature-sheet.hbs`, scrollable: [""] }
  };

  get title() {
    return `${game.i18n.localize(`VMAP.Kind.${this.state?.system.kind ?? "object"}`)}: ${this.state?.name ?? ""}`;
  }

  /** @override */
  async _prepareContext(options) {
    const s = this.state;
    const sys = s.system;
    const atlas = getAtlas(canvas.scene);
    const types = getTypes(atlas);
    const type = types.find(t => t.id === sys.typeId);
    const layer = canvas[LAYER_NAME];
    const all = layer.currentStates();
    const L = k => game.i18n.localize(k);

    const statusRow = (st, path, index) => ({
      ...st, path, index,
      hasLevel: st.value !== null && st.value !== undefined,
      label: formatStatus(st)
    });

    // Кто ссылается на этот элемент и что лежит на его территории.
    const backlinks = [...all.values()]
      .filter(o => o.id !== s.id && (o.system.links ?? []).some(l => l.target === s.id))
      .map(o => ({ id: o.id, name: o.name, role: o.system.links.find(l => l.target === s.id).role }));
    let inside = [];
    if ( sys.kind === "area" ) {
      const rings = layer.renderer?.visible.get(s.id) ?? [];
      inside = [...all.values()]
        .filter(o => o.system.kind === "object" && rings.length && pointInRings([o.system.geometry?.x ?? 0, o.system.geometry?.y ?? 0], rings))
        .map(o => ({ id: o.id, name: o.name }));
    }

    const typeStyle = type?.style ?? {};
    const style = STYLE_FIELDS[sys.kind].map(([key, input]) => ({
      key, input,
      label: L(`VMAP.Style.${key}`),
      value: sys.style?.[key] ?? "",
      placeholder: typeStyle[key] ?? "",
      isIcon: key === "icon"
    }));

    // Правка игрока, которую мастер ещё не принял: в черновике или в открытой заявке.
    let pendingAction = null;
    if ( !game.user.isGM ) {
      const op = getDraft(game.user, canvas.scene?.id)[s.id]
        ?? pendingClaimOps(game.user, canvas.scene?.id).findLast(o => o.id === s.id);
      pendingAction = op?.action ?? (revOf(atlas, s.id) === undefined ? "create" : null);
    }

    return {
      s, sys,
      isGM: game.user.isGM,
      kindLabel: L(`VMAP.Kind.${sys.kind}`),
      isArea: sys.kind === "area",
      types: types.filter(t => t.kind === sys.kind).map(t => ({ id: t.id, name: t.name, selected: t.id === sys.typeId })),
      layers: getLayers(atlas).map(l => ({ id: l.id, name: l.name, selected: l.id === sys.layerId })),
      blends: ["replace", "overlay"].map(b => ({ id: b, label: L(`VMAP.Blend.${b}`), selected: b === sys.blend })),
      demiurges: game.actors.filter(a => ["character", "npc"].includes(a.type))
        .map(a => ({ uuid: a.uuid, name: a.name, selected: a.uuid === sys.demiurge })),
      statuses: (sys.statuses ?? []).map((st, i) => statusRow(st, "statuses", i)),
      aspects: (sys.aspects ?? []).map((a, i) => ({
        ...a, index: i,
        hasLevel: a.value !== null && a.value !== undefined,
        statuses: (a.statuses ?? []).map((st, j) => statusRow(st, `aspects.${i}.statuses`, j))
      })),
      links: (sys.links ?? []).map((l, i) => ({
        ...l, index: i,
        options: [...all.values()].filter(o => o.id !== s.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(o => ({ id: o.id, name: `${o.name} · ${L(`VMAP.Kind.${o.system.kind}`)}`, selected: o.id === l.target }))
      })),
      backlinks, inside,
      style,
      status: pendingAction ? game.i18n.format("VMAP.Feature.pending", { what: L(`VMAP.Draft.${pendingAction}`).toLowerCase() }) : null
    };
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("input", ev => this._onInput(ev));
    this.element.addEventListener("change", ev => this._onInput(ev));
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    FeatureSheet.#open.delete(this.featureId);
  }

  /* ------------------------------------------------------------ */
  /*  Чтение формы                                                 */
  /* ------------------------------------------------------------ */

  _onInput(ev) {
    if ( !ev.target.matches("input, select, textarea") ) return;
    this.state = this._readForm();
    this._save();
  }

  /** Собирает состояние из полей формы. Структуру (сколько строк) задаёт текущее состояние. */
  _readForm() {
    const el = this.element;
    const s = foundry.utils.deepClone(this.state);
    const val = sel => el.querySelector(sel)?.value;
    const num = v => (v === "" || v === undefined || v === null) ? null : Number(v);
    s.name = val("[name=name]") ?? s.name;
    s.text = val("[name=text]") ?? s.text;
    s.system.typeId = val("[name=typeId]") ?? s.system.typeId;
    s.system.demiurge = val("[name=demiurge]") ?? "";
    if ( s.system.kind === "area" ) {
      s.system.layerId = val("[name=layerId]") ?? s.system.layerId;
      s.system.blend = val("[name=blend]") ?? s.system.blend;
      s.system.sort = Number(val("[name=sort]") ?? s.system.sort) || 0;
    }
    const readStatuses = (path, list) => list.map((st, i) => {
      const row = el.querySelector(`[data-status="${path}.${i}"]`);
      if ( !row ) return st;
      const f = k => row.querySelector(`[data-f=${k}]`)?.value;
      const hasLevel = row.querySelector("[data-f=value]") !== null;
      return { ...st, name: f("name") ?? st.name, value: hasLevel ? (num(f("value")) ?? 0) : null, max: hasLevel ? num(f("max")) : null };
    });
    s.system.statuses = readStatuses("statuses", s.system.statuses ?? []);
    s.system.aspects = (s.system.aspects ?? []).map((a, i) => {
      const box = el.querySelector(`[data-aspect="${i}"]`);
      if ( !box ) return a;
      const f = k => box.querySelector(`[data-af=${k}]`)?.value;
      const hasLevel = box.querySelector("[data-af=value]") !== null;
      return {
        ...a,
        name: f("name") ?? a.name,
        description: f("description") ?? a.description,
        value: hasLevel ? (num(f("value")) ?? 0) : null,
        max: hasLevel ? num(f("max")) : null,
        statuses: readStatuses(`aspects.${i}.statuses`, a.statuses ?? [])
      };
    });
    s.system.links = (s.system.links ?? []).map((l, i) => {
      const row = el.querySelector(`[data-link="${i}"]`);
      if ( !row ) return l;
      return { target: row.querySelector("[data-f=target]")?.value ?? l.target, role: row.querySelector("[data-f=role]")?.value ?? l.role };
    });
    const style = {};
    for ( const [key, input] of STYLE_FIELDS[s.system.kind] ) {
      const v = val(`[name="style.${key}"]`);
      if ( v === undefined || v === "" ) continue;
      style[key] = input === "number" ? Number(v) : v;
    }
    s.system.style = style;
    return s;
  }

  async _commit() {
    const layer = canvas[LAYER_NAME];
    const exists = layer?.getState(this.featureId);
    await commit({ action: exists ? "update" : "create", id: this.featureId, state: this.state });
    layer?.refresh();
  }

  /** Структурная правка: меняем состояние, сохраняем, перерисовываем лист. */
  async _mutate(fn) {
    this.state = this._readForm();
    fn(this.state.system);
    await this._commit();
    this.render();
  }

  static #list(sys, path) {
    return foundry.utils.getProperty(sys, path);
  }

  static #onAddStatus(event, target) {
    const path = target.dataset.path;
    return this._mutate(sys => {
      const list = FeatureSheet.#list(sys, path) ?? [];
      list.push(blankStatus());
      foundry.utils.setProperty(sys, path, list);
    });
  }

  static #onRemoveStatus(event, target) {
    const { path, index } = target.dataset;
    return this._mutate(sys => FeatureSheet.#list(sys, path).splice(Number(index), 1));
  }

  static #onToggleLevel(event, target) {
    const { path, index } = target.dataset;
    return this._mutate(sys => {
      const item = path === "aspect" ? sys.aspects[Number(index)] : FeatureSheet.#list(sys, path)[Number(index)];
      const on = item.value !== null && item.value !== undefined;
      item.value = on ? null : 0;
      item.max = on ? null : 10;
    });
  }

  static #onToAspect(event, target) {
    const index = Number(target.dataset.index);
    return this._mutate(sys => {
      const [st] = sys.statuses.splice(index, 1);
      if ( st ) sys.aspects.push(statusToAspect(st, randomId()));
    });
  }

  static #onAddAspect() {
    return this._mutate(sys => sys.aspects.push({ id: randomId(), name: "", description: "", value: null, max: null, statuses: [] }));
  }

  static #onRemoveAspect(event, target) {
    return this._mutate(sys => sys.aspects.splice(Number(target.dataset.index), 1));
  }

  static #onAddLink() {
    return this._mutate(sys => sys.links.push({ target: "", role: "" }));
  }

  static #onRemoveLink(event, target) {
    return this._mutate(sys => sys.links.splice(Number(target.dataset.index), 1));
  }

  static #onOpenLink(event, target) {
    const id = target.dataset.id;
    canvas[LAYER_NAME]?.panTo(id);
    FeatureSheet.open(id);
  }

  static #onPan() {
    canvas[LAYER_NAME]?.panTo(this.featureId);
  }

  static async #onDelete() {
    await canvas[LAYER_NAME]?.deleteFeature(this.featureId);
    if ( !canvas[LAYER_NAME]?.getState(this.featureId) ) this.close();
  }

  static #onPickIcon() {
    const FP = foundry.applications.apps.FilePicker.implementation;
    const input = this.element.querySelector('[name="style.icon"]');
    new FP({
      type: "image",
      current: input?.value || "icons/svg/",
      callback: path => {
        if ( !input ) return;
        input.value = path;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }).browse();
  }

  static #onClearStyle() {
    return this._mutate(sys => { sys.style = {}; });
  }
}
