#!/usr/bin/env bash
#
# GRUNDO — telepítés egy paranccsal.
#
# HASZNÁLAT (2026-08-29-től A FEJLESZTŐI GÉPRŐL, Git Bashből, a repo bárhol):
#
#   ./scripts/deploy.sh              # backend, majd frontend
#   ./scripts/deploy.sh backend
#   ./scripts/deploy.sh frontend
#   ./scripts/deploy.sh graphhopper  # az útvonalmotor — lásd lent
#   ./scripts/deploy.sh szabalyok    # Firestore + Storage szabályok
#   ./scripts/deploy.sh indexek      # Firestore indexek
#
# ⚠️ A CLOUD SHELL MÁR NEM KELL (Geri döntése, 2026-08-29 — a heti kvóta
# elfogyott). A gépen minden megvan hozzá: `gcloud`, `firebase`, `node`, `npm`,
# és mind a kettő be van jelentkezve (`gcloud auth list`, `firebase login:list`).
# A backend build ettől függetlenül TOVÁBBRA IS a felhőben fut — a `gcloud
# builds submit` csak feltölti a forrást.
#
# ⚠️ AMI EMIATT MEGVÁLTOZOTT, ÉS AMIBE BELE IS FUTOTTUNK: a kliens
# konfigurációja korábban a Cloud Shell másolatának GITIGNORE-OLT `.env.local`
# fájljából jött. Az első fejlesztői gépes build ezért Firebase-konfig NÉLKÜL
# ment ki, és az éles oldal „A Firebase nincs beállítva" hibával fogadta a
# felhasználókat. A nyilvános konfiguráció azóta a repóban van
# (`.env.production`), tehát a build nem függ attól, ki melyik gépen áll.
# TITOK továbbra sem kerülhet oda — a Mapbox token a gitignore-olt
# `.env.local`-ban marad.
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
# ⚠️ A `szabalyok`, az `indexek` ÉS A `graphhopper` SZÁNDÉKOSAN NEM RÉSZE a
#    „mindkettő"-nek (`all`). A `graphhopper` külön ok: a gráf csak akkor
#    változik, ha az OSM-adat frissül vagy a GraphHopper-konfiguráció módosul
#    — ezt minden backend-telepítésnél újraépíteni percekig tartana,
#    feleslegesen. Csak akkor futtasd, ha tényleg a `graphhopper/` mappában
#    változott valami.

set -euo pipefail

PROJECT="grundo"
MODE="${1:-all}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

info() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ⚠️ A MÓD ÉRVÉNYESSÉGÉT SZÁNDÉKOSAN NEM ITT ELLENŐRIZZÜK, hanem a legvégén,
# a dispatch `case`-ében (lásd lent). Ha itt, a `git pull` ELŐTT hasalna el,
# egy elavult helyi másolat sosem jutna el odáig, hogy frissítse magát — egy
# ÚJ mód (mint a `graphhopper`) nevét a régi szkript nem is ismerhetné.
# Konkrét eset (2026-08-29): pontosan ez történt, „Ismeretlen mód" jött,
# minden `info` sor NÉLKÜL — ami elárulta, hogy a hiba a pull előtt van.

info "Projekt beállítása: $PROJECT"
gcloud config set project "$PROJECT" >/dev/null

# ⚠️ NEM COMMITOLT MÓDOSÍTÁSSAL NEM TELEPÍTÜNK.
#
# Cloud Shellben ez nem fordulhatott elő: ott a másolat csak telepítésre
# szolgált, és mindig a `git pull` friss állapotát telepítette. A FEJLESZTŐI
# GÉPEN viszont ugyanaz a mappa a munkapéldány — egy félkész, épp szerkesztett
# fájl így némán élesbe kerülne. Ezért itt megállunk.
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "A munkamásolat nem tiszta. Commitold vagy stasheld a fenti módosításokat a telepítés előtt."
fi

info "Friss kód lehúzása"
before_pull="$(git rev-parse HEAD)"
git pull --ff-only
printf '   HEAD: %s\n' "$(git log --oneline -1)"

# Pusholatlan commit nem akadály — helyi buildnél a HELYI kód települ, és ez
# néha szándékos. De tudni kell róla: ami élesben fut, annak a GitHubon is ott
# a helye, különben egy géphiba viszi magával az egyetlen példányt.
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  unpushed="$(git log --oneline '@{u}'..HEAD | wc -l | tr -d ' ')"
  if [ "$unpushed" != "0" ]; then
    printf '\n\033[33m⚠ %s pusholatlan commit — ezek is élesbe kerülnek. Telepítés után: git push\033[0m\n' "$unpushed"
  fi
fi

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

deploy_graphhopper() {
  info "GraphHopper build és telepítés (Cloud Run) — ez EGYSZERI HÍVÁS UTÁN percekig tart"
  printf '   Az import a build alatt fut (Xmx4g) — lásd graphhopper/Dockerfile.\n'
  (cd "$REPO_ROOT/graphhopper" && gcloud builds submit --config cloudbuild.yaml)
  printf '\n\033[33m⚠ Ha ez az ELSŐ telepítés, az IAM-jog és a %s\033[0m\n' \
    "backend _GRAPHHOPPER_URL substitution EZUTÁN kell — lásd graphhopper/cloudbuild.yaml fejléce."
}

case "$MODE" in
  backend)     deploy_backend ;;
  frontend)    deploy_frontend ;;
  all)         deploy_backend; deploy_frontend ;;
  graphhopper) deploy_graphhopper ;;
  szabalyok)   info "Firestore + Storage szabályok"; firebase deploy --only firestore:rules,storage ;;
  indexek)     info "Firestore indexek"; firebase deploy --only firestore:indexes ;;
  *) fail "Ismeretlen mód: $MODE. Használható: all, backend, frontend, graphhopper, szabalyok, indexek" ;;
esac

printf '\n\033[32m✓ Kész: %s\033[0m\n' "$MODE"
