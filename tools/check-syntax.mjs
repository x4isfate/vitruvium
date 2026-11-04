// Быстрая проверка без Foundry: синтаксис JS, валидность JSON, компиляция шаблонов Handlebars.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const walk = dir => readdirSync(dir).flatMap(n => {
  const p = path.join(dir, n);
  if ( n === "node_modules" || n === ".git" || n === "dist" ) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
let bad = 0;
for ( const file of walk(root) ) {
  try {
    if ( file.endsWith(".mjs") || file.endsWith(".js") ) execFileSync(process.execPath, ["--check", file]);
    else if ( file.endsWith(".json") ) JSON.parse(readFileSync(file, "utf8"));
    else if ( file.endsWith(".hbs") ) Handlebars.precompile(readFileSync(file, "utf8"));
  } catch(err) {
    bad++;
    console.error("✗", path.relative(root, file), String(err.stderr ?? err.message).slice(0, 400));
  }
}
console.log(bad ? `${bad} файл(ов) с ошибками` : "syntax ok");

// Каждая часть окна ApplicationV2 (PARTS) должна давать ровно один корневой элемент,
// иначе Foundry 13 не откроет окно. Проверяем шаблоны частей с пустыми данными.
const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"]);
function topLevelCount(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  let depth = 0, count = 0;
  for ( const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g) ) {
    const [, close, tag, self] = m;
    if ( close ) { depth--; continue; }
    if ( depth === 0 ) count++;
    if ( !VOID.has(tag.toLowerCase()) && !self ) depth++;
  }
  return count;
}
const hb = Handlebars.create();
hb.registerHelper("localize", k => k);
hb.registerHelper("vitruviumEq", () => true);
hb.registerHelper("helperMissing", () => "");
for ( const name of readdirSync(path.join(root, "system/templates/actor/parts")) ) {
  hb.registerPartial(`systems/vitruvium/templates/actor/parts/${name}`, readFileSync(path.join(root, "system/templates/actor/parts", name), "utf8"));
}
const partDirs = ["system/templates/actor", "system/templates/item", "system/templates/apps"];
let rootBad = 0;
for ( const dir of partDirs ) {
  for ( const name of readdirSync(path.join(root, dir)) ) {
    if ( !name.endsWith(".hbs") || /dialog/.test(name) ) continue;
    const src = readFileSync(path.join(root, dir, name), "utf8");
    for ( const ctx of [{}, { editable: true, isCharacter: true, budget: [1], currentLevel: {}, compact: false }] ) {
      const n = topLevelCount(hb.compile(src)(ctx, { allowProtoPropertiesByDefault: true }).replace(/\{\{>[^}]*\}\}/g, ""));
      if ( n !== 1 ) { rootBad++; console.error("✗", `${dir}/${name}: корневых элементов ${n}, нужен 1`); break; }
    }
  }
}
console.log(rootBad ? `${rootBad} шаблон(ов) с несколькими корнями` : "parts ok");
process.exit(bad || rootBad ? 1 : 0);
