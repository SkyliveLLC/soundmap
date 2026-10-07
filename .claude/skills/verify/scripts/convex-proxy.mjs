// Plain-HTTP stand-in for the Convex dev deployment, so a test can cut the app's connection by stopping it.
// Usage: node convex-proxy.mjs <deployment>.convex.cloud [port]. See features/add-to-map.md, "Offline".
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const UPSTREAM = process.argv[2];
const PORT = Number(process.argv[3] ?? 3299);

const server = http.createServer((req, res) => {
  const up = https.request({ host: UPSTREAM, path: req.url, method: req.method, headers: { ...req.headers, host: UPSTREAM } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => res.destroy());
  req.pipe(up);
});

server.on('upgrade', (req, socket, head) => {
  const up = tls.connect(443, UPSTREAM, { servername: UPSTREAM }, () => {
    const headers = Object.entries({ ...req.headers, host: UPSTREAM }).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => console.log(`proxy :${PORT} -> ${UPSTREAM}`));
