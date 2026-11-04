import { VITRUVIUM } from "./config.mjs";
import VitruviumDie from "./dice/vitruvium-die.mjs";
import { registerDiceGuard, findForbiddenDie } from "./dice/dice-guard.mjs";
import { check, rollCheck, prepareCheck } from "./dice/check.mjs";
import { registerChatHooks, requestCheck } from "./dice/chat.mjs";
import { CharacterModel, NpcModel, DomainModel, AttributeModel, PropertyModel } from "./data/models.mjs";
import { VitruviumActor, VitruviumItem } from "./documents/documents.mjs";
import VitruviumActorSheet from "./sheets/actor-sheet.mjs";
import VitruviumItemSheet from "./sheets/item-sheet.mjs";
import WelcomeWindow, { WelcomeMenu } from "./apps/welcome.mjs";

Hooks.once("init", () => {
  console.log("Vitruvium | init");

  // Конфигурация, которую могут менять модули в своём хуке "init".
  CONFIG.VITRUVIUM = VITRUVIUM;

  // Документы и модели данных.
  CONFIG.Actor.documentClass = VitruviumActor;
  CONFIG.Item.documentClass = VitruviumItem;
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterModel, npc: NpcModel });
  Object.assign(CONFIG.Item.dataModels, { domain: DomainModel, attribute: AttributeModel, property: PropertyModel });
  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["inspiration"], value: [] },
    npc: { bar: ["inspiration"], value: [] }
  };

  // Особый кубик: формула Ndv.
  CONFIG.Dice.terms[VitruviumDie.DENOMINATION] = VitruviumDie;
  registerDiceGuard();

  // Правила не задают инициативу: порядок ходов мастер выставляет в трекере сам.
  CONFIG.Combat.initiative = { formula: "0", decimals: 0 };

  // Листы.
  const DSC = foundry.applications.apps.DocumentSheetConfig;
  DSC.registerSheet(Actor, "vitruvium", VitruviumActorSheet, {
    types: ["character", "npc"], makeDefault: true, label: "VITRUVIUM.Sheet.actor"
  });
  DSC.registerSheet(Item, "vitruvium", VitruviumItemSheet, {
    types: ["domain", "attribute", "property"], makeDefault: true, label: "VITRUVIUM.Sheet.item"
  });

  registerSettings();
  registerHandlebars();
  registerChatHooks();

  foundry.applications.handlebars.loadTemplates([
    "systems/vitruvium/templates/actor/header.hbs",
    "systems/vitruvium/templates/actor/tabs.hbs",
    "systems/vitruvium/templates/actor/tab-description.hbs",
    "systems/vitruvium/templates/actor/tab-domains.hbs",
    "systems/vitruvium/templates/actor/tab-attributes.hbs",
    "systems/vitruvium/templates/actor/tab-property.hbs",
    "systems/vitruvium/templates/actor/tab-states.hbs",
    "systems/vitruvium/templates/actor/tab-notes.hbs",
    "systems/vitruvium/templates/actor/parts/item-list.hbs",
    "systems/vitruvium/templates/actor/parts/statuses-levels.hbs",
    "systems/vitruvium/templates/item/item-sheet.hbs",
    "systems/vitruvium/templates/chat/check-card.hbs",
    "systems/vitruvium/templates/chat/request-card.hbs",
    "systems/vitruvium/templates/apps/check-dialog.hbs",
    "systems/vitruvium/templates/apps/request-dialog.hbs",
    "systems/vitruvium/templates/apps/welcome.hbs"
  ]);

  // Открытый API для модулей, макросов и производных систем.
  game.vitruvium = {
    config: VITRUVIUM,
    VitruviumDie,
    check,
    rollCheck,
    prepareCheck,
    requestCheck,
    findForbiddenDie,
    welcome: () => new WelcomeWindow().render(true),
    apps: { WelcomeWindow, VitruviumActorSheet, VitruviumItemSheet }
  };

  Hooks.callAll("vitruvium.init", game.vitruvium);
});

Hooks.once("ready", () => {
  Hooks.callAll("vitruvium.ready", game.vitruvium);
  WelcomeWindow.maybeShow();
});

// Кнопка мастера «Запросить проверку» на панели токенов.
Hooks.on("getSceneControlButtons", controls => {
  if ( !game.user.isGM ) return;
  const tokens = controls.tokens ?? controls.token;
  if ( !tokens?.tools ) return;
  tokens.tools.vitruviumRequest = {
    name: "vitruviumRequest",
    title: "VITRUVIUM.Request.Title",
    icon: "fa-solid fa-bullhorn",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => requestCheck()
  };
});

function registerSettings() {
  game.settings.register("vitruvium", "welcomeShowOnStart", {
    name: "VITRUVIUM.Settings.welcomeShowOnStart",
    hint: "VITRUVIUM.Settings.welcomeShowOnStartHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register("vitruvium", "welcomeSeenVersion", {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });
  game.settings.registerMenu("vitruvium", "welcomeMenu", {
    name: "VITRUVIUM.Settings.welcomeMenu",
    label: "VITRUVIUM.Settings.welcomeMenuLabel",
    hint: "VITRUVIUM.Settings.welcomeMenuHint",
    icon: "fa-solid fa-book-open",
    type: WelcomeMenu,
    restricted: false
  });
}

function registerHandlebars() {
  Handlebars.registerHelper("vitruviumEq", (a, b) => a === b);
  Handlebars.registerHelper("vitruviumAdd", (a, b) => Number(a) + Number(b));
}
