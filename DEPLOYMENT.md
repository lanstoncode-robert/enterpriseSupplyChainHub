# Deployment Guide

This is the operational runbook for the Supply Chain Hub. The application is a single Node.js process with a JSON datastore, so deployment is deliberately small: one container (or one systemd unit), one persistent volume, and an optional reverse proxy.

> **Fast path:** `docker compose up --build`, open <http://localhost:8080>. For production, add a volume, an `API_TOKEN`, TLS, and backups as described below.

---

## 1. Preflight checklist

| Item | Requirement |
| --- | --- |
| Node.js | 20.11+ (Docker image: 22-alpine) |
| Memory | 256 MB is comfortable; the process typically uses 50–90 MB |
| CPU | 1 vCPU is sufficient for the demo dataset |
| Disk | < 50 MB application + datastore; allow growth for audit history |
| Persistence | A volume mounted at `DATA_DIR`; without it, data resets on redeploy |
| Public ports | 8080 (or 80/443 through nginx) |
| Secrets | A long random `API_TOKEN` if the endpoint is internet-facing |
| Time | UTC on the host; timestamps are stored in ISO-8601 UTC |

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The UI stores the token only in the current tab's `sessionStorage`. It is never written to the datastore or logs.

---

## 2. Docker (recommended)

### Build

```bash
docker build -t supply-chain-hub:1.0.0 .
```

The image does **not** run `npm install`: runtime dependencies are empty and `public/assets/app.css` is committed.

### Run

Linux/macOS:

```bash
docker run -d \
  --name supply-chain-hub \
  --restart unless-stopped \
  -p 8080:8080 \
  -e API_TOKEN="$API_TOKEN" \
  -e NODE_ENV=production \
  -v supply-chain-hub-data:/data \
  --read-only \
  --tmpfs /tmp \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  supply-chain-hub:1.0.0
```

Windows PowerShell:

```powershell
$token = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker run -d --name supply-chain-hub --restart unless-stopped `
  -p 8080:8080 `
  -e API_TOKEN=$token `
  -e NODE_ENV=production `
  -v supply-chain-hub-data:/data `
  --read-only --tmpfs /tmp --cap-drop ALL `
  supply-chain-hub:1.0.0
```

`--read-only` is safe because the app writes only to `/data` (and Node's temp dir, provided by `--tmpfs /tmp`).

### Compose

```bash
cp .env.example .env       # edit API_TOKEN / HUB_PORT
docker compose up --build -d
docker compose ps
docker compose logs -f hub
```

The Compose file sets `read_only`, drops capabilities, adds `no-new-privileges`, and mounts a named volume.

### Verify

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/readyz
curl -fsS http://localhost:8080/metrics | head
```

Expected: `status: ok`, `status: ready`, and Prometheus counters. Then open the dashboard and enter the token via the key icon if one is configured.

---

## 3. VM / bare metal with systemd + nginx

### 3.1 Install

```bash
sudo useradd --system --home /opt/supply-chain-hub --shell /usr/sbin/nologin supplyhub
sudo mkdir -p /opt/supply-chain-hub /var/lib/supply-chain-hub
sudo rsync -a --exclude node_modules --exclude data --exclude .git ./ /opt/supply-chain-hub/
sudo chown -R supplyhub:supplyhub /opt/supply-chain-hub /var/lib/supply-chain-hub
sudo install -m 0640 -o root -g supplyhub deploy/supply-chain-hub.env /etc/supply-chain-hub.env
```

Edit `/etc/supply-chain-hub.env`:

- set a real `API_TOKEN`
- set `TRUST_PROXY=1`
- set `ENABLE_HSTS=1` only after TLS works
- keep `HOST=127.0.0.1` so Node is not exposed directly

### 3.2 Service

```bash
sudo cp deploy/supply-chain-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now supply-chain-hub
sudo systemctl status supply-chain-hub --no-pager
sudo journalctl -u supply-chain-hub -f
```

The unit runs as `supplyhub`, uses `ProtectSystem=strict`, and allows writes only to `/var/lib/supply-chain-hub`.

### 3.3 nginx + TLS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/supply-chain-hub
sudo ln -s /etc/nginx/sites-available/supply-chain-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Before reloading:

1. Replace `hub.example.com`.
2. Install certificates at the paths in the file (Certbot example below).
3. `location = /metrics` is restricted to private ranges; adjust to your Prometheus network.

Certbot example:

```bash
sudo certbot --nginx -d hub.example.com
```

HSTS is emitted by nginx. The app can also emit it with `ENABLE_HSTS=1`; do not enable both with different values.

### 3.4 Updates

```bash
sudo rsync -a --delete --exclude data --exclude node_modules ./ /opt/supply-chain-hub/
sudo systemctl restart supply-chain-hub
```

The datastore lives in `/var/lib/supply-chain-hub` and is untouched by deploy syncs.

---

## 4. Render

1. Push this directory to a Git repository.
2. In Render, choose **New → Blueprint** and point at the repository.
3. `render.yaml` creates a Docker web service, a 1 GB disk at `/data`, a generated `API_TOKEN`, and `TRUST_PROXY=1`.
4. Wait for the health check on `/healthz` to pass.
5. Open the service URL and paste the generated token (Render → Environment → `API_TOKEN`) into the key dialog.

The disk requires a paid instance type. Without a disk, the service still runs, but every deploy/restart reseeds from scratch.

---

## 5. Other platforms

| Platform | Notes |
| --- | --- |
| Fly.io | Build the Dockerfile; create a volume (`fly volumes create hub_data --size 1`) and mount it at `/data`; set `PORT=8080`, `DATA_DIR=/data`, `API_TOKEN`. |
| Railway | Dockerfile deploy; add a volume at `/data`; set the same env vars. |
| Kubernetes | Deployment + Service + PVC mounted at `/data`; probes `/healthz` and `/readyz`. Keep `replicas: 1` while using the JSON store. |
| Heroku | `Procfile` works, but the filesystem is ephemeral. Use a single dyno and accept reseeding, or replace the datastore first. |
| Static-only hosts | Not sufficient: the GraphQL API, auth, and datastore need Node. |

---

## 6. Persistence, backup, and restore

The datastore is one JSON file at `${DATA_DIR}/supply-chain.json`.

### Backup (Docker)

```bash
docker run --rm \
  -v supply-chain-hub-data:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/hub-$(date +%Y%m%d).tgz -C /data supply-chain.json
```

### Backup (VM)

```bash
sudo tar czf /var/backups/supply-chain-hub-$(date +%Y%m%d).tgz \
  -C /var/lib/supply-chain-hub supply-chain.json
```

### Restore

Stop the app first, replace the file, ensure ownership, then start:

```bash
docker compose stop hub
docker run --rm -v supply-chain-hub-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/supply-chain.json && tar xzf /backup/hub-YYYYMMDD.tgz -C /data"
docker compose start hub
```

The store writes with mode `0600`; keep the volume private.

### Reset the demo

```bash
node scripts/reset-data.mjs --yes
```

Stop the process first: the running server keeps its in-memory state and will overwrite the file on the next mutation. For containers:

```bash
docker compose stop hub
docker compose run --rm hub node scripts/reset-data.mjs --yes
docker compose start hub
```

---

## 7. Configuration matrix

| Variable | Production guidance |
| --- | --- |
| `NODE_ENV` | `production` (masks internal error details) |
| `API_TOKEN` | Required for internet-facing deployments; 32+ random bytes |
| `READ_ONLY` | `true` for public demos; `false` for operators |
| `ALLOWED_ORIGINS` | Empty when UI and API share an origin; otherwise list exact origins |
| `TRUST_PROXY` | `1` behind nginx/Render/Fly; `0` when directly exposed |
| `ENABLE_HSTS` | `1` only after HTTPS is verified end to end |
| `DATA_DIR` | Persistent mount; `/data` in containers |
| `LOG_LEVEL` | `info`; use `debug` only while diagnosing |
| `RATE_LIMIT_MAX` | 120/min per IP is a reasonable demo default |
| `MAX_QUERY_DEPTH` | 12; raise only with a complexity-budget review |
| `BODY_LIMIT_BYTES` | 262144; mutations are small |

---

## 8. Health, readiness, and observability

| Endpoint | Meaning | Suggested probe |
| --- | --- | --- |
| `/healthz` | Process is alive; no datastore check | Liveness, 30s interval |
| `/readyz` | Datastore is loaded; returns counts | Readiness, 10s interval, 3 failures |
| `/metrics` | Prometheus text counters, gauges, data counts | Scrape every 15–30s; restrict at the proxy |
| `/graphql` | API; POST only | Synthetic check with a known query |

Logs are one JSON object per line on stdout/stderr. Important `msg` values:

- `boot.start`, `boot.ready`, `boot.failed`
- `http.request` with method, path, status, duration, request ID
- `graphql.request` with operation name, duration, error count
- `graphql.resolver_error`, `http.unhandled_error`
- `shutdown.start`, `shutdown.complete`, `shutdown.forced`

`X-Request-Id` is returned on every response and echoed in GraphQL `extensions.requestId`.

### Example alert rules

- `up{job="supply-chain-hub"} == 0` for 2 minutes
- `rate(sch_http_requests_total{status=~"5.."}[5m]) > 0.05`
- `sch_graphql_errors_total{code="INTERNAL_SERVER_ERROR"}` increasing
- `sch_data_records{entity="orders"}` unexpectedly decreasing after a deploy
- `/readyz` failing while `/healthz` succeeds (volume or permissions problem)

---

## 9. Security hardening

Minimum for an internet-facing deployment:

1. Set `API_TOKEN` and serve only over HTTPS.
2. Put Node behind nginx/Caddy; bind `HOST=127.0.0.1`.
3. Set `TRUST_PROXY=1` only when the proxy overwrites `X-Forwarded-*`.
4. Set `ENABLE_HSTS=1` (or let nginx emit HSTS) after TLS verification.
5. Keep the CSP emitted by the app; do not add `'unsafe-inline'` to make a third-party widget work.
6. Run the container read-only with a writable `/data` volume and `/tmp` tmpfs.
7. Restrict `/metrics` to the monitoring network.
8. Back up the volume and test restores.
9. Rotate `API_TOKEN` by updating the env var and restarting.
10. For per-user accountability, put an OIDC proxy (e.g. oauth2-proxy) in front; the app currently has one shared token, not RBAC.

See [SECURITY.md](SECURITY.md) for the full threat model.

---

## 10. Scaling and high availability

Current design: **one writer process**. The in-memory state is authoritative and writes atomically replace one JSON file. This is intentional for a zero-dependency demo and is safe for one instance.

Do **not** run multiple replicas against the same volume. You will get lost updates and corrupted reads.

To scale horizontally:

1. Replace `JsonStore`/`createRepository` with a PostgreSQL adapter (orders, lines, shipments, trace events as tables or JSONB).
2. Keep the GraphQL schema and resolvers; the repository interface is the seam.
3. Move rate limiting to the edge (nginx `limit_req` or Redis).
4. Move the shared bearer token to an identity provider; add per-user authorization.
5. Add a read replica for dashboards and a queue/outbox for ERP integration.
6. Then run multiple stateless replicas behind a load balancer.

The UI and API are otherwise stateless: no sessions, no cookies, no server-side uploads.

---

## 11. Rollback

### Docker

```bash
docker compose down
docker tag supply-chain-hub:previous supply-chain-hub:1.0.0
docker compose up -d
```

Keep the previous image tag and a datastore backup from before the deploy. The seeded schema version is `1`; a future incompatible shape should ship a migration and bump `SEED_VERSION`.

### systemd

```bash
sudo systemctl stop supply-chain-hub
sudo rsync -a --delete --exclude data /opt/supply-chain-hub.previous/ /opt/supply-chain-hub/
sudo systemctl start supply-chain-hub
```

If a release changed persisted fields, restore the matching datastore backup before starting.

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `EADDRINUSE` | Port already in use | Change `PORT`; stop the other process |
| `/readyz` returns 503 | Datastore missing or unreadable | Check `DATA_DIR`, volume mount, ownership |
| Dashboard shows “API offline” | Health fetch failing | `curl /healthz`; check proxy and CSP |
| 401 on every query | `API_TOKEN` set but token missing/wrong | Enter token via key icon; verify exact value |
| 403 CORS | UI/API on different origins | Set `ALLOWED_ORIGINS` to the exact UI origin |
| 429 | Rate limit | Raise `RATE_LIMIT_MAX` or wait for `Retry-After` |
| Data resets after deploy | No persistent volume | Mount `/data` (or `DATA_DIR`) |
| Writes fail `EACCES` | Volume owned by root, process non-root | `chown -R app:app /data` (Docker) / `supplyhub` (VM) |
| CSS looks unstyled | `public/assets/app.css` missing | Rebuild with `npm run build:css` or restore the committed file |
| Microfrontend cache stale | Manifest version not bumped | Bump `public/js/microfrontends/manifest.json` `version` on release |
| One chain shows “exception” | Intentional seeded tamper | Expected; inspect the broken event in Traceability |

---

## 13. Release checklist

- [ ] `npm ci && npm run build:css` produces no diff in `public/assets/app.css`
- [ ] `npm test`, `npm run a11y`, `npm run smoke` pass
- [ ] `docker build` succeeds and the image runs as non-root
- [ ] `/healthz` and `/readyz` pass in the target environment
- [ ] `API_TOKEN` is set and stored in the platform secret manager
- [ ] Volume mounted and a backup/restore has been tested
- [ ] TLS, HSTS, and `TRUST_PROXY` match the topology
- [ ] `/metrics` is scrapeable and restricted
- [ ] `DATA_DIR` is not on an ephemeral filesystem
- [ ] Rollback image tag and datastore backup are recorded
