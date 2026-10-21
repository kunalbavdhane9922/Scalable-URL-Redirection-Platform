import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../../frontend/dist');

/**
 * Route handler to serve the React UI when requested at root.
 * Per document Table 4: React + Vite + JSX frontend for submitting URLs.
 * "Frontend is not part of the redirect server's hot path."
 */
export default async function uiRoutes(fastify) {
  const indexHtmlPath = path.join(distPath, 'index.html');
  const hasDist = fs.existsSync(indexHtmlPath);

  // Serve Root /
  fastify.get('/', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    if (hasDist) {
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');
      return reply.type('text/html; charset=utf-8').send(html);
    }

    return reply.type('text/html; charset=utf-8').send(`
      <!DOCTYPE html>
      <html>
        <head><title>URL Redirection Platform</title></head>
        <body style="font-family: sans-serif; background: #0a0d14; color: #f8fafc; padding: 2rem;">
          <h1>URL Redirection Platform API</h1>
          <p>Production API is running. Build frontend with <code>npm run build</code> in /frontend.</p>
          <ul>
            <li><a style="color: #60a5fa" href="/health">/health</a></li>
            <li><a style="color: #60a5fa" href="/health/metrics">/health/metrics</a></li>
            <li><a style="color: #60a5fa" href="/api/links">/api/links</a></li>
          </ul>
        </body>
      </html>
    `);
  });

  // Serve static assets from /assets/*
  fastify.get('/assets/:filename', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const { filename } = request.params;
    // Prevent directory traversal
    const safeFilename = path.basename(filename);
    const filePath = path.join(distPath, 'assets', safeFilename);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(safeFilename).toLowerCase();
      const contentTypes = {
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      const file = fs.readFileSync(filePath);
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.type(contentType).send(file);
    }

    return reply.code(404).send({ error: 'Asset not found' });
  });
}
