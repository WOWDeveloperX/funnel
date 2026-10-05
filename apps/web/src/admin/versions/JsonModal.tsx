import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getVersion } from '../../lib/api';
import { Modal } from '../components/Modal';
import { Button, ErrorState, Spinner } from '../components/ui';
import { useT } from '../i18n';

/** What was loaded for one version (configs are immutable, so a loaded one can be shown again). */
interface Loaded {
  version: number;
  attempt: number;
  json: string | null;
  error: unknown;
}

/** Read-only view of a stored (immutable) config. `version` null = closed. */
export function JsonModal({
  version,
  funnelId,
  onClose,
}: {
  version: number | null;
  funnelId: string | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Keep showing the last version while the modal animates out (version is already null then).
  const [shownVersion, setShownVersion] = useState(version);
  if (version !== null && version !== shownVersion) setShownVersion(version);

  useEffect(() => {
    if (version === null) return;
    const controller = new AbortController();
    getVersion(version, funnelId, controller.signal)
      .then((res) => setLoaded({ version, attempt, json: JSON.stringify(res.config, null, 2), error: null }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoaded({ version, attempt, json: null, error: err });
      });
    return () => controller.abort();
  }, [version, funnelId, attempt]);

  const current = loaded?.version === shownVersion ? loaded : null;
  // A failed load stays visible only for the attempt that failed (retry shows the spinner).
  const error = current && current.attempt === attempt ? current.error : null;
  const json = current?.json ?? null;

  const copy = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text can still be selected */
    }
  };

  return (
    <Modal
      open={version !== null}
      onClose={onClose}
      size="xl"
      title={
        <>
          {t.versions.config} <span className="font-mono">v{shownVersion ?? ''}</span>
        </>
      }
      footer={
        <Button
          size="sm"
          onClick={() => void copy()}
          disabled={!json}
          icon={copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        >
          {copied ? t.versions.copied : t.versions.copyJson}
        </Button>
      }
    >
      {error != null ? (
        <ErrorState error={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : json === null ? (
        <Spinner />
      ) : (
        <pre className="overflow-auto rounded-xl border border-ad-line bg-ad-bg p-4 font-mono text-xs leading-relaxed text-ad-text-2">
          {json}
        </pre>
      )}
    </Modal>
  );
}
