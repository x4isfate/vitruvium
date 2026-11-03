#!/bin/sh
# Собирает архивы для релиза: dist/vitruvium.zip + system.json, dist/vitruvium-dice.zip + module.json.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp LICENSE README.md CHANGELOG.md system/
(cd system && zip -qr ../dist/vitruvium.zip . -x "packs/_source/*" "packs/*/LOCK" "packs/*/LOG*")
rm system/LICENSE system/README.md system/CHANGELOG.md
cp system/system.json dist/system.json
(cd modules/vitruvium-dice && zip -qr ../../dist/vitruvium-dice.zip . -x "textures/*.svg")
cp modules/vitruvium-dice/module.json dist/module.json
ls -la dist
