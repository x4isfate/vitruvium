const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Окно приветствия: авторы «ВИТРУВИЯ» и как играть в Foundry.
 * Открывается при первом запуске новой версии системы, потом из настроек
 * («Настройки игры» → «Витрувий: приветствие») или командой game.vitruvium.welcome().
 */
export default class WelcomeWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vitruvium-welcome",
    classes: ["vitruvium", "vitruvium-welcome"],
    position: { width: 620, height: "auto" },
    window: { title: "VITRUVIUM.Welcome.Title", icon: "fa-solid fa-dice-six", resizable: true },
    actions: {
      openRules: WelcomeWindow.#onOpenRules,
      hideOnStart: WelcomeWindow.#onHideOnStart,
      showOnStart: WelcomeWindow.#onShowOnStart
    }
  };

  static PARTS = {
    body: { template: "systems/vitruvium/templates/apps/welcome.hbs", scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    return {
      version: game.system.version,
      rulesVersion: "Beta 3.1",
      showOnStart: game.settings.get("vitruvium", "welcomeShowOnStart"),
      isGM: game.user.isGM
    };
  }

  static async #onOpenRules() {
    const pack = game.packs.get("vitruvium.rules");
    if ( !pack ) return;
    const docs = await pack.getDocuments();
    const entry = docs.find(d => d.getFlag("vitruvium", "main")) ?? docs[0];
    if ( entry ) entry.sheet.render(true);
    else pack.render(true);
  }

  /** «Больше не показывать»: запомнить и закрыть окно. */
  static async #onHideOnStart() {
    await game.settings.set("vitruvium", "welcomeShowOnStart", false);
    return this.close();
  }

  static async #onShowOnStart() {
    await game.settings.set("vitruvium", "welcomeShowOnStart", true);
    return this.render();
  }

  /** Показать при запуске, если игрок не отключил окно. */
  static maybeShow() {
    const seen = game.settings.get("vitruvium", "welcomeSeenVersion");
    const show = game.settings.get("vitruvium", "welcomeShowOnStart");
    const isNew = foundry.utils.isNewerVersion(game.system.version, seen || "0.0.0");
    if ( show ) new WelcomeWindow().render(true);
    if ( isNew ) game.settings.set("vitruvium", "welcomeSeenVersion", game.system.version);
  }
}

/** Пункт в настройках, который открывает окно. */
export class WelcomeMenu extends ApplicationV2 {
  async render() {
    return new WelcomeWindow().render(true);
  }
}
