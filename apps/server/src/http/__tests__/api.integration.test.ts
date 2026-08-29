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
      mongoDb.collection('villages').deleteMany({}),
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

  describe('POST /api/villages', () => {
    it('rejects village creation without a session', async () => {
      const res = await request(app).post('/api/villages').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('creates a village with a 4-character code avoiding ambiguous characters', async () => {
      const { cookie } = await createSession();
      const res = await request(app).post('/api/villages').set('Cookie', cookie).send({});

      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/); // excludes O, I, 0, 1
      expect(res.body.status).toBe('LOBBY');
      expect(res.body.playerCount).toBe(1);
    });

    it('rejects minPlayers greater than maxPlayers', async () => {
      const { cookie } = await createSession();
      const res = await request(app)
        .post('/api/villages')
        .set('Cookie', cookie)
        .send({ minPlayers: 10, maxPlayers: 5 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/villages/:code', () => {
    it('returns 404 for an unknown code', async () => {
      const res = await request(app).get('/api/villages/ABCD');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('VILLAGE_NOT_FOUND');
    });

    it('returns only lobby metadata — no game/round/phase/role fields', async () => {
      const { cookie } = await createSession();
      const created = await request(app).post('/api/villages').set('Cookie', cookie).send({});
      const code = created.body.code as string;

      const res = await request(app).get(`/api/villages/${code}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['code', 'name', 'status', 'playerCount', 'maxPlayers', 'minPlayers'].sort(),
      );
      expect(res.body).not.toHaveProperty('phase');
      expect(res.body).not.toHaveProperty('players');
      expect(res.body).not.toHaveProperty('roundNumber');
    });

    it('rejects a malformed village code', async () => {
      const res = await request(app).get('/api/villages/toolong');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/villages/:code/join', () => {
    it('rejects joining without a session', async () => {
      const { cookie } = await createSession('Host');
      const created = await request(app).post('/api/villages').set('Cookie', cookie).send({});
      const code = created.body.code as string;

      const res = await request(app).post(`/api/villages/${code}/join`).send({});
      expect(res.status).toBe(401);
    });

    it('holds a NEW player as PENDING rather than admitting them immediately', async () => {
      const host = await createSession('Host');
      const created = await request(app).post('/api/villages').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;

      const guest = await createSession('Guest');
      const res = await request(app).post(`/api/villages/${code}/join`).set('Cookie', guest.cookie).send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
      // Still just the host — the guest is pending, not a roster member yet.
      expect(res.body.playerCount).toBe(1);
    });

    it('re-POSTing while still pending is idempotent, not re-queued', async () => {
      const host = await createSession('Host');
      const created = await request(app).post('/api/villages').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;

      const guest = await createSession('Guest');
      await request(app).post(`/api/villages/${code}/join`).set('Cookie', guest.cookie).send({});
      const res = await request(app).post(`/api/villages/${code}/join`).set('Cookie', guest.cookie).send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');

      const db = await import('../../db');
      const { VillageCodeSchema } = await import('@mafia/shared');
      const village = await db.villagesRepository.findVillageByCode(VillageCodeSchema.parse(code));
      expect(village?.pendingPlayerIds).toHaveLength(1);
    });

    it('is idempotent for a player already in the village', async () => {
      const host = await createSession('Host');
      const created = await request(app).post('/api/villages').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;

      const res = await request(app).post(`/api/villages/${code}/join`).set('Cookie', host.cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.playerCount).toBe(1);
    });

    it('rejects joining a full village', async () => {
      const db = await import('../../db');
      const { PlayerIdSchema, VillageCodeSchema } = await import('@mafia/shared');
      const host = await createSession('Host');
      const created = await request(app)
        .post('/api/villages')
        .set('Cookie', host.cookie)
        .send({ minPlayers: 5, maxPlayers: 5 });
      const code = created.body.code as string;
      const brandedCode = VillageCodeSchema.parse(code);

      // host already fills 1 of 5; approve 4 more distinct sessions
      // directly via the repository (the HTTP route now only queues NEW
      // players as pending — see the tests above — so filling the roster
      // for THIS test's purpose is the host-approval step, simulated here
      // the same way respondToJoinRequest.ts's accept branch would).
      for (let i = 0; i < 4; i += 1) {
        const guest = await createSession(`Guest${i}`);
        const joinRes = await request(app).post(`/api/villages/${code}/join`).set('Cookie', guest.cookie).send({});
        expect(joinRes.status).toBe(200);
        expect(joinRes.body.status).toBe('PENDING');
        await db.villagesRepository.promotePendingPlayer(brandedCode, PlayerIdSchema.parse(guest.playerId));
      }

      const overflow = await createSession('Overflow');
      const res = await request(app).post(`/api/villages/${code}/join`).set('Cookie', overflow.cookie).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VILLAGE_FULL');
    });

    it('returns 404 for an unknown village code', async () => {
      const { cookie } = await createSession();
      const res = await request(app).post('/api/villages/ZZZZ/join').set('Cookie', cookie).send({});
      expect(res.status).toBe(404);
    });

    it('rejects a NEW player joining a village that is already IN_GAME', async () => {
      const db = await import('../../db');
      const host = await createSession('Host');
      const created = await request(app).post('/api/villages').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;
      const { VillageCodeSchema } = await import('@mafia/shared');
      await db.villagesRepository.setVillageStatus(VillageCodeSchema.parse(code), 'IN_GAME');

      const guest = await createSession('Guest');
      const res = await request(app).post(`/api/villages/${code}/join`).set('Cookie', guest.cookie).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GAME_IN_PROGRESS');
    });

    it('lets an EXISTING member back into a village that is already IN_GAME', async () => {
      const db = await import('../../db');
      const host = await createSession('Host');
      const created = await request(app).post('/api/villages').set('Cookie', host.cookie).send({});
      const code = created.body.code as string;
      const { VillageCodeSchema } = await import('@mafia/shared');
      await db.villagesRepository.setVillageStatus(VillageCodeSchema.parse(code), 'IN_GAME');

      // The host is already on the roster from creation — this simulates
      // their tab closing/crashing mid-game and coming back via the Join
      // screen rather than a bookmarked /game/:code link.
      const res = await request(app).post(`/api/villages/${code}/join`).set('Cookie', host.cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('IN_GAME');
      expect(res.body.playerCount).toBe(1);
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
        villageCode: 'ABCD' as never,
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
        nominations: [],
        shortlistedIds: [],
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
        villageCode: 'ABCD' as never,
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
        nominations: [],
        shortlistedIds: [],
        chatLog: [],
      });

      const game = await db.gamesRepository.createGame(state);
      await db.gamesRepository.completeGame(game._id, 'TOWN_WIN', 'TOWN');

      const res = await request(app).get(`/api/games/${game._id}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.endReason).toBe('TOWN_WIN');
      expect(res.body.players[0].role).toBe('MAFIA');
    });

    it('persists a role-less host/moderator player without tripping the games collection\'s validator', async () => {
      // Regression test: the host/moderator is deliberately never assigned
      // a role (see Player.isHost's doc comment in
      // @mafia/shared/entities.ts). gamesRepository.createGame used to
      // force-cast `role: p.role as Role`, writing `role: undefined` for
      // the host and tripping MongoDB's $jsonSchema validator (`role` was
      // listed as required) with a real MongoServerError on every
      // startGame call — this only ever surfaced against a real Mongo
      // instance, never in a unit test with a mocked repository, which is
      // exactly why this lives in the integration suite.
      const db = await import('../../db');
      const { brandFullGameState } = await import('@mafia/shared');

      const state = brandFullGameState({
        villageCode: 'ABCD' as never,
        phase: 'NIGHT',
        roundNumber: 1,
        players: [
          {
            id: '11111111-1111-4111-8111-111111111111' as never,
            name: 'Host',
            // No `role` — this is the exact shape a moderator's player
            // document has once assignRoles has excluded them.
            status: 'ALIVE',
            connected: true,
            isHost: true,
            isReady: true,
            joinedAt: 0,
          },
          {
            id: '22222222-2222-4222-8222-222222222222' as never,
            name: 'Participant',
            role: 'VILLAGER',
            status: 'ALIVE',
            connected: true,
            isHost: false,
            isReady: true,
            joinedAt: 1,
          },
        ],
        nightActions: [],
        votes: [],
        nominations: [],
        shortlistedIds: [],
        chatLog: [],
      });

      // The bug manifested as a thrown MongoServerError from insertOne —
      // this call must resolve, not reject.
      const game = await db.gamesRepository.createGame(state);
      await db.gamesRepository.completeGame(game._id, 'TOWN_WIN', 'TOWN');

      const res = await request(app).get(`/api/games/${game._id}/summary`);
      expect(res.status).toBe(200);
      const host = res.body.players.find((p: { id: string }) => p.id === '11111111-1111-4111-8111-111111111111');
      expect(host?.role).toBeUndefined();
    });

    it('persists a host player whose role/revealedRole are present-but-undefined keys, not just omitted', async () => {
      // Regression test, round 2 of the same underlying issue: the first
      // fix (above) covered a player object that never had a `role` key at
      // all. But realtime/handlers/startGame.ts's (and playAgain.ts's)
      // fallback for a NEWLY-PROMOTED host — one who was a normal
      // participant in the lobby, then received `isHost: true` via a
      // mid-lobby host transfer BEFORE startGame ran — used to build that
      // player's post-assignment row as `{ ...p, role: undefined,
      // revealedRole: undefined, status: 'ALIVE' }`, which leaves `role`
      // and `revealedRole` as PRESENT object keys whose value is
      // `undefined`. The MongoDB driver encodes a present-but-undefined
      // property as a real BSON `null`, which gamesValidator's `{ enum:
      // ROLE_ENUM }` (no `null` in the enum) rejects — a different failure
      // path than a missing key, and one the first regression test above
      // does not exercise (its host fixture simply never sets `role` at
      // all, whereas this fixture sets it and then deletes it, mirroring
      // exactly what the buggy fallback produced before being fixed to
      // destructure the keys out instead).
      const db = await import('../../db');
      const { brandFullGameState } = await import('@mafia/shared');

      const hostRowWithExplicitUndefined: Record<string, unknown> = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'PromotedHost',
        role: undefined,
        revealedRole: undefined,
        status: 'ALIVE',
        connected: true,
        isHost: true,
        isReady: true,
        joinedAt: 0,
      };

      const state = brandFullGameState({
        villageCode: 'ABCD' as never,
        phase: 'NIGHT',
        roundNumber: 1,
        players: [
          hostRowWithExplicitUndefined as never,
          {
            id: '22222222-2222-4222-8222-222222222222' as never,
            name: 'Participant',
            role: 'VILLAGER',
            status: 'ALIVE',
            connected: true,
            isHost: false,
            isReady: true,
            joinedAt: 1,
          },
        ],
        nightActions: [],
        votes: [],
        nominations: [],
        shortlistedIds: [],
        chatLog: [],
      });

      // Must resolve, not reject with MongoServerError — the exact crash
      // reported after a mid-lobby host change followed by Start Game.
      const game = await db.gamesRepository.createGame(state);
      const res = await request(app).get(`/api/games/${game._id}/summary`);
      // Still in progress (no completeGame call) — just confirming the
      // write itself succeeded is the point of this test.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GAME_NOT_FINISHED');
    });
  });

  describe('error response shape', () => {
    it('every error response has the consistent { error: { code, message, requestId } } shape', async () => {
      const res = await request(app).get('/api/villages/ZZZZ');
      expect(res.body).toMatchObject({
        error: {
          code: 'VILLAGE_NOT_FOUND',
          message: expect.any(String),
          requestId: expect.any(String),
        },
      });
    });

    it('never leaks a stack trace', async () => {
      const res = await request(app).get('/api/villages/ZZZZ');
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+:\d+/);
    });

    it('echoes X-Request-Id on the response', async () => {
      const res = await request(app).get('/health').set('X-Request-Id', 'test-req-123');
      expect(res.headers['x-request-id']).toBe('test-req-123');
    });
  });
});
