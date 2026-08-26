# Verification record

Verified on 2026-08-26. All sample events are synthetic.

## Automated checks

- `npm run check`: ESLint, 59 Vitest tests and all three workspace builds pass.
- `npm run format:check`: source and documentation formatting pass.
- `npm audit --audit-level=high`: no known dependency vulnerabilities reported at verification time.
- `docker compose up --build -d --wait`: database, backend, frontend and generator become healthy without a pre-existing project database or an `.env` file.
- `npm run smoke`: HTTP validation, persisted PostgreSQL filters, literal substring search, UTC normalization, numeric ID ordering, cursor pages during concurrent arrivals, all four generator sources, explicit API/database health, ingestion quota headers, favicon, sharing metadata, nginx API proxy and Socket.io WebSocket notification pass.
- GitHub Actions runs these checks (except the dependency audit) on a clean Linux runner. The [workflow history](https://github.com/lrosse/log-aggregator/actions/workflows/ci.yml) records each pushed revision.

## Browser checks against the Docker stack

- Four generated services are present and logs are visible.
- Service, severity and text filters work together; no-match searches show a recoverable empty state.
- Event details and the ingestion reference open and close correctly.
- With a service/severity/text filter active, a newly ingested event appears without reloading the page.
- Pausing hides subsequent arrivals; resuming fetches them.
- Older-page navigation returns another 100 rows with no ID overlap with the first page and pauses streaming.
- The browser reconnects and resumes displaying events after restarting the backend.
- Layouts were inspected at 390, 768, 820, 1024 and 1440 px. Document scroll width matched the client width, with no page-level horizontal overflow. Metrics use two columns through 1100 px; the sidebar is hidden through 960 px, with ingestion instructions still available above the dashboard.
- A populated table keeps a 770 px minimum width and scrolls horizontally inside its focusable region. A horizontal gesture at 768 px moved the table while the document stayed at horizontal offset zero. Panel actions and filters wrap on narrow screens.
- A fresh empty database first showed the loading region, then first-log guidance. Its button opened and closed the existing ingestion reference. A no-match search showed a distinct filtered-empty state and Clear filters restored the events.
- Updated screenshots: [desktop](dashboard.jpg), [768 px tablet](dashboard-tablet.jpg), [empty tablet workspace](empty-state-tablet.jpg).

## Polish-session integration checks

A separate Compose project, `log-aggregator-polish-check`, used ports 3100/3101 and a newly created database volume. No `.env` file was present. The database, API and frontend started first for the empty-state check; adding the generator brought all four containers to healthy status, and the complete smoke test passed.

Before starting the generator, 601 malformed ingestion attempts alternated between the direct API and nginx proxy with changing forwarded IP headers. The first 600 returned 400; request 601 returned 429 with a positive `Retry-After`. The database remained empty, and query/health endpoints stayed available. This checks quota enforcement, not throughput or DDoS resistance.

Stopping that isolated PostgreSQL container produced `503 { "status": "unavailable", "db": "disconnected" }`. Restarting it restored readiness. Unit tests additionally verify window renewal, rejected requests not being persisted/broadcast, and health success with an empty table.

The original Compose stack was then rebuilt and passed the smoke test with all four services healthy, preserving its existing database volume. Only the temporary project's containers, network and new volume were removed after verification.

## Persistence and restart

Two uniquely marked events were queried before and after restarting the database and backend. Both remained stored. The generator resumed ingestion and all four containers returned to healthy status. A restart can briefly return a proxy 502 until DNS/connections recover; the smoke script gives readiness up to 20 seconds before running its assertions. In live mode, the browser reconnects and refreshes; in paused mode, use Refresh if a manual read coincides with an outage.

## Milestones

- `v0.1.0`: Docker MVP, filters, generator, tests and README screenshot; verified before beginning real-time work.
- Subsequent commits: cursor pagination, Socket.io, pause/resume, reconnection and additional regression tests.

## Not claimed

No throughput benchmark, production security review, multi-replica delivery, load test, retention policy or exactly-once ingestion guarantee. The chart over time was optional and is not implemented; severity bars summarize only the visible page.
