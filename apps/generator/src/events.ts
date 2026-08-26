export const services = ['api-gateway', 'auth-service', 'payments', 'worker-queue'] as const;
const messages = {
  'api-gateway': {
    info: [
      'GET /v1/products 200 · 24ms',
      'POST /v1/orders 201 · 86ms',
      'Request completed · upstream=catalog · 32ms',
    ],
    warn: ['Upstream latency elevated · p95=842ms', 'Rate limit approaching · client=storefront'],
    error: [
      'Upstream connection timeout · host=catalog:8080',
      'GET /v1/inventory 502 · retry budget exhausted',
    ],
  },
  'auth-service': {
    info: [
      'Session validated · strategy=jwt · 4ms',
      'Access token refreshed · ttl=3600s',
      'Identity provider health check passed',
    ],
    warn: ['Login throttled · attempts=5 · window=60s', 'Signing key rotation scheduled · expires_in=24h'],
    error: [
      'Identity provider unavailable · retry in 5s',
      'Token validation failed · reason=signature_mismatch',
    ],
  },
  payments: {
    info: [
      'Payment authorized · currency=USD · 142ms',
      'Webhook delivered · event=payment.succeeded',
      'Settlement batch completed · transactions=24',
    ],
    warn: ['Payment provider response slow · elapsed=1240ms', 'Webhook retry scheduled · attempt=2/5'],
    error: ['Payment gateway timeout · provider=sandbox', 'Charge declined · reason=insufficient_funds'],
  },
  'worker-queue': {
    info: [
      'Job completed · queue=email · duration=128ms',
      'Batch processed · records=250 · duration=412ms',
      'Worker heartbeat · active_jobs=3 · concurrency=8',
    ],
    warn: ['Queue depth above threshold · pending=128', 'Job retry scheduled · backoff=2000ms'],
    error: [
      'Job failed · queue=exports · reason=storage_unavailable',
      'Dead letter queue updated · attempts_exhausted=3',
    ],
  },
};

export function createEvent(sequence: number, random = Math.random, now = new Date()) {
  const service = services[sequence % services.length]!;
  const roll = random();
  const level = roll < 0.72 ? 'info' : roll < 0.92 ? 'warn' : 'error';
  const options = messages[service][level];
  return {
    service,
    level,
    message: options[Math.floor(random() * options.length)]!,
    timestamp: now.toISOString(),
  };
}
