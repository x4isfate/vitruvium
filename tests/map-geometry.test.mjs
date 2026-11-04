// Геометрия модуля карты: контур из клеток, ленты рек, пунктир, упрощение.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellsOutline, groupRings, signedArea, pointInRings, ribbon, dashPolyline, polylineLength,
  simplify, catmullRom, meander, labelPoint, midpoint, distToPolyline
} from "../modules/vitruvium-map/scripts/geometry/geometry.mjs";

/** Шестиугольник с острым верхом, как в сетке Foundry, обход по часовой на экране. */
function hex(cx, cy, r = 50) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * ((60 * k) - 90);
    return [cx + (r * Math.cos(a)), cy + (r * Math.sin(a))];
  });
}
const W = Math.sqrt(3) * 50;
// Смещённые ряды: клетка (row, col) → центр.
const at = (row, col) => [(col * W) + ((row % 2) * W / 2), row * 75];

/** Квадрат 10×10 с обходом как у клеток сетки. */
const square = (x, y, s = 10) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

test("одна клетка даёт один контур из 6 точек", () => {
  const rings = cellsOutline([hex(0, 0)]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 6);
});

test("две соседние клетки сливаются в один контур без общего ребра", () => {
  const rings = cellsOutline([hex(...at(0, 0)), hex(...at(0, 1))]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 10);
  const area = Math.abs(signedArea(rings[0]));
  const one = Math.abs(signedArea(hex(0, 0)));
  assert.ok(Math.abs(area - (2 * one)) < 1, `площадь ${area} ≈ ${2 * one}`);
});

test("кольцо клеток вокруг пустой даёт контур с дырой", () => {
  // Соседи клетки (1,1) в сетке со сдвигом нечётных рядов.
  const ring = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 1], [2, 2]].map(([r, c]) => hex(...at(r, c)));
  const rings = cellsOutline(ring);
  assert.equal(rings.length, 2);
  const shapes = groupRings(rings);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].holes.length, 1);
  assert.equal(pointInRings(at(1, 1), rings), false, "центр пустой клетки снаружи");
  assert.equal(pointInRings(at(0, 1), rings), true, "центр закрашенной клетки внутри");
});

test("квадратная сетка: 2×2 клетки дают квадрат из 4 углов", () => {
  const rings = cellsOutline([square(0, 0), square(10, 0), square(0, 10), square(10, 10)]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 4);
});

test("две отдельные области остаются двумя фигурами", () => {
  const shapes = groupRings(cellsOutline([square(0, 0), square(50, 0)]));
  assert.equal(shapes.length, 2);
});

test("лента реки расширяется к устью", () => {
  const poly = ribbon([[0, 0], [100, 0], [200, 0]], 2, 10);
  assert.equal(poly.length, 6);
  const widthAt = i => Math.abs(poly[i][1] - poly[poly.length - 1 - i][1]);
  assert.ok(Math.abs(widthAt(0) - 2) < 1e-9);
  assert.ok(Math.abs(widthAt(2) - 10) < 1e-9);
});

test("пунктир: 100 пикселей при штрихе 10 и зазоре 10 дают 5 штрихов", () => {
  const parts = dashPolyline([[0, 0], [50, 0], [100, 0]], 10, 10);
  assert.equal(parts.length, 5);
  for ( const p of parts ) assert.ok(Math.abs(polylineLength(p) - 10) < 1e-9);
});

test("пунктир без зазора возвращает линию целиком", () => {
  assert.equal(dashPolyline([[0, 0], [10, 0]], 0, 0).length, 1);
});

test("упрощение убирает точки на прямой и оставляет углы", () => {
  const pts = [[0, 0], [1, 0.1], [2, 0], [3, 0.1], [4, 0], [4, 4]];
  assert.deepEqual(simplify(pts, 0.5), [[0, 0], [4, 0], [4, 4]]);
});

test("сплайн проходит через опорные точки", () => {
  const pts = [[0, 0], [100, 50], [200, 0]];
  const curve = catmullRom(pts, 8);
  assert.deepEqual(curve[0], pts[0]);
  assert.deepEqual(curve[8], pts[1]);
  assert.deepEqual(curve.at(-1), pts[2]);
});

test("извилистость одинакова при одном зерне и не трогает концы", () => {
  const pts = [[0, 0], [300, 0]];
  const a = meander(pts, 0.3, "river-1"), b = meander(pts, 0.3, "river-1");
  assert.deepEqual(a, b);
  assert.deepEqual(a[0], pts[0]);
  assert.deepEqual(a.at(-1), pts[1]);
  assert.ok(a.length > 2);
});

test("подпись области ставится внутри неё", () => {
  const rings = cellsOutline([hex(...at(0, 0)), hex(...at(0, 1)), hex(...at(1, 0))]);
  assert.ok(pointInRings(labelPoint(rings), rings));
});

test("середина ломаной и расстояние до неё", () => {
  assert.deepEqual(midpoint([[0, 0], [10, 0], [10, 10]]), [10, 0]);
  assert.equal(distToPolyline([5, 3], [[0, 0], [10, 0]]), 3);
});
