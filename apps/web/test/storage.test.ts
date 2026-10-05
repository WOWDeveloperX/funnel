/** Client-side persistence of the funnel (session id, state mirror, session snapshot). */
import { parseCatalog, parseConfig, resolveFunnel, type SessionState } from '@funnel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import v1Config from '../../../configs/funnel-v1.json';
import ruCatalog from '../../../configs/translations/workstyle-planner.ru.json';
import {
  clearSessionStorage,
  getStoredSessionId,
  readMirror,
  readSnapshot,
  setStoredSessionId,
  writeMirror,
  writeSnapshot,
} from '../src/funnel/storage';
import { MemoryStorage } from './support/browser';

function session(sessionId: string): SessionState {
  const funnel = resolveFunnel(parseConfig(v1Config), 'B');
  return {
    sessionId,
    funnelId: funnel.funnelId,
    funnelVersion: funnel.version,
    experimentId: funnel.experimentId,
    variant: 'B',
    variantSource: 'hash',
    utm: { source: null, medium: null, campaign: null },
    answers: { work_mode: 'remote' },
    currentStepId: 'timezone_span',
    resultId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-04T00:00:00.000Z',
    funnel,
    translations: [parseCatalog(ruCatalog)],
  };
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('funnel storage', () => {
  it('a written snapshot reads back by session id with the same id, answers and current step', () => {
    const s = session('sess-1');
    setStoredSessionId(s.sessionId);
    writeSnapshot(s);

    // A "reload": everything comes back from storage alone.
    const id = getStoredSessionId();
    expect(id).toBe('sess-1');
    const restored = readSnapshot(id!);
    expect(restored?.sessionId).toBe('sess-1');
    expect(restored?.answers).toEqual({ work_mode: 'remote' });
    expect(restored?.currentStepId).toBe('timezone_span');
    expect(restored?.funnelVersion).toBe(1);
    expect(restored?.variant).toBe('B');
    // The content catalogs travel with the snapshot, so an offline restore renders in any language.
    expect(restored?.translations).toEqual(s.translations);
    expect(readSnapshot('another-id')).toBeNull();
  });

  it('the state mirror keeps answers, current step and the dirty flag', () => {
    writeMirror('sess-1', { answers: { team_size: 12 }, currentStepId: 'work_mode', dirty: true, savedAt: 'now' });
    expect(readMirror('sess-1')).toEqual({
      answers: { team_size: 12 },
      currentStepId: 'work_mode',
      dirty: true,
      savedAt: 'now',
    });
    expect(readMirror('sess-2')).toBeNull();
  });

  it('corrupted JSON reads as null instead of throwing', () => {
    storage.setItem('fr.session.sess-1', '{not json');
    storage.setItem('fr.state.sess-1', '[1, 2');
    expect(readSnapshot('sess-1')).toBeNull();
    expect(readMirror('sess-1')).toBeNull();
  });

  it('clearSessionStorage forgets the session but keeps the analytics queue', () => {
    const s = session('sess-1');
    setStoredSessionId(s.sessionId);
    writeSnapshot(s);
    writeMirror('sess-1', { answers: {}, currentStepId: null, dirty: false, savedAt: '' });
    storage.setItem('fr.queue', '[]');

    clearSessionStorage('sess-1');
    expect(getStoredSessionId()).toBeNull();
    expect(readSnapshot('sess-1')).toBeNull();
    expect(readMirror('sess-1')).toBeNull();
    expect(storage.getItem('fr.queue')).toBe('[]');
  });

  it('unavailable storage never throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => setStoredSessionId('x')).not.toThrow();
    expect(getStoredSessionId()).toBeNull();
    expect(() => writeSnapshot(session('x'))).not.toThrow();
    expect(readSnapshot('x')).toBeNull();
    expect(() => clearSessionStorage('x')).not.toThrow();
  });
});
