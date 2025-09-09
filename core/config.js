// core/config.js — parámetros ajustables por ENV (Railway)

module.exports = {
  MODEL_MAIN: process.env.OPENAI_MODEL_MAIN || "gpt-4o",
  MODEL_BIBLE: process.env.OPENAI_MODEL_BIBLE || "gpt-4o-mini",
  RESPONSE_TIMEOUT_MS: Number(process.env.RESPONSE_TIMEOUT_MS || 12000),
  MAX_TOKENS_MAIN: Number(process.env.MAX_TOKENS_MAIN || 220),
  ENABLE_TOPIC_LOCK: process.env.ENABLE_TOPIC_LOCK !== "false",

  // “Modo ahorro” y gobernadores (puedes cambiarlos desde Railway sin tocar el cliente)
  SPOKEN_WORDS_BUDGET_24H: Number(process.env.SPOKEN_WORDS_BUDGET_24H || 450), // ~1–2 min/día
  VIDEO_WINDOW_EVERY_N_TURNS: Number(process.env.VIDEO_WINDOW_EVERY_N_TURNS || 2),
  VIDEO_WINDOW_MAX_WORDS: Number(process.env.VIDEO_WINDOW_MAX_WORDS || 18),

  // Límite máximo que usará ai.js si no hay “modo ahorro”
  MAX_MSG_WORDS: Number(process.env.MAX_MSG_WORDS || 28),
};
