#!/usr/bin/env bash
# Met à jour automatiquement le suffixe de cache-busting (?v=YYYYMMDDHHMM) sur tous les
# fichiers .js/.css référencés dans les .html, ainsi que dans sw.js (TC_SW_CACHE) et
# l'enregistrement du service worker. À lancer avant chaque déploiement.
set -euo pipefail
cd "$(dirname "$0")"

NEW_VERSION="$(date +%Y%m%d%H%M)"
OLD_VERSION_PATTERN='v=[0-9]{10,12}'

echo "Mise à jour du cache-busting vers v=${NEW_VERSION}"

for f in *.html; do
  sed -i -E "s/${OLD_VERSION_PATTERN}/v=${NEW_VERSION}/g" "$f"
done

sed -i -E "s/${OLD_VERSION_PATTERN}/v=${NEW_VERSION}/g" index.js sw.js 2>/dev/null || true
sed -i -E "s/tc-static-v[0-9]+/tc-static-v${NEW_VERSION}/" sw.js

echo "Terminé. Vérifiez les diffs avant de committer (git diff)."
