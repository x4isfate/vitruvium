// Минимальные заглушки Foundry, чтобы проверить логику правил в Node без сервера.
import { VITRUVIUM } from "../system/module/config.mjs";

class DiceTerm { constructor(d = {}) { Object.assign(this, d); this.results = []; this._evaluated = false; }
  getResultCSS() { return ["die", "d6", "min", "max"]; } }
class Die extends DiceTerm { get expression() { return `${this.number}d${this.faces}`; } }
class PoolTerm {} class ParentheticalTerm {} class FunctionTerm {}

export const rollQueue = [];
export const created = [];

globalThis.CONFIG = { VITRUVIUM, sounds: { dice: "" } };
globalThis.Hooks = { call: () => true, callAll: () => {} };
globalThis.game = {
  i18n: { localize: k => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  settings: { get: () => "publicroll" }
};
globalThis.ui = { notifications: { warn: m => { globalThis.__warn = m; }, error: () => {} } };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; this.terms = []; }
  async evaluate() {
    const faces = rollQueue.shift();
    const n = Number(this.formula.split("d")[0]);
    if ( faces.length !== n ) throw new Error(`ожидалось ${n} кубиков, в очереди ${faces.length}`);
    this.dice = [{ results: faces.map(f => ({ result: f, active: true })) }];
    this.total = faces.reduce((s, f) => s + VITRUVIUM.dieFaces[f - 1], 0);
    return this;
  }
};
globalThis.ChatMessage = { implementation: {
  getSpeaker: () => ({}),
  create: async data => { created.push(data); return data; }
} };
const mergeObject = (a, b) => ({ ...a, ...b });
const Mixin = Base => class extends Base {};
globalThis.foundry = {
  dice: { terms: { DiceTerm, Die, PoolTerm, ParentheticalTerm, FunctionTerm }, Roll: globalThis.Roll },
  utils: { mergeObject },
  applications: {
    api: { DialogV2: class {}, HandlebarsApplicationMixin: Mixin, ApplicationV2: class {} },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    handlebars: { renderTemplate: async (path, ctx) => { globalThis.__ctx = ctx; return "<div></div>"; } },
    ux: { TextEditor: { implementation: {} } }
  }
};
Math.clamp ??= (n, a, b) => Math.min(Math.max(n, a), b);

/** Актер-заглушка. */
export function makeActor({ chars = {}, inspiration = 0, domains = [] } = {}) {
  const characteristics = {};
  for ( const k of Object.keys(VITRUVIUM.characteristics) ) characteristics[k] = { value: chars[k] ?? 1 };
  const items = domains.map((d, i) => ({ id: `d${i}`, type: "domain", name: d.name ?? `Домен ${i}`, sort: i, system: { level: d.level } }));
  const actor = {
    uuid: "Actor.test", name: "Тест",
    system: { characteristics, inspiration: { value: inspiration, max: 6 } },
    items: Object.assign(items, { get: id => items.find(i => i.id === id) }),
    updates: [],
    async update(u) { this.updates.push(u); if ( "system.inspiration.value" in u ) this.system.inspiration.value = u["system.inspiration.value"]; }
  };
  return actor;
}
