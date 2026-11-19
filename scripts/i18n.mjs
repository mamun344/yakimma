// Makes public/i18n/en.json: every piece of English Yakimma shows, each with a number. The other languages
// (public/i18n/<code>.json) give the same numbers in their language, and the page translates itself with them (see
// "Languages" in public/app.js). Run it after adding or changing words on the site:
//
//   node scripts/i18n.mjs              finds the words in public/app.js, server.js, public/index.html, Old Mode
//                                      (public/old) and the Learn! questions (public/learn-questions.json)
//   node scripts/i18n.mjs --add file   also adds the words in a file (one per line), like ones the page collected
//
// Words already in en.json keep their numbers, so the translations still fit. New ones get new numbers and show in
// English until they're translated. Parts that change (numbers, names, quotes) are written {0}, {1}… like the page does.
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "public", "i18n", "en.json");

// ---- Reading JavaScript: every string and template literal, with ${…} parts marked. ----
const MARK = "\u0000";
function literals(src) {
  const found = [];
  let i = 0, last = "";
  const regexCanStart = () => !last || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(return|typeof|case|in|of|void|delete|throw|new|else|do)$/.test(last);
  function skipString(q) { // i is just past the opening quote
    let value = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") { value += unescape(src[i + 1], () => src.slice(i + 2, i + 6)); i += src[i + 1] === "u" ? 6 : 2; }
      else value += src[i++];
    }
    i++;
    return value;
  }
  function unescape(c, hex) { return c === "n" ? "\n" : c === "t" ? "\t" : c === "u" ? String.fromCharCode(parseInt(hex(), 16)) : c; }
  function template(start) { // i is just past the backtick
    let text = "";
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") { text += unescape(src[i + 1], () => src.slice(i + 2, i + 6)); i += src[i + 1] === "u" ? 6 : 2; }
      else if (src[i] === "$" && src[i + 1] === "{") { i += 2; expression(); text += MARK; }
      else text += src[i++];
    }
    i++;
    found.push({ text, start, template: true });
  }
  function expression() { // until the matching }
    let depth = 0;
    last = "{";
    while (i < src.length) {
      const c = src[i];
      if (c === "}" && depth === 0) { i++; return; }
      if (!step()) { if (c === "{") depth++; else if (c === "}") depth--; i++; if (!/\s/.test(c)) last = c; }
    }
  }
  // Reads one string, template, comment or regex at i, if there is one there.
  function step() {
    const c = src[i], start = i;
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; return true; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 2; return true; }
    if (c === "'" || c === '"') { i++; found.push({ text: skipString(c), start }); last = "x"; return true; }
    if (c === "`") { i++; template(start); last = "x"; return true; }
    if (c === "/" && regexCanStart()) {
      i++;
      let inClass = false;
      while (i < src.length && (src[i] !== "/" || inClass)) { if (src[i] === "\\") i++; else if (src[i] === "[") inClass = true; else if (src[i] === "]") inClass = false; i++; }
      i++;
      while (/[a-z]/.test(src[i])) i++;
      last = "x";
      return true;
    }
    return false;
  }
  while (i < src.length) {
    if (step()) continue;
    const c = src[i];
    if (/[A-Za-z_$]/.test(c)) { let w = ""; while (/[\w$]/.test(src[i])) w += src[i++]; last = w; continue; }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return found;
}

// ---- Turning a literal into the pieces of text a person sees. ----
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const EDGE = /^([\s\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣✓✔✕✖×←→↩↪›‹·•…＋+−\-–—()\[\]|/*#·]*)([\s\S]*?)([\s\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣✓✔✕✖×←→↩↪›‹·•…＋+−\-–—()\[\]|/*#·]*)$/u;
const ATTRS = /\b(?:placeholder|title|aria-label|alt)="([^"]*)"/g;
function pieces(text) {
  const found = [];
  for (const m of text.matchAll(ATTRS)) found.push(m[1]);
  for (const part of text.replace(/<[^>]*>/g, "\u0001").split("\u0001")) found.push(part);
  return found.map(p => p.replace(/&[a-z#0-9]+;/g, e => ENTITIES[e] ?? e)).flatMap(p => p.split("\n"));
}
// The words in a piece: no spaces or emojis around it, and {0}, {1}… for the parts that change.
function clean(piece) {
  let core = piece.match(EDGE)[2].trim();
  let n = 0;
  core = core.replace(new RegExp(`${MARK}+`, "g"), () => `{${n++}}`);
  core = core.replace(/[.!?:,]$/, m => (core.length > 1 ? "" : m));
  return core.trim();
}
// What counts as words a person reads (not code, CSS, links or SQL).
function isWords(s, fromServer) {
  if (!/\p{L}{2}/u.test(s.replace(/\{\d+\}/g, ""))) return false;
  if (/^\{\d+\}$/.test(s) || s.length > 900) return false;
  if (/^[a-z0-9_.:\-\/#?&=+]+$/.test(s)) return false;                   // ids, classes, paths, keys
  if (/[;{}]\s*[a-z-]+\s*:|https?:\/\/|\/api\/|^\.|=>|\bvar\(--/.test(s)) return false; // CSS, links, code
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA|WITH)\b/i.test(s) || /\b(FROM|WHERE|JOIN)\b [a-z_]/.test(s)) return false;
  if (/^[\w-]+(\s[\w-]+)*$/.test(s) && /^[a-z]/.test(s) && !/\s/.test(s)) return false;
  if (fromServer && !/[A-Z]/.test(s[0] ?? "") && !/^\{\d+\}/.test(s)) return false;
  return true;
}

// Things the reader above picks up that aren't words to translate: addresses on the site, bits of code and settings,
// names, and words that are already in another language.
const NOT_WORDS = [
  /^saturate\(|^ABCDEFGH|^(AND|OR) [a-z_.]+ |^[A-Z]{2}$|^api\/|\/:messageId|^\{0\}[/?]|^[&?]|[/]\{\d\}|^post\/|^songs\/|^i18n\//, /="|\bdata-[a-z]|^(translate|translateY|url|rotate)\(|^[#.]?[a-zA-Z]+ [#.][a-z-]|\.[a-z-]+$|^[a-z]+[A-Z][a-zA-Z]*(\{\d\})?$/,
  /\b(AND|LIKE|ESCAPE|IS NULL)\b.*(\?|=)/, /^[A-Z_]+_(PASSWORD|SIZE|UNIQUE)$|^(ASC|DESC|TEXT|PATCH|PUT|WEBP|GIF|RIFF)$/, /^(Cache-Control|Content-Type|X-Accel-Buffering|Escape|Enter)$/,
  /^(hover: hover|input,textarea|modalroot input|notice error|closeup svg|thumb|media|tick five|\{name\}|yakimma\.sid|group=\{0\}|hachi \{0\}|photo\{0\}|video\{0\}|tagged\{0\})$/,
  /^(Arif|Ayesha|Emma|Fatima|Jack|Karim|Leo|Mia|Nadia|Olivia|Rahim|bleh|MahfujzKaka|Manhatukfayay|Mahdiya Faiza Manha|Biponi Labs|Sekai|Cuties|Fax Hero: Send Fax from iPhone)$/,
  /[\w.-]+@[\w-]+\.\w|^@[\w-]+$|^ABCDEFGHIJ|SESSION_SECRET|, #[a-z]|^[a-z]+[A-Z]\w* [a-z]+$|fx-\{/, /^(Español|Français|Português|Deutsch|Türkçe|Bahasa Indonesia|Bem-vindo|Bienvenue|Willkommen|Hoş geldin|Selamat datang|Language · .*)$/,
  /[\u0400-\u04FF\u0590-\u06FF\u0900-\u09FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]|^¡Bienvenido$/,
  // Browser error names and the call screen's class names.
  /^[A-Z][a-z]+[A-Z][a-zA-Z]*Error$|^button, video$|^call-screen |^red end$|^call-float |^\{0\}px \{1\}px$/
];
const isJunk = w => NOT_WORDS.some(r => r.test(w));

// ---- Where the words are ----
const words = new Set();
function fromFile(file, { server = false, skip = [] } = {}) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const skipped = skip.map(([from, to]) => { const a = src.indexOf(from); return [a, a < 0 ? -1 : src.indexOf(to, a)]; });
  for (const lit of literals(src)) {
    if (skipped.some(([a, b]) => a >= 0 && lit.start > a && lit.start < b)) continue;
    // Database commands, and CSS selectors for finding things on the page.
    if (/\b(SELECT|INSERT INTO|INSERT OR|UPDATE \w+ SET|CREATE (TABLE|INDEX|UNIQUE)|ALTER TABLE|DELETE FROM|PRAGMA|INTEGER|NOT NULL)\b/.test(lit.text)) continue;
    if (/^[#.\[]?[a-zA-Z-]+[#.\[]|\[[a-z-]+(=|\])|:not\(|^\[/.test(lit.text) && !/\s\p{L}+\s\p{L}+/u.test(lit.text.replace(/\[[^\]]*\]/g, ""))) continue;
    // Server: only what people see, not the server's own log lines.
    if (server && /console\.(log|error|warn)\([^()]*$/.test(src.slice(Math.max(0, lit.start - 60), lit.start))) continue;
    for (const p of pieces(lit.text)) { const w = clean(p); if (isWords(w, server)) words.add(w); }
  }
}
fromFile("public/app.js", { skip: [["const BLURRED", "];"]] });
// Countries come from the browser in every language, and songs keep their names.
fromFile("server.js", { server: true, skip: [["const COUNTRIES", "localeCompare(b.name));"], ["const SONGS", "].sort("], ["const nailOptions", "\n};"]] });
for (const p of pieces(fs.readFileSync(path.join(root, "public/index.html"), "utf8").replace(/<(script|style)[\s\S]*?<\/\1>/g, ""))) { const w = clean(p); if (isWords(w)) words.add(w); }
// The nail salon's names (shapes, polishes, art…) are words people see too.
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8"), songsAt = serverSrc.indexOf("const SONGS");
for (const m of (serverSrc.slice(0, songsAt) + serverSrc.slice(serverSrc.indexOf("];", songsAt))).matchAll(/name: "([^"]+)"/g)) words.add(m[1]);
// Old Mode is the first Yakimma, with its own page.
fromFile("public/old/app.js");
for (const p of pieces(fs.readFileSync(path.join(root, "public/old/index.html"), "utf8").replace(/<(script|style)[\s\S]*?<\/\1>/g, ""))) { const w = clean(p); if (isWords(w)) words.add(w); }
// Learn! questions, and their answers. English answers stay as they are: they're the English being learned.
const bank = JSON.parse(fs.readFileSync(path.join(root, "public/learn-questions.json"), "utf8"));
for (const [subject, levels] of Object.entries(bank)) {
  if (subject.startsWith("_")) continue;
  for (const questions of Object.values(levels)) for (const [question, ...answers] of questions) {
    words.add(clean(question.replaceAll("{name}", MARK)));
    // Chemical symbols and formulas (Au, H₂O, NaCl) are the same in every language.
    if (subject !== "english") for (const a of answers.slice(0, 4)) if (/\p{L}{2}/u.test(a) && !/^[A-Z][a-z]?$|₂|^NaCl$/.test(a)) words.add(clean(a));
  }
}
// The words put into Math questions (fruit, money, "hundreds"…) are single words, so the reader above skips them.
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
for (const name of ["LEARN_THINGS", "LEARN_MONEY"]) { const at = appSrc.indexOf(`const ${name}`); for (const m of appSrc.slice(at, appSrc.indexOf("\n", at)).matchAll(/"([a-z]+)"/g)) words.add(m[1]); }
for (const w of ["hundreds", "tens", "ones", "even", "odd"]) words.add(w);
const addAt = process.argv.indexOf("--add");
if (addAt > 0) for (const line of fs.readFileSync(process.argv[addAt + 1], "utf8").split("\n")) { const w = line.trim(); if (w) words.add(w); }

// ---- Keeping the numbers the same ----
const old = Object.fromEntries(Object.entries(fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {}).filter(([, w]) => !isJunk(w)));
const ids = new Map(Object.entries(old).map(([id, w]) => [w, id]));
let next = Math.max(0, ...Object.keys(old).map(Number)) + 1;
const result = { ...old };
let added = 0;
for (const w of [...words].sort()) if (!ids.has(w) && !isJunk(w)) { result[next++] = w; added++; }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 0).replace(/,"(\d+)":/g, ',\n"$1":').replace(/^\{/, "{\n").replace(/\}$/, "\n}") + "\n");
console.log(`${Object.keys(result).length} pieces of English in public/i18n/en.json (${added} new).`);
