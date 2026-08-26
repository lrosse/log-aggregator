export type Level = 'info' | 'warn' | 'error';
export interface LogRecord {
  id: string;
  service: string;
  level: Level;
  message: string;
  timestamp: string;
  receivedAt: string;
}
export interface Filters {
  service: string;
  level: string;
  q: string;
}
export const emptyFilters: Filters = { service: '', level: '', q: '' };

export function queryString(filters: Filters) {
  const params = new URLSearchParams({ limit: '100' });
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
  return params.toString();
}

export async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch(`/api${path}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error(`Request failed (${response.status}). Check that the backend is running, then retry.`);
  return response.json() as Promise<T>;
}

export function summarize(logs: LogRecord[]) {
  return logs.reduce(
    (counts, log) => {
      counts[log.level] += 1;
      return counts;
    },
    { info: 0, warn: 0, error: 0 },
  );
}

export function formatTime(timestamp: string) {
  return new Date(timestamp).toISOString().slice(11, 23);
}
