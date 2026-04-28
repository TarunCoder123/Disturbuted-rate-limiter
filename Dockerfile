# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first to leverage layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup . .

USER appuser

EXPOSE 3000

# Health check (Docker will mark container unhealthy if this fails)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/status | grep -q '"status"' || exit 1

ENV NODE_ENV=production \
    PORT=3000

CMD ["node", "app.js"]
