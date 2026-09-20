#!/usr/bin/env bash

ROOT_DIR="$(
    cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
    pwd
)"

SPICETIFY_DIR="${HOME}/.config/spicetify"
EXTENSIONS_DIR="${SPICETIFY_DIR}/Extensions"

mkdir -p "${EXTENSIONS_DIR}"

cp \
    "${ROOT_DIR}/spicetify/shkila-dj-narration-probe.js" \
    "${EXTENSIONS_DIR}/shkila-dj-narration-probe.js"

spicetify config extensions shkila-dj-narration-probe.js
spicetify apply

echo
echo "spotify-shkila Spicetify-extension installed"
