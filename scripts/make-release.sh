#!/bin/bash
# Împachetează Veghe.zip pentru GitHub Releases.
# Rulează: bash scripts/make-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/dist/Veghe.zip"
STAGE="$(mktemp -d)/Veghe"
mkdir -p "$STAGE" "$ROOT/dist"

# Ce intră în pachet (fără build-uri Xcode, fără config cu token, fără .DS_Store)
cp -R agent "$STAGE/"
cp -R scripts "$STAGE/"
cp README.md LICENSE "Instaleaza.command" "$STAGE/"
[ -f ecrane-aplicatie.jpg ] && cp ecrane-aplicatie.jpg "$STAGE/"
[ -f dist/Veghe.ipa ] && { mkdir -p "$STAGE/iphone-nativ"; cp dist/Veghe.ipa "$STAGE/iphone-nativ/"; }

# Curățenie
find "$STAGE" -name ".DS_Store" -delete
find "$STAGE" -name "*.log" -delete
rm -rf "$STAGE/agent/test" 2>/dev/null || true

# Fără zone-ul de quarantine care sperie Gatekeeper mai tare decât trebuie
xattr -cr "$STAGE" 2>/dev/null || true

rm -f "$OUT"
( cd "$(dirname "$STAGE")" && zip -r -X "$OUT" "Veghe" >/dev/null )
rm -rf "$(dirname "$STAGE")"

echo "✅ Gata: $OUT"
echo "   Încarcă-l la GitHub → Releases → Draft a new release → Attach."
