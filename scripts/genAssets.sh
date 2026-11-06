#!/usr/bin/env bash
# Generate sprite images for Stock Builder with Codex image generation.
# Usage: ./scripts/genAssets.sh            (all missing assets)
#        ./scripts/genAssets.sh --force    (regenerate everything)
set -euo pipefail
cd "$(dirname "$0")/.."
ASSET_DIR="public/assets"
mkdir -p "$ASSET_DIR"

STYLE="Cute chibi pixel-art game sprite, 2D side view, bold dark outline, bright cheerful palette, \
single object centered with generous margin, NO text, NO ground shadow, NO scenery. \
Background must be fully transparent; if transparency is impossible use a perfectly flat pure magenta #FF00FF background."

declare -a NAMES=(
  "worker_hammer|a tiny construction worker with a yellow hard hat and orange vest swinging a hammer, facing right"
  "worker_carry|a tiny construction worker with a yellow hard hat and orange vest carrying a stack of red bricks on the shoulder, walking right"
  "worker_cheer|a tiny construction worker with a yellow hard hat jumping with both arms raised, very happy"
  "worker_panic|a tiny construction worker with a yellow hard hat running in panic with sweat drops, hands on head, facing right"
  "crane|a yellow tower construction crane, tall and thin, jib pointing left, with a hook hanging, full height visible"
  "excavator|a small yellow excavator with the arm raised to the right, side view"
  "floor|one floor segment of a building facade seen from the front: beige brick wall with three blue windows in a row, wide rectangle about 3:1, flat front view, edges touching the image sides horizontally"
  "roof|a flat building rooftop cap seen from the front: dark grey parapet with a small water tank and a little green flag, wide rectangle about 3:1"
  "rubble|a pile of broken bricks, concrete chunks and bent steel bars, wide low heap, side view"
)

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

LIST=""
for entry in "${NAMES[@]}"; do
  name="${entry%%|*}"; desc="${entry#*|}"
  if [[ $FORCE == 1 || ! -f "$ASSET_DIR/$name.png" ]]; then
    LIST+="- ${name}.png : ${desc}"$'\n'
  fi
done

if [[ -z "$LIST" ]]; then
  echo "[genAssets] all assets exist (use --force to regenerate)"
  exit 0
fi

echo "[genAssets] generating:"
echo "$LIST"

PROMPT="Use your image generation tool to create the following sprite images, one image per item.
Shared style for every image: ${STYLE}

Images:
${LIST}
After generating each image, save it as a PNG file at ./${ASSET_DIR}/<file name> (copy it from wherever the image tool stored it).
Do not create or modify any other files. When finished, list the saved files with their pixel sizes."

codex exec \
  --skip-git-repo-check \
  --sandbox workspace-write \
  -C "$(pwd)" \
  "$PROMPT"

# keep originals in assets_src/ and shrink the served copies
mkdir -p assets_src
for f in "$ASSET_DIR"/*.png; do
  w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/ {print $2}')
  [[ "$w" -le 700 ]] && continue
  cp "$f" "assets_src/$(basename "$f")"
  case "$(basename "$f")" in
    worker_*) sips -Z 320 "$f" >/dev/null ;;
    crane.png|excavator.png) sips -Z 480 "$f" >/dev/null ;;
    *) sips -Z 640 "$f" >/dev/null ;;
  esac
done

echo "[genAssets] done:"
ls -la "$ASSET_DIR"
