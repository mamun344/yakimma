(() => {
  // 🌐 Languages, for Yakimma (public/app.js) and Old Mode (public/old/app.js). The first time Yakimma opens, it asks
  // which language to use (each one written in its own language) and says Welcome! in it. From then on, everything
  // Yakimma says is in that language: the page translates itself as it's drawn, using public/i18n/<code>.json (made by
  // scripts/i18n.mjs from public/i18n/en.json). What people write themselves (posts, chats, names) is marked
  // translate="no" and stays as they wrote it. The choice is kept in this browser, and on your account so it follows you.
  const LANGUAGES = [
    { code: "en", name: "English", welcome: "Welcome!" },
    { code: "bn", name: "বাংলা", welcome: "স্বাগতম!" },
    { code: "hi", name: "हिन्दी", welcome: "स्वागत है!" },
    { code: "ur", name: "اردو", welcome: "خوش آمدید!", rtl: true },
    { code: "ar", name: "العربية", welcome: "أهلاً وسهلاً!", rtl: true },
    { code: "es", name: "Español", welcome: "¡Bienvenido!" },
    { code: "fr", name: "Français", welcome: "Bienvenue !" },
    { code: "pt", name: "Português", welcome: "Bem-vindo!" },
    { code: "de", name: "Deutsch", welcome: "Willkommen!" },
    { code: "ru", name: "Русский", welcome: "Добро пожаловать!" },
    { code: "tr", name: "Türkçe", welcome: "Hoş geldin!" },
    { code: "id", name: "Bahasa Indonesia", welcome: "Selamat datang!" },
    { code: "zh", name: "中文", welcome: "欢迎！" },
    { code: "ja", name: "日本語", welcome: "ようこそ！" },
    { code: "ko", name: "한국어", welcome: "환영합니다!" }
  ];
  const LANG_KEY = "yakimma.lang";
  // words: English → translated. patterns: English with {0}, {1}… for the parts that change (numbers, names, quotes).
  const i18n = { code: "en", words: new Map(), patterns: [], cache: new Map(), missed: null };
  const storedLang = () => { try { return localStorage.getItem(LANG_KEY); } catch { return null; } };
  const langOf = code => LANGUAGES.find(l => l.code === code);
  // For dates and times, in the chosen language.
  const locales = () => [i18n.code];
  // Emojis, symbols and spaces around words ("🏡 Feed", "Media ›") are kept as they are; the words are translated.
  const EDGE = /^([\s\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣✓✔✕✖×←→↩↪›‹·•…＋+−\-–—()\[\]|/*#·]*)([\s\S]*?)([\s\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣✓✔✕✖×←→↩↪›‹·•…＋+−\-–—()\[\]|/*#·]*)$/u;
  // Numbers and "quoted words" are the parts that change: they become {0}, {1}… so one translation fits them all.
  const VARIABLE = /“[^”]*”|"[^"]*"|\d+(?:[.,:/]\d+)*/g;
  const fill = (text, vals) => text.replace(/\{(\d+)\}/g, (m, i) => vals[i] ?? m);
  // The marks that end a sentence in each language, where they aren't . ? !
  const END_MARKS = { bn: { ".": "।" }, hi: { ".": "।" }, ur: { ".": "۔", "?": "؟" }, ar: { "?": "؟" }, zh: { ".": "。", "?": "？", "!": "！", ":": "：" }, ja: { ".": "。", "?": "？", "!": "！", ":": "：" } };
  // strict: only numbers and signs can go in a sentence's places, not words (for the whole text with its emojis, see tr).
  function lookup(core, strict = false) {
    if (!/\p{L}/u.test(core)) return null;
    let hit = i18n.words.get(core);
    if (hit !== undefined) return hit;
    const vals = [], key = core.replace(VARIABLE, m => `{${vals.push(m) - 1}}`);
    if (vals.length && (hit = i18n.words.get(key)) !== undefined) return fill(hit, vals);
    // Sentences with names in them ("Mia added Sam"), from the patterns. Words that go in them ("apples", "taka") are
    // translated too; names aren't words Yakimma knows, so they stay as they are.
    for (const p of i18n.patterns) {
      if (!core.includes(p.hint)) continue;
      const m = core.match(p.re);
      if (m && !(strict && m.slice(1).some(v => /\p{L}/u.test(v)))) return fill(p.text, m.slice(1).map(v => i18n.words.get(v) ?? v));
    }
    return null;
  }
  // The words of one sentence in the chosen language, or null. The exact words first, then without the full stop,
  // question or exclamation mark at the end (put back afterwards), so a word filled into a sentence ("Which number is
  // even?") doesn't take the mark with it.
  function sentence(core, strict = false) {
    let hit = i18n.words.get(core) ?? null, end = "";
    if (hit === null && /[.!?:,]$/.test(core) && (hit = lookup(core.slice(0, -1).trimEnd(), strict)) !== null) end = core.slice(-1);
    if (hit === null) hit = lookup(core, strict);
    return hit === null ? null : hit + (end && !/[.!?。！？:：।۔؟]$/.test(hit) ? END_MARKS[i18n.code]?.[end] ?? end : "");
  }
  // One piece of text in the chosen language, keeping the spaces, emojis and end punctuation around it.
  function tr(text) {
    if (i18n.code === "en" || !text) return text;
    if (i18n.cache.has(text)) return i18n.cache.get(text);
    let out = text;
    if (text.includes("\n")) out = text.split("\n").map(tr).join("\n");
    else {
      const [, before, core, after] = text.match(EDGE), whole = text.trim();
      // The whole text first, with the numbers and signs around the words ("60 MC · 💌 0 LC", "…your account number
      // is 12"), when a sentence has places for them. Otherwise just the words, keeping what's around them. The whole text
      // only fills numbers and signs into a sentence, so an emoji and words in front aren't taken for a name.
      const all = whole !== core && sentence(whole, true), hit = all ? null : sentence(core);
      if (all) out = text.match(/^\s*/)[0] + all + text.match(/\s*$/)[0];
      else if (hit !== null) out = before + hit + after;
      else if (i18n.missed && /\p{L}{2}/u.test(core)) { let n = 0; i18n.missed.add(core.replace(VARIABLE, () => `{${n++}}`).replace(/[.!?:,]$/, "")); }
    }
    if (i18n.cache.size > 20000) i18n.cache.clear();
    i18n.cache.set(text, out);
    return out;
  }
  const NO_TRANSLATE = "[translate='no'], script, style, textarea, code, svg";
  const TRANSLATED_ATTRS = ["placeholder", "title", "aria-label", "alt"];
  function translateAttrs(el) {
    for (const a of TRANSLATED_ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
    }
  }
  function translateTree(node) {
    if (i18n.code === "en") return;
    if (node.nodeType === 3) {
      if (node.parentElement && !node.parentElement.closest(NO_TRANSLATE)) { const t = tr(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t; }
      return;
    }
    if (node.nodeType !== 1 || node.closest(NO_TRANSLATE)) return;
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && n.matches(NO_TRANSLATE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let n = walk.currentNode; n; n = walk.nextNode()) {
      if (n.nodeType === 1) translateAttrs(n);
      else { const t = tr(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
    }
  }
  // Everything drawn from now on is translated before it shows.
  const translator = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === "childList") r.addedNodes.forEach(translateTree);
      else if (r.type === "characterData") translateTree(r.target);
      else if (!r.target.closest(NO_TRANSLATE)) translateAttrs(r.target);
    }
  });
  // Pop-up questions and messages from the browser too.
  for (const name of ["confirm", "alert", "prompt"]) { const native = window[name].bind(window); window[name] = (message, ...rest) => native(tr(String(message ?? "")), ...rest); }
  // Country names come from the browser, in the chosen language.
  function countriesIn(list) {
    if (i18n.code === "en" || !Intl.DisplayNames) return list;
    const names = new Intl.DisplayNames([i18n.code], { type: "region" });
    return list.map(c => { try { return { ...c, name: names.of(c.code) || c.name }; } catch { return c; } });
  }
  // Loads a language's words and starts translating. English needs nothing.
  async function useLanguage(code) {
    const lang = langOf(code) || LANGUAGES[0];
    i18n.code = lang.code; i18n.cache.clear();
    document.documentElement.lang = lang.code;
    // The page keeps the same layout in every language; only the words change. Arabic and Urdu still read right to left
    // inside each sentence, but nothing on the page swaps sides.
    document.documentElement.dir = "ltr";
    document.documentElement.classList.toggle("rtl-words", Boolean(lang.rtl));
    if (lang.code === "en") return;
    try {
      // A language without its file yet (or a file that can't be read) just has no words, so the page stays in English.
      const [en, words] = await Promise.all(["en", lang.code].map(c => fetch(`/i18n/${c}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))));
      i18n.words = new Map(); i18n.patterns = [];
      for (const [id, english] of Object.entries(en)) {
        const text = words[id];
        if (!text) continue;
        i18n.words.set(english, text);
        // Sentences with parts that change, written {0}, {1}…, also match any words in those places.
        if (/\{\d+\}/.test(english)) {
          const parts = english.split(/\{\d+\}/), hint = parts.reduce((a, b) => b.length > a.length ? b : a, "").trim();
          if (hint.length >= 4) i18n.patterns.push({ hint, text, re: new RegExp(`^${parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`, "u") });
        }
      }
      i18n.patterns.sort((a, b) => b.hint.length - a.hint.length);
    } catch { i18n.code = "en"; return; }
    // For scripts/i18n.mjs: with yakimma.i18nCollect set, words without a translation are kept in window.i18nMissed.
    try { if (localStorage.getItem("yakimma.i18nCollect")) window.i18nMissed = i18n.missed = new Set(); } catch {}
    document.title = tr(document.title);
    translateTree(document.body);
    translator.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRS });
  }
  window.yakimmaLanguages = { LANGUAGES, LANG_KEY, i18n, storedLang, langOf, locales, tr, countriesIn, useLanguage };
})();
