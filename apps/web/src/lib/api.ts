// ---------------------------------------------------------------------------
// Typed wrappers around the REST endpoints from the HTTP layer
// (POST /api/session, POST /api/villages, GET /api/villages/:code,
// POST /api/villages/:code/join). `credentials: 'include'` on every call so
// the signed httpOnly session cookie is sent/received — none of this ever
// reads or writes the cookie itself, only the server can.
// ---------------------------------------------------------------------------

import type {
  ChatMessage,
  GameEndReason,
  NightAction,
  Phase,
  PlayerId,
  Role,
  VillageCode,
  Vote,
} from '@mafia/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  // 204 No Content (e.g. DELETE /api/session) has no body to parse, and
  // `res.json()` on an empty body would just resolve to the same `null`
  // the catch below already produces — short-circuiting skips a pointless
  // parse attempt rather than relying on that fallback by coincidence.
  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const code = body?.error?.code ?? 'UNKNOWN_ERROR';
    const message = body?.error?.message ?? `Request to ${path} failed with status ${res.status}.`;
    throw new ApiError(code, message, res.status);
  }

  return body as T;
}

export interface SessionResponse {
  playerId: string;
  displayName: string;
  resumed: boolean;
}

/** Issues (or resumes, if a valid session cookie is already present) an
 * anonymous session. Always call this before joining/creating a village. */
export function createOrResumeSession(displayName?: string): Promise<SessionResponse> {
  return request<SessionResponse>('/api/session', {
    method: 'POST',
    body: JSON.stringify(displayName ? { displayName } : {}),
  });
}

export interface VillageSummary {
  code: VillageCode;
  /** Purely cosmetic display name — see VillageDocument.name's own doc
   * comment on the server. Always populated (a village always has some
   * name, generated if the host didn't pick one) — never used to look up
   * or identify a village, the code remains the only identifier. */
  name: string;
  status: 'LOBBY' | 'IN_GAME' | 'CLOSED';
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
}

/** `POST /villages/:code/join`'s own response shape — a superset of
 * VillageSummary's `status`. `PENDING` means a genuinely new player was
 * placed in the host-approval queue rather than admitted outright (see
 * villages.routes.ts's own doc comment on the approval gate); an existing
 * member resuming still gets back the village's real LOBBY/IN_GAME status,
 * same as before. `GET /villages/:code` can never return PENDING — it has
 * no player identity to check pending-membership against — so that call
 * keeps the narrower VillageSummary type rather than this one. */
export interface JoinVillageResult {
  code: VillageCode;
  name: string;
  status: 'LOBBY' | 'IN_GAME' | 'CLOSED' | 'PENDING';
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
}

export function createVillage(input?: {
  name?: string;
  minPlayers?: number;
  maxPlayers?: number;
}): Promise<VillageSummary> {
  return request<VillageSummary>('/api/villages', {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
}

export function getVillage(code: string): Promise<VillageSummary> {
  return request<VillageSummary>(`/api/villages/${code}`);
}

export function joinVillageHttp(code: string): Promise<JoinVillageResult> {
  return request<JoinVillageResult>(`/api/villages/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Clears the current session cookie so the browser stops resending a
 * stale/expired identity (e.g. one pointing at a player that no longer
 * exists — a dev-only DB wipe, but also reachable in production if a
 * player's record is ever pruned). The NEXT createOrResumeSession() call
 * mints a fresh identity from scratch rather than resuming the cleared
 * one. Always resolves — see the route's own doc comment on why this is
 * safe to call unconditionally, including with no session present. */
export function clearSession(): Promise<void> {
  return request<void>('/api/session', { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Post-game endpoints (GET /api/games/:id/summary, GET /api/games/:id/events)
// — both gated server-side on the game's `status === 'COMPLETED'` (see
// http/routes/games.routes.ts). `gameId` to call these with comes from
// `PlayerView.gameId`, which is only populated once a game has actually
// started — see that field's doc comment in @mafia/shared's game-state.ts.
// ---------------------------------------------------------------------------

export interface GameSummaryPlayer {
  id: PlayerId;
  name: string;
  role: Role;
  status: 'ALIVE' | 'DEAD';
}

export interface GameSummary {
  gameId: string;
  villageCode: VillageCode;
  endReason?: GameEndReason;
  winningTeam?: string;
  startedAt: string;
  endedAt?: string;
  players: GameSummaryPlayer[];
}

export function getGameSummary(gameId: string): Promise<GameSummary> {
  return request<GameSummary>(`/api/games/${gameId}/summary`);
}

/** One entry of the ordered gameEvents log — the exact union
 * `GameEventDocument` (apps/server/src/db/types.ts) carries, minus the
 * Mongo-internal `_id`/`gameId` fields a client has no use for. */
export type GameEvent =
  | { sequence: number; type: 'NIGHT_ACTION'; payload: { action: NightAction }; createdAt: string }
  | { sequence: number; type: 'VOTE'; payload: { vote: Vote }; createdAt: string }
  | { sequence: number; type: 'CHAT'; payload: { message: ChatMessage }; createdAt: string }
  | {
      sequence: number;
      type: 'PHASE_CHANGED';
      payload: { fromPhase: Phase; toPhase: Phase; roundNumber: number };
      createdAt: string;
    }
  | { sequence: number; type: 'PLAYER_JOINED'; payload: { playerId: PlayerId }; createdAt: string }
  | { sequence: number; type: 'PLAYER_LEFT'; payload: { playerId: PlayerId; reason: string }; createdAt: string }
  | {
      sequence: number;
      type: 'GAME_ENDED';
      payload: { endReason: GameEndReason; winningTeam?: string };
      createdAt: string;
    };

export interface GameEventsResponse {
  gameId: string;
  events: GameEvent[];
}

export function getGameEvents(gameId: string): Promise<GameEventsResponse> {
  return request<GameEventsResponse>(`/api/games/${gameId}/events`);
}
