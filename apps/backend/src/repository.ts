import type { Pool } from 'pg';
import type { LogFilter, LogInput, LogRecord, LogRepository } from './types.js';

export function buildWhere(filter: LogFilter) {
  const clauses: string[] = [];
  const values: string[] = [];
  const add = (column: string, value: string, operator = '=') => {
    values.push(value);
    clauses.push(`${column} ${operator} $${values.length}`);
  };
  if (filter.service) add('service', filter.service);
  if (filter.level) add('level', filter.level);
  // Search is a literal substring, so SQL LIKE wildcards must be escaped.
  if (filter.q) add('message', `%${filter.q.replace(/[\\%_]/g, '\\$&')}%`, 'ILIKE');
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

type DatabaseLog = Omit<LogRecord, 'timestamp' | 'receivedAt'> & { timestamp: Date; receivedAt: Date };
const columns = 'id::text, service, level, message, timestamp, received_at AS "receivedAt"';
const serialize = (row: DatabaseLog): LogRecord => ({ ...row, timestamp: row.timestamp.toISOString(), receivedAt: row.receivedAt.toISOString() });

export function createRepository(pool: Pool): LogRepository {
  return {
    async insert(input: LogInput) {
      const result = await pool.query<DatabaseLog>(
        `INSERT INTO logs (service, level, message, timestamp) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
        [input.service, input.level, input.message, input.timestamp],
      );
      return serialize(result.rows[0]!);
    },
    async list(filter) {
      const where = buildWhere(filter);
      const result = await pool.query<DatabaseLog>(
        `SELECT ${columns} FROM logs ${where.sql} ORDER BY id DESC LIMIT $${where.values.length + 1}`,
        [...where.values, filter.limit],
      );
      return result.rows.map(serialize);
    },
    async services() {
      const result = await pool.query<{ service: string }>('SELECT DISTINCT service FROM logs ORDER BY service');
      return result.rows.map((row) => row.service);
    },
    async healthy() {
      try { await pool.query('SELECT 1 FROM logs LIMIT 1'); return true; }
      catch { return false; }
    },
  };
}
