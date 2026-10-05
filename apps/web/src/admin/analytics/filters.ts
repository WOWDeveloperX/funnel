/**
 * Analytics filters live in the URL (?version=3&variant=B&campaign=a,b&excludeOverride=1) so a
 * filtered dashboard can be shared or reloaded.
 */
import { type AnalyticsQuery, NONE_CAMPAIGN } from '@funnel/shared';

export interface Filters {
  version: number | 'all';
  variant: string | 'all';
  campaigns: string[];
  excludeOverride: boolean;
}

export const DEFAULT_FILTERS: Filters = { version: 'all', variant: 'all', campaigns: [], excludeOverride: false };

export function readFilters(sp: URLSearchParams): Filters {
  const v = sp.get('version');
  const n = v !== null ? Number(v) : NaN;
  const variant = sp.get('variant');
  const campaign = sp.get('campaign');
  return {
    version: Number.isInteger(n) && n > 0 ? n : 'all',
    variant: variant && variant !== 'all' ? variant : 'all',
    campaigns: campaign ? campaign.split(',').filter(Boolean) : [],
    excludeOverride: sp.get('excludeOverride') === '1',
  };
}

export function writeFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.version !== 'all') sp.set('version', String(f.version));
  if (f.variant !== 'all') sp.set('variant', f.variant);
  if (f.campaigns.length) sp.set('campaign', f.campaigns.join(','));
  if (f.excludeOverride) sp.set('excludeOverride', '1');
  return sp;
}

export function toQuery(f: Filters): AnalyticsQuery {
  return { version: f.version, variant: f.variant, campaigns: f.campaigns, excludeOverride: f.excludeOverride };
}

export function filtersKey(f: Filters): string {
  return writeFilters(f).toString();
}

export function isDefaultFilters(f: Filters): boolean {
  return filtersKey(f) === '';
}

/**
 * Display name of a utm_campaign value: sessions without one are grouped under NONE_CAMPAIGN and
 * shown as `noCampaign` (the dictionary's label, e.g. "no tag").
 */
export function campaignLabel(c: string, noCampaign: string): string {
  return c === NONE_CAMPAIGN ? noCampaign : c;
}
