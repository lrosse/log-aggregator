import { createServer } from 'node:http';
import pg from 'pg';
import { z } from 'zod';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { createRepository } from './repository.js';

const config = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
}).parse(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
pool.on('error', () => { console.error(JSON.stringify({ event: 'database_connection_error' })); });

try {
  await migrate(pool);
  const server = createServer(createApp(createRepository(pool)));
  server.listen(config.PORT, '0.0.0.0', () => { console.info(JSON.stringify({ event: 'listening', port: config.PORT })); });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(() => { void pool.end().then(() => { clearTimeout(timeout); }); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  console.error(JSON.stringify({ event: 'startup_failed', type: error instanceof Error ? error.name : 'UnknownError' }));
  await pool.end();
  process.exitCode = 1;
}
