import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useLanguage } from './lib/language';
import { LanguageProvider } from './lib/LanguageProvider';

const FunnelApp = lazy(() => import('./funnel/FunnelApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

const LOADING = { ru: 'Загрузка…', en: 'Loading…' } as const;

function PageFallback() {
  const { language } = useLanguage();
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <span className="size-8 animate-spin rounded-full border-2 border-faint/40 border-t-ink" />
      <span className="sr-only">{LOADING[language]}</span>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<FunnelApp />} />
        </Routes>
      </Suspense>
    </LanguageProvider>
  );
}
