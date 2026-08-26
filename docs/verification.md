# Verification record

Verified on 2026-08-26. All sample events are synthetic.

## Automated checks

- `npm run check`: ESLint, 47 Vitest tests and all three workspace builds pass.
- `npm run format:check`: source and documentation formatting pass.
- `npm audit --audit-level=high`: no known dependency vulnerabilities reported at verification time.
- `docker compose up --build -d --wait`: database, backend, frontend and generator become healthy without a pre-existing project database or an `.env` file.
- `npm run smoke`: HTTP validation, persisted PostgreSQL filters, literal substring search, UTC normalization, numeric ID ordering, cursor pages during concurrent arrivals, all four generator sources, nginx API proxy and Socket.io WebSocket notification pass.
- GitHub Actions runs these checks (except the dependency audit) on a clean Linux runner. The [workflow history](https://github.com/lrosse/log-aggregator/actions/workflows/ci.yml) records each pushed revision.

## Browser checks against the Docker stack

- Four generated services are present and logs are visible.
- Service, severity and text filters work together; no-match searches show a recoverable empty state.
- Event details and the ingestion reference open and close correctly.
- With a service/severity/text filter active, a newly ingested event appears without reloading the page.
- Pausing hides subsequent arrivals; resuming fetches them.
- Older-page navigation returns another 100 rows with no ID overlap with the first page and pauses streaming.
- The browser reconnects and resumes displaying events after restarting the backend.
- Narrow (390 px) and desktop (1440 px) layouts were inspected. On narrow screens, the table scrolls horizontally while filters remain available.

## Persistence and restart

Two uniquely marked events were queried before and after restarting the database and backend. Both remained stored. The generator resumed ingestion and all four containers returned to healthy status. A restart can briefly return a proxy 502 until DNS/connections recover; the smoke script gives readiness up to 20 seconds before running its assertions. In live mode, the browser reconnects and refreshes; in paused mode, use Refresh if a manual read coincides with an outage.

## Milestones

- `v0.1.0`: Docker MVP, filters, generator, tests and README screenshot; verified before beginning real-time work.
- Subsequent commits: cursor pagination, Socket.io, pause/resume, reconnection and additional regression tests.

## Not claimed

No throughput benchmark, production security review, multi-replica delivery, load test, retention policy or exactly-once ingestion guarantee. The chart over time was optional and is not implemented; severity bars summarize only the visible page.
