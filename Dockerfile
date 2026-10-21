FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.1/tailwindcss-linux-x64 \
 && chmod +x /usr/local/bin/tailwindcss
COPY --from=ghcr.io/getzola/zola:v0.21.0 /bin/zola /usr/local/bin/zola
WORKDIR /site
COPY . .
RUN tailwindcss -i static/input.css -o static/style.css --minify && zola build --base-url https://live.berkeley.mt

FROM nginxinc/nginx-unprivileged:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site/public /usr/share/nginx/html
EXPOSE 3001
