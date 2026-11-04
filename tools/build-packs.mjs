// Собирает компендиумы LevelDB из JSON-исходников в system/packs/_source.
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "system/packs/_source");
for ( const name of readdirSync(src) ) {
  const dir = path.join(src, name);
  if ( !statSync(dir).isDirectory() ) continue;
  const dest = path.join(root, "system/packs", name);
  rmSync(dest, { recursive: true, force: true });
  await compilePack(dir, dest, { log: true });
}
console.log("packs ok");
