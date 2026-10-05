import type { ActivationAction, VersionActivation } from '@funnel/shared';
import clsx from 'clsx';
import { useState } from 'react';
import { useT } from '../i18n';

const ACTION_CHIP: Record<ActivationAction, string> = {
  publish: 'bg-ok/10 text-ok-ink',
  rollback: 'bg-variant-a/10 text-variant-a-ink',
  activate: 'bg-ad-chip text-ad-muted',
  seed: 'bg-ad-chip text-ad-muted',
};

const COLLAPSED = 8;

/**
 * Audit label (publish | rollback): the initial seed is the first publish,
 * and switching the pointer to an older version is a rollback whichever button did it.
 */
function displayAction(a: VersionActivation): ActivationAction {
  if (a.action === 'seed') return 'publish';
  if (a.action === 'activate' && a.previousVersion !== null && a.version < a.previousVersion) return 'rollback';
  return a.action;
}

/** Audit log of activations, newest first. */
export function ActivationTimeline({ activations }: { activations: VersionActivation[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? activations : activations.slice(0, COLLAPSED);

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-ad-line-2 bg-ad-panel">
      <div className="flex items-center justify-between gap-3 border-b border-ad-line px-5 py-4">
        <h2 className="font-display text-[15px] font-semibold text-ad-text">{t.versions.audit}</h2>
      </div>
      {activations.length === 0 ? (
        <div className="mx-5 my-[18px] rounded-xl border border-dashed border-ad-chip px-4 py-[18px] text-center text-[13px] text-ad-faint">
          {t.versions.auditEmpty}
        </div>
      ) : (
        <div className="overflow-x-auto px-5 pb-3">
          <table className="w-full">
            <thead>
              <tr className="font-mono text-[10px] font-medium tracking-[0.12em] text-ad-faint">
                <th className="py-2.5 pr-3 text-left font-medium">{t.versions.auditTime}</th>
                <th className="py-2.5 pr-3 text-left font-medium">{t.versions.auditVersion}</th>
                <th className="py-2.5 text-left font-medium">{t.versions.auditAction}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const action = displayAction(a);
                return (
                  <tr key={a.id} className="border-t border-ad-line">
                    <td
                      className="py-2 pr-3 font-mono text-xs whitespace-nowrap text-ad-muted"
                      title={t.fmt.full(a.createdAt)}
                    >
                      {t.fmt.dateTime(a.createdAt)}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap text-ad-text-2">
                      {a.previousVersion !== null && a.previousVersion !== a.version && (
                        <span className="text-ad-faint">v{a.previousVersion} → </span>
                      )}
                      <b className="font-semibold text-ad-text">v{a.version}</b>
                    </td>
                    <td className="py-2">
                      <span
                        className={clsx(
                          'rounded-md px-2 py-[3px] font-mono text-[11px] font-medium',
                          ACTION_CHIP[action] ?? ACTION_CHIP.activate,
                        )}
                      >
                        {action}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activations.length > COLLAPSED && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 rounded-md py-1 text-xs text-ad-muted hover:text-ad-text"
            >
              {expanded ? t.versions.collapse : t.versions.showAll(activations.length)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
