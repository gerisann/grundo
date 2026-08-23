# GRUNDO backend — Cloud Run
#
# FIGYELEM: a build kontextusa a REPO GYÖKERE, nem a server/ mappa —
# a szerver a klienssel közös játékmotort is fordítja (src/game).
#
#   docker build -f server/Dockerfile -t grundo-api .

FROM node:22-slim AS build
WORKDIR /app

# A függőségek a KONTÉNER GYÖKERÉBE kerülnek (/app/node_modules), nem a
# /app/server alá.
#
# Ok: a fordítás a közös motorfájlokat is érinti (/app/src/game/*.ts), és a
# modulfeloldás a fájl helyétől FELFELÉ keres:
#   /app/src/game → /app/src → /app
# Ha a node_modules a /app/server alatt lenne, ezek a fájlok nem találnák meg
# a h3-js-t, és a build "Cannot find module 'h3-js'" hibával állna meg.
COPY server/package*.json ./
RUN npm ci

# A játékmotor közös a klienssel — a szerver is ezt a kódot futtatja,
# hogy az élő előnézet és a hiteles számítás azonos eredményt adjon.
COPY src/game ./src/game
COPY src/config ./src/config
COPY src/types ./src/types
# Az értesítések ugyanazt a területformázót használják, mint a kliens. A
# tsconfig már fordította, de a Docker build-kontextusból eddig kimaradt,
# ezért a Cloud Build TS2307 hibával állt meg.
COPY src/lib/format.ts ./src/lib/format.ts
COPY server ./server

# Az npm a szülőkönyvtárak node_modules/.bin mappáit is a PATH-ra teszi,
# ezért a tsc és a tsc-alias innen is elérhető.
RUN cd server && npm run build

# ── Futtató réteg ────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist

EXPOSE 8080
# A rootDir a repo gyökere, ezért a belépési pont dist/server/server.js
CMD ["node", "dist/server/server.js"]
