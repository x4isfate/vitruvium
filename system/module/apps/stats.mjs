const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Узкое вертикальное окно с характеристиками и вдохновением персонажа.
 * Открывается кнопкой в шапке листа, обновляется вместе с актером.
 * Нажатие на характеристику запускает проверку, как в листе.
 */
export default class StatsWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `vitruvium-stats-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["vitruvium", "vitruvium-stats"],
    position: { width: 230, height: "auto" },
    window: { icon: "fa-solid fa-table-list", resizable: false },
    actions: {
      roll: StatsWindow.#onRoll,
      setInspiration: StatsWindow.#onSetInspiration
    }
  };

  static PARTS = {
    body: { template: "systems/vitruvium/templates/apps/stats.hbs" }
  };

  /** Открыть окно актера или поднять уже открытое. */
  static open(actor) {
    const existing = foundry.applications.instances.get(`vitruvium-stats-${actor.id}`);
    if ( existing ) return existing.render({ force: true });
    return new StatsWindow(actor).render({ force: true });
  }

  /** @override */
  get title() {
    return this.actor.name;
  }

  /** @override */
  async _prepareContext(options) {
    const actor = this.actor;
    const system = actor.system;
    const cfg = CONFIG.VITRUVIUM;
    const canEditInspiration = game.user.isGM || actor.isOwner;
    return {
      actor,
      characteristics: Object.entries(cfg.characteristics).map(([key, c]) => ({
        key,
        value: system.characteristics[key]?.value ?? 0,
        label: game.i18n.localize(c.label),
        hint: game.i18n.localize(c.hint),
        icon: c.icon
      })),
      inspiration: {
        value: system.inspiration.value,
        max: system.inspiration.max,
        pips: Array.from({ length: system.inspiration.max }, (_, i) => ({ n: i + 1, on: i < system.inspiration.value }))
      },
      inspirationIcon: cfg.inspirationIcon,
      canRoll: actor.isOwner,
      canEditInspiration
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
}
