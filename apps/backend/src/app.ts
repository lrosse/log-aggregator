import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { LogRecord, LogRepository } from './types.js';
import { logFilterSchema, logInputSchema } from './validation.js';

export function createApp(
  repository: LogRepository,
  onStored: (log: LogRecord) => void = () => {},
  ingestionPolicy = { windowMs: 60_000, limit: 600 },
) {
  const app = express();
  const ingestionLimiter = rateLimit({
    windowMs: ingestionPolicy.windowMs,
    limit: ingestionPolicy.limit,
    // One process-wide budget protects storage through both direct HTTP and nginx.
    // Never use untrusted forwarded IP headers to create fresh quota buckets.
    keyGenerator: () => 'logs-ingestion',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Ingestion rate limit exceeded. Retry after the Retry-After interval.' },
  });
  app.disable('x-powered-by');
  app.use(helmet());
  app.get('/health', async (_request, response) => {
    const healthy = await repository.healthy();
    response
      .set('Cache-Control', 'no-store')
      .status(healthy ? 200 : 503)
      .json({ status: healthy ? 'ok' : 'unavailable', db: healthy ? 'connected' : 'disconnected' });
  });
  app.post('/logs', ingestionLimiter, express.json({ limit: '16kb' }), async (request, response) => {
    if (!request.is('application/json')) {
      response.status(415).json({ error: 'Content-Type must be application/json' });
      return;
    }
    const input = logInputSchema.parse(request.body);
    const log = await repository.insert(input);
    onStored(log);
    response.status(201).json(log);
  });
  app.get('/logs', async (request, response) => {
    const filter = logFilterSchema.parse(request.query);
    const rows = await repository.list({ ...filter, limit: filter.limit + 1 });
    const logs = rows.slice(0, filter.limit);
    response.json({ logs, nextCursor: rows.length > filter.limit ? logs.at(-1)!.id : null });
  });
  app.get('/services', async (_request, response) => {
    response.json({ services: await repository.services() });
  });
  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: 'Validation failed',
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      });
      return;
    }
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) {
      response.status(status).json({ error: status === 413 ? 'Payload too large' : 'Invalid JSON body' });
      return;
    }
    // Never log request bodies: logs submitted by users may contain sensitive data.
    console.error(
      JSON.stringify({ event: 'request_failed', type: error instanceof Error ? error.name : 'UnknownError' }),
    );
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errors);
  return app;
}
