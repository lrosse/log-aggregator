# Log Aggregator

[![CI](https://github.com/lrosse/log-aggregator/actions/workflows/ci.yml/badge.svg)](https://github.com/lrosse/log-aggregator/actions/workflows/ci.yml)

**A little signal in the noise.** A focused observability workbench for collecting and investigating logs across services.

When a request crosses an API gateway, an identity provider, a payment service and a worker, opening four terminals is a poor debugging workflow. Log Aggregator gives those services one HTTP ingestion endpoint and one searchable timeline, backed by PostgreSQL.

![Log explorer showing generated service logs](docs/dashboard.jpg)

## Run in one command

Prerequisites: Docker Engine/Desktop with Linux containers and Docker Compose v2 or newer. Node.js is **not** required to run the containers.

```sh
git clone https://github.com/lrosse/log-aggregator.git
cd log-aggregator
docker compose up --build
```

The spelling `docker-compose up --build` also works when the Compose compatibility executable is installed. The first run downloads images and installs dependencies. No manual database setup or `.env` file is required.

| Service    | Address                                               | Purpose                                |
| ---------- | ----------------------------------------------------- | -------------------------------------- |
| Dashboard  | [localhost:3000](http://localhost:3000)               | React served by unprivileged nginx     |
| HTTP API   | [localhost:3001/health](http://localhost:3001/health) | Ingestion, queries and readiness       |
| PostgreSQL | Docker network only, port 5432                        | Durable storage; no host port conflict |
| Generator  | No exposed port                                       | Synthetic events from four services    |

Wait for the services to become healthy, then open the dashboard. The generator produces one event roughly every 650 ms, cycling through `api-gateway`, `auth-service`, `payments` and `worker-queue`. These are deliberately synthetic logs, not external production data.

```sh
docker compose up --build -d --wait  # Background mode with readiness checks
docker compose ps                  # All four services should be healthy
docker compose logs -f backend     # Inspect backend operational logs
docker compose stop generator      # Stop synthetic traffic
docker compose start generator     # Resume synthetic traffic
docker compose down                # Stop containers; preserve stored logs
```

`docker compose down -v` also deletes this project's database volume. Use it only when you intend to discard all collected logs.

## Explore the logs

- Combine service, severity (`info`, `warn`, `error`) and message text filters.
- Search uses a case-insensitive **literal substring**; `%` and `_` are not search operators.
- Click a message or its chevron to inspect the full event and copy its JSON.
- Click a severity summary or a sidebar service to filter.
- Press `/` to focus search; Escape closes the inspector.
- Metrics describe the **displayed window**, not total database volume.
- Event timestamps are displayed in UTC. Ordering uses the ingestion ID, so delayed events appear at the top.

Live mode updates automatically through Socket.io. **Pause live** freezes the view for investigation; **Older** and **Newer** navigate 100-event cursor pages. Paging automatically pauses streaming. **Resume live** returns to the latest page and catches up. Changing filters resets the page history.

New workspaces show first-log instructions; a loading indicator stays visible until the initial fetch completes. At tablet widths, metrics use two columns and the table scrolls horizontally inside its own region. Filters and ingestion instructions remain available when the sidebar is hidden. See the [768 px dashboard](docs/dashboard-tablet.jpg) and [empty workspace](docs/empty-state-tablet.jpg).

The Docker MVP is preserved at tag [`v0.1.0`](https://github.com/lrosse/log-aggregator/tree/v0.1.0). Streaming and pagination were added only after that milestone was running, browser-verified and committed.

## Architecture

```mermaid
flowchart LR
  G[TypeScript generator] -->|POST /logs| A[Express API]
  S[Your services] -->|POST /logs| A
  A -->|Parameterized SQL| P[(PostgreSQL)]
  B[React dashboard] -->|Same-origin /api| N[nginx]
  N --> A
  A -->|Socket.io notification via nginx| B
```

| Layer     | Stack                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| Backend   | Node.js 24 LTS, TypeScript 5.9, Express 5, Zod, node-postgres, Helmet            |
| Database  | PostgreSQL 17, SQL migrations, `pg_trgm`                                         |
| Real-time | Socket.io 4, WebSocket upgrade through nginx, reconnect reconciliation           |
| Frontend  | React 19, TypeScript, Vite, custom CSS, Lucide icons, self-hosted IBM Plex fonts |
| Runtime   | Multi-stage Docker builds, Docker Compose, unprivileged nginx                    |
| Quality   | ESLint 10, Prettier, Vitest, Supertest, React Testing Library, GitHub Actions    |

### Decisions and tradeoffs

- **Small npm workspace monorepo.** API, dashboard and generator have separate builds without an extra orchestration framework. TypeScript 5.9 is retained for lint-toolchain compatibility.
- **PostgreSQL instead of a search cluster.** Relational storage is sufficient for a portfolio workload and simple to operate. Composite service/ID and level/ID indexes support filters; a trigram GIN index supports substring search. Short searches may still scan many rows.
- **Migrate before readiness.** Ordered SQL migrations execute in a transaction protected by an advisory lock. A named volume persists data. Health checks and `service_healthy` dependencies prevent startup races; see [Docker's startup-order documentation](https://docs.docker.com/compose/how-tos/startup-order/).
- **Acknowledge after persistence.** `201 Created` means the insert succeeded. The sender supplies event time; PostgreSQL records `receivedAt`. IDs are strings to avoid JavaScript integer precision loss.
- **Socket.io rather than periodic polling.** A persisted insert sends a lightweight `logs:created` notification containing its ID. The browser coalesces notifications for 350 ms and serializes HTTP reads to avoid overlapping requests. PostgreSQL remains the authority for filters; inactive sources do not cause a polling loop. Socket.io reconnects automatically, and each connection/resume reloads the latest matching window. Notifications are not durable or guaranteed; see [Socket.io delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/). Older missed records remain available through pagination, not an unlimited in-memory replay.
- **Keyset rather than offset pagination.** `before=<id>` queries use `logs.id < cursor` and numeric descending order. New arrivals do not shift older pages. This is not a transactionally frozen database snapshot, and multiple backend replicas would require shared notification fanout.
- **Same-origin browser traffic.** nginx forwards `/api` to the backend without permissive CORS. Docker DNS is re-resolved so the proxy survives backend container recreation.
- **Dense, restrained UI.** Charcoal/olive neutrals, amber accents, semantic severity colors, compact rows, a native keyboard-accessible dialog and locally served typography. No external fonts or analytics requests.
- **Local exposure.** Published ports bind to `127.0.0.1`; PostgreSQL has no host port. Backend, generator and nginx processes run without root privileges.

## HTTP contract

### Ingest

```sh
curl -X POST http://localhost:3001/logs \
  -H 'Content-Type: application/json' \
  -d '{"service":"payments","level":"error","message":"Payment gateway timeout","timestamp":"2026-08-26T12:00:00Z"}'
```

PowerShell:

```powershell
$event = @{
  service = 'payments'
  level = 'info'
  message = 'Payment authorized'
  timestamp = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3001/logs -Method Post -ContentType 'application/json' -Body $event
```

| Required field | Rules                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| `service`      | 1–80 characters; starts with a letter/digit, then letters/digits/dot/underscore/hyphen |
| `level`        | `info`, `warn` or `error`                                                              |
| `message`      | Nonblank, up to 8,000 characters; outer whitespace is trimmed                          |
| `timestamp`    | ISO 8601 with `Z` or an explicit timezone offset                                       |

Unknown fields and invalid input return `400`; non-JSON content returns `415`; bodies over 16 KiB return `413`. The proxy may return its own oversized-request error body. Errors do not expose database details or submitted payloads.

### Query

```http
GET /logs?service=payments&level=error&q=timeout&limit=50
```

Filters are optional and combined with AND. `limit` defaults to 100 and accepts integers from 1 to 200. Responses contain `{ "logs": [...], "nextCursor": "123" }`, newest ingestion first. Request the next page with `before=123`, keeping the same filters and limit. `nextCursor: null` means there are no older matching records. Cursors are positive PostgreSQL BIGINT strings, never floating-point numbers. Each record adds string `id` and UTC `receivedAt` to the input fields. SQL parameters and escaped LIKE metacharacters protect search queries.

`GET /services` returns `{ "services": ["api-gateway", ...] }` alphabetically.

### Health check

`GET /health` returns **200** with `{ "status": "ok", "db": "connected" }` only after a PostgreSQL query confirms the migrated logs table is reachable. An empty table is healthy. If the database is unavailable, it returns **503** with `{ "status": "unavailable", "db": "disconnected" }`, without connection details. Responses use `Cache-Control: no-store`.

Use [localhost:3001/health](http://localhost:3001/health) directly or `/api/health` through the dashboard's nginx proxy. Docker Compose uses this readiness endpoint to coordinate startup and monitor the API.

### Ingestion rate limit

`POST /logs` accepts up to **600 requests per 60-second window per backend process**, shared by all senders, including the demo generator. Direct API traffic and nginx `/api/logs` traffic consume the same budget; changing IP or forwarded headers cannot create a new allowance. All ingestion attempts count, including invalid payloads, and limiting runs before JSON parsing. Read endpoints and `/health` are not limited.

Excess requests return **429** with a JSON `error` and `Retry-After` in seconds. Ingestion responses expose `RateLimit` and `RateLimit-Policy` headers. Wait for the indicated interval before retrying. The default generator sends roughly 92 events per minute, leaving room for manual ingestion and smoke tests.

The [express-rate-limit middleware](https://express-rate-limit.mintlify.app/reference/configuration) uses an in-memory counter that resets on process restart. This is a basic storage safeguard, not a per-tenant quota or DDoS defense: one sender can consume the shared allowance. Multiple replicas would need a shared store and a deliberate global/per-client policy.

## Configuration

Copy `.env.example` to `.env` only to change defaults. Compose reads it automatically; Git ignores it.

| Variable                | Default               | Meaning                                |
| ----------------------- | --------------------- | -------------------------------------- |
| `WEB_PORT`              | `3000`                | Local dashboard port                   |
| `API_PORT`              | `3001`                | Local API port                         |
| `POSTGRES_PASSWORD`     | `local-demo-password` | Demo password; use URL-safe characters |
| `GENERATOR_INTERVAL_MS` | `650`                 | Delay between events, 100–60,000 ms    |

Compose supplies backend `DATABASE_URL`/`PORT` and generator `API_URL`. No secrets are compiled into the frontend. Changing the password after database initialization does not change the stored PostgreSQL role; update it explicitly or intentionally recreate a disposable volume.

Compose also sets `ALLOWED_ORIGINS` for Socket.io to the configured local dashboard port and the Vite development port. Non-browser clients may omit `Origin`; unlisted browser origins are rejected at the handshake. For a backend run outside Compose, configure this comma-separated origin list yourself if needed. An origin allowlist is not authentication.

## Development and verification

For host-side checks, install Node.js 24 and npm:

```sh
npm ci
npm run check          # ESLint + unit/component tests + all production builds
npm run format:check
docker compose up --build -d --wait
npm run smoke          # Real PostgreSQL + HTTP + nginx + generated services
```

The smoke test inserts marked synthetic events into the existing demo services and never deletes data. Set `SMOKE_API_URL`/`SMOKE_WEB_URL` for custom ports.

See the [verification record](docs/verification.md) for the browser, persistence and restart checks and the limits of what was tested.

The automated tests cover ingest validation, malformed/oversized requests, rate-limit enforcement and window renewal, safe errors, database readiness, SQL parameters, literal search, cursor bounds, actual WebSocket delivery/origin rejection, combined UI filters, first-log guidance, loading states, empty results, retry, live updates, reconnect reconciliation, stale-request cancellation, pagination resets and deterministic generator scenarios. The smoke test checks real persistence, combined filters, timestamp normalization, ordering across numeric ID boundaries, pagination during new arrivals, all four generated services, health responses, rate-limit headers, page metadata, the favicon and Socket.io over the nginx WebSocket proxy. CI repeats formatting, lint, tests, builds and Compose smoke checks on a clean Linux runner.

For frontend hot reload, keep the Compose API on port 3001 and run `npm run dev -w @log-aggregator/frontend`, then open [localhost:5173](http://localhost:5173). Vite proxies `/api` to the backend. For backend-only development, set `DATABASE_URL` to your development PostgreSQL instance and run `npm run dev -w @log-aggregator/backend`; migrations run on startup.

## Scope and production considerations

This is a portfolio project, **not a production log platform**. It has basic ingestion rate limiting but no authentication, tenant isolation, redaction, retention policy, durable queue or high availability. Do not send real secrets or sensitive production logs, and do not expose it publicly. Storage grows until you remove events or recreate the volume. HTTP retries can create duplicates; ingestion does not claim exactly-once delivery. A production evolution would add authentication/TLS, tenant quotas, retention partitions, idempotency, backups, monitoring and load testing.

The generator favors readable scenarios over throughput benchmarking and backs off when ingestion fails. Its four source names are simulations, not four additional application containers.
