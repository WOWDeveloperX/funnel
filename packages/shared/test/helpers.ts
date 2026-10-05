import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type FunnelConfig, parseConfig, resolveFunnel, type ResolvedFunnel } from '../src/index';

const configsDir = fileURLToPath(new URL('../../../configs/', import.meta.url));

export function loadRaw(name: 'funnel-v1.json' | 'funnel-v3.json'): Record<string, unknown> {
  return JSON.parse(readFileSync(configsDir + name, 'utf8')) as Record<string, unknown>;
}

function loadConfig(name: 'funnel-v1.json' | 'funnel-v3.json'): FunnelConfig {
  return parseConfig(loadRaw(name));
}

export const v1 = (): FunnelConfig => loadConfig('funnel-v1.json');
export const v3 = (): FunnelConfig => loadConfig('funnel-v3.json');
export const resolved = (cfg: FunnelConfig, variant: 'A' | 'B'): ResolvedFunnel => resolveFunnel(cfg, variant);
