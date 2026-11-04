import { MODULE_ID, FEATURE_TYPE, DEFAULT_STYLES, STARTER_TYPES, STARTER_LAYERS, CLAIM_STATUS } from "../constants.mjs";

const OPEN_STATUSES = [CLAIM_STATUS.pending, CLAIM_STATUS.check, CLAIM_STATUS.rolled];
import { addToDraft, draftOps, applyOps, buildApplyPlan } from "../review/ops.mjs";

/**
 * Где лежат данные карты.
 * - Атлас: журнал на сцену. Страницы журнала — элементы карты, флаги — типы и слои.
 * - Черновик игрока: флаг его документа User, по сцене: drafts.<sceneId> = [Op].
 * - Заявки игрока: флаг его документа User: claims = [Claim].
 * Игрок пишет только в свой User, атлас меняет только мастер.
 */

/* ---------------------------------------------------------------- */
/*  Атлас                                                            */
/* ---------------------------------------------------------------- */

/** Атлас сцены или null. */
export function getAtlas(scene = canvas?.scene) {
  if ( !scene ) return null;
  const id = scene.getFlag(MODULE_ID, "atlas");
  const byId = id ? game.journal.get(id) : null;
  if ( byId ) return byId;
  return game.journal.find(j => j.getFlag(MODULE_ID, "sceneId") === scene.id) ?? null;
}

/** Атлас сцены; если его нет, мастер его создаёт. */
export async function ensureAtlas(scene = canvas?.scene) {
  if ( !scene ) return null;
  const existing = getAtlas(scene);
  if ( existing ) return existing;
  if ( !game.user.isGM ) return null;
  const atlas = await JournalEntry.implementation.create({
    name: game.i18n.format("VMAP.Atlas.name", { scene: scene.name }),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { sceneId: scene.id, types: STARTER_TYPES, layers: STARTER_LAYERS } }
  });
  await scene.setFlag(MODULE_ID, "atlas", atlas.id);
  return atlas;
}

/** Страница журнала → состояние элемента для черновиков и рендера. */
export function pageToState(page) {
  return {
    id: page.id,
    name: page.name,
    text: page.text?.content ?? "",
    system: foundry.utils.deepClone(page._source.system)
  };
}

/** Все элементы атласа: Map id → состояние. */
export function atlasStates(atlas) {
  const out = new Map();
  if ( !atlas ) return out;
  for ( const page of atlas.pages ) {
    if ( page.type === FEATURE_TYPE ) out.set(page.id, pageToState(page));
  }
  return out;
}

export const getTypes = atlas => foundry.utils.deepClone(atlas?.getFlag(MODULE_ID, "types") ?? STARTER_TYPES);
export const getLayers = atlas => foundry.utils.deepClone(atlas?.getFlag(MODULE_ID, "layers") ?? STARTER_LAYERS)
  .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

export async function setTypes(atlas, types) {
  return atlas.update({ [`flags.${MODULE_ID}.types`]: types });
}
export async function setLayers(atlas, layers) {
  return atlas.update({ [`flags.${MODULE_ID}.layers`]: layers.map((l, i) => ({ ...l, sort: i })) });
}

/** Итоговый вид элемента: умолчания вида, потом тип, потом свои правки. */
export function resolveStyle(state, types) {
  const kind = state.system?.kind ?? "object";
  const type = types.find(t => t.id === state.system?.typeId);
  return { ...DEFAULT_STYLES[kind], ...(type?.style ?? {}), ...(state.system?.style ?? {}) };
}

/* ---------------------------------------------------------------- */
/*  Черновик и заявки                                                */
/* ---------------------------------------------------------------- */

/** Черновик пользователя по сцене как объект id → Op. */
export function getDraft(user = game.user, sceneId = canvas?.scene?.id) {
  const list = user.getFlag(MODULE_ID, `drafts.${sceneId}`) ?? [];
  return Object.fromEntries(list.map(op => [op.id, op]));
}

export async function setDraft(draft, user = game.user, sceneId = canvas?.scene?.id) {
  return user.update({ [`flags.${MODULE_ID}.drafts.${sceneId}`]: draftOps(draft) });
}

/** Заявки пользователя. */
export const getClaims = (user = game.user) => foundry.utils.deepClone(user.getFlag(MODULE_ID, "claims") ?? []);

export async function setClaims(claims, user = game.user) {
  return user.update({ [`flags.${MODULE_ID}.claims`]: claims });
}

/** Правки открытых заявок пользователя по сцене, в порядке подачи. */
export function pendingClaimOps(user = game.user, sceneId = canvas?.scene?.id) {
  return getClaims(user)
    .filter(c => c.sceneId === sceneId && OPEN_STATUSES.includes(c.status))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .flatMap(c => c.ops ?? []);
}

/**
 * Состояние карты так, как его видит этот пользователь: атлас, поверх его открытые
 * заявки и черновик. Мастер видит только атлас, заявки он смотрит в очереди.
 */
export function effectiveStates(scene = canvas?.scene) {
  const base = atlasStates(getAtlas(scene));
  if ( game.user.isGM ) return base;
  const withClaims = applyOps(base, pendingClaimOps(game.user, scene?.id));
  return applyOps(withClaims, draftOps(getDraft(game.user, scene?.id)));
}

/** Текущая версия элемента в атласе (или undefined, если его там нет). */
export function revOf(atlas, id) {
  const page = atlas?.pages.get(id);
  return page ? (page._source.system?.rev ?? 0) : undefined;
}

/**
 * Записать правку. Мастер пишет прямо в атлас, игрок — в свой черновик.
 * op: { action, id, state?, name? }; baseRev ставится здесь.
 */
export async function commit(op, scene = canvas?.scene) {
  const atlas = getAtlas(scene) ?? await ensureAtlas(scene);
  if ( !atlas ) {
    ui.notifications.warn(game.i18n.localize("VMAP.Notify.noAtlas"));
    return;
  }
  if ( game.user.isGM ) {
    const plan = buildApplyPlan([{ ...op, baseRev: revOf(atlas, op.id) }], id => revOf(atlas, id), { force: true });
    return applyPlan(atlas, plan);
  }
  const draft = getDraft(game.user, scene.id);
  const prev = draft[op.id];
  const baseRev = prev?.baseRev ?? revOf(atlas, op.id) ?? null;
  return setDraft(addToDraft(draft, { ...op, baseRev }), game.user, scene.id);
}

/** Применить план к атласу: создания, правки и удаления тремя пакетными вызовами. */
export async function applyPlan(atlas, plan) {
  const toPage = s => ({
    _id: s.id,
    name: s.name || game.i18n.localize("VMAP.Feature.unnamed"),
    type: FEATURE_TYPE,
    text: { content: s.text ?? "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
    system: s.system
  });
  if ( plan.create.length ) await atlas.createEmbeddedDocuments("JournalEntryPage", plan.create.map(toPage), { keepId: true });
  if ( plan.update.length ) {
    await atlas.updateEmbeddedDocuments("JournalEntryPage", plan.update.map(s => {
      const { type, ...rest } = toPage(s);
      return rest;
    }), { recursive: false });
  }
  if ( plan.delete.length ) await atlas.deleteEmbeddedDocuments("JournalEntryPage", plan.delete);
  return plan;
}
