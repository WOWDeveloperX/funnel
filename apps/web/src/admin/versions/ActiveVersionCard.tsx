/**
 * Versions page hero: active version with a live pill, stats strip, rollback control and the version
 * pointer (every stored version on a dashed line, the active one glowing).
 */
import type { VersionSummary } from '@funnel/shared';
import clsx from 'clsx';
import { RotateCcw } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { CountUp } from '../components/CountUp';
import { BLEED, Button, Eyebrow, PAGE_GUTTER, StatusPill } from '../components/ui';
import { useT } from '../i18n';
import { openAsHref } from '../lib/links';
import { variantClasses } from '../lib/variants';

/** "A open ↗" / "B open ↗" chips (new tab). */
export function OpenAsLinks({ variants, className }: { variants: string[]; className?: string }) {
  const t = useT();
  return (
    <>
      {variants.map((key) => (
        <a
          key={key}
          href={openAsHref(key)}
          target="_blank"
          rel="noreferrer"
          aria-label={t.versions.openAsAria(key)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-[filter] hover:brightness-125',
            variantClasses(key).badge,
            className,
          )}
        >
          <b className="font-mono">{key}</b> {t.versions.openAs}
        </a>
      ))}
    </>
  );
}

function Stat({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div
      className={clsx(
        'flex min-w-0 flex-col gap-1.5 bg-ad-panel px-3.5 py-3.5 sm:px-[22px]',
        !first && 'border-l border-ad-line-2',
      )}
    >
      <Eyebrow className="tracking-[0.14em]">{label}</Eyebrow>
      <span className="font-mono text-base font-semibold whitespace-nowrap text-ad-text sm:text-[22px]">
        {children}
      </span>
    </div>
  );
}

export function ActiveVersionHeader({
  funnelId,
  active,
  versions,
  rollbackTarget,
  onRollback,
  onActivate,
}: {
  funnelId: string;
  active: VersionSummary | undefined;
  versions: VersionSummary[];
  rollbackTarget: number | null;
  onRollback: () => void;
  onActivate: (version: number) => void;
}) {
  const t = useT();
  const ascending = [...versions].sort((a, b) => a.version - b.version);

  return (
    <section
      className={clsx(
        BLEED,
        PAGE_GUTTER,
        'relative mb-6 overflow-hidden border-b border-ad-line bg-[radial-gradient(50%_160%_at_0%_0%,#3dd68c1a,transparent_60%)] pt-[26px] pb-6',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <Eyebrow className="text-[11px]">
            {t.versions.activeVersion} · <span className="normal-case">{funnelId}</span>
          </Eyebrow>
          <div className="flex flex-wrap items-center gap-[18px]">
            <span className="font-display text-[56px] leading-[0.9] font-bold tracking-[-0.04em] text-ad-text sm:text-[72px]">
              {active ? `v${active.version}` : 'v—'}
            </span>
            {active ? (
              <StatusPill tone="success" pulse className="px-3 py-1.5 text-xs tracking-[0.08em]">
                {t.versions.activeBadge}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">{t.versions.noActive}</StatusPill>
            )}
          </div>
        </div>

        {active && (
          <div className="grid max-w-full grid-cols-[repeat(3,auto)] overflow-hidden rounded-[14px] border border-ad-line-2">
            <Stat label={t.versions.statPublished} first>
              <span title={t.fmt.full(active.createdAt)}>{t.fmt.dateTime(active.createdAt)}</span>
            </Stat>
            <Stat label={t.versions.statSessions}>
              <CountUp value={active.sessionCount} format={t.fmt.int} />
            </Stat>
            <Stat label={t.versions.statActive}>
              <CountUp value={active.inProgressCount} format={t.fmt.int} />
            </Stat>
          </div>
        )}
      </div>

      {ascending.length > 0 && (
        <div className="relative mt-[26px] flex flex-wrap items-center gap-x-[18px] gap-y-4 border-t border-dashed border-ad-line-2 pt-5">
          <Eyebrow className="tracking-[0.14em]">{t.versions.pointer}</Eyebrow>
          <ol
            className="-mx-3 flex min-w-0 flex-1 basis-[260px] items-center overflow-x-auto px-3 py-3 [scrollbar-width:thin]"
            aria-label={t.nav.versions}
          >
            {ascending.map((v, i) => {
              const isActive = v.version === active?.version;
              return (
                <Fragment key={v.version}>
                  {i > 0 && (
                    <li
                      aria-hidden
                      className="h-0.5 max-w-[200px] min-w-6 flex-1 bg-[repeating-linear-gradient(90deg,#2f3d4f_0_6px,transparent_6px_12px)]"
                    />
                  )}
                  <li className="flex shrink-0 items-center gap-2.5">
                    {isActive ? (
                      <>
                        <span
                          aria-current="true"
                          className="grid size-10 place-items-center rounded-xl border border-ok bg-ok-bg font-mono text-sm font-semibold text-ok-ink shadow-[0_0_24px_#3dd68c44]"
                        >
                          v{v.version}
                        </span>
                        <span className="font-mono text-xs font-semibold whitespace-nowrap text-ok-ink">
                          {t.versions.pointerActive}
                        </span>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onActivate(v.version)}
                        aria-label={t.versions.makeActiveAria(v.version)}
                        className="grid size-10 place-items-center rounded-xl border border-ad-line-3 bg-ad-panel font-mono text-sm font-semibold text-ad-muted transition-colors hover:border-ad-muted/60 hover:text-ad-text"
                      >
                        v{v.version}
                      </button>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
          <Button
            onClick={onRollback}
            disabled={rollbackTarget === null}
            icon={<RotateCcw className="size-4" aria-hidden />}
            className="ml-auto"
          >
            {rollbackTarget !== null ? t.versions.rollbackTo(rollbackTarget) : t.versions.rollback}
          </Button>
        </div>
      )}
    </section>
  );
}
