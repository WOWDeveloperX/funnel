/**
 * Admin sign-in: left hero with grid texture and live server status,
 * right form. The token is checked against a protected read before it is stored.
 */
import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { getHealth, setAdminToken, verifyAdminToken } from '../../lib/api';
import { useT } from '../i18n';
import { usePolling } from '../lib/usePolling';
import { LogoMark } from './Sidebar';
import { ActionButton, Dot } from './ui';

const SECTIONS = ['versions', 'analytics', 'events', 'sessions'] as const;
const HEALTH_POLL_MS = 10_000;

type ApiStatus = 'checking' | 'online' | 'offline';

/** Live server status for the hero: the last health check failed → offline. */
function useApiStatus(): ApiStatus {
  const { data, error } = usePolling(getHealth, 'health', HEALTH_POLL_MS);
  if (error != null) return 'offline';
  return data ? 'online' : 'checking';
}

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT();
  const status = useApiStatus();
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Every failed attempt bumps shakeKey; the field shakes until the 400ms animation has played.
  const [shakeDone, setShakeDone] = useState(0);
  const shaking = shakeKey !== shakeDone;
  useEffect(() => {
    if (!shaking) return;
    const timer = setTimeout(() => setShakeDone(shakeKey), 400);
    return () => clearTimeout(timer);
  }, [shaking, shakeKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) {
      setError(t.signIn.emptyToken);
      setShakeKey((n) => n + 1);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyAdminToken(value);
      if (ok) {
        setAdminToken(value);
        onSignedIn();
        return;
      }
      setError(t.signIn.invalidToken);
    } catch {
      setError(t.signIn.unreachable);
    } finally {
      setBusy(false);
    }
    setShakeKey((n) => n + 1);
    inputRef.current?.focus();
  };

  return (
    <div className="grid min-h-dvh bg-ad-root text-ad-text md:grid-cols-2">
      {/* Hero */}
      <section className="relative flex min-h-[260px] flex-col justify-between gap-10 overflow-hidden border-b border-ad-line p-6 sm:p-11 md:border-r md:border-b-0">
        <div
          aria-hidden
          className="absolute inset-0 bg-ad-grid [mask-image:radial-gradient(70%_70%_at_30%_60%,#000,transparent)]"
        />
        <div className="relative flex items-center gap-3">
          <LogoMark size="lg" />
          <span className="font-display text-[17px] font-semibold">Funnel Runtime</span>
          <span className="rounded-md border border-ad-line-3 px-2 py-[3px] font-mono text-[11px] font-medium text-ad-muted">
            admin
          </span>
          <LanguageSwitcher tone="admin" size="sm" className="ml-auto" />
        </div>
        <div className="relative flex flex-col gap-3.5">
          <h1 className="font-display text-[40px] leading-none font-bold tracking-[-0.04em] sm:text-[52px]">
            {t.signIn.heroLine1}
            <br />
            {t.signIn.heroLine2}
          </h1>
          <ul className="flex flex-wrap gap-2" aria-label={t.nav.sections}>
            {SECTIONS.map((r) => (
              <li
                key={r}
                className="rounded-lg border border-ad-line-3 px-2.5 py-1.5 text-xs font-medium text-ad-muted"
              >
                {t.nav[r]}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 font-mono text-xs font-medium text-ad-faint" role="status">
          <Dot
            tone={status === 'offline' ? 'danger' : status === 'online' ? 'success' : 'neutral'}
            glow={status !== 'offline'}
          />
          {status === 'offline' ? t.signIn.serverDown : status === 'online' ? t.signIn.serverUp : t.signIn.checking}
        </p>
      </section>

      {/* Form */}
      <section className="grid place-items-center bg-[radial-gradient(60%_60%_at_50%_40%,#c8f54a0d,transparent_70%)] px-4 py-12">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex w-full max-w-[400px] flex-col gap-5">
          <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">{t.signIn.title}</h2>

          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="font-mono text-[10px] font-medium tracking-[0.16em] text-ad-faint">
              {t.signIn.tokenLabel}
            </label>
            <div
              className={clsx(
                'flex h-[52px] items-center gap-3 rounded-[14px] border bg-[#0a0e14] pr-2 pl-4 transition-[border-color,box-shadow] duration-150',
                shaking && 'animate-shake',
                error
                  ? 'border-bad shadow-[0_0_0_4px_#ff5a5f1a]'
                  : 'border-ad-line-3 focus-within:border-ad-muted focus-within:shadow-[0_0_0_4px_#c8f54a14]',
              )}
            >
              <input
                ref={inputRef}
                id={fieldId}
                name="admin-token"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                spellCheck={false}
                autoCapitalize="off"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={clsx(
                  'min-w-0 flex-1 bg-transparent font-mono text-base font-medium text-ad-text-2 placeholder:text-ad-ghost focus:outline-none',
                  !visible && token && 'tracking-[0.2em]',
                )}
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-pressed={visible}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-ad-faint hover:text-ad-text-2"
              >
                {visible ? t.signIn.hide : t.signIn.show}
              </button>
            </div>
            {error && (
              <p id={errorId} role="alert" className="flex items-center gap-2 text-[13px] text-bad-ink">
                <Dot tone="danger" />
                {error}
              </p>
            )}
          </div>

          <ActionButton type="submit" size="lg" glyph="→" loading={busy} className="w-full">
            {t.signIn.submit}
          </ActionButton>
        </form>
      </section>
    </div>
  );
}
