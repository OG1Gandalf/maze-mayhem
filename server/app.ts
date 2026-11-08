import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import express, { type Express } from 'express';
import { Server } from 'socket.io';
import { RoomManager, type IO, type RoomOptions } from './rooms';

export interface AppOptions {
  /** Directory with the built client. Omit in dev, where Vite middleware serves the client. */
  staticDir?: string;
  rooms?: RoomOptions;
}

export interface AppServer {
  app: Express;
  httpServer: HttpServer;
  io: IO;
  rooms: RoomManager;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createAppServer(opts: AppOptions = {}): AppServer {
  const app = express();
  app.disable('x-powered-by');
  const httpServer = createServer(app);
  // destroyUpgrade: false lets Vite's HMR websocket share the same HTTP server in dev.
  const io: IO = new Server(httpServer, { destroyUpgrade: false, pingInterval: 5000, pingTimeout: 5000 });
  const rooms = new RoomManager(io, opts.rooms);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });
  if (opts.staticDir) app.use(express.static(opts.staticDir));

  return {
    app,
    httpServer,
    io,
    rooms,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      rooms.shutdown();
      await io.close();
    },
  };
}

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

export function logListening(port: number): void {
  console.log(`\n  Maze Mayhem is running`);
  console.log(`  Local:   http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${port}   <- open this on your phone (same Wi-Fi)`);
  console.log('');
}
