/**
 * Всё, что система перечисляет, лежит здесь и доступно как CONFIG.VITRUVIUM.
 * Модули и производные системы (например, Ultra) меняют этот объект в хуке "init",
 * не трогая ядро.
 */
export const VITRUVIUM = {
  /** Характеристики: ключ, подпись, иконка. Уровень от 1 до 3. */
  characteristics: {
    physique:  { label: "VITRUVIUM.Char.physique",  hint: "VITRUVIUM.Char.physiqueHint",  icon: "systems/vitruvium/assets/icons/teloslozhenie.svg" },
    movement:  { label: "VITRUVIUM.Char.movement",  hint: "VITRUVIUM.Char.movementHint",  icon: "systems/vitruvium/assets/icons/dvizhenie.svg" },
    attention: { label: "VITRUVIUM.Char.attention", hint: "VITRUVIUM.Char.attentionHint", icon: "systems/vitruvium/assets/icons/vnimanie.svg" },
    thinking:  { label: "VITRUVIUM.Char.thinking",  hint: "VITRUVIUM.Char.thinkingHint",  icon: "systems/vitruvium/assets/icons/myshlenie.svg" },
    influence: { label: "VITRUVIUM.Char.influence", hint: "VITRUVIUM.Char.influenceHint", icon: "systems/vitruvium/assets/icons/vliyanie.svg" },
    will:      { label: "VITRUVIUM.Char.will",      hint: "VITRUVIUM.Char.willHint",      icon: "systems/vitruvium/assets/icons/volya.svg" }
  },

  inspirationIcon: "systems/vitruvium/assets/icons/vdohnovenie.svg",

  /** Пределы из правил. */
  limits: {
    characteristic: { min: 1, max: 3 },
    domain: { min: 1, max: 3, count: 6 },
    abilitiesPerDomainLevel: 2,
    attributes: 12,
    inspiration: 6,
    difficulty: { min: 1, max: 6 },
    pool: { min: 1, max: 6 },
    modifiers: 2
  },

  /** Уровень персонажа при создании: очки характеристик, очки доменов, атрибуты, предметы. */
  levels: {
    common:      { label: "VITRUVIUM.Level.common",      hint: "VITRUVIUM.Level.commonHint",      points: 3 },
    rare:        { label: "VITRUVIUM.Level.rare",        hint: "VITRUVIUM.Level.rareHint",        points: 6 },
    outstanding: { label: "VITRUVIUM.Level.outstanding", hint: "VITRUVIUM.Level.outstandingHint", points: 9 },
    legendary:   { label: "VITRUVIUM.Level.legendary",   hint: "VITRUVIUM.Level.legendaryHint",   points: 12 }
  },

  /**
   * Грани особого кубика: сколько символов успеха на грани 1–6.
   * Три пустые, две с одним успехом, одна с двумя.
   */
  dieFaces: [0, 0, 0, 1, 1, 2],

  /** Буква кубика в формуле: 3dv = три особых кубика. */
  dieDenomination: "v",

  /** Пути к значкам граней для карточки в чате. */
  faceIcons: {
    0: "systems/vitruvium/assets/dice/face-0.svg",
    1: "systems/vitruvium/assets/dice/face-1.svg",
    2: "systems/vitruvium/assets/dice/face-2.svg"
  }
};
