import StatsWindow from "../apps/stats.mjs";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = () => foundry.applications.ux.TextEditor.implementation;

/** Списки в system, которые форма присылает объектом с индексами. */
const ARRAY_PATHS = ["statuses", "levels", "aspects"];

/** Превращает {0: a, 1: b} в [a, b]. */
export function toArray(value) {
  if ( Array.isArray(value) ) return value;
  if ( !value || typeof value !== "object" ) return [];
  return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map(k => value[k]);
}

/** Шкала аспекта из текста: строка на уровень, «3 Идеально». */
export function parseScale(text) {
  return String(text ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const m = line.match(/^([+-−–]?\d+)\s*(.*)$/);
    if ( !m ) return { value: 0, label: line };
    return { value: Number(m[1].replace(/[−–]/, "-")), label: m[2].trim() };
  });
}

export function formatScale(scale) {
  return (scale ?? []).map(s => `${s.value} ${s.label}`.trim()).join("\n");
}

/** Приводит присланные формой списки статусов, уровней и аспектов к массивам. */
export function normalizeLists(system) {
  if ( !system ) return;
  for ( const key of ARRAY_PATHS ) {
    if ( !(key in system) ) continue;
    system[key] = toArray(system[key]);
  }
  if ( Array.isArray(system.aspects) ) {
    system.aspects = system.aspects.map(a => {
      const out = { ...a };
      if ( "scaleText" in out ) { out.scale = parseScale(out.scaleText); delete out.scaleText; }
      if ( "statusesText" in out ) {
        out.statuses = String(out.statusesText).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        delete out.statusesText;
      }
      return out;
    });
  }
  if ( Array.isArray(system.levels) ) {
    system.levels = system.levels.map(l => ({ ...l, max: (l.max === "" || l.max === null || l.max === undefined) ? null : Number(l.max) }));
  }
}

export default class VitruviumActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["vitruvium", "vitruvium-sheet", "actor"],
    position: { width: 820, height: 860 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      roll: VitruviumActorSheet.#onRoll,
      rollDomain: VitruviumActorSheet.#onRollDomain,
      setCharacteristic: VitruviumActorSheet.#onSetCharacteristic,
      setInspiration: VitruviumActorSheet.#onSetInspiration,
      setLevel: VitruviumActorSheet.#onSetLevel,
      setDomainLevel: VitruviumActorSheet.#onSetDomainLevel,
      editPortrait: VitruviumActorSheet.#onEditPortrait,
      itemCreate: VitruviumActorSheet.#onItemCreate,
      itemEdit: VitruviumActorSheet.#onItemEdit,
      itemDelete: VitruviumActorSheet.#onItemDelete,
      itemToggle: VitruviumActorSheet.#onItemToggle,
      listAdd: VitruviumActorSheet.#onListAdd,
      listRemove: VitruviumActorSheet.#onListRemove,
      openStats: VitruviumActorSheet.#onOpenStats
    }
  };

  static PARTS = {
    header: { template: "systems/vitruvium/templates/actor/header.hbs" },
    tabs: { template: "systems/vitruvium/templates/actor/tabs.hbs" },
    description: { template: "systems/vitruvium/templates/actor/tab-description.hbs", scrollable: [""] },
    domains: { template: "systems/vitruvium/templates/actor/tab-domains.hbs", scrollable: [""] },
    attributes: { template: "systems/vitruvium/templates/actor/tab-attributes.hbs", scrollable: [""] },
    property: { template: "systems/vitruvium/templates/actor/tab-property.hbs", scrollable: [""] },
    states: { template: "systems/vitruvium/templates/actor/tab-states.hbs", scrollable: [""] },
    notes: { template: "systems/vitruvium/templates/actor/tab-notes.hbs", scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "description", label: "VITRUVIUM.Tab.description" },
        { id: "domains", label: "VITRUVIUM.Tab.domains" },
        { id: "attributes", label: "VITRUVIUM.Tab.attributes" },
        { id: "property", label: "VITRUVIUM.Tab.property" },
        { id: "states", label: "VITRUVIUM.Tab.states" },
        { id: "notes", label: "VITRUVIUM.Tab.notes" }
      ],
      initial: "description"
    }
  };

  /** Какие домены развёрнуты в списке. */
  _expanded = new Set();

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const cfg = CONFIG.VITRUVIUM;
    const isCharacter = actor.type === "character";
    const editable = this.isEditable;

    const characteristics = Object.entries(cfg.characteristics).map(([key, c]) => {
      const value = system.characteristics[key]?.value ?? 0;
      return {
        key, value,
        label: game.i18n.localize(c.label),
        hint: game.i18n.localize(c.hint),
        icon: c.icon,
        pips: [1, 2, 3].map(n => ({ n, on: n <= value }))
      };
    });

    const inspiration = {
      value: system.inspiration.value,
      max: system.inspiration.max,
      pips: Array.from({ length: system.inspiration.max }, (_, i) => ({ n: i + 1, on: i < system.inspiration.value }))
    };

    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const enrich = html => TextEditor().enrichHTML(html ?? "", { secrets: actor.isOwner, relativeTo: actor });

    const domains = [];
    for ( const d of items.filter(i => i.type === "domain") ) {
      domains.push({
        id: d.id, name: d.name, img: d.img, level: d.system.level,
        pips: [1, 2, 3].map(n => ({ n, on: n <= d.system.level })),
        slots: d.system.abilitySlots,
        abilities: d.system.abilities,
        overAbilities: d.system.abilities.length > d.system.abilitySlots,
        expanded: this._expanded.has(d.id),
        description: await enrich(d.system.description)
      });
    }
    const simpleList = async type => {
      const out = [];
      for ( const i of items.filter(x => x.type === type) ) {
        out.push({
          id: i.id, name: i.name, img: i.img,
          expanded: this._expanded.has(i.id),
          description: await enrich(i.system.description),
          statuses: i.system.statuses ?? [],
          levels: i.system.levels ?? []
        });
      }
      return out;
    };

    let budget = null;
    if ( isCharacter ) {
      const b = system.budget;
      const pts = system.levelPoints;
      const L = cfg.limits;
      const chip = (labelKey, value, max) => ({ label: game.i18n.localize(labelKey), value, max, over: value > max });
      budget = [
        chip("VITRUVIUM.Budget.charPoints", b.charPoints, pts),
        chip("VITRUVIUM.Budget.domainCount", b.domainCount, L.domain.count),
        chip("VITRUVIUM.Budget.domainPoints", b.domainPoints, pts),
        chip("VITRUVIUM.Budget.attributes", b.attributes, Math.min(pts, L.attributes)),
        chip("VITRUVIUM.Budget.property", b.property, pts)
      ];
    }

    const levels = Object.entries(cfg.levels).map(([key, l]) => ({
      key, points: l.points,
      label: game.i18n.localize(l.label),
      hint: game.i18n.localize(l.hint),
      active: system.level === key
    }));

    return Object.assign(context, {
      actor, system,
      source: actor.toObject().system,
      systemFields: system.schema.fields,
      isCharacter,
      isGM: game.user.isGM,
      editable,
      characteristics,
      inspiration,
      inspirationIcon: cfg.inspirationIcon,
      levels,
      budget,
      domains,
      attributes: await simpleList("attribute"),
      property: await simpleList("property"),
      statuses: system.statuses,
      levelsList: system.levels,
      aspects: system.aspects.map(a => ({
        ...a,
        scaleText: formatScale(a.scale),
        statusesText: (a.statuses ?? []).join(", "),
        current: a.scale?.find(s => s.value === a.value)?.label ?? ""
      })),
      descriptionHTML: await enrich(system.description),
      notesHTML: await enrich(system.notes),
      tabs: this._prepareTabs("primary")
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if ( context.tabs?.[partId] ) context.tab = context.tabs[partId];
    return context;
  }

  /** @override */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    normalizeLists(data.system);
    return data;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.classList.add(`type-${this.actor.type}`);
  }

  /* ------------------------------------------------------------ */
  /*  Действия                                                     */
  /* ------------------------------------------------------------ */

  static async #onRoll(event, target) {
    const characteristic = target.closest("[data-characteristic]")?.dataset.characteristic ?? null;
    return this.actor.check({ characteristic });
  }

  static async #onRollDomain(event, target) {
    const domainId = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.check({ domainId, characteristic: null });
  }

  static async #onSetCharacteristic(event, target) {
    if ( !this.isEditable ) return;
    const key = target.closest("[data-characteristic]").dataset.characteristic;
    const n = Number(target.dataset.value);
    const L = CONFIG.VITRUVIUM.limits.characteristic;
    const current = this.actor.system.characteristics[key].value;
    const value = Math.clamp(current === n && n > L.min ? n - 1 : n, L.min, L.max);
    return this.actor.update({ [`system.characteristics.${key}.value`]: value });
  }

  static async #onSetInspiration(event, target) {
    if ( !this.isEditable ) return;
    const n = Number(target.dataset.value);
    const current = this.actor.system.inspiration.value;
    return this.actor.update({ "system.inspiration.value": current === n ? n - 1 : n });
  }

  static async #onSetLevel(event, target) {
    if ( !this.isEditable ) return;
    return this.actor.update({ "system.level": target.dataset.level });
  }

  static async #onSetDomainLevel(event, target) {
    if ( !this.isEditable ) return;
    const item = this.actor.items.get(target.closest("[data-item-id]").dataset.itemId);
    const n = Number(target.dataset.value);
    const L = CONFIG.VITRUVIUM.limits.domain;
    const value = Math.clamp(item.system.level === n && n > L.min ? n - 1 : n, L.min, L.max);
    return item.update({ "system.level": value });
  }

  static async #onEditPortrait(event, target) {
    if ( !this.isEditable ) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    const fp = new FP({
      type: "image",
      current: this.actor.img,
      callback: path => this.actor.update({ img: path })
    });
    return fp.browse();
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.localize(`VITRUVIUM.Item.new.${type}`);
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ type, name }]);
    item?.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]").dataset.itemId);
    item?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]").dataset.itemId);
    if ( !item ) return;
    return item.deleteDialog();
  }

  static #onItemToggle(event, target) {
    const id = target.closest("[data-item-id]").dataset.itemId;
    if ( this._expanded.has(id) ) this._expanded.delete(id);
    else this._expanded.add(id);
    this.render();
  }

  static async #onListAdd(event, target) {
    const list = target.dataset.list;
    const current = foundry.utils.deepClone(this.actor.system.toObject()[list] ?? []);
    const blank = { statuses: { name: "" }, levels: { name: "", value: 0, max: null }, aspects: { name: "", subject: "", value: 0, scale: [], statuses: [] } }[list];
    if ( !blank ) return;
    current.push(blank);
    return this.actor.update({ [`system.${list}`]: current });
  }

  static async #onListRemove(event, target) {
    const list = target.dataset.list;
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.actor.system.toObject()[list] ?? []);
    current.splice(index, 1);
    return this.actor.update({ [`system.${list}`]: current });
  }

  static #onOpenStats() {
    return StatsWindow.open(this.actor);
  }
}
