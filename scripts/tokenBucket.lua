--[[
  Token Bucket Algorithm - Atomic Lua Script for Redis
  
  KEYS[1]  = rate_limit:{userId}
  ARGV[1]  = refill rate (tokens per second)
  ARGV[2]  = bucket capacity (max tokens)
  ARGV[3]  = current timestamp (milliseconds)
  ARGV[4]  = TTL in seconds
  
  Returns: table { allowed (0|1), tokens_remaining, retry_after_ms }
--]]

local key           = KEYS[1]
local refill_rate   = tonumber(ARGV[1])   -- tokens / second
local capacity      = tonumber(ARGV[2])   -- max bucket size
local now_ms        = tonumber(ARGV[3])   -- current time in ms
local ttl           = tonumber(ARGV[4])   -- key TTL in seconds

-- Read current state from Redis hash
local bucket = redis.call('HMGET', key, 'tokens', 'last_refill_ms')

local tokens         = tonumber(bucket[1])
local last_refill_ms = tonumber(bucket[2])

-- Initialise bucket on first request
if tokens == nil or last_refill_ms == nil then
  tokens         = capacity
  last_refill_ms = now_ms
end

-- Calculate elapsed time and refill tokens
local elapsed_ms    = math.max(0, now_ms - last_refill_ms)
local elapsed_sec   = elapsed_ms / 1000.0
local tokens_to_add = elapsed_sec * refill_rate

tokens = math.min(capacity, tokens + tokens_to_add)

local allowed       = 0
local retry_after_ms = 0

if tokens >= 1 then
  -- Consume one token
  tokens  = tokens - 1
  allowed = 1
else
  -- Calculate how long until the next token is available
  local tokens_needed = 1 - tokens
  retry_after_ms = math.ceil((tokens_needed / refill_rate) * 1000)
end

-- Persist updated state
redis.call('HMSET', key,
  'tokens',         tokens,
  'last_refill_ms', now_ms)

-- Reset TTL on every access so idle keys expire automatically
redis.call('EXPIRE', key, ttl)

return { allowed, tokens, retry_after_ms }
