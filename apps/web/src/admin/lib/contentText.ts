/**
 * Funnel content shown in the admin (result titles, step titles, version titles, release notes) is
 * config data in the funnel's source language. It is translated through the same content catalogs
 * as the public funnel (GET /api/funnels/:funnelId/translations), so the admin in Russian shows the
 * Russian copy end users see. Technical data (ids, event names, codes) is never translated.
 */
import { catalogFor, translate, type TranslationCatalog } from '@funnel/shared';
import { useEffect, useMemo, useState } from 'react';
import { getFunnelTranslations } from '../../lib/api';
import { useLanguage } from '../../lib/language';

const EMPTY: TranslationCatalog[] = [];

export type ContentText = (text: string) => string;

/** Pure: translator of config strings into `language` with the funnel's catalogs (missing → source). */
export function contentText(catalogs: readonly TranslationCatalog[], language: string): ContentText {
  const catalog = catalogFor(catalogs, language);
  return catalog ? (text) => translate(text, catalog) : (text) => text;
}

/** Catalogs are static per deploy: one request per funnel per page load (a failure is retried next time). */
const requests = new Map<string, Promise<TranslationCatalog[]>>();

function loadCatalogs(funnelId: string): Promise<TranslationCatalog[]> {
  let pending = requests.get(funnelId);
  if (!pending) {
    pending = getFunnelTranslations(funnelId).then(
      (res) => res.catalogs,
      (err: unknown) => {
        requests.delete(funnelId);
        throw err;
      },
    );
    requests.set(funnelId, pending);
  }
  return pending;
}

/**
 * Translator for the funnel's content in the selected UI language. Until the catalogs arrive (or if
 * they cannot be loaded) it returns the source text, so content is always shown.
 */
export function useContentText(funnelId: string | null | undefined): ContentText {
  const { language } = useLanguage();
  const [loaded, setLoaded] = useState<{ funnelId: string; catalogs: TranslationCatalog[] } | null>(null);

  useEffect(() => {
    if (!funnelId) return;
    let alive = true;
    loadCatalogs(funnelId).then(
      (catalogs) => {
        if (alive) setLoaded({ funnelId, catalogs });
      },
      () => {
        /* untranslated content is still correct content */
      },
    );
    return () => {
      alive = false;
    };
  }, [funnelId]);

  const catalogs = loaded && loaded.funnelId === funnelId ? loaded.catalogs : EMPTY;
  return useMemo(() => contentText(catalogs, language), [catalogs, language]);
}
