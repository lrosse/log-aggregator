# Log Aggregator

A focused observability workbench for collecting and investigating logs from multiple services.

## Implementation plan

1. Typed HTTP ingestion and PostgreSQL storage, with validation and tests.
2. A compact React dashboard with service, severity and text filters.
3. A four-service Docker Compose stack, including a synthetic log producer.
4. Only after the Docker MVP is verified: Socket.io streaming and cursor pagination.

## Decisions

- npm workspaces keep the backend, dashboard and generator together without an extra monorepo build system.
- Node.js 24 LTS and strict TypeScript provide a common runtime and type checking.
- TypeScript 5.9 is deliberately retained for compatibility with the lint toolchain.
- The project targets a local Docker deployment; no hosted platform or substitute database is used.

Setup and verification instructions will be added as each runnable component lands.
