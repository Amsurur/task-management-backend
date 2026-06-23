// Bootstrap entrypoint.
//
// Builds the Fastify app (`app.ts`), binds the listening socket, and installs
// graceful-shutdown handlers. Host/port come from validated config
// (`src/config/`), which fails fast on invalid env before we get here.

import { buildApp } from './app.js';
import { config } from './config/index.js';

async function start(): Promise<void> {
  const app = await buildApp();

  // Translate POSIX signals into a clean Fastify close so in-flight requests
  // drain and plugins run their onClose hooks (DB pools, etc.).
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, 'shutting down');
      app
        .close()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          app.log.error({ err }, 'error during shutdown');
          process.exit(1);
        });
    });
  }

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void start();
