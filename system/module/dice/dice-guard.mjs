import VitruviumDie from "./vitruvium-die.mjs";

/**
 * В «ВИТРУВИИ» бросаются только шестигранные кубики.
 * Любой бросок с другим кубиком (d20, d4, монета, кубик Фейта) отклоняется
 * до броска: в чате, в макросах и из модулей.
 */

function isAllowedDie(term) {
  if ( term instanceof VitruviumDie ) return true;
  if ( term instanceof foundry.dice.terms.Die ) return Number(term.faces) === 6;
  return false;
}

/** Находит первый запрещённый кубик в броске или возвращает null. */
export function findForbiddenDie(roll) {
  const { DiceTerm, PoolTerm, ParentheticalTerm, FunctionTerm } = foundry.dice.terms;
  const stack = [...roll.terms];
  while ( stack.length ) {
    const term = stack.pop();
    if ( term instanceof DiceTerm ) {
      if ( !isAllowedDie(term) ) return term;
    }
    else if ( term instanceof PoolTerm ) {
      for ( const r of term.rolls ?? [] ) stack.push(...r.terms);
    }
    else if ( term instanceof ParentheticalTerm ) {
      if ( term.roll ) stack.push(...term.roll.terms);
      else if ( term.term ) stack.push(...Roll.parse(term.term, {}));
    }
    else if ( FunctionTerm && (term instanceof FunctionTerm) ) {
      for ( const r of term.rolls ?? [] ) stack.push(...r.terms);
    }
  }
  return null;
}

function assertOnlyD6(roll) {
  const bad = findForbiddenDie(roll);
  if ( !bad ) return;
  const message = game.i18n.format("VITRUVIUM.Dice.Forbidden", { die: bad.expression ?? bad.formula ?? "" });
  ui.notifications?.error(message);
  throw new Error(message);
}

export function registerDiceGuard() {
  const Roll = foundry.dice.Roll;
  const evaluate = Roll.prototype.evaluate;
  Roll.prototype.evaluate = function(...args) {
    assertOnlyD6(this);
    return evaluate.apply(this, args);
  };
  const evaluateSync = Roll.prototype.evaluateSync;
  if ( evaluateSync ) {
    Roll.prototype.evaluateSync = function(...args) {
      assertOnlyD6(this);
      return evaluateSync.apply(this, args);
    };
  }
}
