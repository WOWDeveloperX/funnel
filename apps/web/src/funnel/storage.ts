/**
 * localStorage helpers for the public funnel. Every access is guarded: private mode, quota errors
 * or disabled storage must never break the funnel — it just loses persistence.
 *
 * Keys:
 *   fr.sessionId              current session id
 *   fr.state.<sessionId>      local mirror { answers, currentStepId } (+ dirty flag)
 *   fr.session.<sessionId>    last SessionState snapshot (lets the funnel render while offline)
 *   fr.queue                  pending analytics events (owned by events/queue.ts)
 */
import type { Answers, SessionState } from '@funnel/shared';

const SESSION_ID_KEY = 'fr.sessionId';
const stateKey = (sessionId: string) => `fr.state.${sessionId}`;
const snapshotKey = (sessionId: string) => `fr.session.${sessionId}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — persistence is best effort */
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getStoredSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function setStoredSessionId(sessionId: string): void {
  try {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  } catch {
    /* ignore */
  }
}

/** Local mirror of the server-side session state. `dirty` = not yet acknowledged by PUT /state. */
export interface StateMirror {
  answers: Answers;
  currentStepId: string | null;
  dirty: boolean;
  savedAt: string;
}

export function readMirror(sessionId: string): StateMirror | null {
  const m = readJson<StateMirror>(stateKey(sessionId));
  if (!m || typeof m !== 'object' || typeof m.answers !== 'object' || m.answers === null) return null;
  return { answers: m.answers, currentStepId: m.currentStepId ?? null, dirty: !!m.dirty, savedAt: m.savedAt ?? '' };
}

export function writeMirror(sessionId: string, mirror: StateMirror): void {
  writeJson(stateKey(sessionId), mirror);
}

export function readSnapshot(sessionId: string): SessionState | null {
  const s = readJson<SessionState>(snapshotKey(sessionId));
  return s && s.sessionId === sessionId && s.funnel ? s : null;
}

export function writeSnapshot(session: SessionState): void {
  writeJson(snapshotKey(session.sessionId), session);
}

/** Forget everything stored for a session (the event queue is kept: undelivered events still matter). */
export function clearSessionStorage(sessionId: string | null): void {
  if (sessionId) {
    removeKey(stateKey(sessionId));
    removeKey(snapshotKey(sessionId));
  }
  removeKey(SESSION_ID_KEY);
}
