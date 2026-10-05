import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('applies defaults and resolves paths', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      adminToken: undefined,
      logLevel: 'info',
      nodeEnv: 'development',
      databasePath: join(REPO_ROOT, 'data/funnel.db'),
    });
    expect(isAbsolute(c.seedConfigPath)).toBe(true);
    expect(c.seedConfigPath.endsWith(join('configs', 'funnel-v1.json'))).toBe(true);
    expect(isAbsolute(c.webDist)).toBe(true);
  });

  it('reads overrides; :memory: and absolute database paths pass through', () => {
    const c = loadConfig({
      PORT: '8080',
      HOST: '127.0.0.1',
      ADMIN_TOKEN: 's3cret',
      LOG_LEVEL: 'warn',
      DATABASE_PATH: ':memory:',
    });
    expect(c).toMatchObject({
      port: 8080,
      host: '127.0.0.1',
      adminToken: 's3cret',
      logLevel: 'warn',
      databasePath: ':memory:',
    });
    expect(loadConfig({ DATABASE_PATH: '/data/funnel.db' }).databasePath).toBe('/data/funnel.db');
  });

  it('treats empty values as unset (empty ADMIN_TOKEN → no auth)', () => {
    expect(loadConfig({ ADMIN_TOKEN: '' }).adminToken).toBeUndefined();
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
  });

  it('throws one readable error naming every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    let message = '';
    try {
      loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Invalid environment configuration/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/LOG_LEVEL/);
  });
});
