const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFParse } = require('pdf-parse');
const turabees = require('./turabees-data');

// Safety net only. Accuracy is the priority: let the model finish instead of
// cutting it off at a few seconds. Fallback is used on real failures or when
// every API key is exhausted.
const AI_REPLY_DEADLINE_MS = 15000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FALLBACK_LINES = {
  english: {
    respectful: 'One sec sir, let me check.',
    casual: 'One sec, let me check.'
  },
  roman_urdu: {
    respectful: 'Ek sec sir, batata hoon.',
    casual: 'Ek sec yaar, batata hoon.'
  },
  urdu: {
    respectful: 'ایک سیکنڈ سر، بتاتا ہوں۔',
    casual: 'ایک سیکنڈ، بتاتا ہوں۔'
  }
};

const STEER_LINES = {
  english: {
    respectful: 'Sir, I mostly handle Turabees — fabrics, suits, sherwanis, orders. Ask me anything about that.',
    casual: 'I mostly handle Turabees — fabrics, suits, sherwanis, orders. Ask me anything about that.'
  },
  roman_urdu: {
    respectful: 'Sir main Turabees ka hi kaam dekhta hoon — fabrics, suits, sherwani, orders. Us mein kuch poochhein to bata doon.',
    casual: 'Yaar main Turabees ka hi kaam dekhta hoon — fabrics, suits, sherwani, orders. Us mein kuch poochho to bata doon.'
  },
  urdu: {
    respectful: 'سر، میں صرف تورابیس کے کام دیکھتا ہوں — کپڑے، سوٹ، شیروانی، آرڈرز۔ اس بارے میں پوچھیں تو بتا دوں۔',
    casual: 'میں صرف تورابیس کے کام دیکھتا ہوں — کپڑے، سوٹ، شیروانی، آرڈرز۔ اس بارے میں پوچھیں تو بتا دوں۔'
  }
};

const FILE_STEER_LINES = {
  english: {
    respectful: "Sir, this file doesn't look Turabees-related — ask me about fabrics or suits.",
    casual: "This file doesn't look Turabees-related — ask me about fabrics or suits."
  },
  roman_urdu: {
    respectful: 'Sir yeh file Turabees se related nahi lag rahi — fabrics/suits ke baare mein poochhein to bata doon.',
    casual: 'Yeh file Turabees se related nahi lag rahi — fabrics/suits ke baare mein poochho to bata doon.'
  },
  urdu: {
    respectful: 'سر، یہ فائل تورابیس سے متعلق نہیں لگ رہی — کپڑے یا سوٹ کے بارے میں پوچھیں تو بتا دوں۔',
    casual: 'یہ فائل تورابیس سے متعلق نہیں لگ رہی — کپڑے یا سوٹ کے بارے میں پوچھیں تو بتا دوں۔'
  }
};

function getFallbackLine(respectful, language = 'roman_urdu') {
  const set = FALLBACK_LINES[language] || FALLBACK_LINES.roman_urdu;
  return respectful ? set.respectful : set.casual;
}

function getSteerLine(respectful, language = 'roman_urdu') {
  const set = STEER_LINES[language] || STEER_LINES.roman_urdu;
  return respectful ? set.respectful : set.casual;
}

function getFileSteerLine(respectful, language = 'roman_urdu') {
  const set = FILE_STEER_LINES[language] || FILE_STEER_LINES.roman_urdu;
  return respectful ? set.respectful : set.casual;
}

function detectMessageLanguage(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();

  // Explicit language requests win over everything else.
  if (/\b(reply|jawab|answer|bolo|likho|batao|batayein)\b[\s\S]{0,30}\b(in|mein|me)\b[\s\S]{0,20}\b(english|angrezi)\b/.test(lower) ||
      /\b(in|mein|me)\s+english\b/.test(lower) ||
      /\benglish\s+(mein|me)\b/.test(lower) ||
      /\bangrezi\s+(mein|me)\b/.test(lower)) {
    return 'english';
  }
  if (/\b(reply|jawab|answer|bolo|likho|batao|batayein)\b[\s\S]{0,30}\b(in|mein|me)\b[\s\S]{0,20}\b(roman urdu|roman)\b/.test(lower) ||
      /\broman urdu\b/.test(lower)) {
    return 'roman_urdu';
  }
  if (/\b(reply|jawab|answer|bolo|likho|batao|batayein)\b[\s\S]{0,30}\b(in|mein|me)\b[\s\S]{0,20}\burdu\b/.test(lower) ||
      /\burdu\s+(mein|me)\b/.test(lower) ||
      /\burdu script\b/.test(lower)) {
    return 'urdu';
  }

  // Urdu/Arabic script.
  if (/[\u0600-\u06FF]/.test(raw)) return 'urdu';

  // Roman Urdu markers.
  const markers = new Set([
    'kya', 'kia', 'kyun', 'kyu', 'hai', 'hain', 'ha', 'kaise', 'kaisay', 'kaisi', 'kia',
    'bhai', 'yaar', 'acha', 'achha', 'haan', 'han', 'nahi', 'nai', 'karo', 'kro', 'batao',
    'bata', 'bataen', 'batayein', 'kitne', 'kitni', 'kitna', 'kaun', 'mujhe', 'mujh', 'tum',
    'aap', 'shukriya', 'theek', 'thik', 'chahiye', 'karna', 'karni', 'banana', 'banate',
    'dekh', 'raha', 'rahi', 'hoon', 'hun', 'mein', 'mera', 'meri', 'apna', 'apni', 'sakta',
    'sakti', 'sakte', 'kuch', 'koi', 'hoga', 'hogi', 'gaya', 'gayi', 'kar', 'ke', 'ki',
    'ka', 'se', 'par', 'aur', 'phir', 'abhi', 'ab', 'sirf', 'bohot', 'bohat', 'zaroor',
    'mazaa', 'kyaa', 'walikum', 'assalam', 'salam'
  ]);
  const englishCommon = new Set([
    'the', 'you', 'your', 'do', 'does', 'have', 'has', 'is', 'are', 'what', 'which',
    'how', 'many', 'much', 'can', 'could', 'would', 'should', 'i', 'we', 'they', 'he',
    'she', 'it', 'this', 'that', 'please', 'sir', 'maam', 'fabric', 'fabrics', 'suit',
    'suits', 'sherwani', 'price', 'available', 'need', 'want', 'looking', 'for', 'and',
    'or', 'of', 'in', 'on', 'to', 'with', 'black', 'blue', 'white', 'grey', 'brown',
    'green', 'red', 'pink', 'orange', 'silver', 'gold', 'yellow', 'purple'
  ]);
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const markerCount = words.filter((w) => markers.has(w)).length;
  const englishCount = words.filter((w) => englishCommon.has(w)).length;

  if (markerCount >= 2 && markerCount >= englishCount) return 'roman_urdu';
  if (markerCount >= 1 && englishCount === 0) return 'roman_urdu';
  if (englishCount > 0) return 'english';

  // Default to English for ASCII DMs.
  return 'english';
}

function isRespectfulContact({ senderName = '', chatTitle = '', incomingText = '' } = {}) {
  const hay = `${senderName} ${chatTitle} ${incomingText}`.toLowerCase();
  if (/\b(sir|sahab|sahib|janab|mr|mrs|ms|dr|prof|uncle|aunty|boss|hafiz|chaudhry|malik)\b/.test(hay)) return true;
  if (/\b(aap|aapko|aapka|aapki|aapke|aapne)\b/.test(hay)) return true;
  return false;
}

const ROMAN_URDU_TO_ENGLISH = {
  yaar: 'man', bhai: 'bro', haan: 'yeah', acha: 'okay', achha: 'okay',
  toh: 'so', bilkul: 'absolutely', sahi: 'right', theek: 'okay', thik: 'okay',
  bohat: 'very', bohot: 'very', kuch: 'something', phir: 'then', aur: 'and',
  mein: 'in', kya: 'what', hai: 'is'
};

function sanitizeEnglishReply(text) {
  return String(text || '').replace(
    /\b(yaar|bhai|haan|acha|achha|toh|bilkul|sahi|theek|thik|bohat|bohot|kuch|phir|aur|mein|kya|hai)\b/gi,
    (match) => {
      const replacement = ROMAN_URDU_TO_ENGLISH[match.toLowerCase()] || match;
      return match[0] === match[0].toUpperCase()
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement;
    }
  ).trim();
}

function localizeReplies(replies, language) {
  if (language !== 'english') return replies;
  return replies.map(sanitizeEnglishReply).filter(Boolean);
}

function parseRepliesLoose(raw) {
  const cleaned = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.replies)) {
      return parsed.replies.map((r) => String(r).trim()).filter(Boolean);
    }
    if (typeof parsed === 'string') return [parsed.trim()].filter(Boolean);
  } catch (_) {}

  // Salvage a truncated replies array (common when the model is cut off).
  const match = cleaned.match(/"replies"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
  if (!match) return [];
  const items = [];
  for (const m of match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    try { items.push(JSON.parse(`"${m[1]}"`)); } catch (_) { items.push(m[1]); }
  }
  return items.map((s) => String(s).trim()).filter(Boolean);
}

const CHAT_MEMORY_LIMIT = 150;

// Per-contact rolling memory so John can answer "what did I tell you earlier?"
const chatMemory = new Map();

function dedupeHistory(items) {
  const seen = new Set();
  const out = [];
  for (const item of (items || [])) {
    if (!item) continue;
    const text = String(item.text || item.message || '').trim();
    if (!text) continue;
    const fromMe = Boolean(item.fromMe);
    const timestamp = item.timestamp || '';
    const key = `${fromMe ? 'me' : 'them'}|${text}|${timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, fromMe, timestamp });
  }
  return out;
}

function rememberChat(chatId, items) {
  if (!chatId) return;
  const existing = chatMemory.get(chatId) || [];
  const merged = dedupeHistory([...existing, ...items]).slice(-CHAT_MEMORY_LIMIT);
  chatMemory.set(chatId, merged);
  return merged;
}

// Read a ZIP archive using its central directory (handles data-descriptor
// entries, which are common in XLSX/DOCX/PPTX; local headers may store 0 sizes).
function readZipEntries(buffer) {
  const entries = new Map();
  const EOCD_SIGNATURE = 0x06054b50;
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraFieldLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLen);

    if (localHeaderOffset + 30 <= buffer.length && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compData = buffer.subarray(dataOffset, dataOffset + compressedSize);

      try {
        let data = null;
        if (compressionMethod === 0) data = compData;
        else if (compressionMethod === 8) data = zlib.inflateRawSync(compData);
        else data = zlib.inflateSync(compData);
        if (data) entries.set(fileName, data);
      } catch (err) {
        console.warn(`[Zip] Could not decompress ${fileName}:`, err.message);
      }
    }

    offset += 46 + fileNameLen + extraFieldLen + commentLen;
  }

  return entries;
}

// Lightweight zero-dependency helper to extract text from a .docx (ZIP) buffer
function extractDocxText(base64Data) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const entries = readZipEntries(buffer);
    if (!entries) return null;
    const documentXml = entries.get('word/document.xml');
    if (!documentXml) return null;

    return documentXml.toString('utf8')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<\/w:tr>/gi, '\n')
      .replace(/<w:tab\/>/gi, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch (err) {
    console.warn('[Docx Extractor] Error extracting docx text:', err.message);
  }
  return null;
}

function isTextOrCodeFile(fileName = '', mime = '') {
  const ext = path.extname(fileName).toLowerCase();
  const textExts = new Set(['.txt', '.csv', '.json', '.md', '.js', '.py', '.html', '.xml', '.log', '.env', '.ts', '.yaml', '.yml', '.sql', '.sh']);
  return mime.startsWith('text/') || mime === 'application/json' || textExts.has(ext);
}

function isDocxFile(fileName = '', mime = '') {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function isXlsxFile(fileName = '', mime = '') {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.xlsx' || ext === '.xlsm' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel.sheet.macroenabled.12';
}

function isPptxFile(fileName = '', mime = '') {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.pptx' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}

// Lightweight PPTX text extraction (ZIP with ppt/slides/slideN.xml).
function extractPptxText(base64Data) {
  try {
    const entries = readZipEntries(Buffer.from(base64Data, 'base64'));
    if (!entries) return null;

    const slides = [];
    for (const [fileName, data] of entries) {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(fileName);
      if (!match) continue;
      const xmlStr = data.toString('utf8');
      const texts = [];
      for (const m of xmlStr.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) texts.push(m[1]);
      if (texts.length) slides.push({ number: Number(match[1]), text: texts.join(' ') });
    }

    if (!slides.length) return null;
    slides.sort((a, b) => a.number - b.number);
    const decodeXml = (value) => String(value)
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

    return slides.map((s) => `Slide ${s.number}: ${decodeXml(s.text)}`).join('\n').slice(0, 30000);
  } catch (err) {
    console.warn('[Pptx Extractor] Error extracting pptx text:', err.message);
    return null;
  }
}

// Extract PDF text locally. This is much faster than asking the model to read
// a large inline PDF, which helps keep the whole reply under 10s.
async function extractPdfText(base64Data) {
  let parser;
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const text = String(result.text || '')
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.length < 10) return null;
    return text.slice(0, 30000);
  } catch (err) {
    console.warn('[Pdf Extractor] Error extracting PDF text:', err.message);
    return null;
  } finally {
    if (parser) {
      try { await parser.destroy(); } catch (_) {}
    }
  }
}

// Lightweight XLSX text extraction (XLSX is a ZIP containing sharedStrings.xml
// plus worksheet XML). Good enough for the model to read names, colors,
// descriptions, sheet names, etc. without adding a spreadsheet dependency.
function extractXlsxText(base64Data) {
  try {
    const entries = readZipEntries(Buffer.from(base64Data, 'base64'));
    if (!entries) return null;

    const sheetNames = [];
    const strings = [];

    const workbook = entries.get('xl/workbook.xml');
    if (workbook) {
      for (const match of workbook.toString('utf8').matchAll(/<sheet[^>]*\bname="([^"]+)"/g)) {
        sheetNames.push(match[1]);
      }
    }

    for (const [fileName, data] of entries) {
      if (fileName === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(fileName)) {
        const xmlStr = data.toString('utf8');
        for (const match of xmlStr.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
          strings.push(match[1]);
        }
      }
    }

    const decodeXml = (value) => String(value)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

    const unique = [...new Set(strings.map(decodeXml).map((s) => s.trim()).filter(Boolean))];
    if (!unique.length && !sheetNames.length) return null;

    const header = sheetNames.length ? `Workbook sheets: ${sheetNames.join(', ')}\n` : '';
    return (header + unique.join('\n')).slice(0, 30000);
  } catch (err) {
    console.warn('[Xlsx Extractor] Error extracting xlsx text:', err.message);
    return null;
  }
}

function extractBase64FromDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const commaIdx = value.indexOf(',');
  if (commaIdx === -1) return null;
  return value.slice(commaIdx + 1);
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

// Gemini's inline request budget is 20MB total. Keep headroom for the prompt.
const MAX_TOTAL_INLINE_BYTES = 15 * 1024 * 1024;

const GEMINI_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);
const GEMINI_AUDIO_MIMES = new Set([
  'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff', 'audio/aac', 'audio/ogg',
  'audio/flac', 'audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm'
]);

const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/opus', m4a: 'audio/m4a',
  wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
};

function inferMimeFromFileName(fileName = '') {
  const ext = String(fileName).split('.').pop().toLowerCase();
  return MIME_BY_EXTENSION[ext] || '';
}

function normalizeGeminiMime(mime = '', mediaKind = '', fileName = '') {
  let clean = String(mime).split(';')[0].trim().toLowerCase();

  if (clean === 'image/jpg' || clean === 'image/pjpeg') clean = 'image/jpeg';
  if (clean === 'audio/x-wav') clean = 'audio/wav';
  if (clean === 'audio/x-m4a') clean = 'audio/m4a';
  if (clean === 'audio/x-mp3') clean = 'audio/mp3';

  if (!clean || clean === 'application/octet-stream') {
    const inferred = inferMimeFromFileName(fileName);
    if (inferred) clean = inferred;
    else if (mediaKind === 'ptt') clean = 'audio/ogg';
    else if (mediaKind === 'audio') clean = 'audio/mpeg';
    else if (mediaKind === 'image') clean = 'image/jpeg';
    else if (mediaKind === 'sticker') clean = 'image/webp';
    else if (mediaKind === 'document') clean = 'application/pdf';
  }

  return clean;
}

function detectImageMimeFromBase64(base64 = '') {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.slice(0, 40).includes('ZnR5c')) return 'image/heic';
  return 'image/jpeg';
}

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Enable CORS for all origins and JSON body parsing (with large payload support for history/contacts)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Native ANSI escape codes for styling without external dependencies
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m'
};

const DIVIDER = `${ANSI.gray}──────────────────────────────────────────────────────────${ANSI.reset}`;

// Helper to determine if a string looks like a raw or formatted phone number
function isPhoneNumber(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[\+]?[\d\s\-()]{7,}$/.test(str.trim());
}

// Handle JSON parsing errors gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// =========================================================================
// 1. Dynamic Config Loader & Multi-Key Failover Rotation Engine
// =========================================================================

function loadConfig() {
  let config = {
    geminiModel: 'gemini-2.5-flash',
    debounceSeconds: 7,
    geminiApiKeys: []
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = { ...config, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn('⚠️ Error reading config.json:', err.message);
  }

  // Support reading GEMINI_API_KEYS comma-separated from environment if present
  if (process.env.GEMINI_API_KEYS) {
    const envKeys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim());
    config.geminiApiKeys = [...(config.geminiApiKeys || []), ...envKeys];
  }

  // Filter out placeholder and empty keys
  config.geminiApiKeys = (config.geminiApiKeys || []).filter(
    k => k && typeof k === 'string' && !k.startsWith('PASTE_') && k.trim().length > 0
  );

  return config;
}

let currentKeyIndex = 0;

/**
 * Generates natural human-like WhatsApp replies using Google Gemini API
 * with multi-key rotation and automatic failover on 429/403/5xx errors.
 */
async function generateHumanReply({
  chatTitle,
  senderName,
  senderNumber,
  isSaved = false,
  respectful = false,
  language = 'roman_urdu',
  incomingMessages = [],
  chatHistory = [],
  turabeesContext = '',
  hasMedia = false,
  localRelevance = null,
  deadline = 0
}) {
  const config = loadConfig();
  const keys = config.geminiApiKeys || [];

  if (keys.length === 0) {
    console.warn(`${ANSI.yellow}⚠️ [Gemini] No valid API keys found in config.json or environment!${ANSI.reset}`);
    return {
      replies: [getFallbackLine(respectful, language)],
      usedKeyIndex: null,
      error: "No Gemini API keys configured"
    };
  }

  const contactName = (senderName && senderName !== 'Unknown') ? senderName : (chatTitle || senderNumber || 'Friend');

  // Format recent conversation history (server memory + WhatsApp history)
  let historyText = '';
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    historyText = chatHistory.slice(-80).map(m => {
      const speaker = m.fromMe ? 'Me' : contactName;
      const text = (m.text || m.body || '').trim();
      const time = m.timestamp ? ` [${m.timestamp}]` : '';
      return `${speaker}${time}: ${text}`;
    }).filter(line => line.length > 0).join('\n');
  } else {
    historyText = '(No prior history available in this chat session)';
  }

  // Format incoming burst messages with multimodal attachments
  const inlineMediaItems = [];
  let totalInlineBytes = 0;

  function addInlineMedia(mimeType, data, label) {
    if (!data) return false;
    if (totalInlineBytes + data.length > MAX_TOTAL_INLINE_BYTES) {
      console.warn(`${ANSI.yellow}[Gemini] Skipping inline ${mimeType}: combined inline budget exceeded (${formatFileSize(totalInlineBytes)} used).${ANSI.reset}`);
      return false;
    }
    inlineMediaItems.push({ inlineData: { mimeType, data }, label });
    totalInlineBytes += data.length;
    console.log(`${ANSI.cyan}[Gemini] Inlining ${mimeType} (${formatFileSize(Math.round(data.length * 0.75))} raw) — ${label}${ANSI.reset}`);
    return true;
  }

  let incomingText = '';
  if (Array.isArray(incomingMessages) && incomingMessages.length > 0) {
    incomingText = incomingMessages.map((m, idx) => {
      const text = typeof m === 'string' ? m : (m.text || m.message || '');
      const time = m.timestamp ? ` [${m.timestamp}]` : '';
      const media = (typeof m === 'object' && m.media && m.media.hasMedia) ? m.media : null;
      let line = `Incoming (${idx + 1})${time}: "${text}"`;

      if (media) {
        const mediaKind = (media.mediaType || '').toLowerCase();
        const fileName = media.fileName || `${mediaKind || 'file'}`;
        const cleanMime = normalizeGeminiMime(media.mimeType, mediaKind, fileName);
        const caption = media.caption ? ` with caption: "${media.caption}"` : '';

        // The extension may send a real full file (base64Data) or only a
        // thumbnail preview for image/video/document messages.
        const rawBase64 = media.base64Data ||
                          extractBase64FromDataUrl(media.previewUrl) ||
                          media.thumbnailBase64 ||
                          null;
        const hasFullMedia = Boolean(media.base64Data) && !media.isThumbnailFallback;
        const isThumbnailOnly = Boolean(rawBase64) && !hasFullMedia;
        const sizeLabel = formatFileSize(media.fileSize || (rawBase64 ? Math.round(rawBase64.length * 0.75) : 0));
        const attachmentLabel = `Attachment for incoming message #${idx + 1}`;
        const skipNote = ' — skipped because the combined inline files exceed Gemini\'s 15MB request budget; acknowledge it by name';

        // Case 0: PDF text extracted locally (fast path, avoids slow PDF reading)
        if (media.extractedText) {
          line += `\n[Attached PDF Document: "${fileName}"${caption}]`;
          line += `\n--- Document Content (${fileName}) ---\n${media.extractedText}\n--- End of Document ---`;
        }
        // Case A: Large File (>15MB skipped)
        else if (media.skippedLargeFile) {
          line += `\n[Sender attached a large file (${fileName}, ${sizeLabel}) which exceeds the 15MB inline preview limit. Acknowledge the file by its name/caption naturally.]`;
        }
        // Case A2: Combined burst media budget exceeded
        else if (media.skippedCombinedLimit) {
          line += `\n[Sender attached another file (${fileName}, ${sizeLabel}, ${cleanMime || mediaKind || 'media'}) but it was omitted because the combined burst exceeds the inline request limit. Acknowledge it by its name/caption naturally.]`;
        }
        // Case B1: Images & stickers (thumbnail is still a viewable image)
        else if (rawBase64 && (cleanMime.startsWith('image/') || ((mediaKind === 'image' || mediaKind === 'sticker') && isThumbnailOnly))) {
          const detectedMime = GEMINI_IMAGE_MIMES.has(cleanMime) ? cleanMime : detectImageMimeFromBase64(rawBase64);
          const inlineLabel = `${attachmentLabel}: ${mediaKind === 'sticker' ? 'STICKER' : 'IMAGE'} "${fileName}" (${detectedMime}, ${sizeLabel})`;
          const added = GEMINI_IMAGE_MIMES.has(detectedMime)
            ? addInlineMedia(detectedMime, rawBase64, inlineLabel)
            : false;

          line += `\n[Attached ${mediaKind === 'sticker' ? 'STICKER' : 'IMAGE'} (${fileName}, ${sizeLabel})${caption} — look at the actual visual content (objects, text, layout, colors) and respond to what is visible${isThumbnailOnly ? ' (low-resolution preview only)' : ''}${added ? '' : skipNote}]`;
        }
        // Case B2: Voice notes & audio
        else if (rawBase64 && hasFullMedia && (cleanMime.startsWith('audio/') || mediaKind === 'ptt' || mediaKind === 'audio')) {
          const inlineMime = GEMINI_AUDIO_MIMES.has(cleanMime)
            ? cleanMime
            : (mediaKind === 'ptt' ? 'audio/ogg' : 'audio/mpeg');
          const inlineLabel = `${attachmentLabel}: ${mediaKind === 'ptt' ? 'VOICE NOTE' : 'AUDIO'} "${fileName}" (${inlineMime}, ${sizeLabel})`;
          const added = addInlineMedia(inlineMime, rawBase64, inlineLabel);

          line += `\n[Attached ${mediaKind === 'ptt' ? 'VOICE NOTE' : 'AUDIO'} (${inlineMime}, ${sizeLabel})${caption} — listen to the actual audio, understand what the sender said, and reply directly to its content${added ? '' : skipNote}]`;
        }
        // Case B3: PDF documents (never inline a thumbnail as a PDF)
        else if (rawBase64 && hasFullMedia && cleanMime === 'application/pdf') {
          const inlineLabel = `${attachmentLabel}: PDF DOCUMENT "${fileName}" (${sizeLabel})`;
          const added = addInlineMedia('application/pdf', rawBase64, inlineLabel);
          line += `\n[Attached PDF Document: "${fileName}"${caption} — read and discuss this PDF${added ? '' : skipNote}]`;
        }
        // Case C: Text/Code/CSV/JSON Files
        else if (rawBase64 && hasFullMedia && isTextOrCodeFile(fileName, cleanMime)) {
          try {
            const decoded = Buffer.from(rawBase64, 'base64').toString('utf8').slice(0, 30000);
            line += `\n[Attached Text/Data File: "${fileName}"${caption}]`;
            line += `\n--- Document Content (${fileName}) ---\n${decoded}\n--- End of Document ---`;
          } catch (decErr) {
            line += `\n[Attached Text Document: "${fileName}"]`;
          }
        }
        // Case D: Word Documents (.docx)
        else if (rawBase64 && hasFullMedia && isDocxFile(fileName, cleanMime)) {
          const docxText = extractDocxText(rawBase64);
          if (docxText) {
            line += `\n[Attached Word Document: "${fileName}"${caption}]`;
            line += `\n--- Document Content (${fileName}) ---\n${docxText.slice(0, 30000)}\n--- End of Document ---`;
          } else {
            line += `\n[Attached Word Document: "${fileName}" (${sizeLabel})]`;
          }
        }
        // Case D2: Excel Workbooks (.xlsx)
        else if (rawBase64 && hasFullMedia && isXlsxFile(fileName, cleanMime)) {
          const xlsxText = extractXlsxText(rawBase64);
          if (xlsxText) {
            line += `\n[Attached Excel Workbook: "${fileName}"${caption}]`;
            line += `\n--- Workbook Content (${fileName}; partial extraction) ---\n${xlsxText.slice(0, 30000)}\n--- End of Workbook ---`;
            line += `\n[Use the authoritative DATASET CONTEXT above for exact sheet counts and matched rows.]`;
          } else {
            line += `\n[Attached Excel Workbook: "${fileName}" (${sizeLabel}) — content could not be extracted]`;
          }
        }
        // Case D3: PowerPoint Presentations (.pptx)
        else if (rawBase64 && hasFullMedia && isPptxFile(fileName, cleanMime)) {
          const pptxText = extractPptxText(rawBase64);
          if (pptxText) {
            line += `\n[Attached PowerPoint Presentation: "${fileName}"${caption}]`;
            line += `\n--- Presentation Content (${fileName}) ---\n${pptxText.slice(0, 30000)}\n--- End of Presentation ---`;
          } else {
            line += `\n[Attached PowerPoint Presentation: "${fileName}" (${sizeLabel}) — content could not be extracted]`;
          }
        }
        // Case E: Document/video preview thumbnail only (preview image, not the real file)
        else if (rawBase64 && isThumbnailOnly) {
          const detectedMime = GEMINI_IMAGE_MIMES.has(detectImageMimeFromBase64(rawBase64))
            ? detectImageMimeFromBase64(rawBase64)
            : 'image/jpeg';
          const inlineLabel = `${attachmentLabel}: PREVIEW IMAGE for "${fileName}" (${cleanMime || mediaKind || 'document'})`;
          const added = addInlineMedia(detectedMime, rawBase64, inlineLabel);

          line += `\n[Attached document "${fileName}" (${cleanMime || mediaKind || 'media'}, ${sizeLabel})${caption} — only a low-resolution preview image was available; analyze whatever is visible in the preview and acknowledge the file by name${added ? '' : skipNote}]`;
        }
        // Other attachments
        else {
          line += `\n[Attached File: "${fileName}" (${cleanMime || mediaKind || 'media'}, ${sizeLabel})${caption}${isThumbnailOnly ? ' — only a low-resolution thumbnail preview could be retrieved; the full file was not downloadable' : ''}]`;
        }
      }

      return line;
    }).join('\n\n');
  } else {
    incomingText = `Incoming: "${chatTitle || 'Hello'}"`;
  }

  const systemInstruction = `You are John — a real human from the Turabees team, chatting on WhatsApp from the Turabees account.
You are NOT an AI, bot, assistant or language model. Never say or hint that. If asked who you are, say "Main John, Turabees se."

=== WHO YOU ARE TALKING TO ===
Name: ${senderName || 'Unknown'}
Chat title: ${chatTitle || 'Unknown'}
Phone: ${senderNumber || 'Unknown'}
Saved contact: ${isSaved ? 'yes' : 'no'}
Address style: ${respectful ? 'respected — use "sir" instead of "yaar"' : 'casual — "yaar" is fine'}
Language of newest DM: ${language === 'english' ? 'English' : language === 'urdu' ? 'Urdu script' : 'Roman Urdu'}

=== TURABEES PROFILE AND DATASET CONTEXT ===
${turabeesContext}
=== END CONTEXT ===

HOW TO TALK:
- Talk like a normal guy on WhatsApp: casual, short, 1-2 bubbles, no bullet points, no markdown, no corporate/AI wording.
- LANGUAGE: Reply ONLY in the language/script of the newest incoming DM. Ignore the language of older messages and history. If the latest DM is English, reply in English; if Roman Urdu, reply in Roman Urdu; if Urdu script, reply in Urdu script. If the person explicitly asks you to reply in a specific language (e.g. "reply in English", "Urdu mein jawab do"), use that language.
- ADDRESS: ${respectful ? 'This person is respected/formal. Use "sir" instead of "yaar" (e.g. "Sir, ...").' : 'Casual address is fine; "yaar" is okay.'}
- If you cannot answer or need a holding line, use the same language as the newest DM.
- Lowercase and small imperfections are fine.
- You can do light gossip/small talk and joke around. Keep it natural.
- Never mention "dataset", "context", "spreadsheet", "instructions", or that you are checking data. Talk like someone who knows the Turabees stock.
- Don't over-apologize. Don't say "I'm here to assist", "As an AI", "I can help you with that", or similar.

UNRELATED THINGS:
- If the person asks something unrelated to Turabees (homework, other brands, general knowledge, coding, etc.), don't answer it. Steer back naturally, for example: "${respectful ? 'Sir main Turabees ka hi kaam dekhta hoon — fabrics, suits, sherwani, orders. Us mein kuch poochhein to bata doon.' : 'Yaar main Turabees ka hi kaam dekhta hoon — fabrics, suits, sherwani, orders. Us mein kuch poochho to bata doon.'}"
- Don't repeat the same steer-back line every time. Keep it short and human.
- If they ask about their own details (name, phone, wedding date, preferences, what they told you earlier, what you discussed), answer from WHO YOU ARE TALKING TO and the chat history below. If it's not there, say you don't remember and ask them to remind you.

TURABEES QUESTIONS:
- Answer every Turabees/fabric question using the profile and dataset context above.
- Use exact counts when a COUNT ANSWER is provided. Never estimate counts.
- Mention useful details naturally (name, code, colour, composition, quality, pattern, season). Don't dump raw rows or image URLs.
- If a fabric/detail isn't in the context, say you don't have that exact one and ask a short follow-up, or share info@turabees.com / +44 7751 149279.
- If the user misspells Turabees (Turabis, Turabes, Turabeez, etc.), gently correct it to "Turabees" and then answer.
- If the user only sends the brand name (even misspelled), correct it and add a short intro: "Turabees ek wedding couture atelier hai — suits, sherwani, prince coats, waistcoats bespoke banate hain." Then ask what they want to know.

ATTACHMENTS:
- Images/audio/PDF/Word/Excel/PowerPoint/text files: if related to Turabees or its fabrics, look at the content and answer. If unrelated, don't analyze it; send a short human line steering back to Turabees.
- For multiple attachments, handle the related ones and ignore the unrelated ones.

OUTPUT:
Return strictly valid JSON: { "replies": ["first bubble", "optional second bubble"] } with no markdown or extra text.`;

  const languageDirective = language === 'english'
    ? 'The newest DM is in ENGLISH. Your entire reply must be in English. No Roman Urdu words (yaar, haan, hai, acha, bhai, kya, etc.). Even if the contact is from Pakistan, reply in English.'
    : language === 'urdu'
      ? 'The newest DM is in URDU SCRIPT. Your entire reply must be in Urdu script. Do not use Roman Urdu or English.'
      : 'The newest DM is in ROMAN URDU. Your entire reply must be in Roman Urdu. Do not switch to English.';

  const userPrompt = `${systemInstruction}

--- RECENT CHAT HISTORY ---
${historyText}

--- NEW INCOMING MESSAGE(S) FROM ${contactName} ---
${incomingText}

--- LANGUAGE REQUIREMENT (MANDATORY) ---
${languageDirective}

Reply as John in JSON:`;

  // Gemini recommends placing the text prompt before image/audio parts.
  // Labels keep each attachment associated with the correct incoming message.
  const parts = [{ text: userPrompt }];
  for (const item of inlineMediaItems) {
    if (item.label) parts.push({ text: item.label });
    parts.push({ inlineData: item.inlineData });
  }

  const totalKeys = keys.length;
  let attempts = 0;
  const primaryModel = config.geminiModel || 'gemini-2.5-flash';

  while (attempts < totalKeys) {
    if (deadline && Date.now() >= deadline - 250) {
      console.warn(`${ANSI.yellow}⚠️ [Gemini] Safety timeout reached; sending short human fallback.${ANSI.reset}`);
      return { replies: [getFallbackLine(respectful, language)], usedKeyIndex: null, error: 'deadline' };
    }

    const keyIdx = currentKeyIndex % totalKeys;
    const apiKey = keys[keyIdx];
    const keyNumber = keyIdx + 1;
    attempts++;

    // The lite model is fast and multimodal. Keep a full Flash fallback for
    // cases where the primary model is unavailable.
    const modelsToTry = [primaryModel, 'gemini-3.5-flash'].filter((v, i, a) => a.indexOf(v) === i);

    let keyHandled = false;

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const remainingMs = deadline ? Math.max(500, deadline - Date.now()) : 15000;
        const attemptTimeoutMs = Math.min(8000, remainingMs);

        // Keep the timeout active through the body read too; a response that
        // sends headers but stalls the body must not hang the request.
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(attemptTimeoutMs),
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.9,
              maxOutputTokens: 160
            }
          })
        });

        // Failover on rate limit (429), quota (403), or server error (5xx)
        if (res.status === 429 || res.status === 403) {
          const nextIndex = (currentKeyIndex + 1) % totalKeys;
          console.log(`${ANSI.yellow}⚠️ [Gemini Key #${keyNumber}] Quota/Rate-limit reached (HTTP ${res.status}). Switching to Key #${nextIndex + 1}...${ANSI.reset}`);
          currentKeyIndex = nextIndex;
          keyHandled = true;
          break; // Try next key
        }

        // On 503 (demand spike) or 404 (model retired/not found), try next model in chain
        if (res.status === 503 || res.status === 404) {
          continue;
        }

        if (!res.ok) {
          const errBody = await res.text();
          console.warn(`[Gemini API] Key #${keyNumber} (${model}) HTTP ${res.status}:`, errBody.slice(0, 150));
          continue;
        }

        const data = await res.json();
        const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (rawJsonText) {
          const replies = parseRepliesLoose(rawJsonText);
          const localized = localizeReplies(replies, language);
          if (localized.length > 0) {
            return { replies: localized, usedKeyIndex: keyNumber, model };
          }
          if (/"replies"\s*:\s*\[\s*\]/i.test(rawJsonText)) {
            return { replies: [], usedKeyIndex: keyNumber, model, emptyReply: true };
          }
          console.warn('[Gemini API] Could not parse replies from:', String(rawJsonText).slice(0, 200));
        }
      } catch (networkErr) {
        if (networkErr && (networkErr.name === 'AbortError' || networkErr.name === 'TimeoutError')) {
          if (deadline && Date.now() < deadline - 500) {
            console.warn(`${ANSI.yellow}⚠️ [Gemini] Attempt timed out; trying the next key/model.${ANSI.reset}`);
            keyHandled = false;
            break; // move to the next key
          }
          console.warn(`${ANSI.yellow}⚠️ [Gemini] Safety timeout reached; sending short human fallback.${ANSI.reset}`);
          return { replies: [getFallbackLine(respectful, language)], usedKeyIndex: null, error: 'deadline' };
        }
        console.warn(`[Gemini API] Network error on Key #${keyNumber} (${model}):`, networkErr.message);
      }
    }

    if (!keyHandled) {
      currentKeyIndex = (currentKeyIndex + 1) % totalKeys;
    }
  }

  console.warn(`${ANSI.yellow}⚠️ All ${totalKeys} Gemini API keys failed or were rate-limited.${ANSI.reset}`);
  return {
    replies: [getFallbackLine(respectful, language)],
    usedKeyIndex: null,
    error: "All Gemini API keys exhausted"
  };
}

// =========================================================================
// 2. Localhost Recent Chats Web Dashboard & Command Queue Bridge
// =========================================================================

let contactsList = [];
const commandQueue = [];
const pendingRequests = new Map(); // requestId -> { res, timeoutId }

// Extension pushes 1-on-1 DM contacts
app.post('/api/sync-contacts', (req, res) => {
  const { contacts } = req.body || {};
  if (Array.isArray(contacts)) {
    contactsList = contacts;
    console.log(`${ANSI.cyan}[Dashboard Bridge] Synced ${contactsList.length} 1-on-1 contacts from WhatsApp Web.${ANSI.reset}`);
  }
  return res.status(200).json({ success: true, count: contactsList.length });
});

// Dashboard fetches 1-on-1 contacts list
app.get('/api/contacts', (req, res) => {
  return res.status(200).json({ success: true, count: contactsList.length, contacts: contactsList });
});

// Extension polls for pending command requests (e.g. fetch historical chat)
app.get('/api/poll-commands', (req, res) => {
  if (commandQueue.length > 0) {
    const command = commandQueue.shift();
    return res.status(200).json({ command });
  }
  return res.status(200).json({ command: null });
});

// Extension returns command results (resolves waiting dashboard promise)
app.post('/api/command-result', (req, res) => {
  const { requestId, chatId, messages = [], success = true, error } = req.body || {};
  const pending = pendingRequests.get(requestId);

  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingRequests.delete(requestId);
    pending.res.status(200).json({
      success,
      chatId,
      messages,
      error: error || null
    });
    return res.status(200).json({ acknowledged: true });
  }

  return res.status(200).json({ acknowledged: false, message: 'Request not found or timed out' });
});

// Dashboard requests historical messages for a contact
app.get('/api/chat-history', (req, res) => {
  const { chatId, limit = 50, filter = 'all' } = req.query;
  if (!chatId) {
    return res.status(400).json({ error: 'Missing required query parameter: chatId' });
  }

  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const command = {
    requestId,
    type: 'FETCH_CHAT_HISTORY',
    chatId,
    limit: parseInt(limit, 10) || 50,
    filter
  };

  const timeoutId = setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      pendingRequests.delete(requestId);
      res.status(504).json({ error: 'Timeout waiting for WhatsApp Web extension response' });
    }
  }, 12000);

  pendingRequests.set(requestId, { res, timeoutId });
  commandQueue.push(command);
});

// =========================================================================
// 3. AI Reply Endpoint (POST /ai-reply)
// =========================================================================

app.post('/ai-reply', async (req, res) => {
  const {
    chatId = '',
    chatTitle = 'Unknown',
    senderName = 'Unknown',
    senderNumber = '',
    isSaved = false,
    incomingMessages = [],
    chatHistory = []
  } = req.body || {};

  const timeBadge = `${ANSI.cyan}[${new Date().toLocaleTimeString()}]${ANSI.reset}`;

  const memoryKey = chatId || senderNumber || chatTitle || 'unknown';
  const storedHistory = chatMemory.get(memoryKey) || [];
  const mergedHistory = dedupeHistory([...storedHistory, ...(chatHistory || [])]).slice(-80);

  const incomingText = (incomingMessages || [])
    .map((m) => (typeof m === 'string' ? m : (m && (m.text || m.message)) || ''))
    .join('\n');

  const respectful = isRespectfulContact({ senderName, chatTitle, incomingText });
  const language = detectMessageLanguage(incomingText);

  const mediaItems = (incomingMessages || [])
    .filter((m) => m && m.media && m.media.hasMedia)
    .map((m) => {
      const media = m.media;
      return `${media.mediaType || 'file'}${media.fileName ? ` (${media.fileName})` : ''}`;
    });
  const hasMedia = mediaItems.length > 0;
  const mediaSummary = mediaItems.join(', ');

  const deadline = Date.now() + AI_REPLY_DEADLINE_MS;

  // Extract PDF text locally. Reading a large PDF inside Gemini can take
  // several seconds, which would break the 10s reply budget.
  await Promise.all((incomingMessages || []).map(async (m) => {
    const media = m && m.media;
    if (!media || !media.hasMedia || !media.base64Data) return;
    const mime = String(media.mimeType || '').toLowerCase();
    if (!mime.includes('pdf')) return;
    try {
      const text = await Promise.race([
        extractPdfText(media.base64Data),
        sleep(900).then(() => null)
      ]);
      if (text) {
        media.extractedText = text;
        media.base64Data = null;
        console.log(`[Pdf Extractor] Extracted ${text.length} chars from ${media.fileName || 'PDF'} locally.`);
      }
    } catch (_) {}
  }));

  const relevance = turabees.assessRelevance(incomingText, mergedHistory);
  console.log(`${timeBadge} ${ANSI.gray}🧠 Mode: ${relevance.relevant ? 'Turabees/fabrics' : 'gossip / personal / unrelated'}${ANSI.reset}`);

  const contextPack = turabees.buildContext({
    text: incomingText,
    chatHistory: mergedHistory,
    hasMedia,
    mediaSummary
  });

  const result = await generateHumanReply({
    chatTitle,
    senderName,
    senderNumber,
    isSaved,
    respectful,
    language,
    incomingMessages,
    chatHistory: mergedHistory,
    turabeesContext: contextPack.context,
    hasMedia,
    localRelevance: relevance,
    deadline
  });

  let replies = result.replies || [];

  // If the model returned nothing, still reply like a human would.
  if (replies.length === 0) {
    replies = [hasMedia
      ? getFileSteerLine(respectful, language)
      : getSteerLine(respectful, language)];
  }

  // Remember this exchange so John can answer "what did I tell you earlier?"
  rememberChat(memoryKey, [
    ...(incomingMessages || []).map((m) => ({
      text: typeof m === 'string' ? m : (m && (m.text || m.message)) || '',
      fromMe: false,
      timestamp: (m && m.timestamp) || ''
    })),
    ...replies.map((text) => ({ text, fromMe: true, timestamp: new Date().toLocaleTimeString() }))
  ]);

  const keyLabel = result.usedKeyIndex ? `Key #${result.usedKeyIndex}` : 'Fallback';

  // Rich, scannable terminal output
  console.log(DIVIDER);
  console.log(`${timeBadge} ${ANSI.brightGreen}${ANSI.bold}💬 JOHN REPLY (${keyLabel})${ANSI.reset}`);

  const contactLabel = (isSaved && senderName !== 'Unknown')
    ? `${ANSI.brightCyan}${senderName}${ANSI.reset}`
    : `${ANSI.white}Unknown${ANSI.reset} (${ANSI.brightYellow}${senderNumber || chatTitle}${ANSI.reset})`;

  console.log(`${ANSI.gray}👤 Contact  :${ANSI.reset} ${contactLabel}`);

  // Display incoming messages burst with rich multimodal details
  if (Array.isArray(incomingMessages) && incomingMessages.length > 0) {
    incomingMessages.forEach((m, idx) => {
      const text = typeof m === 'string' ? m : (m.text || m.message || '');
      const media = (typeof m === 'object' && m.media && m.media.hasMedia) ? m.media : null;
      const counter = `(${idx + 1}/${incomingMessages.length})`;

      if (media) {
        const sizeKb = media.fileSize ? `${Math.round(media.fileSize / 1024)} KB` : 'Attached';
        const type = (media.mediaType || '').toLowerCase();

        if (type === 'ptt') {
          console.log(`${ANSI.magenta}🎤 Received VM    ${counter}:${ANSI.reset} ${ANSI.brightWhite}[Voice Message • ${sizeKb}]${ANSI.reset}`);
        } else if (type === 'audio') {
          console.log(`${ANSI.magenta}🎵 Received Audio ${counter}:${ANSI.reset} ${ANSI.brightWhite}[${media.fileName || 'audio.mp3'} • ${sizeKb}]${ANSI.reset}`);
        } else if (type === 'image' || type === 'sticker') {
          const cap = media.caption ? ` Caption: "${media.caption}"` : (text && text !== '[IMAGE]' && text !== '[STICKER]' ? ` Caption: "${text}"` : '');
          console.log(`${ANSI.cyan}🖼️ Received Image ${counter}:${ANSI.reset} ${ANSI.brightWhite}[${media.mimeType || 'image/jpeg'} • ${sizeKb}]${cap}${ANSI.reset}`);
        } else if (type === 'document') {
          const cap = media.caption ? ` Caption: "${media.caption}"` : (text && text !== '[DOCUMENT]' ? ` Caption: "${text}"` : '');
          console.log(`${ANSI.yellow}📄 Received File  ${counter}:${ANSI.reset} ${ANSI.brightWhite}[${media.fileName || 'Document'} • ${sizeKb}]${cap}${ANSI.reset}`);
        } else {
          console.log(`${ANSI.gray}📎 Received Media ${counter}:${ANSI.reset} ${ANSI.brightWhite}[${media.fileName || type} • ${sizeKb}]${ANSI.reset}`);
        }
      } else {
        console.log(`${ANSI.gray}💬 Received       ${counter}:${ANSI.reset} ${ANSI.white}${text}${ANSI.reset}`);
      }
    });
  }

  // Display generated AI replies
  replies.forEach((rep, idx) => {
    console.log(`${ANSI.green}🤖 Replied  (${idx + 1}/${replies.length}):${ANSI.reset} ${ANSI.brightWhite}"${rep}"${ANSI.reset}`);
  });

  console.log(DIVIDER);

  return res.status(200).json({
    success: true,
    replies,
    usedKeyIndex: result.usedKeyIndex,
    model: result.model
  });
});

// =========================================================================
// 4. Standard Message Logging Endpoint (POST /log-message)
// =========================================================================

app.post('/log-message', (req, res) => {
  const {
    isGroup = false,
    isSaved = false,
    chatTitle = 'Unknown',
    senderName = 'Unknown',
    senderNumber = '',
    message = '',
    timestamp = new Date().toLocaleTimeString(),
    autoReplied = false,
    cooldownActive = false
  } = req.body || {};

  const timeBadge = `${ANSI.cyan}[${timestamp}]${ANSI.reset}`;

  console.log(DIVIDER);

  if (isGroup) {
    // Group Chat: Show <Group Name> by (<senderNumber>) then the message it sent.
    const senderDisplay = (senderNumber && senderNumber !== 'Hidden/Saved' && senderNumber !== 'Unknown')
      ? senderNumber
      : (senderName && senderName !== 'Unknown' ? senderName : 'Unknown');

    console.log(`${timeBadge} ${ANSI.magenta}${ANSI.bold}👥 GROUP MESSAGE${ANSI.reset}`);
    console.log(`${ANSI.gray}🏷️ Group  :${ANSI.reset} ${ANSI.brightCyan}${chatTitle}${ANSI.reset} by (${ANSI.yellow}${senderDisplay}${ANSI.reset})`);
    console.log(`${ANSI.gray}💬 Message:${ANSI.reset} ${ANSI.brightWhite}${message}${ANSI.reset}`);
  } else {
    // 1-on-1 Chat
    const isSavedContact = Boolean(isSaved) || (senderName && senderName !== 'Unknown' && !isPhoneNumber(senderName));

    if (isSavedContact) {
      // 1-on-1 Saved Contact: Show Name only (and Message)
      console.log(`${timeBadge} ${ANSI.brightGreen}${ANSI.bold}📩 1-ON-1 MESSAGE${ANSI.reset}`);
      console.log(`${ANSI.gray}👤 Sender :${ANSI.reset} ${ANSI.brightCyan}${senderName}${ANSI.reset}`);
      console.log(`${ANSI.gray}💬 Message:${ANSI.reset} ${ANSI.brightWhite}${message}${ANSI.reset}`);
    } else {
      // 1-on-1 Unsaved Contact: Show Unknown (<senderNumber>) (and Message)
      const phoneDisplay = (senderNumber && senderNumber !== 'Unknown') ? senderNumber : chatTitle;

      console.log(`${timeBadge} ${ANSI.yellow}${ANSI.bold}📩 1-ON-1 MESSAGE${ANSI.reset}`);
      console.log(`${ANSI.gray}👤 Sender :${ANSI.reset} ${ANSI.white}Unknown${ANSI.reset} (${ANSI.brightYellow}${phoneDisplay}${ANSI.reset})`);
      console.log(`${ANSI.gray}💬 Message:${ANSI.reset} ${ANSI.brightWhite}${message}${ANSI.reset}`);
    }

    // Auto-Reply status confirmation
    if (autoReplied) {
      console.log(`${ANSI.brightGreen}🤖 Auto-Reply: Sent "Replying in a bit. Kindly wait!" (30m cooldown started)${ANSI.reset}`);
    } else if (cooldownActive) {
      console.log(`${ANSI.dim}🤖 Auto-Reply: Skipped (30m cooldown active for this contact)${ANSI.reset}`);
    }
  }

  console.log(DIVIDER);

  return res.status(200).json({ success: true, loggedAt: timestamp });
});

// Root route: Serves the WhatsApp Recent Chats Dashboard UI
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  const config = loadConfig();
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Terminal Logger Server</title>
  <style>
    body {
      margin: 0;
      background: #0f141c;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #161d27;
      border: 1px solid #232d3d;
      border-radius: 12px;
      padding: 32px 40px;
      text-align: center;
      max-width: 560px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    h1 {
      font-size: 19px;
      color: #10b981;
      margin-bottom: 12px;
    }
    p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .badges {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-bottom: 16px;
    }
    .badge {
      background: #1e293b;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      color: #38bdf8;
    }
    .endpoint {
      background: #0b0f15;
      padding: 10px 16px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 13px;
      color: #38bdf8;
      display: inline-block;
      border: 1px solid #1e293b;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ WhatsApp Terminal Logger & AI Server Online</h1>
    <p>Running on Port 3000 with Multi-Key Gemini Failover Engine & Dashboard Bridge.</p>
    <div class="badges">
      <span class="badge">Model: ${config.geminiModel}</span>
      <span class="badge">Gemini Keys: ${config.geminiApiKeys.length}</span>
      <span class="badge">Debounce: ${config.debounceSeconds}s</span>
    </div>
    <div class="endpoint">POST http://localhost:3000/ai-reply</div>
  </div>
</body>
</html>`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const config = loadConfig();
  res.status(200).json({
    status: 'running',
    geminiModel: config.geminiModel,
    keysConfigured: config.geminiApiKeys.length,
    contactsCached: contactsList.length
  });
});

// Start the server
app.listen(PORT, () => {
  const config = loadConfig();
  console.log('\n' + `${ANSI.cyan}${ANSI.bold}╔══════════════════════════════════════════════════════════╗${ANSI.reset}`);
  console.log(`${ANSI.cyan}${ANSI.bold}║       WhatsApp Terminal Logger & AI Reply Server         ║${ANSI.reset}`);
  console.log(`${ANSI.cyan}${ANSI.bold}╚══════════════════════════════════════════════════════════╝${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Status:${ANSI.reset}     ${ANSI.brightGreen}Online & Listening${ANSI.reset}`);
  console.log(`  ${ANSI.bold}URL:${ANSI.reset}        ${ANSI.brightCyan}http://localhost:${PORT}${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Gemini:${ANSI.reset}     ${ANSI.yellow}${config.geminiModel}${ANSI.reset} (${config.geminiApiKeys.length} API keys loaded)`);
  console.log(`  ${ANSI.bold}Debounce:${ANSI.reset}   ${config.debounceSeconds}s burst window`);
  console.log(`  ${ANSI.bold}Endpoints:${ANSI.reset}`);
  console.log(`    - ${ANSI.gray}POST http://localhost:${PORT}/ai-reply${ANSI.reset}        (Gemini Human Auto-Reply)`);
  console.log(`    - ${ANSI.gray}POST http://localhost:${PORT}/log-message${ANSI.reset}     (Terminal Message Logger)`);
  console.log(`    - ${ANSI.gray}GET  http://localhost:${PORT}/api/contacts${ANSI.reset}    (Dashboard Contacts)`);
  console.log(`    - ${ANSI.gray}GET  http://localhost:${PORT}/api/chat-history${ANSI.reset} (Dashboard Chat History)`);
  console.log(`${ANSI.gray}──────────────────────────────────────────────────────────${ANSI.reset}\n`);
});
