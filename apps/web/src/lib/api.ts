// ---------------------------------------------------------------------------
// Typed wrappers around the REST endpoints from the HTTP layer
// (POST /api/session, POST /api/villages, GET /api/villages/:code,
// POST /api/villages/:code/join). `credentials: 'include'` on every call so
// the signed httpOnly session cookie is sent/received — none of this ever
// reads or writes the cookie itself, only the server can.
// ---------------------------------------------------------------------------

import type { VillageCode } from '@mafia/shared';

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

  const body = await res.json().catch(() => null);

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
  status: 'LOBBY' | 'IN_GAME' | 'CLOSED';
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
}

export function createVillage(input?: { minPlayers?: number; maxPlayers?: number }): Promise<VillageSummary> {
  return request<VillageSummary>('/api/villages', {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
}

export function getVillage(code: string): Promise<VillageSummary> {
  return request<VillageSummary>(`/api/villages/${code}`);
}

export function joinVillageHttp(code: string): Promise<VillageSummary> {
  return request<VillageSummary>(`/api/villages/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
