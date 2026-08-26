import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import type { LogRecord, LogRepository } from './types.js';

const input = {
  service: 'payments',
  level: 'error' as const,
  message: 'Payment timeout',
  timestamp: '2026-08-26T10:00:00Z',
};
const record: LogRecord = { ...input, id: '1', receivedAt: input.timestamp };
const repository: LogRepository = { insert: vi.fn(), list: vi.fn(), services: vi.fn(), healthy: vi.fn() };
const app = createApp(repository);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repository.insert).mockResolvedValue(record);
  vi.mocked(repository.list).mockResolvedValue([record]);
  vi.mocked(repository.healthy).mockResolvedValue(true);
  vi.mocked(repository.services).mockResolvedValue(['payments']);
});

describe('POST /logs', () => {
  it('validates and persists a log before acknowledging it', async () => {
    const response = await request(app).post('/logs').send(input);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(record);
    expect(repository.insert).toHaveBeenCalledWith(input);
  });
  it.each([
    { level: 'debug' },
    { message: '' },
    { message: 'x'.repeat(8001) },
    { timestamp: 'yesterday' },
    { timestamp: '2026-08-26' },
    { service: '../invalid' },
    { extra: true },
  ])('rejects invalid input: %j', async (change) => {
    expect(
      (
        await request(app)
          .post('/logs')
          .send({ ...input, ...change })
      ).status,
    ).toBe(400);
    expect(repository.insert).not.toHaveBeenCalled();
  });
  it('rejects non-JSON, malformed JSON and oversized bodies', async () => {
    expect((await request(app).post('/logs').type('text').send('hello')).status).toBe(415);
    expect((await request(app).post('/logs').type('json').send('{broken')).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/logs')
          .send({ ...input, message: 'x'.repeat(20000) })
      ).status,
    ).toBe(413);
  });
  it('does not expose database errors', async () => {
    vi.mocked(repository.insert).mockRejectedValueOnce(new Error('secret database URL'));
    const response = await request(app).post('/logs').send(input);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });
});

describe('read API', () => {
  it('combines filters and caps the requested window', async () => {
    const response = await request(app)
      .get('/logs')
      .query({ service: 'payments', level: 'error', q: 'timeout', limit: 25 });
    expect(response.status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith({
      service: 'payments',
      level: 'error',
      q: 'timeout',
      limit: 25,
    });
    expect(response.body.logs).toEqual([record]);
  });
  it.each(['limit=0', 'limit=201', 'limit=no', 'level=debug', 'level=info&level=error', 'unknown=1'])(
    'rejects invalid query %s',
    async (query) => {
      expect((await request(app).get(`/logs?${query}`)).status).toBe(400);
      expect(repository.list).not.toHaveBeenCalled();
    },
  );
  it('lists services and reports unavailable storage', async () => {
    expect((await request(app).get('/services')).body).toEqual({ services: ['payments'] });
    expect((await request(app).get('/health')).status).toBe(200);
    vi.mocked(repository.healthy).mockResolvedValue(false);
    expect((await request(app).get('/health')).status).toBe(503);
  });
});
