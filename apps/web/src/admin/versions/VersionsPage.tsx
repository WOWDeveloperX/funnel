/**
 * /admin — active version, publish flow, history with rollback, activation audit.
 */
import { useEffect, useMemo, useState } from 'react';
import { activateVersion, getVersions, rollback } from '../../lib/api';
import { useToast } from '../components/toast-context';
import { BLEED, ErrorState, PAGE_GUTTER, Spinner } from '../components/ui';
import { useT } from '../i18n';
import { useContentText } from '../lib/contentText';
import { toastActionError } from '../lib/errors';
import { usePolling } from '../lib/usePolling';
import { ActivationTimeline } from './ActivationTimeline';
import { ActiveVersionHeader } from './ActiveVersionCard';
import { JsonModal } from './JsonModal';
import { PublishCard } from './PublishCard';
import { VersionConfirmModal, type PointerChange } from './VersionConfirmModal';
import { VersionHistory } from './VersionHistory';

const REFRESH_MS = 10_000;

/** `via` = which endpoint confirms it: the rollback button pops the stack, picking a version pushes it. */
type Pending = PointerChange & { via: 'rollback' | 'activate' };

export function VersionsPage() {
  const toast = useToast();
  const t = useT();
  const { data, error, loading, refresh } = usePolling(
    (signal) => getVersions(undefined, signal),
    'versions',
    REFRESH_MS,
  );

  const [jsonVersion, setJsonVersion] = useState<number | null>(null);
  // `pending` survives closing so the dialog keeps its content while animating out.
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);

  // Let the "just activated" flash play once.
  useEffect(() => {
    if (highlight === null) return;
    const t = setTimeout(() => setHighlight(null), 1500);
    return () => clearTimeout(t);
  }, [highlight]);

  const activeVersion = data?.activeVersion ?? null;
  const active = data?.versions.find((v) => v.version === activeVersion);
  // Server-computed stack target (publish/activate push, rollback pops) — the same version
  // POST /admin/rollback will re-activate, so repeated rollbacks walk back through history.
  const rollbackTarget = data?.rollbackTarget ?? null;
  const inProgressTotal = useMemo(() => (data?.versions ?? []).reduce((sum, v) => sum + v.inProgressCount, 0), [data]);
  const contentText = useContentText(data?.funnelId);

  const ask = (change: Pending) => {
    setPending(change);
    setConfirmOpen(true);
  };

  const askActivate = (version: number) => {
    if (version === activeVersion) return;
    ask({
      action: activeVersion !== null && version < activeVersion ? 'rollback' : 'activate',
      from: activeVersion,
      to: version,
      via: 'activate',
    });
  };

  const askRollback = () => {
    if (rollbackTarget === null) return;
    ask({ action: 'rollback', from: activeVersion, to: rollbackTarget, via: 'rollback' });
  };

  const afterActivation = (version: number) => {
    setHighlight(version);
    refresh();
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    const viaRollback = pending.via === 'rollback';
    try {
      const res = viaRollback ? await rollback(data?.funnelId) : await activateVersion(pending.to, data?.funnelId);
      const back = activeVersion !== null && res.activeVersion < activeVersion;
      toast.success(
        back ? t.versions.rolledBack(res.activeVersion) : t.versions.activated(res.activeVersion),
        t.common.newSessionsGoTo(res.activeVersion),
      );
      setConfirmOpen(false);
      afterActivation(res.activeVersion);
    } catch (err) {
      toastActionError(toast, viaRollback ? t.versions.rollbackFailed : t.versions.switchFailed, err, t);
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {loading ? (
        <Spinner className="py-24" />
      ) : data ? (
        <>
          <ActiveVersionHeader
            funnelId={data.funnelId}
            active={active}
            versions={data.versions}
            rollbackTarget={rollbackTarget}
            onRollback={askRollback}
            onActivate={askActivate}
          />
          {error != null && (
            <div className="mb-5">
              <ErrorState error={error} onRetry={refresh} />
            </div>
          )}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <PublishCard
              inProgressTotal={inProgressTotal}
              activeVersion={activeVersion}
              onPublished={afterActivation}
            />
            <div className="flex min-w-0 flex-col gap-5">
              <VersionHistory
                versions={data.versions}
                activeVersion={activeVersion}
                highlight={highlight}
                contentText={contentText}
                onViewJson={setJsonVersion}
                onActivate={askActivate}
              />
              <ActivationTimeline activations={data.activations} />
            </div>
          </div>
        </>
      ) : (
        <div className={`${BLEED} ${PAGE_GUTTER} pt-6`}>
          <ErrorState error={error} onRetry={refresh} />
        </div>
      )}

      <JsonModal version={jsonVersion} funnelId={data?.funnelId} onClose={() => setJsonVersion(null)} />

      <VersionConfirmModal
        open={confirmOpen}
        change={pending}
        inProgress={inProgressTotal}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
