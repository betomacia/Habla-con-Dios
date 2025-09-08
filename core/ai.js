// core/ai.js
const OpenAI = require("openai");
const { SYSTEM_PROMPT, OFFTOPIC_REGEX, CRISIS_REGEX, CRISIS_FALLBACK, REDIRECT_FALLBACK } = require("./policy");
const cfg = require("./config");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === Helpers generales ===
function normalize(s=""){ return String(s||"").trim(); }
function cleanRef(ref=""){ return String(ref).replace(/\s*\([^)]*\)\s*/g," ").replace(/\s+/g," ").trim(); }
function stripQuestionsFromMessage(s=""){ return String(s).replace(/[¿?]+/g,"").trim(); }
function limitWords(s="", max=60){ const w = String(s).trim().split(/\s+/); return w.length<=max?String(s).trim():w.slice(0,max).join(" ").trim(); }
function normalizeQuestion(q=""){ return String(q).toLowerCase().replace(/\s+/g," ").trim(); }
function isOffTopic(text) { return OFFTOPIC_REGEX.test(text || ""); }
function isCrisis(text) { return CRISIS_REGEX.test(text || ""); }
function isAckOrShort(input="") {
  const s = String(input || "").trim().toLowerCase();
  const ack = /(gracias|muchas gracias|ok|vale|entendido|perfecto|listo|de acuerdo|genial|bien|okey|👍|👌|🙏)\b/i.test(s);
  const words = s.split(/\s+/).filter(Boolean);
  const veryShort = words.length>0 && words.length<=4;
  const onlyPunct = /^[\s¿?¡!.,;:()\-–—]+$/.test(s);
  return ack || veryShort || onlyPunct;
}

// === Detección de temas/seguimiento ===
function guessTopic(s=""){
  const t=(s||"").toLowerCase();
  if (/(droga|adicci|alcohol|apuestas)/.test(t)) return "addiction";
  if (/(me separ|separaci[oó]n|divorcio|ruptura)/.test(t)) return "separation";
  if (/(pareja|matrimonio|conyug|novi[oa])/.test(t)) return "relationship";
  if (/(duelo|falleci[oó]|perd[ií]|luto)/.test(t)) return "grief";
  if (/(ansied|p[áa]nico|depres|triste|miedo|temor|estr[eé]s)/.test(t)) return "mood";
  if (/(trabajo|despido|salario|dinero|deuda|finanzas)/.test(t)) return "work_finance";
  if (/(salud|diagn[oó]stico|enfermedad|dolor)/.test(t)) return "health";
  if (/(familia|conflicto|discusi[oó]n|suegr)/.test(t)) return "family_conflict";
  if (/(fe|duda|dios|oraci[oó]n|culpa)/.test(t)) return "faith";
  return "general";
}
function topicKeyFromMessage(s=""){
  const t=(s||"").toLowerCase();
  if (/(mi\s+hij[oa]|hij[oa]|adolescente|niñ[oa])/.test(t)) return "child";
  if (/(pareja|espos[oa]|novi[oa]|matrimonio)/.test(t)) return "partner";
  if (/(familia|suegr|herman[oa]|padre|madre)/.test(t)) return "family";
  if (/(trabajo|jefe|despido|deuda|banco|dinero|finanzas)/.test(t)) return "work_finance";
  if (/(ansied|p[áa]nico|depres|triste|miedo|estr[eé]s)/.test(t)) return "mood";
  if (/(duelo|falleci[oó]|luto|perd[ií])/.test(t)) return "grief";
  if (/(adicci|alcohol|apuestas|porno|drog)/.test(t)) return "addiction";
  if (/(fe|duda|oraci[oó]n|culpa|pecado)/.test(t)) return "faith";
  return "general";
}
function shouldFollowUp(mem={}, key){
  const t = (mem.topics && mem.topics[key]) || null;
  if (!t) return false;
  return !!t.pending_followup;
}
function saveAdvice(mem, key, issue, advice){
  mem.topics = mem.topics || {};
  mem.topics[key] = {
    ...(mem.topics[key] || {}),
    last_issue: (issue || "").slice(0,160),
    last_advice: (advice || "").slice(0,160),
    last_check: Date.now(),
    pending_followup: true
  };
}
function resolveFollowUpIfConfirmed(mem, key, userText=""){
  if (/(lo hice|pude hacerlo|funcion[oó]|me sirvi[oó]|lo intentar[eé]|har[eé] eso)/i.test(userText||"")) {
    if (mem.topics?.[key]) {
      mem.topics[key].pending_followup = false;
      mem.topics[key].last_check = Date.now();
    }
  }
}

// === Historial/refs ===
function compactHistory(history=[], keep=10, maxLen=240){
  return (Array.isArray(history)?history:[]).slice(-keep).map(x=>String(x).slice(0,maxLen));
}
function extractRecentAssistantQuestions(history=[], max=5){
  const rev=[...(history||[])].reverse(); const qs=[]; let seen=0;
  for(const h of rev){
    if(!/^Asistente:/i.test(h)) continue;
    const text=h.replace(/^Asistente:\s*/i,"").trim();
    const m=text.match(/([^?]*\?)\s*$/m);
    if(m&&m[1]){ const q=normalizeQuestion(m[1]); if(!qs.includes(q)) qs.push(q); }
    seen++; if(seen>=max) break;
  }
  return qs;
}
function extractRecentBibleRefs(history=[], maxRefs=3){
  const rev=[...(history||[])].reverse(); const found=[];
  for(const h of rev){
    const s=String(h);
    const m=s.match(/—\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+\d+:\d+)/)
      || s.match(/-\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+\d+:\d+)/)
      || s.match(/\(\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+\d+:\d+)\s*\)/);
    if(m&&m[1]){ const ref=cleanRef(m[1]); if(!found.includes(ref)) found.push(ref); if(found.length>=maxRefs) break; }
  }
  return found;
}

// === Lectura bíblica continua ===
const DEFAULT_PLANS = {
  john: { title: "Evangelio según Juan", items: Array.from({length:21},(_,i)=>`Juan ${i+1}`) }
};
function wantsBibleStart(s=""){ return /(leer la biblia|quiero leer la biblia|leemos la biblia|empezar lectura b[íi]blica)/i.test(s||""); }
function wantsBibleContinue(s=""){ return /(continuemos|seguir leyendo|continuar lectura|retomar lectura)/i.test(s||""); }
function ensureBible(mem){
  mem.bible = mem.bible || { plan_id:"john", items: DEFAULT_PLANS.john.items, index:0, last_ref:"", last_updated:0 };
  if (!mem.bible.items || !Array.isArray(mem.bible.items) || !mem.bible.items.length) {
    mem.bible.items = DEFAULT_PLANS.john.items;
    mem.bible.index = 0;
  }
}
function nextBibleRef(mem){
  ensureBible(mem);
  const i = Math.max(0, mem.bible.index || 0);
  const list = mem.bible.items;
  const ref = list[i] || list[list.length-1];
  mem.bible.last_ref = ref;
  mem.bible.index = Math.min(i+1, list.length);
  mem.bible.last_updated = Date.now();
  return ref;
}

// === OpenAI call con timeout y JSON schema ===
const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "SpiritualGuidance",
    schema: {
      type: "object",
      properties: {
        message: { type: "string" },
        bible: {
          type: "object",
          properties: { text: { type: "string" }, ref: { type: "string" } },
          required: ["text", "ref"]
        },
        question: { type: "string" }
      },
      required: ["message", "bible"],
      additionalProperties: false
    }
  }
};
async function completionWithTimeout({ messages, temperature=0.6, max_tokens=cfg.MAX_TOKENS_MAIN, timeoutMs=cfg.RESPONSE_TIMEOUT_MS }) {
  const call = openai.chat.completions.create({
    model: cfg.MODEL_MAIN,
    temperature,
    max_tokens,
    messages,
    response_format: responseFormat
  });
  return await Promise.race([
    call,
    new Promise((_,rej)=>setTimeout(()=>rej(new Error("TIMEOUT")), timeoutMs))
  ]);
}

// === Core ===
async function askLLM({ persona, message, history=[], userId="anon", memoryIO, personaExtra="" }) {
  const mem = await memoryIO.read(userId);

  // Topic/frame y locks
  const incomingTopic = guessTopic(message);
  const topic = (cfg.ENABLE_TOPIC_LOCK && mem.frame?.topic_primary) ? mem.frame.topic_primary : incomingTopic;
  const frame = { topic_primary: topic };
  mem.frame = frame;

  // Modo cierre / seguimiento
  const ACK_MODE = isAckOrShort(message);
  const key = topicKeyFromMessage(message);
  resolveFollowUpIfConfirmed(mem, key, message);
  const FOLLOWUP_MODE = shouldFollowUp(mem, key);

  // Offtopic / crisis
  if (isCrisis(message)) return CRISIS_FALLBACK;
  if (isOffTopic(message)) return REDIRECT_FALLBACK;

  // Lectura bíblica: start/continue
  let bibleRefForced = "";
  if (wantsBibleStart(message)) { ensureBible(mem); mem.bible.index = 0; bibleRefForced = nextBibleRef(mem); }
  if (wantsBibleContinue(message)) { bibleRefForced = nextBibleRef(mem); }

  // Historial reducido y señales
  const recentQs = extractRecentAssistantQuestions(history, 5);
  const shortHistory = compactHistory(history, 10, 240);
  const lastRefFromHistory = extractRecentBibleRefs(history, 1)[0] || "";
  const bannedRefs = extractRecentBibleRefs(history, 3);

  const header =
    `Persona: ${persona}\n` +
    (personaExtra ? `PERSONA_EXTRA:\n${personaExtra}\n` : "") +
    `Mensaje_actual: ${message}\n` +
    `FRAME: ${JSON.stringify(frame)}\n` +
    `tema_permitido: autoayuda personal + fe católica + espiritualidad + reflexión bíblica\n` +
    `temas_vetados: política, deportes, espectáculos/farándula, turismo no religioso\n` +
    `ACK_MODE: ${ACK_MODE ? "true" : "false"}\n` +
    `FOLLOWUP_MODE: ${FOLLOWUP_MODE ? "true" : "false"}\n` +
    `last_bible_ref: ${lastRefFromHistory || "(n/a)"}\n` +
    `banned_refs:\n- ${bannedRefs.join("\n- ") || "(none)"}\n` +
    (recentQs.length ? `ultimas_preguntas: ${recentQs.join(" | ")}` : "ultimas_preguntas: (ninguna)") + "\n" +
    (shortHistory.length ? `Historial: ${shortHistory.join(" | ")}` : "Historial: (sin antecedentes)") + "\n`;

  const resp = await completionWithTimeout({
    messages: [{ role:"system", content:SYSTEM_PROMPT }, { role:"user", content:header }]
  });

  let data={};
  try { data = JSON.parse(resp?.choices?.[0]?.message?.content || "{}"); } catch { data = {}; }

  // Sanitización
  let msg = limitWords(stripQuestionsFromMessage(normalize(data.message)), 60);
  let ref = cleanRef(normalize(data?.bible?.ref));
  let text = normalize(data?.bible?.text);
  let question = normalize(data?.question);

  // Si hay plan bíblico en curso, forzamos la ref para continuidad
  if (bibleRefForced) ref = bibleRefForced;

  // Validación de pregunta (no repetida / no en ACK)
  const malformed = question && !/\?\s*$/.test(question);
  const recentQsNorm = recentQs.map(normalizeQuestion);
  if (!question || malformed || recentQsNorm.includes(normalizeQuestion(question)) || ACK_MODE) {
    question = "";
  }

  // ACK_MODE: cierre corto + despedida cálida
  if (ACK_MODE) {
    const closeTip = "Antes de cerrar, respira lento un minuto y repite: “no estoy solo”. Estoy contigo cuando lo necesites.";
    msg = limitWords(stripQuestionsFromMessage(msg || closeTip), 30);
  }

  // Guardar memoria (seguimiento y biblia)
  if (!ACK_MODE && key !== "general") {
    // Tomamos message (A+B) como última guía práctica/consuelo para seguimiento
    saveAdvice(mem, key, message, msg);
  }
  if (ref) mem.last_bible_ref = ref;
  await memoryIO.write(userId, mem);

  return {
    message: msg || "Estoy contigo. Demos un paso pequeño y realista hoy.",
    bible: { text: text || "Cercano está Jehová a los quebrantados de corazón; y salva a los contritos de espíritu.", ref: ref || "Salmos 34:18" },
    ...(question ? { question } : {})
  };
}

module.exports = { askLLM, isOffTopic, isCrisis };

