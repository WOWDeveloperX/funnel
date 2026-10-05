/**
 * Per-session derivation for analytics: raw events → order-independent evidence → per-step facts
 * on the session's own pinned (version, variant) sequence. See ./index.ts for the definitions.
 */
import { CORE_EVENTS, NONE_CAMPAIGN, type FunnelConfig } from '@funnel/shared';
import type { DB } from '../../db';
import { getResolvedFunnel, getVersionConfig, listVersionNumbers } from '../versions';

export const CORE_EVENT_SET: ReadonlySet<string> = new Set(CORE_EVENTS);
/** Events whose step_id is evidence that the step was shown. */
const VIEW_EVIDENCE_EVENTS: ReadonlySet<string> = new Set([
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
]);

export interface SessionRow {
  id: string;
  funnel_version: number;
  variant: string;
  variant_source: string;
  utm_campaign: string | null;
  result_id: string | null;
  created_at: string;
}

export interface EventRow {
  session_id: string;
  name: string;
  step_id: string | null;
  client_ts: string | null;
  properties_json: string;
}

/** Raw per-session evidence gathered while streaming events (order-independent). */
interface StepEvidence {
  evidence: boolean;
  completed: boolean;
  back: boolean;
  /** Number of step_viewed events (repeat views). */
  views: number;
  /** Earliest parseable client timestamp of any event on this step (ms), for out-of-order detection. */
  minTs: number;
}

export interface SessionAccumulator {
  steps: Map<string, StepEvidence>;
  resultViewed: boolean;
  ctaClicked: boolean;
  resultMinTs: number;
  /** Earliest client_ts of a result_viewed event (ms). */
  resultViewedMinTs: number;
  /** Earliest client_ts of any event other than result_viewed (ms); session_started has none. */
  firstClientTs: number;
  backAny: boolean;
  names: Set<string>;
}

interface StepFacts {
  arrived: boolean;
  viewed: boolean;
  progressed: boolean;
  back: boolean;
  views: number;
}

/** Everything aggregation needs about one session. */
export interface SessionFacts {
  id: string;
  version: number;
  variant: string;
  override: boolean;
  campaign: string;
  /** Key of the resolved (version, variant) pair, or null when the pinned config is unavailable. */
  pairKey: string | null;
  resultId: string | null;
  reachedResult: boolean;
  /** Result events without a server-side result (ignored for reach; counted in dataQuality). */
  unverifiedResult: boolean;
  ctaClicked: boolean;
  backAny: boolean;
  outOfOrder: boolean;
  /** Seconds from the first client event to the first result_viewed (≥ 0); null if not measurable. */
  timeToResultSec: number | null;
  /** Only steps of the session's own sequence. */
  steps: Map<string, StepFacts>;
  /** Non-core event names this session emitted. */
  extraEvents: Set<string>;
}

export interface PairInfo {
  key: string;
  version: number;
  variant: string;
  sequence: string[];
  position: Map<string, number>;
  conditional: Set<string>;
  resultStepId: string | null;
}

function pairKey(version: number, variant: string): string {
  return `${version}\u0000${variant}`;
}

export function campaignLabel(c: string | null): string {
  return c === null || c === '' ? NONE_CAMPAIGN : c;
}

function parseTs(ts: string | null): number {
  if (!ts) return Number.NaN;
  return Date.parse(ts);
}

export function newAccumulator(): SessionAccumulator {
  return {
    steps: new Map(),
    resultViewed: false,
    ctaClicked: false,
    resultMinTs: Number.POSITIVE_INFINITY,
    resultViewedMinTs: Number.POSITIVE_INFINITY,
    firstClientTs: Number.POSITIVE_INFINITY,
    backAny: false,
    names: new Set(),
  };
}

export function accumulate(acc: SessionAccumulator, ev: EventRow): void {
  acc.names.add(ev.name);
  const ts = parseTs(ev.client_ts);
  if (Number.isFinite(ts)) {
    if (ev.name === 'result_viewed') acc.resultViewedMinTs = Math.min(acc.resultViewedMinTs, ts);
    else acc.firstClientTs = Math.min(acc.firstClientTs, ts);
  }

  if (ev.name === 'result_viewed' || ev.name === 'cta_clicked') {
    if (ev.name === 'result_viewed') acc.resultViewed = true;
    else acc.ctaClicked = true;
    if (Number.isFinite(ts)) acc.resultMinTs = Math.min(acc.resultMinTs, ts);
    return;
  }
  if (ev.name === 'back_clicked') acc.backAny = true;
  if (!ev.step_id || !VIEW_EVIDENCE_EVENTS.has(ev.name)) return;

  let st = acc.steps.get(ev.step_id);
  if (!st) {
    st = { evidence: false, completed: false, back: false, views: 0, minTs: Number.POSITIVE_INFINITY };
    acc.steps.set(ev.step_id, st);
  }
  st.evidence = true;
  if (ev.name === 'step_viewed') st.views += 1;
  else if (ev.name === 'step_completed') st.completed = true;
  else if (ev.name === 'back_clicked') st.back = true;
  if (Number.isFinite(ts)) st.minTs = Math.min(st.minTs, ts);
}

/**
 * Seconds from the session's first client event to its first result_viewed (client clocks on both
 * ends). Start falls back to sessions.created_at when no other event carries a client timestamp;
 * negative spans (client clock behind the server, or skewed timestamps) clamp to 0. null when the
 * session has no result_viewed with a parseable client_ts (e.g. only cta_clicked arrived).
 */
function timeToResultSec(row: SessionRow, acc: SessionAccumulator): number | null {
  const end = acc.resultViewedMinTs;
  if (!Number.isFinite(end)) return null;
  const start = Number.isFinite(acc.firstClientTs) ? acc.firstClientTs : parseTs(row.created_at);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, end - start) / 1000;
}

/** Turns raw evidence into per-step facts using the session's own sequence positions. */
export function deriveFacts(row: SessionRow, acc: SessionAccumulator, pair: PairInfo | null): SessionFacts {
  // Result reach must be backed by the server-side result (POST /result ran): a client cannot make a
  // session "reach" a result, or pick its result_id, by sending result events alone.
  const resultEvents = acc.resultViewed || acc.ctaClicked;
  const verified = row.result_id !== null;
  const reachedResult = resultEvents && verified;
  const ctaClicked = acc.ctaClicked && verified;
  const facts: SessionFacts = {
    id: row.id,
    version: row.funnel_version,
    variant: row.variant,
    override: row.variant_source === 'override',
    campaign: campaignLabel(row.utm_campaign),
    pairKey: pair?.key ?? null,
    resultId: row.result_id,
    reachedResult,
    unverifiedResult: resultEvents && !verified,
    ctaClicked,
    backAny: acc.backAny,
    outOfOrder: false,
    timeToResultSec: reachedResult ? timeToResultSec(row, acc) : null,
    steps: new Map(),
    extraEvents: new Set([...acc.names].filter((n) => !CORE_EVENT_SET.has(n))),
  };
  if (!pair) return facts;

  // maxPos: furthest position the session provably reached.
  let maxPos = Number.NEGATIVE_INFINITY;
  for (const [stepId, st] of acc.steps) {
    const pos = pair.position.get(stepId);
    if (pos === undefined) continue; // step not in this session's sequence — no position, ignored
    maxPos = Math.max(maxPos, st.completed ? pos + 0.5 : pos);
  }
  const resultPos = pair.resultStepId !== null ? pair.position.get(pair.resultStepId) : undefined;
  if (reachedResult && resultPos !== undefined) maxPos = Math.max(maxPos, resultPos);

  for (const stepId of pair.sequence) {
    const pos = pair.position.get(stepId) as number;
    const st = acc.steps.get(stepId);
    const isResult = stepId === pair.resultStepId;
    const implied = !pair.conditional.has(stepId) && maxPos > pos;
    const viewed = Boolean(st?.evidence) || implied || (isResult && reachedResult);
    const progressed = viewed && (isResult ? ctaClicked : Boolean(st?.completed) || maxPos > pos);
    facts.steps.set(stepId, {
      arrived: viewed || maxPos >= pos,
      viewed,
      progressed,
      back: Boolean(st?.back),
      views: st?.views ?? 0,
    });
  }

  // Out of order: the first event on some step carries a client_ts earlier than the first event of an
  // earlier-positioned unconditional step. Unconditional steps must be passed before anything after
  // them is shown (back navigation cannot cause this; a late-opened branch step can't trigger it either).
  let runningMax = Number.NEGATIVE_INFINITY;
  for (const stepId of pair.sequence) {
    const isResult = stepId === pair.resultStepId;
    let first = acc.steps.get(stepId)?.minTs ?? Number.POSITIVE_INFINITY;
    if (isResult) first = Math.min(first, acc.resultMinTs);
    if (!Number.isFinite(first)) continue;
    if (first < runningMax) {
      facts.outOfOrder = true;
      break;
    }
    if (!pair.conditional.has(stepId)) runningMax = Math.max(runningMax, first);
  }
  return facts;
}

/**
 * Display order of steps across several sequences: a single sequence is used as-is; otherwise each
 * step gets the average of its normalized positions (i / (len - 1)) over the sequences containing it,
 * ties broken by first appearance (stable).
 */
export function mergeStepOrder(sequences: readonly (readonly string[])[]): string[] {
  if (sequences.length === 1) return [...(sequences[0] ?? [])];
  const stats = new Map<string, { sum: number; count: number; first: number }>();
  let seen = 0;
  for (const seq of sequences) {
    const denom = Math.max(1, seq.length - 1);
    seq.forEach((id, i) => {
      let s = stats.get(id);
      if (!s) {
        s = { sum: 0, count: 0, first: seen++ };
        stats.set(id, s);
      }
      s.sum += i / denom;
      s.count += 1;
    });
  }
  return [...stats.entries()]
    .sort(([, a], [, b]) => a.sum / a.count - b.sum / b.count || a.first - b.first)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Config catalog: every stored config of the funnel + resolved (version, variant) pairs
// ---------------------------------------------------------------------------

export interface ConfigCatalog {
  configs: Map<number, FunnelConfig>;
  pairs: Map<string, PairInfo>;
  getPair(version: number, variant: string): PairInfo | null;
}

/**
 * Collects every stored config of the funnel (parsed configs and resolved funnels come from the
 * per-connection cache in services/versions.ts); (version, variant) pairs are resolved lazily.
 */
export function loadCatalog(db: DB, funnelId: string): ConfigCatalog {
  const configs = new Map<number, FunnelConfig>();
  for (const version of listVersionNumbers(db, funnelId)) {
    try {
      const config = getVersionConfig(db, funnelId, version);
      if (config) configs.set(version, config);
    } catch {
      // A stored config that no longer parses is skipped; its sessions still count in KPIs.
    }
  }
  const pairs = new Map<string, PairInfo>();
  const missing = new Set<string>();
  return {
    configs,
    pairs,
    getPair(version, variant) {
      const key = pairKey(version, variant);
      const cached = pairs.get(key);
      if (cached) return cached;
      if (missing.has(key)) return null;
      const funnel = configs.has(version) ? getResolvedFunnel(db, funnelId, version, variant) : null;
      if (!funnel) {
        missing.add(key);
        return null;
      }
      const position = new Map(funnel.stepSequence.map((id, i) => [id, i] as const));
      const conditional = new Set(funnel.stepSequence.filter((id) => funnel.steps[id]?.visibleWhen !== undefined));
      const resultStepId = funnel.stepSequence.find((id) => funnel.steps[id]?.type === 'result') ?? null;
      const info: PairInfo = {
        key,
        version,
        variant,
        sequence: funnel.stepSequence,
        position,
        conditional,
        resultStepId,
      };
      pairs.set(key, info);
      return info;
    },
  };
}
