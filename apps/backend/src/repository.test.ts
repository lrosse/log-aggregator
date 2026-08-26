import { describe, expect, it } from 'vitest';
import { buildWhere } from './repository.js';

describe('SQL filters', () => {
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
    expect(buildWhere({ q: '100% cache_key\\path', limit: 100 }).values).toEqual(['%100\\% cache\\_key\\\\path%']);
  });
});
