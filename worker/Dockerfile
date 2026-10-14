FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY worker ./worker

USER node

HEALTHCHECK --interval=30s --timeout=20s --start-period=60s --retries=3 \
  CMD ["node", "worker/healthcheck.mjs"]

CMD ["node", "worker/index.mjs"]
