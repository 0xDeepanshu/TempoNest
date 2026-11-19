import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLoginRateLimiter } from '../src/modules/auth/auth.routes';
import { createApiRateLimiter } from '../src/middleware/rateLimit';

describe('api rate limiting', () => {
  it('advertises Retry-After so clients can back off', async () => {
    const app = express();
    app.use(createApiRateLimiter({ windowMs: 60_000, max: 1 }));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(second.headers['retry-after'])).toBeLessThanOrEqual(60);
  });
});

describe('login rate limiting', () => {
  it('returns a consistent 429 response after too many failed attempts', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/login',
      createLoginRateLimiter({ windowMs: 60_000, max: 2 }),
      (_req, res) => {
        res.status(401).json({ error: { code: 'INVALID_CREDENTIALS' } });
      },
    );

    const first = await request(app).post('/login').send({ email: 'a@example.com' });
    const second = await request(app).post('/login').send({ email: 'a@example.com' });
    const third = await request(app).post('/login').send({ email: 'a@example.com' });

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.headers['ratelimit-policy']).toBeTruthy();
  });
});
