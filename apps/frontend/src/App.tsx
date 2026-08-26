import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  Database,
  Layers3,
  ListFilter,
  Radio,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import {
  emptyFilters,
  formatTime,
  queryString,
  readJson,
  summarize,
  type Filters,
  type Level,
  type LogRecord,
} from './api';

const levels: Level[] = ['info', 'warn', 'error'];

export function App() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [query, setQuery] = useState('');
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [updated, setUpdated] = useState<string | null>(null);
  const [selected, setSelected] = useState<LogRecord | null>(null);
  const [showApi, setShowApi] = useState(false);
  const [copied, setCopied] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const counts = summarize(logs);
  const active = Object.values(filters).some(Boolean);

  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((value) => (value.q === query ? value : { ...value, q: query })),
      250,
    );
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void Promise.all([
      readJson<{ logs: LogRecord[] }>(`/logs?${queryString(filters)}`, controller.signal),
      readJson<{ services: string[] }>('/services', controller.signal),
    ])
      .then(([data, sources]) => {
        if (controller.signal.aborted) return;
        setLogs(data.logs);
        setServices(sources.services);
        setUpdated(new Date().toISOString());
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Unable to load logs.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, revision]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (
        event.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) &&
        !dialog.current?.open
      ) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  useEffect(() => {
    setCopied(false);
    if (selected || showApi) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected, showApi]);

  const change = (name: keyof Filters, value: string) =>
    setFilters((current) => ({ ...current, [name]: value }));
  const clear = () => {
    setQuery('');
    setFilters(emptyFilters);
  };
  const closeDialog = () => {
    setSelected(null);
    setShowApi(false);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href="/" aria-label="Log Aggregator home">
          <span className="brand-mark">
            <Layers3 size={21} />
          </span>
          <span>
            log<span className="brand-light">aggregator</span>
            <small>OBSERVABILITY WORKBENCH</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">L</span>
          <div>
            Local workspace<small>Development environment</small>
          </div>
          <span className="env-dot" />
        </div>
        <div className="section-label">WORKSPACE</div>
        <button className="nav-item selected" onClick={clear}>
          <Terminal size={17} /> Log explorer <ChevronRight size={14} />
        </button>
        <button className="nav-item" onClick={() => setShowApi(true)}>
          <Code2 size={17} /> Ingestion API <ArrowUpRight size={14} />
        </button>
        <div className="section-label sources-label">
          SOURCES <span>{services.length.toString().padStart(2, '0')}</span>
        </div>
        <button
          className={`source ${!filters.service ? 'active' : ''}`}
          onClick={() => change('service', '')}
        >
          <Layers3 size={15} /> All services
        </button>
        {services.map((service) => (
          <button
            key={service}
            className={`source ${filters.service === service ? 'active' : ''}`}
            onClick={() => change('service', service)}
          >
            <span className="source-dot" />
            {service}
            <ChevronRight size={13} />
          </button>
        ))}
        {!services.length && (
          <p className="source-help">Services appear after their first log is received.</p>
        )}
        <div className="sidebar-bottom">
          <Database size={16} />
          <div>
            Stored in PostgreSQL<small>Your logs. One place.</small>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={13} />
            <span>Log explorer</span>
          </div>
          <span className="environment">
            <span className="env-dot" /> LOCAL <span className="divider">/</span> development
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">COLLECT. FILTER. INVESTIGATE.</div>
              <h1>
                Log explorer<span className="heading-dot">.</span>
              </h1>
              <p>A clear view across your services, down to the last event.</p>
            </div>
            <button className="button secondary" onClick={() => setShowApi(true)}>
              <Code2 size={15} /> Send your first log <ArrowUpRight size={14} />
            </button>
          </div>

          <section className="summary" aria-label="Current window summary">
            <div className="summary-total">
              <span className="section-label">EVENTS IN VIEW</span>
              <div className="big-number">
                {logs.length.toLocaleString()}
                <span>/ 100</span>
              </div>
              <span className="summary-caption">Latest matching events</span>
            </div>
            {levels.map((level) => (
              <button
                className={`metric ${level} ${filters.level === level ? 'metric-selected' : ''}`}
                key={level}
                onClick={() => change('level', filters.level === level ? '' : level)}
                aria-label={`Filter ${level} logs`}
                aria-pressed={filters.level === level}
              >
                <span className="metric-label">
                  <span className="level-dot" />
                  {level === 'info' ? 'Information' : level === 'warn' ? 'Warnings' : 'Errors'}
                </span>
                <span className="metric-value">
                  {counts[level].toLocaleString()}
                  <span>{logs.length ? Math.round((counts[level] / logs.length) * 100) : 0}%</span>
                </span>
                <span className="meter">
                  <span style={{ width: `${logs.length ? (counts[level] / logs.length) * 100 : 0}%` }} />
                </span>
              </button>
            ))}
          </section>

          <section className="log-panel" aria-label="Logs">
            <div className="panel-heading">
              <div>
                <Radio size={16} />
                <h2>Event stream</h2>
                <span className="badge">{loading ? 'LOADING' : 'SNAPSHOT'}</span>
              </div>
              <button
                className="button small"
                onClick={() => setRevision((value) => value + 1)}
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
              </button>
            </div>
            <div className="filters">
              <label className="search-field">
                <Search size={16} />
                <input
                  ref={search}
                  aria-label="Search log messages"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search messages…"
                />
                <kbd>/</kbd>
              </label>
              <label className="select-field">
                <span>Service</span>
                <select
                  aria-label="Filter by service"
                  value={filters.service}
                  onChange={(event) => change('service', event.target.value)}
                >
                  <option value="">All services</option>
                  {services.map((service) => (
                    <option key={service}>{service}</option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>Level</span>
                <select
                  aria-label="Filter by level"
                  value={filters.level}
                  onChange={(event) => change('level', event.target.value)}
                >
                  <option value="">All levels</option>
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="query-line">
              <div>
                <ListFilter size={13} />
                <span>{active ? 'Filtered results' : 'All events'}</span>
                {filters.service && <span className="query-token">service:{filters.service}</span>}
                {filters.level && <span className="query-token">level:{filters.level}</span>}
                {filters.q && <span className="query-token">text:{filters.q}</span>}
                {active && (
                  <button onClick={clear} className="text-button">
                    Clear filters <X size={12} />
                  </button>
                )}
              </div>
              <span>
                Newest received first <ArrowDown size={12} />
              </span>
            </div>
            {error ? (
              <div role="alert" className="state error-state">
                <strong>Connection interrupted</strong>
                <p>{error}</p>
                <button className="button" onClick={() => setRevision((value) => value + 1)}>
                  Try again
                </button>
              </div>
            ) : (
              <div className={`table-scroll ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
                <table>
                  <thead>
                    <tr>
                      <th className="level-column">LEVEL</th>
                      <th className="time-column">
                        TIMESTAMP <span>UTC</span>
                      </th>
                      <th className="service-column">SERVICE</th>
                      <th>MESSAGE</th>
                      <th className="detail-column">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className={`log-row row-${log.level}`}>
                        <td>
                          <span className={`level-badge ${log.level}`}>
                            <span className="level-dot" />
                            {log.level}
                          </span>
                        </td>
                        <td className="timestamp" title={log.timestamp}>
                          {formatTime(log.timestamp)}
                        </td>
                        <td>
                          <span className="service-name">{log.service}</span>
                        </td>
                        <td className="message-cell">
                          <button onClick={() => setSelected(log)} title={log.message}>
                            {log.message}
                          </button>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Inspect log ${log.id}`}
                            onClick={() => setSelected(log)}
                          >
                            <ChevronRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!logs.length && (
                  <div className="state">
                    <Terminal size={27} />
                    <strong>
                      {loading
                        ? 'Connecting to your logs…'
                        : active
                          ? 'No matching events'
                          : 'Ready for your first event'}
                    </strong>
                    <p>
                      {active
                        ? 'Try another search or clear your filters.'
                        : 'Start the generator or send a log to POST /logs.'}
                    </p>
                    {active && (
                      <button className="button" onClick={clear}>
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="table-footer">
              <span>
                <span className={`status-dot ${error ? 'offline' : ''}`} />
                {error ? 'Backend unavailable' : loading ? 'Fetching events' : `${logs.length} events loaded`}
              </span>
              <span>100 events per window · Refresh to sync</span>
            </div>
          </section>
          <footer className="page-footer">
            <span>
              LOG AGGREGATOR <span className="muted">/</span> A little signal in the noise.
            </span>
            <span>{updated ? `Last fetched ${formatTime(updated)} UTC` : 'Waiting for connection'}</span>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialog}
        className="detail-dialog"
        onCancel={closeDialog}
        onClick={(event) => {
          if (event.target === dialog.current) closeDialog();
        }}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-heading">
          <span className="eyebrow">{selected ? 'EVENT INSPECTOR' : 'DEVELOPER REFERENCE'}</span>
          <button className="icon-button" aria-label="Close dialog" onClick={closeDialog}>
            <X size={19} />
          </button>
        </div>
        <h2 id="dialog-title">{selected ? 'Log details' : 'Connect a service'}</h2>
        {selected ? (
          <>
            <div className="detail-meta">
              <span className={`level-badge ${selected.level}`}>
                <span className="level-dot" />
                {selected.level}
              </span>
              <span className="service-name">{selected.service}</span>
              <span className="muted">#{selected.id}</span>
            </div>
            <dl>
              <dt>Event time</dt>
              <dd>{selected.timestamp}</dd>
              <dt>Received at</dt>
              <dd>{selected.receivedAt}</dd>
            </dl>
            <div className="section-label">MESSAGE</div>
            <pre className="message-detail">{selected.message}</pre>
            <div className="json-heading">
              <span className="section-label">RAW EVENT</span>
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(JSON.stringify(selected, null, 2))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? (
                  <>
                    <Check size={13} /> Copied
                  </>
                ) : (
                  'Copy JSON'
                )}
              </button>
            </div>
            <pre>{JSON.stringify(selected, null, 2)}</pre>
          </>
        ) : (
          <>
            <p>Send a JSON event over HTTP. Events are acknowledged only after PostgreSQL has stored them.</p>
            <div className="endpoint">
              <span>POST</span> http://localhost:3001/logs
            </div>
            <pre>{`curl -X POST http://localhost:3001/logs \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    "service": "payments",\n    "level": "info",\n    "message": "Payment authorized",\n    "timestamp": "2026-08-26T12:00:00Z"\n  }'`}</pre>
            <p className="muted">
              Levels: info, warn, error. Timestamps require ISO 8601 with a timezone. This local demo has no
              authentication; do not expose it publicly.
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}
