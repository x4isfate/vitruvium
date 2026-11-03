const { fields } = foundry.data;

/* ---------------------------------------------------------------- */
/*  Общие части                                                      */
/* ---------------------------------------------------------------- */

/** Статус: короткое описание. */
function statusesField() {
  return new fields.ArrayField(new fields.SchemaField({
    name: new fields.StringField({ required: true, blank: true, initial: "" })
  }));
}

/** Уровень: числовое значение с необязательным максимумом («Боезапас 2/20»). */
function levelsField() {
  return new fields.ArrayField(new fields.SchemaField({
    name: new fields.StringField({ required: true, blank: true, initial: "" }),
    value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
    max: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null })
  }));
}

/** Аспект: название, пояснение, текущий уровень, расписанные уровни и статусы. */
function aspectsField() {
  return new fields.ArrayField(new fields.SchemaField({
    name: new fields.StringField({ required: true, blank: true, initial: "" }),
    subject: new fields.StringField({ required: true, blank: true, initial: "" }),
    value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
    scale: new fields.ArrayField(new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      label: new fields.StringField({ required: true, blank: true, initial: "" })
    })),
    statuses: new fields.ArrayField(new fields.StringField({ blank: true }))
  }));
}

function characteristicsField() {
  const L = () => CONFIG.VITRUVIUM.limits.characteristic;
  const schema = {};
  for ( const key of Object.keys(CONFIG.VITRUVIUM.characteristics) ) {
    schema[key] = new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, min: L().min, max: L().max, initial: L().min })
    });
  }
  return new fields.SchemaField(schema);
}

/* ---------------------------------------------------------------- */
/*  Актеры                                                           */
/* ---------------------------------------------------------------- */

class BaseActorModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      characteristics: characteristicsField(),
      inspiration: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 })
      }),
      description: new fields.HTMLField({ required: true, blank: true }),
      notes: new fields.HTMLField({ required: true, blank: true }),
      statuses: statusesField(),
      levels: levelsField(),
      aspects: aspectsField()
    };
  }

  prepareDerivedData() {
    const max = CONFIG.VITRUVIUM.limits.inspiration;
    this.inspiration.max = max;
    this.inspiration.value = Math.clamp(this.inspiration.value, 0, max);
  }

  /** Числа для подсказок при создании персонажа. */
  get budget() {
    const parent = this.parent;
    const L = CONFIG.VITRUVIUM.limits;
    const domains = parent.items.filter(i => i.type === "domain");
    const charPoints = Object.values(this.characteristics).reduce((n, c) => n + (c.value - L.characteristic.min), 0);
    return {
      charPoints,
      domainCount: domains.length,
      domainPoints: domains.reduce((n, d) => n + d.system.level, 0),
      attributes: parent.items.filter(i => i.type === "attribute").length,
      property: parent.items.filter(i => i.type === "property").length
    };
  }
}

/** Персонаж игрока. */
export class CharacterModel extends BaseActorModel {
  static LOCALIZATION_PREFIXES = ["VITRUVIUM.Actor.character"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      level: new fields.StringField({ required: true, initial: "common", choices: () => Object.fromEntries(Object.entries(CONFIG.VITRUVIUM.levels).map(([k, v]) => [k, v.label])) }),
      player: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }

  /** Сколько очков даёт выбранный уровень (3/6/9/12). */
  get levelPoints() {
    return CONFIG.VITRUVIUM.levels[this.level]?.points ?? 0;
  }
}

/** Персонаж мастера. Те же части, что у персонажа игрока, без уровня создания. */
export class NpcModel extends BaseActorModel {
  static LOCALIZATION_PREFIXES = ["VITRUVIUM.Actor.npc"];
}

/* ---------------------------------------------------------------- */
/*  Предметы                                                         */
/* ---------------------------------------------------------------- */

/** Домен: уровень 1–3, описание, способности (название и описание). */
export class DomainModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const L = () => CONFIG.VITRUVIUM.limits.domain;
    return {
      level: new fields.NumberField({ required: true, integer: true, min: L().min, max: L().max, initial: L().min }),
      description: new fields.HTMLField({ required: true, blank: true }),
      abilities: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        description: new fields.StringField({ required: true, blank: true, initial: "" })
      }))
    };
  }

  /** Сколько способностей открывает уровень домена. */
  get abilitySlots() {
    return this.level * CONFIG.VITRUVIUM.limits.abilitiesPerDomainLevel;
  }
}

/** Атрибут: название и описание. */
export class AttributeModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true })
    };
  }
}

/** Предмет имущества. Статусы и уровни можно присвоить чему угодно, в том числе предмету. */
export class PropertyModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      statuses: statusesField(),
      levels: levelsField()
    };
  }
}
