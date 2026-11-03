/**
 * Особый шестигранный кубик «ВИТРУВИЯ».
 * Три грани пустые, на двух гранях по одному символу успеха, на одной два символа.
 * Итог кубика (total) равен числу символов успеха, а не числу на грани.
 * В формуле пишется как Ndv, например 3dv.
 */
export default class VitruviumDie extends foundry.dice.terms.Die {
  constructor(termData = {}) {
    termData.faces = 6;
    super(termData);
  }

  static DENOMINATION = "v";

  /** Сколько символов успеха на грани (1–6). */
  static successesFor(face) {
    return CONFIG.VITRUVIUM.dieFaces[face - 1] ?? 0;
  }

  /** Сумма успехов по активным результатам. */
  get successes() {
    if ( !this._evaluated ) return undefined;
    return this.results.reduce((n, r) => n + (r.active ? VitruviumDie.successesFor(r.result) : 0), 0);
  }

  /** @override */
  get total() {
    return this.successes;
  }

  /** @override */
  getResultLabel(result) {
    const n = VitruviumDie.successesFor(result.result);
    const src = CONFIG.VITRUVIUM.faceIcons[n];
    return `<img class="vitruvium-face" src="${src}" alt="${n}">`;
  }

  /** @override */
  getResultCSS(result) {
    const css = super.getResultCSS(result);
    const n = VitruviumDie.successesFor(result.result);
    // Ядро подсвечивает 1 и 6 как минимум и максимум, для особого кубика это неверно.
    return css.filter(c => !["min", "max"].includes(c)).concat([`vitruvium-s${n}`]);
  }
}
