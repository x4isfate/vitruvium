import { MODULE_ID } from "../constants.mjs";
import { getDraft, getClaims } from "../data/store.mjs";
import { CLAIM_STATUS } from "../constants.mjs";

const OPEN = [CLAIM_STATUS.pending, CLAIM_STATUS.check, CLAIM_STATUS.rolled];

const esc = s => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * Палитра над картой: подсказка к инструменту, тип нового элемента, слой области,
 * выбранный элемент и счётчик черновика или очереди. Обычный DOM, без окна.
 */
export default class MapPalette {
  constructor(layer) {
    this.layer = layer;
    this.el = null;
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  render() {
    const layer = this.layer;
    if ( !layer.active ) return this.close();
    if ( !this.el ) {
      this.el = document.createElement("section");
      this.el.className = "vitruvium vmap-palette";
      this.el.addEventListener("change", ev => this._onChange(ev));
      this.el.addEventListener("click", ev => this._onClick(ev));
      (document.getElementById("interface") ?? document.body).appendChild(this.el);
    }
    const tool = layer.tool;
    const L = k => game.i18n.localize(k);
    const kind = { object: "object", line: "line", area: "area" }[tool];
    const parts = [];
    parts.push(`<div class="vmap-pal-hint"><b>${esc(L(`VMAP.Tool.${tool}`))}</b><span>${esc(L(`VMAP.Hint.${tool}`))}</span></div>`);

    if ( kind ) {
      const types = layer.types.filter(t => t.kind === kind);
      const cur = layer.typeFor(kind)?.id;
      parts.push(`<label class="vmap-pal-field">${esc(L("VMAP.Feature.type"))}
        <select data-pick="${kind}">${types.map(t => `<option value="${esc(t.id)}" ${t.id === cur ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`);
    }
    if ( tool === "area" ) {
      const cur = layer.layerForNewArea()?.id;
      parts.push(`<label class="vmap-pal-field">${esc(L("VMAP.Feature.layer"))}
        <select data-pick="layerId">${layer.layers.map(l => `<option value="${esc(l.id)}" ${l.id === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>`);
    }
    if ( tool === "line" && layer.linePoints.length ) {
      parts.push(`<button type="button" class="v-btn" data-act="finishLine"><i class="fa-solid fa-check"></i> ${esc(L("VMAP.Palette.finishLine"))}</button>`);
    }

    const sel = layer.selectedId ? layer.getState(layer.selectedId) : null;
    if ( sel ) {
      parts.push(`<div class="vmap-pal-sel"><span class="v-tag">${esc(L(`VMAP.Kind.${sel.system.kind}`))}</span><b>${esc(sel.name)}</b>
        <button type="button" class="v-icon-btn" data-act="open" data-tooltip="${esc(L("VMAP.Palette.open"))}"><i class="fa-solid fa-pen-to-square"></i></button>
        <button type="button" class="v-icon-btn" data-act="delete" data-tooltip="${esc(L("VMAP.Feature.delete"))}"><i class="fa-solid fa-trash"></i></button></div>`);
    }

    if ( game.user.isGM ) {
      const pending = game.users.reduce((n, u) => n + getClaims(u).filter(c => OPEN.includes(c.status)).length, 0);
      parts.push(`<button type="button" class="v-btn" data-act="claims"><i class="fa-solid fa-scroll"></i> ${esc(game.i18n.format("VMAP.Palette.queue", { n: pending }))}</button>`);
    } else {
      const n = Object.keys(getDraft(game.user, canvas.scene?.id)).length;
      parts.push(`<button type="button" class="v-btn ${n ? "v-btn-accent" : ""}" data-act="claims"><i class="fa-solid fa-scroll"></i> ${esc(game.i18n.format("VMAP.Palette.draft", { n }))}</button>`);
    }
    this.el.innerHTML = parts.join("");
  }

  _onChange(ev) {
    const pick = ev.target.dataset.pick;
    if ( !pick ) return;
    this.layer.choice[pick] = ev.target.value;
  }

  _onClick(ev) {
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if ( !act ) return;
    const api = game.modules.get(MODULE_ID).api;
    const id = this.layer.selectedId;
    if ( act === "finishLine" ) this.layer.finishLine();
    else if ( act === "open" && id ) api.openFeature(id);
    else if ( act === "delete" && id ) this.layer.deleteFeature(id);
    else if ( act === "claims" ) api.openClaims();
  }
}
