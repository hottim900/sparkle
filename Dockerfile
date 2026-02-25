# Stage 1: Build frontend and install all dependencies
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Install build tools needed for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ && \
    npm ci

COPY . .

RUN npm run build

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Install build tools for better-sqlite3, then clean up after install
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && \
    apk del python3 make g++

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy server source (runs via tsx at runtime)
COPY --from=builder /app/server ./server
COPY --from=builder /app/tsconfig.json ./

# Ensure data directory exists for SQLite database
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=/app/data/todo.db

CMD ["node", "--import", "tsx", "server/index.ts"]
