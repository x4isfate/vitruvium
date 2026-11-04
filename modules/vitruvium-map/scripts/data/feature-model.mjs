import { KINDS, BLENDS } from "../constants.mjs";

const { fields } = foundry.data;

/** Статус: название и необязательный уровень (7/10). */
function statusSchema() {
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: true, initial: "" }),
    name: new fields.StringField({ required: true, blank: true, initial: "" }),
    value: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
    max: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null })
  });
}

/**
 * Объект, линия или область карты. Название и описание лежат в самой странице журнала
 * (name и text.content), здесь всё остальное.
 */
export default class FeatureModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: new fields.StringField({ required: true, initial: "object", choices: KINDS }),
      typeId: new fields.StringField({ required: true, blank: true, initial: "" }),
      demiurge: new fields.StringField({ required: true, blank: true, initial: "" }),
      statuses: new fields.ArrayField(statusSchema()),
      aspects: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: true, initial: "" }),
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        description: new fields.StringField({ required: true, blank: true, initial: "" }),
        value: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        max: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        statuses: new fields.ArrayField(statusSchema())
      })),
      /** Свои переопределения вида поверх типа. */
      style: new fields.ObjectField(),
      /**
       * Геометрия зависит от вида:
       * object — { x, y }; line — { points: [[x, y], …] };
       * area — { cells: [[i, j], …], shapes: [[[x, y], …], …], grid: { type, size } }.
       */
      geometry: new fields.ObjectField(),
      layerId: new fields.StringField({ required: true, blank: true, initial: "" }),
      blend: new fields.StringField({ required: true, initial: "replace", choices: BLENDS }),
      sort: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      links: new fields.ArrayField(new fields.SchemaField({
        /** id другого элемента этого же атласа. */
        target: new fields.StringField({ required: true, blank: true, initial: "" }),
        role: new fields.StringField({ required: true, blank: true, initial: "" })
      })),
      /** Растёт на каждую принятую правку. По нему очередь видит устаревшие заявки. */
      rev: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 })
    };
  }
}
