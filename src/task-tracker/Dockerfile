FROM oven/bun:1.4.2 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN bun run typecheck && bun run test
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=9005
COPY --from=build --chown=bun:bun /app/dist/server.js ./server.js
USER bun
EXPOSE 9005
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e 'const response = await fetch("http://127.0.0.1:" + process.env.PORT + "/health"); process.exit(response.ok ? 0 : 1);'
CMD ["bun", "server.js"]
