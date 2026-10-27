# ---------------------------------------------------------------------------
# Enterprise Supply Chain Hub - production image
#
# There is no `npm install` step because the application has zero runtime
# dependencies. Tailwind CSS is compiled into public/assets/app.css and the
# resulting file is committed, so the image only needs the Node.js runtime and
# the application source.
# ---------------------------------------------------------------------------
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    LOG_LEVEL=info

WORKDIR /app

# Create an unprivileged runtime user and a writable data directory before
# dropping root. The JSON datastore writes one file and an atomic temp file.
RUN addgroup -S app \
 && adduser -S -G app -H -h /app app \
 && mkdir -p /data \
 && chown -R app:app /data /app

COPY --chown=app:app package.json ./
COPY --chown=app:app server.js ./
COPY --chown=app:app src ./src
COPY --chown=app:app public ./public
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app styles ./styles

USER app

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM

CMD ["node", "server.js"]
