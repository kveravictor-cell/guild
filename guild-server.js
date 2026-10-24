"use strict";

// Guild prototype server with per-account state, password hashing, and sessions.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const IS_DEPLOYED = Boolean(process.env.PORT);
const HOST = IS_DEPLOYED ? "0.0.0.0" : "127.0.0.1";
const PORT = Number(process.env.PORT || process.env.GUILD_PORT || 4173);
const PAGE = path.join(__dirname, "discord-inspired.html");
const DATA_DIR = process.env.GUILD_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "guild-data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MAX_BYTES = 3 * 1024 * 1024;
const sessions = new Map();
const eventClients = new Map();
const attempts = new Map();
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

function json(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), ...extra });
  res.end(body);
}

function persistUsers() {
  const temp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(users), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, USERS_FILE);
}

function readBody(req, res, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) { json(res, 413, { error: "A solicitação excede o limite permitido." }); req.destroy(); reject(new Error("body-too-large")); }
      else chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { json(res, 400, { error: "JSON inválido." }); reject(new Error("invalid-json")); }
    });
    req.on("error", reject);
  });
}

function cookieValue(req, name) {
  const cookies = (req.headers.cookie || "").split(";").map(v => v.trim());
  const found = cookies.find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function getUser(req) {
  const token = cookieValue(req, "guild_session");
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(token); return null; }
  return users[session.userId] || null;
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
  const flags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${IS_DEPLOYED ? "; Secure" : ""}`;
  res.setHeader("Set-Cookie", `guild_session=${token}; ${flags}`);
}

function authRateAllowed(req) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter(t => now - t < 60_000);
  if (recent.length >= 8) { attempts.set(ip, recent); return false; }
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

function validPassword(password) { return typeof password === "string" && password.length >= 10 && password.length <= 128; }
function passwordHash(password, salt) { return crypto.scryptSync(password, salt, 64).toString("hex"); }
function saveState(user, next, clientId, res) {
  if (!next || typeof next !== "object" || !Array.isArray(next.servers) || !Array.isArray(next.friends)) return json(res, 400, { error: "Estado inválido." });
  const serialized = JSON.stringify(next);
  if (Buffer.byteLength(serialized) > MAX_BYTES) return json(res, 413, { error: "O estado passou do limite de 3 MB." });
  const file = path.join(DATA_DIR, `state-${user.id}.json`);
  try {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, serialized, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    json(res, 200, { ok: true });
    for (const client of eventClients.get(user.id) || []) client.write(`data: ${JSON.stringify({ clientId: typeof clientId === "string" ? clientId : null, state: next })}\n\n`);
  } catch (error) { console.error("Erro ao salvar estado:", error.message); json(res, 500, { error: "Não foi possível salvar seus dados." }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/discord-inspired.html")) {
    fs.readFile(PAGE, (error, page) => {
      if (error) return json(res, 404, { error: "Arquivo da interface não encontrado." });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(page), "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" }); res.end(page);
    }); return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true });

  if (req.method === "POST" && ["/api/auth/register", "/api/auth/login"].includes(url.pathname)) {
    if (!authRateAllowed(req)) return json(res, 429, { error: "Muitas tentativas. Aguarde um minuto." });
    try {
      const body = await readBody(req, res);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const key = username.toLocaleLowerCase("pt-BR");
      const password = body.password;
      if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username)) return json(res, 400, { error: "Use um nome de 3 a 24 caracteres: letras, números, ponto, hífen ou _." });
      if (url.pathname.endsWith("register")) {
        if (!validPassword(password)) return json(res, 400, { error: "A senha precisa ter entre 10 e 128 caracteres." });
        if (Object.values(users).some(u => u.username.toLocaleLowerCase("pt-BR") === key)) return json(res, 409, { error: "Esse nome já está em uso." });
        const salt = crypto.randomBytes(16).toString("hex");
        const user = { id: crypto.randomUUID(), username, salt, hash: passwordHash(password, salt), createdAt: new Date().toISOString() };
        users[user.id] = user; persistUsers(); createSession(res, user);
        return json(res, 201, { user: { id: user.id, username: user.username } });
      }
      const user = Object.values(users).find(u => u.username.toLocaleLowerCase("pt-BR") === key);
      if (!user || typeof password !== "string" || !crypto.timingSafeEqual(Buffer.from(passwordHash(password, user.salt), "hex"), Buffer.from(user.hash, "hex"))) return json(res, 401, { error: "Nome ou senha incorretos." });
      createSession(res, user);
      return json(res, 200, { user: { id: user.id, username: user.username } });
    } catch (error) { if (!res.writableEnded && error.message !== "invalid-json" && error.message !== "body-too-large") json(res, 400, { error: "Não foi possível processar a solicitação." }); }
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getUser(req);
    return user ? json(res, 200, { user: { id: user.id, username: user.username } }) : json(res, 401, { error: "Faça login." });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = cookieValue(req, "guild_session"); if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", `guild_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_DEPLOYED ? "; Secure" : ""}`);
    return json(res, 200, { ok: true });
  }

  if (url.pathname.startsWith("/api/")) {
    const user = getUser(req);
    if (!user) return json(res, 401, { error: "Faça login para continuar." });
    if (req.method === "GET" && url.pathname === "/api/state") {
      const file = path.join(DATA_DIR, `state-${user.id}.json`);
      try { return json(res, 200, { state: JSON.parse(fs.readFileSync(file, "utf8")) }); }
      catch (error) { if (error.code === "ENOENT") return json(res, 200, { state: null }); return json(res, 500, { error: "Não foi possível carregar seus dados." }); }
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(": connected\n\n");
      if (!eventClients.has(user.id)) eventClients.set(user.id, new Set());
      eventClients.get(user.id).add(res);
      const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, 25_000);
      req.on("close", () => { clearInterval(heartbeat); eventClients.get(user.id)?.delete(res); }); return;
    }
    if (req.method === "PUT" && url.pathname === "/api/state") {
      try { const body = await readBody(req, res, MAX_BYTES); if (!res.writableEnded) saveState(user, body.state, body.clientId, res); }
      catch (error) { if (!res.writableEnded && error.message !== "invalid-json" && error.message !== "body-too-large") json(res, 400, { error: "JSON inválido." }); }
      return;
    }
  }
  json(res, 404, { error: "Rota não encontrada." });
});

server.listen(PORT, HOST, () => {
  console.log(`Guild está rodando em http://${HOST}:${PORT}`);
  console.log("Cadastro/login ativos. Dados e eventos são isolados por conta.");
  console.log(`Dados persistentes em: ${DATA_DIR}`);
});
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `A porta ${PORT} já está em uso.` : error.message); process.exitCode = 1; });
process.on("SIGINT", () => { for (const group of eventClients.values()) for (const client of group) client.end(); server.close(() => process.exit(0)); });

