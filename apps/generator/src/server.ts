import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvent } from './events.js';

const endpoint = new URL('/logs', process.env.API_URL ?? 'http://backend:3001');
const interval = Number(process.env.GENERATOR_INTERVAL_MS ?? '650');
if (!Number.isInteger(interval) || interval < 100 || interval > 60000)
  throw new Error('GENERATOR_INTERVAL_MS must be between 100 and 60000');
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
let sequence = 0;
let failures = 0;

while (!controller.signal.aborted) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createEvent(sequence)),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    failures = 0;
    sequence += 1;
    await writeFile(join(tmpdir(), 'generator-heartbeat'), String(Date.now()));
    if (sequence % 20 === 0) console.info(JSON.stringify({ event: 'logs_generated', count: sequence }));
  } catch {
    if (controller.signal.aborted) break;
    failures += 1;
    console.warn(JSON.stringify({ event: 'ingestion_unavailable', consecutiveFailures: failures }));
  }
  // Retry the next synthetic event with capped backoff; do not flood a recovering API.
  try {
    await delay(failures ? Math.min(30000, 1000 * 2 ** Math.min(failures, 5)) : interval, undefined, {
      signal: controller.signal,
    });
  } catch {
    break;
  }
}
