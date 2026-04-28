import { Router } from 'express';
import { pingRedis } from '../redis/client.js';
import config        from '../config/index.js';
import logger        from '../utils/logger.js';

const router  = Router();
const startedAt = new Date().toISOString();

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  let redisOk = false;

  try {
    redisOk = await pingRedis();
  } catch (err) {
    logger.error({ err }, 'Health check: Redis ping failed');
  }

  const status = redisOk ? 'healthy' : 'degraded';
  const code   = redisOk ? 200       : 503;

  res.status(code).json({
    status,
    version:   config.app.version,
    env:       config.app.env,
    uptime:    Math.floor(process.uptime()),
    startedAt,
    checks: {
      redis: redisOk ? 'ok' : 'unreachable',
    },
    rateLimiter: {
      refillRate: config.rateLimiter.refillRate,
      capacity:   config.rateLimiter.capacity,
      ttlSeconds: config.rateLimiter.ttlSeconds,
      keyPrefix:  config.rateLimiter.keyPrefix,
    },
  });
});

export default router;
