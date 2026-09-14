import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { exec } from "node:child_process";

const root = resolve(process.cwd());
const port = 4173;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

async function serveFile(res, filePath) {
  try {
    const body = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, body, contentType);
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const filePath = pathname === "/" ? join(root, "index.html") : join(root, pathname.slice(1));
  await serveFile(res, filePath);
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Taskboard running at ${url}`);
  exec(`start "" "${url}"`);
});
