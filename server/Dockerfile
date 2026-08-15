# GRUNDO backend — Cloud Run
#
# FIGYELEM: a build kontextusa a REPO GYÖKERE, nem a server/ mappa —
# a szerver a klienssel közös játékmotort is fordítja (src/game).
#
#   docker build -f server/Dockerfile -t grundo-api .
#
# Cloud Buildben ugyanezt a cloudbuild.yaml intézi.

FROM node:22-slim AS build
WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci

# A játékmotor közös a klienssel — a szerver is ezt a kódot futtatja,
# hogy az élő előnézet és a hiteles számítás azonos eredményt adjon.
COPY src/game ./src/game
COPY src/config ./src/config
COPY src/types ./src/types
COPY server ./server

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
