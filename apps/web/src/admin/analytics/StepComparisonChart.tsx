import type { StepMetrics, VariantAnalytics } from '@funnel/shared';
import { useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useT } from '../i18n';
import { variantHex } from '../lib/variants';
import { Notice, Panel, Seg } from './kit';

type Metric = 'fromStart' | 'conversion' | 'dropOffRate';

type Row = { stepId: string } & Record<string, number | string | null>;

const AXIS = '#5B6878';
const GRID = '#16222F';

/**
 * Grouped bars per step_id, one bar per variant. Steps are matched by id (A and B use different
 * orders and v3-B has no tool_count), so a missing bar means "not in that variant". The result step
 * is shown only for "reached" (reaching it is the goal, not a drop-off).
 */
export function StepComparisonChart({ variants, order }: { variants: VariantAnalytics[]; order: StepMetrics[] }) {
  const t = useT();
  const metrics: { value: Metric; label: string }[] = [
    { value: 'fromStart', label: t.analytics.metricReached },
    { value: 'conversion', label: t.analytics.metricConversion },
    { value: 'dropOffRate', label: t.analytics.metricDropOff },
  ];
  const [metric, setMetric] = useState<Metric>('fromStart');
  const reduce = useReducedMotion();
  const keys = variants.map((v) => v.variant).sort();

  const data = useMemo<Row[]>(() => {
    const ids = order.map((s) => s.stepId);
    for (const v of variants) for (const s of v.steps) if (!ids.includes(s.stepId)) ids.push(s.stepId);
    const resultIds = new Set(
      [...order, ...variants.flatMap((v) => v.steps)].filter((s) => s.type === 'result').map((s) => s.stepId),
    );
    return ids
      .filter((stepId) => metric === 'fromStart' || !resultIds.has(stepId))
      .map((stepId) => {
        const row: Row = { stepId };
        for (const v of variants) {
          const s = v.steps.find((x) => x.stepId === stepId);
          row[v.variant] = s ? Math.round(s[metric] * 1000) / 10 : null;
        }
        return row;
      });
  }, [variants, order, metric]);

  return (
    <Panel
      title={t.analytics.stepsByVariant}
      aside={
        <>
          {keys.map((k, i) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: variantHex(k, i) }} />
              {k}
            </span>
          ))}
          <Seg<Metric> label={t.analytics.metric} value={metric} onChange={setMetric} options={metrics} />
        </>
      }
    >
      {variants.length === 0 || data.length === 0 ? (
        <Notice title={t.analytics.noVariantData} className="py-8" />
      ) : (
        <div className="h-72 overflow-x-auto">
          <div className="h-full min-w-[36rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: -8 }} barGap={2} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis
                  dataKey="stepId"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={76}
                  tick={{ fontSize: 11, fill: AXIS, fontFamily: 'var(--font-mono)' }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  width={48}
                  tick={{ fontSize: 11, fill: AXIS, fontFamily: 'var(--font-mono)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(138, 151, 168, 0.08)' }}
                  contentStyle={{
                    background: '#0B121B',
                    border: '1px solid #243244',
                    borderRadius: 10,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    color: '#E6EDF5',
                  }}
                  labelStyle={{ color: '#C9D4E0', marginBottom: 4 }}
                  formatter={(value, name) => [value == null ? t.analytics.noStep : `${String(value)}%`, String(name)]}
                />
                {keys.map((k, i) => (
                  <Bar
                    key={k}
                    dataKey={k}
                    name={k}
                    fill={variantHex(k, i)}
                    radius={[3, 3, 0, 0]}
                    animationDuration={300}
                    isAnimationActive={!reduce}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}
