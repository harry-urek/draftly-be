# Server Dockerfile - Multi-stage build for minimal production image
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
# Ensure lifecycle scripts are not executed in containers
ENV NPM_CONFIG_IGNORE_SCRIPTS=true
# Install production deps without running lifecycle scripts
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS development
WORKDIR /app
COPY package*.json ./
# Ensure lifecycle scripts are not executed in containers
ENV NPM_CONFIG_IGNORE_SCRIPTS=true
# Install all deps for dev to keep build fast and stable
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 3001
CMD ["npm", "run", "dev"]

FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S draftly -u 1001

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate

USER draftly
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=20s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
