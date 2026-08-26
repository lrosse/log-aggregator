import { expect, it } from 'vitest';
import { createEvent, services } from './events.js';

it('cycles across all four services', () => {
  expect(Array.from({ length: 4 }, (_, index) => createEvent(index).service)).toEqual([...services]);
});
it.each([
  [0.1, 'info'],
  [0.8, 'warn'],
  [0.99, 'error'],
])('generates a valid %s severity sample', (roll, level) => {
  const event = createEvent(0, () => Number(roll), new Date('2026-08-26T12:00:00Z'));
  expect(event.level).toBe(level);
  expect(event.message.length).toBeGreaterThan(0);
  expect(event.timestamp).toBe('2026-08-26T12:00:00.000Z');
});
