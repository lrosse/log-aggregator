import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildWhere, createRepository } from './repository.js';

describe('database readiness', () => {
  it('probes the migrated logs table and accepts an empty database', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = createRepository({ query } as unknown as Pool);
    expect(await repository.healthy()).toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1 FROM logs LIMIT 1');
  });
  it('reports a failed database probe without exposing the error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private connection details'));
    const repository = createRepository({ query } as unknown as Pool);
    expect(await repository.healthy()).toBe(false);
  });
});

describe('SQL filters', () => {
  it('uses a numeric keyset predicate with all filters', () => {
    expect(
      buildWhere({ service: 'payments', level: 'warn', before: '9007199254740993', q: 'slow', limit: 100 }),
    ).toEqual({
      sql: 'WHERE service = $1 AND level = $2 AND logs.id < $3 AND message ILIKE $4',
      values: ['payments', 'warn', '9007199254740993', '%slow%'],
    });
  });
  it('builds an unfiltered query', () => {
    expect(buildWhere({ limit: 100 })).toEqual({ sql: '', values: [] });
  });
  it('combines predicates using parameters', () => {
    expect(buildWhere({ service: 'api', level: 'error', q: "%' OR 1=1 --", limit: 100 })).toEqual({
      sql: 'WHERE service = $1 AND level = $2 AND message ILIKE $3',
      values: ['api', 'error', "%\\%' OR 1=1 --%"],
    });
  });
  it('treats %, _ and backslash as literal search characters', () => {
    expect(buildWhere({ q: '100% cache_key\\path', limit: 100 }).values).toEqual([
      '%100\\% cache\\_key\\\\path%',
    ]);
  });
});
