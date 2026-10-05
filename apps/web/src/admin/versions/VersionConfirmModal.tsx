/**
 * Confirmation before the active-version pointer moves (publish / activate / rollback):
 * from-version (struck) → dashed action → to-version (glowing).
 */
import { ConfirmModal } from '../components/Modal';
import { useT } from '../i18n';

export type PointerAction = 'publish' | 'activate' | 'rollback';

export interface PointerChange {
  action: PointerAction;
  from: number | null;
  to: number;
}

function VersionBox({ version, tone }: { version: number; tone: 'from' | 'to' }) {
  return (
    <span
      className={
        tone === 'from'
          ? 'grid size-14 place-items-center rounded-2xl border border-ad-line-3 bg-ad-panel font-mono text-lg font-bold text-ad-faint line-through'
          : 'grid size-14 place-items-center rounded-2xl border border-ok bg-ok-bg font-mono text-lg font-bold text-ok-ink shadow-[0_0_30px_#3dd68c44]'
      }
    >
      v{version}
    </span>
  );
}

function PointerHero({ change }: { change: PointerChange }) {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center gap-4 border-b border-ad-line bg-[radial-gradient(60%_120%_at_50%_0%,#3dd68c14,transparent_70%)] p-[26px]"
    >
      {change.from !== null && change.from !== change.to && (
        <>
          <VersionBox version={change.from} tone="from" />
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-ad-faint">
            <span className="h-0.5 w-[50px] bg-[repeating-linear-gradient(90deg,#3dd68c_0_6px,transparent_6px_10px)]" />
            {change.action}
          </span>
        </>
      )}
      <VersionBox version={change.to} tone="to" />
    </div>
  );
}

export function VersionConfirmModal({
  open,
  change,
  inProgress,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Kept while the dialog animates out. */
  change: PointerChange | null;
  /** In-progress sessions across all versions (they stay pinned). */
  inProgress: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  if (!change) return null;
  return (
    <ConfirmModal
      open={open}
      title={t.versions.confirmTitle(change.to)}
      hero={<PointerHero change={change} />}
      confirmLabel={change.action === 'publish' ? t.common.publish : t.common.makeActive}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <ul className="flex flex-col gap-2 text-sm text-ad-text-2">
        <li className="flex gap-2.5">
          <span aria-hidden className="text-ok-ink">
            →
          </span>
          {t.common.newSessionsGoTo(change.to)}
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden className="text-variant-a-ink">
            ⟲
          </span>
          <span>
            <span className="font-mono">{t.fmt.int(inProgress)}</span> {t.versions.inProgressStay(inProgress)}
          </span>
        </li>
      </ul>
    </ConfirmModal>
  );
}
