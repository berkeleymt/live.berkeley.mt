FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.1/tailwindcss-linux-x64 \
 && chmod +x /usr/local/bin/tailwindcss
COPY --from=ghcr.io/getzola/zola:v0.21.0 /bin/zola /usr/local/bin/zola
WORKDIR /site
COPY . .
RUN tailwindcss -i static/input.css -o static/style.css --minify && zola build --base-url https://live.berkeley.mt

# nginx serves the site on 3001; rooms_api.py (same container) answers /api/rooms
# live from ContestDojo. Runs as root so it can read/write the data volume the
# deployment already mounts at /app/data (where the deploy job puts the token).
FROM nginx:alpine
RUN apk add --no-cache python3
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site/public /usr/share/nginx/html
COPY server/rooms_api.py /app/rooms_api.py
COPY data/rooms.toml /app/rooms.toml
COPY start.sh /app/start.sh
EXPOSE 3001
CMD ["/app/start.sh"]
