import { MODULE_ID, CLAIM_STATUS } from "../constants.mjs";
import { getAtlas, getDraft, setDraft, getClaims, atlasStates } from "../data/store.mjs";
import { draftOps, changedFields } from "../review/ops.mjs";
import {
  allClaims, claimConflicts, submitDraft, returnToDraft, dropClaim, clearClosed,
  applyClaims, rejectClaims, requestClaimCheck, ghostsFor, isOpen, rollForClaim
} from "../review/claims.mjs";
import { LAYER_NAME } from "../canvas/map-layer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const L = k => game.i18n.localize(k);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Окно заявок. Игрок видит свой черновик и свои заявки. Мастер видит очередь всех
 * игроков: отмечает заявки, смотрит их на карте, принимает, отклоняет, назначает проверку.
 */
export default class ClaimsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static open() {
    ClaimsApp.#instance ??= new ClaimsApp();
    ClaimsApp.#instance.render({ force: true });
    return ClaimsApp.#instance;
  }

  /** Перерисовать, если окно открыто. */
  static refresh() {
    if ( ClaimsApp.#instance?.rendered ) ClaimsApp.#instance.render();
  }

  static DEFAULT_OPTIONS = {
    id: "vmap-claims",
    classes: ["vitruvium", "vmap-sheet", "vmap-claims"],
    tag: "form",
    window: { title: "VMAP.Claims.title", resizable: true, icon: "fa-solid fa-scroll" },
    position: { width: 560, height: 680 },
    actions: {
      submit: ClaimsApp.#onSubmit,
      discardDraft: ClaimsApp.#onDiscardDraft,
      discardOp: ClaimsApp.#onDiscardOp,
      returnDraft: ClaimsApp.#onReturnDraft,
      drop: ClaimsApp.#onDrop,
      clearClosed: ClaimsApp.#onClearClosed,
      pan: ClaimsApp.#onPan,
      roll: ClaimsApp.#onRoll,
      preview: ClaimsApp.#onPreview,
      apply: ClaimsApp.#onApply,
      reject: ClaimsApp.#onReject,
      check: ClaimsApp.#onCheck,
      selectAll: ClaimsApp.#onSelectAll,
      toggleClosed: ClaimsApp.#onToggleClosed
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/claims.hbs`, scrollable: [".vmap-scroll"] }
  };

  /** Отмеченные мастером заявки: "userId.claimId". */
  selected = new Set();
  /** Заявки, которые сейчас показаны на карте призраками. */
  previewing = new Set();
  showClosed = false;
  /** Черновик формы игрока, чтобы перерисовка не стирала набранное. */
  form = { title: "", note: "" };

  /** @override */
  async _prepareContext() {
    const scene = canvas.scene;
    const atlas = getAtlas(scene);
    const base = atlasStates(atlas);
    const isGM = game.user.isGM;

    const opRow = (op, conflicts = {}) => {
      const before = base.get(op.id);
      const name = op.state?.name ?? before?.name ?? op.id;
      const kind = op.state?.system?.kind ?? before?.system?.kind ?? "object";
      const fields = op.action === "update" && before
        ? changedFields(before, op.state).map(f => L(`VMAP.Field.${f}`)).join(", ")
        : "";
      return {
        id: op.id, name, action: op.action,
        actionLabel: L(`VMAP.Draft.${op.action}`),
        kindLabel: L(`VMAP.Kind.${kind}`),
        fields,
        conflict: conflicts[op.id] ? L(`VMAP.Conflict.${conflicts[op.id]}`) : null,
        canPan: op.action !== "delete" || !!before
      };
    };

    const claimRow = ({ user, claim }) => {
      const key = `${user.id}.${claim.id}`;
      const conflicts = isOpen(claim) ? claimConflicts(claim) : {};
      const outcome = claim.outcome ? (claim.partial ? "partial" : claim.outcome) : null;
      return {
        key, user: user.name, color: user.color?.css ?? user.color,
        ...claim,
        sceneName: game.scenes.get(claim.sceneId)?.name ?? "—",
        otherScene: claim.sceneId !== scene?.id,
        statusLabel: L(`VMAP.ClaimStatus.${claim.status}`),
        open: isOpen(claim),
        rejected: claim.status === CLAIM_STATUS.rejected,
        needsRoll: claim.status === CLAIM_STATUS.check && claim.messageId,
        rolled: claim.status === CLAIM_STATUS.rolled,
        outcome, outcomeLabel: outcome ? L(`VMAP.Outcome.${outcome}`) : null,
        selected: this.selected.has(key),
        previewing: this.previewing.has(key),
        conflictCount: Object.keys(conflicts).length,
        ops: (claim.ops ?? []).map(op => opRow(op, conflicts))
      };
    };

    if ( isGM ) {
      const entries = allClaims({ includeClosed: this.showClosed });
      // Убираем из выбора то, чего уже нет в очереди.
      const keys = new Set(entries.map(e => `${e.user.id}.${e.claim.id}`));
      for ( const k of this.selected ) if ( !keys.has(k) ) this.selected.delete(k);
      for ( const k of this.previewing ) if ( !keys.has(k) ) this.previewing.delete(k);
      const trusted = game.settings.get(MODULE_ID, "trustedUsers") ?? [];
      return {
        isGM, showClosed: this.showClosed,
        claims: entries.map(claimRow),
        anySelected: this.selected.size > 0,
        selectedCount: this.selected.size,
        autoApply: game.settings.get(MODULE_ID, "autoApplyOnSuccess"),
        players: game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: u.name, trusted: trusted.includes(u.id) }))
      };
    }

    const draft = scene ? draftOps(getDraft(game.user, scene.id)) : [];
    const mine = getClaims(game.user).map(claim => ({ user: game.user, claim }))
      .sort((a, b) => (b.claim.createdAt ?? 0) - (a.claim.createdAt ?? 0));
    return {
      isGM, form: this.form,
      draft: draft.map(op => opRow(op)),
      hasDraft: draft.length > 0,
      claims: mine.map(claimRow),
      anyClosed: mine.some(e => !isOpen(e.claim))
    };
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("input", ev => {
      const f = ev.target.dataset.form;
      if ( f ) this.form[f] = ev.target.value;
    });
    this.element.addEventListener("change", ev => this._onChange(ev));
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.previewing.clear();
    this._syncGhosts();
  }

  async _onChange(ev) {
    const el = ev.target;
    if ( el.dataset.select ) {
      if ( el.checked ) this.selected.add(el.dataset.select);
      else this.selected.delete(el.dataset.select);
      this.render();
    } else if ( el.dataset.trusted ) {
      const list = new Set(game.settings.get(MODULE_ID, "trustedUsers") ?? []);
      if ( el.checked ) list.add(el.dataset.trusted);
      else list.delete(el.dataset.trusted);
      await game.settings.set(MODULE_ID, "trustedUsers", [...list]);
    } else if ( el.dataset.setting === "autoApply" ) {
      await game.settings.set(MODULE_ID, "autoApplyOnSuccess", el.checked);
    }
  }

  /** Заявки по ключам "userId.claimId". */
  _entries(keys) {
    const out = [];
    for ( const key of keys ) {
      const [userId, claimId] = key.split(".");
      const user = game.users.get(userId);
      const claim = user ? getClaims(user).find(c => c.id === claimId) : null;
      if ( claim ) out.push({ user, claim });
    }
    return out;
  }

  /** Ключи из кнопки: одна заявка или все отмеченные. */
  _keysFrom(target) {
    return target.dataset.key ? [target.dataset.key] : [...this.selected];
  }

  _syncGhosts() {
    const layer = canvas[LAYER_NAME];
    if ( !layer ) return;
    const entries = this._entries(this.previewing).filter(e => e.claim.sceneId === canvas.scene?.id);
    layer.reviewGhosts = ghostsFor(entries, getAtlas(canvas.scene));
    layer.refresh();
  }

  /* ------------------------------------------------------------ */
  /*  Игрок                                                        */
  /* ------------------------------------------------------------ */

  static async #onSubmit() {
    const claim = await submitDraft(this.form);
    if ( claim ) this.form = { title: "", note: "" };
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  static async #onDiscardDraft() {
    const ok = await DialogV2.confirm({
      window: { title: "VMAP.Claims.discardDraft" },
      content: `<p>${L("VMAP.Claims.discardConfirm")}</p>`
    });
    if ( !ok ) return;
    await setDraft({}, game.user, canvas.scene.id);
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  static async #onDiscardOp(event, target) {
    const draft = getDraft(game.user, canvas.scene.id);
    delete draft[target.dataset.id];
    await setDraft(draft, game.user, canvas.scene.id);
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  static async #onReturnDraft(event, target) {
    await returnToDraft(target.dataset.id);
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  static async #onDrop(event, target) {
    const claim = getClaims(game.user).find(c => c.id === target.dataset.id);
    if ( claim && isOpen(claim) ) {
      const ok = await DialogV2.confirm({
        window: { title: "VMAP.Claims.withdraw" },
        content: `<p>${L("VMAP.Claims.withdrawConfirm")}</p>`
      });
      if ( !ok ) return;
    }
    await dropClaim(target.dataset.id);
    canvas[LAYER_NAME]?.refresh();
    this.render();
  }

  static async #onClearClosed() {
    await clearClosed();
    this.render();
  }

  static async #onRoll(event, target) {
    const message = game.messages.get(target.dataset.message);
    if ( !message ) return ui.notifications.warn(L("VMAP.Check.cardMissing"));
    return rollForClaim(message);
  }

  static #onPan(event, target) {
    canvas[LAYER_NAME]?.panTo(target.dataset.id);
  }

  /* ------------------------------------------------------------ */
  /*  Мастер                                                       */
  /* ------------------------------------------------------------ */

  static #onSelectAll() {
    const all = allClaims({ includeClosed: false }).map(e => `${e.user.id}.${e.claim.id}`);
    const every = all.length && all.every(k => this.selected.has(k));
    this.selected = every ? new Set() : new Set(all);
    this.render();
  }

  static #onToggleClosed() {
    this.showClosed = !this.showClosed;
    this.render();
  }

  static #onPreview(event, target) {
    const keys = this._keysFrom(target);
    const on = keys.some(k => !this.previewing.has(k));
    for ( const k of keys ) on ? this.previewing.add(k) : this.previewing.delete(k);
    this._syncGhosts();
    this.render();
  }

  static async #onApply(event, target) {
    const entries = this._entries(this._keysFrom(target)).filter(e => isOpen(e.claim));
    if ( !entries.length ) return;
    await applyClaims(entries);
    for ( const e of entries ) {
      const key = `${e.user.id}.${e.claim.id}`;
      this.selected.delete(key);
      this.previewing.delete(key);
    }
    this._syncGhosts();
    this.render();
  }

  static async #onReject(event, target) {
    const entries = this._entries(this._keysFrom(target)).filter(e => isOpen(e.claim));
    if ( !entries.length ) return;
    const comment = await DialogV2.prompt({
      window: { title: "VMAP.Claims.reject" },
      content: `<label class="vmap-dialog-field">${L("VMAP.Claims.rejectReason")}<textarea name="comment" rows="3"></textarea></label>`,
      ok: { label: "VMAP.Claims.reject", callback: (ev, button) => button.form.elements.comment.value },
      rejectClose: false
    });
    if ( comment === null || comment === undefined ) return;
    await rejectClaims(entries, comment);
    for ( const e of entries ) this.previewing.delete(`${e.user.id}.${e.claim.id}`);
    this._syncGhosts();
    this.render();
  }

  static async #onCheck(event, target) {
    const [entry] = this._entries([target.dataset.key]);
    if ( !entry ) return;
    const options = [1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === (entry.claim.difficulty ?? 2) ? "selected" : ""}>${n}</option>`).join("");
    const data = await DialogV2.prompt({
      window: { title: "VMAP.Check.title" },
      content: `<p>${esc(entry.user.name)}: <b>${esc(entry.claim.title)}</b></p>
        <label class="vmap-dialog-field">${L("VMAP.Check.difficulty")}<select name="difficulty">${options}</select></label>
        <p class="hint">${L("VMAP.Check.difficultyHint")}</p>
        <label class="vmap-dialog-field">${L("VMAP.Check.note")}<textarea name="note" rows="2"></textarea></label>`,
      ok: {
        label: "VMAP.Check.send",
        callback: (ev, button) => ({ difficulty: Number(button.form.elements.difficulty.value), note: button.form.elements.note.value })
      },
      rejectClose: false
    });
    if ( !data ) return;
    await requestClaimCheck(entry, data.difficulty, data.note);
    this.render();
  }
}
