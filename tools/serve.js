/*
 * Tiny static server used to preview the mock harness and regenerate screenshots.
 * Usage: node tools/serve.js [port]
 * Then open http://127.0.0.1:8766/tools/mock-harness.html#/details?id=<mock id>
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8766;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.md': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, rel);

  // Never serve outside the repository root.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock harness: http://127.0.0.1:${PORT}/tools/mock-harness.html#/details?id=a1b2c3d4e5f60718293a4b5c6d7e8f90`);
});
