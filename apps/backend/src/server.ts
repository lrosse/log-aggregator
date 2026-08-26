import pg from 'pg';
import { z } from 'zod';
import { createHttpServer } from './http.js';
import { migrate } from './migrate.js';
import { createRepository } from './repository.js';

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'),
  })
  .parse(process.env);
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
pool.on('error', () => {
  console.error(JSON.stringify({ event: 'database_connection_error' }));
});

try {
  await migrate(pool);
  const { server, io } = createHttpServer(
    createRepository(pool),
    config.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
  );
  server.listen(config.PORT, '0.0.0.0', () => {
    console.info(JSON.stringify({ event: 'listening', port: config.PORT }));
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    void io.close(() => {
      void pool.end().then(() => {
        clearTimeout(timeout);
      });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  console.error(
    JSON.stringify({ event: 'startup_failed', type: error instanceof Error ? error.name : 'UnknownError' }),
  );
  await pool.end();
  process.exitCode = 1;
}
