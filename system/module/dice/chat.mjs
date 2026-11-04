import { check } from "./check.mjs";

const { DialogV2 } = foundry.applications.api;
const renderTemplate = (...args) => foundry.applications.handlebars.renderTemplate(...args);

/**
 * Карточки в чате:
 * - результат проверки: мастер может отметить провал как частичный успех (правило «Частичный успех»);
 * - запрос проверки от мастера: игрок жмёт кнопку и бросает своим персонажем.
 */
export function registerChatHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const check = message.getFlag("vitruvium", "check");
    if ( check ) decorateCheck(message, html, check);
    const request = message.getFlag("vitruvium", "request");
    if ( request ) decorateRequest(message, html, request);
  });
}

function decorateCheck(message, html, flag) {
  const outcome = html.querySelector(".vitruvium-outcome");
  if ( outcome && flag.partial ) {
    outcome.dataset.outcome = "partial";
    outcome.textContent = game.i18n.localize("VITRUVIUM.Check.Partial");
  }
  const tools = html.querySelector(".vitruvium-gm-tools");
  if ( !tools ) return;
  if ( !game.user.isGM || flag.outcome !== "failure" ) {
    tools.remove();
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("vitruvium-partial-toggle");
  btn.textContent = game.i18n.localize(flag.partial ? "VITRUVIUM.Check.PartialUndo" : "VITRUVIUM.Check.PartialMark");
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    message.setFlag("vitruvium", "check.partial", !flag.partial);
  });
  tools.replaceChildren(btn);
}

function decorateRequest(message, html, flag) {
  const btn = html.querySelector("[data-vitruvium-request]");
  if ( !btn ) return;
  btn.addEventListener("click", async ev => {
    ev.preventDefault();
    const actor = pickActor();
    if ( !actor ) {
      ui.notifications.warn(game.i18n.localize("VITRUVIUM.Request.NoActor"));
      return;
    }
    await check(actor, {
      characteristic: flag.characteristic || null,
      difficulty: flag.difficulty || null,
      advantages: flag.advantages || 0,
      hindrances: flag.hindrances || 0,
      lockDifficulty: true,
      requestId: message.id
    });
  });
}

/** Персонаж для броска: выделенный токен, иначе назначенный пользователю персонаж. */
function pickActor() {
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner);
  return token?.actor ?? game.user.character ?? null;
}

/** Окно мастера: какую характеристику проверить, сложность, преимущества и помехи. */
export async function requestCheck() {
  if ( !game.user.isGM ) return null;
  const data = {
    characteristics: Object.entries(CONFIG.VITRUVIUM.characteristics).map(([key, c]) => ({ key, label: game.i18n.localize(c.label) })),
    difficulties: [1, 2, 3, 4, 5, 6],
    modifiers: [0, 1, 2]
  };
  const content = await renderTemplate("systems/vitruvium/templates/apps/request-dialog.hbs", data);
  const fd = await DialogV2.wait({
    window: { title: game.i18n.localize("VITRUVIUM.Request.Title"), icon: "fa-solid fa-bullhorn" },
    classes: ["vitruvium", "vitruvium-check-dialog"],
    position: { width: 400 },
    content,
    rejectClose: false,
    buttons: [{
      action: "send",
      label: game.i18n.localize("VITRUVIUM.Request.Send"),
      icon: "fa-solid fa-paper-plane",
      default: true,
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    }, { action: "cancel", label: game.i18n.localize("Cancel") }]
  });
  if ( !fd || fd === "cancel" ) return null;

  const flag = {
    characteristic: fd.characteristic || null,
    difficulty: fd.difficulty ? Number(fd.difficulty) : null,
    advantages: Number(fd.advantages) || 0,
    hindrances: Number(fd.hindrances) || 0,
    note: fd.note ?? ""
  };
  const charCfg = flag.characteristic ? CONFIG.VITRUVIUM.characteristics[flag.characteristic] : null;
  const card = await renderTemplate("systems/vitruvium/templates/chat/request-card.hbs", {
    ...flag,
    characteristicLabel: charCfg ? game.i18n.localize(charCfg.label) : null
  });
  return ChatMessage.implementation.create({
    speaker: { alias: game.i18n.localize("VITRUVIUM.Request.Speaker") },
    content: card,
    flags: { vitruvium: { request: flag } }
  });
}
