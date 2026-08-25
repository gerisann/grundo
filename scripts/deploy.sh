#!/usr/bin/env bash
#
# GRUNDO — telepítés Cloud Shellből, egy paranccsal.
#
# HASZNÁLAT (Cloud Shell, bárhonnan):
#
#   ~/grundo/scripts/deploy.sh              # backend, majd frontend
#   ~/grundo/scripts/deploy.sh backend
#   ~/grundo/scripts/deploy.sh frontend
#   ~/grundo/scripts/deploy.sh szabalyok    # Firestore + Storage szabályok
#   ~/grundo/scripts/deploy.sh indexek      # Firestore indexek
#
# MIÉRT VAN EZ A SZKRIPT?
#
# 1. A Mapbox-tokent eddig kézzel kellett a backend build parancsához írni.
#    Ez ugyanaz az érték, mint a frontend `VITE_MAPBOX_TOKEN`-je (lásd
#    `server/src/lib/directions.ts` fejléce), ami már ott van a Cloud Shell
#    `.env.local`-jában — a szkript onnan olvassa ki. Nem titok, de begépelni
#    fölösleges, elgépelni pedig könnyű.
#
# 2. A Cloud Shell session el szokta veszteni a projektbeállítást, és a build
#    ilyenkor el sem indul („The required property [project] is not currently
#    set"). A szkript ezt minden futásnál beállítja.
#
# 3. A „mindkettő" eset sorrendje NEM mindegy: előbb a backend, utána a
#    frontend. Így egy új végpontot hívó felület sosem ér oda a végpont elé.
#    (Fordítva a felhasználó 404-et kapna, amíg a backend build tart.)
#
# ⚠️ A `szabalyok` és az `indexek` szándékosan NEM része a „mindkettő"-nek:
#    azokat csak akkor futtasd, ha tényleg változott a `firestore.rules` /
#    `storage.rules` / `firestore.indexes.json`.

set -euo pipefail

PROJECT="grundo"
MODE="${1:-all}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

info() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

case "$MODE" in
  all|backend|frontend|szabalyok|indexek) ;;
  *) fail "Ismeretlen mód: $MODE. Használható: all, backend, frontend, szabalyok, indexek" ;;
esac

info "Projekt beállítása: $PROJECT"
gcloud config set project "$PROJECT" >/dev/null

info "Friss kód lehúzása"
git pull --ff-only
printf '   HEAD: %s\n' "$(git log --oneline -1)"

# A Mapbox-token: környezeti változó, ha van; különben a `.env*` fájlokból.
# A `--set-env-vars` a Cloud Run TELJES környezetét felülírja, ezért ha ez
# üresen menne át, a szerver Directions-hívásai némán elhalnának.
mapbox_token() {
  if [ -n "${MAPBOX_TOKEN:-}" ]; then
    printf '%s' "$MAPBOX_TOKEN"
    return 0
  fi
  local file value
  for file in .env.local .env.production.local .env.production .env; do
    [ -f "$file" ] || continue
    value="$(sed -n 's/^VITE_MAPBOX_TOKEN=//p' "$file" | head -n 1 | tr -d '\r' | tr -d '"')"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

deploy_backend() {
  local token
  if ! token="$(mapbox_token)"; then
    fail "Nincs Mapbox-token. Tedd a .env.local-ba VITE_MAPBOX_TOKEN=… néven, vagy exportáld MAPBOX_TOKEN-ként."
  fi
  info "Backend build és telepítés (Cloud Run)"
  # Csak a forrást írjuk ki, a tokent SOHA.
  if [ -n "${MAPBOX_TOKEN:-}" ]; then
    printf '   Mapbox-token forrása: környezeti változó\n'
  else
    printf '   Mapbox-token forrása: .env fájl\n'
  fi
  gcloud builds submit --config cloudbuild.yaml --substitutions="_MAPBOX_TOKEN=$token"
}

deploy_frontend() {
  info "Frontend build és telepítés (Firebase Hosting)"
  npm install
  npm run build
  firebase deploy --only hosting
}

case "$MODE" in
  backend)   deploy_backend ;;
  frontend)  deploy_frontend ;;
  all)       deploy_backend; deploy_frontend ;;
  szabalyok) info "Firestore + Storage szabályok"; firebase deploy --only firestore:rules,storage ;;
  indexek)   info "Firestore indexek"; firebase deploy --only firestore:indexes ;;
esac

printf '\n\033[32m✓ Kész: %s\033[0m\n' "$MODE"
