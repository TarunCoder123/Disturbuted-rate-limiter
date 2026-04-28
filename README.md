# Distributed Rate Limiter

> Production-ready **Token Bucket** rate limiter built with **Node.js**, **Express**, and **Redis**.  
> Atomic operations via a Redis **Lua script** guarantee correctness across any number of Node.js instances.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Express App (N instances)          │
│                                                      │
│  GET /api/test  ──►  rateLimiter()  ──►  handler    │
│                           │                          │
│                    runTokenBucket()                  │
│                           │ EVALSHA (atomic)         │
└───────────────────────────┼──────────────────────────┘
                            ▼
              ┌─────────────────────────┐
              │         Redis           │
              │                         │
              │  HASH rate_limit:{id}   │
              │    tokens       = 19.5  │
              │    last_refill_ms = ... │
              └─────────────────────────┘
```

### Token Bucket Algorithm

On every request the Lua script atomically:

1. Reads `tokens` and `last_refill_ms` from the Redis hash.
2. Calculates `elapsed = now - last_refill_ms` and refills `min(capacity, tokens + elapsed_sec × refillRate)`.
3. If `tokens ≥ 1` → deducts 1, returns **allowed**.
4. Otherwise → computes `retryAfterMs`, returns **denied**.
5. Writes updated state and resets TTL.

---

## Project Structure

```
rate-limiter/
├── app.js                     # Express bootstrap & graceful shutdown
├── config/
│   └── index.js               # All env-var based configuration
├── middleware/
│   └── rateLimiter.js         # Express middleware factory
├── redis/
│   └── client.js              # Redis singleton, EVALSHA, NOSCRIPT recovery
├── routes/
│   ├── api.js                 # /api/* routes (test, burst, strict, user-info)
│   └── status.js              # /status health-check
├── scripts/
│   └── tokenBucket.lua        # Atomic Lua script
├── tests/
│   └── loadTest.js            # 100-request load test
├── utils/
│   └── logger.js              # Pino structured logger
├── .env.example
├── .gitignore
├── docker-compose.yml         # Redis + 2 × app
├── Dockerfile                 # Multi-stage, non-root
└── package.json
```

---

## Quick Start — Local (without Docker)

### Prerequisites
- Node.js ≥ 18
- Redis running on `localhost:6379`

```bash
# 1. Clone / enter the project
cd rate-limiter

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env          # edit if needed

# 4. Start Redis (if not already running)
redis-server &

# 5. Start the app (auto-restarts on file change in dev)
npm run dev
```

The server starts on **http://localhost:3000**.

---

## Quick Start — Docker Compose (recommended)

```bash
# Build images and start Redis + 2 app instances
docker compose up --build

# App 1 → http://localhost:3001
# App 2 → http://localhost:3002
# Both share the same Redis — rate limits are globally enforced
```

---

## API Reference

| Method | Path              | Description                                    |
|--------|-------------------|------------------------------------------------|
| `GET`  | `/api/test`       | Standard rate-limited endpoint                 |
| `GET`  | `/api/burst`      | High-capacity burst endpoint (5 t/s, cap 50)   |
| `GET`  | `/api/strict`     | Strict endpoint (1 t/s, cap 3)                 |
| `GET`  | `/api/user-info`  | Returns how the caller is identified           |
| `GET`  | `/status`         | Health check — Redis ping + config             |

### Rate-Limit Configuration

| Environment Variable | Default | Description                        |
|----------------------|---------|------------------------------------|
| `RL_REFILL_RATE`     | `10`    | Tokens added per second            |
| `RL_CAPACITY`        | `20`    | Max bucket size (burst limit)      |
| `RL_TTL_SECONDS`     | `3600`  | Redis key TTL (seconds)            |
| `RL_KEY_PREFIX`      | `rate_limit` | Redis key namespace           |

---

## Response Headers

Every rate-limited response includes:

```
X-RateLimit-Limit:     20
X-RateLimit-Remaining: 17
X-RateLimit-Policy:    20;w=1;burst=20;policy=token-bucket
```

On a `429 Too Many Requests`:

```
Retry-After:          2
X-RateLimit-Reset:    1714320045
```

Body:
```json
{
  "error": "Too many requests",
  "retryAfter": 2
}
```

---

## Example curl Commands

```bash
# ── 1. Basic request (IP-based) ───────────────────────────────────────────────
curl -i http://localhost:3000/api/test

# ── 2. Request with user ID header ───────────────────────────────────────────
curl -i -H "x-user-id: alice" http://localhost:3000/api/test

# ── 3. Health check ───────────────────────────────────────────────────────────
curl http://localhost:3000/status | jq

# ── 4. Trigger rate limit — fire 25 requests instantly ───────────────────────
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "x-user-id: bob" http://localhost:3000/api/test
done

# ── 5. Strict endpoint — hits limit after 3 requests ─────────────────────────
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "x-user-id: carol" http://localhost:3000/api/strict
done

# ── 6. Distributed test — same user across both app instances ─────────────────
for i in $(seq 1 25); do
  PORT=$((3001 + (i % 2)))
  curl -s -o /dev/null -w "port=${PORT}  status=%{http_code}\n" \
    -H "x-user-id: dave" http://localhost:${PORT}/api/test
done
```

---

## Load Test (100 requests)

```bash
# Default: 100 requests, concurrency 5, user = load-test-user
npm run test:load

# Custom options
node tests/loadTest.js \
  --url http://localhost:3000 \
  --user alice \
  --total 100 \
  --concurrency 10 \
  --endpoint /api/test
```

Sample output:
```
┌──────────────────────────────────────────────────────┐
│          Distributed Rate Limiter — Load Test         │
└──────────────────────────────────────────────────────┘
Target      : http://localhost:3000/api/test
User ID     : alice
Total reqs  : 100
Concurrency : 10
──────────────────────────────────────────────────────
  [  1] ✅ 200  tokens-left=19
  [  2] ✅ 200  tokens-left=18
  ...
  [ 21] 🚫 429  retry-after=1s
  ...
──────────────────────────────────────────────────────
✅  Allowed   : 20
🚫  Throttled : 80
❌  Errors    : 0
⏱   Duration  : 0.48s
📊  RPS       : 208.3
```

---

## Redis Key Design

```
rate_limit:{userId}   →  HASH
                           tokens         <float>   # current token count
                           last_refill_ms <int>     # epoch ms of last update
```

- Keys expire automatically after `RL_TTL_SECONDS` of inactivity (TTL reset on every request).
- User ID is either `user:<x-user-id>` or `ip:<req.ip>`.

---

## Advanced: Fail-Open vs. Fail-Closed

The middleware **fails-open** by default — if Redis is unreachable, requests are allowed through to avoid a Redis outage taking down the entire API.

To switch to **fail-closed**, replace the `next()` call in the `catch` block of `middleware/rateLimiter.js` with:

```js
return res.status(503).json({ error: 'Service temporarily unavailable' });
```

---

## License

MIT
# Disturbuted-rate-limiter
