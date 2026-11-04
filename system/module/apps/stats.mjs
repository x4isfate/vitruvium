const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Порядок осей радара по часовой стрелке, начиная сверху. */
const RADAR_ORDER = ["physique", "movement", "attention", "thinking", "influence", "will"];
const R = 90;          // радиус внешнего кольца, соответствует максимуму характеристики
const C = 130;         // центр SVG
const LABEL_R = 122;   // радиус подписей

/**
 * Краткий лист: портрет, вдохновение, радар и карточки характеристик,
 * атрибуты, домены, статусы, уровни и аспекты. Только просмотр и броски.
 * Открывается кнопкой в шапке листа, обновляется вместе с актером.
 */
export default class StatsWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `vitruvium-stats-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["vitruvium", "vitruvium-stats"],
    position: { width: 780, height: "auto" },
    window: { icon: "fa-solid fa-id-card", resizable: true },
    actions: {
      roll: StatsWindow.#onRoll,
      setInspiration: StatsWindow.#onSetInspiration,
      openSheet: StatsWindow.#onOpenSheet
    }
  };

  static PARTS = {
    body: { template: "systems/vitruvium/templates/apps/stats.hbs", scrollable: [".v-brief-main"] }
  };

  /** Открыть окно актера или поднять уже открытое. */
  static open(actor) {
    const existing = foundry.applications.instances.get(`vitruvium-stats-${actor.id}`);
    if ( existing ) return existing.render({ force: true });
    return new StatsWindow(actor).render({ force: true });
  }

  /** @override */
  get title() {
    return `${this.actor.name} · ${game.i18n.localize("VITRUVIUM.Brief.title")}`;
  }

  /** Точка на оси i радара на расстоянии r от центра. */
  static #point(i, r) {
    const a = (-90 + i * 60) * Math.PI / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  }

  static #poly(rs) {
    return rs.map((r, i) => StatsWindow.#point(i, r).map(n => n.toFixed(1)).join(",")).join(" ");
  }

  /** @override */
  async _prepareContext(options) {
    const actor = this.actor;
    const system = actor.system;
    const cfg = CONFIG.VITRUVIUM;
    const max = cfg.limits.characteristic.max;
    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    const characteristics = Object.entries(cfg.characteristics).map(([key, c]) => {
      const value = system.characteristics[key]?.value ?? 0;
      return {
        key, value,
        label: game.i18n.localize(c.label),
        hint: game.i18n.localize(c.hint),
        icon: c.icon,
        pips: [1, 2, 3].map(n => ({ on: n <= value }))
      };
    });
    const byKey = Object.fromEntries(characteristics.map(c => [c.key, c]));

    const axes = RADAR_ORDER.map((key, i) => {
      const [x, y] = StatsWindow.#point(i, LABEL_R);
      const c = byKey[key];
      return { ...c, left: (x / (2 * C) * 100).toFixed(2), top: (y / (2 * C) * 100).toFixed(2) };
    });
    const valueR = RADAR_ORDER.map(k => R * Math.clamp(byKey[k].value, 0, max) / max);
    const radar = {
      size: 2 * C,
      rings: [1, 2, 3].map(n => StatsWindow.#poly(Array(6).fill(R * n / max))),
      spokes: RADAR_ORDER.map((_, i) => {
        const [x, y] = StatsWindow.#point(i, R);
        return { x: x.toFixed(1), y: y.toFixed(1) };
      }),
      shape: StatsWindow.#poly(valueR),
      dots: valueR.map((r, i) => {
        const [x, y] = StatsWindow.#point(i, r);
        return { x: x.toFixed(1), y: y.toFixed(1) };
      }),
      center: C,
      axes,
      points: system.budget.charPoints
    };

    const level = cfg.levels[system.level];
    const tooltipList = list => list.filter(s => s?.name).map(s => s.name).join(", ");

    return {
      actor, system,
      isCharacter: actor.type === "character",
      level: level ? { label: game.i18n.localize(level.label), points: level.points } : null,
      characteristics, radar,
      inspiration: {
        value: system.inspiration.value,
        max: system.inspiration.max,
        pips: Array.from({ length: system.inspiration.max }, (_, i) => ({ n: i + 1, on: i < system.inspiration.value }))
      },
      inspirationIcon: cfg.inspirationIcon,
      attributes: items.filter(i => i.type === "attribute").map(i => ({ name: i.name })),
      domains: items.filter(i => i.type === "domain").map(i => ({
        name: i.name,
        level: i.system.level,
        abilities: tooltipList(i.system.abilities)
      })),
      property: items.filter(i => i.type === "property").map(i => ({
        name: i.name,
        statuses: tooltipList(i.system.statuses ?? [])
      })),
      statuses: system.statuses.filter(s => s.name),
      levels: system.levels.filter(l => l.name),
      aspects: system.aspects.filter(a => a.name).map(a => ({
        ...a,
        current: a.scale?.find(s => s.value === a.value)?.label ?? ""
      })),
      canRoll: actor.isOwner,
      canEditInspiration: game.user.isGM || actor.isOwner
    };
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.actor.apps[this.id] = this;
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    delete this.actor.apps[this.id];
  }

  static async #onRoll(event, target) {
    if ( !this.actor.isOwner ) return;
    return this.actor.check({ characteristic: target.dataset.characteristic });
  }

  static async #onSetInspiration(event, target) {
    if ( !(game.user.isGM || this.actor.isOwner) ) return;
    const n = Number(target.dataset.value);
    const current = this.actor.system.inspiration.value;
    return this.actor.update({ "system.inspiration.value": current === n ? n - 1 : n });
  }

  static #onOpenSheet() {
    return this.actor.sheet.render({ force: true });
  }
}
