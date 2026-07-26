const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function contentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveFile(root, requestPath) {
  const relative = requestPath.replace(/^\/+/, "") || "index.html";
  const resolved = path.normalize(path.join(root, relative));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

/** Serve dist/ over http://127.0.0.1 so blob audio matches the Vite web app. */
function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const root = path.normalize(rootDir);
    const server = http.createServer((req, res) => {
      try {
        const pathname = decodeURIComponent(
          new URL(req.url || "/", "http://127.0.0.1").pathname
        );
        let filePath = resolveFile(root, pathname);
        if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(root, "index.html");
        }
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": contentType(filePath),
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

module.exports = { startStaticServer };