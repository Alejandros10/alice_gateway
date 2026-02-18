# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias (incluyendo devDeps para compilar)
COPY package*.json ./
RUN npm ci

# Compilar TypeScript → dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

# Artefactos compilados
COPY --from=builder /app/dist ./dist

# Variables de entorno
COPY .env ./

EXPOSE 3001

CMD ["node", "dist/index.js"]
