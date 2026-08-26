import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import type { LogRepository } from './types.js';

export function createHttpServer(repository: LogRepository, allowedOrigins: string[]) {
  const app = createApp(repository, (log) => {
    // A notification, not a durable event bus. Clients re-read canonical SQL results.
    io.emit('logs:created', { id: log.id });
  });
  const server = createServer(app);
  const io = new Server(server, {
    serveClient: false,
    maxHttpBufferSize: 16000,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  });
  return { server, io };
}
