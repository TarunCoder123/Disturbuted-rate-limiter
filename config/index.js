/**
 * Central configuration — all values resolved from environment variables
 * with sensible production-safe defaults.
 */
const config = {
  app: {
    port:    parseInt(process.env.PORT || '3000', 10),
    env:     process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  rateLimiter: {
    /**
     * Default tokens added per second (refill rate).
     * Override per-route or per-user as needed.
     */
    refillRate: parseFloat(process.env.RL_REFILL_RATE || '10'),

    /**
     * Maximum tokens in the bucket (burst capacity).
     * A user bursting from idle can send up to this many requests instantly.
     */
    capacity: parseInt(process.env.RL_CAPACITY || '20', 10),

    /**
     * Redis key TTL in seconds.
     * A bucket not touched for this long is evicted automatically.
     */
    ttlSeconds: parseInt(process.env.RL_TTL_SECONDS || '3600', 10),

    /**
     * Key prefix used in Redis.
     */
    keyPrefix: process.env.RL_KEY_PREFIX || 'rate_limit',
  },
};

export default config;
