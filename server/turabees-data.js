'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'turabees');
const dataset = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fabrics.json'), 'utf8'));
const profile = fs.readFileSync(path.join(DATA_DIR, 'turabees-profile.md'), 'utf8');

const sheets = dataset.sheets || {};
const stats = dataset.stats || {};

const FABRIC_SHEETS = ['fabrics.csv', 'suit fabrics', 'Final 90 fabrics', 'Final Sehrwani fabrics'];

const SHEET_ALIASES = {
  'fabrics.csv': ['fabrics.csv', 'fabric.csv', 'fabrics csv', 'fabrics.scv', 'fabrics scv', 'fabric csv'],
  'suit fabrics': ['suit fabrics', 'suit fabric', 'suits fabrics', 'suit fabric sheet'],
  'Final 90 fabrics': ['final 90 fabrics', 'final 90', 'final ninety', 'final 90 fabric'],
  'Final Sehrwani fabrics': ['final sehrwani fabrics', 'final sherwani fabrics', 'final sherwani', 'final sehrwani', 'sherwani fabrics', 'sehrwani fabrics', 'sherwani fabric', 'sehrwani fabric'],
  'accessories': ['accessories', 'accessory'],
  'Image generation pipeline': ['image generation pipeline', 'image pipeline', 'generation pipeline'],
  'Sheet6': ['sheet6', 'sheet 6', 'sheet six']
};

const GENERIC_SHEET_ALIASES = new Set([
  'suit fabrics', 'suit fabric', 'suits fabrics', 'suit fabric sheet',
  'sherwani fabrics', 'sehrwani fabrics', 'sherwani fabric', 'sehrwani fabric'
]);

const SHEET_CONTEXT_RE = /\b(sheet|in|from|of|entries|entry|rows|row|how many|count|total|dataset|contains|has|have)\b/;

const STRONG_KEYWORDS = [
  'turabees', 'fabric', 'fabrics', 'suit', 'suits', 'suiting', 'sherwani', 'sehrwani', 'shewani',
  'prince coat', 'prince suit', 'waistcoat', 'waist coat', 'tuxedo', 'dinner suit', 'overcoat',
  'jacket', 'trouser', 'lining', 'vest', 'catalog', 'catalogue', 'catalog code', 'dataset',
  'spreadsheet', 'excel', 'xlsx', 'fabrics.csv', 'fabrics.scv', 'final 90', 'final 90 fabrics',
  'final sherwani', 'final sehrwani', 'accessories', 'khussa', 'stole', 'swatch', 'cloth',
  'textile', 'holland & sherry', 'holland and sherry', 'iag', 'apparel', 'jamawar', 'brocade',
  'jacquard', 'raw silk', 'wool worsted', 'worsted', 'cashmere', 'mohair', 'linen', 'denim',
  'velvet', 'viscose', 'taffeta', 'bemberg', 'camel hair', 'composition', 'embroidery',
  'zardozi', 'zari', 'tilla', 'bespoke', 'made to measure', 'wedding couture', 'groomswear'
];

const WEAK_KEYWORDS = [
  'blue', 'black', 'grey', 'gray', 'brown', 'green', 'neutral', 'red', 'white', 'pink',
  'orange', 'silver', 'gold', 'yellow', 'purple', 'metallic', 'maroon', 'ivory', 'cream',
  'charcoal', 'navy', 'beige', 'olive', 'burgundy', 'champagne', 'parchment', 'oatmeal',
  'spring', 'summer', 'autumn', 'winter', 'season',
  'check', 'plaid', 'stripe', 'herringbone', 'sharkskin', 'windowpane', 'birdseye',
  'houndstooth', 'paisley', 'damask', 'plain', 'solid', 'textured', 'woven', 'pattern',
  'price', 'cost', 'available', 'stock', 'lead time', 'size', 'sizes', 'picture', 'image',
  'photo', 'sample', 'recommend', 'suggest', 'which', 'what', 'show', 'list', 'find',
  'tell me', 'details', 'compare', 'difference', 'entry', 'entries', 'row', 'rows',
  'count', 'number', 'total', 'unique', 'how many', 'how much', 'more', 'about', 'info'
];

const ACK_WORDS = new Set([
  'ok', 'okay', 'k', 'thanks', 'thank', 'thankyou', 'shukriya', 'great', 'nice', 'cool',
  'good', 'hmm', 'hm', 'yes', 'no', 'haan', 'han', 'nahi', 'theek', 'thik', 'acha', 'achha',
  'sure', 'fine', 'alright', 'perfect', 'done', 'got', 'it', 'received', 'seen'
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'of', 'in', 'on', 'at',
  'to', 'for', 'with', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'as', 'by', 'from',
  'about', 'into', 'over', 'after', 'before', 'between', 'under', 'above', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'this', 'that', 'these',
  'those', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would',
  'should', 'may', 'might', 'must', 'shall', 'what', 'which', 'who', 'whom', 'whose',
  'when', 'where', 'why', 'how', 'many', 'much', 'any', 'some', 'all', 'both', 'each',
  'every', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'too', 'very', 'just',
  'please', 'kindly', 'tell', 'show', 'give', 'list', 'find', 'need', 'want', 'like'
]);

// Words that express intent but are poor search tokens (they match row names/descriptions).
const META_TOKENS = new Set([
  'price', 'prices', 'cost', 'costs', 'available', 'stock', 'lead', 'time', 'size', 'sizes',
  'picture', 'pictures', 'image', 'images', 'photo', 'photos', 'sample', 'samples',
  'recommend', 'recommendation', 'recommendations', 'suggest', 'suggestion', 'suggestions',
  'details', 'detail', 'info', 'information', 'unique', 'total', 'count', 'number',
  'entry', 'entries', 'row', 'rows', 'difference', 'differences', 'compare', 'comparison',
  'more', 'about', 'option', 'options', 'type', 'types', 'kind', 'kinds', 'fabric',
  'fabrics', 'sheet', 'sheets', 'dataset', 'catalog', 'catalogue', 'code', 'codes'
]);

// Known fabric names let the bot recognize queries like "price of RIVIERA"
// or "composition of SHERRY STRETCH" even when no generic keyword is present.
const KNOWN_NAMES = (() => {
  const set = new Set();
  for (const sheet of FABRIC_SHEETS) {
    for (const row of ((sheets[sheet] && sheets[sheet].rows) || [])) {
      const name = normalizeText(row.name);
      if (!name || name.length < 5) continue;
      if (name.split(' ').length === 1 && (STOPWORDS.has(name) || META_TOKENS.has(name))) continue;
      set.add(name);
    }
  }
  return [...set].sort((a, b) => b.length - a.length);
})();

function findKnownName(norm) {
  for (const name of KNOWN_NAMES) {
    if (includesPhrase(norm, name)) return name;
  }
  return null;
}

const COLOR_TERMS = [
  'black and white', 'black', 'white', 'grey', 'gray', 'blue', 'navy', 'brown', 'green',
  'neutral', 'red', 'pink', 'orange', 'silver', 'gold', 'yellow', 'purple', 'metallic',
  'maroon', 'ivory', 'cream', 'charcoal', 'beige', 'olive', 'burgundy', 'champagne',
  'parchment', 'oatmeal', 'coffee', 'camel', 'taupe', 'wine', 'rust', 'teal', 'aqua'
];

const PATTERN_TERMS = [
  'glen check', 'split matt check', 'chalk stripe', 'windowpane', 'herringbone',
  'sharkskin', 'houndstooth', 'birdseye', 'whipcord', 'jacquard', 'damask', 'paisley',
  'geometric', 'floral', 'micro weave', 'self stripe', 'cross weave', 'sateen',
  'check (plaid)', 'check', 'plaid', 'stripe', 'plain', 'solid', 'textured', 'woven',
  'corduroy', 'embroidered', 'embossed', 'brocade'
];

const FABRIC_TERMS = [
  'super 200', 'super 180', 'super 170', 'super 160', 'super 140', 'super 130',
  'super 120', 'super 100', 'wool worsted', 'worsted', 'wool', 'cotton', 'linen',
  'silk', 'raw silk', 'cashmere', 'mohair', 'denim', 'velvet', 'viscose', 'taffeta',
  'bemberg satin', 'camel hair', 'synthetic fibre', 'polyester', 'brocade',
  'jamawar', 'jacquard', 'silk blend', 'linen blend', 'matte finish'
];

const CATEGORY_TERMS = [
  'prince coat', 'prince suit', 'waistcoat', 'waist coat', 'sherwani', 'sehrwani',
  'shewani', 'tuxedo', 'dinner suit', 'two-piece suit', 'three-piece suit',
  'double-breasted', 'overcoat', 'jacket', 'trouser', 'lining', 'vest', 'suit'
];

const SEASON_TERMS = [
  'autumn / winter', 'spring / summer', 'autumn/winter', 'spring/summer',
  'all season', 'all-season'
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  a = String(a || '');
  b = String(b || '');
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[n];
}

function findTurabeesVariant(text) {
  const rawWords = String(text || '').match(/[A-Za-z][A-Za-z.'-]{3,}/g) || [];
  for (const raw of rawWords) {
    const w = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!w || w.length < 5) continue;
    if (w === 'turabees' || w === 'turabeescom') continue;
    if (w.startsWith('turab')) return raw;
    if (levenshtein(w, 'turabees') <= 2) return raw;
  }
  return null;
}

function hasTurabeesMention(text) {
  const norm = normalizeText(text);
  if (/\bturabees\b/.test(norm)) return true;
  if (norm.includes('turabees com') || norm.includes('turabees.com')) return true;
  return Boolean(findTurabeesVariant(text));
}

function detectSheet(text) {
  const norm = normalizeText(text);
  if (/\bfabrics?\s+(xlsx|xls|excel|workbook|file)\b/.test(norm) ||
      /\b(workbook|all sheets|whole file|excel file|this excel|the excel)\b/.test(norm)) {
    return '__workbook__';
  }
  for (const [sheet, aliases] of Object.entries(SHEET_ALIASES)) {
    for (const alias of aliases) {
      const a = normalizeText(alias);
      if (!a || !norm.includes(a)) continue;
      // "suit fabrics" / "sherwani fabrics" are generic phrases unless the
      // user is clearly talking about a sheet (e.g. "how many rows in ...").
      if (GENERIC_SHEET_ALIASES.has(a) && !SHEET_CONTEXT_RE.test(norm)) continue;
      return sheet;
    }
  }
  if (/\bworkbook\b|\ball sheets\b|\bwhole file\b/.test(norm)) return '__workbook__';
  return null;
}

function extractCatalogCode(text) {
  const match = String(text || '').match(/(?:^|\D)(\d{6,8})(?:\D|$)/);
  return match ? match[1] : null;
}

function isAcknowledgement(norm) {
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => ACK_WORDS.has(w));
}

function assessRelevance(text, chatHistory = []) {
  const norm = normalizeText(text);
  const historyText = (chatHistory || [])
    .slice(-8)
    .map((item) => (typeof item === 'string' ? item : item && item.text))
    .filter(Boolean)
    .join(' ');
  const historyNorm = normalizeText(historyText);

  const currentTurabees = hasTurabeesMention(text);
  const historyTurabees = hasTurabeesMention(historyText);
  const sheet = detectSheet(text);
  const code = extractCatalogCode(text);
  const strongMatches = STRONG_KEYWORDS.filter((k) => norm.includes(k));
  const weakMatches = WEAK_KEYWORDS.filter((k) => norm.includes(k));
  const isAck = isAcknowledgement(norm);
  const hasQuestionMark = /\?/.test(String(text || ''));
  const hasQuestionWord = /\b(how|what|which|who|when|where|why|do|does|can|could|would|should|tell|show|list|find|recommend|suggest|price|cost|available|compare|difference|details|info|count|entries|rows|total|looking|need|want|interested|help|options)\b/.test(norm);
  const hasIsAreQuestion = /\b(is|are)\s+(there|this|that|it|the|your|any|my)\b/.test(norm);
  const isQuestion = hasQuestionMark || hasQuestionWord || hasIsAreQuestion;
  const isPersonalStatement = /\b(i|we)\s+(like|love|prefer|hate|enjoy|think|feel)\b/.test(norm);
  const wordCount = norm.split(/\s+/).filter(Boolean).length;
  const short = wordCount <= 3;

  const countIntent = /\b(how many|count|number of|total)\b/.test(norm) &&
    /\b(colors?|colours?|patterns?|styles?|seasons?|fabrics?|suits?|sherwani|sehrwani|waistcoat|prince coat|entries|rows|accessories|catalog|codes?)\b/.test(norm);
  const availabilityIntent = /\b(what|which|list|show|do you have|can you)\b/.test(norm) &&
    /\b(colors?|colours?|patterns?|styles?|fabrics?|suits?|sherwani|sehrwani|waistcoat|prince coat|accessories|blue|black|grey|gray|brown|green|red|white|pink|orange|silver|gold|yellow|purple|maroon|ivory|cream|charcoal|navy|beige|olive|burgundy)\b/.test(norm) &&
    /\b(available|options|have|dataset|catalog|turabees|there|show|list|see)\b/.test(norm);
  const knownName = findKnownName(norm);
  const historyDomain = historyTurabees ||
    STRONG_KEYWORDS.some((k) => historyNorm.includes(k)) ||
    Boolean(detectSheet(historyText));
  const followUp = historyDomain && short && !isAck && (isQuestion || weakMatches.length > 0);

  let relevant = false;
  let reason = 'not_turabees_related';

  if (isAck && !currentTurabees) {
    relevant = false;
    reason = 'acknowledgement_only';
  } else if (currentTurabees) {
    relevant = isQuestion || wordCount <= 2;
    reason = relevant ? 'turabees_mention' : 'turabees_statement';
  } else if (sheet) {
    relevant = !isPersonalStatement && (isQuestion || wordCount <= 4);
    reason = relevant ? 'sheet_mention' : 'sheet_statement';
  } else if (code) {
    relevant = !isPersonalStatement;
    reason = relevant ? 'catalog_code' : 'catalog_code_statement';
  } else if (knownName) {
    relevant = isQuestion || wordCount <= 2;
    reason = relevant ? 'fabric_name' : 'fabric_name_statement';
  } else if (countIntent || availabilityIntent) {
    relevant = true;
    reason = 'dataset_intent';
  } else if (strongMatches.length > 0 && !isPersonalStatement && (isQuestion || short)) {
    relevant = true;
    reason = 'dataset_keyword';
  } else if (followUp) {
    relevant = true;
    reason = 'follow_up';
  }

  return {
    relevant,
    reason,
    turabeesMention: currentTurabees,
    turabeesVariant: findTurabeesVariant(text),
    sheet,
    catalogCode: code,
    knownName,
    strongKeywords: strongMatches.slice(0, 10),
    weakKeywords: weakMatches.slice(0, 10),
    followUp
  };
}

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('en-US');
}

function countRows(sheetName, predicate) {
  const rows = (sheets[sheetName] && sheets[sheetName].rows) || [];
  return rows.filter(predicate).length;
}

function categoryCounts() {
  const isPlainSuit = (value) => {
    const s = String(value || '').toLowerCase();
    return s === 'suit' || s === 'suits' || (s.includes('suit') && !s.includes('prince'));
  };
  return {
    'fabrics.csv': {
      suits: countRows('fabrics.csv', (r) => isPlainSuit(r.use)),
      jackets: countRows('fabrics.csv', (r) => String(r.use || '').toLowerCase() === 'jackets'),
      trousers: countRows('fabrics.csv', (r) => String(r.use || '').toLowerCase() === 'trousers'),
      overcoats: countRows('fabrics.csv', (r) => String(r.use || '').toLowerCase() === 'overcoats'),
      linings: countRows('fabrics.csv', (r) => String(r.use || '').toLowerCase() === 'linings')
    },
    'suit fabrics': {
      suits: countRows('suit fabrics', (r) => isPlainSuit(r.category)),
      jackets: countRows('suit fabrics', (r) => String(r.category || '').toLowerCase() === 'jackets'),
      trousers: countRows('suit fabrics', (r) => String(r.category || '').toLowerCase() === 'trousers'),
      overcoats: countRows('suit fabrics', (r) => String(r.category || '').toLowerCase() === 'overcoats'),
      linings: countRows('suit fabrics', (r) => String(r.category || '').toLowerCase() === 'linings')
    },
    'Final 90 fabrics': {
      suits: countRows('Final 90 fabrics', (r) => isPlainSuit(r.category)),
      princeSuits: countRows('Final 90 fabrics', (r) => String(r.category || '').toLowerCase().includes('prince'))
    },
    'Final Sehrwani fabrics': {
      all: countRows('Final Sehrwani fabrics', () => true),
      sherwani: countRows('Final Sehrwani fabrics', (r) => /sherwani|sehrwani|shewani/i.test(String(r.category || '') + ' ' + String(r.name || ''))),
      princeCoat: countRows('Final Sehrwani fabrics', (r) => /prince/i.test(String(r.category || ''))),
      waistcoat: countRows('Final Sehrwani fabrics', (r) => /waistcoat/i.test(String(r.category || '')))
    }
  };
}

const CATEGORY_COUNTS = categoryCounts();

function getStatsSummary() {
  const s = stats;
  const sheetCounts = s.sheet_counts || {};
  const lines = [];
  lines.push(`Workbook source: fabrics.xlsx.`);
  lines.push(`Sheet row counts: ${Object.entries(sheetCounts).map(([k, v]) => `${k} = ${fmt(v)}`).join('; ')}.`);
  lines.push(`All sheets total: ${fmt(s.total_rows_all_sheets)} data rows.`);
  lines.push(`Four fabric sheets total: ${fmt(s.total_rows_fabric_sheets)} data rows; ${fmt(s.unique_catalog_codes_in_fabric_sheets)} unique catalog codes; ${fmt(s.unique_names_in_fabric_sheets)} unique fabric names.`);
  lines.push(`Distinct values across fabric sheets: colors = ${fmt(s.unique_colors)}; fabric types/qualities = ${fmt(s.unique_fabric_types_qualities)}; patterns/styles = ${fmt(s.unique_patterns_styles)}; seasons = ${fmt(s.unique_seasons)}.`);
  lines.push(`Top colors: ${(s.top_colors || []).slice(0, 12).map(([k, v]) => `${k} ${fmt(v)}`).join('; ')}.`);
  lines.push(`Top fabric types/qualities: ${(s.top_fabric_types_qualities || []).slice(0, 12).map(([k, v]) => `${k} ${fmt(v)}`).join('; ')}.`);
  lines.push(`Top patterns/styles: ${(s.top_patterns_styles || []).slice(0, 12).map(([k, v]) => `${k} ${fmt(v)}`).join('; ')}.`);
  lines.push(`Category breakdown — fabrics.csv: suits ${fmt(CATEGORY_COUNTS['fabrics.csv'].suits)}, jackets ${fmt(CATEGORY_COUNTS['fabrics.csv'].jackets)}, trousers ${fmt(CATEGORY_COUNTS['fabrics.csv'].trousers)}, overcoats ${fmt(CATEGORY_COUNTS['fabrics.csv'].overcoats)}, linings ${fmt(CATEGORY_COUNTS['fabrics.csv'].linings)}.`);
  lines.push(`Category breakdown — suit fabrics: suits ${fmt(CATEGORY_COUNTS['suit fabrics'].suits)}, jackets ${fmt(CATEGORY_COUNTS['suit fabrics'].jackets)}, trousers ${fmt(CATEGORY_COUNTS['suit fabrics'].trousers)}, overcoats ${fmt(CATEGORY_COUNTS['suit fabrics'].overcoats)}, linings ${fmt(CATEGORY_COUNTS['suit fabrics'].linings)}.`);
  lines.push(`Category breakdown — Final 90 fabrics: suits ${fmt(CATEGORY_COUNTS['Final 90 fabrics'].suits)}, prince suits ${fmt(CATEGORY_COUNTS['Final 90 fabrics'].princeSuits)}.`);
  lines.push(`Category breakdown — Final Sehrwani fabrics: all ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].all)}, sherwani-related ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].sherwani)}, prince-coat-related ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].princeCoat)}, waistcoat-related ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].waistcoat)}.`);
  lines.push(`Top seasons: ${(s.top_seasons || []).slice(0, 10).map(([k, v]) => `${k} ${fmt(v)}`).join('; ')}.`);
  lines.push(`Accessories sheet: ${(s.accessories || []).map((a) => `${a.name} (${a.accessory_type}) — price ${a.price}, floor ${a.floor_price}, colors ${a.available_colors}, stock ${a.stock_quantity}, lead time ${a.lead_time_days} day(s)`).join('; ')}.`);
  return lines.join('\n');
}

const STATS_SUMMARY = getStatsSummary();

const COMPACT_PROFILE = 'Turabees is a wedding couture atelier for bespoke bridal and groomswear: suits, sherwanis, prince coats and waistcoats. UK office: info@turabees.com, +44 7751 149279. You are John from Turabees.';

function getCompactStatsSummary() {
  const s = stats;
  const counts = s.sheet_counts || {};
  const top = (arr, n) => (arr || []).slice(0, n).map(([k, v]) => `${k} ${fmt(v)}`).join('; ');
  return [
    `Sheets: ${Object.entries(counts).map(([k, v]) => `${k} ${fmt(v)}`).join('; ')}.`,
    `Fabric sheets: ${fmt(s.total_rows_fabric_sheets)} rows, ${fmt(s.unique_catalog_codes_in_fabric_sheets)} unique catalog codes, ${fmt(s.unique_names_in_fabric_sheets)} names.`,
    `Top colors: ${top(s.top_colors, 5)}.`,
    `Top fabrics: ${top(s.top_fabric_types_qualities, 5)}.`,
    `Top patterns: ${top(s.top_patterns_styles, 5)}.`,
    `Accessories: ${(s.accessories || []).map((a) => `${a.name} (${a.price})`).join('; ')}.`
  ].join('\n');
}

function getCountAnswer(text) {
  const norm = normalizeText(text);
  const asksCount = /\b(how many|how much|count|number of|total|entries|entry|rows|row count|kitne|kitni|kitna)\b/.test(norm);
  if (!asksCount) return null;

  const sheet = detectSheet(text);
  const datasetTerms = /\b(fabrics?|suits?|sherwani|sehrwani|waistcoat|prince|coat|accessories|accessory|catalog|catalogue|codes?|dataset|sheets?|colors?|colours?|patterns?|styles?|seasons?|entry|entries|rows?)\b/.test(norm);
  if (!sheet && !datasetTerms) return null;

  const sheetCounts = stats.sheet_counts || {};

  if (sheet === '__workbook__') {
    return `The workbook fabrics.xlsx has ${fmt(stats.total_rows_all_sheets)} data rows across ${Object.keys(sheetCounts).length} sheets. The four fabric sheets contain ${fmt(stats.total_rows_fabric_sheets)} rows and ${fmt(stats.unique_catalog_codes_in_fabric_sheets)} unique catalog codes.`;
  }

  if (sheet) {
    const n = sheetCounts[sheet] || 0;
    let extra = '';
    if (sheet === 'fabrics.csv') {
      extra = ` Of these, ${fmt(CATEGORY_COUNTS['fabrics.csv'].suits)} have use=Suits. The four fabric sheets together contain ${fmt(stats.total_rows_fabric_sheets)} rows and ${fmt(stats.unique_catalog_codes_in_fabric_sheets)} unique catalog codes.`;
    } else if (sheet === 'Final 90 fabrics') {
      extra = ` Note: the sheet name says "Final 90" but it actually contains ${fmt(n)} data rows.`;
    } else if (sheet === 'Final Sehrwani fabrics') {
      extra = ` Of these, ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].sherwani)} are sherwani-related; this is the sherwani / waistcoat / prince-coat fabric sheet.`;
    } else if (sheet === 'suit fabrics') {
      extra = ` Of these, ${fmt(CATEGORY_COUNTS['suit fabrics'].suits)} are in the Suits category.`;
    }
    return `The "${sheet}" sheet has ${fmt(n)} non-empty data rows.${extra}`;
  }

  if (/\bunique\b.*\b(catalog|code|codes)\b|\b(catalog|code|codes)\b.*\bunique\b/.test(norm)) {
    return `Across the four fabric sheets there are ${fmt(stats.unique_catalog_codes_in_fabric_sheets)} unique catalog codes.`;
  }
  if (/\bunique\b.*\b(names?|fabrics?)\b|\b(names?|fabrics?)\b.*\bunique\b/.test(norm)) {
    return `Across the four fabric sheets there are ${fmt(stats.unique_names_in_fabric_sheets)} unique fabric names and ${fmt(stats.unique_catalog_codes_in_fabric_sheets)} unique catalog codes.`;
  }
  if (/\b(colors?|colours?)\b/.test(norm) && /\bunique|how many|total|number\b/.test(norm)) {
    const top = (stats.top_colors || []).slice(0, 5).map(([k, v]) => `${k} (${fmt(v)})`).join(', ');
    return `The fabric sheets contain ${fmt(stats.unique_colors)} distinct color labels, including multi-color combinations. The most common color groups are ${top}.`;
  }
  if (/\b(fabric type|fabric types|quality|qualities)\b/.test(norm)) {
    return `There are ${fmt(stats.unique_fabric_types_qualities)} distinct fabric types/qualities in the fabric sheets. The most common are Wool Worsted, Super 120's Worsted, Super 170's Worsted, Super 100's Worsted, Cotton, Super 140's Worsted, Wool, Super 160's Worsted, Cashmere and Super 130's Worsted.`;
  }
  if (/\b(patterns?|styles?)\b/.test(norm)) {
    return `There are ${fmt(stats.unique_patterns_styles)} distinct patterns/styles in the fabric sheets. Common ones include Plain, Solid, Glen Check (Plaid), Stripe, Herringbone, Sharkskin, Windowpane, Chalk Stripe, Check (Plaid) and Birdseye.`;
  }
  if (/\bseasons?\b/.test(norm)) {
    return `There are ${fmt(stats.unique_seasons)} distinct season labels across the fabric sheets, spanning Spring/Summer and Autumn/Winter collections from 2016 through 2027.`;
  }
  if (/\baccessor(y|ies)\b/.test(norm)) {
    return `The "accessories" sheet has ${fmt(sheetCounts['accessories'] || 0)} data rows: Royal Embroidered Stole and Heritage Zari Khussa.`;
  }
  if (/\bsuits?\b/.test(norm)) {
    return `Suit rows by sheet: fabrics.csv ${fmt(CATEGORY_COUNTS['fabrics.csv'].suits)}; suit fabrics ${fmt(CATEGORY_COUNTS['suit fabrics'].suits)}; Final 90 fabrics ${fmt(CATEGORY_COUNTS['Final 90 fabrics'].suits)}. The Final Sehrwani fabrics sheet is sherwani/waistcoat/prince-coat focused.`;
  }
  if (/\b(sherwani|sehrwani|shewani)\b/.test(norm)) {
    return `The "Final Sehrwani fabrics" sheet has ${fmt(sheetCounts['Final Sehrwani fabrics'] || 0)} data rows. ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].sherwani)} of them are sherwani-related.`;
  }
  if (/\bprince\b/.test(norm)) {
    return `Prince-related rows: Final 90 fabrics ${fmt(CATEGORY_COUNTS['Final 90 fabrics'].princeSuits)}; Final Sehrwani fabrics ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].princeCoat)}.`;
  }
  if (/\bwaistcoat|waist coat\b/.test(norm)) {
    return `Waistcoat-related rows: Final Sehrwani fabrics ${fmt(CATEGORY_COUNTS['Final Sehrwani fabrics'].waistcoat)}.`;
  }

  return `The workbook fabrics.xlsx has ${fmt(stats.total_rows_all_sheets)} data rows across all 7 sheets. The four fabric sheets contain ${fmt(stats.total_rows_fabric_sheets)} rows and ${fmt(stats.unique_catalog_codes_in_fabric_sheets)} unique catalog codes.`;
}

function truncate(value, max = 240) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function rowHaystack(sheet, row) {
  const fields = [
    'catalog_code', 'name', 'color_name', 'available_colors', 'composition', 'description',
    'quality', 'fabric_type', 'fabric_grade', 'color_filter', 'style', 'pattern', 'use',
    'category', 'season', 'is_suiting', 'suit_styles', 'embroidery', 'accessory_type',
    'primary_color', 'material', 'fabric', 'pairs_with_categories', 'suitable_events',
    'price', 'floor_price', 'available_sizes', 'stock_quantity', 'lead_time_days', 'in_stock',
    'variations', 'status'
  ];
  const parts = [sheet];
  for (const f of fields) {
    if (row[f] != null) parts.push(String(row[f]));
  }
  return normalizeText(parts.join(' '));
}

function formatRow(sheet, row) {
  const parts = [`sheet: ${sheet}`];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      parts.push(`${label}: ${truncate(value)}`);
    }
  };
  add('code', row.catalog_code);
  add('name', row.name);
  add('color', row.color_name || row.primary_color);
  add('available colors', row.available_colors);
  add('composition/description', row.composition || row.description);
  add('fabric type/quality', row.fabric_type || row.quality);
  add('fabric grade', row.fabric_grade);
  add('pattern/style', row.pattern || row.style);
  add('category/use', row.category || row.use);
  add('season', row.season);
  add('suiting', row.is_suiting);
  add('suit styles', row.suit_styles);
  add('embroidery', row.embroidery);
  add('accessory type', row.accessory_type);
  add('price', row.price);
  add('floor price', row.floor_price);
  add('sizes', row.available_sizes);
  add('material', row.material);
  add('fabric', row.fabric);
  add('pairs with', row.pairs_with_categories);
  add('events', row.suitable_events);
  add('stock', row.stock_quantity);
  add('lead time days', row.lead_time_days);
  add('in stock', row.in_stock);
  add('variations', row.variations);
  add('status', row.status);
  const out = parts.join(' | ');
  return out.length > 560 ? out.slice(0, 560) + '…' : out;
}

function buildIndex() {
  const order = ['fabrics.csv', 'Final 90 fabrics', 'Final Sehrwani fabrics', 'suit fabrics', 'accessories', 'Image generation pipeline', 'Sheet6'];
  const records = [];
  for (const sheet of order) {
    const data = sheets[sheet];
    if (!data || !Array.isArray(data.rows)) continue;
    for (const row of data.rows) {
      records.push({ sheet, row, hay: rowHaystack(sheet, row) });
    }
  }
  return records;
}

const INDEX = buildIndex();

function includesPhrase(haystack, phrase) {
  const p = normalizeText(phrase);
  if (!p) return false;
  return ` ${haystack} `.includes(` ${p} `);
}

function includesToken(haystack, token) {
  if (!token) return false;
  if (includesPhrase(haystack, token)) return true;
  // Allow simple plurals/derivatives (suit -> suits, check -> checks).
  return includesPhrase(haystack, `${token}s`);
}

function matchPhrases(norm, terms) {
  return terms.filter((term) => includesPhrase(norm, term));
}

function searchFabrics(text, options = {}) {
  const limit = Math.max(1, Math.min(50, options.limit || 25));
  const norm = normalizeText(text);
  const requestedSheet = options.sheet || detectSheet(text);
  const code = extractCatalogCode(text);
  const tokens = norm.split(/\s+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !META_TOKENS.has(t));

  const colorFilters = matchPhrases(norm, COLOR_TERMS);
  const patternFilters = matchPhrases(norm, PATTERN_TERMS);
  const fabricFilters = matchPhrases(norm, FABRIC_TERMS);
  const categoryFilters = matchPhrases(norm, CATEGORY_TERMS);
  const seasonFilters = matchPhrases(norm, SEASON_TERMS);
  const phraseFilters = [...new Set([...colorFilters, ...patternFilters, ...fabricFilters, ...categoryFilters, ...seasonFilters])];
  const accessoryIntent = /\b(accessor(y|ies)|stole|khussa|royal embroidered|heritage zari)\b/.test(norm);

  let candidates = INDEX;
  if (requestedSheet && requestedSheet !== '__workbook__') {
    candidates = candidates.filter((rec) => rec.sheet === requestedSheet);
  } else if (accessoryIntent) {
    candidates = candidates.filter((rec) => rec.sheet === 'accessories');
  } else if (!requestedSheet) {
    // Pipeline and Sheet6 are only included when explicitly asked for.
    candidates = candidates.filter((rec) => rec.sheet !== 'Image generation pipeline' && rec.sheet !== 'Sheet6');
  }

  const scored = [];
  for (const rec of candidates) {
    let score = 0;
    if (code && String(rec.row.catalog_code) === code) score += 1000;
    if (tokens.length) {
      const matched = tokens.filter((t) => includesToken(rec.hay, t)).length;
      score += matched * 2;
      if (matched === tokens.length) score += 8;
      if (rec.row.name && tokens.includes(normalizeText(rec.row.name))) score += 20;
    }
    for (const phrase of phraseFilters) {
      if (includesPhrase(rec.hay, phrase)) score += 4;
    }
    if (score > 0) scored.push({ sheet: rec.sheet, row: rec.row, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.row.catalog_code || a.row.name || '').localeCompare(String(b.row.catalog_code || b.row.name || ''));
  });

  const seen = new Set();
  const rows = [];
  for (const rec of scored) {
    const key = rec.row.catalog_code
      ? String(rec.row.catalog_code)
      : `${rec.sheet}|${rec.row.name || ''}|${rec.row.color_name || rec.row.available_colors || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(rec);
    if (rows.length >= limit) break;
  }

  // If a sheet was explicitly named but nothing matched the words, show a sample.
  if (rows.length === 0 && requestedSheet && requestedSheet !== '__workbook__') {
    const sample = (sheets[requestedSheet] && sheets[requestedSheet].rows) || [];
    for (const row of sample.slice(0, limit)) {
      rows.push({ sheet: requestedSheet, row, score: 0 });
    }
  }

  const appliedFilters = [
    requestedSheet ? `sheet=${requestedSheet}` : null,
    code ? `catalog_code=${code}` : null,
    colorFilters.length ? `colors=${colorFilters.join(', ')}` : null,
    patternFilters.length ? `patterns=${patternFilters.join(', ')}` : null,
    fabricFilters.length ? `fabrics=${fabricFilters.join(', ')}` : null,
    categoryFilters.length ? `categories=${categoryFilters.join(', ')}` : null,
    seasonFilters.length ? `seasons=${seasonFilters.join(', ')}` : null,
    tokens.length ? `tokens=${tokens.join(', ')}` : null
  ].filter(Boolean);

  return {
    rows,
    totalMatches: scored.length,
    requestedSheet,
    code,
    appliedFilters: appliedFilters.join(' | '),
    tokens
  };
}

function buildContext({ text = '', chatHistory = [], hasMedia = false, mediaSummary = '' } = {}) {
  const relevance = assessRelevance(text, chatHistory);
  const historyText = (chatHistory || [])
    .slice(-8)
    .map((item) => (typeof item === 'string' ? item : item && item.text))
    .filter(Boolean)
    .join(' ');
  const countAnswer = getCountAnswer(text);
  const sheet = relevance.sheet || detectSheet(historyText);
  const queryText = countAnswer ? '' : `${text} ${historyText}`.slice(-900);
  const search = countAnswer
    ? { rows: [], totalMatches: 0, appliedFilters: '', requestedSheet: sheet, code: null, tokens: [] }
    : searchFabrics(queryText, { sheet, limit: 10 });

  const isFabricQuery = Boolean(countAnswer) || search.rows.length > 0;
  const lines = [];
  lines.push('=== TURABEES PROFILE ===');
  lines.push(isFabricQuery || !relevance.relevant ? COMPACT_PROFILE : profile.trim());
  lines.push('');
  if (relevance.relevant) {
    lines.push('=== DATASET STATS ===');
    lines.push(getCompactStatsSummary());
    lines.push('');
  }
  lines.push('=== RELEVANCE ASSESSMENT ===');
  lines.push(`Local check: ${relevance.relevant ? 'Turabees-related' : 'not clearly Turabees-related'} (${relevance.reason}).`);
  lines.push('You are John and you can chat normally, joke around and do light gossip. If the person asks something unrelated to Turabees, steer them back to Turabees/fabrics in a natural human way. Do not sound like a bot.');
  if (hasMedia) {
    lines.push(`Files/attachments are present (${mediaSummary || 'media'}). If the content is related to Turabees or its fabrics, analyze it and answer. If it is unrelated, do not analyze it — just send a short human line steering back to Turabees.`);
  }
  if (relevance.turabeesVariant) {
    lines.push(`The user spelled the brand as "${relevance.turabeesVariant}". The correct spelling is "Turabees". Correct it gently, then answer.`);
  }

  if (countAnswer) {
    lines.push('');
    lines.push('=== COUNT ANSWER (AUTHORITATIVE — use these exact numbers) ===');
    lines.push(countAnswer);
  }

  if (search.rows.length > 0) {
    lines.push('');
    lines.push(`=== MATCHED DATASET ROWS (top ${search.rows.length} by relevance; this is a retrieval sample, not an exact count) ===`);
    if (search.appliedFilters) lines.push(`Applied filters: ${search.appliedFilters}`);
    search.rows.forEach((rec, idx) => {
      lines.push(`${idx + 1}. ${formatRow(rec.sheet, rec.row)}`);
    });
  } else if (!countAnswer) {
    lines.push('');
    lines.push('=== MATCHED DATASET ROWS ===');
    lines.push('No specific rows matched. If the user is asking about Turabees/fabrics, answer from the stats and profile or ask a short clarifying question. If they are just chatting, reply naturally as John. Do not invent catalog rows or prices.');
  }

  return {
    relevance,
    countAnswer,
    search,
    context: lines.join('\n')
  };
}

module.exports = {
  dataset,
  profile,
  stats,
  sheets,
  FABRIC_SHEETS,
  assessRelevance,
  buildContext,
  getStatsSummary,
  getCountAnswer,
  searchFabrics,
  detectSheet,
  formatRow,
  hasTurabeesMention
};
