"use strict";

// Small localhost-only persistence and live-update server for the Guild prototype.
// It has no accounts, encryption, file storage, or internet-facing access.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const IS_DEPLOYED = Boolean(process.env.PORT);
const HOST = IS_DEPLOYED ? "0.0.0.0" : "127.0.0.1";
const PORT = Number(process.env.PORT || process.env.GUILD_PORT || 4173);
const PAGE = path.join(__dirname, "discord-inspired.html");
const DATA_DIR = process.env.GUILD_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "guild-data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MAX_BYTES = 3 * 1024 * 1024;
const clients = new Set();
let state = null;
let revision = 0;

try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  revision = 1;
} catch (error) {
  if (error.code !== "ENOENT") console.error("Não foi possível ler o estado salvo:", error.message);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function snapshot(clientId = null) {
  return JSON.stringify({ revision, clientId, state });
}

function broadcast(clientId) {
  const packet = `data: ${snapshot(clientId)}\n\n`;
  for (const client of clients) client.write(packet);
}

function saveState(next, clientId, res) {
  if (!next || typeof next !== "object" || !Array.isArray(next.servers) || !Array.isArray(next.friends)) {
    json(res, 400, { error: "Estado inválido." });
    return;
  }
  const serialized = JSON.stringify(next);
  if (Buffer.byteLength(serialized) > MAX_BYTES) {
    json(res, 413, { error: "O estado local passou do limite de 3 MB." });
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = `${STATE_FILE}.tmp`;
    fs.writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, STATE_FILE);
    state = next;
    revision += 1;
    json(res, 200, { ok: true, revision });
    broadcast(typeof clientId === "string" ? clientId : null);
  } catch (error) {
    json(res, 500, { error: "Não foi possível salvar o estado local." });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/discord-inspired.html")) {
    fs.readFile(PAGE, (error, page) => {
      if (error) return json(res, 404, { error: "Arquivo da interface não encontrado." });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": page.length,
      });
      res.end(page);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    json(res, 200, { state, revision });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`data: ${snapshot()}\n\n`);
    clients.add(res);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/state") {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        json(res, 413, { error: "O estado local passou do limite de 3 MB." });
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        saveState(body.state, body.clientId, res);
      } catch {
        json(res, 400, { error: "JSON inválido." });
      }
    });
    return;
  }

  json(res, 404, { error: "Rota não encontrada." });
});

server.listen(PORT, HOST, () => {
  console.log(`Guild está rodando em http://${HOST}:${PORT}`);
  if (!IS_DEPLOYED) console.log("Servidor local. A publicação pública aguarda autenticação e permissões.");
  console.log(`Estado salvo em: ${STATE_FILE}`);
});

server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `A porta ${PORT} já está em uso.` : error.message);
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
});

