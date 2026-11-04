/**
 * Правки игроков как данные. Без Foundry, проверяется в Node.
 *
 * Состояние элемента (FeatureState): { id, name, text, system }, где text — HTML-описание,
 * system — данные модели (kind, statuses, aspects, geometry и т. д.).
 *
 * Операция (Op): { action, id, baseRev, state?, name? }
 * - create: новый элемент, state — его полное состояние;
 * - update: новое полное состояние элемента, baseRev — версия, от которой игрок отталкивался;
 * - delete: удаление, name — чтобы было что показать в очереди.
 *
 * Черновик игрока: { [featureId]: Op }. На один элемент всегда одна операция.
 */

/** Сливает новую операцию с той, что уже лежит в черновике для этого элемента. */
export function mergeOp(prev, next) {
  if ( !prev ) return next;
  if ( prev.action === "create" ) {
    if ( next.action === "delete" ) return null;           // создал и удалил: правки нет
    return { ...prev, state: next.state };                  // остаётся созданием
  }
  if ( prev.action === "update" ) {
    if ( next.action === "delete" ) return { action: "delete", id: next.id, baseRev: prev.baseRev, name: next.name ?? prev.state?.name };
    return { ...prev, state: next.state };                  // baseRev первой правки
  }
  return next;                                              // после удаления: новое поверх
}

/** Добавляет операцию в черновик и возвращает новый черновик. */
export function addToDraft(draft, op) {
  const out = { ...(draft ?? {}) };
  const merged = mergeOp(out[op.id], op);
  if ( merged ) out[op.id] = merged;
  else delete out[op.id];
  return out;
}

/** Черновик → список операций в стабильном порядке: создания, правки, удаления. */
export function draftOps(draft) {
  const order = { create: 0, update: 1, delete: 2 };
  return Object.values(draft ?? {}).sort((a, b) => (order[a.action] - order[b.action]) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Что получится, если применить операции к набору элементов.
 * current — Map id → FeatureState. Возвращает новую Map, исходную не трогает.
 */
export function applyOps(current, ops) {
  const out = new Map(current);
  for ( const op of ops ) {
    if ( op.action === "delete" ) out.delete(op.id);
    else out.set(op.id, { ...op.state, id: op.id });
  }
  return out;
}

/**
 * Проверка операции против текущего атласа.
 * Возвращает null, если всё в порядке, иначе причину:
 * - exists: элемент с таким id уже создан;
 * - missing: элемента уже нет (его удалили);
 * - stale: элемент поменялся после того, как игрок начал правку.
 */
export function conflictOf(op, currentRev) {
  if ( op.action === "create" ) return currentRev === undefined ? null : "exists";
  if ( currentRev === undefined ) return "missing";
  if ( (op.baseRev ?? 0) !== currentRev ) return "stale";
  return null;
}

/**
 * План применения заявки. revOf(id) отдаёт текущую версию элемента или undefined.
 * force — применить и устаревшие правки (мастер видел конфликт и согласен).
 */
export function buildApplyPlan(ops, revOf, { force = false } = {}) {
  const plan = { create: [], update: [], delete: [], skipped: [] };
  for ( const op of ops ) {
    const rev = revOf(op.id);
    const conflict = conflictOf(op, rev);
    if ( conflict && !(force && conflict === "stale") ) {
      plan.skipped.push({ op, conflict });
      continue;
    }
    if ( op.action === "create" ) {
      plan.create.push({ ...op.state, id: op.id, system: { ...op.state.system, rev: 1 } });
    } else if ( op.action === "update" ) {
      plan.update.push({ ...op.state, id: op.id, system: { ...op.state.system, rev: (rev ?? 0) + 1 } });
    } else {
      plan.delete.push(op.id);
    }
  }
  return plan;
}

/** Поля элемента, которые сравнивает очередь, и как их назвать. */
export const DIFF_FIELDS = [
  ["name", s => s.name],
  ["text", s => s.text ?? ""],
  ["type", s => s.system?.typeId ?? ""],
  ["demiurge", s => s.system?.demiurge ?? ""],
  ["statuses", s => s.system?.statuses ?? []],
  ["aspects", s => s.system?.aspects ?? []],
  ["geometry", s => s.system?.geometry ?? {}],
  ["style", s => s.system?.style ?? {}],
  ["layer", s => [s.system?.layerId ?? "", s.system?.blend ?? "", s.system?.sort ?? 0]],
  ["links", s => s.system?.links ?? []]
];

/** Какие части элемента меняет правка. */
export function changedFields(before, after) {
  if ( !before ) return DIFF_FIELDS.map(([k]) => k).filter(k => k !== "layer" || after?.system?.kind === "area");
  return DIFF_FIELDS.filter(([, get]) => JSON.stringify(get(before)) !== JSON.stringify(get(after))).map(([k]) => k);
}

/** Строка статуса для показа: «Голод (2/10)», «Защищённая крепость». */
export function formatStatus(s) {
  if ( !s ) return "";
  const hasLevel = s.value !== null && s.value !== undefined && s.value !== "";
  if ( !hasLevel ) return s.name;
  return s.max ? `${s.name} (${s.value}/${s.max})` : `${s.name} (${s.value})`;
}

/** Статус → аспект: имя и уровень переходят, остальное пустое. */
export function statusToAspect(status, newId) {
  return {
    id: newId,
    name: status.name ?? "",
    description: "",
    value: status.value ?? null,
    max: status.max ?? null,
    statuses: []
  };
}

/** Новый id в стиле Foundry: 16 латинских букв и цифр. */
export function randomId(rnd = Math.random) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for ( let i = 0; i < 16; i++ ) s += chars[Math.floor(rnd() * chars.length)];
  return s;
}
