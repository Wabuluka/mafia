// ---------------------------------------------------------------------------
// Integration tests for the HTTP API, exercised against a real MongoDB
// instance (see the `MONGO_URI` env var this suite expects to be pointed at
// a throwaway database — see package.json's `test:integration` script).
// Skipped automatically if MONGO_URI isn't set, so the default `npm test`
// (unit tests only) doesn't require a running Mongo.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const shouldRun = Boolean(process.env.MONGO_URI);
const describeIfMongo = shouldRun ? describe : describe.skip;

describeIfMongo('HTTP API integration', () => {
  let app: Express;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    const { createApp } = await import('../app');
    const db = await import('../../db');
    const mongoDb = await db.getDb();
    await db.ensureCollections(mongoDb);
    closeDb = db.closeDb;
    app = createApp();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    const db = await import('../../db');
    const mongoDb = await db.getDb();
    await Promise.all([
      mongoDb.collection('rooms').deleteMany({}),
      mongoDb.collection('games').deleteMany({}),
      mongoDb.collection('players').deleteMany({}),
      mongoDb.collection('gameEvents').deleteMany({}),
    ]);
  });

  describe('POST /api/session', () => {
    it('issues a new anonymous session with a signed httpOnly cookie', async () => {
      const res = await request(app).post('/api/session').send({ displayName: 'Alice' });

      expect(res.status).toBe(201);
      expect(res.body.playerId).toBeDefined();
      expect(res.body.displayName).toBe('Alice');
      expect(res.body.resumed).toBe(false);

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toContain('mafia_session=');
      expect(cookieStr.toLowerCase()).toContain('httponly');
    });

    it('resumes the same identity when the session cookie is replayed', async () => {
      const first = await request(app).post('/api/session').send({ displayName: 'Bob' });
      const cookie = extractCookie(first);

      const second = await request(app).post('/api/session').set('Cookie', cookie).send({});

      expect(second.status).toBe(200);
      expect(second.body.resumed).toBe(true);
      expect(second.body.playerId).toBe(first.body.playerId);
    });

    it('defaults a display name when none is given', async () => {
      const res = await request(app).post('/api/session').send({});
      expect(res.status).toBe(201);
      expect(typeof res.body.displayName).toBe('string');
      expect(res.body.displayName.length).toBeGreaterThan(0);
    });

    it('rejects an over-long display name', async () => {
      const res = await request(app)
        .post('/api/session')
        .send({ displayName: 'x'.repeat(100) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  function extractCookie(res: request.Response): string {
    const setCookie = res.headers['set-cookie'] as string[] | string | undefined;
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookie) throw new Error('expected a Set-Cookie header on the response');
    return cookie;
  }

  async function createSession(displayName = 'Host'): Promise<{ cookie: string; playerId: string }> {
    const res = await request(app).post('/api/session').send({ displayName });
    return { cookie: extractCookie(res), playerId: res.body.playerId };
  }

  describe('POST /api/rooms', () => {
    it('rejects room creation without a session', async () => {
      const res = await request(app).post('/api/rooms').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('creates a room with a 4-character code avoiding ambiguous characters', async () => {
      const { cookie } = await createSession();
      const res = await request(app).post('/api/rooms').set('Cookie', cookie).send({});

      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/); // excludes O, I, 0, 1
      expect(res.body.status).toBe('LOBBY');
      expect(res.body.playerCount).toBe(1);
    });

    it('rejects minPlayers greater than maxPlayers', async () => {
      const { cookie } = await createSession();
      const res = await request(app)
        .post('/api/rooms')
        .set('Cookie', cookie)
        .send({ minPlayers: 10, maxPlayers: 5 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/rooms/:code', () => {
    it('returns 404 for an unknown code', async () => {
      const res = await request(app).get('/api/rooms/ABCD');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('returns only lobby metadata — no game/round/phase/role fields', async () => {
      const { cookie } = await createSession();
      const created = await request(app).post('/api/rooms').set('Cookie', cookie).send({});
      const code = created.body.code as string;

      const res = await request(app).get(`/api/rooms/${code}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['code', 'status', 'playerCount', 'maxPlayers', 'minPlayers'].sort(),
      );
      expect(res.body).not.toHaveProperty('phase');
      expect(res.body).not.toHaveProperty('players');
      expect(res.body).not.toHaveProperty('roundNumber');
    });

    it('rejects a malformed room code', async () => {
      const res = await request(app).get('/api/rooms/toolong');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/rooms/:code/join', () => {
    it('rejects joining without a session', async () => {
      const { cookie } = await createSession('Host');
      const created = await request(app).post('/api/rooms').set('Cookie', cookie).send({});
      const code = created.body.code as string;

      const res = await request(app).post(`/api/rooms/${code}/join`).send({});
      expect(res.status).toBe(401);
    });

    it('adds a new player and increments playerCount', async () => {
      const host = await createSession('Host');
      const created = await request(app).post('/api/rooms').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;

      const guest = await createSession('Guest');
      const res = await request(app).post(`/api/rooms/${code}/join`).set('Cookie', guest.cookie).send({});

      expect(res.status).toBe(200);
      expect(res.body.playerCount).toBe(2);
    });

    it('is idempotent for a player already in the room', async () => {
      const host = await createSession('Host');
      const created = await request(app).post('/api/rooms').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;

      const res = await request(app).post(`/api/rooms/${code}/join`).set('Cookie', host.cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.playerCount).toBe(1);
    });

    it('rejects joining a full room', async () => {
      const host = await createSession('Host');
      const created = await request(app)
        .post('/api/rooms')
        .set('Cookie', host.cookie)
        .send({ minPlayers: 5, maxPlayers: 5 });
      const code = created.body.code as string;

      // host already fills 1 of 5; add 4 more distinct sessions
      for (let i = 0; i < 4; i += 1) {
        const guest = await createSession(`Guest${i}`);
        const joinRes = await request(app).post(`/api/rooms/${code}/join`).set('Cookie', guest.cookie).send({});
        expect(joinRes.status).toBe(200);
      }

      const overflow = await createSession('Overflow');
      const res = await request(app).post(`/api/rooms/${code}/join`).set('Cookie', overflow.cookie).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROOM_FULL');
    });

    it('returns 404 for an unknown room code', async () => {
      const { cookie } = await createSession();
      const res = await request(app).post('/api/rooms/ZZZZ/join').set('Cookie', cookie).send({});
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/games/:id/summary', () => {
    it('returns 404 for an unknown game id', async () => {
      const res = await request(app).get('/api/games/00000000-0000-4000-8000-000000000000/summary');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GAME_NOT_FOUND');
    });

    it('rejects a malformed game id', async () => {
      const res = await request(app).get('/api/games/not-a-uuid/summary');
      expect(res.status).toBe(400);
    });

    it('refuses to reveal an in-progress game', async () => {
      const db = await import('../../db');
      const { brandFullGameState } = await import('@mafia/shared');

      const state = brandFullGameState({
        roomCode: 'ABCD' as never,
        phase: 'NIGHT',
        roundNumber: 1,
        players: [
          {
            id: '11111111-1111-4111-8111-111111111111' as never,
            name: 'Host',
            role: 'MAFIA',
            status: 'ALIVE',
            connected: true,
            isHost: true,
            isReady: true,
            joinedAt: 0,
          },
        ],
        nightActions: [],
        votes: [],
        chatLog: [],
      });

      const game = await db.gamesRepository.createGame(state);

      const res = await request(app).get(`/api/games/${game._id}/summary`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GAME_NOT_FINISHED');
      // Confirm no role leaked into the error response
      expect(JSON.stringify(res.body)).not.toContain('MAFIA');
    });

    it('reveals full roles once the game has completed', async () => {
      const db = await import('../../db');
      const { brandFullGameState } = await import('@mafia/shared');

      const state = brandFullGameState({
        roomCode: 'ABCD' as never,
        phase: 'NIGHT',
        roundNumber: 1,
        players: [
          {
            id: '11111111-1111-4111-8111-111111111111' as never,
            name: 'Host',
            role: 'MAFIA',
            status: 'DEAD',
            connected: true,
            isHost: true,
            isReady: true,
            joinedAt: 0,
          },
        ],
        nightActions: [],
        votes: [],
        chatLog: [],
      });

      const game = await db.gamesRepository.createGame(state);
      await db.gamesRepository.completeGame(game._id, 'TOWN_WIN', 'TOWN');

      const res = await request(app).get(`/api/games/${game._id}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.endReason).toBe('TOWN_WIN');
      expect(res.body.players[0].role).toBe('MAFIA');
    });
  });

  describe('error response shape', () => {
    it('every error response has the consistent { error: { code, message, requestId } } shape', async () => {
      const res = await request(app).get('/api/rooms/ZZZZ');
      expect(res.body).toMatchObject({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: expect.any(String),
          requestId: expect.any(String),
        },
      });
    });

    it('never leaks a stack trace', async () => {
      const res = await request(app).get('/api/rooms/ZZZZ');
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+:\d+/);
    });

    it('echoes X-Request-Id on the response', async () => {
      const res = await request(app).get('/health').set('X-Request-Id', 'test-req-123');
      expect(res.headers['x-request-id']).toBe('test-req-123');
    });
  });
});
