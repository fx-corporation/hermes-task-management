FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/hermes-stub ./src/hermes-stub
RUN bun run build:hermes-ui
RUN bun build src/hermes-stub/server.ts --target=bun --outfile=dist/server.js

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app
ENV NODE_ENV=production HERMES_STUB_HOST=0.0.0.0 HERMES_STUB_PORT=8643 HERMES_STUB_UI_DIR=/app/ui
COPY --from=build --chown=bun:bun /app/dist/server.js ./server.js
COPY --from=build --chown=bun:bun /app/dist/hermes-stub/ui ./ui
USER bun
EXPOSE 8643
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e 'const response = await fetch("http://127.0.0.1:" + process.env.HERMES_STUB_PORT + "/health"); process.exit(response.ok ? 0 : 1);'
CMD ["bun", "server.js"]
