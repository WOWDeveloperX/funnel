/**
 * Publish / activate / roll back funnel configs through the admin API (no redeploy).
 *
 *   npm run publish-config -- configs/funnel-v3.json [--url http://localhost:3000] [--token T]
 *   npm run publish-config -- configs/funnel-v3.json --validate-only
 *   npm run publish-config -- --activate-only 1
 *   npm run publish-config -- --rollback
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type {
  ActivateResponse,
  AdminVersionsResponse,
  ApiErrorBody,
  PublishResponse,
  RollbackResponse,
  ValidateResponse,
} from '@funnel/shared';
import { ApiCallError, ApiClient, qs } from './lib/http';
import { COMMON_OPTIONS, FAIL, OK, intOption, resolveToken, resolveUrl, runMain } from './lib/cli';
import { formatDiff, formatValidation } from './lib/format';

const HELP = `Publish a funnel config via the admin API

Usage:
  npm run publish-config -- <config.json> [--validate-only]
  npm run publish-config -- --activate-only <version>
  npm run publish-config -- --rollback

Options:
  --url <url>                 server base URL (default $FUNNEL_URL or http://localhost:3000)
  --token <token>             admin token (default $ADMIN_TOKEN)
  --funnel <id>               funnel id for --activate-only / --rollback (default: server default)
  --validate-only             validate + diff against the active version, do not publish
  --activate-only <version>   activate an already stored version
  --rollback                  re-activate the version that was active before the current one
  -h, --help                  show this help`;

let baseUrl = '';

async function printActive(api: ApiClient, funnelId: string | undefined): Promise<void> {
  try {
    const v = await api.get<AdminVersionsResponse>(`/api/admin/versions${qs({ funnelId })}`);
    const versions = v.versions.map((x) => `v${x.version}${x.isActive ? '*' : ''}`).join(' ');
    console.log(`Active version of ${v.funnelId}: ${v.activeVersion ?? 'none'}   (stored: ${versions || '—'})`);
  } catch {
    // informational only
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: {
      ...COMMON_OPTIONS,
      'validate-only': { type: 'boolean' },
      'activate-only': { type: 'string' },
      rollback: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  baseUrl = resolveUrl(values.url);
  const api = new ApiClient(baseUrl, resolveToken(values.token));
  const funnelId = values.funnel;

  // --- activate an existing version -------------------------------------
  if (values['activate-only'] !== undefined) {
    const version = intOption(values['activate-only'], 'activate-only', 0, 1);
    const res = await api.post<ActivateResponse>(`/api/admin/versions/${version}/activate${qs({ funnelId })}`, {}, 200);
    console.log(`${OK} Active version: v${res.activeVersion} (previous: ${res.previousVersion ?? '—'})`);
    await printActive(api, funnelId);
    return 0;
  }

  // --- rollback ------------------------------------------------------------
  if (values.rollback) {
    const res = await api.request<RollbackResponse | ApiErrorBody>(
      'POST',
      '/api/admin/rollback',
      funnelId ? { funnelId } : {},
    );
    if (res.status !== 200) throw new ApiCallError('POST', '/api/admin/rollback', res.status, res.data);
    const ok = res.data as RollbackResponse;
    console.log(`${OK} Rolled back: v${ok.previousVersion ?? '—'} → v${ok.activeVersion}`);
    await printActive(api, funnelId);
    return 0;
  }

  // --- publish a file ------------------------------------------------------
  const file = positionals[0];
  if (!file) {
    console.error(`${FAIL} Missing config file path.\n\n${HELP}`);
    return 1;
  }
  const path = resolve(process.cwd(), file);
  let config: unknown;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.error(`${FAIL} Cannot read ${path}: ${(err as Error).message}`);
    return 1;
  }

  await printActive(api, funnelId);
  const validation = await api.post<ValidateResponse>('/api/admin/versions/validate', { config }, 200);
  console.log(formatValidation(validation));
  if (validation.diff) console.log(formatDiff(validation.diff));

  if (!validation.ok) {
    console.error(`\n${FAIL} Config is invalid — not published.`);
    return 1;
  }
  if (validation.existing === 'conflict') {
    console.error(
      `\n${FAIL} Version ${validation.summary?.version ?? '?'} already exists with different content. Bump "version" in the file.`,
    );
    return 1;
  }
  if (values['validate-only']) {
    console.log(`\n${OK} Valid (validate-only, nothing published).`);
    return 0;
  }

  const res = await api.request<PublishResponse | ValidateResponse | ApiErrorBody>('POST', '/api/admin/versions', {
    config,
  });
  if (res.status === 201 || res.status === 200) {
    const p = res.data as PublishResponse;
    const verb = p.action === 'publish' ? 'Published' : 'Already stored (identical) — activated';
    console.log(`\n${OK} ${verb} v${p.version}; active version is now v${p.activeVersion}.`);
    console.log('  New sessions start on it; in-progress sessions stay pinned to their versions.');
    return 0;
  }
  if (res.status === 422) {
    console.error(`\n${FAIL} Rejected by the server (422):`);
    console.error(formatValidation(res.data as ValidateResponse));
    return 1;
  }
  throw new ApiCallError('POST', '/api/admin/versions', res.status, res.data);
}

runMain(main, () => baseUrl);
