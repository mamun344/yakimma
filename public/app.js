(() => {
  const $ = s => document.querySelector(s);
  const state = {
    user: null, products: [], inventory: [], posts: [], page: "feed", notice: "",
    nailOptions: { skinTones: [], shapes: [], lengths: [], finishes: [], arts: [], polishes: [] },
    avatarOptions: { emojis: [], backgrounds: [] },
    social: { friends: [], incoming: [], outgoing: [] }, received: [], salon: null,
    themes: [], guestTheme: null, groups: null, groupIcons: [], groupDraft: null,
    codes: { redeemed: [], total: 0 }, codeWin: null,
    // groupView: the group page that's open. chat: the open group or friend chat ({ url, messages, draft, names, friendId? }).
    groupView: null, chat: null
  };
  const safe = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function api(url, options = {}) {
    const res = await fetch(url, { credentials:"same-origin", ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  const send = (method, body) => ({ method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  function toast(message, error = false) { state.notice = message; state.noticeError = error; render(); }
  function notice() { return state.notice ? `<div class="notice ${state.noticeError?"error":""}" role="status">${safe(state.notice)}</div>` : ""; }
  // ---- Themes: saved to your account when signed in, or to this browser for guests (free themes only). ----
  const THEME_KEY = "yakimma.theme";
  const themeById = id => state.themes.find(t => t.id === id);
  try { state.guestTheme = localStorage.getItem(THEME_KEY); } catch {}
  function activeTheme() {
    if (state.user) return themeById(state.user.theme) ? state.user.theme : "pink";
    const t = themeById(state.guestTheme);
    return t && !t.item ? t.id : "pink";
  }
  function applyTheme() {
    const id = activeTheme(), root = document.documentElement;
    if (root.dataset.theme !== id) root.dataset.theme = id;
    try { localStorage.setItem(THEME_KEY, id); } catch {}
    $('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue("--surface").trim() || "#ffe0ef";
  }
  async function useTheme(id) {
    const t = themeById(id);
    if (state.user) state.user = (await api("/api/me/theme", send("PUT", { theme: id }))).user;
    else state.guestTheme = id;
    toast(`${t.name} theme is on! ${t.icon}`);
  }
  const priceLabel = p => p.currency === "LC" ? `💌 ${p.price} LC` : `🐱 ${p.price} MC`;
  function hero(title, desc, tag = "YOUR LITTLE CORNER OF THE INTERNET") {
    return `<section class="hero"><div><span class="pill">${tag}</span><h1>${title}</h1><p>${desc}</p></div><div style="font-size:3.2rem" aria-hidden="true">${themeById(activeTheme())?.art || "🌸🩵"}</div></section>`;
  }
  const bgCss = id => (state.avatarOptions.backgrounds.find(b => b.id === id) || state.avatarOptions.backgrounds[0])?.css || "linear-gradient(135deg,var(--pink2),var(--teal2))";
  function avatarHTML(a, size = "") {
    if (a?.photoUrl) return `<span class="avatar photo ${size}"><img src="${safe(a.photoUrl)}" alt=""></span>`;
    return `<span class="avatar ${size}" style="background:${bgCss(a?.bg)}" aria-hidden="true">${safe(a?.emoji || "🌷")}</span>`;
  }
  const signInPanel = message => `<section class="panel"><p>${message}</p><button class="primary" id="openAuth">Sign in / Create account</button></section>`;
  function wallet() {
    $("#wallet").textContent = state.user ? `🐱 ${state.user.mc} MC · 💌 ${state.user.lc} LC` : "🐱 Sign in to save MC";
    $("#accountBtn").innerHTML = state.user ? `${avatarHTML(state.user.avatar, "tiny")}<span class="acct-name">${safe(state.user.username)}</span> ▾` : "Sign in";
    $("#accountBtn").setAttribute("aria-label", state.user ? `Account menu for ${state.user.username}` : "Sign in");
    $("#accountBtn").setAttribute("aria-haspopup", state.user ? "menu" : "dialog");
  }
  function friendsBadge() {
    const requests = state.social.incoming.length, unread = state.social.friends.reduce((n, f) => n + (f.unread || 0), 0);
    const label = [requests ? `${requests} friend request${requests === 1 ? "" : "s"}` : "", unread ? `${unread} unread message${unread === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
    $('.nav[data-page="friends"]').innerHTML = `👯 Friends${label ? ` <span class="badge" aria-label="${label}">${requests + unread}</span>` : ""}`;
  }
  async function loadSocial() {
    if (!state.user) { state.social = { friends: [], incoming: [], outgoing: [] }; state.received = []; state.salon = null; return; }
    const [social, nails] = await Promise.all([api("/api/friends"), api("/api/nails")]);
    state.social = social; state.received = nails.received || [];
  }
  async function refresh() {
    const [me, feed] = await Promise.all([api("/api/me"), api("/api/posts")]);
    state.user = me.user; state.products = me.products || []; state.inventory = me.inventory || []; state.posts = feed.posts || [];
    if (me.themes) state.themes = me.themes;
    if (me.nailOptions) state.nailOptions = me.nailOptions;
    if (me.avatarOptions) state.avatarOptions = me.avatarOptions;
    await loadSocial();
    wallet();
  }
  const setGroups = d => { state.groups = d.groups; state.groupIcons = d.icons; };
  async function loadGroups() { setGroups(await api("/api/groups")); }
  async function loadCodes() { state.codes = state.user ? await api("/api/codes") : { redeemed: [], total: 0 }; }
  async function loadPageData() {
    if (state.user && ["friends", "nails", "profile"].includes(state.page)) await loadSocial();
    if (state.page === "groups") await loadGroups();
    if (state.page === "codes") await loadCodes();
  }

  // ---- Hand + nail drawing (SVG). Fingers are drawn pointing up; each nail is built in its finger's own coordinates. ----
  const FINGERS = [
    { name:"Thumb", x:112, y:338, len:108, w:50, a:-50 },
    { name:"Index", x:130, y:262, len:150, w:44, a:-8 },
    { name:"Middle", x:178, y:252, len:170, w:46, a:-1 },
    { name:"Ring", x:226, y:258, len:156, w:44, a:6 },
    { name:"Pinky", x:268, y:276, len:118, w:38, a:15 }
  ];
  const LENGTH_EXT = { short:6, medium:20, long:36 };
  const PALM = "M94 290C92 252 112 238 146 236L252 238C282 242 294 262 290 300L282 382C278 410 256 424 232 426L146 426C120 424 102 410 98 384Z";
  const SPARKLES = [[-.5,.2,1.3],[.3,.12,1],[.6,.35,1.4],[-.2,.42,1],[.1,.6,1.5],[-.55,.66,1.1],[.5,.72,1],[-.1,.85,1.2],[.35,.9,.9],[-.4,.05,.9]];
  const ACCENTS = ["#ffffff","#1e1b22","#d9b45a","#c9cdd3","#ff4fa0","#2ec4b6","#c9b3ff","#d7263d"];
  let svgSeq = 0;
  const hexOr = (c, fallback) => /^#[0-9a-f]{6}$/i.test(c || "") ? c : fallback;
  function mix(hex, target, amt) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(target.slice(1), 16);
    const ch = s => Math.round(((a >> s) & 255) * (1 - amt) + ((b >> s) & 255) * amt);
    return "#" + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, "0")).join("");
  }
  const findTone = id => state.nailOptions.skinTones.find(t => t.id === id);
  const toneHex = id => findTone(id)?.hex || "#e7b98f";
  const toneName = id => findTone(id)?.name || "Sand";
  const newDesign = () => ({ shape:"round", length:"medium", nails: FINGERS.map(() => ({ color:"#ff8fc0", finish:"glossy", art:"none", accent:"#ffffff" })) });

  function nailGeom(f, length) {
    const hw = f.w * 0.35, y0 = -f.len + 7, c = y0 + f.w * 0.95;
    return { hw, y0, c, t: y0 - (LENGTH_EXT[length] ?? 20) };
  }
  // Outline of one nail: rounded cuticle at the bottom (y=c), free edge on top (y=t) in the chosen shape.
  function nailPath(shape, hw, t, c) {
    const sb = c - hw * 0.55, top = k => t + Math.min(sb - t - 4, hw * k);
    let tip;
    if (shape === "square") tip = `L${-hw} ${t+3}Q${-hw} ${t} ${-hw+3} ${t}L${hw-3} ${t}Q${hw} ${t} ${hw} ${t+3}`;
    else if (shape === "almond") { const y = top(1.7), k = t + (y - t) * 0.35; tip = `L${-hw} ${y}C${-hw} ${k} ${-hw*0.3} ${t} 0 ${t}C${hw*0.3} ${t} ${hw} ${k} ${hw} ${y}`; }
    else if (shape === "stiletto") { const y = top(2.2), k = t + (y - t) * 0.3; tip = `L${-hw} ${y}Q${-hw*0.75} ${k} 0 ${t}Q${hw*0.75} ${k} ${hw} ${y}`; }
    else if (shape === "coffin") { const y = top(1.4); tip = `L${-hw} ${y}L${-hw*0.5} ${t+1.5}Q${-hw*0.5} ${t} ${-hw*0.4} ${t}L${hw*0.4} ${t}Q${hw*0.5} ${t} ${hw*0.5} ${t+1.5}L${hw} ${y}`; }
    else { const y = top(shape === "oval" ? 1.5 : 1); tip = `L${-hw} ${y}A${hw} ${y-t} 0 0 1 ${hw} ${y}`; }
    return `M${hw} ${sb}Q${hw} ${c} 0 ${c}Q${-hw} ${c} ${-hw} ${sb}${tip}Z`;
  }
  function nailArt(n, g, gid) {
    const { hw, y0, c, t } = g, a = hexOr(n.accent, "#ffffff"), m = (t + c) / 2;
    if (n.art === "french") { const b = t + Math.max(8, y0 - t + 5); return `<path d="M${-hw-2} ${t-2}H${hw+2}V${b+5}Q0 ${b-7} ${-hw-2} ${b+5}Z" fill="${a}"/>`; }
    if (n.art === "ombre") return `<rect x="${-hw-2}" y="${t-2}" width="${2*hw+4}" height="${c-t+4}" fill="url(#${gid}o)"/>`;
    if (n.art === "dots") return [[-.4,-.35],[.38,-.05],[-.15,.32]].map(([dx, dy]) => `<circle cx="${dx*hw}" cy="${m+dy*(c-t)*0.6}" r="${hw*0.17}" fill="${a}"/>`).join("");
    if (n.art === "heart") { const k = hw * 0.5; return `<path d="M0 ${m+k*0.9}C${-k*1.6} ${m-k*0.2} ${-k*0.6} ${m-k*1.3} 0 ${m-k*0.45}C${k*0.6} ${m-k*1.3} ${k*1.6} ${m-k*0.2} 0 ${m+k*0.9}Z" fill="${a}"/>`; }
    if (n.art === "star") {
      const R = hw * 0.62, r = R * 0.45;
      const pts = Array.from({ length:10 }, (_, i) => { const ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R; return `${Math.cos(ang)*rad},${m+Math.sin(ang)*rad}`; });
      return `<polygon points="${pts.join(" ")}" fill="${a}"/>`;
    }
    if (n.art === "flower") {
      const d = hw * 0.32, pr = hw * 0.24;
      return Array.from({ length:5 }, (_, i) => { const ang = -Math.PI / 2 + i * 2 * Math.PI / 5; return `<circle cx="${Math.cos(ang)*d}" cy="${m+Math.sin(ang)*d}" r="${pr}" fill="${a}"/>`; }).join("") + `<circle cx="0" cy="${m}" r="${pr*0.8}" fill="#ffe27a"/>`;
    }
    if (n.art === "gingercat") {
      const r = hw * 0.68, y = m + r * 0.25, fur = "#f28c28", line = "#8a4a14";
      const ear = k => `<path d="M${k*r*0.95} ${y-r*0.2}L${k*r*0.78} ${y-r*1.25}L${k*r*0.12} ${y-r*0.78}Z" fill="${fur}" stroke="${line}" stroke-width=".8" stroke-linejoin="round"/><path d="M${k*r*0.74} ${y-r*0.45}L${k*r*0.7} ${y-r*0.98}L${k*r*0.36} ${y-r*0.72}Z" fill="#ffb3c7"/>`;
      const eye = k => `<circle cx="${k*r*0.38}" cy="${y-r*0.05}" r="${r*0.14}" fill="#2b1a10"/><circle cx="${k*r*0.38+r*0.05}" cy="${y-r*0.1}" r="${r*0.05}" fill="#fff"/>`;
      return ear(-1) + ear(1) + `<ellipse cx="0" cy="${y}" rx="${r}" ry="${r*0.88}" fill="${fur}" stroke="${line}" stroke-width=".8"/>` +
        `<path d="M0 ${y-r*0.84}V${y-r*0.5}M${-r*0.3} ${y-r*0.78}L${-r*0.22} ${y-r*0.5}M${r*0.3} ${y-r*0.78}L${r*0.22} ${y-r*0.5}" stroke="#b5561a" stroke-width="${r*0.12}" stroke-linecap="round"/>` +
        `<ellipse cx="0" cy="${y+r*0.38}" rx="${r*0.5}" ry="${r*0.34}" fill="#fff4e6"/>${eye(-1)}${eye(1)}` +
        `<path d="M${-r*0.13} ${y+r*0.18}H${r*0.13}L0 ${y+r*0.33}Z" fill="#ff7f9e"/>` +
        `<path d="M${-r*0.35} ${y+r*0.35}H${-r*1.05}M${-r*0.35} ${y+r*0.48}L${-r*1}  ${y+r*0.62}M${r*0.35} ${y+r*0.35}H${r*1.05}M${r*0.35} ${y+r*0.48}L${r} ${y+r*0.62}" stroke="${line}" stroke-width=".6" stroke-linecap="round"/>`;
    }
    if (n.art === "gem") { const s = hw * 0.42, gy = c - hw * 0.95; return `<path d="M0 ${gy-s}L${s*0.8} ${gy}L0 ${gy+s}L${-s*0.8} ${gy}Z" fill="${a}" stroke="#fff" stroke-width="1.2"/><path d="M0 ${gy-s}L${s*0.8} ${gy}L0 ${gy}Z" fill="#fff" opacity=".55"/>`; }
    return "";
  }
  function nailFinish(n, g) {
    const { hw, c, t } = g, h = c - t;
    const streak = op => `<rect x="${-hw*0.6}" y="${t+h*0.16}" width="${hw*0.3}" height="${h*0.5}" rx="${hw*0.15}" fill="#fff" opacity="${op}"/>`;
    if (n.finish === "glossy") return streak(0.45);
    if (n.finish === "chrome") return streak(0.7);
    if (n.finish === "shimmer") return SPARKLES.map(([x, y, r], i) => `<circle cx="${x*hw}" cy="${t+y*h}" r="${r}" fill="${i%3?"#fff":"#ffe9a8"}" opacity=".85"/>`).join("") + streak(0.25);
    return `<rect x="${-hw-2}" y="${t-2}" width="${2*hw+4}" height="${h+4}" fill="#fff" opacity=".1"/>`;
  }
  function nailSVG(f, n, design, gid, selected, fold) {
    const g = nailGeom(f, design.length), d = nailPath(design.shape, g.hw, g.t, g.c);
    const col = hexOr(n.color, "#ff8fc0"), accent = hexOr(n.accent, "#ffffff");
    const chrome = n.finish === "chrome" ? `<linearGradient id="${gid}c" x1="0" x2="1"><stop offset="0" stop-color="${mix(col,"#ffffff",.55)}"/><stop offset=".4" stop-color="${col}"/><stop offset=".7" stop-color="${mix(col,"#000000",.3)}"/><stop offset="1" stop-color="${mix(col,"#ffffff",.35)}"/></linearGradient>` : "";
    const ombre = n.art === "ombre" ? `<linearGradient id="${gid}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset=".85" stop-color="${accent}" stop-opacity="0"/></linearGradient>` : "";
    return `<defs><clipPath id="${gid}k"><path d="${d}"/></clipPath>${chrome}${ombre}</defs>` +
      `<path d="${d}" fill="none" stroke="${fold}" stroke-width="3.5" opacity=".35"/>` +
      `<path d="${d}" fill="${chrome ? `url(#${gid}c)` : col}"/><g clip-path="url(#${gid}k)">${nailArt(n, g, gid)}${nailFinish(n, g)}</g>` +
      `<path d="${d}" fill="none" stroke="${mix(col,"#000000",.25)}" stroke-width="1"/>` +
      (selected ? `<path d="${d}" fill="none" stroke="#16847b" stroke-width="3" stroke-dasharray="5 3"/>` : "");
  }
  function bareNail(f, skin, fold) {
    const g = nailGeom(f, "short");
    return `<path d="${nailPath("round", g.hw, g.y0 - 3, g.c)}" fill="${mix(skin,"#ffe4e8",.45)}" stroke="${fold}" stroke-width="1"/>`;
  }
  function handSVG(toneHexValue, design, { selected = -1, interactive = false, label = "Hand" } = {}) {
    const skin = hexOr(toneHexValue, "#e7b98f"), line = mix(skin, "#3b1d12", 0.35), crease = mix(skin, "#3b1d12", 0.22);
    const p = `h${++svgSeq}`, place = f => `translate(${f.x} ${f.y}) rotate(${f.a})`;
    const finger = (f, fill = "") => `<rect x="${-f.w/2}" y="${-f.len}" width="${f.w}" height="${f.len+40}" rx="${f.w/2}"${fill}/>`;
    const silhouette = `<path d="${PALM}"/><rect x="132" y="396" width="116" height="80" rx="18"/>${FINGERS.map(f => `<g transform="${place(f)}">${finger(f)}</g>`).join("")}`;
    const fingers = FINGERS.map((f, i) => {
      const creases = [0.36, 0.64].map(k => `<path d="M${-f.w*0.22} ${-f.len*k}q${f.w*0.22} 4 ${f.w*0.44} 0" stroke="${crease}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`).join("");
      const nail = design ? nailSVG(f, design.nails?.[i] || {}, design, `${p}n${i}`, i === selected, line) : bareNail(f, skin, line);
      return `<g transform="${place(f)}"${interactive ? ` class="nail-hit" data-nail-i="${i}"` : ""}>${interactive ? finger(f, ` fill="transparent"`) : ""}${creases}${nail}</g>`;
    }).join("");
    const svg = `<svg class="hand" viewBox="-25 30 410 440" role="img" aria-label="${safe(label)}">` +
      `<g fill="${line}" stroke="${line}" stroke-width="6" stroke-linejoin="round">${silhouette}</g><g fill="${skin}">${silhouette}</g>${fingers}` +
      `<rect x="118" y="440" width="144" height="40" rx="14" fill="var(--pink)"/><path d="M118 452H262" stroke="#fff" stroke-width="3" opacity=".6"/></svg>`;
    return svg.replace(/\d+\.\d{2,}/g, n => (+n).toFixed(1));
  }

  // ---- Chat (used by group chats and friend chats). Updates redraw only the message log, so typing is never interrupted. ----
  const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🙏"];
  function timeLabel(s) {
    const d = new Date(String(s).replace(" ", "T") + "Z");
    if (isNaN(d)) return "";
    const today = d.toDateString() === new Date().toDateString();
    return d.toLocaleString([], today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  // Tapping a message selects it and shows its actions underneath.
  function messageHTML(m) {
    const c = state.chat, mine = m.userId === state.user?.id, picked = c.selected === m.id, face = mine ? "" : avatarHTML(m.avatar, "tiny");
    if (m.deleted) return `<div class="msg ${mine ? "mine" : ""}">${face}<div class="msg-body"><div class="bubble deleted"><span class="b-text">🚫 This message was deleted</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    const name = c.names && !mine ? `<strong>${safe(m.username)}</strong>` : "";
    const reactions = m.reactions.length ? `<div class="reactions">${m.reactions.map(r => `<button class="reaction ${r.mine ? "on" : ""}" data-react="${safe(r.emoji)}" data-msg="${m.id}" title="${safe(r.users.join(", "))}" aria-pressed="${r.mine}"><span class="emoji">${safe(r.emoji)}</span>${r.count}</button>`).join("")}</div>` : "";
    return `<div class="msg ${mine ? "mine" : ""} ${picked ? "picked" : ""}">${face}<div class="msg-body">` +
      `<button class="bubble" data-pick-msg="${m.id}" aria-expanded="${picked}">${name}${m.forwarded ? `<span class="fwd">↪️ Forwarded</span>` : ""}<span class="b-text">${safe(m.body)}</span><small>${timeLabel(m.createdAt)}${m.editedAt ? " · edited" : ""}</small></button>` +
      reactions + (picked ? messageTools(m, mine) : "") + `</div></div>`;
  }
  function messageTools(m, mine) {
    const canDelete = mine || state.chat.moderator;
    return `<div class="msg-tools" role="toolbar" aria-label="Message actions"><div class="quick">${QUICK_REACTIONS.map(e => `<button class="emoji-btn" data-react="${e}" data-msg="${m.id}" aria-label="React with ${e}">${e}</button>`).join("")}<button class="emoji-btn more" data-react-more="${m.id}" aria-label="All emojis" title="All emojis">＋</button></div>` +
      `<div class="tool-row"><button class="soft" data-forward-msg="${m.id}">↪️ Forward</button>${mine && !m.forwarded ? `<button class="soft" data-edit-msg="${m.id}">✏️ Edit</button>` : ""}${canDelete ? `<button class="soft" data-delete-msg="${m.id}">🗑️ Delete</button>` : ""}${mine ? "" : `<button class="soft" data-block="${m.userId}" data-name="${safe(m.username)}">🚫 Block</button>`}</div></div>`;
  }
  const emptyChat = `<p class="muted chat-empty">No messages yet. Say hi! 👋</p>`;
  const logHTML = () => state.chat.messages.length ? state.chat.messages.map(messageHTML).join("") : emptyChat;
  function chatBox(placeholder) {
    const c = state.chat, editing = c.editing && c.messages.some(m => m.id === c.editing && !m.deleted);
    return `<div class="chat-log" id="chatLog">${logHTML()}</div>` +
      (editing ? `<div class="editing-bar"><span>✏️ Editing your message</span><button type="button" class="soft" id="cancelEdit">Cancel</button></div>` : "") +
      `<form id="chatForm" class="row nowrap chat-form"><button type="button" class="soft emoji-open" id="emojiInsert" aria-label="Add an emoji" title="Add an emoji">😊</button><label class="sr-only" for="chatInput">Message</label><input id="chatInput" maxlength="500" autocomplete="off" placeholder="${safe(placeholder)}" value="${safe(c.draft)}"><button class="primary" type="submit">${editing ? "Save" : "Send"}</button></form>` +
      `<p class="muted-note">Tap a message to react, forward, edit or delete it. Be kind 💗 Never share your password, address, phone number, or school.</p>`;
  }
  // Redraw just the message log, keeping your place unless you were already at the bottom.
  function drawLog(toBottom = false) {
    const log = $("#chatLog");
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80, top = log.scrollTop;
    log.innerHTML = logHTML();
    log.scrollTop = toBottom || nearBottom ? log.scrollHeight : top;
  }
  // Merge new and changed messages from the server into the open chat.
  function mergeChat(d) {
    const c = state.chat;
    c.rev = Math.max(c.rev, d.rev);
    let changed = false, sentByMe = false;
    for (const m of d.messages) {
      const i = c.messages.findIndex(x => x.id === m.id);
      if (i >= 0) { if (m.rev > c.messages[i].rev) { c.messages[i] = m; changed = true; } }
      // Only the newest 100 messages are loaded, so changes to older ones are skipped.
      else if (!c.messages.length || m.id > c.messages[0].id) { c.messages.push(m); changed = true; sentByMe ||= m.userId === state.user.id; }
    }
    if (!changed) return;
    c.messages.sort((a, b) => a.id - b.id);
    // If the message you're editing was deleted (for example by the group's owner), stop editing it.
    if (c.editing && !c.messages.some(m => m.id === c.editing && !m.deleted)) { c.editing = null; c.draft = ""; render(); return; }
    drawLog(sentByMe);
  }
  async function pollChat() {
    const c = state.chat;
    if (!c || c.polling || !$("#chatLog")) return;
    c.polling = true;
    try { const d = await api(`${c.url}?since=${c.rev}`); if (state.chat === c) mergeChat(d); }
    finally { c.polling = false; }
  }
  // Every chat action sends the rev we have and gets back everything that changed since, so nothing is missed.
  async function chatAction(path, method, body = {}) {
    const c = state.chat;
    const d = method === "DELETE" ? await api(`${c.url}${path}?since=${c.rev}`, { method }) : await api(c.url + path, send(method, { ...body, since: c.rev }));
    if (state.chat === c) mergeChat(d);
  }
  function focusChat() {
    const i = $("#chatInput");
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  function insertEmoji(emoji) {
    const i = $("#chatInput");
    if (!i || !state.chat) return;
    const at = i.selectionStart ?? i.value.length, end = i.selectionEnd ?? at;
    if (i.value.length - (end - at) + emoji.length > 500) return;
    i.value = i.value.slice(0, at) + emoji + i.value.slice(end);
    i.selectionStart = i.selectionEnd = at + emoji.length;
    state.chat.draft = i.value;
  }
  // Start at the top, but make sure the message box is on screen (on phones it would be below the fold).
  function showChat() { window.scrollTo(0, 0); $("#chatForm")?.scrollIntoView({ block: "nearest" }); }
  async function openGroup(key, tab = "chat") {
    const url = `/api/groups/${encodeURIComponent(key)}`, d = await api(url);
    state.page = "groups"; state.notice = "";
    state.groupView = { key, group: d.group, posts: d.posts, tab, caption: "" };
    state.chat = { url: `${url}/messages`, ...d.chat, draft: "", names: true, moderator: d.group.ownerId === state.user?.id, selected: null, editing: null };
    render(); if (tab === "chat") showChat();
  }
  async function openChat(friendId) {
    const url = `/api/friends/${friendId}/messages`, d = await api(url);
    state.page = "friends"; state.notice = ""; state.groupView = null;
    state.chat = { url, friendId, ...d, draft: "", names: false, moderator: false, selected: null, editing: null };
    const f = state.social.friends.find(x => x.id === friendId);
    if (f) f.unread = 0;
    render(); showChat();
  }

  // ---- Emoji picker: every emoji, drawn in the device's own emoji style (Apple emojis on iPhone, iPad and Mac). ----
  let emojiData = null;
  async function openEmojiPicker(title, onPick, keepOpen = false) {
    emojiData ||= await api("/emoji-data.json");
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal emoji-modal" role="dialog" aria-modal="true" aria-labelledby="emojiTitle">` +
      `<div class="row between"><h2 id="emojiTitle">${title}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<label class="sr-only" for="emojiSearch">Search emojis</label><input id="emojiSearch" type="search" placeholder="🔎 Search emojis" autocomplete="off">` +
      `<div class="emoji-tabs">${emojiData.map((g, i) => `<button type="button" class="emoji-tab" data-emoji-tab="${i}" title="${safe(g.name)}" aria-label="${safe(g.name)}">${g.icon}</button>`).join("")}</div>` +
      `<div class="emoji-scroll" id="emojiScroll">${emojiData.map((g, i) => `<div class="emoji-group" id="emojiGroup${i}"><h3>${safe(g.name)}</h3><div class="emoji-grid-all">${g.emojis.map(([e, n]) => `<button type="button" class="emoji-btn" data-pick-emoji="${e}" data-name="${safe(n.toLowerCase())}" title="${safe(n)}" aria-label="${safe(n)}">${e}</button>`).join("")}</div></div>`).join("")}<p class="muted" id="emojiNone" hidden>No emojis match that search.</p></div>` +
      (keepOpen ? `<div class="actions"><button class="primary" type="button" id="emojiDone">Done</button></div>` : "") + `</section></div>`;
    $("#closeModal").onclick = closeModal;
    if (keepOpen) $("#emojiDone").onclick = () => { closeModal(); focusChat(); };
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $(".emoji-modal").addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b?.dataset.emojiTab) $("#emojiScroll").scrollTop = $(`#emojiGroup${b.dataset.emojiTab}`).offsetTop;
      if (b?.dataset.pickEmoji) { if (!keepOpen) closeModal(); onPick(b.dataset.pickEmoji); }
    });
    $("#emojiSearch").oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      let shown = 0;
      document.querySelectorAll(".emoji-group").forEach(g => {
        let n = 0;
        // Match the start of words, so "cat" finds "cat face" but not "identification card".
        g.querySelectorAll(".emoji-btn").forEach(b => { b.hidden = Boolean(q) && !` ${b.dataset.name}`.includes(` ${q}`); n += !b.hidden; });
        g.hidden = !n; shown += n;
      });
      $("#emojiNone").hidden = shown > 0;
    };
    // Typing a search straight away suits a keyboard; on phones it would pop the keyboard up over the emojis.
    if (matchMedia("(hover: hover)").matches) $("#emojiSearch").focus();
  }
  async function openForward(msgId) {
    const c = state.chat, groups = (await api("/api/groups")).groups.filter(g => g.joined), friends = state.social.friends;
    const target = (attr, id, face, name) => `<button type="button" class="fwd-target" data-${attr}="${safe(id)}" data-name="${safe(name)}">${face}<span>${safe(name)}</span></button>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal fwd-modal" role="dialog" aria-modal="true" aria-labelledby="fwdTitle"><div class="row between"><h2 id="fwdTitle">↪️ Forward to…</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<h3>Friends</h3>${friends.length ? `<div class="fwd-list">${friends.map(f => target("fwd-friend", f.id, avatarHTML(f.avatar, "tiny"), f.username)).join("")}</div>` : `<p class="muted">No friends yet.</p>`}` +
      `<h3>Groups</h3>${groups.length ? `<div class="fwd-list">${groups.map(g => target("fwd-group", g.id, `<span class="avatar tiny" aria-hidden="true">${safe(g.icon)}</span>`, g.name)).join("")}</div>` : `<p class="muted">You're not in any groups yet.</p>`}</section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $(".fwd-modal").addEventListener("click", async e => {
      const b = e.target.closest("button[data-fwd-friend],button[data-fwd-group]");
      if (!b) return;
      closeModal();
      try {
        await api(`${c.url}/${msgId}/forward`, send("POST", b.dataset.fwdFriend ? { toFriend: Number(b.dataset.fwdFriend) } : { toGroup: b.dataset.fwdGroup }));
        c.selected = null; toast(`Forwarded to ${b.dataset.name}! ↪️`); await pollChat();
      } catch (err) { toast(err.message, true); }
    });
  }
  async function blockPerson(id, name) {
    if (!confirm(`Block ${name}?\n\nYou won't see their messages or posts, they can't send you friend requests, and if you're friends they'll be removed.`)) return;
    state.social = await api("/api/blocks", send("POST", { userId: id }));
    if (state.chat?.friendId === id) state.chat = null;
    state.posts = (await api("/api/posts")).posts;
    if (state.groupView) await openGroup(state.groupView.key, state.groupView.tab);
    toast(`${name} is blocked. You can unblock them on the Friends page.`);
  }
  // Every 3 seconds: check the open chat. Every 15 seconds: check for new friend requests and messages.
  let ticks = 0;
  setInterval(async () => {
    if (document.hidden || !state.user) return;
    ticks++;
    try {
      await pollChat();
      if (ticks % 5) return;
      const before = JSON.stringify(state.social);
      state.social = await api("/api/friends");
      if (JSON.stringify(state.social) === before) return;
      friendsBadge();
      // Refresh the friends list too, unless someone is typing on it.
      if (state.page === "friends" && !state.chat && !document.activeElement?.matches("input,textarea")) render();
    } catch {}
  }, 3000);

  // ---- Friends + Nail Salon pages ----
  function personRow(person, sub, actions) {
    return `<div class="person"><div class="person-main">${avatarHTML(person.avatar)}<div><strong>${safe(person.username)}</strong><small>${sub}</small></div></div><div class="row">${actions}</div></div>`;
  }
  function friendsPage() {
    const top = hero("Friends 👯", "Add friends by their Yakimma username. Friends can do each other's nails in the Nail Salon.", "YOUR PEOPLE");
    if (!state.user) return top + signInPanel("Sign in to add friends.");
    const { friends, incoming, outgoing, blocked = [] } = state.social;
    const block = p => `<button class="soft" data-block="${p.userId ?? p.id}" data-name="${safe(p.username)}">🚫 Block</button>`;
    const chatting = state.chat?.friendId && friends.find(f => f.id === state.chat.friendId);
    if (chatting) return hero(`Chat with ${safe(chatting.username)} 💬`, "Only you and your friend can see this chat.", "FRIEND CHAT") +
      `<section class="panel"><div class="row chat-head"><button class="soft" data-page="friends">← Friends</button>${avatarHTML(chatting.avatar)}<strong>${safe(chatting.username)}</strong></div>${chatBox(`Message ${chatting.username}`)}</section>`;
    return top +
      `<section class="panel"><h2>Add a friend</h2><form id="friendForm" class="row nowrap"><label class="sr-only" for="friendName">Friend's username</label><input id="friendName" maxlength="20" placeholder="Their username" autocomplete="off" required><button class="primary" type="submit">Send request</button></form><p class="muted-note">Your friend needs their own Yakimma account. Ask them for their exact username.</p></section>` +
      (incoming.length ? `<section class="panel"><h2>Friend requests 💌</h2>${incoming.map(r => personRow(r, "wants to be your friend", `<button class="primary" data-accept="${r.requestId}">Accept</button><button class="soft" data-reject="${r.requestId}">Decline</button>${block(r)}`)).join("")}</section>` : "") +
      `<section class="panel"><h2>My friends (${friends.length})</h2>${friends.length ? friends.map(f => personRow(f, `<span class="tone-dot" style="background:${toneHex(f.handTone)}"></span> ${safe(toneName(f.handTone))} hand`, `<button class="primary" data-chat="${f.id}">💬 Chat${f.unread ? ` <span class="badge" aria-label="${f.unread} unread">${f.unread}</span>` : ""}</button><button class="soft" data-salon="${f.id}">💅 Do their nails</button><button class="soft" data-unfriend="${f.id}" data-name="${safe(f.username)}">Remove</button>${block(f)}`)).join("") : `<p class="muted">No friends yet. Send a request above! 🌸</p>`}</section>` +
      (outgoing.length ? `<section class="panel"><h2>Sent requests</h2>${outgoing.map(r => personRow(r, "waiting for them to accept…", `<button class="soft" data-reject="${r.requestId}">Cancel</button>`)).join("")}</section>` : "") +
      (blocked.length ? `<section class="panel"><h2>Blocked (${blocked.length})</h2>${blocked.map(p => personRow(p, "blocked", `<button class="soft" data-unblock="${p.id}" data-name="${safe(p.username)}">Unblock</button>`)).join("")}<p class="muted-note">People you block can't send you friend requests, and you won't see their messages or posts.</p></section>` : "");
  }
  function receivedGallery(limit) {
    if (!state.received.length) return `<p class="muted">No nail sets yet. When a friend does your nails, they show up here. 💌</p>`;
    return `<div class="gallery">${state.received.slice(0, limit).map(r => `<figure class="look">${handSVG(toneHex(state.user.handTone), r.design, { label:`Nails by ${r.artist}` })}<figcaption><strong>by ${safe(r.artist)}</strong><small>${safe(r.createdAt)}</small></figcaption></figure>`).join("")}</div>`;
  }
  function nailsPage() {
    const top = hero("Yakimma Nail Salon 💅", "Pick your hand, choose a friend, and give them a fresh set.", "NAIL SALON");
    if (!state.user) return top + signInPanel("Sign in to visit the Nail Salon.");
    if (!state.inventory.includes("nails")) {
      const p = state.products.find(x => x.id === "nails") || { price: 1, currency: "LC" };
      const have = p.currency === "LC" ? state.user.lc : state.user.mc;
      return top + `<section class="panel locked"><div class="lock-icon" aria-hidden="true">🔒</div><h2>The Nail Salon is locked</h2><p>Unlock it in the Shop for <strong>${priceLabel(p)}</strong>. You have ${have} ${p.currency}.</p>${have < p.price ? `<p class="muted-note">${p.currency === "LC" ? "Win LoveCards on the Codes page, or swap 1,000 MC for 1 LC in the Shop." : "Earn MC by posting: every new person's first like on your post gives you 10 MC."}</p>` : ""}<button class="primary" data-page="shop">Go to the Shop</button></section>`;
    }
    const client = state.salon && state.social.friends.find(f => f.id === state.salon.friendId);
    if (client) return salonView(client);
    const myTone = state.user.handTone, latest = state.received[0];
    return top +
      `<section class="panel"><h2>Your hand 🖐️</h2><div class="hand-row"><div class="hand-box">${handSVG(toneHex(myTone), latest?.design, { label:"Your hand" })}</div><div><p>Choose the skin tone that matches you. Friends will see your hand in this tone when they do your nails.</p><div class="tones">${state.nailOptions.skinTones.map(t => `<button class="tone ${t.id===myTone?"on":""}" data-tone="${t.id}" style="--tone:${t.hex}" aria-pressed="${t.id===myTone}"><span></span>${safe(t.name)}</button>`).join("")}</div>${latest ? `<p class="muted-note">You're wearing the set ${safe(latest.artist)} made for you.</p>` : ""}</div></div></section>` +
      `<section class="panel"><h2>Choose a client</h2>${state.social.friends.length ? `<p class="muted-note">Pick a friend to sit at your nail table.</p><div class="clients">${state.social.friends.map(f => `<button class="client" data-salon="${f.id}"><span class="tone-dot big" style="background:${toneHex(f.handTone)}"></span><strong>${safe(f.username)}</strong><small>Start a manicure</small></button>`).join("")}</div>` : `<p>You need friends to do nails! 💅 Each friend needs their own Yakimma account.</p><button class="primary" data-page="friends">Find friends</button>`}</section>` +
      `<section class="panel"><h2>Nails your friends did for you</h2>${receivedGallery(12)}</section>`;
  }
  function salonHand() {
    const s = state.salon, client = state.social.friends.find(f => f.id === s.friendId);
    return handSVG(toneHex(client?.handTone), s.design, { selected: s.applyAll ? -1 : s.selected, interactive: true, label: `${client?.username || "Friend"}'s hand` });
  }
  function salonView(client) {
    const s = state.salon, o = state.nailOptions, d = s.design, cur = d.nails[s.selected];
    const chip = (attr, value, label, on) => `<button class="chip ${on?"on":""}" data-${attr}="${value}" aria-pressed="${on}">${label}</button>`;
    const steps = [["shape","1 · Shape"],["polish","2 · Polish"],["finish","3 · Finish"],["art","4 · Nail art"]];
    let tools;
    if (s.step === "shape") tools = `<h3>Nail shape</h3><div class="chips">${o.shapes.map(x => chip("shape", x.id, safe(x.name), d.shape === x.id)).join("")}</div><h3>Length</h3><div class="chips">${o.lengths.map(x => chip("length", x.id, safe(x.name), d.length === x.id)).join("")}</div><p class="muted-note">Shape and length go on the whole hand, just like at a real salon.</p>`;
    else if (s.step === "polish") tools = `<h3>Polish wall</h3><div class="polishes">${o.polishes.map(p => `<button class="bottle ${cur.color===p.hex?"on":""}" data-polish="${p.hex}" aria-pressed="${cur.color===p.hex}"><span style="--c:${p.hex}"></span><small>${safe(p.name)}</small></button>`).join("")}</div><label for="customPolish">Mix your own colour</label><input type="color" id="customPolish" value="${hexOr(cur.color, "#ff8fc0")}">`;
    else if (s.step === "finish") tools = `<h3>Top coat</h3><div class="chips">${o.finishes.map(x => chip("finish", x.id, `${x.icon} ${safe(x.name)}`, cur.finish === x.id)).join("")}</div>`;
    else tools = `<h3>Nail art</h3><div class="chips">${o.arts.map(x => x.item && !state.inventory.includes(x.item)
      ? `<button class="chip" disabled title="Find the secret code to unlock this sticker">🔒 ${safe(x.name)}</button>`
      : chip("art", x.id, `${x.icon} ${safe(x.name)}`, cur.art === x.id)).join("")}</div><h3>Art colour</h3><div class="chips">${ACCENTS.map(hex => `<button class="swatch ${cur.accent===hex?"on":""}" data-accent="${hex}" style="--c:${hex}" aria-label="Art colour ${hex}" aria-pressed="${cur.accent===hex}"></button>`).join("")}<input type="color" id="customAccent" value="${hexOr(cur.accent, "#ffffff")}" aria-label="Mix your own art colour"></div>`;
    return hero(`${safe(client.username)}'s manicure 💅`, "Tap a nail to work on just that one, or paint all five together.", "AT YOUR NAIL TABLE") +
      `<section class="panel"><div class="salon-grid"><div class="stage"><div class="hand-box" id="salonHand">${salonHand()}</div><div class="chips center">${FINGERS.map((f, i) => chip("pick", i, f.name, !s.applyAll && s.selected === i)).join("")}</div><label class="check"><input type="checkbox" id="applyAll" ${s.applyAll?"checked":""}> Paint all 5 nails together</label></div>` +
      `<div class="tools"><div class="steps" role="tablist">${steps.map(([id, l]) => `<button class="step ${s.step===id?"on":""}" data-step="${id}" role="tab" aria-selected="${s.step===id}">${l}</button>`).join("")}</div>${tools}` +
      `<div class="actions"><button class="primary" id="sendNails">💌 Finish & send to ${safe(client.username)}</button><button class="soft" id="resetNails">Start over</button><button class="soft" id="leaveSalon">Change client</button></div></div></div></section>`;
  }
  // Polish changes go on the chosen nail, or every nail when "paint all" is on.
  function paint(field, value, full = true) {
    const s = state.salon;
    s.design.nails.forEach((n, i) => { if (s.applyAll || i === s.selected) n[field] = value; });
    if (full) render(); else $("#salonHand").innerHTML = salonHand();
  }
  function openSalon(friendId) {
    state.salon = { friendId, design: newDesign(), selected: 1, applyAll: true, step: "shape" };
    state.page = "nails"; state.notice = ""; render(); window.scrollTo(0, 0);
  }

  // ---- Groups, Codes + Settings pages ----
  function groupCard(g) {
    const mine = state.user?.id === g.ownerId;
    const open = g.joined ? `<button class="primary" data-open-group="${g.id}">💬 Open</button>` : "";
    const action = !state.user ? "" : mine ? `${open}<button class="soft" data-delete-group="${g.id}" data-name="${safe(g.name)}">Delete</button>`
      : g.joined ? `${open}<button class="soft" data-leave-group="${g.id}">Leave</button>`
      : g.secret && !g.unlocked ? `<button class="soft" data-page="codes">🔒 Needs a code</button>` : `<button class="primary" data-join-group="${g.id}">Join</button>`;
    const tag = (g.secret ? ` <span class="pill">🔑 Secret</span>` : "") + (mine ? ` <span class="pill">Yours</span>` : g.joined ? ` <span class="pill">Joined ✓</span>` : "");
    return `<article class="group-card" data-search="${safe(`${g.name} ${g.description}`.toLowerCase())}"><div class="group-icon" aria-hidden="true">${safe(g.icon)}</div>` +
      `<div class="group-body"><h3>${safe(g.name)}${tag}</h3>${g.description ? `<p>${safe(g.description)}</p>` : ""}<div class="row"><span class="faces">${g.faces.map(f => avatarHTML(f.avatar, "tiny")).join("")}</span><small>${g.members} member${g.members === 1 ? "" : "s"} · ${g.secret ? "secret group" : `made by ${safe(g.owner)}`}</small></div></div>` +
      `<div class="group-actions">${action}</div></article>`;
  }
  function groupPage() {
    const v = state.groupView, g = v.group;
    const top = hero(`${safe(g.icon)} ${safe(g.name)}`, g.description ? safe(g.description) : `A group made by ${safe(g.owner)}.`, g.secret ? "SECRET GROUP" : "GROUP");
    const head = `<section class="panel"><div class="row between"><button class="soft" data-page="groups">← All groups</button><div class="row"><span class="faces">${g.faces.map(f => avatarHTML(f.avatar, "tiny")).join("")}</span><small>${g.members} member${g.members === 1 ? "" : "s"}</small></div></div>`;
    if (!g.joined) return top + head + `<p>Join this group to see its posts and chat.</p></section>`;
    const tabs = [["chat", "💬 Chat"], ["posts", "📸 Posts"]].map(([id, label]) => `<button class="step ${v.tab === id ? "on" : ""}" data-group-tab="${id}" role="tab" aria-selected="${v.tab === id}">${label}</button>`).join("");
    const body = v.tab === "chat" ? `<section class="panel">${chatBox(`Message ${g.name}`)}</section>` :
      `<section class="panel"><form id="groupPostForm"><label for="gpCaption">Post to ${safe(g.name)}</label><textarea id="gpCaption" maxlength="240" rows="2" required placeholder="Share something with the group…">${safe(v.caption)}</textarea>` +
      `<label for="gpMedia">Add a photo or video (optional)</label><input id="gpMedia" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime">` +
      `<div class="actions"><button class="primary" type="submit">Post to group ✨</button></div></form></section>` +
      `<div class="feed">${v.posts.map(postCard).join("") || `<div class="panel empty">No posts in this group yet. Share the first one! 🌸</div>`}</div>`;
    return top + head + `<div class="tabs" role="tablist">${tabs}</div></section>` + body;
  }
  function groupsPage() {
    if (state.groupView) return groupPage();
    const top = hero("Groups 🏘️", "Find groups made by people on Yakimma and join the ones you like.", "FIND YOUR PEOPLE");
    if (!state.groups) return top + `<section class="panel"><p class="muted">Loading groups…</p></section>`;
    const d = state.groupDraft || { name: "", description: "", icon: state.groupIcons[0] }, mine = state.groups.filter(g => g.joined);
    const create = !state.user ? signInPanel("Sign in to join groups or start your own.") :
      `<details class="panel" ${state.groupDraft ? "open" : ""}><summary><strong>＋ Start a new group</strong></summary><form id="groupForm">` +
      `<label for="groupName">Group name</label><input id="groupName" minlength="3" maxlength="40" required placeholder="e.g. Cat Lovers" value="${safe(d.name)}">` +
      `<label for="groupDesc">What's it about? (optional)</label><textarea id="groupDesc" maxlength="200" rows="2" placeholder="Tell people what your group is for">${safe(d.description)}</textarea>` +
      `<fieldset class="icon-pick"><legend>Pick an icon</legend>${state.groupIcons.map(i => `<label><input type="radio" name="groupIcon" value="${safe(i)}" ${i === d.icon ? "checked" : ""}><span>${safe(i)}</span></label>`).join("")}</fieldset>` +
      `<div class="actions"><button class="primary" type="submit">Create group</button></div></form></details>`;
    return top + create +
      (mine.length ? `<section class="panel"><h2>My groups (${mine.length})</h2><div class="groups">${mine.map(groupCard).join("")}</div></section>` : "") +
      `<section class="panel"><h2>All groups (${state.groups.length})</h2>${state.groups.length
        ? `<label class="sr-only" for="groupSearch">Search groups</label><input id="groupSearch" type="search" placeholder="🔎 Search groups" autocomplete="off"><div class="groups" id="allGroups">${state.groups.map(groupCard).join("")}</div><p class="muted" id="noGroupMatch" hidden>No groups match that search.</p>`
        : `<p class="muted">No groups yet.${state.user ? " Start the first one! 🌸" : ""}</p>`}</section>`;
  }
  const prizeLabel = r => [r.mc ? `🐱 ${r.mc} MC` : "", r.lc ? `💌 ${r.lc} LC` : "",
    r.sticker ? `a ${r.sticker.icon} ${safe(r.sticker.name)} nail sticker` : "", r.group ? `a key to the secret group ${r.group.icon} ${safe(r.group.name)}` : ""].filter(Boolean).join(" + ");
  function codesPage() {
    const top = hero("Codes 👩‍💻", "Found a secret code? Type it here to win MeowCoins, LoveCards, and secret surprises!", "SECRET CODES");
    if (!state.user) return top + signInPanel("Sign in to enter codes.");
    const { redeemed, total } = state.codes, win = state.codeWin;
    return top +
      (win ? `<section class="panel code-win" role="status"><div class="code-win-burst" aria-hidden="true">🎉</div><h2>You won ${prizeLabel(win)}!</h2><p>The code <strong>${safe(win.code)}</strong> worked.</p>` +
        (win.group ? `<p>You're in! You can find ${safe(win.group.name)} on the Groups page.</p><div class="actions"><button class="primary" data-page="groups">Go to Groups</button></div>` : "") +
        (win.sticker ? `<p>Use it in the Nail Salon: it's in the Nail art step.</p><div class="actions"><button class="primary" data-page="nails">Go to the Nail Salon</button></div>` : "") + `</section>` : "") +
      `<section class="panel"><h2>Enter a code</h2><form id="codeForm" class="row nowrap"><label class="sr-only" for="codeInput">Code</label><input id="codeInput" class="code-input" maxlength="20" placeholder="Type a code" autocomplete="off" autocapitalize="characters" spellcheck="false" required><button class="primary" type="submit">Redeem</button></form>` +
      `<p class="muted-note">Each code works once per account.</p><div class="code-progress" aria-hidden="true"><div style="width:${total ? redeemed.length / total * 100 : 0}%"></div></div><small>You've found ${redeemed.length} of ${total} codes</small></section>` +
      `<section class="panel"><h2>Codes you've used</h2>${redeemed.length ? redeemed.map(r => `<div class="code-row"><span class="code-tag">${safe(r.code)}</span><span>${prizeLabel(r)}</span><small>${safe(r.redeemedAt)}</small></div>`).join("") : `<p class="muted">No codes yet. Keep your eyes open! 👀</p>`}</section>`;
  }
  // Each theme card carries its own data-theme, so it previews that theme's real colours.
  function settingsPage() {
    const current = activeTheme();
    const cards = state.themes.map(t => {
      const unlocked = !t.item || (state.user && state.inventory.includes(t.item)), product = state.products.find(p => p.id === t.item);
      const status = t.id === current ? "Using ✓" : unlocked ? "Tap to use" : `🔒 ${product ? priceLabel(product) : ""} in the Shop`;
      return `<button class="theme-card ${t.id === current ? "on" : ""}" data-theme="${t.id}" ${unlocked ? `data-use-theme="${t.id}"` : `data-page="shop"`} aria-pressed="${t.id === current}"><span class="theme-preview" aria-hidden="true"><i></i><i></i><i></i></span><strong>${t.icon} ${safe(t.name)}</strong><small>${status}</small></button>`;
    }).join("");
    return hero("Settings ⚙️", "Choose how Yakimma looks.", "YOUR PREFERENCES") +
      `<section class="panel"><h2>Color theme</h2><div class="theme-grid">${cards}</div><p class="muted-note">${state.user ? "Your theme is saved to your account, so it follows you on any device." : "Free themes are saved in this browser. Sign in and buy Goth or Pastel in the Shop to unlock them."}</p></section>` +
      `<section class="panel"><h3>Safety reminder 🔐</h3><p class="muted-note">Never share your password. Before public launch, Yakimma needs reporting, moderation, privacy rules, and secure production hosting.</p></section>`;
  }
  function shopButton(p) {
    const owned = state.inventory.includes(p.id), theme = state.themes.find(t => t.item === p.id);
    if (owned && theme) return activeTheme() === theme.id ? `<button class="soft" disabled>Using ✓</button>` : `<button class="primary" data-use-theme="${theme.id}">Use theme</button>`;
    if (owned) return `<button class="primary" disabled>Owned ✓</button>`;
    if (!state.user) return `<button class="soft" data-sign-in>Sign in to buy</button>`;
    // Say how much is missing, rather than a Buy button that can only fail.
    const have = p.currency === "LC" ? state.user.lc : state.user.mc;
    if (have < p.price) return `<button class="soft" disabled>Need ${p.price - have} more ${p.currency}</button>`;
    return `<button class="primary" data-buy="${p.id}">Buy</button>`;
  }

  function postCard(p) {
    return `<article class="panel post" data-post="${p.id}"><div class="posthead">${avatarHTML(p.avatar)}<div><strong>${safe(p.username)}</strong><br><small>${timeLabel(p.createdAt)}</small></div>${state.user && state.user.id !== p.userId ? `<button class="soft post-block" data-block="${p.userId}" data-name="${safe(p.username)}">🚫 Block</button>` : ""}</div>${p.mediaUrl ? (p.mediaType?.startsWith("video/") ? `<video class="media" src="${p.mediaUrl}" controls playsinline preload="metadata"></video>` : `<img class="media" src="${p.mediaUrl}" alt="Post uploaded by ${safe(p.username)}">`) : `<div class="notice">📝 Text post</div>`}<p>${safe(p.caption)}</p><div class="actions"><button class="soft" data-like="${p.id}" ${!state.user || state.user.id===p.userId?"disabled":""}>${p.liked?"💗 Liked":"🤍 Like"} · ${p.likes}</button>${p.mediaType?.startsWith("video/")?`<button class="soft" data-speed="${p.id}">⏩ Speed</button><button class="soft" data-effects="${p.id}">✨ Effects</button>`:""}</div><div id="viewer-${p.id}"></div></article>`;
  }
  function render() {
    applyTheme();
    wallet();
    document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.page === state.page));
    friendsBadge();
    let html = "";
    if (state.page === "feed") {
      html = `<p class="home-name">Mahdiya Faiza Manha</p>` +
      hero("The world you can show off", "Upload videos you already made, watch posts, and earn 10 MC when someone likes your post.", "WELCOME TO YAKIMMA") +
      `<section class="panel"><div class="row between"><div><h2>Welcome to your feed 🌸</h2><small>Be kind, be creative, and show off your style.</small></div><button class="primary" data-page="create">＋ Upload post</button></div></section>` +
      `<div class="feed">${state.posts.map(postCard).join("") || `<div class="panel empty">No posts yet. Sign in and share the first one! 🌸</div>`}</div>`;
    } else if (state.page === "create") {
      html = hero("Upload your moment", "Choose a video you already made or a photo. Yakimma does not record videos inside the website.", "CREATE A POST") +
      `<section class="panel"><h2>Make a post</h2>${!state.user?`<p>Please sign in before posting.</p><button class="primary" id="openAuth">Sign in / Create account</button>`:`<form id="postForm"><label for="postType">Post type</label><select id="postType"><option value="video">Video</option><option value="photo">Photo</option><option value="text">Text only</option></select><label for="media">Choose an existing photo or video</label><input id="media" name="media" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"><small>Maximum 100 MB per file in this starter. Uploads are stored on the server running this app.</small><label for="caption">Caption</label><textarea id="caption" maxlength="240" rows="3" required placeholder="Write something fun..."></textarea><div class="actions"><button class="primary" type="submit">Publish post ✨</button><button class="soft" type="button" data-page="feed">Cancel</button></div></form>`}</section>`;
    } else if (state.page === "shop") {
      html = hero("The Yakimma Shop", "Your exact shop prices, paid with MeowCoin and LoveCards.", "SHOP & COLLECT") +
      `<section class="panel"><h2>Your wallet</h2><p>Every new person's first like on your post earns 10 MC. 1,000 MC = 1 LoveCard. Secret codes on the Codes page give MC and LC too.</p><p class="wallet">${state.user?`🐱 ${state.user.mc} MC · 💌 ${state.user.lc} LC`:"Sign in to see your wallet"}</p><button class="primary" id="exchange" ${!state.user||state.user.mc<1000?"disabled":""}>Exchange 1,000 MC → 1 LC</button></section><div class="shopgrid">${state.products.map(p=>`<article class="product"><div class="productart">${p.icon}</div><h3>${safe(p.name)}</h3><p class="muted-note">${safe(p.description)}</p><div class="row between"><span class="price">${priceLabel(p)}</span>${shopButton(p)}</div></article>`).join("")}</div>`;
    } else if (state.page === "friends") {
      html = friendsPage();
    } else if (state.page === "groups") {
      html = groupsPage();
    } else if (state.page === "codes") {
      html = codesPage();
    } else if (state.page === "nails") {
      html = nailsPage();
    } else if (state.page === "profile") {
      html = hero("Your Yakimma profile", "Your posts, wallet, and collection.", "MY PROFILE") +
      `<section class="panel"><div class="posthead">${state.user?`<button class="avatar-edit" id="editAvatar" aria-label="Change profile picture">${avatarHTML(state.user.avatar,"big")}<span class="avatar-edit-badge" aria-hidden="true">✏️</span></button>`:avatarHTML(null,"big")}<div><h2 style="margin:0">${state.user?safe(state.user.username):"Guest"}</h2><small>${state.user?"Signed in":"Browsing as a guest"}</small></div></div>${state.user?`<div class="row"><span class="pill">🐱 ${state.user.mc} MC</span><span class="pill">💌 ${state.user.lc} LC</span><span class="pill">🎁 ${state.inventory.length} items</span><span class="pill">👯 ${state.social.friends.length} friend${state.social.friends.length===1?"":"s"}</span></div><div class="actions"><button class="soft" id="editAvatarBtn">🎨 Change picture</button><button class="danger" id="logout">Sign out</button></div>`:`<button class="primary" id="openAuth">Create account / Sign in</button>`}</section><section class="panel"><h3>My collection</h3>${state.inventory.length?[...state.products.filter(p=>state.inventory.includes(p.id)).map(p=>`${p.icon} ${safe(p.name)}`),...state.nailOptions.arts.filter(a=>a.item&&state.inventory.includes(a.item)).map(a=>`${a.icon} ${safe(a.name)} sticker`)].map(x=>`<span class="pill">${x}</span> `).join(""):`<p class="muted">Visit the shop to collect something cute.</p>`}</section>` +
      (state.user ? `<section class="panel"><h3>My nails 💅</h3>${receivedGallery(3)}</section>` : "");
    } else if (state.page === "settings") {
      html = settingsPage();
    }
    $("#main").innerHTML = notice() + html;
    const log = $("#chatLog");
    if (log) log.scrollTop = log.scrollHeight;
  }
  // Eye open = password is hidden (tap to show); eye closed = password is showing (tap to hide).
  const EYE_OPEN = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_CLOSED = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 10c2.5 3.5 6 5.5 10 5.5s7.5-2 10-5.5"/><path d="M4.6 13.3 3 15.6M9 15.2l-.8 2.7M15 15.2l.8 2.7M19.4 13.3l1.6 2.3"/></svg>`;
  const closeModal = () => { $("#modalroot").innerHTML = ""; };
  function openAuth(startMode = "login") {
    $("#accountMenu")?.remove();
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="authTitle"><div class="row between"><h2 id="authTitle">🌸 Welcome to Yakimma</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div><p class="muted-note">Create a real local test account. Use a unique password you don't use anywhere else. This local starter is not yet a public website.</p><div class="row"><button type="button" id="tabLogin">Sign in</button><button type="button" id="tabSignup">Create account</button></div><form id="authForm"><label for="username">Username</label><input id="username" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" autocomplete="username" required><label for="password" id="passwordLabel">Password</label><div class="password-wrap"><input id="password" name="password" type="password" maxlength="200" required><button type="button" class="eye" id="togglePassword" aria-label="Show password" aria-pressed="false" title="Show password">${EYE_OPEN}</button></div><p id="authError" class="muted-note"></p><button class="primary" type="submit" style="width:100%">Sign in</button></form></section></div>`;
    let mode = startMode;
    const setMode = m => {
      mode = m;
      const signup = m === "signup";
      $("#authTitle").textContent = signup ? "🌸 Join Yakimma" : "🩵 Welcome back";
      $("#authForm button[type=submit]").textContent = signup ? "Create account" : "Sign in";
      $("#passwordLabel").textContent = signup ? "Password (10+ characters)" : "Password";
      $("#password").autocomplete = signup ? "new-password" : "current-password";
      $("#password").minLength = signup ? 10 : 1;
      $("#authError").textContent = signup ? "Username: 3–20 letters, numbers, or underscores." : "Enter your username and password.";
      $("#authError").className = "muted-note";
      [["#tabLogin", !signup], ["#tabSignup", signup]].forEach(([sel, on]) => { $(sel).className = on ? "primary" : "soft"; $(sel).setAttribute("aria-pressed", on); });
    };
    setMode(mode);
    $("#tabSignup").onclick = () => setMode("signup"); $("#tabLogin").onclick = () => setMode("login");
    $("#togglePassword").onclick = () => {
      const field = $("#password"), show = field.type === "password", label = show ? "Hide password" : "Show password";
      field.type = show ? "text" : "password";
      Object.assign($("#togglePassword"), { innerHTML: show ? EYE_CLOSED : EYE_OPEN, title: label });
      $("#togglePassword").setAttribute("aria-label", label); $("#togglePassword").setAttribute("aria-pressed", show);
    };
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#authForm").onsubmit = async e => {
      e.preventDefault();
      const username = $("#username").value.trim(), password = $("#password").value;
      try {
        await api("/api/" + mode, send("POST", { username, password }));
        closeModal(); await refresh(); await loadPageData();
        toast(mode === "signup" ? `Welcome to Yakimma, ${state.user.username}! 🌸` : `Welcome back, ${state.user.username}! 🩵`);
      }
      catch (err) { $("#authError").textContent = err.message; $("#authError").className = "notice error"; }
    };
    $("#username").focus();
  }
  // Profile picture editor: an emoji avatar, or a photo you drag and zoom to fit the circle.
  function openAvatarEditor() {
    const o = state.avatarOptions, current = state.user.avatar, C = 480;
    let emoji = current.emoji, bg = current.bg, img = null, zoom = 1, ox = 0, oy = 0;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatarTitle"><div class="row between"><h2 id="avatarTitle">🎨 Your profile picture</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<div class="row"><button type="button" id="tabEmoji">🌷 Emoji avatar</button><button type="button" id="tabPhoto">📷 Photo</button></div>` +
      `<div id="emojiPane"><div class="avatar-preview" id="emojiPreview"></div><h3>Pick a character</h3><div class="emoji-grid">${o.emojis.map(e => `<button type="button" class="emoji-pick" data-av-emoji="${safe(e)}" aria-label="${safe(e)}">${safe(e)}</button>`).join("")}</div>` +
      `<h3>Background</h3><div class="chips">${o.backgrounds.map(b => `<button type="button" class="swatch" data-av-bg="${b.id}" style="--c:${b.css}" title="${safe(b.name)}" aria-label="${safe(b.name)} background"></button>`).join("")}</div>` +
      `<div class="actions"><button class="primary" type="button" id="saveEmojiAvatar">Save avatar</button></div></div>` +
      `<div id="photoPane" hidden><div class="crop-wrap" id="cropWrap"><canvas id="cropCanvas" width="${C}" height="${C}" aria-label="Photo crop preview"></canvas><div class="crop-ring" aria-hidden="true"></div>${current.photoUrl ? "" : `<p class="crop-empty">Choose a photo to start</p>`}</div>` +
      `<label class="file-btn soft"><input type="file" id="photoFile" accept="image/jpeg,image/png,image/gif,image/webp">📁 Choose a photo</label>` +
      `<label for="zoom">Zoom</label><input type="range" id="zoom" min="1" max="3" step="0.01" value="1" disabled><p class="muted-note">Drag the photo to move it inside the circle. Only use a picture you're happy for everyone on Yakimma to see.</p>` +
      `<div class="actions"><button class="primary" type="button" id="savePhoto" disabled>Save photo</button>${current.photoUrl ? `<button class="soft" type="button" id="removePhoto">Remove photo</button>` : ""}</div></div>` +
      `<p id="avatarError" class="muted-note" role="status"></p></section></div>`;
    const canvas = $("#cropCanvas"), ctx = canvas.getContext("2d"), fail = msg => { $("#avatarError").textContent = msg; $("#avatarError").className = "notice error"; };
    const showEmoji = () => {
      $("#emojiPreview").innerHTML = avatarHTML({ emoji, bg }, "huge");
      document.querySelectorAll("[data-av-emoji]").forEach(b => { b.classList.toggle("on", b.dataset.avEmoji === emoji); b.setAttribute("aria-pressed", b.dataset.avEmoji === emoji); });
      document.querySelectorAll("[data-av-bg]").forEach(b => { b.classList.toggle("on", b.dataset.avBg === bg); b.setAttribute("aria-pressed", b.dataset.avBg === bg); });
    };
    const setTab = t => {
      $("#emojiPane").hidden = t !== "emoji"; $("#photoPane").hidden = t !== "photo";
      [["#tabEmoji", t === "emoji"], ["#tabPhoto", t === "photo"]].forEach(([sel, on]) => { $(sel).className = on ? "primary" : "soft"; $(sel).setAttribute("aria-pressed", on); });
    };
    // Draw the photo so it always covers the whole square; ox/oy pan it and zoom scales it.
    const drawCrop = () => {
      ctx.fillStyle = "#fff0f8"; ctx.fillRect(0, 0, C, C);
      if (!img) return;
      const scale = Math.max(C / img.width, C / img.height) * zoom, w = img.width * scale, h = img.height * scale;
      const maxX = (w - C) / 2, maxY = (h - C) / 2;
      ox = Math.max(-maxX, Math.min(maxX, ox)); oy = Math.max(-maxY, Math.min(maxY, oy));
      ctx.drawImage(img, (C - w) / 2 + ox, (C - h) / 2 + oy, w, h);
    };
    const loadImage = (src, editable) => {
      const im = new Image();
      im.onload = () => {
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
        img = im; zoom = 1; ox = oy = 0; $("#zoom").value = 1; drawCrop();
        $(".crop-empty")?.remove(); $("#zoom").disabled = !editable; $("#savePhoto").disabled = !editable; canvas.classList.toggle("draggable", editable);
      };
      im.onerror = () => fail("That file couldn't be opened as a picture. Try a JPG or PNG.");
      im.src = src;
    };
    $("#photoFile").onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      $("#avatarError").textContent = ""; $("#avatarError").className = "muted-note";
      const url = URL.createObjectURL(file);
      loadImage(url, true);
    };
    $("#zoom").oninput = e => { zoom = Number(e.target.value); drawCrop(); };
    let drag = null;
    canvas.onpointerdown = e => { if ($("#zoom").disabled) return; drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
    canvas.onpointermove = e => {
      if (!drag) return;
      const k = C / canvas.clientWidth;
      ox += (e.clientX - drag.x) * k; oy += (e.clientY - drag.y) * k; drag = { x: e.clientX, y: e.clientY }; drawCrop();
    };
    canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
    const saved = async (d, message) => { state.user = d.user; closeModal(); await refresh(); toast(message); };
    $("#savePhoto").onclick = async () => {
      // Re-drawing at 400×400 keeps uploads small and strips hidden photo data such as location.
      const out = document.createElement("canvas"); out.width = out.height = 400;
      out.getContext("2d").drawImage(canvas, 0, 0, 400, 400);
      const blob = await new Promise(r => out.toBlob(r, "image/jpeg", 0.9));
      const body = new FormData(); body.append("photo", blob, "avatar.jpg");
      $("#savePhoto").disabled = true;
      try { await saved(await api("/api/me/avatar-photo", { method: "POST", body }), "Profile picture updated! 📸"); }
      catch (err) { fail(err.message); $("#savePhoto").disabled = false; }
    };
    if ($("#removePhoto")) $("#removePhoto").onclick = async () => {
      try { await saved(await api("/api/me/avatar-photo", { method: "DELETE" }), "Photo removed. Your emoji avatar is back! 🌷"); } catch (err) { fail(err.message); }
    };
    $("#saveEmojiAvatar").onclick = async () => {
      try { await saved(await api("/api/me/avatar", send("PUT", { emoji, bg })), "Avatar saved! 🌷"); } catch (err) { fail(err.message); }
    };
    $(".avatar-modal").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.avEmoji) { emoji = b.dataset.avEmoji; showEmoji(); }
      if (b.dataset.avBg) { bg = b.dataset.avBg; showEmoji(); }
    });
    $("#tabEmoji").onclick = () => setTab("emoji"); $("#tabPhoto").onclick = () => setTab("photo");
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    showEmoji(); drawCrop(); setTab(current.photoUrl ? "photo" : "emoji");
    if (current.photoUrl) loadImage(current.photoUrl, false);
  }
  function toggleAccountMenu() {
    if ($("#accountMenu")) return $("#accountMenu").remove();
    $(".top-actions").insertAdjacentHTML("beforeend", `<div class="account-menu" id="accountMenu" role="menu"><div class="account-menu-head">${avatarHTML(state.user.avatar)}<div><strong>${safe(state.user.username)}</strong><small>🐱 ${state.user.mc} MC · 💌 ${state.user.lc} LC</small></div></div><button class="menu-item" role="menuitem" data-page="profile">🌷 My profile</button><button class="menu-item" role="menuitem" id="menuAvatar">🎨 Change picture</button><button class="menu-item signout" role="menuitem" id="logout">🚪 Sign out</button></div>`);
    $("#accountMenu button").focus();
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if ($("#accountMenu")) { $("#accountMenu").remove(); $("#accountBtn").focus(); }
    else if ($("#modalback")) closeModal();
    else if (state.chat?.selected) { state.chat.selected = null; drawLog(); }
    else if (state.chat?.editing) { Object.assign(state.chat, { editing: null, draft: "" }); render(); }
  });
  document.addEventListener("click", async e => {
    const hit = e.target.closest("[data-nail-i]");
    if (hit && state.salon) { state.salon.applyAll = false; state.salon.selected = Number(hit.dataset.nailI); render(); return; }
    if (!e.target.closest("#accountBtn")) $("#accountMenu")?.remove();
    // Tapping anywhere outside the selected message closes its actions.
    if (state.chat?.selected && !e.target.closest(".msg-body") && !e.target.closest("#modalroot")) { state.chat.selected = null; drawLog(); }
    const b=e.target.closest("button"); if(!b)return;
    const s = state.salon;
    try {
      if(b.dataset.page){
        state.page=b.dataset.page;state.notice="";state.codeWin=null;state.groupView=null;state.chat=null;render();
        await loadPageData();render();
        return;
      }
      if(b.id==="accountBtn"){state.user?toggleAccountMenu():openAuth("login");return;}
      if(b.id==="openAuth"){openAuth("signup");return;}
      if(b.dataset.signIn!==undefined){openAuth("login");return;}
      if(["editAvatar","editAvatarBtn","menuAvatar"].includes(b.id)){openAvatarEditor();return;}
      if(b.id==="logout"){await api("/api/logout",{method:"POST"});state.groupView=null;state.chat=null;await refresh();state.page="feed";toast("You're signed out. See you soon! 👋");return;}
      if(b.dataset.like){const d=await api(`/api/posts/${b.dataset.like}/like`,{method:"POST"});if(state.groupView)state.groupView.posts=d.posts;else state.posts=d.posts;state.user=d.user;state.notice=d.rewarded?"You earned 10 MC! 🐱":"";render();return;}
      if(b.id==="exchange"){const d=await api("/api/exchange",{method:"POST"});state.user=d.user;toast("Exchanged 1,000 MC for 1 LoveCard! 💌");return;}
      if(b.dataset.buy){const d=await api(`/api/shop/${b.dataset.buy}/buy`,{method:"POST"});state.user=d.user;state.inventory=d.inventory;const t=state.themes.find(x=>x.item===b.dataset.buy);toast(t?`${t.name} theme is on! ${t.icon} You can switch themes any time in Settings.`:"Purchased! ✨");return;}
      if(b.dataset.useTheme){await useTheme(b.dataset.useTheme);return;}
      if(b.dataset.joinGroup){setGroups(await api(`/api/groups/${b.dataset.joinGroup}/join`,{method:"POST"}));toast("You joined the group! 🎉 Tap Open to chat and post.");return;}
      if(b.dataset.openGroup){await openGroup(b.dataset.openGroup);return;}
      if(b.dataset.groupTab&&state.groupView){state.groupView.tab=b.dataset.groupTab;render();if(b.dataset.groupTab==="chat"){showChat();await pollChat();}return;}
      if(b.dataset.chat){await openChat(Number(b.dataset.chat));return;}
      if(state.chat){
        const c=state.chat;
        if(b.dataset.pickMsg){const id=Number(b.dataset.pickMsg);c.selected=c.selected===id?null:id;drawLog();$("#chatLog .msg-tools")?.scrollIntoView({block:"nearest"});return;}
        if(b.dataset.react){c.selected=null;await chatAction(`/${b.dataset.msg}/reactions`,"POST",{emoji:b.dataset.react});return;}
        if(b.dataset.reactMore){const id=b.dataset.reactMore;await openEmojiPicker("React with any emoji",async emoji=>{try{c.selected=null;await chatAction(`/${id}/reactions`,"POST",{emoji});}catch(err){toast(err.message,true);}});return;}
        if(b.id==="emojiInsert"){await openEmojiPicker("Add emojis",insertEmoji,true);return;}
        if(b.dataset.forwardMsg){await openForward(Number(b.dataset.forwardMsg));return;}
        if(b.dataset.editMsg){const m=c.messages.find(x=>x.id===Number(b.dataset.editMsg));Object.assign(c,{editing:m.id,draft:m.body,selected:null});render();focusChat();return;}
        if(b.id==="cancelEdit"){Object.assign(c,{editing:null,draft:""});render();return;}
        if(b.dataset.deleteMsg){if(!confirm("Delete this message for everyone?"))return;c.selected=null;await chatAction(`/${b.dataset.deleteMsg}`,"DELETE");return;}
      }
      if(b.dataset.block){await blockPerson(Number(b.dataset.block),b.dataset.name);return;}
      if(b.dataset.unblock){state.social=await api(`/api/blocks/${b.dataset.unblock}`,{method:"DELETE"});state.posts=(await api("/api/posts")).posts;toast(`${b.dataset.name} is unblocked.`);return;}
      if(b.dataset.leaveGroup){setGroups(await api(`/api/groups/${b.dataset.leaveGroup}/join`,{method:"DELETE"}));toast("You left the group.");return;}
      if(b.dataset.deleteGroup){if(!confirm(`Delete the group "${b.dataset.name}"? This can't be undone.`))return;setGroups(await api(`/api/groups/${b.dataset.deleteGroup}`,{method:"DELETE"}));toast("Group deleted.");return;}
      if(b.dataset.accept){state.social=await api(`/api/friends/requests/${b.dataset.accept}/accept`,{method:"POST"});toast("You're now friends! 🎉");return;}
      if(b.dataset.reject){state.social=await api(`/api/friends/requests/${b.dataset.reject}`,{method:"DELETE"});toast("Request removed.");return;}
      if(b.dataset.unfriend){if(!confirm(`Remove ${b.dataset.name} from your friends?`))return;state.social=await api(`/api/friends/${b.dataset.unfriend}`,{method:"DELETE"});if(s?.friendId===Number(b.dataset.unfriend))state.salon=null;toast("Friend removed.");return;}
      if(b.dataset.salon){openSalon(Number(b.dataset.salon));return;}
      if(b.dataset.tone){const d=await api("/api/me/hand-tone",send("PUT",{tone:b.dataset.tone}));state.user=d.user;toast("Skin tone saved! 🖐️");return;}
      if(s){
        if(b.dataset.step){s.step=b.dataset.step;render();return;}
        if(b.dataset.shape){s.design.shape=b.dataset.shape;render();return;}
        if(b.dataset.length){s.design.length=b.dataset.length;render();return;}
        if(b.dataset.pick!==undefined){s.applyAll=false;s.selected=Number(b.dataset.pick);render();return;}
        if(b.dataset.polish){paint("color",b.dataset.polish);return;}
        if(b.dataset.finish){paint("finish",b.dataset.finish);return;}
        if(b.dataset.art){paint("art",b.dataset.art);return;}
        if(b.dataset.accent){paint("accent",b.dataset.accent);return;}
        if(b.id==="resetNails"){s.design=newDesign();render();return;}
        if(b.id==="leaveSalon"){state.salon=null;render();return;}
        if(b.id==="sendNails"){
          const name=state.social.friends.find(f=>f.id===s.friendId)?.username||"your friend";
          await api("/api/nails",send("POST",{friendId:s.friendId,design:s.design}));
          state.salon=null;toast(`All done! ${name} can see their new nails on their profile. 💌`);return;
        }
      }
      if(b.dataset.speed){const card=b.closest(".post"), video=card?.querySelector("video");if(!video){toast("This post has no video player.",true);return;}const speed=prompt("Choose playback speed: 0.5, 1, 1.5, or 2","1.5");if(["0.5","1","1.5","2"].includes(speed)){video.playbackRate=Number(speed);toast("Playback speed set to "+speed+"×");}return;}
      if(b.dataset.effects){const card=b.closest(".post");if(!card)return;const effect=prompt("Viewing effect: normal, sparkle, soft, or mono","sparkle");card.style.filter=effect==="mono"?"grayscale(1)":effect==="soft"?"saturate(1.3) brightness(1.05)":effect==="sparkle"?"saturate(1.5) hue-rotate(8deg)":"none";return;}
    } catch(err){toast(err.message,true);}
  });
  // Colour pickers update the hand live while dragging, then redraw the tools when the picker closes.
  document.addEventListener("input", e => {
    // Group search filters the cards in place, so typing never loses focus.
    if (e.target.id === "groupSearch") {
      const q = e.target.value.trim().toLowerCase(); let shown = 0;
      document.querySelectorAll("#allGroups .group-card").forEach(c => { c.hidden = !c.dataset.search.includes(q); shown += !c.hidden; });
      $("#noGroupMatch").hidden = shown > 0;
      return;
    }
    if (e.target.id === "chatInput" && state.chat) { state.chat.draft = e.target.value; return; }
    if (!state.salon) return;
    if (e.target.id === "customPolish") paint("color", e.target.value, false);
    if (e.target.id === "customAccent") paint("accent", e.target.value, false);
  });
  document.addEventListener("change", e => {
    if (!state.salon) return;
    if (e.target.id === "applyAll") { state.salon.applyAll = e.target.checked; render(); }
    if (e.target.id === "customPolish" || e.target.id === "customAccent") render();
  });
  document.addEventListener("submit", async e=>{
    if(e.target.id==="friendForm"){
      e.preventDefault();
      const username=$("#friendName").value.trim();
      try { const d=await api("/api/friends/request",send("POST",{username}));state.social=d;toast(d.accepted?`You and ${username} are now friends! 🎉`:`Friend request sent to ${username}! 💌`); }
      catch(err){toast(err.message,true);}
      return;
    }
    if(e.target.id==="codeForm"){
      e.preventDefault();
      try { const d=await api("/api/codes",send("POST",{code:$("#codeInput").value}));state.user=d.user;state.inventory=d.inventory;state.codes={redeemed:d.redeemed,total:d.total};state.codeWin=d.won;state.notice="";render(); }
      catch(err){state.codeWin=null;toast(err.message,true);}
      return;
    }
    if(e.target.id==="groupForm"){
      e.preventDefault();
      // Keep what was typed, so an error message doesn't wipe the form.
      const draft={name:$("#groupName").value.trim(),description:$("#groupDesc").value.trim(),icon:e.target.querySelector("input[name=groupIcon]:checked")?.value};
      state.groupDraft=draft;
      try { setGroups(await api("/api/groups",send("POST",draft)));state.groupDraft=null;toast(`Your group "${draft.name}" is ready! 🏘️`); }
      catch(err){toast(err.message,true);}
      return;
    }
    if(e.target.id==="chatForm"){
      e.preventDefault();
      const c=state.chat, body=$("#chatInput").value.trim(), editing=c?.editing;
      if(!c||!body)return;
      $("#chatInput").value="";c.draft="";
      try {
        if(editing){c.editing=null;await chatAction(`/${editing}`,"PATCH",{body});render();focusChat();}
        else await chatAction("","POST",{body});
      }
      catch(err){c.draft=body;c.editing=editing;toast(err.message,true);}
      return;
    }
    if(e.target.id==="groupPostForm"){
      e.preventDefault();
      const v=state.groupView, file=$("#gpMedia").files[0];
      v.caption=$("#gpCaption").value.trim();
      const body=new FormData();body.append("caption",v.caption);if(file)body.append("media",file);
      try { const d=await api(`/api/groups/${encodeURIComponent(v.key)}/posts`,{method:"POST",body});v.posts=d.posts;v.caption="";toast("Posted to the group! 🌸"); }
      catch(err){toast(err.message,true);}
      return;
    }
    if(e.target.id!=="postForm")return;
    e.preventDefault();
    const type=$("#postType").value, file=$("#media").files[0], caption=$("#caption").value.trim();
    if(type==="video" && file && !file.type.startsWith("video/"))return toast("Choose a video file for a video post.",true);
    if(type==="photo" && file && !file.type.startsWith("image/"))return toast("Choose an image file for a photo post.",true);
    if(type!=="text" && !file)return toast("Choose a file, or select Text only.",true);
    const body=new FormData();body.append("caption",caption);if(file)body.append("media",file);
    try { await api("/api/posts",{method:"POST",body});state.page="feed";state.notice="";await refresh();toast("Your post is published on this server! 🌸"); }
    catch(err){toast(err.message,true);}
  });
  $("#homeBtn").addEventListener("click",e=>{e.preventDefault();state.page="feed";state.notice="";render();});
  async function init(){try{await refresh();render();}catch(err){toast(err.message,true);}}
  init();
})();
