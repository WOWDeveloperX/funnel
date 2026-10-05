/**
 * Application context shared by every route plugin via `app.ctx`.
 */
import type { DB } from './db';
import type { TranslationStore } from './services/translations';

export interface AppContext {
  db: DB;
  /** When set, protected admin endpoints require `x-admin-token`. null = no auth (local dev). */
  adminToken: string | null;
  /** Funnel used when a request omits funnelId: the funnel of the seed config, else the first activated one. */
  defaultFunnelId: string;
  /** Content translation catalogs by funnelId, loaded at boot (display-only). */
  translations: TranslationStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
