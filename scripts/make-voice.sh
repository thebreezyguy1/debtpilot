#!/bin/sh
# Renders scripts/narration.ts to demo-video/voice/<scene>.wav with macOS `say`.
# VOICE="Ava (Premium)" sh scripts/make-voice.sh   (default: Samantha)
set -e
VOICE="${VOICE:-Samantha}"
RATE="${RATE:-172}"
mkdir -p demo-video/voice
npx tsx -e 'import("./scripts/narration.ts").then(m => { for (const [k, v] of Object.entries(m.NARRATION)) console.log(k + "\t" + v) })' |
while IFS="$(printf '\t')" read -r scene line; do
  say -v "$VOICE" -r "$RATE" --file-format=WAVE --data-format=LEI16@24000 -o "demo-video/voice/$scene.wav" "$line"
done
for f in demo-video/voice/*.wav; do
  printf '%s\t%s\n' "$(basename "$f" .wav)" "$(afinfo "$f" | awk '/estimated duration/ {print $3}')"
done > demo-video/voice/durations.tsv
cat demo-video/voice/durations.tsv
