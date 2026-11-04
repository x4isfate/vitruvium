import { MODULE_ID } from "../constants.mjs";
import { getTypes, getLayers } from "../data/store.mjs";
import { formatStatus } from "../review/ops.mjs";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;

/**
 * Страница элемента в журнале-атласе. Показывает карточку элемента; править его
 * удобнее на карте, поэтому и в режиме правки здесь только карточка и кнопка «На карте».
 */
export default class FeaturePageSheet extends JournalEntryPageHandlebarsSheet {
  static DEFAULT_OPTIONS = {
    classes: ["vitruvium", "vmap-page"],
    actions: { showOnMap: FeaturePageSheet.#onShowOnMap }
  };

  static VIEW_PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/feature-page.hbs` }
  };

  static EDIT_PARTS = Object.fromEntries(Object.entries({
    header: super.EDIT_PARTS?.header,
    content: { template: `modules/${MODULE_ID}/templates/feature-page.hbs` },
    footer: super.EDIT_PARTS?.footer
  }).filter(([, v]) => v));

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = this.document;
    const sys = page.system;
    const atlas = page.parent;
    const type = getTypes(atlas).find(t => t.id === sys.typeId);
    const layer = getLayers(atlas).find(l => l.id === sys.layerId);
    const demiurge = sys.demiurge ? await fromUuid(sys.demiurge) : null;
    const pages = atlas?.pages;
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(page.text?.content ?? "", {
      relativeTo: page, secrets: page.isOwner
    });
    context.feature = {
      name: page.name,
      kindLabel: game.i18n.localize(`VMAP.Kind.${sys.kind}`),
      typeName: type?.name ?? "",
      layerName: sys.kind === "area" ? (layer?.name ?? "") : "",
      blendLabel: sys.kind === "area" ? game.i18n.localize(`VMAP.Blend.${sys.blend}`) : "",
      demiurge: demiurge?.name ?? "",
      description: enriched,
      statuses: (sys.statuses ?? []).map(formatStatus).filter(Boolean),
      aspects: (sys.aspects ?? []).map(a => ({
        label: formatStatus(a), description: a.description,
        statuses: (a.statuses ?? []).map(formatStatus).filter(Boolean)
      })),
      links: (sys.links ?? []).filter(l => l.target).map(l => ({ name: pages?.get(l.target)?.name ?? "?", role: l.role })),
      onScene: !!game.scenes.get(atlas?.getFlag(MODULE_ID, "sceneId"))
    };
    return context;
  }

  static async #onShowOnMap() {
    const atlas = this.document.parent;
    const scene = game.scenes.get(atlas?.getFlag(MODULE_ID, "sceneId"));
    if ( !scene ) return;
    const id = this.document.id;
    if ( canvas.scene?.id !== scene.id ) {
      await scene.view();
      await new Promise(resolve => Hooks.once("canvasReady", resolve));
    }
    const api = game.modules.get(MODULE_ID).api;
    api.activateLayer();
    canvas.vitruviumMap?.select(id);
    canvas.vitruviumMap?.panTo(id);
  }
}
