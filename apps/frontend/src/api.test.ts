import { describe, expect, it } from 'vitest';
import { emptyFilters, formatTime, queryString, summarize } from './api';

describe('dashboard data', () => {
  it('encodes all active filters without treating search text as syntax', () => {
    const params = new URLSearchParams(queryString({ service: 'api', level: 'warn', q: 'a&b 100%' }));
    expect(Object.fromEntries(params)).toEqual({
      limit: '100',
      service: 'api',
      level: 'warn',
      q: 'a&b 100%',
    });
  });
  it('omits empty filters', () => {
    expect(queryString(emptyFilters)).toBe('limit=100');
  });
  it('calculates counts from the displayed window only', () => {
    expect(
      summarize([
        { id: '1', level: 'error', service: 'api', message: 'oops', timestamp: '', receivedAt: '' },
      ]),
    ).toEqual({ info: 0, warn: 0, error: 1 });
    expect(summarize([])).toEqual({ info: 0, warn: 0, error: 0 });
  });
  it('displays UTC with milliseconds regardless of source offset', () => {
    expect(formatTime('2026-08-26T09:00:00.123-03:00')).toBe('12:00:00.123');
  });
});
