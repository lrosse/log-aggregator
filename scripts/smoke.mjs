import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001';
const web = process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:3000';
const marker = `smoke-${randomUUID()}`;
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
assert.match(await (await fetch(web)).text(), /Log Aggregator/);

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
console.log(
  'PASS: HTTP ingestion, PostgreSQL filters, literal search, validation, generator and nginx proxy.',
);
