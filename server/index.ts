import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer, logListening } from './app';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, '../client');
if (!existsSync(resolve(staticDir, 'index.html'))) {
  console.error(`No built client found in ${staticDir}. Run "npm run build" first (or "npm run dev" for development).`);
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const server = createAppServer({ staticDir });
logListening(await server.listen(port, process.env.HOST || '0.0.0.0'));
