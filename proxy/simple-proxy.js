const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 8082;

function sendError(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(msg || http.STATUS_CODES[code]);
}

const server = http.createServer((req, res) => {
  // Allow preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // Expect URL like: /https://store.steampowered.com/...
  const targetUrl = req.url.slice(1);
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    sendError(res, 400, 'Usage: /https://target.url/path');
    return;
  }

  let parsed;
  try {
    parsed = url.parse(targetUrl);
  } catch (err) {
    sendError(res, 400, 'Invalid URL');
    return;
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const headers = Object.assign({}, req.headers);
  // Replace host header with target host
  headers.host = parsed.host;
  // Use a friendly UA to avoid some servers rejecting requests
  headers['user-agent'] = headers['user-agent'] || 'Mozilla/5.0 (GameHub local-proxy)';

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    // parsed.path already contains the search/query part; do not append parsed.search again
    path: parsed.path || parsed.pathname || '/',
    method: req.method,
    headers,
    timeout: 15000,
  };

  console.log('[simple-proxy] ->', req.method, targetUrl);

  const proxyReq = client.request(options, (proxyRes) => {
    console.log('[simple-proxy] upstream status', proxyRes.statusCode, 'for', targetUrl);
    // Copy headers but ensure CORS is allowed
    const outHeaders = Object.assign({}, proxyRes.headers, {
      'Access-Control-Allow-Origin': '*',
    });
    // Some browsers need these exposed
    if (!outHeaders['access-control-expose-headers']) {
      outHeaders['access-control-expose-headers'] = Object.keys(proxyRes.headers).join(',');
    }

    // If upstream returned a redirect (Location header), rewrite it so the
    // browser follows the redirect through this proxy (avoids CORS issues).
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      try {
        const proxyBase = 'http://' + (req.headers.host || ('localhost:' + PORT));
        // Rewrite upstream Location so browser follows redirect through this proxy.
        // Normalize by stripping leading slashes from upstream location before prepending.
        const upstreamLoc = String(proxyRes.headers.location || '').replace(/^\/*/, '');
        outHeaders.location = proxyBase + '/' + upstreamLoc;
      } catch (e) {
        // ignore rewrite errors
      }
    }

    // If upstream returned non-2xx and small body, log body for diagnosis
    if (proxyRes.statusCode >= 400 && proxyRes.statusCode < 600) {
      let body = '';
      proxyRes.on('data', (chunk) => {
        if (body.length < 2000) body += chunk.toString();
      });
      proxyRes.on('end', () => {
        console.warn('[simple-proxy] upstream response body preview:', body.slice(0, 1000));
      });
    }

    res.writeHead(proxyRes.statusCode, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.abort();
    sendError(res, 504, 'Upstream request timed out');
  });

  proxyReq.on('error', (err) => {
    // Forward some info for debugging
    try {
      console.error('[simple-proxy] request error', err && err.message);
      sendError(res, 502, 'Bad Gateway: ' + (err && err.message));
    } catch (e) {
      // ignore
    }
  });

  req.pipe(proxyReq);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[simple-proxy] Listening on http://0.0.0.0:${PORT}/`);
  console.log('[simple-proxy] Usage example: http://localhost:' + PORT + '/https://store.steampowered.com/api/featuredcategories/?cc=id&l=en');
});
