import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import type { LogRecord, LogRepository } from './types.js';
import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import { createHttpServer } from './http.js';

const input = {
  service: 'payments',
  level: 'error' as const,
  message: 'Payment timeout',
  timestamp: '2026-08-26T10:00:00Z',
};
const record: LogRecord = { ...input, id: '1', receivedAt: input.timestamp };
const repository: LogRepository = { insert: vi.fn(), list: vi.fn(), services: vi.fn(), healthy: vi.fn() };
const onStored = vi.fn();
const app = createApp(repository, onStored);

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
    expect(onStored).toHaveBeenCalledWith(record);
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
    expect(onStored).not.toHaveBeenCalled();
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
      limit: 26,
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
  it('uses one extra row to return a stable older-page cursor', async () => {
    vi.mocked(repository.list).mockResolvedValue([
      { ...record, id: '9' },
      { ...record, id: '8' },
      { ...record, id: '7' },
    ]);
    const response = await request(app).get('/logs?limit=2&before=10');
    expect(response.body.logs.map((log: LogRecord) => log.id)).toEqual(['9', '8']);
    expect(response.body.nextCursor).toBe('8');
    expect(repository.list).toHaveBeenCalledWith({ limit: 3, before: '10' });
  });
  it('returns no cursor at the end of the result set', async () => {
    expect((await request(app).get('/logs')).body.nextCursor).toBeNull();
  });
  it.each(['-1', '0', '1.5', 'abc', '9223372036854775808', '1 OR 1=1'])(
    'rejects cursor %s',
    async (before) => {
      expect((await request(app).get('/logs').query({ before })).status).toBe(400);
    },
  );
});

describe('Socket.io transport', () => {
  it('notifies a WebSocket client after a successful insert', async () => {
    const { server, io } = createHttpServer(repository, ['http://localhost:3000']);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const socket = connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      timeout: 1500,
    });
    try {
      const connected = new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      socket.connect();
      await connected;
      const notification = new Promise((resolve) => socket.once('logs:created', resolve));
      expect((await request(server).post('/logs').send(input)).status).toBe(201);
      expect(await notification).toEqual({ id: record.id });
    } finally {
      socket.disconnect();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    }
  });
  it('rejects a WebSocket handshake from an untrusted browser origin', async () => {
    const { server, io } = createHttpServer(repository, ['http://localhost:3000']);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const socket = connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      timeout: 1500,
      extraHeaders: { Origin: 'https://untrusted.example' },
    });
    try {
      const rejection = new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      socket.connect();
      expect(await rejection).toBeInstanceOf(Error);
      expect(socket.connected).toBe(false);
    } finally {
      socket.disconnect();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    }
  });
});
