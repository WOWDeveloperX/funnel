/**
 * Content localization of the public funnel. The session carries the pinned (version, variant)
 * funnel in its source language plus the funnel's translation catalogs; rendering picks the catalog
 * for the selected UI language and translates through @funnel/shared (localizeFunnel /
 * localizeResult). The controller keeps working on the untranslated funnel: ids, answers,
 * navigation, validation outcomes and analytics never depend on the language, so switching it
 * mid-flow is a pure re-render.
 */
import {
  catalogFor,
  localizeFunnel,
  localizeResult,
  type ResolvedFunnel,
  type SessionState,
  type TranslationCatalog,
} from '@funnel/shared';
import type { ResultView } from './session/controller';

export interface LocalizedContent {
  funnel: ResolvedFunnel;
  /** null = no catalog for the language: the source text is shown as is. */
  catalog: TranslationCatalog | null;
}

/**
 * The session's funnel in `language`. Snapshots cached before catalogs existed have no
 * `translations`: they simply render in the source language.
 */
export function localizeSession(
  session: Pick<SessionState, 'funnel'> & { translations?: SessionState['translations'] },
  language: string,
): LocalizedContent {
  const catalog = catalogFor(session.translations ?? [], language);
  return { funnel: localizeFunnel(session.funnel, catalog), catalog };
}

/**
 * The result view with the result's copy translated. A result without `badge` shows its humanized
 * id as the tag; when the catalog translates that text, the translation becomes the badge.
 */
export function localizeResultView(view: ResultView, catalog: TranslationCatalog | null): ResultView {
  if (view.status !== 'ready' || !catalog) return view;
  return { ...view, result: localizeResult(view.result, catalog, view.resultId) };
}
