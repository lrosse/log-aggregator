import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const base = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001';
const web = process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:3000';
const marker = `smoke-${randomUUID()}`;

async function waitUntilReady(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* A restart can briefly close connections before the next health probe. */
    }
    await delay(250);
  }
  assert.fail(`Service did not become ready within 20 seconds: ${url}`);
}

await Promise.all([waitUntilReady(`${base}/health`), waitUntilReady(`${web}/api/health`)]);
async function get(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `GET ${path}`);
  return response.json();
}
async function post(body, expected = 201) {
  const response = await fetch(`${base}/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, expected, 'POST /logs');
  return response.json();
}
assert.equal((await get('/health')).status, 'ok');
assert.equal((await fetch(`${web}/api/health`)).status, 200, 'nginx API proxy');
const html = await (await fetch(web)).text();
assert.match(html, /<title>Log Aggregator · Explorer<\/title>/);
assert.match(html, /rel="icon"[^>]+href="\/favicon\.svg"/);
const favicon = await fetch(`${web}/favicon.svg`);
assert.equal(favicon.status, 200, 'favicon is served');
assert.match(favicon.headers.get('content-type'), /image\/svg\+xml/);
assert.match(await favicon.text(), /<svg/);

const input = {
  service: 'payments',
  level: 'error',
  message: `${marker} timeout 100% cache_key`,
  timestamp: '2026-08-26T09:00:00.123-03:00',
};
const saved = await post(input);
assert.equal(typeof saved.id, 'string');
assert.equal(saved.timestamp, '2026-08-26T12:00:00.123Z');
await post({ ...input, level: 'info', message: `${marker} healthy 100X cacheXkey` });
await post({ ...input, service: 'auth-service', message: `${marker} auth timeout` });
await post({ ...input, level: 'invalid' }, 400);

const combined = await get(
  `/logs?${new URLSearchParams({ service: 'payments', level: 'error', q: marker })}`,
);
assert.deepEqual(
  combined.logs.map((log) => log.id),
  [saved.id],
  'combined filters persisted in PostgreSQL',
);
const literal = await get(`/logs?${new URLSearchParams({ q: `${marker} timeout 100% cache_key` })}`);
assert.deepEqual(
  literal.logs.map((log) => log.id),
  [saved.id],
  'literal percent and underscore',
);
assert.equal((await get(`/logs?${new URLSearchParams({ q: `${marker} nonexistent` })}`)).logs.length, 0);
assert.equal(
  (await get(`/logs?${new URLSearchParams({ q: "' OR 1=1 --" })}`)).logs.length,
  0,
  'SQL injection remains literal',
);
const limited = await get('/logs?limit=2');
assert.equal(limited.logs.length, 2);
assert.ok(BigInt(limited.logs[0].id) > BigInt(limited.logs[1].id), 'ingestion ordering');
const firstPage = await get(`/logs?${new URLSearchParams({ q: marker, limit: '2' })}`);
assert.ok(firstPage.nextCursor);
const newArrival = await post({ ...input, message: `${marker} new arrival` });
const secondPage = await get(
  `/logs?${new URLSearchParams({ q: marker, limit: '2', before: firstPage.nextCursor })}`,
);
assert.equal(secondPage.nextCursor, null);
const pagedIds = [...firstPage.logs, ...secondPage.logs].map((log) => log.id);
assert.equal(new Set(pagedIds).size, 3, 'no duplicate or skipped records across pages');
assert.ok(!pagedIds.includes(newArrival.id), 'new arrivals do not shift older pages');
const window = await get('/logs?limit=200');
assert.ok(
  window.logs.every((log, index) => index === 0 || BigInt(window.logs[index - 1].id) > BigInt(log.id)),
  'numeric ordering across ID digit boundaries',
);

const expectedServices = ['api-gateway', 'auth-service', 'payments', 'worker-queue'];
const deadline = Date.now() + 20000;
let observed = [];
while (Date.now() < deadline) {
  observed = (await get('/services')).services;
  if (expectedServices.every((service) => observed.includes(service))) break;
  await delay(500);
}
assert.ok(
  expectedServices.every((service) => observed.includes(service)),
  'all four generated services',
);
for (const service of expectedServices) {
  const result = await get(`/logs?${new URLSearchParams({ service })}`);
  assert.ok(
    result.logs.some((log) => !log.message.startsWith('smoke-')),
    `real generator data from ${service}`,
  );
  assert.ok(result.logs.every((log) => log.service === service));
}
const socket = io(web, { transports: ['websocket'], reconnection: false, autoConnect: false, timeout: 5000 });
try {
  const connected = new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const notifications = new Set();
  socket.on('logs:created', (event) => notifications.add(event.id));
  socket.connect();
  await connected;
  const persisted = await post({ ...input, message: `${marker} socket proof` });
  const socketDeadline = Date.now() + 5000;
  while (!notifications.has(persisted.id) && Date.now() < socketDeadline) await delay(25);
  assert.ok(notifications.has(persisted.id), 'persisted event notification over nginx WebSocket upgrade');
} finally {
  socket.disconnect();
}
console.log(
  'PASS: ingestion, PostgreSQL filters, cursor pagination, generator, nginx and Socket.io WebSocket.',
);
