export type Level = 'info' | 'warn' | 'error';

export interface LogInput {
  service: string;
  level: Level;
  message: string;
  timestamp: string;
}

export interface LogRecord extends LogInput {
  id: string;
  receivedAt: string;
}

export interface LogFilter {
  service?: string;
  level?: Level;
  q?: string;
  limit: number;
}

export interface LogRepository {
  insert(input: LogInput): Promise<LogRecord>;
  list(filter: LogFilter): Promise<LogRecord[]>;
  services(): Promise<string[]>;
  healthy(): Promise<boolean>;
}
