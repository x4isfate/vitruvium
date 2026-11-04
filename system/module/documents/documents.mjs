import { check, rollCheck } from "../dice/check.mjs";

export class VitruviumActor extends Actor {
  /**
   * Открыть окно проверки. preset задаёт начальные значения:
   * { characteristic, domainId, difficulty, advantages, hindrances }.
   */
  async check(preset = {}) {
    return check(this, preset);
  }

  /** Проверка без окна, для макросов и модулей. */
  async rollCheck(options = {}) {
    return rollCheck(this, options);
  }

  /** Новому персонажу игрока ставим связь токена и видимость, как у героев. */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if ( allowed === false ) return false;
    if ( this.type === "character" ) {
      this.updateSource({
        prototypeToken: { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY }
      });
    }
  }
}

export class VitruviumItem extends Item {
  static DEFAULT_ICONS = {
    domain: "icons/svg/book.svg",
    attribute: "icons/svg/aura.svg",
    property: "icons/svg/chest.svg"
  };

  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if ( allowed === false ) return false;
    if ( !data.img || data.img === Item.DEFAULT_ICON ) {
      const img = VitruviumItem.DEFAULT_ICONS[this.type];
      if ( img ) this.updateSource({ img });
    }
  }
}
