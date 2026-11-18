# syntax=docker/dockerfile:1

# ---------- Stage 1: install production dependencies ----------
# This stage is only used to build node_modules. Nothing from it except
# node_modules ends up in the final image.
FROM node:22-alpine AS deps
WORKDIR /app

# Copy ONLY the dependency files first. Docker caches each step (layer), so as long as
# package*.json do not change, "npm ci" below is skipped on later builds. That is the
# biggest build-speed win in most Node Dockerfiles.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: the small runtime image ----------
FROM node:22-alpine AS runtime
WORKDIR /app

# Defaults the app reads at start-up (override with -e or in docker-compose.yml).
# /data is where notes and uploads are saved; mount a volume there to keep them.
ENV NODE_ENV=production \
    PORT=3000 \
    NOTES_FILE=/data/notes.json \
    UPLOAD_DIR=/data/uploads

# Copy the app code. This changes most often, so it comes last.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server.js package.json ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public

# Create the data folder owned by the unprivileged "node" user (built into the image).
RUN mkdir -p /data && chown node:node /data

# Do not run as root inside the container.
USER node

# Documentation only: the app listens on 3000. Publishing a port is done with -p or compose.
EXPOSE 3000

# Docker marks the container "healthy" or "unhealthy" from this check.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
