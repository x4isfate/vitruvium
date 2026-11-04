/**
 * Чистая геометрия карты. Без Foundry и PIXI, поэтому проверяется в Node.
 * Точка везде — массив [x, y]. Многоугольник и ломаная — массив точек.
 */

const EPS = 1e-9;

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Длина ломаной. */
export function polylineLength(points) {
  let len = 0;
  for ( let i = 1; i < points.length; i++ ) len += dist(points[i - 1], points[i]);
  return len;
}

/** Ориентированная площадь (по формуле шнурка). Знак зависит от обхода. */
export function signedArea(ring) {
  let s = 0;
  for ( let i = 0, j = ring.length - 1; i < ring.length; j = i++ ) {
    s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return s / 2;
}

/** Точка внутри многоугольника (чётно-нечётное правило). */
export function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for ( let i = 0, j = ring.length - 1; i < ring.length; j = i++ ) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ( ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi) / ((yj - yi) || EPS)) + xi) ) inside = !inside;
  }
  return inside;
}

/** Точка внутри фигуры из колец (внешние контуры и дыры, чётно-нечётное правило по всем кольцам). */
export function pointInRings(pt, rings) {
  let inside = false;
  for ( const r of rings ) if ( pointInRing(pt, r) ) inside = !inside;
  return inside;
}

/** Прямоугольник, охватывающий точки: { x, y, width, height }. */
export function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for ( const [x, y] of points ) {
    if ( x < minX ) minX = x;
    if ( y < minY ) minY = y;
    if ( x > maxX ) maxX = x;
    if ( y > maxY ) maxY = y;
  }
  if ( minX === Infinity ) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Расстояние от точки до отрезка. */
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = (dx * dx) + (dy * dy);
  if ( l2 < EPS ) return dist(p, a);
  let t = (((p[0] - a[0]) * dx) + ((p[1] - a[1]) * dy)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + (t * dx), a[1] + (t * dy)]);
}

/** Расстояние от точки до ломаной. */
export function distToPolyline(p, points) {
  if ( points.length === 1 ) return dist(p, points[0]);
  let best = Infinity;
  for ( let i = 1; i < points.length; i++ ) best = Math.min(best, distToSegment(p, points[i - 1], points[i]));
  return best;
}

/** Упрощение ломаной алгоритмом Дугласа–Пекера. */
export function simplify(points, tolerance = 2) {
  if ( points.length < 3 ) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while ( stack.length ) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for ( let i = s + 1; i < e; i++ ) {
      const d = distToSegment(points[i], points[s], points[e]);
      if ( d > maxD ) { maxD = d; idx = i; }
    }
    if ( idx > 0 && maxD > tolerance ) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Детерминированный шум от строки: одинаковый у всех клиентов, чтобы река не дрожала. */
export function seededRandom(seed) {
  let h = 2166136261;
  for ( const ch of String(seed) ) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Извилистость: между опорными точками вставляются точки со сдвигом поперёк отрезка.
 * amount — доля длины отрезка (0 — прямая).
 */
export function meander(points, amount, seed = "") {
  if ( !amount || points.length < 2 ) return points.slice();
  const rnd = seededRandom(seed);
  const out = [points[0]];
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1], b = points[i];
    const len = dist(a, b);
    const n = Math.max(1, Math.min(6, Math.round(len / 60)));
    const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
    for ( let k = 1; k <= n; k++ ) {
      const t = k / (n + 1);
      const off = (rnd() - 0.5) * 2 * amount * (len / (n + 1));
      out.push([a[0] + ((b[0] - a[0]) * t) + (nx * off), a[1] + ((b[1] - a[1]) * t) + (ny * off)]);
    }
    out.push(b);
  }
  return out;
}

/** Сглаживание Catmull-Rom. Кривая проходит через все исходные точки. */
export function catmullRom(points, samples = 8) {
  if ( points.length < 3 ) return points.slice();
  const out = [];
  const P = i => points[Math.max(0, Math.min(points.length - 1, i))];
  for ( let i = 0; i < points.length - 1; i++ ) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for ( let s = 0; s < samples; s++ ) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * ((2 * p1[k]) + ((-p0[k] + p2[k]) * t)
        + (((2 * p0[k]) - (5 * p1[k]) + (4 * p2[k]) - p3[k]) * t2)
        + ((-p0[k] + (3 * p1[k]) - (3 * p2[k]) + p3[k]) * t3));
      out.push([f(0), f(1)]);
    }
  }
  out.push(points.at(-1));
  return out;
}

/**
 * Лента переменной ширины вдоль ломаной: многоугольник, который заливается одним цветом.
 * Ширина растёт линейно по длине от wStart до wEnd, как река к устью.
 */
export function ribbon(points, wStart, wEnd) {
  if ( points.length < 2 ) return [];
  const total = polylineLength(points) || 1;
  const left = [], right = [];
  let run = 0;
  for ( let i = 0; i < points.length; i++ ) {
    if ( i > 0 ) run += dist(points[i - 1], points[i]);
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = (wStart + ((wEnd - wStart) * (run / total))) / 2;
    left.push([points[i][0] + (nx * w), points[i][1] + (ny * w)]);
    right.push([points[i][0] - (nx * w), points[i][1] - (ny * w)]);
  }
  return left.concat(right.reverse());
}

/** Пунктир: ломаная режется на куски длиной dash с промежутками gap. */
export function dashPolyline(points, dash, gap) {
  if ( !(dash > 0) || !(gap > 0) || points.length < 2 ) return [points.slice()];
  const out = [];
  let cur = [points[0]], drawing = true, left = dash;
  for ( let i = 1; i < points.length; i++ ) {
    let a = points[i - 1];
    const b = points[i];
    let seg = dist(a, b);
    while ( seg > EPS ) {
      if ( seg < left ) {
        if ( drawing ) cur.push(b);
        left -= seg;
        seg = 0;
      } else {
        const t = left / seg;
        const p = [a[0] + ((b[0] - a[0]) * t), a[1] + ((b[1] - a[1]) * t)];
        if ( drawing ) { cur.push(p); out.push(cur); }
        else cur = [p];
        drawing = !drawing;
        a = p;
        seg -= left;
        left = drawing ? dash : gap;
      }
    }
  }
  if ( drawing && cur.length > 1 ) out.push(cur);
  return out;
}

/* ---------------------------------------------------------------- */
/*  Контур из клеток сетки                                           */
/* ---------------------------------------------------------------- */

const key = p => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;

/**
 * Контур набора клеток. Каждая клетка — многоугольник с одинаковым обходом.
 * Ребро, которое есть у двух соседних клеток, идёт у них в разные стороны и сокращается;
 * оставшиеся рёбра лежат на границе и сцепляются в кольца.
 * Возвращает кольца: внешние контуры и дыры вперемешку.
 */
export function cellsOutline(cellPolygons) {
  const edges = new Map(); // "a|b" -> [a, b]
  const points = new Map();
  for ( const poly of cellPolygons ) {
    for ( let i = 0; i < poly.length; i++ ) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ka = key(a), kb = key(b);
      points.set(ka, a); points.set(kb, b);
      const back = `${kb}|${ka}`;
      if ( edges.has(back) ) edges.delete(back);
      else edges.set(`${ka}|${kb}`, [ka, kb]);
    }
  }
  const from = new Map();
  for ( const [k, [a, b]] of edges ) {
    if ( !from.has(a) ) from.set(a, []);
    from.get(a).push({ k, b });
  }
  const used = new Set();
  const rings = [];
  for ( const [k0, [start]] of edges ) {
    if ( used.has(k0) ) continue;
    const ring = [];
    let curKey = k0, guard = 0;
    while ( curKey && !used.has(curKey) && guard++ < 1e6 ) {
      used.add(curKey);
      const [a, b] = edges.get(curKey);
      ring.push(points.get(a));
      if ( b === start ) break;
      const next = (from.get(b) ?? []).find(e => !used.has(e.k));
      curKey = next?.k;
    }
    if ( ring.length >= 3 ) rings.push(dropCollinear(ring));
  }
  return rings;
}

/** Убирает точки, лежащие на прямой между соседями (стороны квадратной сетки). */
export function dropCollinear(ring) {
  if ( ring.length < 4 ) return ring;
  const out = [];
  for ( let i = 0; i < ring.length; i++ ) {
    const a = ring[(i - 1 + ring.length) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
    const cross = ((b[0] - a[0]) * (c[1] - b[1])) - ((b[1] - a[1]) * (c[0] - b[0]));
    if ( Math.abs(cross) > 1e-6 ) out.push(b);
  }
  return out.length >= 3 ? out : ring;
}

/**
 * Раскладывает кольца на фигуры { outer, holes } по вложенности:
 * кольцо внутри чётного числа других — внешний контур, нечётного — дыра.
 */
export function groupRings(rings) {
  const depth = rings.map((r, i) => rings.reduce((n, o, j) => n + ((j !== i && pointInRing(r[0], o)) ? 1 : 0), 0));
  const shapes = [];
  rings.forEach((r, i) => { if ( depth[i] % 2 === 0 ) shapes.push({ outer: r, holes: [], depth: depth[i] }); });
  rings.forEach((r, i) => {
    if ( depth[i] % 2 === 0 ) return;
    const owner = shapes.filter(s => s.depth === depth[i] - 1 && pointInRing(r[0], s.outer))[0];
    owner?.holes.push(r);
  });
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

/** Точка для подписи области: центр тяжести самого большого контура, если он внутри фигуры. */
export function labelPoint(rings) {
  if ( !rings.length ) return null;
  const biggest = rings.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const A = signedArea(biggest);
  let cx = 0, cy = 0;
  for ( let i = 0, j = biggest.length - 1; i < biggest.length; j = i++ ) {
    const f = (biggest[j][0] * biggest[i][1]) - (biggest[i][0] * biggest[j][1]);
    cx += (biggest[j][0] + biggest[i][0]) * f;
    cy += (biggest[j][1] + biggest[i][1]) * f;
  }
  const c = Math.abs(A) > EPS ? [cx / (6 * A), cy / (6 * A)] : biggest[0];
  if ( pointInRings(c, rings) ) return c;
  const b = bounds(biggest);
  return [b.x + (b.width / 2), b.y + (b.height / 2)];
}

/** Точка посередине ломаной по длине (для подписи линии). */
export function midpoint(points) {
  if ( !points.length ) return null;
  const half = polylineLength(points) / 2;
  let run = 0;
  for ( let i = 1; i < points.length; i++ ) {
    const d = dist(points[i - 1], points[i]);
    if ( run + d >= half ) {
      const t = (half - run) / (d || 1);
      return [points[i - 1][0] + ((points[i][0] - points[i - 1][0]) * t), points[i - 1][1] + ((points[i][1] - points[i - 1][1]) * t)];
    }
    run += d;
  }
  return points.at(-1);
}

/** Плоский массив чисел для PIXI.Graphics#drawPolygon. */
export const flat = points => points.flatMap(p => [p[0], p[1]]);

/** Округление точек до целых пикселей перед сохранением. */
export const roundPoints = points => points.map(p => [Math.round(p[0]), Math.round(p[1])]);
