// Предпросмотр листа без Foundry: собирает шаблоны с тестовыми данными и снимает скриншот.
// Запуск: NODE_PATH=$(npm root -g) node tools/preview/render.mjs <out.png>
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sys = p => path.join(root, "system", p);
const lang = JSON.parse(readFileSync(sys("lang/ru.json"), "utf8"));
const get = k => k.split(".").reduce((o, p) => o?.[p], lang) ?? k;
Handlebars.registerHelper("localize", (k, opts) => {
  let s = get(k);
  for ( const [a, b] of Object.entries(opts?.hash ?? {}) ) s = s.replace(`{${a}}`, b);
  return s;
});
Handlebars.registerHelper("vitruviumEq", (a, b) => a === b);
const tpl = p => Handlebars.compile(readFileSync(sys(p), "utf8"));
for ( const p of ["templates/actor/parts/item-list.hbs", "templates/actor/parts/statuses-levels.hbs"] ) {
  Handlebars.registerPartial(`systems/vitruvium/${p}`, readFileSync(sys(p), "utf8"));
}
const fix = html => html.replaceAll("systems/vitruvium/", `http://127.0.0.1:8123/system/`);

const chars = [["physique","Телосложение","teloslozhenie",2],["movement","Движение","dvizhenie",1],["attention","Внимание","vnimanie",3],["thinking","Мышление","myshlenie",1],["influence","Влияние","vliyanie",2],["will","Воля","volya",1]]
  .map(([key,label,icon,value]) => ({ key, label, hint: "", icon: `systems/vitruvium/assets/icons/${icon}.svg`, value, pips: [1,2,3].map(n => ({ n, on: n <= value })) }));
const tabs = ["description","domains","attributes","property","states","notes"].map(id => ({ id, group: "primary", label: `VITRUVIUM.Tab.${id}`, cssClass: id === (process.argv[3] ?? "domains") ? "active" : "" }));
const ctx = {
  actor: { name: "Эльза Хорн", img: "icons/svg/mystery-man.svg" },
  system: { player: "Гера" }, isCharacter: true, editable: true, isGM: true,
  characteristics: chars,
  inspiration: { value: 3, max: 6, pips: [1,2,3,4,5,6].map(n => ({ n, on: n <= 3 })) },
  inspirationIcon: "systems/vitruvium/assets/icons/vdohnovenie.svg",
  levels: [["common",3,"Обычный"],["rare",6,"Редкий"],["outstanding",9,"Выдающийся"],["legendary",12,"Легендарный"]].map(([key,points,label]) => ({ key, points, label, hint: get(`VITRUVIUM.Level.${key}Hint`), active: key === "rare" })),
  budget: [["charPoints",4,6],["domainCount",2,6],["domainPoints",7,6],["attributes",2,6],["property",3,6]].map(([k,v,m]) => ({ label: get(`VITRUVIUM.Budget.${k}`), value: v, max: m, over: v > m })),
  domains: [
    { id: "a", name: "Торговля", img: "icons/svg/book.svg", level: 3, slots: 6, pips: [1,2,3].map(n => ({ n, on: true })), abilities: [{ name: "Путевой промысел" }, { name: "Ярмарочные продажи" }, { name: "Антиквар" }], expanded: false },
    { id: "b", name: "Скрытность", img: "icons/svg/book.svg", level: 1, slots: 2, pips: [1,2,3].map(n => ({ n, on: n <= 1 })), abilities: [{ name: "Тихий шаг" }, { name: "Взлом замков" }, { name: "Затеряться в толпе" }], overAbilities: true, expanded: true, description: "<p>Умение оставаться незамеченной.</p>" }
  ],
  attributes: [{ id: "c", name: "Одиночка", img: "icons/svg/aura.svg" }, { id: "d", name: "Латинский язык", img: "icons/svg/aura.svg" }],
  property: [{ id: "e", name: "Револьвер", img: "icons/svg/chest.svg", statuses: [{ name: "Разряженная обойма" }], levels: [{ name: "Патроны", value: 2, max: 6 }] }],
  statuses: [{ name: "Ранение в плечо" }], levelsList: [{ name: "Репутация в коллективе", value: 11, max: 12 }],
  aspects: [{ name: "Дисциплина", subject: "Корабль «Эльскаринна»", value: 1, current: "Нормально", scaleText: "3 Идеально\n2 Хорошо\n1 Нормально", statusesText: "На грани мятежа" }],
  tabs
};
const parts = ["header","tabs","tab-description","tab-domains","tab-attributes","tab-property","tab-states","tab-notes"];
const html = parts.map(p => tpl(`templates/actor/${p}.hbs`)({ ...ctx, tab: tabs.find(t => `tab-${t.id}` === p) })).join("\n");
const P = (i, r) => { const a = (-90 + i * 60) * Math.PI / 180; return [130 + r * Math.cos(a), 130 + r * Math.sin(a)]; };
const poly = rs => rs.map((r, i) => P(i, r).map(n => n.toFixed(1)).join(",")).join(" ");
const order = ["physique","movement","attention","thinking","influence","will"];
const byKey = Object.fromEntries(chars.map(c => [c.key, c]));
const vr = order.map(k => 90 * byKey[k].value / 3);
const radar = { size: 260, center: 130, points: 4,
  rings: [1,2,3].map(n => poly(Array(6).fill(30 * n))),
  spokes: order.map((_, i) => { const [x, y] = P(i, 90); return { x, y }; }),
  shape: poly(vr), dots: vr.map((r, i) => { const [x, y] = P(i, r); return { x, y }; }),
  axes: order.map((k, i) => { const [x, y] = P(i, 122); return { ...byKey[k], left: x / 2.6, top: y / 2.6 }; }) };
const stats = tpl("templates/apps/stats.hbs")({ ...ctx, radar, level: { label: "Редкий" }, canRoll: true, canEditInspiration: true,
  attributes: ctx.attributes, domains: [{ name: "Торговля", level: 3, abilities: "Антиквар" }, { name: "Скрытность", level: 1 }],
  property: [{ name: "Револьвер" }], statuses: ctx.statuses, levels: ctx.levelsList,
  aspects: [{ name: "Дисциплина", subject: "Корабль «Эльскаринна»", value: 1, current: "Нормально" }] });
const css = readFileSync(sys("styles/vitruvium.css"), "utf8").replaceAll("../assets/", `file://${root}/system/assets/`);
const cuiCss = process.env.CUI ? readFileSync(process.env.CUI, "utf8") : "";
const page = `<html><head><meta charset="utf-8"><style>${cuiCss}</style><style>${css} body{margin:0;background:#000} .window-content{display:flex;flex-direction:column;gap:12px;height:900px}</style></head>
<body class="${process.env.CUI ? "crlngn-ui cui-font-t cui-font-ui crlngn-ws crlngn-sheets theme-dark" : ""}"><form class="vitruvium vitruvium-sheet actor application sheet standard-form" style="width:820px;margin:10px"><header class="window-header"><h1 class="window-title">Эльза Хорн</h1></header><div class="window-content">${fix(html)}</div></form>
<div class="vitruvium vitruvium-stats application" style="width:780px;position:absolute;left:850px;top:10px"><div class="window-content">${fix(stats)}</div></div></body></html>`;

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1650, height: 940 } });
await pg.route("http://127.0.0.1:8123/preview.html", r => r.fulfill({ contentType: "text/html", body: page }));
await pg.goto("http://127.0.0.1:8123/preview.html");
await pg.waitForTimeout(300);
await pg.screenshot({ path: process.argv[2] ?? "preview.png" });
await browser.close();
console.log("ok");
