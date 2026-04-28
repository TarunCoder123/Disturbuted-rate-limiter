import { createClient } from 'redis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load Lua script once at startup ─────────────────────────────────────────
const TOKEN_BUCKET_SCRIPT = readFileSync(
  join(__dirname, '../scripts/tokenBucket.lua'),
  'utf8'
);

// ── Singleton Redis client ───────────────────────────────────────────────────
let redisClient = null;
let scriptSha   = null;   // SHA of the loaded Lua script (EVALSHA)

export async function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis: too many reconnect attempts, giving up');
          return new Error('Max retries exceeded');
        }
        const delay = Math.min(retries * 100, 3000);
        logger.warn(`Redis: reconnecting in ${delay}ms (attempt ${retries})`);
        return delay;
      },
    },
  });

  redisClient.on('connect',       () => logger.info('Redis: connected'));
  redisClient.on('ready',         () => logger.info('Redis: ready'));
  redisClient.on('error',  (err)  => logger.error({ err }, 'Redis: error'));
  redisClient.on('reconnecting',  () => logger.warn('Redis: reconnecting…'));
  redisClient.on('end',           () => logger.warn('Redis: connection closed'));

  await redisClient.connect();
  await loadScript();

  return redisClient;
}

// ── Load (or re-load) the Lua script into Redis ──────────────────────────────
async function loadScript() {
  try {
    scriptSha = await redisClient.scriptLoad(TOKEN_BUCKET_SCRIPT);
    logger.info({ scriptSha }, 'Redis: Lua script loaded');
  } catch (err) {
    logger.error({ err }, 'Redis: failed to load Lua script');
    throw err;
  }
}

// ── Run the token-bucket Lua script atomically ───────────────────────────────
export async function runTokenBucket({ key, refillRate, capacity, nowMs, ttl }) {
  if (!redisClient || !scriptSha) {
    throw new Error('Redis client not initialised');
  }

  try {
    const result = await redisClient.evalSha(scriptSha, {
      keys:      [key],
      arguments: [
        String(refillRate),
        String(capacity),
        String(nowMs),
        String(ttl),
      ],
    });

    return {
      allowed:       result[0] === 1,
      tokensLeft:    parseFloat(result[1]),
      retryAfterMs:  parseInt(result[2], 10),
    };
  } catch (err) {
    // Script may have been flushed (SCRIPT FLUSH); reload and retry once
    if (err.message?.includes('NOSCRIPT')) {
      logger.warn('Redis: script not found, reloading…');
      await loadScript();
      return runTokenBucket({ key, refillRate, capacity, nowMs, ttl });
    }
    throw err;
  }
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
export async function closeRedisClient() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    scriptSha   = null;
    logger.info('Redis: connection closed gracefully');
  }
}

// ── Health-check helper ──────────────────────────────────────────────────────
export async function pingRedis() {
  if (!redisClient) return false;
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
