import type { VersionSummary } from '@funnel/shared';
import clsx from 'clsx';
import { LayoutGroup, motion } from 'framer-motion';
import { EmptyState } from '../components/ui';
import { useT } from '../i18n';
import type { ContentText } from '../lib/contentText';
import { OpenAsLinks } from './ActiveVersionCard';

const ROW_BG_ACTIVE = 'rgba(14, 42, 31, 0.2)';
const ROW_BG = 'rgba(14, 42, 31, 0)';
const ROW_FLASH = 'rgba(61, 214, 140, 0.18)';

/**
 * Version history: the active version on top with a green accent bar, the rest
 * newest first. Rows are layout-animated and the ACTIVE pill is a shared layout element, so after a
 * publish / rollback the newly active row moves to the top, the pill travels with it and the row
 * flashes once. The version's title and release note (config content, translated through the
 * funnel's catalogs) are the tooltip of its label.
 */
export function VersionHistory({
  versions,
  activeVersion,
  highlight,
  contentText,
  onViewJson,
  onActivate,
}: {
  versions: VersionSummary[];
  activeVersion: number | null;
  /** Version that just became active (flash once). */
  highlight: number | null;
  /** Translates config content (title, release note) into the UI language. */
  contentText: ContentText;
  onViewJson: (version: number) => void;
  onActivate: (version: number) => void;
}) {
  const t = useT();
  // Stable sort keeps the server's newest-first order for inactive versions.
  const ordered = [...versions].sort(
    (a, b) => Number(b.version === activeVersion) - Number(a.version === activeVersion),
  );
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-ad-line-2 bg-ad-panel">
      <div className="flex items-center justify-between gap-3 border-b border-ad-line px-5 py-[18px]">
        <h2 className="font-display text-[17px] font-semibold text-ad-text">{t.versions.history}</h2>
        {versions.length > 0 && (
          <span className="font-mono text-[11px] font-medium text-ad-faint">
            {t.versions.count(t.fmt.int(versions.length), versions.length)}
          </span>
        )}
      </div>
      {versions.length === 0 ? (
        <EmptyState title={t.versions.empty} />
      ) : (
        <LayoutGroup>
          <ul>
            {ordered.map((v, i) => {
              const isActive = v.version === activeVersion;
              const base = isActive ? ROW_BG_ACTIVE : ROW_BG;
              return (
                <motion.li
                  key={v.version}
                  layout
                  className={clsx('relative flex flex-col gap-3 px-5 py-4', i > 0 && 'border-t border-ad-line')}
                  initial={false}
                  animate={{ backgroundColor: highlight === v.version ? [ROW_FLASH, base] : base }}
                  transition={{ duration: highlight === v.version ? 1.2 : 0.2 }}
                >
                  <span
                    aria-hidden
                    className={clsx('absolute inset-y-0 left-0 w-[3px]', isActive ? 'bg-ok' : 'bg-transparent')}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="font-display text-2xl font-bold tracking-[-0.02em] text-ad-text"
                      title={[v.title, v.releaseNote].flatMap((s) => (s ? [contentText(s)] : [])).join(' — ')}
                    >
                      v{v.version}
                    </span>
                    {isActive && (
                      <motion.span
                        layoutId="active-version-badge"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        className="rounded-full border border-ok-line bg-ok-bg px-[9px] py-[3px] font-mono text-[10px] font-semibold tracking-[0.08em] text-ok-ink"
                      >
                        {t.versions.activeBadge}
                      </motion.span>
                    )}
                    <span className="flex-1" />
                    <span className="font-mono text-xs font-medium whitespace-nowrap text-ad-faint">
                      <span title={t.fmt.full(v.createdAt)}>{t.fmt.dateTime(v.createdAt)}</span>
                      {' · '}
                      {t.common.sessions(t.fmt.int(v.sessionCount), v.sessionCount)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewJson(v.version)}
                      aria-label={t.versions.jsonAria(v.version)}
                      className="rounded-lg border border-ad-line-3 px-2.5 py-1.5 text-xs text-ad-text-2 transition-colors hover:bg-ad-chip hover:text-ad-text"
                    >
                      JSON
                    </button>
                    {isActive && <OpenAsLinks variants={v.variants.map((x) => x.key)} />}
                    <span className="flex-1" />
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => onActivate(v.version)}
                        aria-label={t.versions.makeActiveAria(v.version)}
                        className="rounded-lg bg-ad-text px-3 py-1.5 text-xs font-semibold text-ad-bg transition-[filter] hover:brightness-90"
                      >
                        {t.common.makeActive}
                      </button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </LayoutGroup>
      )}
    </section>
  );
}
