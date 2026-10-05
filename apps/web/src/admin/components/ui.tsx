/**
 * Admin UI kit in the dark "instrument" look: top bar, table helpers, buttons, pills and states.
 * Plain Tailwind classes so everything can be restyled here.
 *
 * Layout contract: the shell's <main> has a horizontal gutter of PAGE_GUTTER and no top padding.
 * `PageHeader` (and anything using `BLEED`) cancels the gutter to run edge to edge.
 */
import clsx from 'clsx';
import { CircleAlert, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { variantClasses } from '../lib/variants';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Horizontal page gutter applied by the shell's <main> (16px on phones, 28px from sm). */
export const PAGE_GUTTER = 'px-4 sm:px-7';
/** Cancels PAGE_GUTTER so a block runs edge to edge (re-add the padding inside). */
export const BLEED = '-mx-4 sm:-mx-7';

/** Full-bleed top bar: page title on the left, controls inline, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Inline controls right after the title (filters, live pill…). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={clsx(
        BLEED,
        PAGE_GUTTER,
        'mb-[22px] flex flex-wrap items-center gap-x-3.5 gap-y-3 border-b border-ad-line bg-ad-top py-4',
        className,
      )}
    >
      <div className="mr-3 min-w-0">
        <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-ad-text">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-ad-muted">{description}</p>}
      </div>
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Horizontal scroll wrapper so wide tables never break narrow screens. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

/** Table header cell: mono 10px caps, faint. */
export const th =
  'whitespace-nowrap px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ad-faint';
/** Table body cell. */
export const td = 'whitespace-nowrap px-3 py-2.5 text-[13px] text-ad-text-2';

/** Mono caps label (eyebrows, stat labels): "ACTIVE VERSION". */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ad-faint', className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonTones: Record<ButtonTone, string> = {
  primary: 'bg-signal text-ad-bg hover:brightness-110 disabled:bg-ad-sunken disabled:text-ad-ghost',
  secondary:
    'border border-ad-line-3 text-ad-text-2 hover:border-ad-muted/50 hover:bg-ad-chip hover:text-ad-text disabled:border-ad-line-2 disabled:bg-transparent disabled:text-ad-ghost',
  ghost: 'text-ad-muted hover:bg-ad-chip hover:text-ad-text disabled:bg-transparent disabled:text-ad-ghost',
  danger: 'border border-bad-line bg-bad-bg text-bad-ink hover:border-bad/60 disabled:opacity-50',
};

export function Button({
  tone = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap transition-[color,background-color,border-color,filter] duration-150',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-[38px] px-3.5 text-[13px]',
        buttonTones[tone],
        className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Big lime call-to-action with a dark square glyph on the right ("Sign in →", "Publish ↑"). */
export function ActionButton({
  glyph,
  loading = false,
  className,
  children,
  disabled,
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { glyph: ReactNode; loading?: boolean; size?: 'md' | 'lg' }) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      {...rest}
      disabled={isDisabled}
      className={clsx(
        'inline-flex items-center justify-between font-semibold transition-[filter,background-color,color] duration-150',
        size === 'lg'
          ? 'h-[52px] gap-4 rounded-[14px] pr-2 pl-5 text-[15px]'
          : 'h-11 gap-4 rounded-xl pr-1.5 pl-[18px] text-sm',
        isDisabled && !loading ? 'bg-ad-sunken text-ad-ghost' : 'bg-signal text-ad-bg hover:brightness-110',
        className,
      )}
    >
      {children}
      <span
        aria-hidden
        className={clsx(
          'grid place-items-center',
          size === 'lg' ? 'size-[38px] rounded-[10px]' : 'size-8 rounded-[9px]',
          isDisabled && !loading ? 'bg-ad-line text-ad-ghost' : 'bg-ad-bg text-signal',
        )}
      >
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : glyph}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badges & pills
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-ad-line-3 bg-ad-chip text-ad-muted',
  success: 'border-ok-line bg-ok-bg text-ok-ink',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  danger: 'border-bad-line bg-bad-bg text-bad-ink',
  info: 'border-variant-a/30 bg-variant-a/10 text-variant-a-ink',
  brand: 'border-signal/35 bg-signal/10 text-signal-ink',
};

/** Solid dot colour per tone (for StatusPill). */
const dotTones: Record<BadgeTone, string> = {
  neutral: 'bg-ad-faint',
  success: 'bg-ok',
  warning: 'bg-amber-400',
  danger: 'bg-bad',
  info: 'bg-variant-a',
  brand: 'bg-signal',
};

/** Rounded status pill with a dot; `pulse` adds the expanding ring (live / active). */
export function StatusPill({
  tone = 'neutral',
  pulse = false,
  children,
  className,
}: {
  tone?: BadgeTone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap',
        badgeTones[tone],
        className,
      )}
    >
      <Dot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

/** Small status dot; `pulse` = expanding ring, `glow` = breathing opacity. */
export function Dot({
  tone = 'success',
  pulse = false,
  glow = false,
  className,
}: {
  tone?: BadgeTone;
  pulse?: boolean;
  glow?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx(
        'relative inline-block size-1.5 shrink-0 rounded-full',
        dotTones[tone],
        glow && 'animate-glow',
        className,
      )}
    >
      {pulse && <span className={clsx('absolute inset-0 animate-pulse-ring rounded-full', dotTones[tone])} />}
    </span>
  );
}

/** Variant chip in the experiment colours; override (QA) sessions get a dashed border. */
export function VariantBadge({ variant, source }: { variant: string; source?: 'hash' | 'override' }) {
  const c = variantClasses(variant);
  const override = source === 'override';
  return (
    <span
      className={clsx(
        'inline-flex min-w-6 items-center justify-center gap-1 rounded-[7px] px-1.5 py-0.5 font-mono text-[11px] font-semibold whitespace-nowrap',
        override ? c.badgeOverride : c.badge,
      )}
    >
      {variant}
      {override && <span className="font-medium opacity-80">· override</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** `label` defaults to "Loading…" in the UI language; pass "" for a bare spinner. */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  return (
    <div
      className={clsx('flex items-center justify-center gap-2 py-10 text-[13px] text-ad-muted', className)}
      role="status"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label ?? t.common.loading}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-4 py-10 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-ad-line-3 bg-ad-sunken text-ad-faint">
        {icon ?? <Inbox className="size-5" aria-hidden />}
      </div>
      <p className="text-sm font-medium text-ad-text-2">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13px] text-ad-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const t = useT();
  return (
    <div
      role="alert"
      className={clsx(
        'flex flex-wrap items-center gap-3 rounded-xl border border-bad-line bg-bad-bg/60 text-[13px] text-bad-ink',
        compact ? 'px-3 py-2' : 'px-4 py-3',
      )}
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{errorMessage(error, t)}</span>
      {onRetry && (
        <Button size="sm" tone="secondary" onClick={onRetry} icon={<RefreshCw className="size-3.5" aria-hidden />}>
          {t.common.retry}
        </Button>
      )}
    </div>
  );
}
