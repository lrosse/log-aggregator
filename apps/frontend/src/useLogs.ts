import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { queryString, readJson, type Filters, type LogRecord } from './api';

interface Page {
  logs: LogRecord[];
  nextCursor: string | null;
}
interface Navigation {
  key: string;
  cursors: (string | undefined)[];
}

export function useLogs(filters: Filters) {
  const key = queryString(filters);
  const [navigation, setNavigation] = useState<Navigation>({ key, cursors: [undefined] });
  const cursors = navigation.key === key ? navigation.cursors : [undefined];
  const before = cursors.at(-1);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [connection, setConnection] = useState('connecting');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setNavigation((current) => (current.key === key ? current : { key, cursors: [undefined] }));
  }, [key]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let dirty = false;
    setLoading(true);
    setError('');
    setConnection(live ? 'connecting' : 'paused');

    // Coalesce bursts and serialize reads, so slow responses are not continually
    // aborted by new events. Each read uses the same server-side filter semantics.
    const schedule = () => {
      if (controller.signal.aborted || timer) return;
      if (inFlight) {
        dirty = true;
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        void fetchPage();
      }, 350);
    };
    const fetchPage = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const query = before ? `${key}&before=${encodeURIComponent(before)}` : key;
        const [data, sources] = await Promise.all([
          readJson<Page>(`/logs?${query}`, controller.signal),
          readJson<{ services: string[] }>('/services', controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setLogs(data.logs);
        setNextCursor(data.nextCursor);
        setServices(sources.services);
        setUpdated(new Date().toISOString());
        setError('');
      } catch (cause: unknown) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Unable to load logs.');
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (dirty && live) {
            dirty = false;
            schedule();
          }
        }
      }
    };

    const socket = live ? io({ autoConnect: false }) : null;
    socket?.on('connect', () => {
      setConnection('connected');
      schedule();
    });
    socket?.on('disconnect', () => setConnection('reconnecting'));
    socket?.on('connect_error', () => setConnection('reconnecting'));
    socket?.on('logs:created', schedule);
    void fetchPage();
    socket?.connect();

    return () => {
      controller.abort();
      clearTimeout(timer);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [key, before, live, revision]);

  const older = () => {
    if (!nextCursor || loading) return;
    setLive(false);
    setNavigation({ key, cursors: [...cursors, nextCursor] });
  };
  const newer = () => {
    if (cursors.length < 2 || loading) return;
    setNavigation({ key, cursors: cursors.slice(0, -1) });
  };
  const resume = () => {
    setNavigation({ key, cursors: [undefined] });
    setLive(true);
  };
  return {
    logs,
    services,
    loading,
    error,
    updated,
    live,
    connection,
    nextCursor,
    page: cursors.length,
    older,
    newer,
    resume,
    pause: () => setLive(false),
    refresh: () => setRevision((value) => value + 1),
  };
}
