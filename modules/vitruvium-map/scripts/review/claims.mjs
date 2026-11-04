import { MODULE_ID, CLAIM_STATUS } from "../constants.mjs";
import {
  getAtlas, ensureAtlas, getDraft, setDraft, getClaims, setClaims, revOf, applyPlan, atlasStates
} from "../data/store.mjs";
import { addToDraft, draftOps, buildApplyPlan, conflictOf, randomId } from "./ops.mjs";

/**
 * Заявки. Игрок собирает правки в черновик и отправляет их одной заявкой с названием
 * и пояснением. Мастер принимает, отклоняет или назначает проверку. Проверка идёт
 * обычным броском Витрувия, результат возвращается в заявку сам.
 *
 * Claim = {
 *   id, sceneId, title, note, ops: [Op], status, createdAt,
 *   difficulty?, messageId?, outcome?, successes?, partial?, comment?
 * }
 */

const L = k => game.i18n.localize(k);
const isActiveGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
const setting = key => game.settings.get(MODULE_ID, key);

/** Заявки всех игроков: [{ user, claim }], старые первыми. */
export function allClaims({ includeClosed = false } = {}) {
  const out = [];
  for ( const user of game.users ) {
    for ( const claim of getClaims(user) ) {
      if ( !includeClosed && [CLAIM_STATUS.rejected, CLAIM_STATUS.applied].includes(claim.status) ) continue;
      out.push({ user, claim });
    }
  }
  return out.sort((a, b) => (a.claim.createdAt ?? 0) - (b.claim.createdAt ?? 0));
}

/** Открытые заявки, которые ещё ждут решения. */
export const isOpen = claim => [CLAIM_STATUS.pending, CLAIM_STATUS.check, CLAIM_STATUS.rolled].includes(claim.status);

/** Конфликты правок заявки с текущим атласом: id → "exists" | "missing" | "stale". */
export function claimConflicts(claim, atlas = getAtlas(game.scenes.get(claim.sceneId))) {
  const out = {};
  for ( const op of claim.ops ?? [] ) {
    const c = conflictOf(op, revOf(atlas, op.id));
    if ( c ) out[op.id] = c;
  }
  return out;
}

/* ---------------------------------------------------------------- */
/*  Игрок                                                            */
/* ---------------------------------------------------------------- */

/** Отправить черновик сцены заявкой. */
export async function submitDraft({ title = "", note = "" } = {}, scene = canvas.scene) {
  const draft = getDraft(game.user, scene.id);
  const ops = draftOps(draft);
  if ( !ops.length ) return ui.notifications.warn(L("VMAP.Claims.emptyDraft"));
  const claim = {
    id: randomId(), sceneId: scene.id,
    title: title.trim() || L("VMAP.Claims.untitled"),
    note: note.trim(), ops,
    status: CLAIM_STATUS.pending, createdAt: Date.now()
  };
  // Сначала заявка, потом пустой черновик: так правки не пропадут при сбое между вызовами.
  await game.user.update({
    [`flags.${MODULE_ID}.claims`]: [...getClaims(game.user), claim],
    [`flags.${MODULE_ID}.drafts.${scene.id}`]: []
  });
  notifyGM("submitted", { userId: game.user.id, claimId: claim.id });
  return claim;
}

/** Вернуть заявку в черновик: правки снова можно менять. Заявка исчезает. */
export async function returnToDraft(claimId, user = game.user) {
  const claims = getClaims(user);
  const claim = claims.find(c => c.id === claimId);
  if ( !claim ) return;
  let draft = getDraft(user, claim.sceneId);
  for ( const op of claim.ops ) draft = addToDraft(draft, op);
  await user.update({
    [`flags.${MODULE_ID}.claims`]: claims.filter(c => c.id !== claimId),
    [`flags.${MODULE_ID}.drafts.${claim.sceneId}`]: draftOps(draft)
  });
}

/** Убрать заявку совсем (свою закрытую, или отозвать открытую). */
export async function dropClaim(claimId, user = game.user) {
  return setClaims(getClaims(user).filter(c => c.id !== claimId), user);
}

/** Убрать из списка все закрытые заявки. */
export async function clearClosed(user = game.user) {
  return setClaims(getClaims(user).filter(isOpen), user);
}

/** Бросить проверку по заявке. Персонаж: выделенный токен или персонаж пользователя. */
export async function rollForClaim(message) {
  const flag = message.getFlag(MODULE_ID, "claimCheck");
  if ( !flag ) return;
  if ( flag.userId !== game.user.id && !game.user.isGM ) return ui.notifications.warn(L("VMAP.Check.notYours"));
  const owner = game.users.get(flag.userId);
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner);
  const actor = token?.actor ?? owner?.character ?? game.user.character;
  if ( !actor ) return ui.notifications.warn(L("VMAP.Check.noActor"));
  if ( !game.vitruvium?.check ) return ui.notifications.error(L("VMAP.Check.noSystem"));
  return game.vitruvium.check(actor, { difficulty: flag.difficulty, lockDifficulty: true, requestId: message.id });
}

/* ---------------------------------------------------------------- */
/*  Мастер                                                           */
/* ---------------------------------------------------------------- */

/** Поменять заявку в флагах её автора. */
async function patchClaim(user, claimId, patch) {
  const claims = getClaims(user);
  const claim = claims.find(c => c.id === claimId);
  if ( !claim ) return null;
  Object.assign(claim, patch);
  await setClaims(claims, user);
  return claim;
}

/**
 * Собрать один план из нескольких заявок. Правки к одному элементу склеиваются
 * в порядке подачи заявок, baseRev берётся у первой.
 */
export function planFor(entries, atlas, { force = false } = {}) {
  let merged = {};
  for ( const { claim } of [...entries].sort((a, b) => (a.claim.createdAt ?? 0) - (b.claim.createdAt ?? 0)) ) {
    for ( const op of claim.ops ?? [] ) merged = addToDraft(merged, op);
  }
  return buildApplyPlan(draftOps(merged), id => revOf(atlas, id), { force });
}

/**
 * Принять заявки. Если часть правок устарела, мастер решает: применить поверх или
 * пропустить устаревшие. ask=false применяет поверх без вопроса (автоприём).
 */
export async function applyClaims(entries, { ask = true } = {}) {
  if ( !game.user.isGM || !entries.length ) return;
  const bySceneId = Map.groupBy?.(entries, e => e.claim.sceneId) ?? groupBy(entries, e => e.claim.sceneId);
  for ( const [sceneId, list] of bySceneId ) {
    const scene = game.scenes.get(sceneId);
    if ( !scene ) continue;
    const atlas = getAtlas(scene) ?? await ensureAtlas(scene);
    let plan = planFor(list, atlas);
    if ( plan.skipped.length ) {
      let force = !ask;
      if ( ask ) {
        const names = plan.skipped.map(s => `<li>${foundry.utils.escapeHTML(s.op.state?.name ?? s.op.name ?? s.op.id)} · ${L(`VMAP.Conflict.${s.conflict}`)}</li>`).join("");
        force = await foundry.applications.api.DialogV2.confirm({
          window: { title: "VMAP.Claims.conflictsTitle" },
          content: `<p>${L("VMAP.Claims.conflictsText")}</p><ul>${names}</ul>`,
          yes: { label: "VMAP.Claims.applyAnyway" },
          no: { label: "VMAP.Claims.skipStale" }
        });
        if ( force === null ) return;
      }
      if ( force ) plan = planFor(list, atlas, { force: true });
    }
    await applyPlan(atlas, plan);
  }
  for ( const { user, claim } of entries ) {
    await patchClaim(user, claim.id, { status: CLAIM_STATUS.applied, decidedAt: Date.now() });
  }
  ui.notifications.info(game.i18n.format("VMAP.Claims.appliedN", { n: entries.length }));
}

/** Отклонить заявки с пояснением. */
export async function rejectClaims(entries, comment = "") {
  if ( !game.user.isGM ) return;
  for ( const { user, claim } of entries ) {
    await patchClaim(user, claim.id, { status: CLAIM_STATUS.rejected, comment, decidedAt: Date.now() });
  }
}

/** Назначить проверку: карточка в чат, игрок бросает по кнопке. */
export async function requestClaimCheck({ user, claim }, difficulty, note = "") {
  if ( !game.user.isGM ) return;
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/check-card.hbs`, {
    title: claim.title, note, difficulty, player: user.name,
    count: claim.ops.length
  });
  const message = await ChatMessage.implementation.create({
    content,
    speaker: { alias: L("VMAP.Check.speaker") },
    flags: { [MODULE_ID]: { claimCheck: { userId: user.id, claimId: claim.id, difficulty } } }
  });
  await patchClaim(user, claim.id, {
    status: CLAIM_STATUS.check, difficulty, messageId: message.id, checkNote: note,
    outcome: null, successes: null, partial: false
  });
  return message;
}

/**
 * Бросок Витрувия пришёл в чат. Если он сделан по карточке заявки, записать результат.
 * Успех принимается сам, если включена настройка.
 */
export async function onCheckMessage(message) {
  if ( !isActiveGM() ) return;
  const check = message.getFlag("vitruvium", "check");
  const requestId = check?.options?.requestId;
  if ( !requestId ) return;
  const request = game.messages.get(requestId);
  const flag = request?.getFlag(MODULE_ID, "claimCheck");
  if ( !flag ) return;
  const user = game.users.get(flag.userId);
  if ( !user ) return;
  const claim = await patchClaim(user, flag.claimId, {
    status: CLAIM_STATUS.rolled, outcome: check.outcome, successes: check.successes,
    partial: !!check.partial, rollId: message.id
  });
  if ( claim && check.outcome === "success" && setting("autoApplyOnSuccess") ) {
    await applyClaims([{ user, claim }], { ask: false });
  }
}

/** Мастер отметил провал частичным успехом: перенести отметку в заявку. */
export async function onCheckUpdated(message, changes) {
  if ( !isActiveGM() ) return;
  if ( foundry.utils.getProperty(changes, "flags.vitruvium.check.partial") === undefined ) return;
  const check = message.getFlag("vitruvium", "check");
  for ( const { user, claim } of allClaims() ) {
    if ( claim.rollId === message.id ) await patchClaim(user, claim.id, { partial: !!check.partial });
  }
}

/** Доверенные игроки: их заявки активный мастер принимает сразу. */
export async function autoApplyTrusted(user) {
  if ( !isActiveGM() || user.isGM ) return;
  const trusted = setting("trustedUsers") ?? [];
  if ( !trusted.includes(user.id) ) return;
  const entries = getClaims(user).filter(c => c.status === CLAIM_STATUS.pending).map(claim => ({ user, claim }));
  if ( entries.length ) await applyClaims(entries, { ask: false });
}

/* ---------------------------------------------------------------- */
/*  Призраки для предпросмотра                                       */
/* ---------------------------------------------------------------- */

/** Как правки заявок выглядят на карте: [{ state, mode }]. */
export function ghostsFor(entries, atlas) {
  const base = atlasStates(atlas);
  const out = [];
  for ( const { claim } of entries ) {
    for ( const op of claim.ops ?? [] ) {
      const state = op.action === "delete" ? base.get(op.id) : op.state;
      if ( state ) out.push({ state: { ...state, id: op.id }, mode: op.action });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/*  Сокет                                                            */
/* ---------------------------------------------------------------- */

export const SOCKET = `module.${MODULE_ID}`;

export function notifyGM(event, data) {
  game.socket?.emit(SOCKET, { event, ...data });
}

export function onSocket(msg) {
  if ( !game.user.isGM || msg?.event !== "submitted" ) return;
  const user = game.users.get(msg.userId);
  if ( !user ) return;
  const trusted = (setting("trustedUsers") ?? []).includes(user.id);
  if ( !trusted ) ui.notifications.info(game.i18n.format("VMAP.Claims.newClaim", { name: user.name }));
}

function groupBy(list, fn) {
  const m = new Map();
  for ( const x of list ) {
    const k = fn(x);
    if ( !m.has(k) ) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
