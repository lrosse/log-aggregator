// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

const realtime = vi.hoisted(() => ({
  sockets: [] as { listeners: Map<string, () => void>; disconnected: boolean }[],
}));
vi.mock('socket.io-client', () => ({
  io: () => {
    const state = { listeners: new Map<string, () => void>(), disconnected: false };
    realtime.sockets.push(state);
    return {
      on: (event: string, listener: () => void) => state.listeners.set(event, listener),
      connect: () => {},
      removeAllListeners: () => state.listeners.clear(),
      disconnect: () => {
        state.disconnected = true;
      },
    };
  },
}));

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
  realtime.sockets.length = 0;
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
        : { logs: path.includes('q=missing') ? [] : [log], nextCursor: null },
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
  expect(screen.queryByText('No logs received yet')).toBeNull();
  await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
  await screen.findByRole('button', { name: 'Payment timeout' });
  expect((screen.getByLabelText('Search log messages') as HTMLInputElement).value).toBe('');
});

it('guides a workspace with no logs to the existing ingestion instructions', async () => {
  fetchMock.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () => (path.includes('/services') ? { services: [] } : { logs: [], nextCursor: null }),
  }));
  const user = userEvent.setup();
  render(<App />);
  const empty = await screen.findByRole('region', { name: 'No logs received' });
  expect(empty.textContent).toContain('No logs received yet');
  expect(empty.textContent).toContain('POST /logs');
  await user.click(within(empty).getByRole('button', { name: 'Send your first log' }));
  const instructions = await screen.findByRole('dialog', { name: 'Connect a service' });
  expect(instructions.textContent).toContain('curl -X POST');
  await user.click(within(instructions).getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
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

it('refreshes filtered results after a socket event and catches up on reconnect', async () => {
  render(<App />);
  await screen.findByRole('button', { name: 'Payment timeout' });
  let message = 'New live event';
  fetchMock.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path.includes('/services')
        ? { services: ['payments'] }
        : { logs: [{ ...log, message }], nextCursor: null },
  }));
  await act(async () => {
    realtime.sockets.at(-1)!.listeners.get('logs:created')!();
  });
  await screen.findByRole('button', { name: 'New live event' });
  message = 'Recovered after reconnect';
  await act(async () => {
    realtime.sockets.at(-1)!.listeners.get('connect')!();
  });
  await screen.findByRole('button', { name: 'Recovered after reconnect' });
  expect(screen.getByRole('status').textContent).toBe('LIVE');
});

it('pauses for historical pages and resumes at the latest page', async () => {
  const user = userEvent.setup();
  fetchMock.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path.includes('/services')
        ? { services: ['payments'] }
        : path.includes('before=10')
          ? { logs: [{ ...log, id: '9', message: 'Older event' }], nextCursor: null }
          : { logs: [log], nextCursor: '10' },
  }));
  render(<App />);
  await screen.findByRole('button', { name: 'Payment timeout' });
  const original = realtime.sockets[0]!;
  await user.click(screen.getByRole('button', { name: 'Older logs' }));
  await screen.findByRole('button', { name: 'Older event' });
  expect(screen.getByText('Page 2')).toBeTruthy();
  expect(original.disconnected).toBe(true);
  expect((screen.getByRole('button', { name: 'Older logs' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Resume live' }));
  await screen.findByRole('button', { name: 'Payment timeout' });
  expect(screen.getByText('Page 1')).toBeTruthy();
  expect(realtime.sockets).toHaveLength(2);
});

it('discards a late response after the query changes', async () => {
  const user = userEvent.setup();
  let resolveOld: (value: unknown) => void = () => {};
  fetchMock.mockImplementation(async (path: string) => {
    if (path.includes('/services')) return { ok: true, json: async () => ({ services: ['payments'] }) };
    if (path.includes('q=current'))
      return {
        ok: true,
        json: async () => ({ logs: [{ ...log, message: 'Current result' }], nextCursor: null }),
      };
    return new Promise((resolve) => {
      resolveOld = resolve;
    });
  });
  render(<App />);
  await user.type(screen.getByLabelText('Search log messages'), 'current');
  await screen.findByRole('button', { name: 'Current result' });
  await act(async () => {
    resolveOld({ ok: true, json: async () => ({ logs: [log], nextCursor: null }) });
  });
  expect(screen.queryByRole('button', { name: 'Payment timeout' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Current result' })).toBeTruthy();
});

it('does not restore stale history when filters are cleared', async () => {
  const user = userEvent.setup();
  fetchMock.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path.includes('/services') ? { services: ['payments'] } : { logs: [log], nextCursor: '10' },
  }));
  render(<App />);
  await screen.findByRole('button', { name: 'Payment timeout' });
  await user.click(screen.getByRole('button', { name: 'Older logs' }));
  await screen.findByText('Page 2');
  await user.selectOptions(screen.getByLabelText('Filter by service'), 'payments');
  await screen.findByText('Page 1');
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByText('Page 1')).toBeTruthy();
});
