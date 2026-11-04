import VitruviumDie from "./vitruvium-die.mjs";

const { DialogV2 } = foundry.applications.api;
const renderTemplate = (...args) => foundry.applications.handlebars.renderTemplate(...args);

/**
 * Проверка характеристики по правилам «ВИТРУВИЯ».
 *
 * Кубиков: уровень характеристики + уровень домена (если игрок использует способности домена)
 * + 1 за потраченное вдохновение. Бросают от 1 до 6 кубиков.
 * Домен в подходящей ситуации бросается сам по себе с уровнем домена.
 * Преимущество и помеха дают дополнительный бросок, засчитывается лучший или худший.
 * Не больше двух, преимущества и помехи гасят друг друга.
 * Вдохновение за способность добавляет к результату успехи по уровню домена.
 */

/** @typedef {object} CheckOptions
 * @property {string|null} characteristic  Ключ характеристики или null, если домен бросается сам
 * @property {string|null} domainId        id предмета-домена у актера
 * @property {number|null} difficulty      Сложность 1–6 или null, если мастер её не задал
 * @property {number} advantages           0–2
 * @property {number} hindrances           0–2
 * @property {boolean} inspireDie          Потратить 1 вдохновение на +1 кубик
 * @property {boolean} inspireSuccesses    Потратить 1 вдохновение на успехи по уровню домена
 * @property {string} [requestId]          id сообщения-запроса мастера
 */

const clamp = (n, lo, hi) => Math.min(Math.max(Number(n) || 0, lo), hi);

/** Считает параметры проверки без броска. Используется и окном, и самим броском. */
export function prepareCheck(actor, options) {
  const L = CONFIG.VITRUVIUM.limits;
  const sys = actor.system;
  const domain = options.domainId ? actor.items.get(options.domainId) : null;
  const domainLevel = domain?.type === "domain" ? domain.system.level : 0;
  const charLevel = options.characteristic ? (sys.characteristics?.[options.characteristic]?.value ?? 0) : 0;

  let dice = charLevel + domainLevel + (options.inspireDie ? 1 : 0);
  const rawDice = dice;
  dice = clamp(dice, L.pool.min, L.pool.max);

  const adv = clamp(options.advantages, 0, L.modifiers);
  const hin = clamp(options.hindrances, 0, L.modifiers);
  const net = adv - hin;

  const spend = (options.inspireDie ? 1 : 0) + (options.inspireSuccesses && domainLevel ? 1 : 0);
  const bonus = options.inspireSuccesses && domainLevel ? domainLevel : 0;
  const difficulty = options.difficulty ? clamp(options.difficulty, L.difficulty.min, L.difficulty.max) : null;

  return {
    dice, rawDice, capped: rawDice !== dice, net, adv, hin, spend, bonus, difficulty,
    domain, domainLevel, charLevel,
    inspiration: sys.inspiration?.value ?? 0,
    enoughInspiration: spend <= (sys.inspiration?.value ?? 0)
  };
}

/** Бросок проверки и карточка в чате. */
export async function rollCheck(actor, options = {}) {
  options = foundry.utils.mergeObject({
    characteristic: null, domainId: null, difficulty: null,
    advantages: 0, hindrances: 0, inspireDie: false, inspireSuccesses: false
  }, options, { inplace: false });

  if ( Hooks.call("vitruvium.preRollCheck", actor, options) === false ) return null;

  const prep = prepareCheck(actor, options);
  if ( !prep.enoughInspiration ) {
    ui.notifications.warn(game.i18n.localize("VITRUVIUM.Check.NoInspiration"));
    return null;
  }
  if ( !options.characteristic && !prep.domain ) {
    ui.notifications.warn(game.i18n.localize("VITRUVIUM.Check.NothingToRoll"));
    return null;
  }

  // Основной бросок и дополнительные за преимущества или помехи.
  const count = 1 + Math.abs(prep.net);
  const rolls = [];
  for ( let i = 0; i < count; i++ ) {
    const roll = new Roll(`${prep.dice}d${VitruviumDie.DENOMINATION}`);
    await roll.evaluate();
    rolls.push(roll);
  }
  const values = rolls.map(r => r.total);
  let chosen = 0;
  if ( prep.net > 0 ) chosen = values.indexOf(Math.max(...values));
  else if ( prep.net < 0 ) chosen = values.indexOf(Math.min(...values));

  const successes = values[chosen] + prep.bonus;
  let outcome = null;
  if ( prep.difficulty ) outcome = successes >= prep.difficulty ? "success" : "failure";

  if ( prep.spend ) {
    await actor.update({ "system.inspiration.value": prep.inspiration - prep.spend });
  }

  const charCfg = options.characteristic ? CONFIG.VITRUVIUM.characteristics[options.characteristic] : null;
  const title = charCfg
    ? game.i18n.localize(charCfg.label)
    : (prep.domain?.name ?? "");

  const context = {
    title,
    domain: prep.domain ? { name: prep.domain.name, level: prep.domainLevel, alone: !options.characteristic } : null,
    dice: prep.dice,
    capped: prep.capped,
    rawDice: prep.rawDice,
    difficulty: prep.difficulty,
    netLabel: prep.net > 0
      ? game.i18n.format("VITRUVIUM.Check.AdvantageN", { n: prep.net })
      : prep.net < 0 ? game.i18n.format("VITRUVIUM.Check.HindranceN", { n: -prep.net }) : null,
    neutralized: prep.adv > 0 && prep.hin > 0,
    inspireDie: options.inspireDie,
    bonus: prep.bonus,
    successes,
    outcome,
    rolls: rolls.map((r, i) => ({
      counted: i === chosen,
      successes: r.total,
      faces: r.dice[0].results.map(res => {
        const n = VitruviumDie.successesFor(res.result);
        return { n, icon: CONFIG.VITRUVIUM.faceIcons[n] };
      })
    }))
  };
  const content = await renderTemplate("systems/vitruvium/templates/chat/check-card.hbs", context);

  const message = await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls,
    sound: CONFIG.sounds.dice,
    flags: {
      vitruvium: {
        check: {
          actorUuid: actor.uuid,
          options,
          successes,
          difficulty: prep.difficulty,
          outcome,
          partial: false
        }
      }
    }
  }, { rollMode: game.settings.get("core", "rollMode") });

  Hooks.callAll("vitruvium.rollCheck", actor, { options, successes, outcome, rolls }, message);
  return message;
}

/** Окно проверки. Возвращает выбранные параметры или null. */
export async function promptCheck(actor, preset = {}) {
  const domains = actor.items.filter(i => i.type === "domain")
    .sort((a, b) => a.sort - b.sort)
    .map(d => ({ id: d.id, name: d.name, level: d.system.level }));

  const data = {
    characteristic: preset.characteristic ?? null,
    domainId: preset.domainId ?? null,
    difficulty: preset.difficulty ?? null,
    advantages: preset.advantages ?? 0,
    hindrances: preset.hindrances ?? 0,
    lockDifficulty: !!preset.lockDifficulty,
    characteristics: Object.entries(CONFIG.VITRUVIUM.characteristics).map(([key, c]) => ({
      key, label: game.i18n.localize(c.label), value: actor.system.characteristics?.[key]?.value ?? 0
    })),
    domains,
    difficulties: [1, 2, 3, 4, 5, 6],
    modifiers: [0, 1, 2],
    inspiration: actor.system.inspiration?.value ?? 0
  };
  const content = await renderTemplate("systems/vitruvium/templates/apps/check-dialog.hbs", data);

  const update = (form) => {
    const fd = new foundry.applications.ux.FormDataExtended(form).object;
    const opts = normalizeForm(fd);
    const prep = prepareCheck(actor, opts);
    const out = form.querySelector("[data-preview]");
    if ( !out ) return;
    const parts = [game.i18n.format("VITRUVIUM.Check.PreviewDice", { n: prep.dice })];
    if ( prep.capped ) parts.push(game.i18n.localize("VITRUVIUM.Check.PreviewCapped"));
    if ( prep.net ) parts.push(game.i18n.format("VITRUVIUM.Check.PreviewExtra", { n: Math.abs(prep.net) }));
    if ( prep.bonus ) parts.push(game.i18n.format("VITRUVIUM.Check.PreviewBonus", { n: prep.bonus }));
    if ( prep.spend ) parts.push(game.i18n.format("VITRUVIUM.Check.PreviewSpend", { n: prep.spend, have: prep.inspiration }));
    out.textContent = parts.join(" · ");
    out.classList.toggle("warn", !prep.enoughInspiration);
    const succ = form.querySelector("[name=inspireSuccesses]");
    if ( succ ) succ.disabled = !opts.domainId;
    const charSel = form.querySelector("[name=characteristic]");
    if ( charSel && !opts.domainId && !charSel.value ) charSel.value = Object.keys(CONFIG.VITRUVIUM.characteristics)[0];
  };

  const result = await DialogV2.wait({
    window: { title: game.i18n.format("VITRUVIUM.Check.Title", { name: actor.name }), icon: "fa-solid fa-dice-six" },
    classes: ["vitruvium", "vitruvium-check-dialog"],
    position: { width: 420 },
    content,
    rejectClose: false,
    buttons: [{
      action: "roll",
      label: game.i18n.localize("VITRUVIUM.Check.Roll"),
      icon: "fa-solid fa-dice-six",
      default: true,
      callback: (event, button) => normalizeForm(new foundry.applications.ux.FormDataExtended(button.form).object)
    }, {
      action: "cancel",
      label: game.i18n.localize("Cancel")
    }],
    render: (event, dialog) => {
      const form = (dialog.element ?? dialog).querySelector("form") ?? dialog.form;
      if ( !form ) return;
      form.addEventListener("change", () => update(form));
      update(form);
    }
  });
  if ( !result || result === "cancel" ) return null;
  if ( preset.requestId ) result.requestId = preset.requestId;
  return result;
}

function normalizeForm(fd) {
  return {
    characteristic: fd.characteristic || null,
    domainId: fd.domainId || null,
    difficulty: fd.difficulty ? Number(fd.difficulty) : null,
    advantages: Number(fd.advantages) || 0,
    hindrances: Number(fd.hindrances) || 0,
    inspireDie: !!fd.inspireDie,
    inspireSuccesses: !!fd.inspireSuccesses && !!fd.domainId
  };
}

/** Окно и бросок одной функцией. */
export async function check(actor, preset = {}) {
  const opts = await promptCheck(actor, preset);
  if ( !opts ) return null;
  return rollCheck(actor, opts);
}
