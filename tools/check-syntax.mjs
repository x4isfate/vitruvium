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
process.exit(bad ? 1 : 0);
