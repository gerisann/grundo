# GRUNDO backend

Cloud Run szolgáltatás. **Ez az egyetlen hely, ahol játékadat íródik** — terület,
GP, szint, jelvény, előfizetés, bizalmi pontszám. A kliens ezeket csak olvassa.

## Végpontok

| Metódus | Útvonal | Mit csinál |
|---|---|---|
| GET | `/healthz` | életjel + a használt adatbázis neve |
| GET | `/api/me` | a bejelentkezett felhasználó profilja · 404 `profile_missing`, ha még nincs |
| POST | `/api/auth/register` | felhasználónév **tranzakcionális** lefoglalása + profil létrehozása |
| POST | `/api/auth/otp/send` | 6 jegyű kód küldése · 60 s újraküldési korlát |
| POST | `/api/auth/otp/verify` | kód ellenőrzése · 15 perc lejárat · max 5 próbálkozás |

Minden `/api/*` végpont Firebase ID-tokent vár: `Authorization: Bearer <token>`.

## Helyi futtatás

```bash
cd server
npm install
cp .env.example .env        # töltsd ki
npm run dev
```

A Firestore-hoz hitelesítés kell. Vagy egy letöltött service account kulcs
(`GOOGLE_APPLICATION_CREDENTIALS`), vagy:

```bash
gcloud auth application-default login
```

Ellenőrzés:

```bash
curl http://localhost:8080/api/health
# {"ok":true,"database":"groundo-db"}
```

## Tesztek

```bash
npm test
```

A tiszta logika (OTP-kezelés, felhasználónév-szabályok, profil-alapértékek)
tesztelt. **A Firestore-műveletek nem** — azok csak élesben, valós adatbázis
ellen próbálhatók.

## Telepítés Cloud Runra

### 1. Előfeltételek

- A `grundo` Firebase projekt **Blaze** csomagon (a Cloud Run számlázást igényel)
- `gcloud` CLI telepítve és bejelentkezve

```bash
gcloud config set project grundo

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com
```

### 2. Artifact Registry tároló

```bash
gcloud artifacts repositories create grundo \
  --repository-format=docker \
  --location=us-west1 \
  --description="GRUNDO konténerek"
```

### 3. Jogosultságok

A Cloud Run alapértelmezett service accountjának írnia kell a Firestore-ba,
és kezelnie kell a Firebase Auth felhasználókat (az e-mail hitelesítéshez).

```bash
PROJECT_NUMBER=$(gcloud projects describe grundo --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding grundo \
  --member="serviceAccount:${SA}" --role="roles/datastore.user"

gcloud projects add-iam-policy-binding grundo \
  --member="serviceAccount:${SA}" --role="roles/firebaseauth.admin"
```

### 4. Build és telepítés

A repo **gyökeréből** (nem a `server/` mappából):

```bash
gcloud builds submit --config cloudbuild.yaml
```

A build kontextusa azért a gyökér, mert a szerver a klienssel közös
játékmotort is fordítja (`src/game`).

### 5. A szolgáltatás URL-je

```bash
gcloud run services describe grundo-api \
  --region=us-west1 --format='value(status.url)'
```

Ezt az URL-t kell beírni az AI Studio secretjei közé:

```
VITE_API_BASE_URL=https://grundo-api-….a.run.app
```

**Amíg ez nincs beállítva, az app működik, csak profil nélkül** — a
`ProfileProvider` `unavailable` állapotba kerül, és nem blokkol.

### 6. E-mail-szolgáltató (az OTP-hez)

Alapból `MAIL_PROVIDER=console`, ami a kódot **csak a szervernaplóba** írja.
A felhasználó így nem kapja meg. Fejlesztéshez az `/api/auth/otp/send` válasza
tartalmazza a kódot (`devCode`), hogy végig lehessen menni a folyamaton.

Élesítéshez:

```bash
gcloud run services update grundo-api --region=us-west1 \
  --set-env-vars=MAIL_PROVIDER=resend,MAIL_FROM='GRUNDO <no-reply@grundo.hu>' \
  --set-secrets=RESEND_API_KEY=resend-api-key:latest
```

A `resend-api-key` titkot előbb hozd létre a Secret Managerben.

## Ellenőrzési lista telepítés után

```bash
API=$(gcloud run services describe grundo-api --region=us-west1 --format='value(status.url)')

# 1. Életjel — a helyes adatbázist kell mondania
curl -s $API/api/health
# {"ok":true,"database":"groundo-db"}

# 2. Token nélkül 401, magyar üzenettel
curl -s $API/api/me
# {"code":"unauthorized","message":"Hiányzó azonosítás."}

# 3. CORS — a saját eredetet engedi
curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://grundo.ai.studio' $API/api/me | grep -i access-control
```

Ha a 3. lépés nem ad `Access-Control-Allow-Origin` fejlécet, az `ALLOWED_ORIGINS`
környezeti változó nem tartalmazza a kliens domainjét.

## Amire figyelj

**Az adatbázis neve `groundo-db`, nem `(default)`.** Ha a `FIRESTORE_DATABASE_ID`
lemarad, a szerver csendben a default adatbázisba ír, és ez hetekkel később derül ki.
A `/healthz` pont ezért adja vissza a nevet.

**A `roles/firebaseauth.admin` nélkül az OTP-hitelesítés elbukik** — a szerver nem
tudja `emailVerified`-re állítani a felhasználót. A hiba a naplóban látszik, a
felhasználó pedig csak annyit lát, hogy „Váratlan hiba".

## Miért `/api/health` és nem `/healthz`

A Google Cloud Run frontendje a `/healthz` pontos útvonalat elfogja, és saját
404-es HTML-t ad rá — a kérés el sem jut a konténerig. A `/healthz/` (záró
perjellel) átmegy, de erre építeni törékeny.

Monitorozáshoz és uptime-ellenőrzéshez **mindig az `/api/health`** útvonalat
használd. A `/healthz` továbbra is regisztrálva van, helyi fejlesztéshez.
