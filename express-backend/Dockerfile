# Multi-stage Dockerfile for Express REST Backend
# Stage 1: Build TypeScript
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Security: Non-root user with proper directory ownership
RUN chown -R node:node /app
USER node

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --from=builder --chown=node:node /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
