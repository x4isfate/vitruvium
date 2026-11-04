import { MODULE_ID, KINDS, DEFAULT_STYLES } from "../constants.mjs";
import { getAtlas, ensureAtlas, getTypes, getLayers, setTypes, setLayers } from "../data/store.mjs";
import { randomId } from "../review/ops.mjs";
import { STYLE_FIELDS } from "./feature-sheet.mjs";
import { LAYER_NAME } from "../canvas/map-layer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Настройки атласа для мастера: типы элементов с их видом и слои областей.
 * Вид типа действует на все элементы этого типа, пока у элемента нет своих правок.
 */
export default class AtlasConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vmap-atlas-config",
    classes: ["vitruvium", "vmap-sheet"],
    tag: "form",
    window: { title: "VMAP.Atlas.config", resizable: true, icon: "fa-solid fa-swatchbook" },
    position: { width: 640, height: 720 },
    actions: {
      addType: AtlasConfig.#onAddType,
      removeType: AtlasConfig.#onRemoveType,
      pickIcon: AtlasConfig.#onPickIcon,
      addLayer: AtlasConfig.#onAddLayer,
      removeLayer: AtlasConfig.#onRemoveLayer,
      moveLayer: AtlasConfig.#onMoveLayer,
      toggleLayer: AtlasConfig.#onToggleLayer,
      tab: AtlasConfig.#onTab
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/atlas-config.hbs`, scrollable: [".vmap-scroll"] }
  };

  tab = "object";

  get atlas() { return getAtlas(canvas.scene); }

  /** @override */
  async _prepareContext() {
    const atlas = this.atlas ?? await ensureAtlas(canvas.scene);
    const L = k => game.i18n.localize(k);
    const types = getTypes(atlas);
    const tabs = [...KINDS, "layers"].map(id => ({
      id, active: id === this.tab,
      label: id === "layers" ? L("VMAP.Atlas.layers") : L(`VMAP.Kind.${id}`)
    }));
    const kind = KINDS.includes(this.tab) ? this.tab : null;
    return {
      tabs, kind,
      isLayers: this.tab === "layers",
      types: kind ? types.map((t, index) => ({ ...t, index })).filter(t => t.kind === kind).map(t => ({
        ...t,
        fields: STYLE_FIELDS[kind].map(([key, input]) => ({
          key, isIcon: key === "icon", isColor: input === "color",
          label: L(`VMAP.Style.${key}`),
          value: t.style?.[key] ?? DEFAULT_STYLES[kind][key] ?? ""
        }))
      })) : [],
      layers: getLayers(atlas).map((l, i, all) => ({ ...l, index: i, first: i === 0, last: i === all.length - 1, hidden: l.visible === false }))
    };
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("change", ev => this._onChange(ev));
  }

  async _onChange(ev) {
    const el = ev.target;
    const atlas = this.atlas;
    if ( !atlas ) return;
    if ( el.dataset.type !== undefined ) {
      const types = getTypes(atlas);
      const t = types[Number(el.dataset.type)];
      if ( !t ) return;
      const key = el.dataset.key;
      if ( key === "name" ) t.name = el.value;
      else {
        const isNum = typeof DEFAULT_STYLES[t.kind][key] === "number";
        t.style = { ...(t.style ?? {}), [key]: isNum ? Number(el.value) : el.value };
      }
      await setTypes(atlas, types);
    } else if ( el.dataset.layer !== undefined ) {
      const layers = getLayers(atlas);
      const l = layers[Number(el.dataset.layer)];
      if ( !l ) return;
      l.name = el.value;
      await setLayers(atlas, layers);
    } else return;
    canvas[LAYER_NAME]?.refresh();
  }

  async #types(fn) {
    const atlas = this.atlas;
    const types = getTypes(atlas);
    fn(types);
    await setTypes(atlas, types);
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  async #layers(fn) {
    const atlas = this.atlas;
    const layers = getLayers(atlas);
    fn(layers);
    await setLayers(atlas, layers);
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static #onAddType() {
    const kind = this.tab;
    return this.#types(types => types.push({
      id: randomId(), kind, name: game.i18n.localize("VMAP.Atlas.newType"), style: { ...DEFAULT_STYLES[kind] }
    }));
  }

  static async #onRemoveType(event, target) {
    const index = Number(target.dataset.index);
    const t = getTypes(this.atlas)[index];
    if ( !t ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "VMAP.Atlas.removeType" },
      content: `<p>${game.i18n.format("VMAP.Atlas.removeTypeConfirm", { name: foundry.utils.escapeHTML(t.name) })}</p>`
    });
    if ( ok ) return this.#types(types => types.splice(index, 1));
  }

  static #onPickIcon(event, target) {
    const index = Number(target.dataset.index);
    const FP = foundry.applications.apps.FilePicker.implementation;
    const t = getTypes(this.atlas)[index];
    new FP({
      type: "image",
      current: t?.style?.icon || "icons/svg/",
      callback: path => this.#types(types => { types[index].style = { ...(types[index].style ?? {}), icon: path }; })
    }).browse();
  }

  static #onAddLayer() {
    return this.#layers(layers => layers.push({ id: randomId(), name: game.i18n.localize("VMAP.Atlas.newLayer"), visible: true }));
  }

  static async #onRemoveLayer(event, target) {
    const index = Number(target.dataset.index);
    const layers = getLayers(this.atlas);
    if ( layers.length <= 1 ) return ui.notifications.warn(game.i18n.localize("VMAP.Atlas.lastLayer"));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "VMAP.Atlas.removeLayer" },
      content: `<p>${game.i18n.format("VMAP.Atlas.removeLayerConfirm", { name: foundry.utils.escapeHTML(layers[index].name) })}</p>`
    });
    if ( ok ) return this.#layers(list => list.splice(index, 1));
  }

  static #onMoveLayer(event, target) {
    const index = Number(target.dataset.index);
    const to = index + Number(target.dataset.dir);
    return this.#layers(list => {
      if ( to < 0 || to >= list.length ) return;
      [list[index], list[to]] = [list[to], list[index]];
    });
  }

  static #onToggleLayer(event, target) {
    const index = Number(target.dataset.index);
    return this.#layers(list => { list[index].visible = list[index].visible === false; });
  }
}
