
// core/config.js
module.exports = {
  MODEL_MAIN: process.env.OPENAI_MODEL_MAIN || "gpt-4o",
  MODEL_BIBLE: process.env.OPENAI_MODEL_BIBLE || "gpt-4o-mini",
  RESPONSE_TIMEOUT_MS: Number(process.env.RESPONSE_TIMEOUT_MS || 12000),
  MAX_TOKENS_MAIN: Number(process.env.MAX_TOKENS_MAIN || 220),
  ENABLE_TOPIC_LOCK: process.env.ENABLE_TOPIC_LOCK !== "false" // por defecto ON
};
