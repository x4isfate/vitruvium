/**
 * «Витрувий: кубики» для Dice So Nice.
 * Регистрирует особый кубик dv: три пустые грани, две с одним символом успеха, одна с двумя.
 * Пустые грани несут тёмную гравировку символа, как на физических кубиках.
 * Цвета: корпус #0D0D0D, символы #FFF0E0 (дизайн-код vitruvium.ru).
 */
const MODULE = "modules/vitruvium-dice/textures";

Hooks.once("diceSoNiceReady", dice3d => {
  if ( game.system.id !== "vitruvium" ) return;

  dice3d.addSystem({ id: "vitruvium", name: "Витрувий" }, "preferred");

  dice3d.addColorset({
    name: "vitruvium-black",
    description: "Витрувий: чёрный",
    category: "Витрувий",
    foreground: "#FFF0E0",
    background: "#0D0D0D",
    outline: "none",
    edge: "#171719",
    texture: "none",
    material: "metal"
  }, "preferred");

  const label = n => `${MODULE}/label-${n}.png`;
  const bump = n => `${MODULE}/bump-${n}.png`;
  // Порядок граней совпадает с CONFIG.VITRUVIUM.dieFaces: 1–3 пустые, 4–5 один успех, 6 два.
  dice3d.addDicePreset({
    type: "dv",
    labels: [label(0), label(0), label(0), label(1), label(1), label(2)],
    bumpMaps: [bump(0), bump(0), bump(0), bump(1), bump(1), bump(2)],
    system: "vitruvium",
    colorset: "vitruvium-black"
  }, "d6");
});
