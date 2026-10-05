/**
 * Internal admin, mounted at /admin/*: instrument rail + nested routes.
 *   /admin            → Versions (publish, history, rollback)
 *   /admin/analytics  → dashboard
 *   /admin/events     → live event log
 *   /admin/sessions   → recent sessions
 *
 * Auth: GET /api/health tells whether ADMIN_TOKEN is set. If so and no valid token is stored, the
 * sign-in screen is shown; a 401 from any admin call later returns there with a toast.
 */
import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getAdminToken, getHealth, setAdminToken, UNAUTHORIZED_EVENT, verifyAdminToken } from '../lib/api';
import { ADMIN_FOCUS } from './components/Modal';
import { SignInScreen } from './components/SignInScreen';
import { Sidebar } from './components/Sidebar';
import { ToastProvider } from './components/toast';
import { useToast } from './components/toast-context';
import { PAGE_GUTTER, Spinner } from './components/ui';
import { useT } from './i18n';
import { VersionsPage } from './versions/VersionsPage';

// Analytics pulls in recharts — load it (and the other pages) on demand.
const AnalyticsPage = lazy(() => import('./analytics/AnalyticsPage'));
const EventsPage = lazy(() => import('./events/EventsPage'));
const SessionsPage = lazy(() => import('./sessions/SessionsPage'));

const ADMIN_BG = '#05080d';

export default function AdminApp() {
  const t = useT();

  // Dark document chrome (overscroll, scrollbars, native controls) while the admin is mounted.
  useEffect(() => {
    const prevTitle = document.title;
    const body = document.body.style;
    const root = document.documentElement.style;
    const prev = { bg: body.backgroundColor, color: body.color, scheme: root.colorScheme };
    body.backgroundColor = ADMIN_BG;
    body.color = '#e6edf5';
    root.colorScheme = 'dark';
    return () => {
      document.title = prevTitle;
      body.backgroundColor = prev.bg;
      body.color = prev.color;
      root.colorScheme = prev.scheme;
    };
  }, []);

  useEffect(() => {
    document.title = t.app.documentTitle;
  }, [t]);

  return (
    <div lang={t.lang} className={`min-h-dvh bg-ad-bg font-sans text-ad-text ${ADMIN_FOCUS}`}>
      <ToastProvider>
        <AdminGate />
      </ToastProvider>
    </div>
  );
}

type AuthState =
  | { phase: 'checking' }
  | { phase: 'signin' }
  /** `tokenAuth` = the server requires a token (show "sign out"). */
  | { phase: 'ready'; tokenAuth: boolean };

function AdminGate() {
  const toast = useToast();
  const t = useT();
  const [auth, setAuth] = useState<AuthState>({ phase: 'checking' });

  // Boot: does the server require a token, and is the stored one still valid?
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      let required: boolean;
      try {
        required = (await getHealth(controller.signal)).adminAuthRequired === true;
      } catch {
        // API unreachable: open the shell, pages show their own error states.
        if (!controller.signal.aborted) setAuth({ phase: 'ready', tokenAuth: getAdminToken() !== null });
        return;
      }
      if (!required) {
        setAuth({ phase: 'ready', tokenAuth: false });
        return;
      }
      const stored = getAdminToken();
      if (!stored) {
        setAuth({ phase: 'signin' });
        return;
      }
      try {
        const ok = await verifyAdminToken(stored, controller.signal);
        if (controller.signal.aborted) return;
        if (!ok) setAdminToken(null);
        setAuth(ok ? { phase: 'ready', tokenAuth: true } : { phase: 'signin' });
      } catch {
        if (!controller.signal.aborted) setAuth({ phase: 'ready', tokenAuth: true });
      }
    })();
    return () => controller.abort();
  }, []);

  // Any 401 from an admin call → forget the token, back to sign-in (one toast).
  const onUnauthorized = useEffectEvent(() => {
    if (auth.phase === 'signin') return;
    setAdminToken(null);
    setAuth({ phase: 'signin' });
    toast.error(t.app.reauthTitle, t.app.reauthText);
  });
  useEffect(() => {
    const handler = () => onUnauthorized();
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const signOut = useCallback(() => {
    setAdminToken(null);
    setAuth({ phase: 'signin' });
  }, []);

  if (auth.phase === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="" />
      </div>
    );
  }
  if (auth.phase === 'signin') {
    return <SignInScreen onSignedIn={() => setAuth({ phase: 'ready', tokenAuth: true })} />;
  }
  return <AdminShell onSignOut={auth.tokenAuth ? signOut : undefined} />;
}

function AdminShell({ onSignOut }: { onSignOut?: () => void }) {
  const { pathname } = useLocation();

  // Start each admin page at the top (filters only change the query string, not the path).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar onSignOut={onSignOut} />
      <main className={`min-w-0 flex-1 pb-8 ${PAGE_GUTTER}`}>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route index element={<VersionsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
