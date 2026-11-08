import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createAppServer, logListening } from './app';

const port = Number(process.env.PORT) || 3000;
const server = createAppServer();
const vite = await createViteServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { middlewareMode: true, hmr: { server: server.httpServer } },
  appType: 'spa',
});
server.app.use(vite.middlewares);
logListening(await server.listen(port, process.env.HOST || '0.0.0.0'));

const shutdown = async () => {
  await vite.close();
  await server.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
