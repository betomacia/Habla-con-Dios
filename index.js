// index.js — Backend modular con lógica OpenAI separada en /core
// Endpoints: /api/ask, /api/welcome, /api/heygen/token, /api/heygen/config

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
require("dotenv").config();

const { askLLM } = require("./core/ai");

const app = express();
app.disable("x-powered-by");

// CORS (allowlist por env, o abierto si no se define)
const ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // apps nativas / curl
      if (ORIGINS.length === 0) return cb(null, true);
      return cb(null, ORIGINS.includes(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);

app.use(bodyParser.json({ limit: "8kb" }));

// ===== Persistencia de memoria (hash HMAC de userId) =====
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

function hashUserId(rawId = "anon") {
  const salt = process.env.SECRET_SALT || "changeme";
  return crypto.createHmac("sha256", salt).update(String(rawId)).digest("hex").slice(0, 40);
}
function memPath(uidHash) {
  return path.join(DATA_DIR, `mem_${uidHash}.json`);
}

async function readUserMemory(userId) {
  await ensureDataDir();
  const idHash = hashUserId(userId);
  try {
    const raw = await fs.readFile(memPath(idHash), "utf8");
    return JSON.parse(raw);
  } catch {
    return { v: 1, frame: null, topics: {}, bible: null, usage: null, turns: 0, last_seen: Date.now() };
  }
}
async function writeUserMemory(userId, mem) {
  await ensureDataDir();
  const idHash = hashUserId(userId);
  const base = { v: 1, frame: null, topics: {}, bible: null, usage: null, turns: 0, last_seen: Date.now() };
  await fs.writeFile(
    memPath(idHash),
    JSON.stringify({ ...base, ...mem, last_seen: Date.now() }, null, 2),
    "utf8"
  );
}
const memoryIO = { read: readUserMemory, write: writeUserMemory };

// ===== Utilidades de sanitización =====
function sanitizeMessage(s) {
  if (typeof s !== "string") return "";
  const trimmed = s.trim();
  return trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
}
function sanitizeHistory(arr) {
  if (!Array.isArray(arr)) return [];
  const keep = arr.slice(-10);
  return keep.map((x) => sanitizeMessage(String(x))).filter(Boolean);
}

// ===== Rutas =====

// Salud
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Bienvenida (simple, sin LLM)
app.get("/api/welcome", (_req, res) => {
  res.json({
    message: "La paz esté contigo. Estoy aquí para escucharte y acompañarte con calma.",
    bible: { text: "El Señor es mi luz y mi salvación; ¿de quién temeré?", ref: "Salmos 27:1" },
  });
});

// Conversación principal (OpenAI + memoria)
app.post("/api/ask", async (req, res) => {
  try {
    let { persona = "jesus", message = "", history = [], userId = "anon", persona_extra = "" } =
      req.body || {};
    message = sanitizeMessage(message);
    history = sanitizeHistory(history);
    if (!message) return res.status(400).json({ error: "empty_message" });

    const data = await askLLM({
      persona,
      message,
      history,
      userId,
      memoryIO,
      personaExtra: persona_extra,
    });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({
      message: (data?.message || "").toString().trim(),
      bible: {
        text: (data?.bible?.text || "").toString().trim(),
        ref: (data?.bible?.ref || "").toString().trim(),
      },
      ...(data?.question ? { question: data.question } : {}),
    });
  } catch {
    res.status(200).json({
      message:
        "La paz sea contigo. Compárteme en pocas palabras lo esencial, y seguimos paso a paso.",
      bible: {
        text: "Cercano está Jehová a los quebrantados de corazón; y salva a los contritos de espíritu.",
        ref: "Salmos 34:18",
      },
    });
  }
});

// === HeyGen: emitir token de sesión (NO toca OpenAI) ===
app.get("/api/heygen/token", async (_req, res) => {
  try {
    const API_KEY = process.env.HEYGEN_API_KEY || process.env.HEYGEN_TOKEN || "";
    if (!API_KEY) return res.status(500).json({ error: "missing_HEYGEN_API_KEY" });

    const r = await fetch("https://api.heygen.com/v1/streaming.create_token", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      body: "{}",
    });

    const json = await r.json().catch(() => ({}));
    const token = json?.data?.token || json?.token || json?.access_token || "";
    if (!r.ok || !token) {
      return res.status(r.status || 500).json({ error: "heygen_token_failed" });
    }
    res.json({ token });
  } catch {
    res.status(500).json({ error: "heygen_token_error" });
  }
});

// === HeyGen: configuración para el frontend (solo IDs no sensibles) ===
app.get("/api/heygen/config", (_req, res) => {
  const AV_LANGS = ["es", "en", "pt", "it", "de", "ca", "fr", "pl", "tl"];
  const avatars = {};
  for (const l of AV_LANGS) {
    const key = `HEYGEN_AVATAR_${l.toUpperCase()}`;
    const val = (process.env[key] || "").trim();
    if (val) avatars[l] = val;
  }
  const voiceId = (process.env.HEYGEN_VOICE_ID || "").trim();
  const defaultAvatar = (process.env.HEYGEN_DEFAULT_AVATAR || "").trim();
  const version = process.env.HEYGEN_CFG_VERSION || Date.now();
  res.json({ voiceId, defaultAvatar, avatars, version });
});

// Arranque
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor listo en puerto ${PORT}`));
