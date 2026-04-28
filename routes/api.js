import { Router }     from 'express';
import { rateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// ── GET /api/test — standard limit (inherits global defaults) ────────────────
router.get('/test', rateLimiter(), (req, res) => {
  res.json({
    success:   true,
    message:   'Request allowed',
    timestamp: new Date().toISOString(),
    userId:    req.headers['x-user-id'] || req.ip,
  });
});

// ── GET /api/burst — generous burst allowance ─────────────────────────────────
router.get('/burst', rateLimiter({ refillRate: 5, capacity: 50 }), (req, res) => {
  res.json({
    success:   true,
    message:   'Burst endpoint — high capacity, slower refill',
    timestamp: new Date().toISOString(),
  });
});

// ── GET /api/strict — tight limit for sensitive endpoints ────────────────────
router.get('/strict', rateLimiter({ refillRate: 1, capacity: 3 }), (req, res) => {
  res.json({
    success:   true,
    message:   'Strict endpoint — 1 token/sec, capacity 3',
    timestamp: new Date().toISOString(),
  });
});

// ── GET /api/user-info — echo resolved identity ───────────────────────────────
router.get('/user-info', rateLimiter(), (req, res) => {
  const userId = req.headers['x-user-id'] || null;
  res.json({
    resolvedAs: userId ? `user:${userId}` : `ip:${req.ip}`,
    userIdHeader: userId,
    ip: req.ip,
  });
});

export default router;
