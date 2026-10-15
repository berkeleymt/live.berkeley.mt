# ── Stage 1: Build frontend ──
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts eslint.config.js ./
COPY public/ public/
COPY src/ src/
ENV VITE_API_URL=/api/live
RUN npm run build

# ── Stage 2: Build Rust server ──
FROM rust:1.87-slim AS backend
RUN apt-get update && apt-get install -y pkg-config cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/Cargo.toml server/Cargo.lock ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY server/src/ src/
RUN touch src/main.rs && cargo build --release

# ── Stage 3: Final image ──
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/server/target/release/server ./server
COPY --from=frontend /app/dist ./dist
COPY content/ ./content/
ENV STATIC_DIR=dist
EXPOSE 3001
CMD ["/app/server"]
