# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |

## Reporting a vulnerability

Open a private security advisory in the repository or contact the deployment owner directly. Do not file a public issue for vulnerabilities involving authentication bypass, injection, or datastore exposure. Include reproduction steps, affected endpoint, and impact.

---

## Threat model

The app is a single-tenant operations console with an optional shared bearer token. It is not a multi-tenant SaaS and does not provide per-user accounts. The relevant threats are:

1. Unauthenticated internet access to order and traceability mutations.
2. Injection through GraphQL arguments, order notes, supplier names, or product data.
3. Stored/reflected XSS in the vanilla-JS UI.
4. Path traversal or file disclosure through the static server.
5. Denial of service through large or deeply nested GraphQL documents.
6. Secret leakage through logs, health output, or error responses.
7. Datastore tampering (detected, not prevented, by the hash chain).
8. Lost updates from running multiple writers against one JSON file.

## Controls in this codebase

| Area | Control |
| --- | --- |
| Transport | HSTS opt-in (`ENABLE_HSTS`); TLS expected at the proxy; no mixed-content resources |
| Authentication | Optional 32+ byte bearer token; constant-time comparison; `WWW-Authenticate` on 401; UI stores token in `sessionStorage`, not `localStorage` |
| Authorization | `READ_ONLY` mode disables all mutations; there is no RBAC |
| CSRF | Bearer token in an explicit header, no cookies, no credential-less state changes |
| XSS | All API-derived markup is escaped by the `html` tagged template; no untrusted `innerHTML`; CSP forbids inline script and style |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Referrer leakage | `strict-origin-when-cross-origin` |
| Browser capabilities | `Permissions-Policy` disables camera, microphone, geolocation, payment, USB |
| CORS | Same-origin by default; explicit allow-list; preflight capped at 600s |
| GraphQL DoS | Depth/field limits, 60 KB query cap, 256 KB body cap, 120 req/min/IP default |
| Static files | Resolve-under-`public/` check, MIME allow-list, no directory listing/execution |
| Input validation | Types, lengths, enums, numeric bounds, state-machine transitions, ownership checks (product must belong to supplier) |
| Error leakage | Production masks unexpected resolver messages; stack traces only in logs |
| Logging | Structured JSON lines; request bodies, tokens, and headers are not logged |
| Dependencies | Zero runtime dependencies; Tailwind is dev-only; CI builds from a lockfile |
| Supply chain | No CDN, fonts, analytics, or third-party scripts at runtime; committed CSS |
| Persistence | File mode `0600`, atomic rename; container runs read-only except `/data` and `/tmp` |

## Residual risks and non-goals

- **Shared token, not identity.** Anyone with the token is an operator. There is no audit trail of *which person* changed an order. Put the app behind an OIDC proxy or add JWT claims before using it with multiple operators.
- **Metrics, readiness, and schema are public.** `/metrics` exposes operational counts and `/readyz` exposes dataset counts. Restrict them at the proxy if that is sensitive in your environment.
- **Rate limits are per-process.** Multiple replicas need edge or Redis-based limits.
- **JSON single writer.** Do not mount one volume into several replicas. Use PostgreSQL before scaling out.
- **Hash chain is tamper-evident, not immutable.** An attacker with full datastore write access can recompute every hash. Anchor chain heads in WORM storage or sign them if that threat matters.
- **No malware scanning.** Uploads are not supported.
- **No password policy / MFA.** The shared token must be generated and rotated in a secret manager.
- **Client-side rendering** means data is only visible after JavaScript executes; the API itself is the source of truth.
- **CSP uses `style-src 'self'`**, so adding inline style attributes or third-party CSS will break. Keep styling in Tailwind/compiled CSS.

## Deployment responsibilities

1. Serve over TLS; enable HSTS after verification.
2. Set `API_TOKEN` to a long random value; rotate on personnel changes.
3. Bind Node to loopback behind a reverse proxy and set `TRUST_PROXY=1`.
4. Keep the data volume private; back it up; test restores.
5. Restrict `/metrics` and `/readyz` to monitoring networks.
6. Run the container as non-root with a read-only root filesystem and a writable `/data`.
7. Review CSP reports/logs if you add any third-party integration.
8. Apply Node.js security updates by rebuilding the image.
9. Use `READ_ONLY=true` for public demos.
10. If exposing writes, add per-user authentication and authorization first.

## Security verification performed

- Integration tests for 401/403/404/413/415/429, CORS allow/deny, path traversal, read-only mutations, and oversized bodies.
- Manual review of all HTML template interpolations.
- Headless browser run with console/exception capture across create, update, and append flows.
- CSP verified in the browser; no inline scripts or styles.
- No runtime npm dependencies; `npm ci` is only needed to rebuild CSS.

## Dependency policy

- Runtime: none. Node built-ins only.
- Build: one dev dependency (`tailwindcss`), pinned via `package-lock.json`.
- Additions must be justified; a new runtime dependency requires a security review and lockfile update.
