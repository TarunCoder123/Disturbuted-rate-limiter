import express               from 'express';
import { getRedisClient, closeRedisClient } from './redis/client.js';
import apiRouter             from './routes/api.js';
import statusRouter          from './routes/status.js';
import config                from './config/index.js';
import logger                from './utils/logger.js';

// ── Create Express app ────────────────────────────────────────────────────────
const app = express();

// Trust the first proxy so req.ip reflects the real client IP
// (needed when running behind nginx / docker / ELB)
app.set('trust proxy', 1);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url, ip: req.ip }, '→ incoming request');
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api',    apiRouter);
app.use('/status', statusRouter);

// Root convenience redirect
app.get('/', (_req, res) => res.redirect('/status'));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    await getRedisClient();   // establishes connection & loads Lua script

    const server = app.listen(config.app.port, () => {
      logger.info(
        { port: config.app.port, env: config.app.env },
        `🚀  Rate-limiter service started`
      );
    });

    // ── Graceful shutdown ──────────────────────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await closeRedisClient();
        logger.info('Server closed. Bye!');
        process.exit(0);
      });

      // Force exit if shutdown takes too long
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();

export default app;   // exported for testing
