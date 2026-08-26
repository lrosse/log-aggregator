import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { LogRepository } from './types.js';
import { logFilterSchema, logInputSchema } from './validation.js';

export function createApp(repository: LogRepository) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', async (_request, response) => {
    const healthy = await repository.healthy();
    response.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unavailable' });
  });
  app.post('/logs', async (request, response) => {
    if (!request.is('application/json')) {
      response.status(415).json({ error: 'Content-Type must be application/json' });
      return;
    }
    const input = logInputSchema.parse(request.body);
    const log = await repository.insert(input);
    response.status(201).json(log);
  });
  app.get('/logs', async (request, response) => {
    const filter = logFilterSchema.parse(request.query);
    const logs = await repository.list(filter);
    response.json({ logs });
  });
  app.get('/services', async (_request, response) => {
    response.json({ services: await repository.services() });
  });
  app.use((_request, response) => { response.status(404).json({ error: 'Not found' }); });
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: 'Validation failed', issues: error.issues.map(({ path, message }) => ({ path, message })) });
      return;
    }
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) {
      response.status(status).json({ error: status === 413 ? 'Payload too large' : 'Invalid JSON body' });
      return;
    }
    // Never log request bodies: logs submitted by users may contain sensitive data.
    console.error(JSON.stringify({ event: 'request_failed', type: error instanceof Error ? error.name : 'UnknownError' }));
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errors);
  return app;
}
