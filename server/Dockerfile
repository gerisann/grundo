# GRUNDO backend — Cloud Run
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

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.js"]
