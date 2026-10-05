import { NONE_CAMPAIGN } from '@funnel/shared';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '../i18n';
import { variantHex } from '../lib/variants';
import { campaignLabel, DEFAULT_FILTERS, isDefaultFilters, type Filters } from './filters';
import { HowCalculated } from './HowCalculated';
import { useDismiss } from './hooks';
import { focusRing, Seg, Switch } from './kit';

/** Page top bar: title + version / variant / campaign / override filters + "How it's calculated". */
export function FilterBar({
  filters,
  onChange,
  available,
  fetching,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  available: { versions: number[]; variants: string[]; campaigns: string[] } | undefined;
  fetching: boolean;
}) {
  const t = useT();
  const versions = mergeSelected(available?.versions ?? [], filters.version === 'all' ? [] : [filters.version]);
  const variants = mergeSelected(available?.variants ?? ['A', 'B'], filters.variant === 'all' ? [] : [filters.variant]);
  const campaigns = mergeSelected(available?.campaigns ?? [], filters.campaigns);

  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2.5 border-b border-ad-line bg-ad-top/95 px-4 py-4 backdrop-blur sm:px-7">
      <h1 className="mr-3 flex items-center gap-2 font-display text-xl font-bold tracking-[-0.02em] text-ad-text">
        {t.nav.analytics}
        <span
          aria-hidden
          className={clsx(
            'size-1.5 rounded-full bg-signal transition-opacity duration-300',
            fetching ? 'opacity-100 animate-glow' : 'opacity-0',
          )}
        />
      </h1>

      <Seg<number | 'all'>
        label={t.common.version}
        value={filters.version}
        onChange={(version) => onChange({ ...filters, version })}
        options={[{ value: 'all', label: t.common.all }, ...versions.map((v) => ({ value: v, label: `v${v}` }))]}
      />

      <Seg<string>
        label={t.common.variant}
        bold
        value={filters.variant}
        onChange={(variant) => onChange({ ...filters, variant })}
        options={[
          { value: 'all', label: variants.join('+') || t.common.all },
          ...variants.map((v, i) => ({ value: v, label: v, tint: variantHex(v, i) })),
        ]}
      />

      <CampaignSelect
        options={campaigns}
        selected={filters.campaigns}
        onChange={(c) => onChange({ ...filters, campaigns: c })}
      />

      <Switch
        checked={filters.excludeOverride}
        onChange={(excludeOverride) => onChange({ ...filters, excludeOverride })}
      >
        {t.analytics.noOverride}
      </Switch>

      {!isDefaultFilters(filters) && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className={clsx(
            'inline-flex h-[34px] items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] text-ad-muted transition-colors hover:text-ad-text',
            focusRing,
          )}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t.analytics.reset}
        </button>
      )}

      <span className="flex-1" />
      <HowCalculated />
    </div>
  );
}

/** Options from the server plus anything currently selected (so a selection never disappears). */
function mergeSelected<T extends string | number>(options: T[], selected: T[]): T[] {
  const out = [...options];
  for (const s of selected) if (!out.includes(s)) out.push(s);
  return out;
}

function CampaignSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const id = useId();
  const summary =
    selected.length === 0
      ? t.common.all
      : selected.length === 1
        ? campaignLabel(selected[0]!, t.analytics.noCampaign)
        : t.analytics.selected(selected.length);
  const toggle = (c: string) => onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex h-[34px] items-center gap-2 rounded-[10px] border px-3 text-[13px] text-ad-text-2 transition-colors',
          selected.length ? 'border-signal/45' : 'border-ad-line-3 hover:border-ad-muted',
          focusRing,
        )}
      >
        utm_campaign
        <span
          className={clsx(
            'max-w-36 truncate rounded-[5px] px-[7px] py-px font-mono text-[11px] font-medium',
            selected.length ? 'bg-signal/15 text-signal-ink' : 'bg-ad-chip text-ad-muted',
          )}
        >
          {summary}
        </span>
        <ChevronDown
          className={clsx('size-3.5 text-ad-faint transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-[14px] border border-ad-line-3 bg-ad-modal p-1.5 shadow-[0_20px_60px_#000000a0]"
          >
            {options.length === 0 ? (
              <p className="px-2.5 py-2 text-[13px] text-ad-muted">{t.analytics.noCampaigns}</p>
            ) : (
              <ul
                role="listbox"
                aria-multiselectable="true"
                aria-label="utm_campaign"
                className="max-h-72 overflow-auto"
              >
                {options.map((c) => {
                  const on = selected.includes(c);
                  return (
                    <li key={c}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggle(c)}
                        className={clsx(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left font-mono text-[13px] text-ad-text-2 hover:bg-ad-chip',
                          focusRing,
                        )}
                      >
                        <span
                          className={clsx(
                            'flex size-4 shrink-0 items-center justify-center rounded border',
                            on ? 'border-signal bg-signal text-ad-bg' : 'border-ad-line-3',
                          )}
                        >
                          {on && <Check className="size-3" strokeWidth={3} aria-hidden />}
                        </span>
                        <span className={clsx('truncate', c === NONE_CAMPAIGN && 'text-ad-muted')}>
                          {campaignLabel(c, t.analytics.noCampaign)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {selected.length > 0 && (
              <div className="mt-1 border-t border-ad-line pt-1">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className={clsx(
                    'w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-ad-muted hover:bg-ad-chip hover:text-ad-text',
                    focusRing,
                  )}
                >
                  {t.analytics.allCampaigns}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
