FROM node:22-bookworm-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
RUN npm ci

COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @local-ai/web \
    && npm prune --omit=dev \
    && mkdir -p apps/web/public

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /workspace/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
WORKDIR /workspace/apps/web
EXPOSE 3000
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
