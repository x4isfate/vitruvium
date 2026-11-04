/** Общие константы модуля. Файл не зависит от Foundry, его читают и тесты. */

export const MODULE_ID = "vitruvium-map";

/** Подтип страницы журнала для объекта, линии и области. */
export const FEATURE_TYPE = `${MODULE_ID}.feature`;

/** Три вида элементов карты. */
export const KINDS = ["object", "line", "area"];

/** Режимы наложения области. */
export const BLENDS = ["replace", "overlay"];

/** Статусы заявки игрока. */
export const CLAIM_STATUS = {
  pending: "pending",     // ждёт решения мастера
  check: "check",         // мастер назначил проверку, ждём бросок
  rolled: "rolled",       // бросок сделан, мастер решает по результату
  rejected: "rejected",   // отклонена, игрок может вернуть её в черновик
  applied: "applied"      // принята и внесена в атлас
};

/** Вид по умолчанию для каждого вида элемента. Тип и сам элемент переопределяют поля поверх. */
export const DEFAULT_STYLES = {
  object: {
    icon: "icons/svg/village.svg",
    color: "#e8d6c3",
    size: 48,
    labelSize: 22,
    labelColor: "#fff0e0"
  },
  line: {
    color: "#5b8fd6",
    widthStart: 3,
    widthEnd: 10,
    outlineColor: "#1d2a3a",
    outlineWidth: 0,
    dash: 0,
    gap: 0,
    meander: 0.15,
    alpha: 1,
    labelSize: 18,
    labelColor: "#fff0e0"
  },
  area: {
    color: "#c96f4a",
    alpha: 0.35,
    borderColor: "#c96f4a",
    borderWidth: 3,
    borderAlpha: 0.9,
    labelSize: 28,
    labelColor: "#fff0e0"
  }
};

/** Типы, которые атлас получает при создании. Мастер может их менять и удалять. */
export const STARTER_TYPES = [
  { id: "city", kind: "object", name: "Город", style: { icon: "icons/svg/village.svg" } },
  { id: "fortress", kind: "object", name: "Крепость", style: { icon: "icons/svg/castle.svg", color: "#d9c39a" } },
  { id: "river", kind: "line", name: "Река", style: { color: "#5b8fd6", widthStart: 2, widthEnd: 12, meander: 0.2 } },
  { id: "road", kind: "line", name: "Дорога", style: { color: "#d8c3a0", widthStart: 3, widthEnd: 3, outlineColor: "#3a2d22", outlineWidth: 2, dash: 14, gap: 8, meander: 0 } },
  { id: "realm", kind: "area", name: "Страна", style: { color: "#c96f4a", alpha: 0.3, borderColor: "#c96f4a" } },
  { id: "region", kind: "area", name: "Край", style: { color: "#6f9c5a", alpha: 0.25, borderColor: "#6f9c5a" } }
];

export const STARTER_LAYERS = [
  { id: "politics", name: "Политика", sort: 0, visible: true },
  { id: "nature", name: "Природа", sort: 1, visible: true }
];
