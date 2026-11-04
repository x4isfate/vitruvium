import { MODULE_ID, FEATURE_TYPE, CLAIM_STATUS } from "./constants.mjs";
import FeatureModel from "./data/feature-model.mjs";
import { getAtlas, ensureAtlas, getClaims } from "./data/store.mjs";
import MapLayer, { LAYER_NAME } from "./canvas/map-layer.mjs";
import FeatureSheet from "./apps/feature-sheet.mjs";
import AtlasConfig from "./apps/atlas-config.mjs";
import ClaimsApp from "./apps/claims-app.mjs";
import FeaturePageSheet from "./sheets/feature-page-sheet.mjs";
import {
  SOCKET, onSocket, onCheckMessage, onCheckUpdated, autoApplyTrusted, rollForClaim
} from "./review/claims.mjs";

/* ------------------------------------------------------------------ */
/*  Подключение                                                        */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  CONFIG.JournalEntryPage.dataModels[FEATURE_TYPE] = FeatureModel;
  CONFIG.Canvas.layers[LAYER_NAME] = { layerClass: MapLayer, group: "interface" };

  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, FeaturePageSheet, {
    types: [FEATURE_TYPE], makeDefault: true, label: "VMAP.Sheet.page"
  });

  game.settings.register(MODULE_ID, "autoApplyOnSuccess", {
    name: "VMAP.Settings.autoApplyOnSuccess.name",
    hint: "VMAP.Settings.autoApplyOnSuccess.hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ClaimsApp.refresh()
  });
  game.settings.register(MODULE_ID, "trustedUsers", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => ClaimsApp.refresh()
  });
  game.settings.register(MODULE_ID, "renderBelowTokens", {
    name: "VMAP.Settings.renderBelowTokens.name",
    hint: "VMAP.Settings.renderBelowTokens.hint",
    scope: "world", config: true, type: Boolean, default: false,
    requiresReload: true
  });

  foundry.applications.handlebars.loadTemplates({
    vmapStatus: `modules/${MODULE_ID}/templates/status-row.hbs`,
    vmapClaim: `modules/${MODULE_ID}/templates/claim-card.hbs`,
    vmapOp: `modules/${MODULE_ID}/templates/op-row.hbs`
  });

  game.modules.get(MODULE_ID).api = {
    openFeature: id => FeatureSheet.open(id),
    openClaims: () => ClaimsApp.open(),
    openAtlasConfig: () => game.user.isGM ? new AtlasConfig().render({ force: true }) : null,
    activateLayer,
    getAtlas, ensureAtlas,
    layer: () => canvas[LAYER_NAME]
  };
});

/** Включить группу «Карта мира» в панели слева. */
function activateLayer(tool = "select") {
  if ( ui.controls?.activate ) ui.controls.activate({ control: LAYER_NAME, tool });
  else canvas[LAYER_NAME]?.activate();
}

/** Запасной путь: если Foundry не собрал группу со слоя, добавить её вручную. */
Hooks.on("getSceneControlButtons", controls => {
  if ( controls && !controls[LAYER_NAME] ) {
    const control = MapLayer.prepareSceneControls();
    if ( control ) controls[LAYER_NAME] = control;
  }
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, onSocket);
  rememberClaimStatuses();
});

/* ------------------------------------------------------------------ */
/*  Перерисовка                                                        */
/* ------------------------------------------------------------------ */

const refreshMap = () => canvas?.ready && canvas[LAYER_NAME]?.refresh();
const isCurrentAtlas = journal => !!journal && journal === getAtlas(canvas?.scene);

for ( const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"] ) {
  Hooks.on(hook, page => {
    if ( page.type !== FEATURE_TYPE ) return;
    if ( isCurrentAtlas(page.parent) ) refreshMap();
    ClaimsApp.refresh();
  });
}
Hooks.on("updateJournalEntry", journal => {
  if ( isCurrentAtlas(journal) ) refreshMap();
});
Hooks.on("updateScene", (scene, changes) => {
  if ( scene === canvas?.scene && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) refreshMap();
});
Hooks.on("canvasReady", () => refreshMap());

Hooks.on("updateUser", (user, changes) => {
  if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) return;
  if ( user.isSelf || game.user.isGM ) refreshMap();
  ClaimsApp.refresh();
  canvas?.[LAYER_NAME]?.palette?.render();
  if ( user.isSelf ) announceDecisions(user);
  if ( game.user.isGM ) autoApplyTrusted(user);
});

/* ------------------------------------------------------------------ */
/*  Решения по заявкам: сообщить игроку                                */
/* ------------------------------------------------------------------ */

let knownStatuses = new Map();

function rememberClaimStatuses() {
  knownStatuses = new Map(getClaims(game.user).map(c => [c.id, c.status]));
}

function announceDecisions(user) {
  if ( user.isGM ) return rememberClaimStatuses();
  for ( const claim of getClaims(user) ) {
    const before = knownStatuses.get(claim.id);
    if ( !before || before === claim.status ) continue;
    const key = {
      [CLAIM_STATUS.applied]: "VMAP.Claims.youApplied",
      [CLAIM_STATUS.rejected]: "VMAP.Claims.youRejected",
      [CLAIM_STATUS.check]: "VMAP.Claims.youCheck"
    }[claim.status];
    if ( key ) ui.notifications.info(game.i18n.format(key, { title: claim.title }));
  }
  rememberClaimStatuses();
}

/* ------------------------------------------------------------------ */
/*  Чат: карточка проверки по заявке                                   */
/* ------------------------------------------------------------------ */

Hooks.on("renderChatMessageHTML", (message, html) => {
  const flag = message.getFlag(MODULE_ID, "claimCheck");
  if ( !flag ) return;
  const btn = html.querySelector("[data-vmap-claim-roll]");
  if ( !btn ) return;
  const claim = getClaims(game.users.get(flag.userId)).find(c => c.id === flag.claimId);
  const canRoll = (flag.userId === game.user.id || game.user.isGM) && claim?.status === CLAIM_STATUS.check
    && claim?.messageId === message.id;
  if ( !canRoll ) {
    btn.disabled = true;
    if ( claim && claim.status !== CLAIM_STATUS.check ) btn.textContent = game.i18n.localize(`VMAP.ClaimStatus.${claim.status}`);
    return;
  }
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    rollForClaim(message);
  });
});

Hooks.on("createChatMessage", message => onCheckMessage(message));
Hooks.on("updateChatMessage", (message, changes) => onCheckUpdated(message, changes));
