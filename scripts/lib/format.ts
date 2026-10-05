/**
 * Human-readable printing of validate/diff payloads (publish.ts).
 */
import type { ConfigDiff, ValidateResponse } from '@funnel/shared';

const list = (xs: string[]): string => (xs.length ? xs.join(', ') : '—');

export function formatDiff(diff: ConfigDiff): string {
  const lines: string[] = [`Diff v${diff.fromVersion} → v${diff.toVersion}`];
  for (const [key, v] of Object.entries(diff.variants)) {
    const parts: string[] = [];
    if (v.added.length) parts.push(`+${v.added.join(' +')}`);
    if (v.removed.length) parts.push(`-${v.removed.join(' -')}`);
    if (v.reordered) parts.push('reordered');
    lines.push(`  variant ${key}: ${parts.length ? parts.join('  ') : 'unchanged'}`);
    lines.push(`    sequence: ${v.sequence.join(' → ') || '(removed)'}`);
  }
  lines.push(`  steps added:    ${list(diff.stepsAdded)}`);
  lines.push(`  steps removed:  ${list(diff.stepsRemoved)}`);
  lines.push(`  steps changed:  ${list(diff.stepsChanged)}`);
  lines.push(`  events added:   ${list(diff.eventsAdded)}`);
  lines.push(`  events removed: ${list(diff.eventsRemoved)}`);
  lines.push(`  results added:  ${list(diff.resultsAdded)}`);
  lines.push(`  results removed: ${list(diff.resultsRemoved)}`);
  lines.push(`  experiment changed: ${diff.experimentChanged ? 'yes' : 'no'}`);
  return lines.join('\n');
}

export function formatValidation(v: ValidateResponse): string {
  const lines: string[] = [];
  lines.push(`Validation: ${v.ok ? '✓ ok' : '✗ invalid'}  (existing: ${v.existing})`);
  if (v.summary) {
    const s = v.summary;
    lines.push(`  ${s.funnelId} v${s.version} — ${s.title}`);
    for (const variant of s.variants) {
      lines.push(`  variant ${variant.key}: ${variant.stepCount} steps (${variant.sequence.join(' → ')})`);
    }
    lines.push(`  events:  ${list(s.eventNames)}`);
    lines.push(`  results: ${list(s.resultIds)}`);
  }
  for (const e of v.errors) lines.push(`  ✗ error:   ${e}`);
  for (const w of v.warnings) lines.push(`  ! warning: ${w}`);
  return lines.join('\n');
}
