FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig*.json vite.config.ts index.html system.html ./
COPY client/ client/
COPY shared/ shared/
COPY server/ server/
COPY scripts/build-server.mjs scripts/build-server.mjs
COPY public/ public/
COPY data/story/ data/story/
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/build/ build/
COPY --from=build --chown=node:node /app/dist/ dist/
USER node
EXPOSE 3001
CMD ["node", "build/server/index.js"]
