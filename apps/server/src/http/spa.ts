/**
 * Production web app: serves the built SPA and owns the app-wide 404 handler.
 * Called on the root instance (not registered as a plugin) so the 404 handler covers every route.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { sendNotFound } from './error-handler';

/**
 * Serves `webDist` (when it holds a build) with an index.html fallback for client-side routes;
 * unknown /api/* paths and missing files always get the JSON 404.
 */
export async function registerWebApp(app: FastifyInstance, webDist: string | null | undefined): Promise<void> {
  const root = webDist && existsSync(join(webDist, 'index.html')) ? webDist : null;
  if (root) {
    const assetsDir = join(root, 'assets');
    await app.register(fastifyStatic, {
      root,
      prefix: '/',
      wildcard: false,
      setHeaders(reply, filePath) {
        // Vite emits content-hashed files under /assets — cache them forever; never cache the HTML shell.
        reply.header(
          'cache-control',
          filePath.startsWith(assetsDir) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    // Only extension-less navigation routes get the SPA shell. A missing file (e.g. an old hashed
    // lazy chunk requested by a tab opened before a redeploy) must be a real 404, not index.html
    // with 200 — otherwise the browser fails with a confusing module MIME-type error.
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    const isAsset = path.startsWith('/assets/') || lastSegment.includes('.');
    if (root && !isApi && !isAsset && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return sendNotFound(request, reply);
  });
}
