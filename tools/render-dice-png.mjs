// Переводит SVG-метки граней в PNG для Dice So Nice. Нужен Playwright (Chromium).
// Запуск: node tools/render-dice-png.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "modules/vitruvium-dice/textures");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
for ( const kind of ["label", "bump"] ) {
  for ( const n of [0, 1, 2] ) {
    const svg = readFileSync(path.join(dir, `${kind}-${n}.svg`), "utf8");
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: path.join(dir, `${kind}-${n}.png`), omitBackground: true });
  }
}
await browser.close();
console.log("ok");
