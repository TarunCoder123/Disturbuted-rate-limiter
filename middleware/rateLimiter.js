import { runTokenBucket } from '../redis/client.js';
import config             from '../config/index.js';
import logger             from '../utils/logger.js';

/**
 * Resolve a stable identifier for the caller.
 * Priority: x-user-id header → IP address
 */
function resolveUserId(req) {
  const headerUserId = req.headers['x-user-id'];
  if (headerUserId && String(headerUserId).trim()) {
    return `user:${String(headerUserId).trim()}`;
  }
  // req.ip already handles X-Forwarded-For when trust proxy is enabled
  return `ip:${req.ip}`;
}

/**
 * Factory that returns a rate-limiter middleware with optional per-route overrides.
 *
 * Usage:
 *   app.use('/api', rateLimiter())                          // global defaults
 *   app.get('/api/heavy', rateLimiter({ refillRate: 2, capacity: 5 }), handler)
 *
 * @param {object} [opts]
 * @param {number} [opts.refillRate]  - tokens restored per second
 * @param {number} [opts.capacity]    - max bucket size (burst limit)
 * @param {number} [opts.ttlSeconds]  - Redis key TTL in seconds
 */
export function rateLimiter(opts = {}) {
  const refillRate = opts.refillRate ?? config.rateLimiter.refillRate;
  const capacity   = opts.capacity   ?? config.rateLimiter.capacity;
  const ttlSeconds = opts.ttlSeconds ?? config.rateLimiter.ttlSeconds;

  return async function rateLimiterMiddleware(req, res, next) {
    const userId = resolveUserId(req);
    const key    = `${config.rateLimiter.keyPrefix}:${userId}`;
    const nowMs  = Date.now();

    try {
      const { allowed, tokensLeft, retryAfterMs } = await runTokenBucket({
        key,
        refillRate,
        capacity,
        nowMs,
        ttl: ttlSeconds,
      });

      // ── Common rate-limit headers (RFC 6585 / draft-ietf-httpapi-ratelimit) ──
      res.setHeader('X-RateLimit-Limit',     capacity);
      res.setHeader('X-RateLimit-Remaining', Math.floor(Math.max(0, tokensLeft)));
      res.setHeader('X-RateLimit-Policy',    `${capacity};w=1;burst=${capacity};policy=token-bucket`);

      if (allowed) {
        return next();
      }

      // ── Throttled ─────────────────────────────────────────────────────────
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      res.setHeader('Retry-After',         retryAfterSec);
      res.setHeader('X-RateLimit-Reset',   Math.ceil((nowMs + retryAfterMs) / 1000));

      logger.warn({
        userId,
        path:      req.path,
        method:    req.method,
        tokensLeft: tokensLeft.toFixed(4),
        retryAfterSec,
      }, 'Rate limit exceeded');

      return res.status(429).json({
        error:      'Too many requests',
        retryAfter: retryAfterSec,
      });
    } catch (err) {
      // If Redis is unavailable, fail-open to avoid blocking all traffic.
      // Swap next() for a 503 response if you prefer fail-closed semantics.
      logger.error({ err, userId, path: req.path }, 'Rate limiter error — failing open');
      return next();
    }
  };
}

export default rateLimiter;
