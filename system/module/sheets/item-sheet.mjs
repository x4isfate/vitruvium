import { toArray } from "./actor-sheet.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = () => foundry.applications.ux.TextEditor.implementation;

export default class VitruviumItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["vitruvium", "vitruvium-sheet", "item"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: VitruviumItemSheet.#onEditImage,
      setLevel: VitruviumItemSheet.#onSetLevel,
      listAdd: VitruviumItemSheet.#onListAdd,
      listRemove: VitruviumItemSheet.#onListRemove
    }
  };

  static PARTS = {
    sheet: { template: "systems/vitruvium/templates/item/item-sheet.hbs", scrollable: [".vitruvium-item-body"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const system = item.system;
    return Object.assign(context, {
      item, system,
      source: item.toObject().system,
      systemFields: system.schema.fields,
      editable: this.isEditable,
      isDomain: item.type === "domain",
      isProperty: item.type === "property",
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      pips: item.type === "domain" ? [1, 2, 3].map(n => ({ n, on: n <= system.level })) : null,
      slots: item.type === "domain" ? system.abilitySlots : null,
      overAbilities: item.type === "domain" && system.abilities.length > system.abilitySlots,
      descriptionHTML: await TextEditor().enrichHTML(system.description ?? "", { secrets: item.isOwner, relativeTo: item })
    });
  }

  /** @override */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const sys = data.system;
    if ( sys ) {
      for ( const key of ["abilities", "statuses", "levels"] ) if ( key in sys ) sys[key] = toArray(sys[key]);
      if ( Array.isArray(sys.levels) ) {
        sys.levels = sys.levels.map(l => ({ ...l, max: (l.max === "" || l.max == null) ? null : Number(l.max) }));
      }
    }
    return data;
  }

  static async #onEditImage() {
    if ( !this.isEditable ) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    return new FP({ type: "image", current: this.item.img, callback: path => this.item.update({ img: path }) }).browse();
  }

  static async #onSetLevel(event, target) {
    if ( !this.isEditable ) return;
    const L = CONFIG.VITRUVIUM.limits.domain;
    const n = Number(target.dataset.value);
    const value = Math.clamp(this.item.system.level === n && n > L.min ? n - 1 : n, L.min, L.max);
    return this.item.update({ "system.level": value });
  }

  static async #onListAdd(event, target) {
    const list = target.dataset.list;
    const current = foundry.utils.deepClone(this.item.system.toObject()[list] ?? []);
    const blank = { abilities: { name: "", description: "" }, statuses: { name: "" }, levels: { name: "", value: 0, max: null } }[list];
    if ( !blank ) return;
    current.push(blank);
    return this.item.update({ [`system.${list}`]: current });
  }

  static async #onListRemove(event, target) {
    const list = target.dataset.list;
    const current = foundry.utils.deepClone(this.item.system.toObject()[list] ?? []);
    current.splice(Number(target.dataset.index), 1);
    return this.item.update({ [`system.${list}`]: current });
  }
}
