// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

const log = {
  id: '1',
  service: 'payments',
  level: 'error',
  message: 'Payment timeout',
  timestamp: '2026-08-26T12:00:00Z',
  receivedAt: '2026-08-26T12:00:01Z',
};
const fetchMock = vi.fn();
beforeEach(() => {
  // jsdom has no native dialog implementation; browsers are checked separately.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path.includes('/services')
        ? { services: ['payments', 'api-gateway'] }
        : { logs: path.includes('q=missing') ? [] : [log] },
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('renders persisted logs and combines service, level and text filters', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', { name: 'Payment timeout' });
  await user.selectOptions(screen.getByLabelText('Filter by service'), 'payments');
  await user.selectOptions(screen.getByLabelText('Filter by level'), 'error');
  await user.type(screen.getByLabelText('Search log messages'), 'timeout');
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/logs?limit=100&service=payments&level=error&q=timeout',
      expect.any(Object),
    ),
  );
});

it('shows an empty state and lets the user reset filters', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', { name: 'Payment timeout' });
  await user.type(screen.getByLabelText('Search log messages'), 'missing');
  await screen.findByText('No matching events');
  await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
  await screen.findByRole('button', { name: 'Payment timeout' });
  expect((screen.getByLabelText('Search log messages') as HTMLInputElement).value).toBe('');
});

it('shows backend failures and retries successfully', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Backend unreachable'));
  const user = userEvent.setup();
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain('Backend unreachable');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Payment timeout' });
  expect(screen.queryByRole('alert')).toBeNull();
});
