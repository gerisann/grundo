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
# 1. ⚠️ A Mapbox-token 2026-08-29 ÓTA A SECRET MANAGERBŐL JÖN, nem innen.
#    Korábban a szkript a `.env.local`-ból olvasta ki és substitutionként
#    adta át. Ez két okból bukott meg:
#      - a `.env.local` gitignore-olt, tehát a Cloud Shell másolatában MÁS
#        token állhatott, mint a fejlesztői gépen — és pontosan ez történt:
#        élesbe egy régi, URL-korlátozott (403-as) token került;
#      - aki nem ezt a szkriptet használta, hanem sima `gcloud builds
#        submit`-et, annak a `--set-env-vars` némán kiütötte a tokent.
#    A titok cseréje: lásd `docs/06-architektura-es-admin.md`.
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
before_pull="$(git rev-parse HEAD)"
git pull --ff-only
printf '   HEAD: %s\n' "$(git log --oneline -1)"

# ⚠️ HA MAGA EZ A SZKRIPT FRISSÜLT, ÚJRA KELL INDÍTANI MAGUNKAT.
#
# A bash a futó szkriptet a lemezről olvassa, de a már beolvasott részt nem
# olvassa újra. A fenti `git pull` tehát kicserélheti a fájlt a lábunk alatt,
# miközben a RÉGI változat fut tovább — a friss javítás pedig csak a
# következő indításnál érvényesülne.
#
# Konkrét eset (2026-08-29): a token Secret Managerre állítása után a pull
# lehozta a javított szkriptet, de a régi kód futott tovább, és a build
# ugyanazzal a `_MAPBOX_TOKEN`-hibával hasalt el, mint előtte. Kívülről úgy
# nézett ki, mintha a javítás nem működne.
#
# Végtelen ciklus nem lehet belőle: a második futásban a pull már nem hoz
# újat, tehát a `before_pull` és a HEAD megegyezik.
if [ "$before_pull" != "$(git rev-parse HEAD)" ] \
   && ! git diff --quiet "$before_pull" HEAD -- scripts/deploy.sh; then
  info "A telepítő szkript frissült — újraindítás a friss változattal"
  exec "$REPO_ROOT/scripts/deploy.sh" "$MODE"
fi

deploy_backend() {
  # A `--set-secrets` LÉTEZŐ titkot vár: ha hiányzik, a `gcloud run deploy`
  # a build legvégén hasal el, több perc után, nehezen olvasható hibával.
  # Előbb megnézzük, és érthető magyar üzenetet adunk helyette.
  if ! gcloud secrets describe MAPBOX_TOKEN >/dev/null 2>&1; then
    fail "Nincs MAPBOX_TOKEN titok a Secret Managerben. Létrehozás:
    printf %s 'pk.xxx' | gcloud secrets create MAPBOX_TOKEN --data-file=-
    gcloud secrets add-iam-policy-binding MAPBOX_TOKEN --member=\"serviceAccount:65689674957-compute@developer.gserviceaccount.com\" --role=\"roles/secretmanager.secretAccessor\"
  Részletek: docs/06-architektura-es-admin.md"
  fi

  info "Backend build és telepítés (Cloud Run)"
  printf '   Mapbox-token forrása: Secret Manager (MAPBOX_TOKEN:latest)\n'
  gcloud builds submit --config cloudbuild.yaml
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
