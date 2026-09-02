'use strict';

/**
 * Vercel serverless entry point. vercel.json rewrites every /api/* request
 * to this catch-all; the routing itself lives in lib/api.js, shared with the
 * self-hosted server in server.js.
 *
 * Static pages are served from public/ by Vercel's CDN, so this function only
 * ever sees API calls.
 */

const { serveApi } = require('../lib/api');

/**
 * Recover the path the caller actually asked for.
 *
 * A rewrite can hand the function its own filename instead of the original
 * path, putting the segments in a `path` query parameter. Accept either shape
 * so routing does not depend on which one Vercel uses.
 */
function requestedUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `https://${host}`);

  if (!url.pathname.includes('[') && url.pathname.startsWith('/api/')) {
    return url;
  }

  const segments = url.searchParams.get('path')
    ?? url.searchParams.get('...path')
    ?? '';
  if (segments) {
    url.pathname = `/api/${segments.replace(/^\/+/, '')}`;
    // These were added by the rewrite, not sent by the caller.
    url.searchParams.delete('path');
    url.searchParams.delete('...path');
  }
  return url;
}

module.exports = async function handler(req, res) {
  await serveApi(req, res, requestedUrl(req));
};

module.exports.requestedUrl = requestedUrl;
