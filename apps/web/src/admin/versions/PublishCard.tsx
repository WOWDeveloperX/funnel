/**
 * "Publish a new version": drop / pick / paste JSON → auto-validate on the server → check bars,
 * checklist (errors with JSON paths), diff vs active → confirm modal → publish.
 */
import type { ValidateResponse } from '@funnel/shared';
import clsx from 'clsx';
import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ApiError, publishConfig, validateConfig } from '../../lib/api';
import { useToast } from '../components/toast-context';
import { ActionButton, Dot, ErrorState } from '../components/ui';
import { type AdminMessages, useT } from '../i18n';
import { isUnauthorized, toastActionError } from '../lib/errors';
import { buildCheckRows, type CheckRow } from './validationModel';
import { CheckBars, CheckList, DiffView } from './ValidationReport';
import { VersionConfirmModal, type PointerChange } from './VersionConfirmModal';

/** `error`: where the syntax error is ("Line 3, column 14"), when the engine reports it. */
type Parsed = { ok: true; value: unknown } | { ok: false; error?: string };

const VALIDATE_DEBOUNCE_MS = 400;
const MAX_FILE_BYTES = 2_000_000;

/** Raw engine message kept so the location can be re-worded when the UI language changes. */
type ParsedRaw = { ok: true; value: unknown } | { ok: false; message: string };

function parseJson(text: string): ParsedRaw | null {
  if (!text.trim()) return null;
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '' };
  }
}

/**
 * Engine messages are English and differ per browser; only the position is taken from them:
 * V8 "… (line 1 column 50)" / "… at position 49", Firefox "… at line 1 column 50 …".
 */
function syntaxErrorLocation(text: string, message: string, t: AdminMessages['publish']): string | undefined {
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return t.lineColumn(lc[1]!, lc[2]!);
  const pos = /position (\d+)/i.exec(message);
  if (pos) {
    const before = text.slice(0, Number(pos[1]));
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    return t.lineColumn(line, column);
  }
  if (/unexpected end/i.test(message)) return t.truncated;
  return undefined;
}

type Status = 'idle' | 'checking' | 'valid' | 'invalid' | 'unknown';

/** Server answer (or failure) for one exact input; anything else in state is stale. */
interface CheckResult {
  text: string;
  attempt: number;
  validation: ValidateResponse | null;
  error: unknown;
}

function StatusBadge({ status }: { status: Status }) {
  const t = useT();
  if (status === 'checking') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-ad-line-3 bg-ad-chip px-2.5 py-[5px] font-mono text-[11px] font-semibold text-ad-muted">
        <LoaderCircle className="size-3 animate-spin" aria-hidden />
        {t.publish.checking}
      </span>
    );
  }
  if (status === 'valid') {
    return (
      <span className="rounded-lg border border-ok-line bg-ok-bg px-2.5 py-[5px] font-mono text-[11px] font-semibold text-ok-ink">
        {t.publish.validBadge}
      </span>
    );
  }
  if (status === 'invalid') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-bad-line bg-bad-bg px-[11px] py-[5px] font-mono text-[11px] font-semibold tracking-[0.1em] text-bad-ink">
        <Dot tone="danger" glow />
        {t.publish.failedBadge}
      </span>
    );
  }
  return null;
}

const linkBtn =
  'rounded text-signal-ink underline decoration-signal-ink/50 underline-offset-[3px] hover:decoration-signal-ink';

export function PublishCard({
  inProgressTotal,
  activeVersion = null,
  onPublished,
}: {
  inProgressTotal: number;
  activeVersion?: number | null;
  onPublished: (version: number) => void;
}) {
  const toast = useToast();
  const t = useT();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const raw = useMemo(() => parseJson(text), [text]);
  const parsed = useMemo<Parsed | null>(
    () => (raw && !raw.ok ? { ok: false, error: syntaxErrorLocation(text, raw.message, t.publish) } : raw),
    [raw, text, t],
  );
  const [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const current = check && check.text === text && check.attempt === attempt ? check : null;
  const validation = current?.validation ?? null;
  const validateError = current?.error ?? null;
  const validating = parsed?.ok === true && current === null;

  const [confirm, setConfirm] = useState<PointerChange | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounced server validation of valid JSON; a newer input aborts the previous request.
  useEffect(() => {
    if (!parsed?.ok) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      validateConfig(parsed.value, controller.signal)
        .then((res) => setCheck({ text, attempt, validation: res, error: null }))
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setCheck({ text, attempt, validation: null, error: err });
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [parsed, text, attempt]);

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t.publish.tooBig, t.publish.tooBigText);
      return;
    }
    setFileName(file.name);
    setShowPaste(false);
    setText(await file.text());
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      void loadFile(file);
      return;
    }
    const dropped = e.dataTransfer.getData('text/plain');
    if (dropped) {
      setFileName(null);
      setText(dropped);
    }
  };

  const reset = () => {
    setText('');
    setFileName(null);
    setShowPaste(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const hasInput = text.trim().length > 0;
  const parseFailed = parsed?.ok === false;

  const rows: CheckRow[] = useMemo(() => {
    if (parsed && !parsed.ok) {
      return [{ key: 'json', state: 'error', text: t.publish.notJson, path: parsed.error }];
    }
    return validation && parsed?.ok ? buildCheckRows(validation, parsed.value, t.validation) : [];
  }, [parsed, validation, t]);
  const errorCount = rows.filter((r) => r.state === 'error').length;

  const status: Status = !hasInput
    ? 'idle'
    : parseFailed || (validation && (!validation.ok || validation.existing === 'conflict'))
      ? 'invalid'
      : validating
        ? 'checking'
        : validation
          ? 'valid'
          : 'unknown';
  const invalid = status === 'invalid';

  const canPublish = !!validation && validation.ok && validation.existing !== 'conflict' && parsed?.ok === true;
  const targetVersion = validation?.summary?.version;

  const askPublish = () => {
    if (!canPublish || targetVersion === undefined) return;
    setConfirm({
      action: validation?.existing === 'identical' ? 'activate' : 'publish',
      from: activeVersion,
      to: targetVersion,
    });
    setConfirmOpen(true);
  };

  const publish = async () => {
    if (!parsed?.ok) return;
    setPublishing(true);
    try {
      const res = await publishConfig(parsed.value);
      toast.success(
        res.action === 'publish' ? t.publish.published(res.version) : t.publish.reactivated(res.version),
        t.common.newSessionsGoTo(res.activeVersion),
      );
      setConfirmOpen(false);
      reset();
      onPublished(res.activeVersion);
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof ApiError && err.status === 422 && err.body && typeof err.body === 'object') {
        // The server re-validated and refused: show its report inline.
        setCheck({ text, attempt, validation: err.body as ValidateResponse, error: null });
        toast.error(t.publish.rejected);
      } else if (err instanceof ApiError && err.status === 409) {
        toast.error(t.publish.conflict, t.publish.conflictText(String(targetVersion ?? '')));
      } else {
        toastActionError(toast, t.publish.failed, err, t);
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section
      className={clsx(
        'flex min-w-0 flex-col overflow-hidden rounded-[18px] border bg-ad-panel transition-colors duration-200',
        invalid ? 'border-bad-line' : 'border-ad-line-2',
      )}
    >
      <header
        className={clsx(
          'flex items-center justify-between gap-3 border-b px-5 py-[18px]',
          invalid ? 'border-[#3a1a1e] bg-[linear-gradient(180deg,#1a0f14,#0a1119)]' : 'border-ad-line',
        )}
      >
        <h2 className="font-display text-[17px] font-semibold text-ad-text">{t.publish.title}</h2>
        <div className="flex items-center gap-3">
          {invalid && errorCount > 0 && (
            <span className="font-mono text-xs font-medium whitespace-nowrap text-bad-ink">
              {t.publish.errors(errorCount)}
            </span>
          )}
          {hasInput && (
            <button
              type="button"
              onClick={reset}
              aria-label={t.publish.clear}
              className="rounded-md p-1 text-ad-faint hover:bg-ad-chip hover:text-ad-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </header>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={clsx(
          'mx-5 mt-[18px] flex items-center gap-4 rounded-[14px] border-[1.5px] p-4 transition-colors duration-150',
          dragOver
            ? 'border-solid border-signal bg-signal/10'
            : invalid
              ? 'border-dashed border-bad/40 bg-bad/[0.03]'
              : 'border-dashed border-signal/40 bg-signal/[0.03]',
        )}
      >
        <span
          aria-hidden
          className={clsx(
            'grid h-[52px] w-11 shrink-0 place-items-center rounded-lg border border-ad-line-3 bg-ad-sunken font-mono text-[10px] font-bold',
            hasInput ? (invalid ? 'text-bad-ink' : 'text-signal-ink') : 'text-ad-faint',
          )}
        >
          JSON
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={clsx('truncate text-sm font-semibold text-ad-text', fileName && 'font-mono')}>
            {fileName ?? (hasInput ? t.publish.pasted : t.publish.placeholderName)}
          </span>
          <span className="text-[13px] text-ad-muted">
            {t.publish.dropPrefix}{' '}
            <button type="button" className={linkBtn} onClick={() => fileInputRef.current?.click()}>
              {t.publish.choose}
            </button>{' '}
            {t.publish.or}{' '}
            <button type="button" className={linkBtn} onClick={() => setShowPaste((v) => !v)} aria-expanded={showPaste}>
              {t.publish.paste}
            </button>
          </span>
        </div>
        <StatusBadge status={status} />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
          }}
        />
      </div>

      {showPaste && (
        <textarea
          autoFocus
          aria-label={t.publish.jsonAria}
          value={text}
          onChange={(e) => {
            setFileName(null);
            setText(e.target.value);
          }}
          spellCheck={false}
          placeholder="{ … }"
          className="mx-5 mt-3 h-56 resize-y rounded-[14px] border border-ad-line-3 bg-ad-bg p-3 font-mono text-xs text-ad-text-2 placeholder:text-ad-ghost focus:border-ad-muted focus:outline-none"
        />
      )}

      <div aria-live="polite" className="flex flex-col">
        {rows.length > 0 && (
          <div className="flex flex-col gap-3.5 px-5 pt-4">
            <CheckBars rows={rows} />
            <CheckList rows={rows} showPaths={invalid} />
          </div>
        )}
        {validateError != null && !validating && (
          <div className="px-5 pt-4">
            <ErrorState
              compact
              error={validateError}
              onRetry={isUnauthorized(validateError) ? undefined : () => setAttempt((n) => n + 1)}
            />
          </div>
        )}
        {validation?.ok && validation.diff && <DiffView diff={validation.diff} className="mx-5 mt-[18px]" />}
      </div>

      <div className="mt-auto flex justify-end px-5 pt-[18px] pb-[18px]">
        <ActionButton glyph="↑" disabled={!canPublish} loading={publishing} onClick={askPublish}>
          {validation?.existing === 'identical' ? t.common.makeActive : t.common.publish}
        </ActionButton>
      </div>

      <VersionConfirmModal
        open={confirmOpen}
        change={confirm}
        inProgress={inProgressTotal}
        busy={publishing}
        onConfirm={() => void publish()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
