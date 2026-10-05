/**
 * Public funnel (`/`). Everything rendered comes from the resolved config of the session's pinned
 * version + variant, translated into the selected UI language through the funnel's content catalogs
 * (./localize); this component only switches between lifecycle phases and provides the page:
 * phones get the bare paper screen, ≥768px a 560px card on the dotted desk with a brand mark
 * (top-left) and the language switch (top-right).
 */
import type { SessionState } from '@funnel/shared';
import { useEffect, useMemo } from 'react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useLanguage } from '../lib/language';
import { BootErrorScreen, ExpiredScreen, LoadingScreen } from './components/Screens';
import { FunnelView } from './FunnelView';
import { StringsProvider } from './i18n';
import { localizeSession } from './localize';
import { getStoredSessionId, readSnapshot } from './storage';
import { useFunnelSession } from './useFunnelSession';

export default function FunnelApp() {
  const { state, controller } = useFunnelSession();
  const { language } = useLanguage();

  // Outside a ready session (expired at boot, boot error) the last cached snapshot still tells us
  // the funnel's title, catalogs and session TTL.
  const needsCache = !state.session && (state.phase === 'expired' || state.phase === 'error');
  const cachedSession = useMemo<SessionState | null>(() => {
    if (!needsCache) return null;
    const id = getStoredSessionId();
    return id ? readSnapshot(id) : null;
  }, [needsCache]);

  const knownSession = state.session ?? cachedSession;
  const content = useMemo(
    () => (knownSession ? localizeSession(knownSession, language) : null),
    [knownSession, language],
  );
  const knownFunnel = content?.funnel ?? null;

  // The cached snapshot names the funnel on the expired / error screens too (in the UI language).
  const title = knownFunnel?.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  let body;
  switch (state.phase) {
    case 'booting':
      body = <LoadingScreen />;
      break;
    case 'error':
      body = <BootErrorScreen kind={state.bootError} onRetry={controller.retryBoot} />;
      break;
    case 'expired':
      body = (
        <ExpiredScreen
          reason={state.expiredReason}
          ttlHours={knownFunnel?.sessionTtlHours ?? null}
          onRestart={controller.startOver}
        />
      );
      break;
    case 'ready':
      body =
        state.session && state.currentStepId && content ? (
          <FunnelView
            state={state}
            funnel={content.funnel}
            catalog={content.catalog}
            stepId={state.currentStepId}
            controller={controller}
          />
        ) : (
          <LoadingScreen />
        );
      break;
  }

  return (
    <StringsProvider language={language}>
      <main className="relative min-h-dvh bg-paper text-ink md:flex md:flex-col md:items-center md:justify-center md:bg-desk-dots md:px-6 md:pt-24 md:pb-28">
        {knownFunnel && (
          <div className="absolute top-6 left-7 hidden max-w-[calc(100%-12rem)] items-center gap-2.5 font-display text-[15px] font-semibold text-ink md:flex">
            <span
              aria-hidden
              className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-ink text-[13px] text-signal"
            >
              ◆
            </span>
            <span className="truncate">{knownFunnel.title}</span>
          </div>
        )}
        <div className="absolute top-[22px] right-7 hidden md:block">
          <LanguageSwitcher />
        </div>
        {body}
      </main>
    </StringsProvider>
  );
}
