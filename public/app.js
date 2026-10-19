(() => {
  const $ = s => document.querySelector(s);
  const state = {
    user: null, products: [], inventory: [], posts: [], page: "feed", notice: "",
    nailOptions: { skinTones: [], shapes: [], lengths: [], finishes: [], arts: [], polishes: [] },
    avatarOptions: { emojis: [], backgrounds: [] },
    social: { friends: [], incoming: [], outgoing: [] }, received: [], salon: null,
    themes: [], guestTheme: null, groups: null, groupIcons: [], groupDraft: null,
    codes: { redeemed: [], total: 0 }, codeWin: null,
    // myPosts: your own posts on the profile ({ order: "newest"|"oldest", posts, more, total }).
    myPosts: null,
    // viewing: the speed and effect chosen for each video post, by post id ({ speed, effect, open }).
    viewing: {},
    // pictures: what you took with the 📷 camera ({ pictures, max }).
    pictures: null,
    // groupView: the group page that's open. chat: the open group or friend chat ({ url, messages, draft, names, friendId? }).
    groupView: null, chat: null
  };
  const safe = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function api(url, options = {}) {
    const res = await fetch(url, { credentials:"same-origin", ...options });
    const data = await res.json().catch(() => ({}));
    // Only a "you're suspended" answer about your own account (403) means you are. The creator never is.
    if (res.status === 403 && data.suspended && state.user && !state.user.creator && !state.user.suspended) { state.user.suspended = data.suspended; render(); }
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
    if (zoneOn()) root.dataset.zone = "18"; else delete root.dataset.zone;
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
    const zone = zoneOn();
    // In the 18+ zone only Kuchisake-onna's page (which takes the place of Nails) gets the 👹🩸 art.
    const art = zone ? (state.page === "nails" ? "👹🩸" : "") : themeById(activeTheme())?.art || "🌸🩵";
    return `<section class="hero"><div><span class="pill">${zone ? "🔞 18+ · " : kidOn() ? "🧸 KIDDY ZONE · " : ""}${tag}</span><h1>${title}</h1><p>${desc}</p></div>${art ? `<div style="font-size:3.2rem" aria-hidden="true">${art}</div>` : ""}</section>`;
  }
  const bgCss = id => (state.avatarOptions.backgrounds.find(b => b.id === id) || state.avatarOptions.backgrounds[0])?.css || "linear-gradient(135deg,var(--pink2),var(--teal2))";
  function avatarHTML(a, size = "") {
    if (a?.photoUrl) return `<span class="avatar photo ${size}"><img src="${safe(a.photoUrl)}" alt=""></span>`;
    return `<span class="avatar ${size}" style="background:${bgCss(a?.bg)}" aria-hidden="true">${safe(a?.emoji || "🌷")}</span>`;
  }
  // The name to show for someone: the nickname you gave them if they're your friend (only you see it), or else their
  // display name if they're an admin (the creator too), with their @username after it. Otherwise just their username.
  const shownName = username => state.social?.nicknames?.[username?.toLowerCase()] || state.displayNames?.[username?.toLowerCase()];
  const nameText = username => shownName(username) || username;
  // Nobody can report or block the creator, so their posts, comments and messages don't have those buttons.
  const isCreatorName = username => username?.toLowerCase() === "creator";
  const nameHTML = username => {
    const shown = shownName(username);
    return shown ? `${safe(shown)} <small class="at-name">@${safe(username)}</small>` : safe(username);
  };
  // Text someone wrote, with each @username (a tag) picked out; tapping one opens that person's profile. The same pattern
  // is in server.js. Inside a button (like a chat bubble) a tag can't be a button too, so there it's a span.
  const TAG = /(^|[^A-Za-z0-9@])@([A-Za-z0-9]{3,20})(?![A-Za-z0-9])/g;
  const richText = (text, inButton = false) => safe(text).replace(TAG, (_, before, name) =>
    before + (inButton ? `<span class="mention" data-mention="${name}">@${name}</span>` : `<button type="button" class="mention" data-mention="${name}">@${name}</button>`));
  // Someone's picture and name as a button that opens their profile (yours opens your Profile page). Guests can't open profiles.
  const personLink = (id, username, inner) => id && state.user ? `<button class="person-link" data-view-person="${id}" title="See ${safe(nameText(username))}'s profile">${inner}</button>` : inner;
  const signInPanel = message => `<section class="panel"><p>${message}</p><button class="primary" id="openAuth">Sign in / Create account</button></section>`;
  function wallet() {
    $("#wallet").textContent = state.user ? `🐱 ${state.user.mc} MC · 💌 ${state.user.lc} LC` : "🐱 Sign in to save MC";
    $("#accountBtn").innerHTML = state.user ? `${avatarHTML(state.user.avatar, "tiny")}<span class="acct-name">${safe(nameText(state.user.username))}</span> ▾` : "Sign in";
    $("#accountBtn").setAttribute("aria-label", state.user ? `Account menu for ${state.user.username}` : "Sign in");
    $("#accountBtn").setAttribute("aria-haspopup", state.user ? "menu" : "dialog");
    bell();
  }
  // ---- 🔔 Notifications: the bell at the top, with how many are new. ----
  function bell() {
    const btn = $("#bellBtn"), n = state.unread || 0;
    btn.hidden = !state.user;
    btn.innerHTML = `🔔${n ? `<span class="badge" aria-hidden="true">${n > 99 ? "99+" : n}</span>` : ""}`;
    btn.setAttribute("aria-label", n ? `Notifications: ${n} new` : "Notifications");
  }
  const NOTIFY_TEXT = {
    tag: n => n.comment ? "tagged you in a comment" : n.message?.group ? `tagged you in ${safe(n.message.group.icon)} ${safe(n.message.group.name)}` : n.message ? "tagged you in a message" : "tagged you in a post",
    request: () => "sent you a friend request 💌",
    friend: () => "accepted your friend request 👯",
    follow: () => "followed you 👀",
    like: () => "liked your post 💗",
    comment: () => "commented on your post 💬",
    reply: () => "replied to your comment 💬",
    reaction: n => `reacted ${safe(n.emoji)} to your ${n.comment ? "comment" : "message"}`,
    assistant: () => "made you their assistant 🤝",
    // Only the creator gets these: someone reported something for "Something else", with their own words, and
    // someone's face scan didn't agree with the gender they picked.
    report: n => `reported a ${n.comment ? "comment" : "post"} 🚩`,
    gender: () => "is waiting for you to choose Boy or Girl for them 🚻"
  };
  // Opening the bell shows the newest notifications (new ones highlighted) and marks them all as seen.
  async function toggleBell() {
    if ($("#notifMenu")) return $("#notifMenu").remove();
    const d = await api("/api/notifications");
    state.notifications = d.notifications;
    const row = n => `<button class="notif ${n.read ? "" : "new"}" role="menuitem" data-notif="${n.id}">${avatarHTML(n.actor.avatar, "tiny")}<span><strong>${nameHTML(n.actor.username)}</strong> ${NOTIFY_TEXT[n.kind]?.(n) || ""}` +
      `${n.details || n.comment ? `<small class="notif-quote">“${safe(n.details || n.comment.preview)}”</small>` : ""}<small>${timeLabel(n.createdAt)}</small></span></button>`;
    $(".top-actions").insertAdjacentHTML("beforeend", `<div class="notif-menu" id="notifMenu" role="menu" aria-label="Notifications"><h2>🔔 Notifications</h2>` +
      (d.notifications.length ? d.notifications.map(row).join("") : `<p class="muted">Nothing yet. When someone tags you, follows you, sends or accepts a friend request, or likes or comments on your post, it shows up here.</p>`) + `</div>`);
    if (d.unread) await api("/api/notifications/read", { method: "POST" });
    state.unread = 0; bell();
  }
  // Tapping a notification opens what it's about: the post (with its comments), the chat, or the person's profile. A
  // report opens the Reports page, so the creator can deal with it.
  async function openNotification(n) {
    $("#notifMenu")?.remove();
    if (n.kind === "report") {
      if (pageGone("reports")) return toast(goneNote("reports"), true);
      history.replaceState(null, "", "/");
      Object.assign(state, { page: "reports", notice: "", groupView: null, chat: null });
      render(); await loadPageData(); render();
      return;
    }
    if (n.kind === "gender") {
      if (pageGone("safety")) return toast(goneNote("safety"), true);
      history.replaceState(null, "", "/");
      Object.assign(state, { page: "safety", notice: "", groupView: null, chat: null, safety: { tab: "genders", user: "" } });
      render(); await loadPageData(); render();
      return;
    }
    if (n.post) {
      if (n.comment) (state.comments ||= {})[n.post.id] = { open: true };
      if (n.post.groupKey) { await openGroup(n.post.groupKey, "posts"); if (n.comment) await loadComments(n.post.id); return; }
      history.replaceState(null, "", `/post/${n.post.code}`);
      Object.assign(state, { page: "post", postKey: n.post.code, single: null, notice: "", chat: null, groupView: null });
      render(); await loadPageData();
      if (n.comment && state.single?.post) await loadComments(n.post.id); else render();
      window.scrollTo(0, 0);
      return;
    }
    if (n.message?.friendId) return openChat(n.message.friendId);
    if (n.message) {
      const g = n.message.group;
      if (!g) return toast("That group doesn't exist any more.", true);
      return g.member ? openGroup(g.key, "chat") : openTagged(g.key, n.message.id);
    }
    await openPerson(n.actor.id);
  }
  // A group you're not in, where someone tagged you: you only see the messages you were tagged in. Every other message is
  // blurred (the server doesn't even send what they say or who sent them).
  const BLURRED = ["hello everyone how is it going", "lol yes", "did you see that", "omg that's so cute", "ok see you later", "wait what", "hahaha", "I love this group so much"];
  async function openTagged(key, focusId) {
    const d = await api(`/api/groups/${encodeURIComponent(key)}/tagged`);
    if (d.member) return openGroup(key, "chat");
    const g = d.group;
    const msg = m => m.hidden ? `<div class="msg" aria-hidden="true"><div class="msg-body"><div class="bubble blurred"><span class="b-text">${BLURRED[m.id % BLURRED.length]}</span></div></div></div>`
      : m.deleted ? `<div class="msg"><div class="msg-body"><div class="bubble deleted"><span class="b-text">🚫 This message was deleted</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`
      : `<div class="msg ${m.id === focusId ? "picked" : ""}" id="tagged${m.id}">${personLink(m.userId, m.username, avatarHTML(m.avatar, "tiny"))}<div class="msg-body"><div class="bubble"><strong>${nameHTML(m.username)}</strong><span class="b-text">${richText(m.body)}</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    const hidden = d.messages.filter(m => m.hidden).length;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal tagged-modal" role="dialog" aria-modal="true" aria-labelledby="taggedTitle"><div class="row between"><h2 id="taggedTitle">${safe(g.icon)} ${safe(g.name)}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p class="notice">👀 You're not in this group, so you can only see the messages you were tagged in.${hidden ? ` The other ${hidden === 1 ? "message is" : `${hidden} messages are`} blurred.` : ""}</p>` +
      `<div class="chat-log">${d.messages.map(msg).join("")}</div>` +
      (g.secret ? `<p class="muted-note">This is a secret group. The only way in is its code.</p>` : `<div class="actions"><button class="primary" data-join-group="${safe(g.key)}">Join the group to see everything</button></div>`) + `</section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $(`#tagged${focusId}`)?.scrollIntoView({ block: "center" });
  }
  // Tapping an @tag opens that person's profile (your own opens your Profile page).
  async function openTag(name) {
    if (!state.user) return toast("Sign in to see people's profiles.", true);
    if (name.toLowerCase() === state.user.username.toLowerCase()) return openPerson(state.user.id);
    const found = (await api(`/api/users?q=${encodeURIComponent(name)}`)).users.find(u => u.username.toLowerCase() === name.toLowerCase());
    if (!found) return toast(`Nobody on Yakimma is called @${name}.`, true);
    await openPerson(found.id);
  }
  function friendsBadge() {
    const requests = state.social.incoming.length, unread = state.social.friends.reduce((n, f) => n + (f.unread || 0), state.social.ai?.unread || 0);
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
    state.user = me.user; state.displayNames = me.displayNames || {}; state.unread = me.notifications || 0; state.products = me.products || []; state.inventory = me.inventory || []; state.posts = feed.posts || []; state.learnData = me.learn || null; state.reportReasons = me.reportReasons || []; state.usernameCost = me.usernameCost; state.songs = me.songs || [];
    if (me.religions) Object.assign(state, { religions: me.religions, countries: me.countries });
    state.googleSignIn = Boolean(me.googleSignIn);
    if (me.themes) state.themes = me.themes;
    if (me.nailOptions) state.nailOptions = me.nailOptions;
    if (me.avatarOptions) state.avatarOptions = me.avatarOptions;
    // A suspended account only sees the suspension screen (and the rules), so there's nothing else to load.
    if (state.user?.suspended) Object.assign(state, { social: { friends: [], incoming: [], outgoing: [] }, received: [] });
    else await loadSocial();
    wallet();
    if (state.user && !(state.user.religion && state.user.country)) identityModal();
  }
  const setGroups = d => { state.groups = d.groups; state.groupIcons = d.icons; };
  async function loadGroups() { setGroups(await api("/api/groups")); }
  async function loadCodes() { state.codes = state.user ? await api("/api/codes") : { redeemed: [], total: 0 }; }
  // Pass more=true to add the next page after the posts already shown.
  async function loadMyPosts(more = false) {
    const m = state.myPosts, order = m?.order || "newest", after = more ? m.posts.at(-1)?.id : 0;
    const d = await api(`/api/me/posts?order=${order}${after ? `&after=${after}` : ""}`);
    state.myPosts = { order, total: d.total, more: d.more, posts: more ? [...m.posts, ...d.posts] : d.posts };
  }
  async function loadPlaylist() { state.playlist = (await api("/api/me/playlist")).posts; }
  async function loadPageData() {
    if (state.user && ["friends", "nails", "profile"].includes(state.page)) await loadSocial();
    if (state.user && state.page === "profile") await Promise.all([loadMyPosts(), loadPlaylist()]);
    if (state.page === "groups") await loadGroups();
    if (state.page === "codes") await loadCodes();
    if (state.user && state.page === "pictures") state.pictures = await api("/api/pictures");
    if (state.user?.admin && state.page === "reports") state.reports = await api("/api/reports");
    if (state.user?.creator && state.page === "safety") await loadSafety();
    if (state.page === "post") state.single = await api(`/api/posts/${encodeURIComponent(state.postKey)}`).then(d => ({ post: d.post }), err => ({ error: err.message }));
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
  const newDesign = () => ({ shape:"round", length:"medium", nails: FINGERS.map(() => ({ color:"#ff8fc0", finish:"glossy", arts:[] })) });

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
  // A sticker drawn around (0, 0); nailArt moves, turns and sizes it into its place on the nail.
  function artSticker(id, a, hw) {
    if (id === "heart") { const k = hw * 0.5; return `<path d="M0 ${k*0.9}C${-k*1.6} ${-k*0.2} ${-k*0.6} ${-k*1.3} 0 ${-k*0.45}C${k*0.6} ${-k*1.3} ${k*1.6} ${-k*0.2} 0 ${k*0.9}Z" fill="${a}"/>`; }
    if (id === "star") {
      const R = hw * 0.62, r = R * 0.45;
      const pts = Array.from({ length:10 }, (_, i) => { const ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R; return `${Math.cos(ang)*rad},${Math.sin(ang)*rad}`; });
      return `<polygon points="${pts.join(" ")}" fill="${a}"/>`;
    }
    if (id === "flower") {
      const d = hw * 0.32, pr = hw * 0.24;
      return Array.from({ length:5 }, (_, i) => { const ang = -Math.PI / 2 + i * 2 * Math.PI / 5; return `<circle cx="${Math.cos(ang)*d}" cy="${Math.sin(ang)*d}" r="${pr}" fill="${a}"/>`; }).join("") + `<circle cx="0" cy="0" r="${pr*0.8}" fill="#ffe27a"/>`;
    }
    if (id === "gingercat") {
      const r = hw * 0.68, y = r * 0.25, fur = "#f28c28", line = "#8a4a14";
      const ear = k => `<path d="M${k*r*0.95} ${y-r*0.2}L${k*r*0.78} ${y-r*1.25}L${k*r*0.12} ${y-r*0.78}Z" fill="${fur}" stroke="${line}" stroke-width=".8" stroke-linejoin="round"/><path d="M${k*r*0.74} ${y-r*0.45}L${k*r*0.7} ${y-r*0.98}L${k*r*0.36} ${y-r*0.72}Z" fill="#ffb3c7"/>`;
      const eye = k => `<circle cx="${k*r*0.38}" cy="${y-r*0.05}" r="${r*0.14}" fill="#2b1a10"/><circle cx="${k*r*0.38+r*0.05}" cy="${y-r*0.1}" r="${r*0.05}" fill="#fff"/>`;
      return ear(-1) + ear(1) + `<ellipse cx="0" cy="${y}" rx="${r}" ry="${r*0.88}" fill="${fur}" stroke="${line}" stroke-width=".8"/>` +
        `<path d="M0 ${y-r*0.84}V${y-r*0.5}M${-r*0.3} ${y-r*0.78}L${-r*0.22} ${y-r*0.5}M${r*0.3} ${y-r*0.78}L${r*0.22} ${y-r*0.5}" stroke="#b5561a" stroke-width="${r*0.12}" stroke-linecap="round"/>` +
        `<ellipse cx="0" cy="${y+r*0.38}" rx="${r*0.5}" ry="${r*0.34}" fill="#fff4e6"/>${eye(-1)}${eye(1)}` +
        `<path d="M${-r*0.13} ${y+r*0.18}H${r*0.13}L0 ${y+r*0.33}Z" fill="#ff7f9e"/>` +
        `<path d="M${-r*0.35} ${y+r*0.35}H${-r*1.05}M${-r*0.35} ${y+r*0.48}L${-r*1}  ${y+r*0.62}M${r*0.35} ${y+r*0.35}H${r*1.05}M${r*0.35} ${y+r*0.48}L${r} ${y+r*0.62}" stroke="${line}" stroke-width=".6" stroke-linecap="round"/>`;
    }
    return "";
  }
  // Art goes on in layers: ombré, French tip and dots first, then stickers, then the gem by the cuticle.
  const ART_UNDER = ["ombre", "french", "dots"];
  const isSticker = id => !ART_UNDER.includes(id) && id !== "gem";
  const ART_HOME_FRENCH = 0.15;
  // Where each piece of art sits, in nail units: x from -1 (left edge) to 1 (right edge), y from 0 (tip) to 1 (cuticle),
  // size (1 = normal) and turn (degrees). A piece you've moved keeps its own spot. The rest sit at home: the French tip's
  // line is near the tip, the gem is by the cuticle, and stickers share the space between them (or the whole nail),
  // shrinking to fit.
  function artPlaces(arts, g) {
    const { hw, c, t } = g, h = c - t, auto = arts.filter(a => isSticker(a.id) && a.y === undefined), gemY = 1 - hw * 0.95 / h;
    const atHome = id => arts.some(a => a.id === id && a.y === undefined);
    const top = atHome("french") ? ART_HOME_FRENCH + hw * 0.3 / h : 0, bottom = atHome("gem") ? gemY - hw * 0.42 / h : 1;
    const slot = (bottom - top) / auto.length, k = Math.min(1, Math.max(0.3, slot * h / (1.5 * hw)));
    const home = a => a.id === "french" ? ART_HOME_FRENCH : a.id === "gem" ? gemY : isSticker(a.id) ? top + slot * (auto.indexOf(a) + 0.5) : 0.5;
    return arts.map(a => a.y !== undefined ? { x: a.x, y: a.y, size: a.size, turn: a.turn } : { x: 0, y: home(a), size: isSticker(a.id) ? k : 1, turn: 0 });
  }
  // One piece drawn around its own spot (0, 0). The ombré and French tip reach far past the nail so they still cover it when moved or turned.
  function artShape(a, g, gid) {
    const { hw, c, t } = g, h = c - t, col = hexOr(a.color, "#ffffff"), far = 4 * h;
    if (a.id === "ombre") return `<rect x="${-far}" y="${-far}" width="${2*far}" height="${far+h*0.35+1.4}" fill="url(#${gid}o)"/>`;
    // Everything above a thin smile line: the line's middle is at the spot and its sides dip a little towards the cuticle.
    if (a.id === "french") { const dip = hw * 0.3; return `<path d="M${-far} ${dip}H${-hw-2}Q0 ${-dip} ${hw+2} ${dip}H${far}V${-far}H${-far}Z" fill="${col}"/>`; }
    if (a.id === "dots") return [[-.4,-.35],[.38,-.05],[-.15,.32]].map(([dx, dy]) => `<circle cx="${dx*hw}" cy="${dy*h*0.6}" r="${hw*0.17}" fill="${col}"/>`).join("");
    if (a.id === "gem") { const s = hw * 0.42; return `<path d="M0 ${-s}L${s*0.8} 0L0 ${s}L${-s*0.8} 0Z" fill="${col}" stroke="#fff" stroke-width="1.2"/><path d="M0 ${-s}L${s*0.8} 0L0 0Z" fill="#fff" opacity=".55"/>`; }
    return artSticker(a.id, col, hw);
  }
  function nailArt(n, g, gid) {
    const { hw, c, t } = g, arts = n.arts || [], places = artPlaces(arts, g), byId = id => arts.filter(a => a.id === id);
    const layers = [...ART_UNDER.flatMap(byId), ...arts.filter(a => isSticker(a.id)), ...byId("gem")];
    return layers.map(a => { const p = places[arts.indexOf(a)]; return `<g transform="translate(${p.x*hw} ${t+p.y*(c-t)}) rotate(${p.turn}) scale(${p.size})">${artShape(a, g, gid)}</g>`; }).join("");
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
    const col = hexOr(n.color, "#ff8fc0"), ombreArt = n.arts?.find(x => x.id === "ombre"), ombreCol = hexOr(ombreArt?.color, "#ffffff");
    const chrome = n.finish === "chrome" ? `<linearGradient id="${gid}c" x1="0" x2="1"><stop offset="0" stop-color="${mix(col,"#ffffff",.55)}"/><stop offset=".4" stop-color="${col}"/><stop offset=".7" stop-color="${mix(col,"#000000",.3)}"/><stop offset="1" stop-color="${mix(col,"#ffffff",.35)}"/></linearGradient>` : "";
    const h = g.c - g.t, ombre = ombreArt ? `<linearGradient id="${gid}o" gradientUnits="userSpaceOnUse" x1="0" y1="${-h/2-2}" x2="0" y2="${h*0.35+1.4}"><stop offset="0" stop-color="${ombreCol}"/><stop offset="1" stop-color="${ombreCol}" stop-opacity="0"/></linearGradient>` : "";
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
    const svg = `<svg class="hand${design ? " painted" : ""}" viewBox="-25 30 410 440" role="img" aria-label="${safe(label)}">` +
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
    const c = state.chat, mine = m.userId === state.user?.id, picked = c.selected === m.id, face = mine ? "" : personLink(m.userId, m.username, avatarHTML(m.avatar, "tiny"));
    if (m.deleted) return `<div class="msg ${mine ? "mine" : ""}">${face}<div class="msg-body"><div class="bubble deleted"><span class="b-text">🚫 This message was deleted</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    // AI's messages can only be read, so they have no actions to tap for.
    if (c.readOnly) return `<div class="msg">${face}<div class="msg-body"><div class="bubble"><span class="b-text">${safe(m.body)}</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    const name = c.names && !mine ? `<strong>${nameHTML(m.username)}</strong>` : "";
    const reactions = m.reactions.length ? `<div class="reactions">${m.reactions.map(r => `<button class="reaction ${r.mine ? "on" : ""}" data-react="${safe(r.emoji)}" data-msg="${m.id}" title="${safe(r.users.join(", "))}" aria-pressed="${r.mine}"><span class="emoji">${safe(r.emoji)}</span>${r.count}</button>`).join("")}</div>` : "";
    return `<div class="msg ${mine ? "mine" : ""} ${picked ? "picked" : ""}">${face}<div class="msg-body">` +
      `<button class="bubble" data-pick-msg="${m.id}" aria-expanded="${picked}">${name}${m.forwarded ? `<span class="fwd">↪️ Forwarded</span>` : ""}<span class="b-text">${richText(m.body, true)}</span><small>${timeLabel(m.createdAt)}${m.editedAt ? " · edited" : ""}</small></button>` +
      reactions + (picked ? messageTools(m, mine) : "") + `</div></div>`;
  }
  function messageTools(m, mine) {
    const canDelete = mine || state.chat.moderator;
    return `<div class="msg-tools" role="toolbar" aria-label="Message actions"><div class="quick">${QUICK_REACTIONS.map(e => `<button class="emoji-btn" data-react="${e}" data-msg="${m.id}" aria-label="React with ${e}">${e}</button>`).join("")}<button class="emoji-btn more" data-react-more="${m.id}" aria-label="All emojis" title="All emojis">＋</button></div>` +
      `<div class="tool-row"><button class="soft" data-forward-msg="${m.id}">↪️ Forward</button>${mine && !m.forwarded ? `<button class="soft" data-edit-msg="${m.id}">✏️ Edit</button>` : ""}${canDelete ? `<button class="soft" data-delete-msg="${m.id}">🗑️ Delete</button>` : ""}${mine || isCreatorName(m.username) ? "" : `<button class="soft" data-block="${m.userId}" data-name="${safe(m.username)}">🚫 Block</button>`}</div></div>`;
  }
  // A chat can bring its own empty message (group chats do); friend chats use this one.
  const emptyChat = "No messages yet. Say hi! 👋";
  const logHTML = () => state.chat.messages.length ? state.chat.messages.map(messageHTML).join("") : `<p class="muted chat-empty">${state.chat.empty || emptyChat}</p>`;
  // What an empty group chat or post list says. Special groups put their intro on top.
  const groupEmpty = (g, line) => (g.intro ? `<strong>${safe(g.intro)}</strong><br>` : "") + line;
  function chatBox(placeholder) {
    const c = state.chat, editing = c.editing && c.messages.some(m => m.id === c.editing && !m.deleted);
    if (c.readOnly) return `<div class="chat-log" id="chatLog">${logHTML()}</div><p class="muted-note">AI sends you tips here. You can't reply to AI yet.</p>`;
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
    state.chat = { url: `${url}/messages`, ...d.chat, draft: "", names: true, moderator: d.group.ownerId === state.user?.id, selected: null, editing: null, empty: groupEmpty(d.group, "Type something to start the chat!") };
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
  async function openAIChat() {
    const url = "/api/ai/messages", d = await api(url);
    state.page = "friends"; state.notice = ""; state.groupView = null;
    state.chat = { url, ai: true, readOnly: true, ...d, names: false, moderator: false, selected: null, editing: null, empty: "No messages from AI yet. 🤖" };
    if (state.social.ai) state.social.ai.unread = 0;
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
    const c = state.chat, groups = kidOn() ? [] : (await api("/api/groups")).groups.filter(g => g.joined), friends = state.social.friends;
    const target = (attr, id, face, name) => `<button type="button" class="fwd-target" data-${attr}="${safe(id)}" data-name="${safe(name)}">${face}<span>${safe(name)}</span></button>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal fwd-modal" role="dialog" aria-modal="true" aria-labelledby="fwdTitle"><div class="row between"><h2 id="fwdTitle">↪️ Forward to…</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<h3>Friends</h3>${friends.length ? `<div class="fwd-list">${friends.map(f => target("fwd-friend", f.id, avatarHTML(f.avatar, "tiny"), f.username)).join("")}</div>` : `<p class="muted">No friends yet.</p>`}` +
      // Groups aren't in the kiddy zone.
      (kidOn() ? "" : `<h3>Groups</h3>${groups.length ? `<div class="fwd-list">${groups.map(g => target("fwd-group", g.id, `<span class="avatar tiny" aria-hidden="true">${safe(g.icon)}</span>`, g.name)).join("")}</div>` : `<p class="muted">You're not in any groups yet.</p>`}`) + `</section></div>`;
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
  async function openMembers(key) {
    const d = await api(`/api/groups/${encodeURIComponent(key)}/members`), me = state.user?.id;
    const tag = m => (m.owner ? ` <span class="pill">👑 Owner</span>` : "") + (m.id === me ? ` <span class="pill">You</span>` : "");
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal members-modal" role="dialog" aria-modal="true" aria-labelledby="membersTitle"><div class="row between"><h2 id="membersTitle">${safe(d.icon)} ${safe(d.name)} members (${d.members.length})</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      (d.members.length ? `<label class="sr-only" for="memberSearch">Search members</label><input id="memberSearch" type="search" placeholder="🔎 Search members" autocomplete="off">` +
        `<div class="member-list">${d.members.map(m => `<div class="member" data-search="${safe(`${m.username} ${nameText(m.username)}`.toLowerCase())}">${personLink(m.id, m.username, `${avatarHTML(m.avatar)}<strong>${nameHTML(m.username)}</strong>`)}${tag(m)}</div>`).join("")}</div><p class="muted" id="noMemberMatch" hidden>No members match that search.</p>`
        : `<p class="muted">No one has joined yet.</p>`) + `</section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    if (!d.members.length) return;
    $("#memberSearch").oninput = e => {
      const q = e.target.value.trim().toLowerCase(); let shown = 0;
      document.querySelectorAll(".member").forEach(m => { m.hidden = !m.dataset.search.includes(q); shown += !m.hidden; });
      $("#noMemberMatch").hidden = shown > 0;
    };
    // Typing a search straight away suits a keyboard; on phones it would pop the keyboard up over the list.
    if (matchMedia("(hover: hover)").matches) $("#memberSearch").focus();
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
      const { unread } = await api("/api/notifications/unread");
      if (unread !== state.unread) { state.unread = unread; bell(); }
      const before = JSON.stringify(state.social);
      state.social = await api("/api/friends");
      if (JSON.stringify(state.social) === before) return;
      friendsBadge();
      // Refresh the friends list too, unless someone is typing on it.
      if (state.page === "friends" && !state.chat && !document.activeElement?.matches("input,textarea")) render();
    } catch {}
  }, 3000);

  // ---- Friends + Nail Salon pages ----
  // Tapping someone's picture or name opens their profile, except for people you've blocked (pass link: false).
  function personRow(person, sub, actions, link = true) {
    const who = `${avatarHTML(person.avatar)}<span><strong>${nameHTML(person.username)}</strong><small>${sub}</small></span>`;
    return `<div class="person"><div class="person-main">${link ? personLink(person.userId ?? person.id, person.username, who) : who}</div><div class="row">${actions}</div></div>`;
  }
  // Someone in a list, with their followers and who they follow (tap either to see them) and a link to their profile.
  const personCard = u => personRow(u, "", `${followPills(u.id, u.followers, u.following, u.username)}<button class="primary" data-view-person="${u.id}">👤 See profile</button>`);
  // Everyone on Yakimma, whatever zone they're in, on the Friends page. More load as you scroll to the end of the list,
  // until every account has been seen.
  const peopleEnd = () => state.people?.next === null
    ? `<p id="peopleEnd" class="muted">${state.people.users.length ? "That's everyone on Yakimma! 🎉" : "Nobody else is here yet."}</p>`
    : `<p id="peopleEnd" class="muted">Loading more people…</p>`;
  const peopleWatcher = new IntersectionObserver(seen => { if (seen.some(e => e.isIntersecting)) loadPeople(); }, { rootMargin: "300px" });
  function watchPeople() {
    peopleWatcher.disconnect();
    if ($("#peopleEnd") && state.people?.next !== null) peopleWatcher.observe($("#peopleEnd"));
  }
  // New people are added to the list as it is, so nothing typed in the search box is lost.
  async function loadPeople() {
    const p = state.people ||= { users: [], next: 0 };
    if (p.loading || p.next === null) return;
    p.loading = true;
    try {
      const d = await api(`/api/people?after=${p.next}`);
      p.users.push(...d.users); p.next = d.next;
      $("#peopleList")?.insertAdjacentHTML("beforeend", d.users.map(personCard).join(""));
      if ($("#peopleEnd")) $("#peopleEnd").outerHTML = peopleEnd();
    } catch (err) { toast(err.message, true); }
    finally { p.loading = false; watchPeople(); }
  }
  // Someone else's profile, opened from a search on the Friends page: send them a friend request or follow them.
  // One post on its own, opened from its link (/post/<code>).
  function postPage() {
    const top = hero("A post 🔗", "A post someone shared.", "POST"), s = state.single;
    if (!s) return top + `<section class="panel empty">Loading…</section>`;
    return top + `<section class="panel"><button class="soft" data-page="feed">← Feed</button></section>` + (s.post ? postCard(s.post) : `<section class="panel empty">${safe(s.error)}</section>`);
  }
  // Opened by tapping someone's picture or name anywhere. Your own opens your Profile page.
  async function openPerson(id) {
    if (id === state.user.id) {
      closeModal(); Object.assign(state, { page: "profile", notice: "", chat: null, groupView: null }); render(); await loadPageData(); render(); window.scrollTo(0, 0);
      return;
    }
    state.person = await api(`/api/users/${id}`);
    closeModal(); Object.assign(state, { page: "person", personTab: "all", notice: "", chat: null, groupView: null }); render(); window.scrollTo(0, 0);
  }
  // Who follows someone ("followers") or who they follow ("following"), yourself included, in a pop-up.
  async function followList(userId, list, name) {
    const d = await api(`/api/users/${userId}/${list}`), mine = userId === state.user.id;
    const row = u => u.id === state.user.id ? personRow(u, "", `<span class="pill">That's you</span>`) : personCard(u);
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="followTitle"><div class="row between"><h2 id="followTitle">${list === "followers" ? `👀 ${mine ? "Your" : `${safe(name)}'s`} followers` : `➡️ Who ${mine ? "you follow" : `${safe(name)} follows`}`}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      (d.users.map(row).join("") || `<p class="muted">${list === "followers" ? "No followers yet." : "Not following anyone yet."}</p>`) +
      (d.hidden ? `<p class="muted-note">And ${d.hidden} more you can't see.</p>` : "") + `</section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
  }
  const followPills = (userId, followers, following, name) => `<button class="pill pill-btn" data-follow-list="followers" data-user="${userId}" data-name="${safe(name)}" title="${followers} follower${followers === 1 ? "" : "s"}">👀 ${followers}<span class="thing-label"> follower${followers === 1 ? "" : "s"}</span></button>` +
    `<button class="pill pill-btn" data-follow-list="following" data-user="${userId}" data-name="${safe(name)}" title="${following} following">➡️ ${following}<span class="thing-label"> following</span></button>`;
  // 🤝 Who someone's assistant is, and whose assistant they are, for their profile.
  function assistantLines(info, mine) {
    const who = list => list.map(u => personLink(u.id, u.username, `${avatarHTML(u.avatar, "tiny")}<strong>${nameHTML(u.username)}</strong>`)).join("");
    return `<div class="assistant-lines">` +
      (info.assistant ? `<p>🤝 ${mine ? "My assistant" : "Assistant"}: ${who([info.assistant])}${mine ? `<button class="link-btn" data-assistant-remove="1">Remove</button>` : ""}</p>`
        : mine ? `<p class="muted-note">${kidOn() ? "🤝 Assistants aren't in the kiddy zone." : "🤝 No assistant yet. Open the profile of a friend you trust and tap 🤝 Make my assistant."}</p>` : "") +
      (info.assistantOf?.length ? `<p>🤝 Assistant to: ${who(info.assistantOf)}</p>` : "") + `</div>`;
  }
  function personPage() {
    const p = state.person, u = p.user, plural = (n, word) => `${word}${n === 1 ? "" : "s"}`;
    // One of their things: its emoji, number and name. On a smaller window only the emoji and number show (see .thing-label).
    const thing = (icon, n, label) => `<span class="pill" title="${n} ${label}">${icon} ${n}<span class="thing-label"> ${label}</span></span>`;
    const friend = {
      friends: `<button class="soft" disabled>👯 Friends ✓</button>`,
      sent: `<button class="soft" disabled>💌 Friend request sent</button>`,
      received: `<button class="primary" data-accept-person="${p.requestId}">💌 Accept Friend Request</button><button class="soft" data-decline-person="${p.requestId}">Decline</button>`,
      none: `<button class="primary" data-friend-person="${safe(u.username)}">💌 Send Friend Request</button>`
    }[p.friend];
    const follow = p.youFollow ? `<button class="soft" data-unfollow="${u.id}">✓ Following</button>` : `<button class="primary" data-follow="${u.id}">➕ Follow</button>`;
    // Someone in another zone shows up, but you can't add or follow them (you can still unfollow them).
    // A friend you trust can be your assistant, but not in the kiddy zone or across the zone rules (you can still take
    // them off). Friends can also get a nickname that only you see.
    const isFriend = p.friend === "friends";
    const helper = state.user.assistant?.id === u.id ? `<button class="soft" data-assistant-remove="1">🤝 Your assistant ✓</button>`
      : isFriend && !kidOn() && !p.zoneNote ? `<button class="soft" data-assistant="${u.id}">🤝 Make my assistant</button>` : "";
    const nickname = isFriend ? `<button class="soft" data-nickname="${u.id}" data-name="${safe(u.username)}">🏷️ Nickname</button>` : "";
    const suspend = !state.user.creator || isCreatorName(u.username) ? ""
      : p.suspended ? `<button class="soft" data-unsuspend="${u.id}" data-name="${safe(u.username)}">Lift the suspension</button>` : `<button class="soft" data-suspend="${u.id}" data-name="${safe(u.username)}">⛔ Suspend</button>`;
    const actions = (p.zoneNote ? `${p.friend === "none" ? "" : friend}${p.youFollow ? follow : ""}` : friend + follow) + helper + nickname + suspend;
    // Like a YouTube channel: everything, just their videos, or just their photo and text posts.
    const isVideo = x => x.mediaType?.startsWith("video/"), tab = state.personTab || "all";
    const lists = { all: p.posts, videos: p.posts.filter(isVideo), posts: p.posts.filter(x => !isVideo(x)) }, shown = lists[tab];
    const tabs = [["all", "All"], ["videos", "🎬 Videos"], ["posts", "📝 Posts"]].map(([id, label]) => `<button class="step ${tab === id ? "on" : ""}" data-person-tab="${id}" aria-pressed="${tab === id}">${label} (${lists[id].length})</button>`).join("");
    return hero(`${safe(nameText(u.username))} 👤`, `See ${safe(nameText(u.username))}'s wallet, items and posts, send a friend request, or follow them.`, "PROFILE") +
      `<section class="panel"><button class="soft" data-page="friends">← Friends</button><div class="posthead" style="margin-top:12px"><button class="avatar-edit" data-view-avatar="person" aria-label="See ${safe(nameText(u.username))}'s profile picture">${avatarHTML(u.avatar, "big")}</button><div><h2 style="margin:0">${nameHTML(u.username)}</h2>` +
      `<small>🔢 Account number ${u.accountNumber}${p.followsYou ? " · Follows you" : ""}</small></div></div>` +
      `<div class="row person-things">${thing("🐱", p.mc, "MC")}${thing("💌", p.lc, "LC")}${thing("🎁", p.items, plural(p.items, "item"))}${thing("👯", p.friends, plural(p.friends, "friend"))}${identityPills(u)}` +
      `${followPills(u.id, p.followers, p.following, u.username)}</div>${p.suspended ? `<p class="notice error">⛔ Suspended until ${safe(untilText(p.suspended))}${p.suspended.reason ? `: ${safe(p.suspended.reason)}` : ""}</p>` : ""}${assistantLines(p, false)}${actions ? `<div class="actions">${actions}</div>` : ""}${p.zoneNote ? `<p class="muted-note">${safe(p.zoneNote)}</p>` : ""}</section>` +
      `<section class="panel"><h3>${safe(nameText(u.username))}'s posts (${p.posts.length})</h3><div class="tabs" role="group" aria-label="Which posts">${tabs}</div>${shown.length ? "" : `<p class="muted">${tab === "videos" ? "No videos to see yet." : "No posts to see yet."}</p>`}</section><div class="feed">${shown.map(postCard).join("")}</div>`;
  }
  function friendsPage() {
    const top = hero("Friends 👯", "Search for people by their username or display name to see their profile, then send them a friend request or follow them. Friends can do each other's nails in the Nail Salon.", "YOUR PEOPLE");
    if (!state.user) return top + signInPanel("Sign in to add friends.");
    const { friends, incoming, outgoing, blocked = [] } = state.social;
    const block = p => isCreatorName(p.username) ? "" : `<button class="soft" data-block="${p.userId ?? p.id}" data-name="${safe(p.username)}">🚫 Block</button>`;
    const ai = state.social.ai;
    if (state.chat?.ai && ai) return hero("AI assistant 🤖", "Yakimma's AI sends you tips here, like how to get what you need in the Shop.", "AI ASSISTANT") +
      `<section class="panel"><div class="row chat-head"><button class="soft" data-page="friends">← Friends</button>${avatarHTML(ai.avatar)}<strong>${safe(ai.username)}</strong></div>${chatBox()}</section>`;
    const chatting = state.chat?.friendId && friends.find(f => f.id === state.chat.friendId);
    if (chatting) return hero(`Chat with ${safe(nameText(chatting.username))} 💬`, "Only you and your friend can see this chat, and the creator, who keeps Yakimma safe.", "FRIEND CHAT") +
      `<section class="panel"><div class="row chat-head"><button class="soft" data-page="friends">← Friends</button>${personLink(chatting.id, chatting.username, `${avatarHTML(chatting.avatar)}<strong>${nameHTML(chatting.username)}</strong>`)}</div>${chatBox(`Message ${nameText(chatting.username)}`)}</section>`;
    return top +
      `<section class="panel"><h2>Find people 🔎</h2><form id="friendForm" class="row nowrap"><label class="sr-only" for="friendName">Their username or display name</label><input id="friendName" maxlength="30" placeholder="Their username or display name" autocomplete="off" required value="${safe(state.friendSearch?.q || "")}"><button class="primary" type="submit">Search</button></form>` +
        (state.friendSearch ? (state.friendSearch.users.map(personCard).join("") || `<p class="muted">Nobody has a username or display name like "${safe(state.friendSearch.q)}".</p>`)
          : `<p class="muted-note">Open someone's profile to send them a friend request or follow them.</p>`) + `</section>` +
      `<section class="panel"><h2>👥 Everyone on Yakimma</h2><p class="muted-note">Scroll down to see more people.</p><div id="peopleList">${(state.people?.users || []).map(personCard).join("")}</div>${peopleEnd()}</section>` +
      (incoming.length ? `<section class="panel"><h2>Friend requests 💌</h2>${incoming.map(r => personRow(r, "wants to be your friend", `<button class="primary" data-accept="${r.requestId}">Accept</button><button class="soft" data-reject="${r.requestId}">Decline</button>${block(r)}`)).join("")}</section>` : "") +
      (ai ? `<section class="panel"><h2>AI assistant</h2>${personRow(ai, "Your Yakimma helper. AI messages you tips, like what you need to buy something in the Shop.", `<button class="primary" id="aiChat">💬 Chat${ai.unread ? ` <span class="badge" aria-label="${ai.unread} unread">${ai.unread}</span>` : ""}</button>`)}</section>` : "") +
      `<section class="panel"><h2>My friends (${friends.length})</h2>${friends.length ? friends.map(f => personRow(f, `<span class="tone-dot" style="background:${toneHex(f.handTone)}"></span> ${safe(toneName(f.handTone))} hand`, (f.canTalk === false ? `<button class="soft" disabled title="${zoneOn() ? "In the 18+ zone you can only talk to people who are 18+" : "They're in the 18+ zone right now"}">🔞 Can't chat</button>` : `<button class="primary" data-chat="${f.id}">💬 Chat${f.unread ? ` <span class="badge" aria-label="${f.unread} unread">${f.unread}</span>` : ""}</button>`) + (zoneOn() || f.canTalk === false ? "" : `<button class="soft" data-salon="${f.id}">💅 Do their nails</button>`) + `<button class="soft" data-unfriend="${f.id}" data-name="${safe(f.username)}">Remove</button>${block(f)}`)).join("") : `<p class="muted">No friends yet. Send a request above! 🌸</p>`}</section>` +
      (outgoing.length ? `<section class="panel"><h2>Sent requests</h2>${outgoing.map(r => personRow(r, "waiting for them to accept…", `<button class="soft" data-reject="${r.requestId}">Cancel</button>`)).join("")}</section>` : "") +
      (blocked.length ? `<section class="panel"><h2>Blocked (${blocked.length})</h2>${blocked.map(p => personRow(p, "blocked", `<button class="soft" data-unblock="${p.id}" data-name="${safe(p.username)}">Unblock</button>`, false)).join("")}<p class="muted-note">People you block can't send you friend requests, and you won't see their messages or posts.</p></section>` : "");
  }
  function receivedGallery(limit) {
    if (!state.received.length) return `<p class="muted">No nail sets yet. Do your own nails, or when a friend does them, they show up here. 💌</p>`;
    const by = r => r.artistId === state.user.id ? "you" : r.artist;
    return `<div class="gallery">${state.received.slice(0, limit).map(r => `<figure class="look">${handSVG(toneHex(state.user.handTone), r.design, { label:`Nails by ${by(r)}` })}<figcaption><strong>by ${safe(by(r))}</strong><small>${safe(r.createdAt)}</small></figcaption></figure>`).join("")}</div>`;
  }
  // Whose nails you're doing: one of your friends, or you.
  function salonClient() {
    const id = state.salon?.friendId;
    if (state.user && id === state.user.id) return { id, username: state.user.username, handTone: state.user.handTone, self: true };
    return state.social.friends.find(f => f.id === id);
  }
  function nailsPage() {
    if (zoneOn()) return kuchisakePage();
    const top = hero("Yakimma Nail Salon 💅", "Pick your hand, then give yourself or a friend a fresh set.", "NAIL SALON");
    if (!state.user) return top + signInPanel("Sign in to visit the Nail Salon.");
    if (!state.inventory.includes("nails")) {
      const p = state.products.find(x => x.id === "nails") || { price: 1, currency: "LC" };
      const have = p.currency === "LC" ? state.user.lc : state.user.mc;
      return top + `<section class="panel locked"><div class="lock-icon" aria-hidden="true">🔒</div><h2>The Nail Salon is locked</h2><p>Unlock it in the Shop for <strong>${priceLabel(p)}</strong>. You have ${have} ${p.currency}.</p>${have < p.price ? `<p class="muted-note">${p.currency === "LC" ? "Win LoveCards on the Codes page, or swap 1,000 MC for 1 LC in the Shop." : "Earn MC by posting: every new person's first like on your post gives you 10 MC."}</p>` : ""}<button class="primary" data-page="shop">Go to the Shop</button></section>`;
    }
    const client = state.salon && salonClient();
    if (client) return salonView(client);
    const myTone = state.user.handTone, latest = state.received[0];
    const clientCard = (id, tone, name, sub) => `<button class="client" data-salon="${id}"><span class="tone-dot big" style="background:${toneHex(tone)}"></span><strong>${name}</strong><small>${sub}</small></button>`;
    return top +
      `<section class="panel"><h2>Your hand 🖐️</h2><div class="hand-row"><div class="hand-box">${handSVG(toneHex(myTone), latest?.design, { label:"Your hand" })}</div><div><p>Choose the skin tone that matches you. Friends will see your hand in this tone when they do your nails.</p><div class="tones">${state.nailOptions.skinTones.map(t => `<button class="tone ${t.id===myTone?"on":""}" data-tone="${t.id}" style="--tone:${t.hex}" aria-pressed="${t.id===myTone}"><span></span>${safe(t.name)}</button>`).join("")}</div>${latest ? `<p class="muted-note">${latest.artistId === state.user.id ? "You're wearing the set you made yourself." : `You're wearing the set ${safe(latest.artist)} made for you.`}</p>` : ""}</div></div></section>` +
      `<section class="panel"><h2>Choose a client</h2><p class="muted-note">Do your own nails, or pick a friend to sit at your nail table.</p><div class="clients">${clientCard(state.user.id, myTone, "You", "Do your own nails")}${state.social.friends.map(f => clientCard(f.id, f.handTone, safe(f.username), "Start a manicure")).join("")}</div>` +
      (state.social.friends.length ? "" : `<p class="muted-note">Want to do a friend's nails? Each friend needs their own Yakimma account.</p><button class="soft" data-page="friends">Find friends</button>`) + `</section>` +
      `<section class="panel"><h2>Your nail sets</h2>${receivedGallery(12)}</section>`;
  }
  function salonHand() {
    const s = state.salon, client = salonClient();
    return handSVG(toneHex(client?.handTone), s.design, { selected: s.applyAll ? -1 : s.selected, interactive: true, label: client?.self ? "Your hand" : `${client?.username || "Friend"}'s hand` });
  }
  function salonView(client) {
    const s = state.salon, o = state.nailOptions, d = s.design, cur = d.nails[s.selected];
    const chip = (attr, value, label, on) => `<button class="chip ${on?"on":""}" data-${attr}="${value}" aria-pressed="${on}">${label}</button>`;
    const steps = [["shape","1 · Shape"],["polish","2 · Polish"],["finish","3 · Finish"],["art","4 · Nail art"]];
    let tools;
    if (s.step === "shape") tools = `<h3>Nail shape</h3><div class="chips">${o.shapes.map(x => chip("shape", x.id, safe(x.name), d.shape === x.id)).join("")}</div><h3>Length</h3><div class="chips">${o.lengths.map(x => chip("length", x.id, safe(x.name), d.length === x.id)).join("")}</div><p class="muted-note">Shape and length go on the whole hand, just like at a real salon.</p>`;
    else if (s.step === "polish") tools = `<h3>Polish wall</h3><div class="polishes">${o.polishes.map(p => `<button class="bottle ${cur.color===p.hex?"on":""}" data-polish="${p.hex}" aria-pressed="${cur.color===p.hex}"><span style="--c:${p.hex}"></span><small>${safe(p.name)}</small></button>`).join("")}</div><h3>Colour wheel</h3>${colourWheel("polish")}`;
    else if (s.step === "finish") tools = `<h3>Top coat</h3><div class="chips">${o.finishes.map(x => chip("finish", x.id, `${x.icon} ${safe(x.name)}`, cur.finish === x.id)).join("")}</div>`;
    else {
      const picked = pickedArt(), shown = artColour(), artLabel = x => `${x.icon} ${safe(x.name)}`;
      const at = artPlaces(cur.arts, nailGeom(FINGERS[s.selected], d.length))[cur.arts.findIndex(a => a.id === picked)];
      const slider = (id, name, min, max, value) => `<label>${name}<input type="range" id="${id}" min="${min}" max="${max}" value="${Math.round(value)}"></label>`;
      tools = `<h3>Nail art</h3><p class="muted-note">Put on as many as you like. Tap one again to take it off.</p><div class="chips">${o.arts.map(x => x.item && !state.inventory.includes(x.item)
        ? `<button class="chip" disabled title="Find the secret code to unlock this sticker">🔒 ${safe(x.name)}</button>`
        : chip("art", x.id, artLabel(x), x.id === "none" ? !cur.arts.length : cur.arts.some(a => a.id === x.id))).join("")}</div>` +
        (at ? `<h3>Move, size and turn</h3><div class="chips art-pick"><span class="muted-note">Working on:</span>${cur.arts.map(a => o.arts.find(x => x.id === a.id)).filter(Boolean).map(x => chip("art-pick", x.id, artLabel(x), x.id === picked)).join("")}</div>` +
          `<div class="art-editor"><div class="closeup-box"><div class="closeup" id="closeup">${closeupSVG()}</div><small>${FINGERS[s.selected].name} nail${s.applyAll ? " · all 5 change" : ""}</small></div>` +
          `<div class="art-sliders">${slider("artSize", "Size", 30, 300, at.size * 100)}${slider("artTurn", "Turn", -180, 180, at.turn)}${slider("artX", "Left ↔ Right", -100, 100, at.x * 100)}${slider("artY", "Tip ↕ Cuticle", 0, 100, at.y * 100)}` +
          `<button class="soft" data-art-reset="${picked}">↺ Put it back</button></div></div><p class="muted-note">Drag a heart, star, flower, sticker or gem around on the big nail. Tap anywhere else on it to move the art you're working on there.</p>` : "") +
        `<h3>Art colour</h3><div class="chips">${ACCENTS.map(hex => `<button class="swatch ${shown===hex?"on":""}" data-accent="${hex}" style="--c:${hex}" aria-label="Art colour ${hex}" aria-pressed="${shown===hex}"></button>`).join("")}</div>${colourWheel("art")}`;
    }
    return hero(client.self ? "Your manicure 💅" : `${safe(client.username)}'s manicure 💅`, "Tap a nail to work on just that one, or paint all five together.", "AT YOUR NAIL TABLE") +
      `<section class="panel"><div class="salon-grid"><div class="stage"><div class="hand-box" id="salonHand">${salonHand()}</div><div class="chips center">${FINGERS.map((f, i) => chip("pick", i, f.name, !s.applyAll && s.selected === i)).join("")}</div><label class="check"><input type="checkbox" id="applyAll" ${s.applyAll?"checked":""}> Paint all 5 nails together</label></div>` +
      `<div class="tools"><div class="steps" role="tablist">${steps.map(([id, l]) => `<button class="step ${s.step===id?"on":""}" data-step="${id}" role="tab" aria-selected="${s.step===id}">${l}</button>`).join("")}</div>${tools}` +
      `<div class="actions"><button class="primary" id="sendNails">${client.self ? "💅 Finish & wear them" : `💌 Finish & send to ${safe(client.username)}`}</button><button class="soft" id="resetNails">Start over</button><button class="soft" id="leaveSalon">Change client</button></div></div></div></section>`;
  }
  // A big view of the nail you're working on, with a ring on the art you're moving.
  function closeupSVG() {
    const s = state.salon, f = FINGERS[s.selected], n = s.design.nails[s.selected], g = nailGeom(f, s.design.length);
    const skin = toneHex(salonClient()?.handTone), line = mix(skin, "#3b1d12", 0.35);
    const j = n.arts.findIndex(a => a.id === pickedArt()), at = j >= 0 && artPlaces(n.arts, g)[j];
    const ring = at ? `<g transform="translate(${at.x*g.hw} ${g.t+at.y*(g.c-g.t)})" fill="none"><circle r="${g.hw*0.3}" stroke="#fff" stroke-width="2"/><circle r="${g.hw*0.3}" stroke="#16847b" stroke-width="1" stroke-dasharray="2.5 2"/></g>` : "";
    const left = -g.hw - 5, top = g.t - 5;
    return `<svg viewBox="${left} ${top} ${-2*left} ${g.c+8-top}" role="img" aria-label="Close-up of the ${f.name.toLowerCase()} nail">` +
      `<rect x="${-f.w/2}" y="${-f.len}" width="${f.w}" height="${f.len+40}" rx="${f.w/2}" fill="${skin}" stroke="${line}" stroke-width="1.5"/>${nailSVG(f, n, s.design, `c${++svgSeq}`, false, line)}${ring}</svg>`;
  }
  // Polish changes go on the chosen nail, or every nail when "paint all" is on.
  const isPainted = i => state.salon.applyAll || i === state.salon.selected;
  const paintedNails = () => state.salon.design.nails.filter((n, i) => isPainted(i));
  // Redraws just the pictures (the hand, and the close-up nail), so sliders and dragging keep going.
  function drawSalon() {
    $("#salonHand").innerHTML = salonHand();
    const closeup = $("#closeup");
    if (closeup) closeup.innerHTML = closeupSVG();
  }
  function paint(field, value, full = true) {
    paintedNails().forEach(n => { n[field] = value; });
    if (full) render(); else drawSalon();
  }
  // The art you're working on: the one picked under "Working on", or else the one put on last.
  function pickedArt() {
    const s = state.salon, arts = s.design.nails[s.selected].arts;
    return (arts.find(a => a.id === s.artPick) || arts[arts.length - 1])?.id;
  }
  const artColour = () => { const s = state.salon; return s.design.nails[s.selected].arts.find(a => a.id === pickedArt())?.color || s.accent; };
  // Tap an art to put it on in the current art colour, and tap it again to take it off. Plain takes all the art off.
  function toggleArt(id) {
    const s = state.salon, on = s.design.nails[s.selected].arts.some(a => a.id === id);
    paintedNails().forEach(n => { n.arts = id === "none" ? [] : n.arts.filter(a => a.id !== id).concat(on ? [] : [{ id, color: s.accent }]); });
    if (!on) s.artPick = id;
    render();
  }
  function colourArt(hex, full = true) {
    const s = state.salon, id = pickedArt();
    s.accent = hex;
    paintedNails().forEach(n => n.arts.forEach(a => { if (a.id === id) a.color = hex; }));
    if (full) render(); else drawSalon();
  }
  // Move, size or turn the art you're working on. Every piece on those nails is first pinned where it's drawn now,
  // so the stickers sharing the nail don't jump to new spots.
  function placeArt(change) {
    const s = state.salon, id = pickedArt();
    if (!id) return;
    s.design.nails.forEach((n, i) => {
      if (!isPainted(i)) return;
      const places = artPlaces(n.arts, nailGeom(FINGERS[i], s.design.length));
      n.arts.forEach((a, j) => Object.assign(a, places[j], a.id === id ? change : {}));
    });
    drawSalon();
  }
  // "Put it back" sends the art to its home spot again.
  function resetArt(id) {
    paintedNails().forEach(n => n.arts.forEach(a => { if (a.id === id) { delete a.x; delete a.y; delete a.size; delete a.turn; } }));
    render();
  }

  // ---- Colour wheel: tap or drag on it to pick a colour, with a brightness slider beside it. ----
  function hexToHsv(hex) {
    const n = parseInt(hexOr(hex, "#ffffff").slice(1), 16), [r, g, b] = [16, 8, 0].map(sh => ((n >> sh) & 255) / 255);
    const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
    const h = !d ? 0 : v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: v ? d / v : 0, v };
  }
  function hsvToHex({ h, s, v }) {
    const f = k => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
    return "#" + [5, 3, 1].map(k => Math.round(f(k) * 255).toString(16).padStart(2, "0")).join("");
  }
  const WHEELS = {
    polish: { now: () => state.salon.design.nails[state.salon.selected].color, set: hex => paint("color", hex, false) },
    art: { now: () => artColour(), set: hex => colourArt(hex, false) }
  };
  // Each wheel remembers its own spot, so turning the brightness right down and back up keeps the colour you had.
  function wheelColour(kind) {
    const hex = hexOr(WHEELS[kind].now(), "#ffffff"), kept = state.salon.wheels[kind];
    return kept && hsvToHex(kept) === hex ? kept : hexToHsv(hex);
  }
  // The wheel shows hue around the edge and strength from the middle out; the dark layer matches the brightness.
  const wheelInside = c => { const a = c.h * Math.PI / 180; return `<span class="wheel-dark" style="opacity:${(1 - c.v).toFixed(2)}"></span><span class="wheel-dot" style="left:${50 + 50*c.s*Math.sin(a)}%;top:${50 - 50*c.s*Math.cos(a)}%;background:${hsvToHex(c)}"></span>`; };
  function colourWheel(kind) {
    const c = wheelColour(kind);
    return `<div class="wheel-row"><div class="wheel" data-wheel="${kind}" role="img" aria-label="Colour wheel: tap or drag to pick a colour">${wheelInside(c)}</div>` +
      `<label class="wheel-light">Brightness<input type="range" data-wheel-light="${kind}" min="0" max="100" value="${Math.round(c.v * 100)}"></label></div>`;
  }
  function setWheel(kind, c) {
    state.salon.wheels[kind] = c;
    WHEELS[kind].set(hsvToHex(c));
    const wheel = $(`[data-wheel="${kind}"]`);
    if (wheel) wheel.innerHTML = wheelInside(c);
  }
  // Where the pointer is on the big nail, in nail units (see artPlaces).
  function closeupSpot(e) {
    const s = state.salon, g = nailGeom(FINGERS[s.selected], s.design.length);
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform($("#closeup svg").getScreenCTM().inverse());
    return { x: p.x / g.hw, y: (p.y - g.t) / (g.c - g.t) };
  }
  // The sticker or gem under the pointer (the one drawn on top wins), with where it sits now.
  function grabbableAt(spot) {
    const s = state.salon, arts = s.design.nails[s.selected].arts, g = nailGeom(FINGERS[s.selected], s.design.length), places = artPlaces(arts, g);
    const onTop = [...arts.filter(a => a.id === "gem"), ...arts.filter(a => isSticker(a.id)).reverse()];
    const hit = onTop.find(a => { const p = places[arts.indexOf(a)]; return Math.hypot((spot.x - p.x) * g.hw, (spot.y - p.y) * (g.c - g.t)) < g.hw * Math.max(0.35, 0.7 * p.size); });
    return hit && { id: hit.id, ...places[arts.indexOf(hit)] };
  }
  // Dragging in the Nail Salon: on the big nail it moves the art you're working on, and on a colour wheel it picks the colour.
  function salonDrag(e) {
    const s = state.salon, clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    if (s.drag === "place") {
      const spot = closeupSpot(e);
      placeArt({ x: clamp(spot.x - s.grab.x, -1, 1), y: clamp(spot.y - s.grab.y, 0, 1) });
      return;
    }
    const box = $(`[data-wheel="${s.drag}"]`).getBoundingClientRect(), r = box.width / 2, dx = e.clientX - box.left - r, dy = e.clientY - box.top - r;
    // A very dark colour makes the whole wheel look black, so picking from it brings the brightness back up.
    const v = wheelColour(s.drag).v;
    setWheel(s.drag, { h: (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(dx, dy) / r), v: v < 0.15 ? 1 : v });
  }
  function openSalon(friendId) {
    state.salon = { friendId, design: newDesign(), selected: 1, applyAll: true, step: "shape", accent: "#ffffff", artPick: null, wheels: {}, drag: null, grab: null };
    state.page = "nails"; state.notice = ""; render(); window.scrollTo(0, 0);
  }

  // ---- Groups, Codes + Settings pages ----
  // A group's row of faces and member count. Tapping it lists everyone in the group.
  const facesButton = g => `<button class="faces-btn" data-members="${safe(g.id)}" aria-label="See all ${g.members} member${g.members === 1 ? "" : "s"} of ${safe(g.name)}"><span class="faces">${g.faces.map(f => avatarHTML(f.avatar, "tiny")).join("")}</span><small>${g.members} member${g.members === 1 ? "" : "s"}</small></button>`;
  function groupCard(g) {
    const mine = state.user?.id === g.ownerId, del = `<button class="soft" data-delete-group="${g.id}" data-name="${safe(g.name)}">Delete</button>`;
    const open = g.joined ? `<button class="primary" data-open-group="${g.id}">💬 Open</button>` : "";
    // Admins can delete anyone's group (but not the secret ones, which are built in).
    const action = !state.user ? "" : mine ? `${open}${del}`
      : g.joined ? `${open}<button class="soft" data-leave-group="${g.id}">Leave</button>`
      : g.secret && !g.unlocked ? `<button class="soft" data-page="codes">🔒 Needs a code</button>` : `<button class="primary" data-join-group="${g.id}">Join</button>`;
    const tag = (g.secret ? ` <span class="pill">🔑 Secret</span>` : "") + (mine ? ` <span class="pill">Yours</span>` : g.joined ? ` <span class="pill">Joined ✓</span>` : "");
    return `<article class="group-card" data-search="${safe(`${g.name} ${g.description}`.toLowerCase())}"><div class="group-icon" aria-hidden="true">${safe(g.icon)}</div>` +
      `<div class="group-body"><h3>${safe(g.name)}${tag}</h3>${g.description ? `<p>${safe(g.description)}</p>` : ""}<div class="row">${facesButton(g)}<small>${g.secret ? "secret group" : `made by ${safe(g.owner)}`}</small></div></div>` +
      `<div class="group-actions">${action}${state.user?.admin && !mine && !g.secret ? del : ""}</div></article>`;
  }
  function groupPage() {
    const v = state.groupView, g = v.group;
    const top = hero(`${safe(g.icon)} ${safe(g.name)}`, g.description ? safe(g.description) : `A group made by ${safe(g.owner)}.`, g.secret ? "SECRET GROUP" : "GROUP");
    const head = `<section class="panel"><div class="row between"><button class="soft" data-page="groups">← All groups</button>${facesButton(g)}</div>`;
    if (!g.joined) return top + head + `<p>Join this group to see its posts and chat.</p></section>`;
    const tabs = [["chat", "💬 Chat"], ["posts", "📸 Posts"]].map(([id, label]) => `<button class="step ${v.tab === id ? "on" : ""}" data-group-tab="${id}" role="tab" aria-selected="${v.tab === id}">${label}</button>`).join("");
    const body = v.tab === "chat" ? `<section class="panel">${chatBox(`Message ${g.name}`)}</section>` :
      `<section class="panel"><form id="groupPostForm"><label for="gpCaption">Post to ${safe(g.name)}</label><textarea id="gpCaption" maxlength="240" rows="2" required placeholder="Share something with the group…">${safe(v.caption)}</textarea>` +
      `<label for="gpMedia">Add a photo or video (optional)</label><input id="gpMedia" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime">` +
      `<div class="actions"><button class="primary" type="submit">Post to group ✨</button></div></form></section>` +
      `<div class="feed">${v.posts.map(postCard).join("") || `<div class="panel empty">${groupEmpty(g, "Post something to make the people laugh!")}</div>`}</div>`;
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
    const cards = state.themes.filter(t => !t.gift || state.inventory.includes(t.item)).map(t => {
      const unlocked = !t.item || (state.user && state.inventory.includes(t.item)), product = state.products.find(p => p.id === t.item);
      const status = t.id === current ? "Using ✓" : unlocked ? "Tap to use" : `🔒 ${product ? priceLabel(product) : ""} in the Shop`;
      return `<button class="theme-card ${t.id === current ? "on" : ""}" data-theme="${t.id}" ${unlocked ? `data-use-theme="${t.id}"` : `data-page="shop"`} aria-pressed="${t.id === current}"><span class="theme-preview" aria-hidden="true"><i></i><i></i><i></i></span><strong>${t.icon} ${safe(t.name)}</strong><small>${status}</small></button>`;
    }).join("");
    return hero("Settings ⚙️", "Choose how Yakimma looks.", "YOUR PREFERENCES") +
      songPanel() +
      `<section class="panel"><h2>Color theme</h2><div class="theme-grid">${cards}</div><p class="muted-note">${zoneOn() ? "The 18+ zone has its own theme. When you turn 18+ off, your normal theme comes back." : state.user ? "Your theme is saved to your account, so it follows you on any device." : "Free themes are saved in this browser. Sign in and buy Goth or Pastel in the Shop to unlock them."}</p></section>` +
      adultPanel() + kidPanel() +
      `<section class="panel"><h3>Safety reminder 🔐</h3><p class="muted-note">Never share your password.</p></section>`;
  }
  // Admins can switch between the zones straight away, so they see both panels in every zone and skip the checks.
  const adminZoneNote = () => state.user?.admin ? `<p class="muted-note">🛠️ You're an admin, so you can switch zones straight away, without the checks.</p>` : "";
  const SONG_LOCKS = { adult: "🔞 Unlocks once you've been in the 18+ zone", kids: "🧸 Not in the kiddy zone", bangladeshiMuslim: "☪️🇧🇩 Only for Muslims from Bangladesh" };
  function songPanel() {
    if (!state.user) return "";
    const current = state.user.song;
    return `<section class="panel"><h2>🎵 Song</h2><p class="muted-note">Pick a song to play while you use Yakimma. It keeps playing on every page.</p><div class="song-list">` +
      state.songs.map(s => `<button class="song ${s.id === current ? "on" : ""}" data-song="${s.id}" aria-pressed="${s.id === current}" ${s.ready && !s.lock ? "" : "disabled"}>` +
        `<span>${s.lock ? "🔒" : s.file ? "🎵" : "🔇"} ${safe(s.name)}</span><small>${!s.ready ? "Not added yet" : SONG_LOCKS[s.lock] || (s.id === current ? (s.file ? "Playing ✓" : "On ✓") : "")}</small></button>`).join("") + `</div></section>`;
  }
  function adultPanel() {
    const adult = state.user?.adult;
    if (!adult || (kidOn() && !state.user.admin)) return "";
    return `<section class="panel"><h2>🔞 18+</h2>` + (adult.on
      ? `<p>You're in the 18+ zone. You only see 18+ posts and groups, and you can only talk to people who are 18+.</p><button class="danger" id="adultOff">Turn off 18+</button>`
      : (adminZoneNote() || `<p class="muted-note">${adult.verified ? "You've already done the 18+ checks, so you only need to confirm." : "For grown-ups only. To turn it on, you confirm you're 18+, enter a code we email you, and do a face scan."}</p>`) +
        `<button class="primary" id="adultStart">Turn on 18+?</button>`) + `</section>`;
  }
  function kidPanel() {
    const kid = state.user?.kid;
    if (!kid || (zoneOn() && !state.user.admin)) return "";
    if (state.user.admin) return `<section class="panel"><h2>🧸 Kiddy zone</h2>${adminZoneNote()}` +
      (kid.on ? `<p>You're in the kiddy zone.</p><button class="danger" id="kidOffAdmin">Turn off the kiddy zone</button>` : `<button class="primary" id="kidStart">Turn on the kiddy zone?</button>`) + `</section>`;
    return `<section class="panel"><h2>🧸 Kiddy zone</h2>` + (kid.on
      ? `<p>You're in the kiddy zone. You only see kiddy zone posts, you can only add and talk to friends who are in it too, and you have Feed, Profile, Settings, Friends, Nails, Learn and the Shop. Only a parent can turn it off or sign out.</p>` +
        `<form id="kidOffForm"><label for="kidOffPass">Parent password</label><input id="kidOffPass" type="password" autocomplete="current-password" maxlength="200" required><div class="actions"><button class="danger" type="submit">Turn off the kiddy zone</button><button class="soft" type="button" id="kidForgot">Forgot the parent password?</button></div></form>` +
        `<h3>Signing out</h3><p class="muted-note">${kid.face ? "A parent signs out of the kiddy zone with the parent password or their face." : "A parent signs out of the kiddy zone with the parent password. If they save their face, they can use that too."}</p><button class="soft" id="kidFaceBtn">📷 ${kid.face ? "Change the parent's face" : "Save the parent's face"}</button>`
      : `<p class="muted-note">${kid.ready ? "A parent has already set up the kiddy zone, so you only need to confirm." : "A safe part of Yakimma for kids. To turn it on, a parent types their email, enters the code we send them, chooses a parent-only password and, if they want, scans their face. Only a parent can turn it off or sign out."}</p><button class="primary" id="kidStart">Turn on the kiddy zone?</button>`) + `</section>`;
  }
  function shopButton(p) {
    const owned = state.inventory.includes(p.id), theme = state.themes.find(t => t.item === p.id);
    if (owned && theme) return activeTheme() === theme.id ? `<button class="soft" disabled>Using ✓</button>` : `<button class="primary" data-use-theme="${theme.id}">Use theme</button>`;
    if (owned) return `<button class="primary" disabled>Owned ✓</button>`;
    // Everything you don't own says Buy. If you can't afford it, AI messages you in Friends with what you need.
    return state.user ? `<button class="primary" data-buy="${p.id}">Buy</button>` : `<button class="primary" data-sign-in>Buy</button>`;
  }

  // Posts you put in your playlist, newest added first. The first few show until you open the whole playlist.
  const PLAYLIST_PREVIEW = 3;
  function playlistSection() {
    const list = state.playlist;
    if (!list) return `<section class="panel"><h3>🎶 My playlist</h3><p class="muted">Loading your playlist…</p></section>`;
    const shown = state.playlistAll ? list : list.slice(0, PLAYLIST_PREVIEW);
    return `<section class="panel"><h3>🎶 My playlist (${list.length})</h3><p class="muted-note">Posts you like or want to see later. Tap ➕ Playlist on any post to put it here.</p></section>` +
      `<div class="feed">${shown.map(postCard).join("") || `<div class="panel empty">Your playlist is empty. Tap ➕ Playlist on a post to add it! 🎶</div>`}` +
      (list.length > PLAYLIST_PREVIEW ? `<button class="soft" id="playlistAll">${state.playlistAll ? "Show less ⬆️" : `Show all ${list.length} ⬇️`}</button>` : "") + `</div>`;
  }
  function myPostsSection() {
    const m = state.myPosts;
    if (!m) return `<section class="panel"><h3>My posts</h3><p class="muted">Loading your posts…</p></section>`;
    const order = [["newest", "🆕 Newest first"], ["oldest", "🕰️ Oldest first"]].map(([id, label]) => `<button class="step ${m.order === id ? "on" : ""}" data-my-order="${id}" aria-pressed="${m.order === id}">${label}</button>`).join("");
    return `<section class="panel"><h3>My posts (${m.total})</h3>${m.total > 1 ? `<div class="tabs" role="group" aria-label="Order of your posts">${order}</div>` : ""}</section>` +
      `<div class="feed">${m.posts.map(postCard).join("") || `<div class="panel empty">You haven't posted yet. Your posts will show up here! 🌸</div>`}` +
      (m.more ? `<button class="soft" id="moreMyPosts">${m.order === "newest" ? "Show older posts ⬇️" : "Show newer posts ⬇️"}</button>` : "") + `</div>`;
  }
  // ---- Video Speed + Effects (bought in the Shop). Changing them updates the post in place, so the video keeps playing. ----
  const SPEEDS = [0.5, 1, 1.5, 2];
  const EFFECTS = [["none", "Normal"], ["sparkle", "✨ Sparkle"], ["vivid", "🌈 Vivid"], ["stars", "🌟 Glowing stars"]];
  const viewOf = id => (state.viewing[id] ||= { speed: 1, effect: "none", open: null });
  // Little sparkles or stars scattered over the video, each with its own place, size and timing.
  function fxParticles(effect) {
    const n = { sparkle: 18, stars: 12 }[effect], glyph = effect === "stars" ? "★" : "✦";
    if (!n) return "";
    const r = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
    return Array.from({ length: n }, () => `<i style="--x:${r(4, 96)}%;--y:${r(8, 92)}%;--s:${r(10, 24)}px;--d:-${r(0, 4)}s;--t:${r(1.6, 3.2)}s">${glyph}</i>`).join("");
  }
  function viewerTool(item, icon, name, id) {
    if (!state.inventory.includes(item)) return `<button class="soft" data-page="shop" title="Buy ${name} in the Shop to use it">🔒 ${name}</button>`;
    return `<button class="soft" data-viewer="${item}" data-post="${id}" aria-expanded="${viewOf(id).open === item}">${icon} ${name}</button>`;
  }
  function viewerPanel(id) {
    const v = viewOf(id), chip = (attr, value, label, on) => `<button class="chip ${on ? "on" : ""}" data-${attr}="${value}" data-post="${id}" aria-pressed="${on}">${label}</button>`;
    if (v.open === "speed") return `<div class="chips viewer-tools" role="group" aria-label="Video speed">${SPEEDS.map(s => chip("set-speed", s, `${s}×`, v.speed === s)).join("")}</div>`;
    if (v.open === "effects") return `<div class="chips viewer-tools" role="group" aria-label="Video effects">${EFFECTS.map(([e, label]) => chip("set-effect", e, label, v.effect === e)).join("")}</div>`;
    return "";
  }
  // Redraw a post's speed/effect controls (and its effect, when that changed) without touching the video itself.
  function drawViewer(id, effectChanged = false) {
    const card = $(`.post[data-post="${id}"]`), v = viewOf(id);
    if (!card) return;
    card.querySelector(".viewer").innerHTML = viewerPanel(id);
    card.querySelectorAll("[data-viewer]").forEach(b => b.setAttribute("aria-expanded", v.open === b.dataset.viewer));
    const wrap = card.querySelector(".media-wrap");
    if (wrap && effectChanged) { wrap.className = `media-wrap fx-${v.effect}`; wrap.querySelector(".fx-layer").innerHTML = fxParticles(v.effect); }
  }
  // A video starts at normal speed whenever it's drawn, so put back the speed chosen for it.
  function applySpeeds() {
    document.querySelectorAll(".post video").forEach(video => { video.defaultPlaybackRate = video.playbackRate = viewOf(video.closest(".post").dataset.post).speed; });
  }
  // ---- 🖼️ Video thumbnails: a picture shown on a video before it plays. Pick a moment from the video, or a picture. ----
  const thumbPickerHTML = current => `<div class="thumb-picker"><div class="thumb-row">` +
    `<figure><video class="thumb-video" muted playsinline preload="auto"></video><figcaption>The video</figcaption></figure>` +
    `<figure><img class="thumb-preview" alt="The thumbnail" ${current ? `src="${safe(current)}"` : "hidden"}><figcaption>Thumbnail</figcaption></figure></div>` +
    `<label>Moment in the video<input class="thumb-time" type="range" min="0" max="0" step="0.1" value="0" disabled></label>` +
    `<div class="actions"><button type="button" class="soft thumb-use" disabled>📸 Use this moment</button><label class="file-btn soft"><input type="file" class="thumb-file" accept="image/jpeg,image/png,image/gif,image/webp">📁 Choose a picture</label></div>` +
    `<p class="muted-note thumb-note" role="status"></p></div>`;
  // Draws a video's frame (or a picture) as a JPEG at most 1280 pixels wide. Re-drawing also strips hidden photo data.
  const toThumb = source => new Promise(resolve => {
    const w = source.videoWidth || source.naturalWidth, h = source.videoHeight || source.naturalHeight;
    if (!w || !h) return resolve(null);
    const k = Math.min(1, 1280 / w), c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    c.toBlob(resolve, "image/jpeg", 0.85);
  });
  // Sets up a picker for the video at `src`. With `auto`, a moment near the start is picked straight away.
  function wireThumbPicker(box, src, onPick, auto) {
    const video = box.querySelector(".thumb-video"), range = box.querySelector(".thumb-time"), use = box.querySelector(".thumb-use"), note = box.querySelector(".thumb-note");
    const pick = blob => {
      if (!blob) return;
      const img = box.querySelector(".thumb-preview");
      img.src = URL.createObjectURL(blob); img.hidden = false; onPick(blob);
    };
    let first = auto;
    video.onloadedmetadata = () => {
      const t = Math.min(1, (video.duration || 0) / 3);
      range.max = video.duration || 0; range.value = t; range.disabled = use.disabled = false; video.currentTime = t;
    };
    video.onseeked = async () => { if (first) { first = false; pick(await toThumb(video)); } };
    video.onerror = () => { range.disabled = use.disabled = true; note.textContent = "This browser can't show this video, so choose a picture for its thumbnail instead."; };
    range.oninput = () => { video.currentTime = Number(range.value); };
    use.onclick = async () => pick(await toThumb(video));
    box.querySelector(".thumb-file").onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const img = new Image();
      img.onload = async () => { URL.revokeObjectURL(img.src); pick(await toThumb(img)); };
      img.onerror = () => { note.textContent = "That file couldn't be opened as a picture. Try a JPG or PNG."; };
      img.src = URL.createObjectURL(file);
    };
    video.src = src;
  }
  // Changing the thumbnail of a video that's already posted.
  function thumbModal(p) {
    let blob = null;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal thumb-modal" role="dialog" aria-modal="true" aria-labelledby="thumbTitle"><div class="row between"><h2 id="thumbTitle">🖼️ Thumbnail</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>This picture shows on your video before it plays. Pick a moment from the video, or choose a picture.</p>${thumbPickerHTML(p.thumbUrl)}` +
      `<div class="actions"><button class="primary" id="saveThumb" disabled>Save thumbnail</button></div><p class="muted-note error-text" id="thumbError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    wireThumbPicker($(".thumb-modal"), p.mediaUrl, b => { blob = b; $("#saveThumb").disabled = false; }, !p.thumbUrl);
    $("#saveThumb").onclick = async () => {
      const body = new FormData(); body.append("thumb", blob, "thumb.jpg");
      $("#saveThumb").disabled = true;
      try {
        const d = await api(`/api/posts/${p.id}/thumbnail`, { method: "PUT", body });
        for (const x of postCopies(p.id)) x.thumbUrl = d.thumbUrl;
        closeModal(); toast("Your video has a new thumbnail! 🖼️");
      } catch (err) { $("#thumbError").textContent = err.message; $("#saveThumb").disabled = false; }
    };
  }
  function postMedia(p) {
    if (!p.mediaUrl) return `<div class="notice">📝 Text post</div>`;
    if (!p.mediaType?.startsWith("video/")) return `<img class="media" src="${p.mediaUrl}" alt="Post uploaded by ${safe(p.username)}">`;
    const effect = viewOf(p.id).effect;
    return `<div class="media-wrap fx-${effect}"><video class="media" src="${p.mediaUrl}" ${p.thumbUrl ? `poster="${p.thumbUrl}"` : ""} controls playsinline preload="metadata"></video><div class="fx-layer" aria-hidden="true">${fxParticles(effect)}</div></div>`;
  }
  // Who can see a post, like YouTube: [id, label, what it means].
  const VISIBILITY = [
    ["public", "🌍 Public", "Everyone can see it, on the feed and your profile."],
    ["unlisted", "🔗 Unlisted", "Only your friends on Yakimma can see it (and the creator, who keeps Yakimma safe)."],
    ["private", "🔒 Private", "Only you can see it, on your profile (and the creator, who keeps Yakimma safe)."]
  ];
  // Who a post is for: [id, label, what it means]. Boys see Boys and Both, girls see Girls and Both.
  const AUDIENCE = [
    ["boys", "💙 Boys", "Only boys see it (and the creator)."],
    ["girls", "💗 Girls", "Only girls see it (and the creator)."],
    ["both", "💜 Both", "Boys and girls see it. Choose this if it's for everyone."]
  ];
  // The label on a post saying who it's for. The person who posted it, and the creator, can tap it to change it.
  function audiencePill(p) {
    const [, label] = AUDIENCE.find(a => a[0] === p.audience) || AUDIENCE[2];
    return state.user && (state.user.id === p.userId || state.user.creator)
      ? ` <button class="pill aud ${p.audience}" data-post-audience="${p.id}" title="Change who it's for">${label} ✏️</button>` : ` <span class="pill aud ${p.audience}">${label}</span>`;
  }
  function audienceModal(id) {
    const now = shownPosts(id)[0]?.audience || "both";
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="audTitle"><div class="row between"><h2 id="audTitle">🚻 Who is it for?</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<form id="audForm"><fieldset class="visibility"><legend>Who this post is for</legend>${AUDIENCE.map(([a, label, about]) => `<label class="vis-option"><input type="radio" name="newAudience" value="${a}" ${a === now ? "checked" : ""}><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
      `<div class="actions"><button class="primary" type="submit">Save</button></div></form><p class="muted-note error-text" id="audError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#audForm").onsubmit = async e => {
      e.preventDefault();
      const audience = $('input[name="newAudience"]:checked').value;
      try {
        await api(`/api/posts/${id}/audience`, send("PUT", { audience }));
        for (const p of shownPosts(id)) p.audience = audience;
        closeModal(); render(); toast(`Now it's for: ${AUDIENCE.find(a => a[0] === audience)[1]}`);
      } catch (err) { $("#audError").textContent = err.message; }
    };
  }
  const postLink = code => `${location.origin}/post/${code}`;
  // Every copy of a post that's on show (feed, profiles, a group, its own page), to update them all at once.
  const shownPosts = id => [state.posts, state.myPosts?.posts, state.playlist, state.groupView?.posts, state.reports?.posts, state.person?.posts, state.single?.post && [state.single.post]]
    .flatMap(list => list || []).filter(p => p.id === id);
  // Changing who can see one of your posts.
  function visibilityModal(id) {
    const now = shownPosts(id)[0]?.visibility || "public";
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="visTitle"><div class="row between"><h2 id="visTitle">👁️ Who can see it?</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<form id="visForm"><fieldset class="visibility"><legend>Who can see this post</legend>${VISIBILITY.map(([v, label, about]) => `<label class="vis-option"><input type="radio" name="newVisibility" value="${v}" ${v === now ? "checked" : ""}><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
      `<div class="actions"><button class="primary" type="submit">Save</button></div></form><p class="muted-note error-text" id="visError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#visForm").onsubmit = async e => {
      e.preventDefault();
      const visibility = $('input[name="newVisibility"]:checked').value;
      try {
        await api(`/api/posts/${id}/visibility`, send("PUT", { visibility }));
        for (const p of shownPosts(id)) p.visibility = visibility;
        state.posts = (await api("/api/posts")).posts;
        closeModal(); toast(`Now: ${VISIBILITY.find(v => v[0] === visibility).slice(1).join(" ")}`);
      } catch (err) { $("#visError").textContent = err.message; }
    };
  }
  // Delete for your own posts (and every post, for the creator); Report for other people's (not the creator's). You can change who sees your own
  // posts (not group posts, which the whole group sees). Every post outside a group has its own link to copy.
  function postTools(p) {
    if (!state.user) return "";
    const mine = state.user.id === p.userId;
    return (mine && !p.inGroup ? `<button class="soft" data-post-visibility="${p.id}">👁️ Who can see it</button>` : "") +
      (mine && p.mediaType?.startsWith("video/") ? `<button class="soft" data-post-thumb="${p.id}">🖼️ Thumbnail</button>` : "") +
      (p.inGroup ? "" : `<button class="soft" data-copy-link="${safe(p.code)}" data-visibility="${p.visibility}">🔗 Copy link</button>`) + (mine || state.user.creator ? `<button class="soft" data-delete-post="${p.id}">🗑️ Delete</button>` : "") + (mine || isCreatorName(p.username) ? "" : `<button class="soft" data-report-post="${p.id}">🚩 Report</button>`);
  }
  // Putting a post in your playlist, or taking it out. Every copy of the post on show changes, and the playlist on your
  // Profile loads again next time (taking a post out there removes it straight away).
  async function togglePlaylist(id) {
    const on = !shownPosts(id)[0]?.inPlaylist;
    await api(`/api/posts/${id}/playlist`, { method: on ? "POST" : "DELETE" });
    for (const p of shownPosts(id)) p.inPlaylist = on;
    if (state.page === "profile" && !on) state.playlist = state.playlist?.filter(p => p.id !== id);
    else if (state.page !== "profile") state.playlist = null;
    else await loadPlaylist();
    render(); toast(on ? "Added to your playlist 🎶 Find it on your Profile." : "Taken out of your playlist.");
  }
  async function deletePost(id) {
    const p = [...state.posts, ...(state.myPosts?.posts || []), ...(state.groupView?.posts || []), ...(state.reports?.posts || []), ...(state.person?.posts || []), ...(state.single?.post ? [state.single.post] : [])].find(x => x.id === id);
    const whose = p && p.userId !== state.user.id ? `${p.username}'s post` : "your post";
    if (!confirm(`Delete ${whose}? This can't be undone.`)) return;
    await api(`/api/posts/${id}`, { method: "DELETE" });
    const gone = list => list?.filter(x => x.id !== id);
    state.posts = gone(state.posts);
    if (state.myPosts?.posts.some(x => x.id === id)) Object.assign(state.myPosts, { posts: gone(state.myPosts.posts), total: state.myPosts.total - 1 });
    if (state.playlist) state.playlist = gone(state.playlist);
    if (state.groupView?.posts) state.groupView.posts = gone(state.groupView.posts);
    if (state.reports) state.reports.posts = gone(state.reports.posts);
    if (state.person) state.person.posts = gone(state.person.posts);
    if (state.single?.post?.id === id) state.single = { error: "This post was deleted." };
    toast("The post is deleted 🗑️");
  }
  // The last reason, "Something else", opens a box under it for the reporter to say what's wrong in their own words.
  // Their words go to the creator (and show on the Reports page).
  function reportModal(id, kind = "post") {
    const other = state.reportReasons.length - 1;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="reportTitle"><div class="row between"><h2 id="reportTitle">🚩 Report this ${kind}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>Why are you reporting it? Yakimma's admins will look at it.</p><div class="grade-list">${state.reportReasons.map((r, i) => `<button class="soft" data-reason="${i}" ${i === other ? `aria-expanded="false"` : ""}>${safe(r)}</button>`).join("")}</div>` +
      `<form id="reportOtherForm" hidden><label for="reportDetails">What's wrong? Write it in your own words</label><textarea id="reportDetails" maxlength="500" rows="3" required placeholder="Tell the creator what's wrong with this ${kind}"></textarea>` +
      `<p class="muted-note">What you write goes to the creator.</p><div class="actions"><button class="primary" type="submit">Send report 🚩</button></div></form>` +
      `<p class="muted-note error-text" id="reportError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    const report = async (reason, details) => {
      try { await api(`/api/${kind === "comment" ? "comments" : "posts"}/${id}/report`, send("POST", { reason, details })); closeModal(); toast(`Thanks for telling us. The ${kind} is reported 🚩`); }
      catch (err) { $("#reportError").textContent = err.message; }
    };
    for (const btn of document.querySelectorAll("[data-reason]")) btn.onclick = () => {
      if (Number(btn.dataset.reason) !== other) return report(state.reportReasons[btn.dataset.reason]);
      $("#reportOtherForm").hidden = false; btn.setAttribute("aria-expanded", "true"); btn.className = "primary"; $("#reportDetails").focus();
    };
    $("#reportOtherForm").onsubmit = e => { e.preventDefault(); report(state.reportReasons[other], $("#reportDetails").value.trim()); };
  }
  // The Reports page, only for admins and not in the kiddy zone: reported 18+ posts in the 18+ zone, and reported
  // posts from the normal site and the kiddy zone everywhere else, with who reported them and why.
  // Only the creator can do anything about them: suspend whoever posted it (or someone who made a false report), delete
  // it, or keep it. The other admins can only look.
  function reportsPage() {
    const creator = state.user.creator;
    const top = hero("Reports 🚩", creator ? "Posts and comments people reported. Suspend the person, delete it, or keep it if it's fine. If a report is false, you can suspend whoever sent it." : "Posts and comments people reported. You can see them, but only the creator can suspend, delete or keep them.", "ADMINS ONLY");
    const actions = buttons => creator ? `<div class="actions">${buttons}</div>` : "";
    const list = state.reports?.posts, comments = state.reports?.comments || [];
    if (!list) return top + `<section class="panel empty">Loading…</section>`;
    // The creator can't be suspended, so there's no button on their own posts, comments or reports.
    const suspendBtn = (id, name, label, reason) => creator && id !== state.user.id ? `<button class="soft" data-suspend="${id}" data-name="${safe(name)}" data-reason="${safe(reason)}">⛔ ${label}</button>` : "";
    const reasons = reports => `<ul class="report-reasons">${reports.map(r => `<li>${personLink(r.reporterId, r.username, `<strong>${nameHTML(r.username)}</strong>`)}: ${safe(r.reason)} <small>${timeLabel(r.createdAt)}</small>` +
      `${creator && r.reporterId !== state.user.id ? `<button class="link-btn" data-suspend="${r.reporterId}" data-name="${safe(r.username)}" data-reason="False report">⛔ Suspend for a false report</button>` : ""}${r.details ? `<blockquote class="report-words">“${safe(r.details)}”</blockquote>` : ""}</li>`).join("")}</ul>`;
    const times = n => `${n} time${n === 1 ? "" : "s"}`;
    const posts = list.map(p => `<section class="panel report"><h3>🚩 Post reported ${times(p.reports.length)}${p.kid ? ` <span class="pill">🧸 Kiddy zone post</span>` : ""}</h3>${reasons(p.reports)}` +
      `${postCard(p)}${actions(`${suspendBtn(p.userId, p.username, `Suspend ${safe(nameText(p.username))}`, "Your post broke Yakimma's rules")}<button class="danger" data-delete-post="${p.id}">🗑️ Delete the post</button><button class="soft" data-keep-post="${p.id}">✅ It's fine, keep it</button>`)}</section>`).join("");
    const reportedComments = comments.map(c => `<section class="panel report"><h3>🚩 Comment reported ${times(c.reports.length)}${c.kid ? ` <span class="pill">🧸 Kiddy zone</span>` : ""}</h3>${reasons(c.reports)}` +
      `<div class="comment">${personLink(c.userId, c.username, avatarHTML(c.avatar, "tiny"))}<div class="comment-body"><div class="comment-head">${personLink(c.userId, c.username, `<strong>${nameHTML(c.username)}</strong>`)}<small>${timeLabel(c.createdAt)}</small></div><p>${richText(c.body)}</p><small class="muted">On the post “${safe(c.post.caption)}”</small></div></div>` +
      `${actions(`${suspendBtn(c.userId, c.username, `Suspend ${safe(nameText(c.username))}`, "Your comment broke Yakimma's rules")}${c.canDelete ? `<button class="danger" data-report-comment-delete="${c.id}">🗑️ Delete the comment</button>` : ""}<button class="soft" data-keep-comment="${c.id}">✅ It's fine, keep it</button>`)}</section>`).join("");
    return top + (posts + reportedComments || `<section class="panel empty">No reported posts or comments right now. 🎉</section>`);
  }
  // ---- ⛔ Suspensions (only the creator): for any number of days, with a reason the person sees. ----
  function suspendModal(id, username, reason = "") {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="suspendTitle"><div class="row between"><h2 id="suspendTitle">⛔ Suspend @${safe(username)}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>A suspended account can't do anything on Yakimma until the suspension is over. They'll see how long it lasts and why.</p>` +
      `<form id="suspendForm"><label for="suspendDays">How many days?</label><input id="suspendDays" type="number" min="1" max="3650" value="3" required>` +
      `<label for="suspendReason">Why? <small>(they'll see this)</small></label><input id="suspendReason" maxlength="300" value="${safe(reason)}" placeholder="Like: You broke rule 2, harassing people">` +
      `<div class="actions"><button class="danger" type="submit">⛔ Suspend</button><button class="soft" type="button" id="suspendCancel">Cancel</button></div></form><p class="muted-note error-text" id="suspendError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = $("#suspendCancel").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#suspendForm").onsubmit = async e => {
      e.preventDefault();
      const days = Number($("#suspendDays").value);
      try {
        await api(`/api/users/${id}/suspend`, send("POST", { days, reason: $("#suspendReason").value }));
        closeModal(); await suspensionsChanged();
        toast(`${username} is suspended for ${days} day${days === 1 ? "" : "s"}. ⛔`);
      } catch (err) { $("#suspendError").textContent = err.message; }
    };
    $("#suspendDays").select();
  }
  // After suspending someone or lifting a suspension, whatever page is open shows it.
  async function suspensionsChanged() {
    if (state.page === "person" && state.person) state.person = await api(`/api/users/${state.person.user.id}`);
    if (state.page === "safety") await loadSafety();
  }
  const untilText = s => new Date(s.until).toLocaleString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  // ---- 🚻 Boy or girl: everyone picks one, then does a face scan (the creator only picks). Until then Yakimma only
  // shows this page (and the rules). If the scan doesn't agree, or can't tell, the creator decides and they wait. ----
  const GENDERS = { boy: { icon: "💙", name: "Boy", zone: "Boys" }, girl: { icon: "💗", name: "Girl", zone: "Girls" } };
  function genderPage() {
    const waiting = GENDERS[state.user.genderWaiting], signOut = kidOn() ? "" : `<button class="soft" id="logout">🚪 Sign out</button>`;
    if (waiting) return hero("Waiting for the creator 🚻", "The creator is checking your account. You can use Yakimma as soon as they're done.", "ALMOST THERE") +
      `<section class="panel"><p>You picked <strong>${waiting.icon} ${waiting.name}</strong>. The face scan couldn't be sure, so the creator will check it for you.</p>` +
      `<div class="actions"><button class="primary" id="genderCheck">🔄 Check again</button><button class="soft" data-page="rules">📜 Read the rules</button>${signOut}</div></section>`;
    return hero("Are you a boy or a girl? 🚻", "Boys see posts for boys, girls see posts for girls, and everyone sees posts for both. Friends and chats are for everyone.", "BEFORE YOU START") +
      `<section class="panel"><h2>Choose one</h2><div class="gender-pick">${Object.entries(GENDERS).map(([g, x]) => `<button class="gender-btn ${g}" data-gender-pick="${g}"><span aria-hidden="true">${x.icon}</span>${x.name}</button>`).join("")}</div>` +
      `<p class="muted-note">${state.user.creator ? "You're the creator, so there's no face scan for you." : "Next comes a quick face scan to check it. It happens on your device, and the camera picture is never saved or sent."}</p><div class="actions">${signOut}</div></section>`;
  }
  // After picking, the face scan (in a pop-up, so the page can change behind it without stopping the camera).
  async function pickGender(gender) {
    const x = GENDERS[gender];
    const done = async (guess, scanned) => {
      const d = await api("/api/me/gender", send("POST", { gender, guess }));
      state.user = d.user; closeModal(); await refresh(); render();
      if (d.user.gender) toast(`Welcome to the ${x.zone} zone! ${x.icon}`);
      else if (scanned) toast("The face scan couldn't be sure, so the creator will check it. 🚻");
    };
    if (state.user.creator) return done(null).catch(err => toast(err.message, true));
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="genderTitle"><div class="row between"><h2 id="genderTitle">${x.icon} Face scan</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>You picked <strong>${x.icon} ${x.name}</strong>. Look straight at the camera with your face in the circle.</p><div class="face-box"><video id="faceVideo" playsinline muted></video><div class="face-ring" aria-hidden="true"></div></div>` +
      `<p class="muted-note" id="faceStatus" role="status">The scan happens on your device. Your camera picture never leaves it and isn't saved.</p>` +
      `<div class="actions"><button class="primary" id="genderScan">📷 Start the face scan</button><button class="soft" id="genderNoScan">I can't do a face scan</button></div>` +
      `<p class="muted-note">Can't do one? The creator will check it instead.</p><p class="muted-note error-text" id="genderError" role="alert"></p></section></div>`;
    const fail = err => { if ($("#genderError")) $("#genderError").textContent = err.message; };
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#genderNoScan").onclick = () => done(null).catch(fail);
    $("#genderScan").onclick = async () => {
      const btn = $("#genderScan");
      btn.disabled = true; fail({ message: "" });
      try { await done((await faceScan()).gender, true); }
      catch (err) {
        // A closed pop-up stops the scan, and there's nothing left to show the error in.
        if ($("#genderScan")) { fail(err); btn.disabled = false; btn.textContent = "📷 Try again"; }
      }
    };
  }
  // On the feed: which zone you're in.
  function zoneBanner() {
    if (!state.user?.gender) return "";
    if (state.user.creator) return `<p class="zone-banner all">👑 You're the creator, so you see every post: 💙 Boys, 💗 Girls and 💜 Both.</p>`;
    const x = GENDERS[state.user.gender];
    return `<p class="zone-banner ${state.user.gender}s">${x.icon} You're in the <strong>${x.zone} zone</strong>: you see posts for ${x.zone.toLowerCase()} and posts for both.</p>`;
  }
  function suspendedPage() {
    const s = state.user.suspended;
    return hero("Your account is suspended ⛔", "The creator suspended your account because something broke Yakimma's rules.", "SUSPENDED") +
      `<section class="panel"><p class="notice error">⛔ You can't use Yakimma until <strong>${safe(untilText(s))}</strong>.</p>${s.reason ? `<p><strong>Why:</strong> ${safe(s.reason)}</p>` : ""}` +
      `<p class="muted-note">When the suspension is over, everything comes back. Read the rules so it doesn't happen again.</p>` +
      `<div class="actions"><button class="primary" data-page="rules">📜 Read the rules</button>${kidOn() ? "" : `<button class="soft" id="logout">🚪 Sign out</button>`}</div></section>`;
  }
  // ---- 🛡️ Safety (only the creator): every chat, comment and private or unlisted post, newest first. ----
  // state.safety: { tab, user, data } — user is a username to show only what that person was part of.
  const SAFETY_TABS = [["chats", "💬 Chats"], ["comments", "💭 Comments"], ["posts", "🔒 Private posts"], ["suspended", "⛔ Suspended"], ["genders", "🚻 Gender checks"]];
  const WHOLE_LIST_TABS = ["suspended", "genders"];
  async function loadSafety() {
    const v = state.safety ||= { tab: "chats", user: "" };
    v.data = await api(`/api/safety/${v.tab}${v.user && !WHOLE_LIST_TABS.includes(v.tab) ? `?user=${encodeURIComponent(v.user)}` : ""}`);
  }
  function safetyPage() {
    const v = state.safety || { tab: "chats", user: "" }, d = v.data;
    const top = hero("Safety 🛡️", "Only you can see this page. Every chat, comment and private post on Yakimma, newest first, so you can keep everyone safe.", "CREATOR ONLY");
    const tabs = `<div class="tabs" role="tablist">${SAFETY_TABS.map(([id, label]) => `<button class="step ${v.tab === id ? "on" : ""}" data-safety-tab="${id}" role="tab" aria-selected="${v.tab === id}">${label}</button>`).join("")}</div>`;
    const filter = WHOLE_LIST_TABS.includes(v.tab) ? "" : `<form id="safetyFilter" class="row nowrap"><label class="sr-only" for="safetyUser">Only show one person</label><input id="safetyUser" maxlength="20" placeholder="Only show one person: type their username" autocomplete="off" value="${safe(v.user)}"><button class="primary" type="submit">Show</button>${v.user ? `<button class="soft" type="button" id="safetyClear">Show everyone</button>` : ""}</form>`;
    const who = u => personLink(u.id, u.username, `${avatarHTML(u.avatar, "tiny")}<strong>${nameHTML(u.username)}</strong>`);
    const when = t => `<small class="muted">${timeLabel(t)}</small>`;
    let body = `<p class="muted">Loading…</p>`;
    if (d && v.tab === "chats") body = `<h3>👯 Friend chats</h3>${d.friends.map(c => `<div class="safety-row"><span class="row">${who(c.a)} <span aria-hidden="true">💬</span> ${who(c.b)}</span><span class="row"><small>${c.messages} message${c.messages === 1 ? "" : "s"}</small>${when(c.lastAt)}<button class="soft" data-safety-chat="${c.a.id}" data-with="${c.b.id}" data-title="${safe(nameText(c.a.username))} and ${safe(nameText(c.b.username))}">Read</button></span></div>`).join("") || `<p class="muted">No friend chats.</p>`}` +
      `<h3>🏘️ Group chats</h3>${d.groups.map(g => `<div class="safety-row"><strong>${safe(g.icon)} ${safe(g.name)}</strong><span class="row"><small>${g.messages} message${g.messages === 1 ? "" : "s"}</small>${when(g.lastAt)}<button class="soft" data-safety-group="${safe(g.key)}" data-title="${safe(g.icon)} ${safe(g.name)}">Read</button></span></div>`).join("") || `<p class="muted">No group chats.</p>`}`;
    if (d && v.tab === "comments") body = d.comments.map(c => `<div class="comment">${personLink(c.userId, c.username, avatarHTML(c.avatar, "tiny"))}<div class="comment-body"><div class="comment-head">${personLink(c.userId, c.username, `<strong>${nameHTML(c.username)}</strong>`)}${when(c.createdAt)}</div>` +
      `<p>${richText(c.body)}</p><small class="muted">On the post “${safe(c.post.caption)}”${c.post.visibility !== "public" ? ` (${c.post.visibility})` : ""}${c.post.groupKey ? " in a group" : ""}</small><div class="comment-tools"><button class="link-btn" data-safety-comment-delete="${c.id}">🗑️ Delete</button></div></div></div>`).join("") || `<p class="muted">No comments.</p>`;
    if (d && v.tab === "posts") body = d.posts.length ? `<div class="feed">${d.posts.map(postCard).join("")}</div>` : `<p class="muted">No private or unlisted posts.</p>`;
    if (d && v.tab === "suspended") body = d.users.map(u => `<div class="safety-row">${who(u)}<span class="row"><small>Until ${safe(untilText(u.suspended))}${u.suspended.reason ? ` · ${safe(u.suspended.reason)}` : ""}</small><button class="soft" data-unsuspend="${u.id}" data-name="${safe(u.username)}">Lift the suspension</button></span></div>`).join("") || `<p class="muted">Nobody is suspended. 🎉</p>`;
    // Someone whose face scan didn't agree with what they picked (or couldn't tell). They wait until you choose.
    const guess = g => g ? `the face scan guessed ${GENDERS[g].icon} ${GENDERS[g].name}` : "the face scan couldn't tell, or they couldn't do one";
    if (d && v.tab === "genders") body = `<p class="muted-note">These people are waiting. Choose Boy or Girl for each one, and they can use Yakimma straight away.</p>` +
      (d.users.map(u => `<div class="safety-row">${who(u)}<span class="row"><small>Picked ${GENDERS[u.wanted].icon} ${GENDERS[u.wanted].name}, but ${guess(u.guess)}</small>` +
        Object.entries(GENDERS).map(([g, x]) => `<button class="soft gender-small ${g}" data-set-gender="${u.id}" data-gender="${g}" data-name="${safe(u.username)}">${x.icon} ${x.name}</button>`).join("") + `</span></div>`).join("") || `<p class="muted">Nobody is waiting. 🎉</p>`);
    return top + `<section class="panel">${tabs}${filter}<div class="safety-list">${body}</div></section>`;
  }
  // Reading a chat on the Safety page, without being in it. Nobody can tell it was read.
  async function openSafetyChat(query, title) {
    const d = await api(`/api/safety/chat?${query}`);
    const msg = m => m.deleted ? `<div class="msg"><div class="msg-body"><div class="bubble deleted"><span class="b-text">🚫 ${safe(nameText(m.username))} deleted a message</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`
      : `<div class="msg">${personLink(m.userId, m.username, avatarHTML(m.avatar, "tiny"))}<div class="msg-body"><div class="bubble"><strong>${nameHTML(m.username)}</strong><span class="b-text">${richText(m.body)}</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal tagged-modal" role="dialog" aria-modal="true" aria-labelledby="safetyChatTitle"><div class="row between"><h2 id="safetyChatTitle">🛡️ ${safe(title)}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p class="muted-note">Only you can read this here. Tap someone's picture to open their profile (and suspend them if you need to).</p><div class="chat-log">${d.messages.map(msg).join("") || `<p class="muted">No messages.</p>`}</div></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    const log = $(".tagged-modal .chat-log"); log.scrollTop = log.scrollHeight;
  }
  // ---- Comments 💬: state.comments[postId] is { open, list, draft, replyTo, replyDraft } once someone opens a post's
  // comments. replyTo is the comment a reply box is open under; replies are one level deep, so replying to a reply
  // answers the same comment and starts with @their username.
  function commentsHTML(p) {
    const c = state.comments?.[p.id];
    if (!c?.open) return "";
    if (!c.list) return `<div class="comments"><p class="muted">Loading comments…</p></div>`;
    const reaction = (m, r) => `<button class="reaction ${r.mine ? "on" : ""}" data-comment-react="${safe(r.emoji)}" data-comment="${m.id}" data-post-of="${p.id}" title="${safe(r.users.join(", "))}" aria-pressed="${r.mine}" ${state.user ? "" : "disabled"}><span class="emoji">${safe(r.emoji)}</span>${r.count}</button>`;
    const item = (m, top) => `<div class="comment">${personLink(m.userId, m.username, avatarHTML(m.avatar, "tiny"))}<div class="comment-body">` +
      `<div class="comment-head">${personLink(m.userId, m.username, `<strong>${nameHTML(m.username)}</strong>`)}<small>${timeLabel(m.createdAt)}</small></div><p>${richText(m.body)}</p>` +
      `<div class="comment-tools">${m.reactions.map(r => reaction(m, r)).join("")}${state.user ? `<button class="link-btn" data-comment-pick="${m.id}" data-post-of="${p.id}">😊 React</button>` +
        `<button class="link-btn" data-comment-reply="${top.id}" data-post-of="${p.id}" ${m === top ? "" : `data-tag="${safe(m.username)}"`}>↩️ Reply</button>` : ""}` +
      `${m.canDelete ? `<button class="link-btn" data-comment-delete="${m.id}" data-post-of="${p.id}">🗑️ Delete</button>` : ""}${state.user && m.userId !== state.user.id && !isCreatorName(m.username) ? `<button class="link-btn" data-comment-report="${m.id}">🚩 Report</button>` : ""}</div></div></div>`;
    const replyBox = top => c.replyTo === top.id ? `<form class="comment-form reply-form row nowrap" data-comment-form="${p.id}" data-reply-to="${top.id}"><input aria-label="Reply to ${safe(nameText(top.username))}" maxlength="500" placeholder="Reply to ${safe(nameText(top.username))}…" autocomplete="off" value="${safe(c.replyDraft || "")}">` +
      `<button class="primary" type="submit">Reply</button><button class="soft" type="button" data-reply-cancel="${p.id}">Cancel</button></form>` : "";
    const thread = top => `<div class="thread">${item(top, top)}${top.replies.length || c.replyTo === top.id ? `<div class="replies">${top.replies.map(r => item(r, top)).join("")}${replyBox(top)}</div>` : ""}</div>`;
    return `<div class="comments">${c.list.length ? c.list.map(thread).join("") : `<p class="muted">No comments yet.${state.user ? " Be the first! 💬" : ""}</p>`}` +
      (state.user ? `<form class="comment-form row nowrap" data-comment-form="${p.id}"><input aria-label="Write a comment" maxlength="500" placeholder="Write a comment… type @ and a username to tag someone" autocomplete="off" value="${safe(c.draft || "")}"><button class="primary" type="submit">Send</button></form>`
        : `<p class="muted-note">Sign in to write a comment.</p>`) + `</div>`;
  }
  // Every copy of a post on the page (it can be in the feed, a profile, the playlist…), so its comment count stays right.
  const postCopies = id => [state.posts, state.groupView?.posts, state.person?.posts, state.playlist, state.myPosts?.posts, state.reports?.posts, state.single?.post && [state.single.post]]
    .flatMap(list => list || []).filter(x => x.id === id);
  function setComments(postId, d) {
    const c = (state.comments ||= {})[postId] ||= { open: true };
    c.list = d.comments;
    for (const x of postCopies(postId)) x.comments = d.count;
    render();
  }
  async function loadComments(postId) { setComments(postId, await api(`/api/posts/${postId}/comments`)); }
  async function toggleComments(postId) {
    const c = (state.comments ||= {})[postId] ||= {};
    c.open = !c.open; render();
    if (c.open) await loadComments(postId);
  }
  function postCard(p) {
    const video = p.mediaType?.startsWith("video/");
    const mine = state.user?.id === p.userId, who = `${avatarHTML(p.avatar)}<span><strong>${nameHTML(p.username)}</strong><br><small>${timeLabel(p.createdAt)}</small></span>`;
    const code = p.code && !p.inGroup ? `<p class="post-code">🔗 Code <code>${safe(p.code)}</code></p>` : "";
    // Tapping who posted it opens their profile (yours opens your Profile page). Guests can't open profiles.
    const author = !state.user ? `<span class="post-author">${who}</span>` : `<button class="post-author" ${mine ? `data-page="profile"` : `data-view-person="${p.userId}"`} title="See ${safe(nameText(p.username))}'s profile">${who}</button>`;
    const badge = (p.visibility && p.visibility !== "public" ? ` <span class="pill">${VISIBILITY.find(v => v[0] === p.visibility)[1]}</span>` : "") + (p.inGroup ? "" : audiencePill(p));
    return `<article class="panel post" data-post="${p.id}"><div class="posthead">${author}${badge}${state.user && state.user.id !== p.userId && !isCreatorName(p.username) ? `<button class="soft post-block" data-block="${p.userId}" data-name="${safe(p.username)}">🚫 Block</button>` : ""}</div>${postMedia(p)}<p>${richText(p.caption)}</p>${p.description ? `<div class="post-desc clamped">${richText(p.description)}</div>${p.description.length > 150 || p.description.includes("\n") ? `<button class="link-btn" data-desc-toggle="${p.id}">…more</button>` : ""}` : ""}<div class="actions"><button class="soft" data-like="${p.id}" ${!state.user || state.user.id===p.userId?"disabled":""}>${p.liked?"💗 Liked":"🤍 Like"} · ${p.likes}</button><button class="soft" data-comments="${p.id}" aria-expanded="${Boolean(state.comments?.[p.id]?.open)}">💬 Comment · ${p.comments ?? 0}</button>${state.user ? `<button class="soft" data-playlist="${p.id}" aria-pressed="${p.inPlaylist}">${p.inPlaylist ? "✓ In playlist" : "➕ Playlist"}</button>` : ""}${video ? viewerTool("speed", "⏩", "Speed", p.id) + viewerTool("effects", "✨", "Effects", p.id) : ""}${postTools(p)}</div><div class="viewer">${video ? viewerPanel(p.id) : ""}</div>${commentsHTML(p)}${code}</article>`;
  }
  function render() {
    applyTheme();
    syncMusic();
    wallet();
    if (pageGone(state.page) || (state.page === "reports" && !state.user?.admin) || (state.page === "safety" && !state.user?.creator)) state.page = "feed";
    if (state.page === "person" && !(state.user && state.person)) state.page = "friends";
    document.querySelectorAll(".nav").forEach(b => { b.classList.toggle("active", b.dataset.page === state.page); b.hidden = pageGone(b.dataset.page) || (b.dataset.page === "reports" && !state.user?.admin) || (b.dataset.page === "safety" && !state.user?.creator); });
    friendsBadge();
    // In the 18+ zone, Kuchisake-onna takes the place of Nails.
    $('.nav[data-page="nails"]').textContent = zoneOn() ? "👹 Kuchisake-onna" : "💅 Nails";
    screamButton();
    $("#cameraBtn").hidden = kidOn();
    stalk();
    let html = "";
    if (state.user?.suspended && !state.user.creator && state.page !== "rules") {
      html = suspendedPage();
    } else if (state.user && !state.user.gender && state.page !== "rules") {
      html = genderPage();
    } else if (state.page === "feed") {
      html = `<p class="home-name">Mahdiya Faiza Manha</p><p class="home-email">Email me: <a href="mailto:manharuwycse@gmail.com">manharuwycse@gmail.com</a></p>` +
      hero("The world you can show off", "Upload videos you already made, watch posts, and earn 10 MC when someone likes your post.", "WELCOME TO YAKIMMA") +
      `<section class="panel"><div class="row between"><div><h2>Welcome to your feed 🌸</h2><small>Be kind, be creative, and show off your style.</small></div><button class="primary" data-page="create">＋ Upload post</button></div></section>` + zoneBanner() +
      `<div class="feed">${state.posts.map(postCard).join("") || `<div class="panel empty">No posts yet. Sign in and share the first one! 🌸</div>`}</div>`;
    } else if (state.page === "create") {
      html = hero("Upload your moment", "Choose a video you already made or a photo. Yakimma does not record videos inside the website.", "CREATE A POST") +
      `<section class="panel"><h2>Make a post</h2>${!state.user?`<p>Please sign in before posting.</p><button class="primary" id="openAuth">Sign in / Create account</button>`:`<form id="postForm"><label for="postType">Post type</label><select id="postType"><option value="video">Video</option><option value="photo">Photo</option><option value="text">Text only</option></select><label for="media">Choose an existing photo or video</label><input id="media" name="media" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"><small>Maximum 100 MB per file in this starter. Uploads are stored on the server running this app.</small><fieldset class="thumb-box" id="thumbBox" hidden><legend>🖼️ Thumbnail</legend><p class="muted-note">This picture shows on your video before it plays. We picked a moment for you. Change it if you like.</p>${thumbPickerHTML()}</fieldset><label for="caption">Caption</label><textarea id="caption" maxlength="240" rows="3" required placeholder="Write something fun..."></textarea>` +
        `<label for="description">Description <small>(optional)</small></label><textarea id="description" maxlength="2000" rows="5" placeholder="Tell people more about your post"></textarea>` +
        `<fieldset class="visibility"><legend>Who can see it?</legend>${VISIBILITY.map(([id, label, about], i) => `<label class="vis-option"><input type="radio" name="visibility" value="${id}" ${i ? "" : "checked"}><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
        `<fieldset class="visibility"><legend>Who is it for? <small>(you have to choose)</small></legend>${AUDIENCE.map(([id, label, about]) => `<label class="vis-option"><input type="radio" name="audience" value="${id}" required><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
        `<div class="actions"><button class="primary" type="submit">Publish post ✨</button><button class="soft" type="button" data-page="feed">Cancel</button></div></form>`}</section>`;
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
      `<section class="panel"><div class="posthead">${state.user?`<button class="avatar-edit" data-view-avatar="me" aria-label="See your profile picture">${avatarHTML(state.user.avatar,"big")}<span class="avatar-edit-badge" aria-hidden="true">🔍</span></button>`:avatarHTML(null,"big")}<div><h2 style="margin:0">${state.user?nameHTML(state.user.username):"Guest"}</h2><small>${state.user?`🔢 Account number ${state.user.accountNumber}`:"Browsing as a guest"}</small></div></div>${state.user?`<div class="row"><span class="pill">🐱 ${state.user.mc} MC</span><span class="pill">💌 ${state.user.lc} LC</span><span class="pill">🎁 ${state.inventory.length} items</span><span class="pill">👯 ${state.social.friends.length} friend${state.social.friends.length===1?"":"s"}</span>${identityPills(state.user)}${followPills(state.user.id, state.social.follows?.followers ?? 0, state.social.follows?.following ?? 0, state.user.username)}</div>${assistantLines(state.user, true)}<div class="actions"><button class="soft" id="editAvatarBtn">🎨 Change picture</button><button class="soft" id="changeUsername">✏️ Change Username</button>${state.user.admin?`<button class="soft" id="changeDisplayName">🪪 Display name</button>`:""}<button class="soft" id="emailBtn">📧 Email</button><button class="danger" id="logout">Sign out</button></div>`:`<button class="primary" id="openAuth">Create account / Sign in</button>`}</section>${state.user?`<section class="panel"><h3>📲 Quick sign in</h3><p class="muted-note">Signing in on a new device? Tap <strong>📲 Quick sign in</strong> on it, then type the code it shows here and press <strong>✅ Confirm</strong>.</p><form class="quick-confirm" id="quickConfirmForm"><input id="quickConfirmCode" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code from new device" aria-label="Quick sign-in code from your new device"><button class="soft" type="submit">✅ Confirm</button></form></section>`:""}<section class="panel"><h3>My collection</h3>${state.inventory.length?[...state.products.filter(p=>state.inventory.includes(p.id)).map(p=>`${p.icon} ${safe(p.name)}`),...state.nailOptions.arts.filter(a=>a.item&&state.inventory.includes(a.item)).map(a=>`${a.icon} ${safe(a.name)} sticker`),...state.themes.filter(t=>t.gift&&state.inventory.includes(t.item)).map(t=>`${t.icon} ${safe(t.name)} theme`)].map(x=>`<span class="pill">${x}</span> `).join(""):`<p class="muted">Visit the shop to collect something cute.</p>`}</section>` +
      (state.user ? `<section class="panel"><h3>My nails 💅</h3>${receivedGallery(3)}</section>` + playlistSection() + myPostsSection() : "");
    } else if (state.page === "pictures") {
      html = picturesPage();
    } else if (state.page === "post") {
      html = postPage();
    } else if (state.page === "person") {
      html = personPage();
    } else if (state.page === "reports") {
      html = reportsPage();
    } else if (state.page === "learn") {
      html = learnPage();
    } else if (state.page === "about") {
      html = aboutPage();
    } else if (state.page === "ads") {
      html = adsPage();
    } else if (state.page === "safety") {
      html = safetyPage();
    } else if (state.page === "rules") {
      html = rulesPage();
    } else if (state.page === "settings") {
      html = settingsPage();
    }
    $("#main").innerHTML = notice() + html;
    applySpeeds();
    watchPeople();
    const log = $("#chatLog");
    if (log) log.scrollTop = log.scrollHeight;
  }
  // ---- 18+ zone 🔞: turned on in Settings after a few checks. The server keeps the zone's posts, groups and chats apart. ----
  const zoneOn = () => Boolean(state.user?.adult?.on);
  const kidOn = () => Boolean(state.user?.kid?.on);
  // Pages guests don't see, pages that aren't in the 18+ zone or the kiddy zone, and pages that are only in the kiddy
  // zone: they leave the menu, and links to them say so instead of opening them.
  const GUEST_GONE = ["pictures", "settings", "codes", "reports", "safety"], ZONE_GONE = ["shop", "codes", "about", "ads"];
  const KID_GONE = ["pictures", "groups", "codes", "about", "ads", "reports", "safety"], KID_ONLY = ["learn"];
  const pageGone = page => (!state.user && GUEST_GONE.includes(page)) || (zoneOn() && ZONE_GONE.includes(page)) || (kidOn() ? KID_GONE.includes(page) : KID_ONLY.includes(page));
  const goneNote = page => !state.user && GUEST_GONE.includes(page) ? `🔐 Sign in to use ${PAGE_NAMES[page]}.`
    : kidOn() ? `🧸 ${PAGE_NAMES[page]} isn't in the kiddy zone.` : KID_ONLY.includes(page) ? `🧸 ${PAGE_NAMES[page]} is only in the kiddy zone.`
    : `🔞 ${PAGE_NAMES[page]} isn't in the 18+ zone. Turn 18+ off in ⚙️ Settings to use it.`;
  // Turning the zone on or off changes what you see everywhere, so everything is loaded again.
  async function zoneChanged(user) {
    Object.assign(state, { user, chat: null, groupView: null, salon: null, groups: null, myPosts: null, playlist: null, kuchi: null, learn: null, person: null, friendSearch: null, people: null });
    await refresh();
    await loadPageData();
    render();
  }
  async function enteredZone(d) {
    closeModal();
    await zoneChanged(d.user);
    toast(`Welcome to the 18+ zone 👹${d.gift ? " You got the 🩸 Blood theme for free! It's yours to keep: find it in ⚙️ Settings." : ""}`);
  }
  // The steps to turn on 18+, in a pop-up: confirm, email, code, face scan. Someone who's already done the checks only confirms.
  function adultModal(step, info = {}) {
    const verified = state.user.adult.verified, number = { confirm: 1, email: 2, code: 3, face: 4 }[step];
    const body = {
      confirm: `<p>The 18+ zone is only for grown-ups. In it you only see 18+ posts and groups, and you can only talk to people who are 18+.</p><p><strong>Only go on if you are 18 or older.</strong></p><div class="actions"><button class="primary" id="adultYes">I'm 18 or older</button><button class="soft" id="adultCancel">Cancel</button></div>`,
      email: `<p>Type your email and we'll send you a 6-digit code.</p><form id="adultEmailForm"><label for="adultEmail">Email</label><input id="adultEmail" type="email" autocomplete="email" maxlength="254" required><div class="actions"><button class="primary" type="submit">Send my code</button></div></form>`,
      code: `<p>${info.testCode ? `Email isn't set up on this computer, so here's your code instead: <strong class="code-tag">${safe(info.testCode)}</strong>` : `We sent a code to <strong>${safe(info.email)}</strong>. It works for 10 minutes.`}</p><form id="adultCodeForm"><label for="adultCode">6-digit code</label><input id="adultCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><div class="actions"><button class="primary" type="submit">Check my code</button><button class="soft" type="button" id="adultBack">Use another email</button></div></form>`,
      face: `<p>Last step: a face scan to check you're 18+. Look straight at the camera with your face in the circle.</p><div class="face-box"><video id="faceVideo" playsinline muted></video><div class="face-ring" aria-hidden="true"></div></div><p class="muted-note" id="faceStatus" role="status">The scan happens on your device. Your camera picture never leaves it and isn't saved.</p><div class="actions"><button class="primary" id="faceStart">📷 Start face scan</button></div>` +
        // Some accounts can skip the scan with their username and password, but only on Yakimma running on this computer.
        (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? `<details class="face-skip"><summary>Skip the face scan</summary><form id="faceSkipForm"><label for="skipUser">Username</label><input id="skipUser" autocomplete="username" maxlength="20" required><label for="skipPass">Password</label><input id="skipPass" type="password" autocomplete="current-password" maxlength="200" required><div class="actions"><button class="soft" type="submit">Enter</button></div></form></details>` : "")
    }[step];
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal adult-modal" role="dialog" aria-modal="true" aria-labelledby="adultTitle"><div class="row between"><h2 id="adultTitle">🔞 ${step === "confirm" ? "Confirm you are 18+" : "Turn on 18+"}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${verified ? "" : `<p class="pill">Step ${number} of 4</p>`}${body}<p class="muted-note error-text" id="adultError" role="alert"></p></section></div>`;
    const fail = err => { if ($("#adultError")) $("#adultError").textContent = err.message; };
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    if (step === "confirm") {
      $("#adultCancel").onclick = closeModal;
      $("#adultYes").onclick = async () => {
        if (!verified) return adultModal("email");
        try { await enteredZone(await api("/api/adult", send("PUT", { on: true }))); } catch (err) { fail(err); }
      };
    }
    if (step === "email") $("#adultEmailForm").onsubmit = async e => {
      e.preventDefault();
      // The button waits while the email is sent, so pressing it again can't send a second code (only the newest works).
      const email = $("#adultEmail").value.trim(), btn = $("#adultEmailForm [type=submit]");
      btn.disabled = true; btn.textContent = "Sending…";
      try { const d = await api("/api/adult/email", send("POST", { email, confirm: true })); adultModal("code", { email, testCode: d.testCode }); }
      catch (err) { fail(err); btn.disabled = false; btn.textContent = "Send my code"; }
    };
    if (step === "code") {
      $("#adultBack").onclick = () => adultModal("email");
      $("#adultCodeForm").onsubmit = async e => {
        e.preventDefault();
        try { await api("/api/adult/code", send("POST", { code: $("#adultCode").value })); adultModal("face"); } catch (err) { fail(err); }
      };
    }
    if (step === "face") $("#faceStart").onclick = async () => {
      const btn = $("#faceStart");
      btn.disabled = true; fail({ message: "" });
      try {
        await enteredZone(await api("/api/adult/face", send("POST", { age: (await faceScan()).age })));
      } catch (err) {
        // A closed pop-up stops the scan, and there's nothing left to show the error in.
        if ($("#faceStart")) { fail(err); btn.disabled = false; btn.textContent = "📷 Try again"; }
      }
    };
    if (step === "face" && $("#faceSkipForm")) $("#faceSkipForm").onsubmit = async e => {
      e.preventDefault();
      try {
        await enteredZone(await api("/api/adult/face-skip", send("POST", { username: $("#skipUser").value.trim(), password: $("#skipPass").value })));
      } catch (err) { fail(err); }
    };
    if (step !== "face") $("#modalroot input")?.focus();
  }
  // ---- Kiddy zone 🧸: a zone for kids that a parent turns on in Settings. The server keeps its posts and chats apart,
  // and only the parent password turns it off. ----
  async function enteredKidZone(d) {
    closeModal();
    await zoneChanged(d.user);
    toast("Welcome to the kiddy zone 🧸 Have fun!");
  }
  // The steps in a pop-up: confirm, the parent's email, the code sent to it, the parent password, the parent's face, then
  // the child's and the parent's birth dates. Once a parent has set it up, turning it back on only needs the confirm (and
  // the birth dates, if it was set up before they were asked for). A forgotten password (`reset`) starts at the email
  // step, and the code goes to the parent's email.
  function kidModal(step, info = {}) {
    const ready = state.user.kid.ready, reset = Boolean(info.reset), number = { confirm: 1, email: 2, code: 3, password: 4, face: 5, born: 6 }[step];
    const today = new Date().toLocaleDateString("en-CA"), bornBack = Boolean(info.password);
    // A first setup offers the parent face scan (they can skip it). A new password keeps whatever face is saved.
    const offerFace = !reset;
    const body = {
      confirm: `<p>The kiddy zone is a safe part of Yakimma for kids. In it you only see posts made in the kiddy zone, you can only add and talk to friends who are in it too, and you only have Feed, Profile, Settings, Friends, Nails, Learn and the Shop.</p>` +
        `<p><strong>Once it's on, only a parent can turn it off or sign out.</strong>${ready ? "" : " A parent needs to do the next steps."}</p><div class="actions"><button class="primary" id="kidYes">${ready ? "Turn on the kiddy zone" : "I'm a parent, let's set it up"}</button><button class="soft" id="kidCancel">Cancel</button></div>`,
      email: reset
        ? `<p>We'll email a code to the parent who set up the kiddy zone. With it they can choose a new parent password.</p><div class="actions"><button class="primary" id="kidSend">Send the code</button></div>`
        : `<p>Parent: type your email and we'll send you a 6-digit code.</p><form id="kidEmailForm"><label for="kidEmail">Parent's email</label><input id="kidEmail" type="email" autocomplete="email" maxlength="254" required><div class="actions"><button class="primary" type="submit">Send the code</button></div></form>`,
      code: `<p>${info.testCode ? `Email isn't set up on this computer, so here's the code instead: <strong class="code-tag">${safe(info.testCode)}</strong>` : `We sent a code to ${reset ? "the parent's email" : `<strong>${safe(info.email)}</strong>`}. It works for 10 minutes.`}</p>` +
        `<form id="kidCodeForm"><label for="kidCode">6-digit code</label><input id="kidCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><div class="actions"><button class="primary" type="submit">Check the code</button><button class="soft" type="button" id="kidBack">${reset ? "Send a new code" : "Use another email"}</button></div></form>`,
      password: `<p>Parent: choose a ${reset ? "new " : ""}parent-only password. Only this password can turn the kiddy zone off, so keep it secret.</p>` +
        `<form id="kidPassForm"><label for="kidPass">Parent password</label><input id="kidPass" type="password" autocomplete="new-password" minlength="6" maxlength="200" required><label for="kidPass2">Type it again</label><input id="kidPass2" type="password" autocomplete="new-password" minlength="6" maxlength="200" required>` +
        `<div class="actions"><button class="primary" type="submit">${offerFace ? "Next" : "Save the new password"}</button></div></form>`,
      face: `<p>You can skip this step. Parent: scan your face so you can sign out of the kiddy zone with your face as well as the parent password. You can also do it later in ⚙️ Settings.</p>${faceBox()}` +
        `<div class="actions"><button class="primary" id="faceStart">📷 Scan the parent's face</button><button class="soft" id="kidSkipFace">Skip the face scan</button></div>`,
      born: `<p>${ready || reset ? "" : "Last step. "}Parent: fill in both birth dates. The kiddy zone can't be turned on without them.</p>` +
        `<form id="kidBornForm"><label for="childBirth">Child's birth date</label><input id="childBirth" type="date" min="1900-01-01" max="${today}" required>` +
        `<label for="parentBirth">Parent's birth date</label><input id="parentBirth" type="date" min="1900-01-01" max="${today}" required>` +
        `<p class="muted-note">🔒 This information will not be shared.</p>` +
        `<div class="actions"><button class="primary" type="submit">${reset ? "Save" : "Turn on the kiddy zone"}</button>${bornBack ? `<button class="soft" type="button" id="kidBornBack">← Back</button>` : ""}</div></form>`
    }[step];
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="kidTitle"><div class="row between"><h2 id="kidTitle">🧸 ${reset ? "New parent password" : "Turn on the kiddy zone"}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${ready || reset ? "" : `<p class="pill">Step ${number} of 6</p>`}${body}<p class="muted-note error-text" id="kidError" role="alert"></p></section></div>`;
    const fail = err => { if ($("#kidError")) $("#kidError").textContent = err.message; };
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    if (step === "confirm") {
      $("#kidCancel").onclick = closeModal;
      $("#kidYes").onclick = async () => {
        if (!ready) return kidModal("email");
        if (!state.user.kid.birthDates) return kidModal("born");
        try { await enteredKidZone(await api("/api/kid", send("PUT", { on: true }))); } catch (err) { fail(err); }
      };
    }
    // With `reset`, the server sends the code to the parent's email, so no email is given. The button waits while the
    // email is sent, so pressing it again can't send a second code (only the newest code works).
    const sendCode = async (email, btn) => {
      btn.disabled = true; btn.textContent = "Sending…"; fail({ message: "" });
      try { const d = await api("/api/kid/email", send("POST", { email })); kidModal("code", { reset, email, testCode: d.testCode }); }
      catch (err) { fail(err); btn.disabled = false; btn.textContent = "Send the code"; }
    };
    if (step === "email" && reset) $("#kidSend").onclick = () => sendCode(undefined, $("#kidSend"));
    if (step === "email" && !reset) $("#kidEmailForm").onsubmit = e => { e.preventDefault(); sendCode($("#kidEmail").value.trim(), $("#kidEmailForm [type=submit]")); };
    if (step === "code") {
      $("#kidBack").onclick = () => kidModal("email", { reset });
      $("#kidCodeForm").onsubmit = async e => {
        e.preventDefault();
        try { await api("/api/kid/code", send("POST", { code: $("#kidCode").value })); kidModal("password", { reset }); } catch (err) { fail(err); }
      };
    }
    const save = async body => {
      const d = await api("/api/kid/password", send("POST", body));
      if (!reset) return enteredKidZone(d);
      closeModal(); state.user = d.user; toast("The new parent password is saved 🔐");
    };
    if (step === "password") $("#kidPassForm").onsubmit = async e => {
      e.preventDefault();
      const password = $("#kidPass").value;
      if (password !== $("#kidPass2").value) return fail({ message: "The two passwords aren't the same. Type them again." });
      if (offerFace) return kidModal("face", { reset, password });
      if (!state.user.kid.birthDates) return kidModal("born", { reset, password });
      try { await save({ password }); } catch (err) { fail(err); }
    };
    // The face scan (if they do it) is saved with the birth dates, on the last step.
    if (step === "face") $("#faceStart").onclick = async () => {
      const btn = $("#faceStart");
      btn.disabled = true; fail({ message: "" });
      try { const { age, face } = await faceScan(true); kidModal("born", { password: info.password, face, age }); }
      catch (err) { if ($("#faceStart")) { fail(err); btn.disabled = false; btn.textContent = "📷 Try again"; } }
    };
    if (step === "face") $("#kidSkipFace").onclick = () => { stopCamera(); kidModal("born", { password: info.password }); };
    // The birth dates come after the face scan in a first setup, after the new password for a reset, or on their own
    // when an account set up before they were asked for goes back in.
    if (step === "born") {
      if (bornBack) $("#kidBornBack").onclick = () => reset ? kidModal("password", { reset }) : kidModal("face", { password: info.password });
      $("#kidBornForm").onsubmit = async e => {
        e.preventDefault();
        const dates = { childBirthDate: $("#childBirth").value, parentBirthDate: $("#parentBirth").value };
        try { info.password ? await save({ password: info.password, face: info.face, age: info.age, ...dates }) : await enteredKidZone(await api("/api/kid", send("PUT", { on: true, ...dates }))); }
        catch (err) { fail(err); }
      };
    }
    if (step !== "face") $("#modalroot input")?.focus();
  }
  const faceBox = () => `<div class="face-box"><video id="faceVideo" playsinline muted></video><div class="face-ring" aria-hidden="true"></div></div>` +
    `<p class="muted-note" id="faceStatus" role="status">The scan happens on this device and the camera picture is never saved. Yakimma only keeps numbers that describe the parent's face, to recognise it.</p>`;
  // Only a parent can sign out of the kiddy zone, with the parent password or (if one is saved) their face.
  function kidSignOut() {
    askParent("🧸 Sign out", `Only a parent can sign out of the kiddy zone. Parent: type the parent password${state.user.kid.face ? " or scan your face" : ""}.`, async proof => {
      await api("/api/logout", send("POST", proof));
      closeModal(); await signedOut();
    }, { face: true });
  }
  // Saving the parent's face (a new one, or the first one if they skipped it), with the parent password.
  function kidFaceModal() {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="kidTitle"><div class="row between"><h2 id="kidTitle">🧸 Save the parent's face</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>Parent: type the parent password, then scan your face. After that you can sign out of the kiddy zone with your face as well as the parent password.</p>` +
      `<label for="kidFacePass">Parent password</label><input id="kidFacePass" type="password" autocomplete="current-password" maxlength="200">` +
      `${faceBox()}<div class="actions"><button class="primary" id="faceStart">📷 Scan the parent's face</button></div><p class="muted-note error-text" id="kidError" role="alert"></p></section></div>`;
    const fail = err => { if ($("#kidError")) $("#kidError").textContent = err.message; };
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#faceStart").onclick = async () => {
      const btn = $("#faceStart"), password = $("#kidFacePass").value;
      if (!password) return fail({ message: "Type the parent password first." });
      btn.disabled = true; fail({ message: "" });
      try {
        const { age, face } = await faceScan(true);
        const d = await api("/api/kid/face", send("PUT", { password, face, age }));
        closeModal(); state.user = d.user; toast("The parent's face is saved 🔐");
      } catch (err) {
        if ($("#faceStart")) { fail(err); btn.disabled = false; btn.textContent = "📷 Try again"; }
      }
    };
    $("#kidFacePass").focus();
  }
  // Changing your username: only the capital letters (free), or a whole new one (state.usernameCost MC).
  function usernameModal(whole) {
    const u = state.user, cost = state.usernameCost;
    const body = whole === undefined
      ? `<p>What do you want to change?</p><div class="grade-list"><button class="soft" data-username-mode="case">🔠 Change Capitalization? <small>Free</small></button>` +
        `<button class="soft" data-username-mode="whole">✨ Change Whole Username? <small>${cost} MC · you have ${u.mc} MC</small></button></div>`
      : `<p>${whole ? `A whole new username costs <strong>${cost} MC</strong>. You can't copy someone else's username.` : `Change which letters are capitals, like <strong>${safe(u.username.toLowerCase())}</strong> to <strong>${safe(u.username[0].toUpperCase() + u.username.slice(1).toLowerCase())}</strong>. It's free.`}</p>` +
        `<form id="usernameForm"><label for="newUsername">New username</label><input id="newUsername" maxlength="20" autocomplete="off" required value="${whole ? "" : safe(u.username)}">` +
        `<p class="muted-note">Only letters and numbers, 3 to 20 of them, with no spaces.</p><div class="actions"><button class="primary" type="submit">${whole ? `Change it for ${cost} MC` : "Change it"}</button><button class="soft" type="button" id="usernameBack">← Back</button></div></form>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="usernameTitle"><div class="row between"><h2 id="usernameTitle">✏️ Change Username</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${body}<p class="muted-note error-text" id="usernameError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    for (const btn of document.querySelectorAll("[data-username-mode]")) btn.onclick = () => usernameModal(btn.dataset.usernameMode === "whole");
    if (whole === undefined) return;
    $("#usernameBack").onclick = () => usernameModal();
    $("#usernameForm").onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await api("/api/me/username", send("PUT", { username: $("#newUsername").value.trim(), whole }));
        closeModal(); state.user = d.user;
        toast(`Your username is now ${d.user.username}! ✏️${whole ? ` (${cost} MC)` : ""}`);
      } catch (err) { $("#usernameError").textContent = err.message; }
    };
    $("#newUsername").focus();
  }
  // A nickname for a friend that only you see, shown instead of their name everywhere. Empty takes it off.
  function nicknameModal(friendId, username) {
    const current = state.social.nicknames?.[username.toLowerCase()] || "";
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="nicknameTitle"><div class="row between"><h2 id="nicknameTitle">🏷️ Nickname for @${safe(username)}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>Give your friend a nickname that <strong>only you</strong> can see. It shows instead of their name everywhere on Yakimma, just for you. Everyone else still sees their normal name.</p>` +
      `<form id="nicknameForm"><label for="newNickname">Nickname</label><input id="newNickname" maxlength="60" autocomplete="off" value="${safe(current)}">` +
      `<p class="muted-note">Up to 30 characters. Spaces and emojis are fine. Leave it empty to take the nickname off.</p><div class="actions"><button class="primary" type="submit">Save</button></div></form>` +
      `<p class="muted-note error-text" id="nicknameError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#nicknameForm").onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await api(`/api/friends/${friendId}/nickname`, send("PUT", { nickname: $("#newNickname").value }));
        state.social.nicknames = d.nicknames; closeModal();
        const nick = d.nicknames[username.toLowerCase()];
        toast(nick ? `Only you see ${username} as ${nick}. 🏷️` : `${username}'s nickname is gone. 🏷️`);
      } catch (err) { $("#nicknameError").textContent = err.message; }
    };
    $("#newNickname").focus();
  }
  // ---- 📜 Rules: on their own page under Settings. Change them here: [icon, rule, more about it, what can happen]. ----
  const RULES = [
    ["🎬", "Do not put the wrong videos in the wrong zone", "Example: you put an inappropriate video in the kiddy zone.", "Your account may get a 3-day suspension."],
    ["🛑", "Do NOT harass people", "It may make people sad.", "It can cause a 5-day suspension."],
    ["😊", "Stay friendly", "Do not make arguments."],
    ["💖", "Be kind", "No bullying, mean words, or making fun of anyone."],
    ["🔐", "Keep private things private", "Never share your password, your address, your phone number or your school."],
    ["🙅", "Be yourself", "Don't pretend to be someone else, and don't copy other people's usernames."],
    ["📸", "Only post what's yours", "Post photos and videos you made, or that you're allowed to share."],
    ["📢", "No spam", "Don't post the same thing again and again, or beg people for likes or MC."],
    ["🚩", "Report it, don't fight it", "If you see something bad, tap 🚩 Report and the admins will look at it."],
    ["🤥", "False reporting can cause suspensions", "Be careful! Lying is bad!", "It can cause a suspension."],
    ["🛠️", "The admins keep Yakimma safe", "They can delete posts, comments, messages and groups that break the rules."]
  ];
  function rulesPage() {
    return hero("Read The Rules!! 📜", "Everyone on Yakimma follows these rules, so it stays fun and safe for everyone.", "RULES") +
      `<section class="panel"><ol class="rules">${RULES.map(([icon, title, about, penalty]) => `<li><span class="rule-icon" aria-hidden="true">${icon}</span><div><strong>${safe(title)}</strong><p>${safe(about)}</p>${penalty ? `<p class="rule-penalty">⚠️ ${safe(penalty)}</p>` : ""}</div></li>`).join("")}</ol>` +
      `<p class="notice">🛡️ To keep Yakimma safe, the creator can see every chat, comment and post, even private ones, and can suspend accounts that break the rules.</p></section>`;
  }
  // Right after making an account, a pop-up in front of everything sends you to the rules.
  function readTheRules() {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rulesTitle">` +
      `<div class="rules-pop" aria-hidden="true">📜</div><h2 id="rulesTitle">Read The Rules!!</h2><p>Before you start, read Yakimma's rules. They keep Yakimma fun and safe for everyone.</p>` +
      `<div class="actions"><button class="primary" id="goRules">📜 Read the rules</button></div></section></div>`;
    $("#goRules").onclick = () => { closeModal(); Object.assign(state, { page: "rules", notice: "", chat: null, groupView: null }); render(); window.scrollTo(0, 0); };
    $("#goRules").focus();
  }
  // Admins (the creator too) can have a display name as well as their username.
  function displayNameModal() {
    const u = state.user, current = state.displayNames[u.username.toLowerCase()] || "";
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="displayNameTitle"><div class="row between"><h2 id="displayNameTitle">🪪 Display name</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>As an admin, you can have a display name as well as your username. Everyone sees your display name first, with <strong>@${safe(u.username)}</strong> after it.</p>` +
      `<form id="displayNameForm"><label for="newDisplayName">Display name</label><input id="newDisplayName" maxlength="60" autocomplete="off" value="${safe(current)}">` +
      `<p class="muted-note">Up to 30 characters. Spaces and emojis are fine. Leave it empty to only show your username.</p><div class="actions"><button class="primary" type="submit">Save</button></div></form>` +
      `<p class="muted-note error-text" id="displayNameError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#displayNameForm").onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await api("/api/me/display-name", send("PUT", { displayName: $("#newDisplayName").value }));
        closeModal(); state.user = d.user; state.displayNames = d.displayNames; wallet(); render();
        const shown = d.displayNames[u.username.toLowerCase()];
        toast(shown ? `Your display name is now ${shown}! 🪪` : "Your display name is gone. Everyone sees your username. 🪪");
      } catch (err) { $("#displayNameError").textContent = err.message; }
    };
    $("#newDisplayName").focus();
  }
  async function signedOut() {
    Object.assign(state, { groupView: null, chat: null, myPosts: null, playlist: null, pictures: null, learn: null, person: null, friendSearch: null, people: null });
    await refresh();
    state.page = "feed";
    toast("You're signed out. See you soon! 👋");
  }
  // The face scan's library (with its models) is only downloaded when someone starts a scan.
  let faceLib = null, faceStream = null;
  const FACE_SURE = 0.75;
  const loadFaceLib = () => faceLib ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/face-api.js";
    s.onload = () => resolve(window.faceapi);
    s.onerror = () => { s.remove(); reject(new Error("The face scan couldn't start. Check your connection and try again.")); };
    document.head.append(s);
  }).then(async faceapi => {
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri("/vendor/face-model"), faceapi.nets.ageGenderNet.loadFromUri("/vendor/face-model")]);
    return faceapi;
  }).catch(err => { faceLib = null; throw err; });
  // Recognising a face (the kiddy zone's parent) needs two more models, only downloaded the first time.
  let faceRecLib = null;
  const loadFaceRecognition = () => faceRecLib ||= loadFaceLib().then(async faceapi => {
    await Promise.all([faceapi.nets.faceLandmark68Net.loadFromUri("/vendor/face-model"), faceapi.nets.faceRecognitionNet.loadFromUri("/vendor/face-model")]);
    return faceapi;
  }).catch(() => { faceRecLib = null; throw new Error("The face scan couldn't start. Check your connection and try again."); });
  const stopCamera = () => { faceStream?.getTracks().forEach(t => t.stop()); faceStream = null; };
  // Looks for your face a few times a second and keeps 10 guesses of your age. The middle guess is the answer.
  // It also gives `gender`: "boy" or "girl" when the 10 looks mostly agree (FACE_SURE), or null when it can't tell.
  // With `recognize`, it also gives `face`: 128 numbers that describe the face, averaged over the 10 looks.
  async function faceScan(recognize = false) {
    const say = text => { const el = $("#faceStatus"); if (!el) throw new Error("closed"); el.textContent = text; };
    say("Getting the camera ready…");
    try { faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }); }
    catch { throw new Error("Let Yakimma use your camera to do the face scan. Check the camera permission in your browser."); }
    try {
      const video = $("#faceVideo");
      if (!video) throw new Error("closed");
      video.srcObject = faceStream;
      await video.play();
      say("Getting the face scan ready…");
      const faceapi = await (recognize ? loadFaceRecognition() : loadFaceLib()), options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }), ages = [], looks = [], boyish = [];
      for (let tries = 0; ages.length < 10 && tries < 100; tries++) {
        if (!$("#faceVideo")) throw new Error("closed");
        const found = faceapi.detectSingleFace(video, options);
        const face = await (recognize ? found.withFaceLandmarks().withAgeAndGender().withFaceDescriptor() : found.withAgeAndGender());
        if (face) { ages.push(face.age); boyish.push(face.gender === "male" ? face.genderProbability : 1 - face.genderProbability); if (recognize) looks.push(face.descriptor); }
        say(face ? `Scanning… ${ages.length * 10}%` : "Can't see your face. Look straight at the camera, somewhere bright.");
        await new Promise(r => setTimeout(r, 150));
      }
      if (ages.length < 10) throw new Error("The face scan couldn't see your face well enough. Try again somewhere brighter.");
      say("Done!");
      const face = recognize ? Array.from(looks[0], (_, i) => looks.reduce((sum, look) => sum + look[i], 0) / looks.length) : null;
      const boy = boyish.reduce((sum, b) => sum + b, 0) / boyish.length;
      return { age: ages.sort((a, b) => a - b)[ages.length >> 1], face, gender: boy >= FACE_SURE ? "boy" : boy <= 1 - FACE_SURE ? "girl" : null };
    } finally { stopCamera(); }
  }

  // ---- Learn! 📚: a quiz game in the kiddy zone, 10 questions a round. For each subject a parent chooses the class
  // (1 to 9) and where the child is from with the parent password, and Islam opens once a parent verifies. The server
  // keeps those choices (state.learnData); the quizzes are made here. ----
  const LEARN_SUBJECTS = [
    { id: "math", name: "Math", icon: "➗" },
    { id: "english", name: "English", icon: "🔤" },
    { id: "science", name: "Science", icon: "🔬" },
    // Faith subjects (with `who`) only open for accounts of that religion, once a parent verifies them with the parent
    // password.
    { id: "islam", name: "Islam", icon: "☪️", who: "a Muslim", note: "(If You are a Muslim Verify By a Parent)" },
    { id: "christianity", name: "Christianity", icon: "✝️", who: "a Christian", note: "(If You are a Christian Verify By a Parent)" }
  ];
  const REGION_NAMES = { asia: "🌏 Asia", western: "🌍 Western" }, QUIZ_LENGTH = 10;
  // Names and things for questions, from the child's region.
  const LEARN_NAMES = { asia: ["Ayesha", "Rahim", "Fatima", "Arif", "Nadia", "Karim"], western: ["Emma", "Jack", "Olivia", "Noah", "Mia", "Leo"] };
  const LEARN_THINGS = { asia: ["mangoes", "bananas", "lychees"], western: ["apples", "cookies", "strawberries"] };
  const levelLabel = l => `Class ${l.grade} · ${REGION_NAMES[l.region]}`;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const num = n => (n < 0 ? "−" : "") + (Number.isInteger(n) ? Math.abs(n) : Math.abs(n).toFixed(1));
  // Three wrong answers near the right one (`step` apart), never below zero unless the answer is.
  function nearby(answer, step = 1) {
    const wrong = new Set();
    while (wrong.size < 3) {
      const w = Math.round((answer + pick([-3, -2, -1, 1, 2, 3, 10, -10]) * step) * 10) / 10;
      if (w !== answer && (w >= 0 || answer < 0)) wrong.add(w);
    }
    return [...wrong];
  }
  const LEARN_EMOJI = { asia: ["🥭", "🍌", "⭐"], western: ["🍎", "🍪", "⭐"] };
  // Money for questions: Asia uses taka and poisha, Western uses dollars and pennies (100 make 1 of the big ones).
  const LEARN_MONEY = { asia: { one: "taka", many: "taka", coins: "poisha" }, western: { one: "dollar", many: "dollars", coins: "pennies" } };
  const clockTime = (h, m) => `${h}:${String(m).padStart(2, "0")}`;
  // A clock face showing h:m, for reading the time. Both hands stop short of the numbers so they stay easy to read.
  function clockSVG(h, m) {
    const at = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [(60 + r * Math.cos(a)).toFixed(1), (60 + r * Math.sin(a)).toFixed(1)]; };
    const line = (deg, from, to, cls) => { const [x1, y1] = at(deg, from), [x2, y2] = at(deg, to); return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; };
    const ticks = Array.from({ length: 60 }, (_, i) => line(i * 6, i % 5 ? 52 : 48, 55, i % 5 ? "tick" : "tick five")).join("");
    const numbers = Array.from({ length: 12 }, (_, i) => { const [x, y] = at((i + 1) * 30, 40); return `<text x="${x}" y="${y}">${i + 1}</text>`; }).join("");
    return `<svg class="learn-clock" viewBox="0 0 120 120" role="img" aria-label="A clock"><circle class="face" cx="60" cy="60" r="56"/>${ticks}${numbers}` +
      `${line(h % 12 * 30 + m / 2, 0, 22, "hour")}${line(m * 6, 0, 33, "minute")}<circle class="pin" cx="60" cy="60" r="3"/></svg>`;
  }
  // A clock to read, on the 5-minute marks. The wrong answers are the usual mistakes: mixing up the hands, reading the
  // number the minute hand points to as the minutes, and an hour off.
  function clockQuestion() {
    const h = rnd(1, 12), m = 5 * rnd(0, 11), right = clockTime(h, m);
    const wrongs = new Set([clockTime(m / 5 || 12, h * 5 % 60), clockTime(h, m / 5), clockTime(h % 12 + 1, m)]);
    wrongs.delete(right);
    while (wrongs.size < 3) { const w = clockTime(rnd(1, 12), 5 * rnd(0, 11)); if (w !== right) wrongs.add(w); }
    return { q: "What time does the clock show?", pic: clockSVG(h, m), right, wrongs: [...wrongs].slice(0, 3) };
  }
  // One made-up Math question for a class. Each kind gives [question, answer, the step between wrong answers], or
  // { q, right, wrongs } when the answers aren't numbers (and `pic` for a picture). Classes 1 and 2 are different for
  // each region. Class 1: Asia learns times tables 1 to 10 and hard sums; Western learns odd and even, simple sums and
  // counting from 1 to 120. Class 2: Asia learns times tables 3 to 15, 3-digit sums and multiplying, money, meters and
  // centimeters, and clocks; Western learns hundreds, tens and ones, money, and clocks. Clocks are read with the 5 times table.
  function mathQuestion(grade, region) {
    const name = pick(LEARN_NAMES[region]), things = pick(LEARN_THINGS[region]), M = LEARN_MONEY[region];
    const oneOf = (...makers) => () => pick(makers)();
    const money = oneOf(
      () => [`How many ${M.coins} make 1 ${M.one}?`, 100, 10],
      () => { const a = rnd(1, 9), c = rnd(1, 99); return [`${a} ${a === 1 ? M.one : M.many} and ${c} ${M.coins} = how many ${M.coins}?`, a * 100 + c]; },
      () => { const a = rnd(10, 50), b = rnd(5, 45); return [`${name} has ${a} ${M.coins} and gets ${b} more. How many ${M.coins} does ${name} have now?`, a + b]; },
      () => { const p = rnd(5, 95); return [`A pencil costs ${p} ${M.coins}. ${name} pays with 1 ${M.one} (100 ${M.coins}). How many ${M.coins} change does ${name} get?`, 100 - p]; },
      () => { const a = rnd(2, 40), b = rnd(2, 40); return [`${name} buys a toy for ${a} ${M.many} and a book for ${b} ${M.many}. How many ${M.many} is that altogether?`, a + b]; }
    );
    const clock = oneOf(
      clockQuestion,
      () => { const k = rnd(1, 11); return [`The minute hand points to ${k}. How many minutes past the hour is it? (Count in 5s!)`, k * 5, 5]; },
      () => { const k = rnd(3, 11); return [`Count in 5s: ${(k - 2) * 5}, ${(k - 1) * 5}, __, ${(k + 1) * 5}`, k * 5, 5]; },
      () => [`How many minutes are in 1 hour?`, 60, 10]
    );
    const measure = oneOf(
      () => [`How many centimeters are in 1 meter?`, 100, 10],
      () => { const m = rnd(1, 9), c = rnd(1, 99); return [`${m} m ${c} cm = how many cm?`, m * 100 + c]; },
      () => { const m = rnd(2, 9); return [`A ribbon is ${m} meters long. How many centimeters is that?`, m * 100]; },
      () => {
        const cm = rnd(101, 999), m = Math.floor(cm / 100), c = cm % 100, say = (m, c) => `${m} m ${c} cm`, right = say(m, c);
        const wrongs = new Set([say(c, m), say(m + 1, c), say(Math.floor(cm / 10), cm % 10), say(m, (c + 10) % 100)]);
        wrongs.delete(right);
        return { q: `${cm} cm = how many m and cm?`, right, wrongs: [...wrongs].slice(0, 3) };
      }
    );
    // Hundreds, tens and ones, with three different digits so "the 3" always means one place.
    const digits = () => shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3), join = ([a, b, c]) => a * 100 + b * 10 + c;
    const mixedUp = d => shuffle([[d[0], d[2], d[1]], [d[1], d[0], d[2]], [d[1], d[2], d[0]], [d[2], d[0], d[1]], [d[2], d[1], d[0]]]).slice(0, 3).map(x => String(join(x)));
    const placeValue = oneOf(
      () => { const d = digits(), i = rnd(0, 2), worth = d[i] * [100, 10, 1][i]; return { q: `In ${join(d)}, what is the ${d[i]} worth?`, right: String(worth), wrongs: [d[i], d[i] * 10, d[i] * 100, d[i] * 1000].filter(w => w !== worth).map(String) }; },
      () => {
        const d = digits(), i = rnd(0, 2), spare = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(n => !d.includes(n) && Math.random() < 0.5) || [1, 2, 3, 4, 5, 6, 7, 8, 9].find(n => !d.includes(n));
        return { q: `In ${join(d)}, which digit is in the ${["hundreds", "tens", "ones"][i]} place?`, right: String(d[i]), wrongs: [...d.filter((_, j) => j !== i), spare].map(String) };
      },
      () => { const d = digits(); return { q: `Which number has ${d[0]} hundreds, ${d[1]} tens and ${d[2]} ones?`, right: String(join(d)), wrongs: mixedUp(d) }; },
      () => { const d = digits(); return { q: `${d[0] * 100} + ${d[1] * 10} + ${d[2]} = ?`, right: String(join(d)), wrongs: mixedUp(d) }; }
    );
    const kinds = {
      1: region === "asia" ? [
        () => { const a = rnd(1, 10), b = rnd(1, 10); return [`${a} × ${b} = ?`, a * b]; },
        () => { const a = rnd(1, 10), b = rnd(1, 10); return [`What is the missing number? ${a} × __ = ${a * b}`, b]; },
        () => { const a = rnd(2, 10), b = rnd(2, 10); return [`${name} has ${a} bags with ${b} ${things} in each bag. How many ${things} is that?`, a * b]; },
        () => { const a = rnd(25, 89), b = rnd(15, 89); return [`${a} + ${b} = ?`, a + b]; },
        () => { const a = rnd(40, 99), b = rnd(11, a - 5); return [`${a} − ${b} = ?`, a - b]; }
      ] : [
        () => { const n = rnd(1, 120); return { q: `Is ${n} odd or even?`, right: n % 2 ? "Odd" : "Even", wrongs: [n % 2 ? "Even" : "Odd"] }; },
        () => {
          const even = Math.random() < 0.5, of = want => { let n; do n = rnd(1, 120); while ((n % 2 === 0) !== want); return n; };
          const right = of(even), wrongs = new Set();
          while (wrongs.size < 3) wrongs.add(of(!even));
          return { q: `Which number is ${even ? "even" : "odd"}?`, right: String(right), wrongs: [...wrongs].map(String) };
        },
        () => { const a = rnd(0, 9), b = rnd(1, 10 - a); return [`${a} + ${b} = ?`, a + b]; },
        () => { const a = rnd(2, 10), b = rnd(1, a); return [`${a} − ${b} = ?`, a - b]; },
        () => { const n = rnd(1, 119); return [`What number comes after ${n}?`, n + 1]; },
        () => { const n = rnd(2, 120); return [`What number comes before ${n}?`, n - 1]; },
        () => { const n = rnd(1, 117); return [`What number is missing? ${n}, ${n + 1}, __, ${n + 3}`, n + 2]; },
        () => { const n = rnd(3, 20), e = pick(LEARN_EMOJI[region]); return [`How many ${e} are there? ${e.repeat(n)}`, n]; }
      ],
      2: region === "asia" ? [
        oneOf(
          () => { const a = rnd(3, 15), b = rnd(1, 10); return [`${a} × ${b} = ?`, a * b]; },
          () => { const a = rnd(3, 15), b = rnd(1, 10); return [`What is the missing number? ${a} × __ = ${a * b}`, b]; }),
        () => { const a = rnd(101, 999), b = rnd(2, 9); return [`${a} × ${b} = ?`, a * b, 10]; },
        oneOf(
          () => { const a = rnd(100, 899), b = rnd(100, 899); return [`${a} + ${b} = ?`, a + b, 10]; },
          () => { const a = rnd(300, 999), b = rnd(100, a - 50); return [`${a} − ${b} = ?`, a - b, 10]; }),
        money, measure, clock
      ] : [placeValue, money, clock],
      3: [
        () => { const a = rnd(2, 10), b = rnd(2, 10); return [`${a} × ${b} = ?`, a * b]; },
        () => { const a = rnd(2, 10), b = rnd(2, 10); return [`${a * b} ÷ ${a} = ?`, b]; },
        () => { const a = rnd(2, 6), b = rnd(3, 9); return [`${name} has ${a} bags with ${b} ${things} in each bag. How many ${things} is that?`, a * b]; }
      ],
      4: [
        () => { const a = rnd(100, 600), b = rnd(100, 399); return [`${a} + ${b} = ?`, a + b]; },
        () => { const a = rnd(300, 999), b = rnd(100, a); return [`${a} − ${b} = ?`, a - b]; },
        () => { const a = rnd(11, 49), b = rnd(2, 9); return [`${a} × ${b} = ?`, a * b]; },
        () => { const a = rnd(101, 989); return [`Round ${a} to the nearest 10.`, Math.round(a / 10) * 10, 10]; }
      ],
      5: [
        () => { const d = pick([2, 3, 4, 5]), n = d * rnd(2, 10); return [`What is 1/${d} of ${n}?`, n / d]; },
        () => { const n = 4 * rnd(2, 10); return [`What is 3/4 of ${n}?`, n * 3 / 4]; },
        () => { const a = rnd(11, 59) / 10, b = rnd(11, 39) / 10; return [`${num(a)} + ${num(b)} = ?`, Math.round((a + b) * 10) / 10, 0.1]; },
        () => { const w = rnd(3, 12), h = rnd(2, 9); return [`A rectangle is ${w} cm long and ${h} cm wide. What is its area in cm²?`, w * h]; }
      ],
      6: [
        () => { const p = pick([10, 20, 25, 50]), n = pick([20, 40, 60, 80, 100, 120, 200]); return [`What is ${p}% of ${n}?`, n * p / 100]; },
        () => { const a = rnd(2, 9), b = rnd(10, 20); return [`−${a} + ${b} = ?`, b - a]; },
        () => { const a = rnd(2, 9), b = rnd(2, 9); return [`−${a} × ${b} = ?`, -a * b]; },
        () => { const a = rnd(1, 3), b = a + rnd(1, 3), k = rnd(2, 6); return [`Share ${(a + b) * k} ${things} in the ratio ${a}:${b}. How many are in the bigger share?`, b * k]; }
      ],
      7: [
        () => { const x = rnd(2, 20), a = rnd(2, 15); return [`Solve: x + ${a} = ${x + a}. What is x?`, x]; },
        () => { const x = rnd(2, 12), a = rnd(2, 9); return [`Solve: ${a}x = ${a * x}. What is x?`, x]; },
        () => { const a = rnd(2, 9), b = rnd(2, 9), c = rnd(2, 9); return [`${a} + ${b} × ${c} = ?`, a + b * c]; },
        () => { const a = rnd(2, 9), b = rnd(2, 9), c = rnd(2, 9); return [`(${a} + ${b}) × ${c} = ?`, (a + b) * c]; }
      ],
      8: [
        () => { const a = rnd(11, 20); return [`What is ${a}²?`, a * a]; },
        () => { const a = rnd(4, 15); return [`What is √${a * a}?`, a]; },
        () => { const x = rnd(2, 12), a = rnd(2, 9), b = rnd(1, 20); return [`Solve: ${a}x + ${b} = ${a * x + b}. What is x?`, x]; },
        () => { const n = rnd(3, 8); return [`What is 2 to the power of ${n}?`, 2 ** n]; }
      ],
      9: [
        () => { const x = rnd(1, 9), a = rnd(2, 6), b = rnd(1, 9); return [`Solve: ${a}(x + ${b}) = ${a * (x + b)}. What is x?`, x]; },
        () => { const [p, q, r] = pick([[3, 4, 5], [5, 12, 13], [8, 15, 17]]), k = p === 3 ? rnd(1, 4) : 1; return [`A right-angled triangle's two short sides are ${p * k} cm and ${q * k} cm. How long is the longest side, in cm?`, r * k]; },
        () => { const a = rnd(1, 9), b = rnd(1, 9); return [`(x + ${a})(x + ${b}) = x² + ?x + ${a * b}. Which number is the ?`, a + b]; },
        () => { const a = rnd(4, 15); return [`If x² = ${a * a} and x is positive, what is x?`, a]; }
      ]
    };
    const made = pick(kinds[grade])();
    if (!Array.isArray(made)) return made;
    const [q, answer, step = 1] = made;
    return { q, right: num(answer), wrongs: nearby(answer, step).map(num) };
  }
  // English, Science, Islam and Christianity questions come from learn-questions.json, downloaded the first time they're needed.
  let learnBank = null;
  const loadLearnBank = () => learnBank ||= fetch("/learn-questions.json").then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .catch(() => { learnBank = null; throw new Error("The questions couldn't load. Check your connection and try again."); });
  // Asia is harder and Western is easier in every subject: about half of each quiz comes from a level up (Asia) or a
  // level down (Western), where there is one. Math Classes 1 and 2 already have their own Asia and Western questions,
  // so for Math it's from Class 3 up.
  const LEARN_BANDS = ["1", "4", "7"];
  async function startQuiz(subject) {
    const level = state.learnData.levels[subject], seen = new Map(), step = level.region === "asia" ? 1 : -1;
    if (subject === "math") for (let tries = 0; seen.size < QUIZ_LENGTH && tries < 100; tries++) {
      const grade = tries % 2 && level.grade >= 3 ? Math.min(9, level.grade + step) : level.grade, m = mathQuestion(grade, level.region);
      seen.set(m.q + m.right, m);
    }
    else {
      const bank = await loadLearnBank(), mine = Math.floor((level.grade - 1) / 3), other = Math.min(2, Math.max(0, mine + step));
      const from = (band, n) => shuffle(bank[subject][LEARN_BANDS[band]].filter(q => !q[5] || q[5] === level.region)).slice(0, n);
      const chosen = other === mine ? from(mine, QUIZ_LENGTH) : [...from(mine, QUIZ_LENGTH / 2), ...from(other, QUIZ_LENGTH / 2)];
      for (const [q, right, ...wrongs] of shuffle(chosen)) seen.set(q + right, { q: q.replaceAll("{name}", pick(LEARN_NAMES[level.region])), right, wrongs: wrongs.slice(0, 3) });
    }
    const questions = [...seen.values()].map(item => ({ ...item, choices: shuffle([item.right, ...item.wrongs]) }));
    state.learn.quiz = { subject, ...level, at: 0, score: 0, picked: null, questions };
    render();
  }
  function learnPage() {
    const top = hero("Learn! 📚", "Pick a subject and play a quiz made for your class.", "LEARN & PLAY"), L = state.learn ||= {};
    if (L.quiz) return top + quizView(L.quiz);
    if (L.subject) return top + subjectView(L.subject);
    const card = s => {
      const locked = learnLocked(s), level = state.learnData.levels[s.id];
      const note = locked ? `🔒 Only if your religion is ${s.name}` : s.note && (state.learnData.verified.includes(s.id) ? "✅ Verified by a parent" : s.note);
      return `<button class="learn-subject" data-learn-subject="${s.id}" ${locked ? "disabled" : ""}><span class="learn-icon" aria-hidden="true">${s.icon}</span><strong>${s.name}</strong>` +
        `${note ? `<small>${note}</small>` : ""}${level ? `<small>${levelLabel(level)}</small>` : ""}</button>`;
    };
    return top + `<section class="panel"><h2>Which subject do you want to learn?</h2><div class="learn-subjects">${LEARN_SUBJECTS.map(card).join("")}</div></section>`;
  }
  function subjectView(id) {
    const s = LEARN_SUBJECTS.find(x => x.id === id), level = state.learnData.levels[id];
    const body = state.learn.unlocked === id
      ? `<h3>Which class are you in?</h3><div class="grade-list">${Array.from({ length: 9 }, (_, i) => `<button class="${level?.grade === i + 1 ? "primary" : "soft"}" data-learn-grade="${i + 1}">Class ${i + 1}</button>`).join("")}</div>`
      : level ? `<p>You're learning <strong>${levelLabel(level)}</strong>.</p><div class="actions"><button class="primary" data-learn-start>▶ Start the quiz</button><button class="soft" data-learn-unlock>🔒 Change class</button></div>`
      : `<p>A parent chooses your class with the parent password.</p><button class="primary" data-learn-unlock>🔒 Choose your class</button>`;
    return `<section class="panel"><div class="row between"><h2>${s.icon} ${s.name}</h2><button class="soft" data-learn-back>← Subjects</button></div>${body}</section>`;
  }
  function quizView(q) {
    const s = LEARN_SUBJECTS.find(x => x.id === q.subject), title = `<h2>${s.icon} ${s.name} · Class ${q.grade}</h2>`, total = q.questions.length;
    if (q.at >= total) {
      const cheer = q.score === total ? "Perfect! 🏆" : q.score >= total * 0.8 ? "Great job! 🌟" : q.score >= total / 2 ? "Good work! Keep going 💪" : "Nice try! Play again to get better 🌱";
      return `<section class="panel learn-quiz">${title}<p class="learn-score">You got ${q.score} out of ${total}! ${"⭐".repeat(Math.round(q.score / total * 3))}</p><p>${cheer}</p>` +
        `<div class="actions"><button class="primary" data-learn-start>🔁 Play again</button><button class="soft" data-learn-back>← Back</button></div></section>`;
    }
    const item = q.questions[q.at], answered = q.picked !== null, gotIt = answered && item.choices[q.picked] === item.right;
    return `<section class="panel learn-quiz"><div class="row between">${title}<small>Question ${q.at + 1} of ${total} · ⭐ ${q.score}</small></div><p class="learn-question">${safe(item.q)}</p>${item.pic || ""}` +
      `<div class="learn-choices">${item.choices.map((c, i) => `<button class="learn-choice ${answered && c === item.right ? "right" : answered && i === q.picked ? "wrong" : ""}" data-learn-choice="${i}" ${answered ? "disabled" : ""}>${safe(c)}</button>`).join("")}</div>` +
      (answered ? `<p class="learn-feedback" role="status">${gotIt ? "✅ Correct! Well done!" : `❌ Not quite. The answer is <strong>${safe(item.right)}</strong>.`}</p>` +
        `<div class="actions"><button class="primary" data-learn-next>${q.at + 1 < total ? "Next →" : "See my score"}</button><button class="soft" data-learn-back>Stop</button></div>` : "") + `</section>`;
  }
  function learnModal(title, body) {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="learnTitle"><div class="row between"><h2 id="learnTitle">${title}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>${body}</section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
  }
  // Asks a parent to prove it's them in a pop-up, then runs `submit` with the proof: { password }, or { face } when
  // `face` is set and they scan their face instead (only if a parent face is saved). Mistakes show in the pop-up.
  // Admins don't need either, so it runs straight away for them.
  function askParent(title, text, submit, { face = false } = {}) {
    if (state.user.admin) return submit({}).catch(err => toast(err.message, true));
    const canFace = face && state.user.kid?.face;
    const fail = err => { if ($("#parentError")) $("#parentError").textContent = err.message; else toast(err.message, true); };
    const usePassword = () => {
      $("#parentBody").innerHTML = `<form id="parentForm"><label for="parentPass">Parent password</label><input id="parentPass" type="password" autocomplete="current-password" maxlength="200" required>` +
        `<div class="actions"><button class="primary" type="submit">OK</button>${canFace ? `<button class="soft" type="button" id="parentUseFace">📷 Use the parent's face instead</button>` : ""}</div></form>`;
      $("#parentForm").onsubmit = async e => {
        e.preventDefault();
        try { await submit({ password: $("#parentPass").value }); } catch (err) { fail(err); }
      };
      if (canFace) $("#parentUseFace").onclick = useFace;
      $("#parentPass").focus();
    };
    const useFace = () => {
      $("#parentBody").innerHTML = `${faceBox()}<div class="actions"><button class="primary" id="faceStart">📷 Scan the parent's face</button><button class="soft" type="button" id="parentUsePassword">🔑 Use the password instead</button></div>`;
      $("#parentUsePassword").onclick = () => { stopCamera(); fail({ message: "" }); usePassword(); };
      $("#faceStart").onclick = async () => {
        const btn = $("#faceStart");
        btn.disabled = true; fail({ message: "" });
        try { await submit({ face: (await faceScan(true)).face }); }
        catch (err) { if ($("#faceStart")) { fail(err); btn.disabled = false; btn.textContent = "📷 Try again"; } }
      };
    };
    learnModal(title, `<p>${text}</p><div id="parentBody"></div><p class="muted-note error-text" id="parentError" role="alert"></p>`);
    usePassword();
  }
  const learnLocked = s => Boolean(s.who) && state.user.religion !== s.id;
  function openLearnSubject(id) {
    const open = () => { Object.assign(state.learn, { subject: id, unlocked: null }); render(); };
    const s = LEARN_SUBJECTS.find(x => x.id === id);
    if (learnLocked(s)) return toast(`${s.name} is only for accounts whose religion is ${s.name}.`, true);
    if (!s.who || state.learnData.verified.includes(id)) return open();
    askParent(`${s.icon} Verify by a parent`, `Parent: if your child is ${s.who}, type the parent password or scan your face to open ${s.name}.`, async proof => {
      state.learnData = await api(`/api/learn/${id}/verify`, send("POST", proof));
      closeModal(); open();
    }, { face: true });
  }
  function unlockGrades() {
    askParent("🔒 Choose your class", "Parent: type the parent password to choose the class.", async proof => {
      await api("/api/kid/check", send("POST", proof));
      closeModal(); state.learn.unlocked = state.learn.subject; render();
    });
  }
  // After a class is picked: where the child is from, then the parent password to save both and start the quiz.
  function regionModal(subject, grade) {
    learnModal("Are you from?", `<div class="grade-list"><button class="soft" data-learn-region="asia">🌏 Asia?</button><button class="soft" data-learn-region="western">🌍 Western?</button></div>`);
    for (const btn of document.querySelectorAll("[data-learn-region]")) btn.onclick = () => {
      const region = btn.dataset.learnRegion;
      askParent(REGION_NAMES[region], `Parent: type the parent password to confirm Class ${grade}, from ${region === "asia" ? "Asia" : "the West"}.`, async proof => {
        state.learnData = await api(`/api/learn/${subject}`, send("PUT", { grade, region, ...proof }));
        closeModal(); state.learn.unlocked = null; await startQuiz(subject);
      });
    };
  }

  // ---- Kuchisake-onna 👹: in the 18+ zone she takes the place of Nails. ----
  const SCREAM_KEY = "yakimma.scream";
  let screamOff = false;
  try { screamOff = localStorage.getItem(SCREAM_KEY) === "off"; } catch {}
  const KUCHI_ANGRY = { angry: true, ja: "一体どういうクソみたいな答えだよ？", en: "WHAT KIND OF FUCKING ANSWER IS THAT?" };
  const KUCHI = {
    ask: { masked: true, ja: "私は美しいですか？", en: "Am I beautiful?", answers: true },
    smile: { masked: false, ja: "こんな感じでも？", en: "Even like this?", answers: true },
    angry: { masked: true, ...KUCHI_ANGRY },
    angrySmile: { masked: false, ...KUCHI_ANGRY },
    bye: { masked: false, ja: "そうか、次はうまくいくといいね。", en: "Ok, better luck next time." }
  };
  // Yes or no. A no to her first question makes her scream straight away; a no to the second, just after she speaks.
  function answerKuchi(answer) {
    if (answer === "again") { state.kuchi = { step: "ask" }; render(); return; }
    const yes = answer === "yes", step = state.kuchi.step === "ask" ? (yes ? "smile" : "angry") : (yes ? "bye" : "angrySmile");
    state.kuchi = { step, screaming: step === "angry" };
    const unleashed = step.startsWith("angry") && countScream() === HACHI_SCREAMS;
    render();
    if (unleashed) setTimeout(() => hachiAppear(true), 2400);
    if (step === "angry") scream();
    if (step === "angrySmile") {
      scream(0.9);
      setTimeout(() => { if (state.kuchi?.step === "angrySmile") { state.kuchi.screaming = true; $(".kuchi-stage")?.classList.add("screaming"); } }, 900);
    }
  }
  function kuchisakePage() {
    const k = state.kuchi ||= { step: "ask" }, line = KUCHI[k.step];
    return hero("Kuchisake-onna 👹", "A woman in a mask stops you on a dark street. She has a question for you…", "THE SPLIT-MOUTHED WOMAN") +
      `<section class="panel kuchi"><div class="kuchi-stage ${k.screaming ? "screaming" : ""}">${kuchiSVG(line, k.step === "smile")}</div>` +
      `<div class="kuchi-talk" role="status"><p class="kuchi-ja" lang="ja">${line.ja}</p><p class="kuchi-en">(${line.en})</p></div>` +
      `<div class="actions kuchi-answers">${line.answers ? `<button class="primary" data-kuchi="yes"><span lang="ja">はい</span> (Yes)</button><button class="soft" data-kuchi="no"><span lang="ja">いいえ</span> (No)</button>` : `<button class="soft" data-kuchi="again">Meet her again…</button>`}</div>` +
      `<p class="muted-note kuchi-note">${screamOff ? "🔇 Scary sounds are off. Tap 👹 at the top to turn them back on." : "🔊 She screams! Tap 👹 at the top to turn scary sounds off."}</p>` +
      (stalked() ? `<p class="muted-note kuchi-note">Something very tall is following you now… <span lang="ja">ぽ…ぽ…ぽ…</span><br>To make her leave, turn 18+ off in ⚙️ Settings and take ${HACHI_PHOTOS} photos of nails with 📷 (${countOf("nailphotos")} of ${HACHI_PHOTOS} so far). Your nails are in 💅 Nails and on your 🌷 Profile.</p>` : "") +
      // Where the idea came from. The link starts the video at 4:20.
      `<p class="muted-note kuchi-note">Credit: I got this from <a href="https://www.youtube.com/watch?v=dl4YQr4C-H0&amp;t=260s" target="_blank" rel="noopener noreferrer">https://www.youtube.com/watch?v=dl4YQr4C-H0</a> (go to 4:20).</p></section>`;
  }
  // Her picture: a dark street, long black hair, a red coat and a white mask… or what's under it. `drop` animates the mask coming down.
  function kuchiSVG(line, drop) {
    const iris = line.angry ? "#e0001b" : "#140708";
    const eye = x => `<path d="M${x-17} 160Q${x} 147 ${x+17} 160Q${x} 170 ${x-17} 160Z" fill="#efe8e1"/><circle cx="${x}" cy="159.5" r="6.5" fill="${iris}"/><circle cx="${x+2}" cy="157.5" r="1.6" fill="#fff" opacity=".8"/><path d="M${x-15} 168Q${x} 176 ${x+15} 168" stroke="#6e4752" stroke-width="2.5" fill="none" opacity=".55"/>`;
    const brows = line.angry ? `<path d="M117 139L152 152M203 139L168 152" stroke="#0b0709" stroke-width="5" stroke-linecap="round"/>` : `<path d="M120 145Q135 138 151 144M169 144Q185 138 200 145" stroke="#0b0709" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
    // Points along a curve from cheek (104, 194) to cheek (216, 194), bending towards (160, y): for the lips and teeth.
    const lip = (y, s) => [(1-s)*(1-s)*104 + 2*(1-s)*s*160 + s*s*216, (1-s)*(1-s)*194 + 2*(1-s)*s*y + s*s*194];
    const teeth = (y, dir) => Array.from({ length: 13 }, (_, i) => { const [x, ty] = lip(y, 0.1 + i * 0.8 / 12); return `<path d="M${x-3.4} ${ty}L${x+3.4} ${ty}L${x} ${ty+dir*8}Z" fill="#f4eee0"/>`; }).join("");
    const low = line.angry ? 300 : 246;
    const mouth = `<path d="M104 194Q160 214 216 194Q160 ${low} 104 194Z" fill="#2a0004" stroke="#7a0012" stroke-width="2"/>${teeth(214, 1)}${teeth(low, -1)}` +
      `<path d="M104 194L93 185M216 194L227 185" stroke="#7a0012" stroke-width="3" stroke-linecap="round"/><path d="M96 183l4 6M100 186l-6 1M224 183l-4 6M220 186l6 1" stroke="#3a0006" stroke-width="1.4"/>` +
      `<path d="M106 197q2 9 0 15M214 197q-2 9 0 15" stroke="#9a0016" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
    const maskOn = `<path d="M106 186Q160 172 214 186L210 236Q160 262 110 236Z" fill="#f2f2ef" stroke="#c9c9c4" stroke-width="1.5"/><path d="M110 202Q160 192 210 202M111 216Q160 208 209 216M113 229Q160 222 207 229" stroke="#d2d2cc" stroke-width="2" fill="none"/><path d="M106 190Q96 178 102 162M214 190Q224 178 218 162" stroke="#e4e4df" stroke-width="2.5" fill="none"/>`;
    const maskDown = `<g class="${drop ? "kuchi-drop" : ""}"><path d="M120 250Q160 266 200 250L196 270Q160 286 124 270Z" fill="#f2f2ef" stroke="#c9c9c4" stroke-width="1.5"/><path d="M123 260Q160 274 197 260" stroke="#d2d2cc" stroke-width="2" fill="none"/><path d="M120 253Q100 220 102 170M200 253Q220 220 218 170" stroke="#e4e4df" stroke-width="2.5" fill="none"/></g>`;
    return `<svg viewBox="0 0 320 380" role="img" aria-label="${line.masked ? "A pale woman with long black hair and a white mask over her mouth" : "The woman with her mask pulled down, showing a mouth cut from ear to ear"}">` +
      `<defs><linearGradient id="kuchiNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160a0d"/><stop offset="1" stop-color="#040203"/></linearGradient><radialGradient id="kuchiLamp" cx="0.85" cy="0.08" r="0.55"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".35"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient><radialGradient id="kuchiSkin" cx="0.5" cy="0.4" r="0.6"><stop offset="0.55" stop-color="#ece4dd"/><stop offset="1" stop-color="#bdaea6"/></radialGradient></defs>` +
      `<rect width="320" height="380" fill="url(#kuchiNight)"/><rect width="320" height="380" fill="url(#kuchiLamp)"/><path d="M262 0V120" stroke="#2a1d1f" stroke-width="6"/><circle cx="262" cy="34" r="9" fill="#ffd9a0" opacity=".85"/>` +
      `<path d="M40 380Q60 292 132 272L160 302L188 272Q260 292 280 380Z" fill="#4d0b13"/><path d="M132 272L160 336L150 380M188 272L160 336L170 380" stroke="#2a0509" stroke-width="3" fill="none"/>` +
      `<g class="kuchi-head"><path d="M88 124Q92 58 160 56Q228 58 232 124L248 330Q160 352 72 330Z" fill="#0b0709"/><rect x="141" y="226" width="38" height="56" fill="#d9cfc8"/>` +
      `<ellipse cx="160" cy="170" rx="60" ry="76" fill="url(#kuchiSkin)"/>${eye(136)}${eye(184)}${brows}<path d="M160 168v14" stroke="#b9aaa2" stroke-width="2" stroke-linecap="round"/>` +
      (line.masked ? maskOn : `<g class="${drop ? "kuchi-reveal" : ""}">${mouth}</g>${maskDown}`) +
      `<path d="M98 140Q100 80 160 78Q220 80 222 140Q206 110 190 133Q176 108 160 128Q144 108 130 133Q114 110 98 140Z" fill="#0b0709"/><path d="M100 128Q90 210 102 312L90 312Q78 210 92 126ZM220 128Q230 210 218 312L230 312Q242 210 228 126Z" fill="#0b0709"/></g>` +
      `<ellipse cx="80" cy="370" rx="140" ry="22" fill="#fff" opacity=".04"/><ellipse cx="250" cy="372" rx="120" ry="18" fill="#fff" opacity=".05"/></svg>`;
  }
  // Her scream, made with the browser's own sound tools so there's no sound file: two shrieking voices that slide up and
  // wobble, a rush of breath, and some crunch. `delay` is in seconds. The 👹 button at the top turns it off.
  let screamCtx = null, screamOut = null;
  // Browsers only let a page make sound after you've tapped something on it, so the zone's sound player wakes up on your first tap.
  const audioCtx = () => { const Ctx = window.AudioContext || window.webkitAudioContext; return Ctx ? screamCtx ||= new Ctx() : null; };
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => { if (zoneOn()) audioCtx()?.resume(); });
  function scream(delay = 0) {
    const ctx = audioCtx();
    if (screamOff || !ctx) return;
    ctx.resume();
    const t = ctx.currentTime + delay, len = 1.9;
    const out = screamOut = ctx.createGain(), crunch = ctx.createWaveShaper(), tone = ctx.createBiquadFilter();
    crunch.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh((i / 511.5 - 1) * 4));
    tone.type = "bandpass"; tone.frequency.value = 1800; tone.Q.value = 0.7;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
    out.gain.setValueAtTime(0.35, t + len - 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + len);
    tone.connect(crunch).connect(out).connect(ctx.destination);
    for (const [from, peak, detune] of [[520, 1500, -18], [700, 1900, 14]]) {
      const voice = ctx.createOscillator(), wobble = ctx.createOscillator(), depth = ctx.createGain();
      voice.type = "sawtooth"; voice.detune.value = detune;
      voice.frequency.setValueAtTime(from, t);
      voice.frequency.exponentialRampToValueAtTime(peak, t + 0.22);
      voice.frequency.linearRampToValueAtTime(peak * 0.8, t + len);
      wobble.frequency.value = 11; depth.gain.value = peak * 0.04;
      wobble.connect(depth).connect(voice.frequency);
      voice.connect(tone);
      for (const o of [voice, wobble]) { o.start(t); o.stop(t + len); }
    }
    const breath = ctx.createBufferSource(), noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate), hiss = ctx.createGain();
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    breath.buffer = noise; hiss.gain.value = 0.5;
    breath.connect(hiss).connect(tone);
    breath.start(t);
  }
  const stopScream = () => { screamOut?.disconnect(); screamOut = null; window.speechSynthesis?.cancel(); };

  // ---- Hachishakusama 👒: make Kuchisake-onna scream 5 times and a very tall woman starts stalking you around the
  // 18+ zone. Now and then she peeks in from the side of the screen, and sometimes the site warns you, with a quiet
  // "po… po… po…". She only shows up inside the 18+ zone, but she stays after you until you take 3 photos of nails with
  // the 📷 camera on the normal site (with 18+ off), since Nails isn't in the zone. Each account's counts are kept in this browser.
  const HACHI_SCREAMS = 5, HACHI_PHOTOS = 3, HACHI_SPOTS = ["left", "right", "below", "far"], counts = {};
  const countKey = name => `yakimma.${name}.${state.user?.id}`;
  function countOf(name) {
    let n = counts[countKey(name)] || 0;
    try { n = Math.max(n, Number(localStorage.getItem(countKey(name))) || 0); } catch {}
    return n;
  }
  function setCount(name, n) {
    counts[countKey(name)] = n;
    try { localStorage.setItem(countKey(name), String(n)); } catch {}
    return n;
  }
  const countScream = () => setCount("screams", countOf("screams") + 1);
  const haunted = () => countOf("screams") >= HACHI_SCREAMS;
  const stalked = () => zoneOn() && haunted();
  // A photo of nails taken outside the zone while she's after you. Says how it went, or nothing if it doesn't count.
  function nailPhoto() {
    if (zoneOn() || !haunted()) return null;
    const n = setCount("nailphotos", countOf("nailphotos") + 1);
    if (n < HACHI_PHOTOS) return `📸 Nail photo ${n} of ${HACHI_PHOTOS}… she's still watching you.`;
    setCount("screams", 0); setCount("nailphotos", 0);
    stalk();
    return `📸 That's ${HACHI_PHOTOS} nail photos. Hachishakusama is gone… for now.`;
  }
  let hachiTimer = null;
  // Plans her next visit: the first a few seconds after you arrive, then every 20 to 50 seconds. Most visits come with a warning.
  // Called on every redraw, it starts her when you're being stalked and stops her when you're not.
  function stalk(again = false) {
    if (!stalked()) { clearTimeout(hachiTimer); hachiTimer = null; $("#hachi")?.remove(); $(".hachi-warn")?.remove(); return; }
    if (hachiTimer && !again) return;
    clearTimeout(hachiTimer);
    hachiTimer = setTimeout(() => {
      hachiTimer = null;
      if (!document.hidden && stalked()) hachiAppear(Math.random() < 0.7);
      stalk(true);
    }, (again ? 20 + Math.random() * 30 : 6 + Math.random() * 6) * 1000);
  }
  function hachiAppear(warn) {
    if ($("#hachi")) return;
    const her = document.createElement("div");
    her.id = "hachi";
    // She peeks in from the left or right edge, rises up from the bottom of the screen, or stands far away.
    const spot = HACHI_SPOTS[Math.floor(Math.random() * HACHI_SPOTS.length)];
    her.className = `hachi ${spot}`;
    if (spot === "below" || spot === "far") her.style.left = `${15 + Math.random() * 70}%`;
    her.setAttribute("aria-hidden", "true");
    her.innerHTML = hachiSVG();
    document.body.append(her);
    setTimeout(() => her.remove(), 5600);
    if (!warn) return;
    $(".hachi-warn")?.remove();
    const note = document.createElement("div");
    note.className = "hachi-warn";
    note.setAttribute("role", "alert");
    note.innerHTML = `⚠️ Hachishakusama IS STALKING YOU!! ⚠️<small lang="ja">ぽ…ぽ…ぽ… (po… po… po…)</small>`;
    document.body.append(note);
    setTimeout(() => note.remove(), 4800);
    poPoPo();
  }
  // Her quiet "po… po… po…", in a soft girl's voice. It's said by a Japanese woman's voice from the device's own speech
  // voices, slowly, a little high and quietly, and each "po" trails off a bit. Devices without one get the made-up voice below.
  const speech = window.speechSynthesis;
  const PO_SPEECH = { volume: 0.45, rate: 0.75, pitch: 1.25 };
  // Only voices that sound like a real young woman. Robotic voices and men's voices are never picked.
  const PO_VOICES = [/kyoko/i, /o-ren/i, /日本語/, /nanami/i, /haruka/i, /ayumi/i, /sayaka/i, /mayu/i, /aoi/i, /shiori/i];
  speech?.getVoices(); // Chrome only starts loading its voices once something asks for them.
  function girlVoice() {
    const ja = speech?.getVoices().filter(v => /^ja/i.test(v.lang)) || [];
    for (const name of PO_VOICES) { const v = ja.find(v => name.test(v.name)); if (v) return v; }
    return null;
  }
  // iPhones only let a page speak after it has spoken once during a tap, so the first tap in the zone says nothing, silently.
  let speechReady = false;
  function wakeSpeech() {
    if (speechReady || !speech) return;
    speechReady = true;
    const hush = new SpeechSynthesisUtterance(" ");
    hush.volume = 0;
    speech.speak(hush);
  }
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => { if (zoneOn()) wakeSpeech(); });
  function poPoPo() {
    if (screamOff) return;
    const voice = girlVoice(), ctx = voice ? null : audioCtx();
    if (!voice && !ctx) return;
    ctx?.resume();
    [0.2, 0.95, 1.7].forEach((at, i) => voice
      ? setTimeout(() => sayPo(voice, i), at * 1000)
      : po(ctx, ctx.currentTime + at, ctx.destination));
  }
  function sayPo(voice, i) {
    if (screamOff) return;
    const word = new SpeechSynthesisUtterance("ぽ");
    Object.assign(word, { voice, lang: voice.lang, rate: PO_SPEECH.rate, volume: PO_SPEECH.volume * (1 - i * 0.15), pitch: PO_SPEECH.pitch - i * 0.05 });
    speech.speak(word);
  }
  // One made-up "po", like a girl breathing it: a little puff of air for the "p", then a soft, breathy "o" whose pitch
  // slips down a bit. PO_VOLUME keeps it quiet.
  const PO_VOLUME = 0.8;
  // `len` seconds of hiss, fading out when `fade` is set.
  function hissOf(ctx, len, fade) {
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate), samples = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (fade ? 1 - i / samples.length : 1);
    return buf;
  }
  function po(ctx, t, to) {
    const out = ctx.createGain();
    out.gain.value = PO_VOLUME;
    out.connect(to);
    const puff = ctx.createBufferSource(), puffTone = ctx.createBiquadFilter(), puffLoud = ctx.createGain();
    puff.buffer = hissOf(ctx, 0.03, true); puffTone.type = "lowpass"; puffTone.frequency.value = 1500; puffLoud.gain.value = 0.15;
    puff.connect(puffTone).connect(puffLoud).connect(out);
    puff.start(t);
    // The vowel "o" is a soft voice at a girl's pitch mixed with a lot of breath, with the notes around 540 and 980 Hz
    // made louder, which is where a woman's "o" rings.
    const voice = ctx.createOscillator(), breath = ctx.createBufferSource(), breathLoud = ctx.createGain(), shape = ctx.createGain();
    const low = ctx.createBiquadFilter(), high = ctx.createBiquadFilter(), highLoud = ctx.createGain();
    const soft = Float32Array.from({ length: 16 }, (_, n) => n ? n ** -1.5 : 0);
    voice.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(16), soft));
    voice.frequency.setValueAtTime(320, t + 0.03);
    voice.frequency.exponentialRampToValueAtTime(275, t + 0.42);
    breath.buffer = hissOf(ctx, 0.44); breathLoud.gain.value = 0.5;
    shape.gain.setValueAtTime(0.0001, t + 0.03);
    shape.gain.exponentialRampToValueAtTime(1, t + 0.09);
    shape.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    low.type = "bandpass"; low.frequency.value = 540; low.Q.value = 2.5;
    high.type = "bandpass"; high.frequency.value = 980; high.Q.value = 3; highLoud.gain.value = 0.45;
    voice.connect(shape);
    breath.connect(breathLoud).connect(shape);
    shape.connect(low).connect(out);
    shape.connect(high).connect(highLoud).connect(out);
    for (const s of [voice, breath]) { s.start(t + 0.03); s.stop(t + 0.47); }
  }
  // Her: far too tall for the screen, in a white dress and a wide white hat, with long black hair and a smile in the shadow.
  function hachiSVG() {
    return `<svg viewBox="0 0 160 640"><defs><linearGradient id="hachiShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c938a"/><stop offset=".55" stop-color="#e9e3dc"/></linearGradient></defs>` +
      `<path d="M52 92Q40 200 46 330L114 330Q120 200 108 92Z" fill="#0b0709"/>` +
      `<path d="M71 136h18v26H71z" fill="#ddd5cd"/><path d="M56 152Q80 142 104 152L128 600Q80 616 32 600Z" fill="#f3f1ea"/><path d="M80 160V600M66 170L54 596M94 170L106 596" stroke="#dcd8cf" stroke-width="2"/>` +
      `<path d="M58 158Q44 250 40 360Q38 380 44 384Q50 380 50 360Q56 260 66 170ZM102 158Q116 250 120 360Q122 380 116 384Q110 380 110 360Q104 260 94 170Z" fill="#e2dad2"/>` +
      `<ellipse cx="80" cy="112" rx="21" ry="27" fill="url(#hachiShade)"/><ellipse cx="73" cy="107" rx="3.4" ry="2.4" fill="#0d0607"/><ellipse cx="87" cy="107" rx="3.4" ry="2.4" fill="#0d0607"/><path d="M64 123Q80 131 96 123" stroke="#4a1418" stroke-width="1.3" fill="none"/>` +
      `<path d="M58 96Q60 84 80 82Q100 84 102 96Q96 90 88 100Q80 88 72 100Q64 90 58 96Z" fill="#0b0709"/><path d="M58 98Q54 140 56 170L62 170Q60 140 63 104ZM102 98Q106 140 104 170L98 170Q100 140 97 104Z" fill="#0b0709"/>` +
      `<ellipse cx="80" cy="84" rx="66" ry="13" fill="#f6f4ee"/><path d="M52 84Q54 52 80 50Q106 52 108 84Z" fill="#f6f4ee"/><path d="M53 76Q80 70 107 76L108 84Q80 78 52 84Z" fill="#1b1416"/></svg>`;
  }
  function screamButton() {
    const btn = $("#screamBtn");
    btn.hidden = !zoneOn();
    btn.innerHTML = `👹<span class="scream-state" aria-hidden="true">${screamOff ? "🔇" : "🔊"}</span>`;
    btn.setAttribute("aria-pressed", String(!screamOff));
    btn.title = screamOff ? "Scary sounds are off. Tap to turn them on" : "Scary sounds are on. Tap to turn them off";
    btn.setAttribute("aria-label", btn.title);
  }

  // ---- Camera 📷: takes a picture of the part of the page you can see and keeps it in Pictures 🌇. ----
  let shotLib = null;
  // The drawing library is only downloaded the first time someone takes a picture.
  const loadShotLib = () => shotLib ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/modern-screenshot.js";
    s.onload = () => resolve(window.modernScreenshot);
    s.onerror = () => { shotLib = null; s.remove(); reject(new Error("The camera couldn't start. Check your connection and try again.")); };
    document.head.append(s);
  });
  const PAGE_NAMES = { rules: "📜 Rules", safety: "🛡️ Safety", feed: "🏡 Feed", create: "✨ Upload", profile: "🌷 Profile", pictures: "🌇 Pictures", settings: "⚙️ Settings", friends: "👯 Friends", groups: "🏘️ Groups", nails: "💅 Nail Salon", person: "👤 Profile", post: "🔗 Post", learn: "📚 Learn!", reports: "🚩 Reports", shop: "🛍️ Shop", codes: "👩‍💻 Codes", about: "🎀 About The Creator", ads: "🎉 Advertisement" };
  // Where a picture was taken, shown with it in Pictures.
  function placeName() {
    const c = state.chat, g = state.groupView?.group, client = state.page === "nails" && state.salon && salonClient();
    if (g) return `${g.icon} ${g.name}`;
    if (c?.ai) return "🤖 Chat with AI";
    if (c?.friendId) return `💬 Chat with ${state.social.friends.find(f => f.id === c.friendId)?.username || "a friend"}`;
    if (state.page === "nails" && zoneOn()) return "👹 Kuchisake-onna";
    if (client) return client.self ? "💅 Your manicure" : `💅 ${client.username}'s manicure`;
    return PAGE_NAMES[state.page] || "Yakimma";
  }
  // A short note at the bottom that doesn't redraw the page, so videos keep playing and nothing you typed is lost.
  function snap(message, error = false) {
    $("#snap")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="snap notice ${error ? "error" : ""}" id="snap" role="status">${safe(message)}${error ? "" : `<button class="soft" data-page="pictures">See it</button>`}</div>`);
    const note = $("#snap");
    setTimeout(() => note.remove(), 4000);
  }
  async function takePicture() {
    const main = $("#main"), btn = $("#cameraBtn"), barBottom = $(".topbar").getBoundingClientRect().bottom, box = main.getBoundingClientRect();
    // Only what's on screen: from just under the top bar to the bottom of the window.
    const from = Math.max(0, barBottom - box.top), to = Math.min(box.height, innerHeight - box.top);
    if (to - from < 40) return snap("Scroll to something on the page, then take a picture.", true);
    // Photos you can't see are left out, so a long feed doesn't make the camera slow. They keep their size, so nothing moves.
    const offscreen = [...main.querySelectorAll("img")].filter(img => { const r = img.getBoundingClientRect(); return r.bottom < barBottom || r.top > innerHeight; });
    // At least half of a painted hand on screen makes this a photo of nails (see nailPhoto).
    const nails = [...main.querySelectorAll("svg.hand.painted")].some(h => { const r = h.getBoundingClientRect(); return Math.min(r.bottom, innerHeight) - Math.max(r.top, barBottom) >= r.height / 2; });
    offscreen.forEach(img => { img.dataset.offscreen = ""; });
    btn.disabled = true;
    const flash = document.createElement("div");
    flash.className = "camera-flash"; flash.setAttribute("aria-hidden", "true");
    document.body.append(flash); setTimeout(() => flash.remove(), 600);
    try {
      const { domToBlob } = await loadShotLib();
      const blob = await domToBlob(main, {
        type: "image/jpeg", quality: 0.9, scale: Math.min(devicePixelRatio || 1, 2),
        width: box.width, height: to - from, style: { transform: `translateY(${-from}px)` },
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        features: { restoreScrollPosition: true },
        onCloneEachNode: node => { if (node.dataset && "offscreen" in node.dataset) { node.removeAttribute("src"); node.removeAttribute("srcset"); } }
      });
      const body = new FormData();
      body.append("picture", blob, "picture.jpg"); body.append("place", placeName());
      const d = await api("/api/pictures", { method: "POST", body });
      if (state.page === "pictures") { state.pictures = d; render(); }
      snap((nails && nailPhoto()) || "📸 Picture saved in 🌇 Pictures!");
    } catch (err) { snap(err.message || "The picture didn't work. Try again.", true); }
    finally { offscreen.forEach(img => delete img.dataset.offscreen); btn.disabled = false; }
  }
  // A note from the person who made Yakimma, in her own words.
  function aboutPage() {
    return hero("About The Creator 🎀", "", "MEET THE CREATOR") +
      `<section class="panel about"><p>Hello, My name is Mahdiya Faiza Manha I created this website and if you're wondering why is there 'Craftora Labs' in the link? well because its my dad's some sort of website I dont know so I build this with Claude Code in Terminal it's pretty easy it almost looks like Sekai lol I build this for the love of y'all Byeeee!!.</p><p class="signature">- Luv by Mahdiya Faiza Manha</p></section>`;
  }
  // Links chosen by the person who made Yakimma. They open in a new tab, and each button says which website it goes to.
  const ADS = [
    { icon: "💼", title: "My Dad's Business", name: "Biponi Labs", url: "https://www.facebook.com/people/Biponi-Labs/61594900898203/?sk=followers" },
    { icon: "▶️", title: "Follow Me On YouTube!", name: "@Offical-manhatukfayay_theCutie", url: "https://www.youtube.com/@Offical-manhatukfayay_theCutie" },
    { icon: "📲", title: "Install This App!", name: "Fax Hero: Send Fax from iPhone", url: "https://apps.apple.com/us/app/fax-hero-send-fax-from-iphone/id6670707717" },
    { icon: "🌌", title: "Play My Sekai Games!", name: "Sekai", url: "https://sekai.ai/?creator=18041026" }
  ];
  function adsPage() {
    return hero("Advertisement 🎉", "", "ADVERTISEMENT") +
      `<div class="ads">${ADS.map(a => `<article class="panel ad"><div class="ad-icon" aria-hidden="true">${a.icon}</div><h2>${safe(a.title)}</h2><p class="muted-note">${safe(a.name)}</p>` +
        `<a class="primary link-button" href="${safe(a.url)}" target="_blank" rel="noopener noreferrer">Open ${safe(new URL(a.url).hostname.replace(/^www\./, ""))} ↗</a></article>`).join("")}</div>`;
  }
  function picturesPage() {
    const top = hero("Pictures 🌇", "Tap 📷 at the top of the screen to take a picture of anything on Yakimma: your nails, a friend's nails, a chat, a video… Only you can see your pictures.", "MY PICTURES");
    if (!state.user) return top + signInPanel("Sign in to take pictures.");
    if (!state.pictures) return top + `<section class="panel"><p class="muted">Loading your pictures…</p></section>`;
    const { pictures, max } = state.pictures;
    return top + `<section class="panel"><h2>My pictures (${pictures.length}/${max})</h2>${pictures.length
      ? `<div class="pictures">${pictures.map(p => `<button class="picture" data-picture="${p.id}"><img src="${safe(p.url)}" alt="Picture of ${safe(p.place)}" loading="lazy"><strong>${safe(p.place)}</strong><small>${timeLabel(p.createdAt)}</small></button>`).join("")}</div>`
      : `<p class="muted">No pictures yet. Tap 📷 at the top to take your first one! 📸</p>`}</section>`;
  }
  function openPicture(id) {
    const p = state.pictures?.pictures.find(x => x.id === id);
    if (!p) return;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal picture-modal" role="dialog" aria-modal="true" aria-labelledby="pictureTitle"><div class="row between"><h2 id="pictureTitle">${safe(p.place)}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<img class="picture-full" src="${safe(p.url)}" alt="Picture of ${safe(p.place)}"><small>${timeLabel(p.createdAt)}</small>` +
      `<div class="actions"><a class="primary link-button" href="${safe(p.url)}" download="yakimma-picture-${p.id}.jpg">⬇️ Save to device</a><button class="danger" data-delete-picture="${p.id}">🗑️ Delete</button></div></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
  }
  // Eye open = password is hidden (tap to show); eye closed = password is showing (tap to hide).
  const EYE_OPEN = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_CLOSED = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 10c2.5 3.5 6 5.5 10 5.5s7.5-2 10-5.5"/><path d="M4.6 13.3 3 15.6M9 15.2l-.8 2.7M15 15.2l.8 2.7M19.4 13.3l1.6 2.3"/></svg>`;
  const closeModal = () => { stopCamera(); $("#modalroot").innerHTML = ""; };
  // ---- Religion and country 🌍: chosen when making an account, and shown on the profile for everyone to see. ----
  const identityFields = () => `<label for="religion">Religion</label><select id="religion" required><option value="">Choose your religion</option>` +
    (state.religions || []).map(r => `<option value="${r.id}">${r.icon} ${safe(r.name)}</option>`).join("") + `</select>` +
    `<label for="country">Country</label><select id="country" required><option value="">Choose your country</option>` +
    (state.countries || []).map(c => `<option value="${c.code}">${c.flag} ${safe(c.name)}</option>`).join("") + `</select>` +
    `<p class="muted-note">🌍 Everyone can see your religion and country on your profile.</p>`;
  const identityPills = u => (u.gender ? `<span class="pill aud ${u.gender}s" title="${GENDERS[u.gender].name}">${GENDERS[u.gender].icon}<span class="thing-label"> ${GENDERS[u.gender].name}</span></span>` : "") +
    [state.countries?.find(c => c.code === u.country), state.religions?.find(r => r.id === u.religion)]
    .filter(Boolean).map(x => `<span class="pill" title="${safe(x.name)}">${x.flag || x.icon}<span class="thing-label"> ${safe(x.name)}</span></span>`).join("");
  // Accounts made before religion and country were asked for choose them once. The pop-up can't be closed until they do.
  function identityModal() {
    if ($("#identityForm")) return;
    $("#modalroot").innerHTML = `<div class="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="identityTitle"><h2 id="identityTitle">🌍 Your religion and country</h2>` +
      `<p>Everyone on Yakimma chooses their religion and country. Choose yours to carry on.</p><form id="identityForm">${identityFields()}` +
      `<p class="muted-note error-text" id="identityError" role="alert"></p><div class="actions"><button class="primary" type="submit">Save</button></div></form></section></div>`;
    $("#identityForm").onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await api("/api/me/identity", send("PUT", { religion: $("#religion").value, country: $("#country").value }));
        Object.assign(state, { user: d.user, songs: d.songs }); closeModal(); render(); toast("Saved! 🌍");
      } catch (err) { $("#identityError").textContent = err.message; }
    };
    $("#religion").focus();
  }
  function openAuth(startMode = "login") {
    $("#accountMenu")?.remove();
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="authTitle"><div class="row between"><h2 id="authTitle">🌸 Welcome to Yakimma</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div><div class="row"><button type="button" id="tabLogin">Sign in</button><button type="button" id="tabSignup">Create account</button></div><form id="authForm"><label for="username">Username</label><input id="username" name="username" minlength="3" maxlength="20" autocomplete="username" required aria-describedby="usernameRules"><div class="notice error rules" id="usernameRules" role="note">⚠️ Do not copy usernames<br>⚠️ Do not use symbols<br>⚠️ Do not use spaces</div><label for="password" id="passwordLabel">Password</label><input id="password" name="password" type="password" maxlength="200" required aria-describedby="passwordRules"><div class="notice error rules" id="passwordRules" role="note">⚠️ Do not use spaces</div><div id="signupIdentity">${identityFields()}</div><p id="authError" class="muted-note"></p><button class="primary" type="submit" style="width:100%">Sign in</button></form><div id="otherSignIn" class="other-signin"><p class="muted-note">Don't know your password?</p><div class="actions"><button type="button" class="soft" id="googleWay">📧 Email + Google</button><button type="button" class="soft" id="quickWay">📲 Quick sign in</button></div></div></section></div>`;
    let mode = startMode;
    const setMode = m => {
      mode = m;
      const signup = m === "signup";
      $("#authTitle").textContent = signup ? "🌸 Join Yakimma" : "🩵 Welcome back";
      $("#authForm button[type=submit]").textContent = signup ? "Create account" : "Sign in";
      $("#passwordLabel").textContent = signup ? "Password (8+ characters)" : "Password";
      $("#password").autocomplete = signup ? "new-password" : "current-password";
      $("#password").minLength = signup ? 8 : 1;
      // The rules only apply to new accounts, so older accounts with other characters or spaces can still sign in.
      $("#usernameRules").hidden = $("#passwordRules").hidden = $("#signupIdentity").hidden = !signup;
      $("#otherSignIn").hidden = signup;
      // Religion and country are only for new accounts. Turned off, they don't stop signing in.
      for (const el of $("#signupIdentity").querySelectorAll("select")) el.disabled = !signup;
      if (signup) {
        Object.assign($("#username"), { pattern: "[A-Za-z0-9]+", title: "Letters and numbers only. Do not use symbols or spaces." });
        Object.assign($("#password"), { pattern: "\\S+", title: "Do not use spaces in your password." });
      } else for (const el of [$("#username"), $("#password")]) { el.removeAttribute("pattern"); el.removeAttribute("title"); }
      $("#authError").textContent = signup ? "Username: 3–20 letters or numbers." : "Enter your username and password.";
      $("#authError").className = "muted-note";
      [["#tabLogin", !signup], ["#tabSignup", signup]].forEach(([sel, on]) => { $(sel).className = on ? "primary" : "soft"; $(sel).setAttribute("aria-pressed", on); });
    };
    setMode(mode);
    $("#tabSignup").onclick = () => setMode("signup"); $("#tabLogin").onclick = () => setMode("login");
    $("#googleWay").onclick = googleSignInModal; $("#quickWay").onclick = quickSignInModal;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#authForm").onsubmit = async e => {
      e.preventDefault();
      const username = $("#username").value.trim(), password = $("#password").value;
      const identity = mode === "signup" ? { religion: $("#religion").value, country: $("#country").value } : {};
      try {
        await api("/api/" + mode, send("POST", { username, password, ...identity }));
        closeModal(); await refresh(); await loadPageData();
        toast(mode === "signup" ? `Welcome to Yakimma, ${state.user.username}! 🌸 Your account number is ${state.user.accountNumber}.` : `Welcome back, ${state.user.username}! 🩵`);
        if (mode === "signup") readTheRules();
      }
      catch (err) { $("#authError").textContent = err.message; $("#authError").className = "notice error"; }
    };
    $("#username").focus();
  }
  // Pop-ups that go back to the sign-in box: a title, what's in them, and a ← Back button (id authBack) somewhere inside.
  function signInStep(title, body) {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="stepTitle"><div class="row between"><h2 id="stepTitle">${title}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>${body}</section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#authBack").onclick = () => openAuth("login");
  }
  // Don't know your password: type the email on your account, then sign in to Google with it. Google sends you back to
  // Yakimma, and SIGNIN_NOTES says how it went.
  function googleSignInModal() {
    signInStep("📧 Sign in with Google", `<p>Type the email on your Yakimma account, then sign in to Google with that email.</p>` +
      (state.googleSignIn ? "" : `<p class="notice error">Sign in with Google isn't set up on Yakimma yet.</p>`) +
      `<form id="googleForm"><label for="googleEmail">Email</label><input id="googleEmail" type="email" autocomplete="email" maxlength="254" required>` +
      `<div class="actions"><button class="primary" type="submit" ${state.googleSignIn ? "" : "disabled"}>Sign in with Google</button><button class="soft" type="button" id="authBack">← Back</button></div></form>` +
      `<p class="muted-note">This only works if you added your email with 📧 Email on your Profile before.</p>`);
    $("#googleForm").onsubmit = e => { e.preventDefault(); location.href = `/api/auth/google?email=${encodeURIComponent($("#googleEmail").value.trim())}`; };
    $("#googleEmail").focus();
  }
  // What the page says after coming back from Google (/?signin=...).
  const SIGNIN_NOTES = {
    "google": null,
    "google-off": "Sign in with Google isn't set up on Yakimma yet.",
    "google-cancelled": "Signing in with Google was stopped, so you're not signed in.",
    "google-failed": "Signing in with Google didn't work. Please try again.",
    "google-unverified": "Google hasn't checked that email belongs to you, so it can't sign you in.",
    "google-nomatch": "No Yakimma account has that Google email. Sign in with your password, then add your email with 📧 Email on your Profile.",
    "suspended": "That account is suspended, so it can't sign in right now."
  };
  // Quick sign-in: this device shows a code, and you confirm it on a device that's already signed in. This device checks
  // every 2 seconds until it's confirmed (or the pop-up is closed).
  let quickTimer = null;
  function quickSignInModal() {
    signInStep("📲 Quick sign in", `<p>On a device where you're already signed in, open <strong>🌷 Profile</strong>, type this code in the <strong>📲 Quick sign in</strong> box above My collection, and press <strong>✅ Confirm</strong>.</p>` +
      `<p class="quick-signin-code" id="quickCodeShown" aria-live="polite">…</p><p class="muted-note" id="quickStatus" role="status">Getting your code…</p>` +
      `<div class="actions"><button class="soft" type="button" id="quickNew">🔄 New code</button><button class="soft" type="button" id="authBack">← Back</button></div>`);
    const status = (text, error = false) => { if ($("#quickStatus")) Object.assign($("#quickStatus"), { textContent: text, className: error ? "notice error" : "muted-note" }); };
    const stop = () => { clearInterval(quickTimer); quickTimer = null; };
    const check = async () => {
      if (!$("#quickCodeShown")) return stop();
      try {
        const d = await api("/api/quick-signin");
        if (d.expired) { stop(); status("That code ran out. Tap 🔄 New code for another one.", true); return; }
        if (!d.user) return;
        stop(); closeModal(); await refresh(); await loadPageData();
        toast(`Welcome back, ${state.user.username}! 🩵`);
      } catch (err) { stop(); status(err.message, true); }
    };
    const start = async () => {
      stop();
      try {
        const d = await api("/api/quick-signin", { method: "POST" });
        if (!$("#quickCodeShown")) return;
        $("#quickCodeShown").textContent = `${d.code.slice(0, 4)}-${d.code.slice(4)}`;
        status(`Waiting for you to confirm it on your other device… The code works for ${d.minutes} minutes.`);
        quickTimer = setInterval(check, 2000);
      } catch (err) { status(err.message, true); }
    };
    $("#quickNew").onclick = start;
    start();
  }
  // Your email, for signing in with Google: type it, then the code sent to it.
  function emailModal(step = "email", info = {}) {
    const has = state.user.email;
    const body = step === "email"
      ? `<p>${has ? `The email on your account is <strong>${safe(has)}</strong>. Type a new one to change it.` : "Add your email, and if you ever don't know your password you can sign in with Google using it."} Nobody else sees it.</p>` +
        `<form id="emailForm"><label for="emailInput">Email</label><input id="emailInput" type="email" autocomplete="email" maxlength="254" required><div class="actions"><button class="primary" type="submit">Send my code</button></div></form>`
      : `<p>${info.testCode ? `Email isn't set up on this computer, so here's your code instead: <strong class="code-tag">${safe(info.testCode)}</strong>` : `We sent a code to <strong>${safe(info.email)}</strong>. It works for 10 minutes.`}</p>` +
        `<form id="emailCodeForm"><label for="emailCode">6-digit code</label><input id="emailCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><div class="actions"><button class="primary" type="submit">Check my code</button><button class="soft" type="button" id="emailBack">Use another email</button></div></form>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="emailTitle"><div class="row between"><h2 id="emailTitle">📧 Your email</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${body}<p class="muted-note error-text" id="emailError" role="alert"></p></section></div>`;
    const fail = err => { if ($("#emailError")) $("#emailError").textContent = err.message; };
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    if (step === "email") {
      $("#emailForm").onsubmit = async e => {
        e.preventDefault();
        // The button waits while the email is sent, so pressing it again can't send a second code.
        const email = $("#emailInput").value.trim(), btn = $("#emailForm [type=submit]");
        btn.disabled = true; btn.textContent = "Sending…";
        try { const d = await api("/api/me/email", send("POST", { email })); emailModal("code", { email, testCode: d.testCode }); }
        catch (err) { fail(err); btn.disabled = false; btn.textContent = "Send my code"; }
      };
      $("#emailInput").focus();
      return;
    }
    $("#emailBack").onclick = () => emailModal("email");
    $("#emailCodeForm").onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await api("/api/me/email/code", send("POST", { code: $("#emailCode").value }));
        state.user = d.user; closeModal(); toast(`Your email ${d.user.email} is saved. 📧 You can sign in with Google using it.`);
      } catch (err) { fail(err); }
    };
    $("#emailCode").focus();
  }
  // ---- 🔍 Tapping the big profile picture on a profile shows it on 70% of the screen. Zoom in or out with + and −,
  // the mouse wheel or by pinching, and drag it around once it's zoomed in. Your own has 🎨 Change picture too. ----
  const ZOOM_MIN = 0.5, ZOOM_MAX = 4, ZOOM_STEP = 1.25;
  function avatarViewer(avatar, username, mine = false) {
    const whose = mine ? "Your" : `${nameText(username)}'s`;
    $("#modalroot").innerHTML = `<div class="modalback avatar-viewer" id="modalback"><section class="avatar-view" role="dialog" aria-modal="true" aria-label="${safe(whose)} profile picture">` +
      `<div class="avatar-stage" id="avatarStage">${avatarHTML(avatar, "full")}</div><div class="zoom-bar"><button class="soft zoom-step" id="zoomOut" aria-label="Zoom out">−</button>` +
      `<button class="soft" id="zoomReset" aria-label="Back to normal size">100%</button><button class="soft zoom-step" id="zoomIn" aria-label="Zoom in">+</button>` +
      `${mine ? `<button class="soft" id="viewerChange">🎨 Change picture</button>` : ""}<button class="soft" id="closeModal" aria-label="Close">✕</button></div></section></div>`;
    const stage = $("#avatarStage"), pic = stage.firstElementChild, fingers = new Map();
    let zoom = 1, x = 0, y = 0, pinch = null, dragged = false;
    const draw = () => {
      // Zoomed in, it can be dragged until its edge reaches the middle of the screen. At normal size or smaller it stays in the middle.
      const room = zoom > 1 ? pic.offsetWidth * zoom / 2 : 0;
      x = Math.max(-room, Math.min(room, x)); y = Math.max(-room, Math.min(room, y));
      pic.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      $("#zoomReset").textContent = `${Math.round(zoom * 100)}%`;
      $("#zoomOut").disabled = zoom <= ZOOM_MIN; $("#zoomIn").disabled = zoom >= ZOOM_MAX;
    };
    const zoomTo = z => { zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); draw(); };
    const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    $("#zoomIn").onclick = () => zoomTo(zoom * ZOOM_STEP);
    $("#zoomOut").onclick = () => zoomTo(zoom / ZOOM_STEP);
    $("#zoomReset").onclick = () => { x = y = 0; zoomTo(1); };
    $("#closeModal").onclick = closeModal;
    if (mine) $("#viewerChange").onclick = openAvatarEditor;
    // Tapping the dark part around it closes it, unless you were just dragging the picture.
    $("#modalback").onclick = e => { if (e.target.id === "modalback" && !dragged) closeModal(); dragged = false; };
    stage.onwheel = e => { e.preventDefault(); zoomTo(zoom * Math.exp(-e.deltaY / (e.ctrlKey ? 100 : 300))); };
    stage.onpointerdown = e => {
      stage.setPointerCapture(e.pointerId); fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = false;
      if (fingers.size === 2) pinch = { spread: spread(), zoom };
    };
    stage.onpointermove = e => {
      const last = fingers.get(e.pointerId);
      if (!last) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) return zoomTo(pinch.zoom * spread() / pinch.spread);
      if (zoom <= 1) return;
      x += e.clientX - last.x; y += e.clientY - last.y; dragged = true; draw();
    };
    stage.onpointerup = stage.onpointercancel = e => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
    draw(); $("#zoomIn").focus();
  }
  // Profile picture editor: an emoji avatar, or a photo you drag and zoom to fit the circle.
  function openAvatarEditor() {
    const o = state.avatarOptions, current = state.user.avatar, C = 480;
    if (current.fixed) {
      $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatarTitle"><div class="row between"><h2 id="avatarTitle">🎨 Your profile picture</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
        `<div class="avatar-preview">${avatarHTML(current, "huge")}</div><p class="notice">🔒 Your profile picture is fixed, so it can't be changed.</p></section></div>`;
      $("#closeModal").onclick = closeModal;
      $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
      return;
    }
    let emoji = current.emoji, bg = current.bg, img = null, zoom = 1, ox = 0, oy = 0;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatarTitle"><div class="row between"><h2 id="avatarTitle">🎨 Your profile picture</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      (state.user.admin ? `<p class="notice">🛠️ You're an admin, so everyone sees 🛠️ as your picture. Only the background you pick here shows.</p>` : "") +
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
    // Reloading the page's data puts the new picture on your posts too.
    const saved = async (d, message) => { state.user = d.user; closeModal(); await refresh(); await loadPageData(); toast(message); };
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
    $(".top-actions").insertAdjacentHTML("beforeend", `<div class="account-menu" id="accountMenu" role="menu"><div class="account-menu-head">${avatarHTML(state.user.avatar)}<div><strong>${nameHTML(state.user.username)}</strong><small>🐱 ${state.user.mc} MC · 💌 ${state.user.lc} LC</small></div></div><button class="menu-item" role="menuitem" data-page="profile">🌷 My profile</button><button class="menu-item" role="menuitem" id="menuAvatar">🎨 Change picture</button>${kidOn() && !state.user.admin ? `<p class="menu-note">🧸 In the kiddy zone, only a parent can sign out, from 🌷 My profile.</p>` : `<button class="menu-item signout" role="menuitem" id="logout">🚪 Sign out</button>`}</div>`);
    $("#accountMenu button").focus();
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if ($("#accountMenu")) { $("#accountMenu").remove(); $("#accountBtn").focus(); }
    else if ($("#notifMenu")) { $("#notifMenu").remove(); $("#bellBtn").focus(); }
    else if ($("#modalback")) closeModal();
    else if (state.chat?.selected) { state.chat.selected = null; drawLog(); }
    else if (state.chat?.editing) { Object.assign(state.chat, { editing: null, draft: "" }); render(); }
  });
  document.addEventListener("click", async e => {
    const hit = e.target.closest("[data-nail-i]");
    if (hit && state.salon) { state.salon.applyAll = false; state.salon.selected = Number(hit.dataset.nailI); render(); return; }
    if (!e.target.closest("#accountBtn")) $("#accountMenu")?.remove();
    if (!e.target.closest("#bellBtn, #notifMenu")) $("#notifMenu")?.remove();
    const tag = e.target.closest("[data-mention]");
    if (tag) { e.preventDefault(); try { await openTag(tag.dataset.mention); } catch (err) { toast(err.message, true); } return; }
    // Tapping anywhere outside the selected message closes its actions.
    if (state.chat?.selected && !e.target.closest(".msg-body") && !e.target.closest("#modalroot")) { state.chat.selected = null; drawLog(); }
    const b=e.target.closest("button"); if(!b)return;
    const s = state.salon;
    try {
      if(b.dataset.page){
        if(pageGone(b.dataset.page)){toast(goneNote(b.dataset.page),true);return;}
        if(location.pathname!=="/")history.replaceState(null,"","/");
        state.page=b.dataset.page;state.notice="";state.codeWin=null;state.groupView=null;state.chat=null;state.kuchi=null;state.learn=null;render();
        await loadPageData();render();
        return;
      }
      if(b.id==="accountBtn"){state.user?toggleAccountMenu():openAuth("login");return;}
      if(b.id==="openAuth"){openAuth("signup");return;}
      if(b.dataset.signIn!==undefined){openAuth("login");return;}
      if(["editAvatarBtn","menuAvatar"].includes(b.id)){openAvatarEditor();return;}
      if(b.dataset.viewAvatar){const me=b.dataset.viewAvatar==="me",u=me?state.user:state.person.user;avatarViewer(u.avatar,u.username,me);return;}
      if(b.dataset.myOrder){state.myPosts={...state.myPosts,order:b.dataset.myOrder};await loadMyPosts();render();return;}
      if(b.id==="moreMyPosts"){b.disabled=true;await loadMyPosts(true);render();return;}
      if(b.id==="logout"){if(kidOn()&&!state.user.admin)return kidSignOut();await api("/api/logout",{method:"POST"});await signedOut();return;}
      if(b.dataset.like){const d=await api(`/api/posts/${b.dataset.like}/like`,{method:"POST"});if(state.groupView)state.groupView.posts=d.posts;else state.posts=d.posts;for(const theirs of [state.person?.posts.find(x=>x.id===Number(b.dataset.like)),state.playlist?.find(x=>x.id===Number(b.dataset.like)),state.single?.post?.id===Number(b.dataset.like)&&state.single.post])if(theirs){theirs.liked=d.liked;theirs.likes+=d.liked?1:-1;}state.user=d.user;state.notice=d.rewarded?"You earned 10 MC! 🐱":"";render();return;}
      if(b.id==="exchange"){const d=await api("/api/exchange",{method:"POST"});state.user=d.user;toast("Exchanged 1,000 MC for 1 LoveCard! 💌");return;}
      if(b.dataset.buy){
        let d;
        // If you can't afford it, AI has just messaged you, so update the Friends badge straight away.
        try{d=await api(`/api/shop/${b.dataset.buy}/buy`,{method:"POST"});}catch(err){toast(err.message,true);state.social=await api("/api/friends");friendsBadge();return;}
        state.user=d.user;state.inventory=d.inventory;const t=state.themes.find(x=>x.item===b.dataset.buy);toast(t?`${t.name} theme is on! ${t.icon} You can switch themes any time in Settings.`:"Purchased! ✨");return;
      }
      if(b.id==="aiChat"){await openAIChat();return;}
      if(b.id==="cameraBtn"){if(state.user)await takePicture();else openAuth("login");return;}
      if(b.id==="screamBtn"){screamOff=!screamOff;try{localStorage.setItem(SCREAM_KEY,screamOff?"off":"on");}catch{}if(screamOff)stopScream();screamButton();if(state.page==="nails")render();return;}
      if(b.id==="adultStart"){if(!state.user.admin)return adultModal("confirm");await enteredZone(await api("/api/adult",send("PUT",{on:true})));return;}
      if(b.id==="kidStart"){if(!state.user.admin)return kidModal("confirm");await enteredKidZone(await api("/api/kid",send("PUT",{on:true})));return;}
      if(b.id==="kidOffAdmin"){const d=await api("/api/kid",send("PUT",{on:false}));await zoneChanged(d.user);toast("The kiddy zone is off. Welcome back! 🌸");return;}
      if(b.id==="kidForgot"){kidModal("email",{reset:true});return;}
      if(b.id==="kidFaceBtn"){kidFaceModal();return;}
      if(b.id==="changeUsername"){usernameModal();return;}
      if(b.id==="emailBtn"){emailModal();return;}
      if(b.id==="changeDisplayName"){displayNameModal();return;}
      if(b.id==="bellBtn"){await toggleBell();return;}
      if(b.dataset.notif){const n=state.notifications?.find(x=>x.id===Number(b.dataset.notif));if(n)await openNotification(n);return;}
      if(b.dataset.comments){await toggleComments(Number(b.dataset.comments));return;}
      if(b.dataset.commentReact){setComments(Number(b.dataset.postOf),await api(`/api/comments/${b.dataset.comment}/reactions`,send("POST",{emoji:b.dataset.commentReact})));return;}
      if(b.dataset.commentPick){const id=b.dataset.commentPick,postId=Number(b.dataset.postOf);openEmojiPicker("😊 React to the comment",async emoji=>{try{setComments(postId,await api(`/api/comments/${id}/reactions`,send("POST",{emoji})));}catch(err){toast(err.message,true);}});return;}
      if(b.dataset.commentReport){reportModal(Number(b.dataset.commentReport),"comment");return;}
      if(b.dataset.suspend){suspendModal(Number(b.dataset.suspend),b.dataset.name,b.dataset.reason||"");return;}
      if(b.dataset.genderPick){await pickGender(b.dataset.genderPick);return;}
      if(b.id==="genderCheck"){await refresh();render();toast(state.user?.gender?`All done! Welcome to the ${GENDERS[state.user.gender].zone} zone ${GENDERS[state.user.gender].icon}`:"Still waiting for the creator. 🚻");return;}
      if(b.dataset.setGender){const g=GENDERS[b.dataset.gender];state.safety.data=await api(`/api/users/${b.dataset.setGender}/gender`,send("POST",{gender:b.dataset.gender}));render();toast(`${b.dataset.name} is a ${g.name} ${g.icon}. They can use Yakimma now.`);return;}
      if(b.dataset.postAudience){audienceModal(Number(b.dataset.postAudience));return;}
      if(b.dataset.unsuspend){if(!confirm(`Lift ${b.dataset.name}'s suspension? They can use Yakimma again straight away.`))return;await api(`/api/users/${b.dataset.unsuspend}/suspend`,{method:"DELETE"});await suspensionsChanged();toast(`${b.dataset.name} can use Yakimma again. ✅`);return;}
      if(b.dataset.keepComment){state.reports=await api(`/api/reports/comments/${b.dataset.keepComment}`,{method:"DELETE"});toast("Kept. The reports on that comment are cleared ✅");return;}
      if(b.dataset.reportCommentDelete){if(!confirm("Delete this comment? Any replies to it go too. This can't be undone."))return;await api(`/api/comments/${b.dataset.reportCommentDelete}`,{method:"DELETE"});state.reports=await api("/api/reports");toast("The comment is deleted. 🗑️");return;}
      if(b.dataset.safetyTab){Object.assign(state.safety||={user:""},{tab:b.dataset.safetyTab,data:null});render();await loadSafety();render();return;}
      if(b.id==="safetyClear"){state.safety.user="";state.safety.data=null;render();await loadSafety();render();return;}
      if(b.dataset.safetyChat){await openSafetyChat(`a=${b.dataset.safetyChat}&b=${b.dataset.with}`,b.dataset.title);return;}
      if(b.dataset.safetyGroup){await openSafetyChat(`group=${encodeURIComponent(b.dataset.safetyGroup)}`,b.dataset.title);return;}
      if(b.dataset.safetyCommentDelete){if(!confirm("Delete this comment? Any replies to it go too. This can't be undone."))return;await api(`/api/comments/${b.dataset.safetyCommentDelete}`,{method:"DELETE"});await loadSafety();toast("The comment is deleted. 🗑️");return;}
      if(b.dataset.postThumb){const p=postCopies(Number(b.dataset.postThumb))[0];if(p)thumbModal(p);return;}
      if(b.dataset.commentReply){const postId=Number(b.dataset.postOf),c=state.comments[postId];Object.assign(c,{replyTo:Number(b.dataset.commentReply),replyDraft:b.dataset.tag?`@${b.dataset.tag} `:""});render();const i=$(`[data-reply-to="${c.replyTo}"] input`);if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}return;}
      if(b.dataset.replyCancel){Object.assign(state.comments[Number(b.dataset.replyCancel)],{replyTo:null,replyDraft:""});render();return;}
      if(b.dataset.commentDelete){if(!confirm("Delete this comment? Any replies to it go too. This can't be undone."))return;setComments(Number(b.dataset.postOf),await api(`/api/comments/${b.dataset.commentDelete}`,{method:"DELETE"}));return;}
      if(b.dataset.nickname){nicknameModal(Number(b.dataset.nickname),b.dataset.name);return;}
      if(b.dataset.assistant){const d=await api("/api/me/assistant",send("PUT",{userId:Number(b.dataset.assistant)}));state.user=d.user;state.person=await api(`/api/users/${state.person.user.id}`);toast(`${nameText(state.person.user.username)} is now your assistant! 🤝`);return;}
      if(b.dataset.assistantRemove){const d=await api("/api/me/assistant",send("PUT",{userId:null}));state.user=d.user;if(state.page==="person"&&state.person)state.person=await api(`/api/users/${state.person.user.id}`);toast("You don't have an assistant now. 🤝");return;}
      if(b.dataset.viewPerson){await openPerson(Number(b.dataset.viewPerson));return;}
      if(b.dataset.postVisibility){visibilityModal(Number(b.dataset.postVisibility));return;}
      if(b.dataset.descToggle){const d=b.previousElementSibling;b.textContent=d.classList.toggle("clamped")?"…more":"Show less";return;}
      if(b.dataset.copyLink){const who={public:"Anyone can open it.",unlisted:"Only your friends on Yakimma can open it.",private:"Only you can open it."}[b.dataset.visibility]||"";try{await navigator.clipboard.writeText(postLink(b.dataset.copyLink));toast(`The link is copied. ${who} 🔗`);}catch{toast(`Copy this link: ${postLink(b.dataset.copyLink)} ${who}`);}return;}
      if(b.dataset.personTab){state.personTab=b.dataset.personTab;render();return;}
      if(b.dataset.followList){await followList(Number(b.dataset.user),b.dataset.followList,b.dataset.name);return;}
      if(b.dataset.follow){state.person=await api(`/api/users/${b.dataset.follow}/follow`,{method:"POST"});toast(`You're following ${state.person.user.username}! ➕`);return;}
      if(b.dataset.unfollow){state.person=await api(`/api/users/${b.dataset.unfollow}/follow`,{method:"DELETE"});toast(`You unfollowed ${state.person.user.username}.`);return;}
      if(b.dataset.friendPerson){const name=b.dataset.friendPerson,d=await api("/api/friends/request",send("POST",{username:name}));state.social=d;state.person=await api(`/api/users/${state.person.user.id}`);toast(d.accepted?`You and ${name} are now friends! 🎉`:`Friend request sent to ${name}! 💌`);return;}
      if(b.dataset.declinePerson){state.social=await api(`/api/friends/requests/${b.dataset.declinePerson}`,{method:"DELETE"});state.person=await api(`/api/users/${state.person.user.id}`);toast("Friend request declined.");return;}
      if(b.dataset.acceptPerson){state.social=await api(`/api/friends/requests/${b.dataset.acceptPerson}/accept`,{method:"POST"});state.person=await api(`/api/users/${state.person.user.id}`);toast("You're now friends! 🎉");return;}
      // The song starts straight away, while this tap still counts as a tap, and is saved after.
      if(b.dataset.song){const before=state.user.song;state.user.song=b.dataset.song;syncMusic();render();try{state.user=(await api("/api/me/song",send("PUT",{song:b.dataset.song}))).user;}catch(err){state.user.song=before;syncMusic();toast(err.message,true);}render();return;}
      if(b.dataset.playlist){await togglePlaylist(Number(b.dataset.playlist));return;}
      if(b.id==="playlistAll"){state.playlistAll=!state.playlistAll;render();return;}
      if(b.dataset.deletePost){await deletePost(Number(b.dataset.deletePost));return;}
      if(b.dataset.reportPost){reportModal(Number(b.dataset.reportPost));return;}
      if(b.dataset.keepPost){state.reports=await api(`/api/reports/${b.dataset.keepPost}`,{method:"DELETE"});toast("Kept. The reports on that post are cleared ✅");return;}
      if(b.dataset.learnSubject){openLearnSubject(b.dataset.learnSubject);return;}
      if(b.dataset.learnBack!==undefined){const L=state.learn;if(L.quiz)L.quiz=null;else Object.assign(L,{subject:null,unlocked:null});render();return;}
      if(b.dataset.learnUnlock!==undefined){unlockGrades();return;}
      if(b.dataset.learnGrade){regionModal(state.learn.subject,Number(b.dataset.learnGrade));return;}
      if(b.dataset.learnStart!==undefined){await startQuiz(state.learn.quiz?.subject||state.learn.subject);return;}
      if(b.dataset.learnChoice){const q=state.learn.quiz,item=q.questions[q.at];q.picked=Number(b.dataset.learnChoice);if(item.choices[q.picked]===item.right)q.score++;render();return;}
      if(b.dataset.learnNext!==undefined){const q=state.learn.quiz;q.at++;q.picked=null;render();return;}
      if(b.id==="adultOff"){const d=await api("/api/adult",send("PUT",{on:false}));await zoneChanged(d.user);toast("18+ is off. Welcome back! 🌸");return;}
      if(b.dataset.kuchi){answerKuchi(b.dataset.kuchi);return;}
      if(b.dataset.picture){openPicture(Number(b.dataset.picture));return;}
      if(b.dataset.deletePicture){if(!confirm("Delete this picture?"))return;state.pictures=await api(`/api/pictures/${b.dataset.deletePicture}`,{method:"DELETE"});closeModal();toast("Picture deleted.");return;}
      if(b.dataset.useTheme){await useTheme(b.dataset.useTheme);return;}
      // Joining takes you straight into the group's chat.
      if(b.dataset.joinGroup){closeModal();setGroups(await api(`/api/groups/${b.dataset.joinGroup}/join`,{method:"POST"}));await openGroup(b.dataset.joinGroup);toast("You joined the group! 🎉 Say hi in the chat.");return;}
      if(b.dataset.openGroup){await openGroup(b.dataset.openGroup);return;}
      if(b.dataset.members){if(!state.user){openAuth("login");return;}await openMembers(b.dataset.members);return;}
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
        if(b.dataset.art){toggleArt(b.dataset.art);return;}
        if(b.dataset.artPick){s.artPick=b.dataset.artPick;render();return;}
        if(b.dataset.artReset){resetArt(b.dataset.artReset);return;}
        if(b.dataset.accent){colourArt(b.dataset.accent);return;}
        if(b.id==="resetNails"){s.design=newDesign();render();return;}
        if(b.id==="leaveSalon"){state.salon=null;render();return;}
        if(b.id==="sendNails"){
          const client=salonClient();
          await api("/api/nails",send("POST",{friendId:s.friendId,design:s.design}));
          state.salon=null;
          if(client?.self){await loadSocial();toast("All done! You're wearing your new nails. 💅 They're on your profile too.");}
          else toast(`All done! ${client?.username||"Your friend"} can see their new nails on their profile. 💌`);
          return;
        }
      }
      // Speed and Effects change the post in place (no full redraw), so the video keeps playing.
      if(b.dataset.viewer){const v=viewOf(b.dataset.post);v.open=v.open===b.dataset.viewer?null:b.dataset.viewer;drawViewer(b.dataset.post);return;}
      if(b.dataset.setSpeed){const v=viewOf(b.dataset.post);v.speed=Number(b.dataset.setSpeed);drawViewer(b.dataset.post);applySpeeds();return;}
      if(b.dataset.setEffect){viewOf(b.dataset.post).effect=b.dataset.setEffect;drawViewer(b.dataset.post,true);return;}
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
    const place = { artSize: v => ({ size: v / 100 }), artTurn: v => ({ turn: v }), artX: v => ({ x: v / 100 }), artY: v => ({ y: v / 100 }) }[e.target.id];
    if (place) placeArt(place(Number(e.target.value)));
    const wheel = e.target.dataset.wheelLight;
    if (wheel) setWheel(wheel, { ...wheelColour(wheel), v: Number(e.target.value) / 100 });
  });
  // Choosing a video to post shows its thumbnail picker.
  document.addEventListener("change", e => {
    if (e.target.id !== "media") return;
    const file = e.target.files[0], box = $("#thumbBox"), video = file?.type.startsWith("video/");
    state.createThumb = null;
    box.hidden = !video;
    if (!video) return;
    box.innerHTML = box.innerHTML.replace(/<div class="thumb-picker">[\s\S]*$/, thumbPickerHTML());
    wireThumbPicker(box, URL.createObjectURL(file), blob => { state.createThumb = blob; }, true);
  });
  document.addEventListener("change", e => {
    if (!state.salon) return;
    if (e.target.id === "applyAll") { state.salon.applyAll = e.target.checked; render(); }
  });
  document.addEventListener("pointerdown", e => {
    const s = state.salon, spot = s && e.target.closest("#closeup, [data-wheel]");
    if (!spot) return;
    s.drag = spot.id === "closeup" ? "place" : spot.dataset.wheel;
    if (s.drag === "place") {
      // Grab a sticker or gem where you touch it and it follows your finger. Touch anywhere else and the art you're working on jumps there.
      const at = closeupSpot(e), hit = grabbableAt(at);
      if (hit) s.artPick = hit.id;
      s.grab = hit ? { x: at.x - hit.x, y: at.y - hit.y } : { x: 0, y: 0 };
    }
    spot.setPointerCapture(e.pointerId);
    e.preventDefault();
    salonDrag(e);
  });
  document.addEventListener("pointermove", e => { if (state.salon?.drag) salonDrag(e); });
  for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, () => { if (state.salon?.drag) { state.salon.drag = null; render(); } });
  // What's typed in a comment box is kept, so the page drawing itself again doesn't wipe it.
  document.addEventListener("input", e => {
    const form = e.target.closest("[data-comment-form]");
    if (form) ((state.comments ||= {})[form.dataset.commentForm] ||= {})[form.dataset.replyTo ? "replyDraft" : "draft"] = e.target.value;
  });
  document.addEventListener("submit", async e=>{
    if (e.target.id === "safetyFilter") {
      e.preventDefault();
      Object.assign(state.safety, { user: $("#safetyUser").value.trim(), data: null }); render();
      try { await loadSafety(); render(); } catch (err) { toast(err.message, true); }
      return;
    }
    const commentForm = e.target.closest("[data-comment-form]");
    if (commentForm) {
      e.preventDefault();
      const postId = Number(commentForm.dataset.commentForm), parentId = commentForm.dataset.replyTo ? Number(commentForm.dataset.replyTo) : null;
      const body = commentForm.querySelector("input").value.trim(), btn = commentForm.querySelector("[type=submit]"), c = state.comments[postId];
      if (!body) return;
      btn.disabled = true;
      try {
        const d = await api(`/api/posts/${postId}/comments`, send("POST", { body, parentId }));
        if (parentId) Object.assign(c, { replyTo: null, replyDraft: "" }); else c.draft = "";
        setComments(postId, d);
        if (!parentId) $(`[data-comment-form="${postId}"]:not([data-reply-to]) input`)?.focus();
      }
      catch (err) { btn.disabled = false; toast(err.message, true); }
      return;
    }
    // Quick sign-in, on the device that's already signed in: confirming the code from a new device signs it in.
    if(e.target.id==="quickConfirmForm"){
      e.preventDefault();
      const code=$("#quickConfirmCode").value.trim();
      if(!code)return toast("Type the code your new device is showing.",true);
      if(!confirm(`Sign in to your account (${state.user.username}) on the device showing ${code.toUpperCase()}?\n\nOnly do this if that code is on YOUR OWN device. Whoever has that device can use your account.`))return;
      try { await api("/api/quick-signin/confirm",send("POST",{code}));$("#quickConfirmCode").value="";toast("Done! ✅ Your new device is signed in to your account."); }
      catch(err){toast(err.message,true);}
      return;
    }
    if(e.target.id==="kidOffForm"){
      e.preventDefault();
      try { const d=await api("/api/kid",send("PUT",{on:false,password:$("#kidOffPass").value}));await zoneChanged(d.user);toast("The kiddy zone is off. Welcome back! 🌸"); }
      catch(err){toast(err.message,true);}
      return;
    }
    if(e.target.id==="friendForm"){
      e.preventDefault();
      const q=$("#friendName").value.trim();
      try { state.friendSearch={q,users:(await api(`/api/users?q=${encodeURIComponent(q)}`)).users};state.notice="";render(); }
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
      try { const d=await api("/api/groups",send("POST",draft));setGroups(d);state.groupDraft=null;await openGroup(String(d.groupId));toast(`Your group "${draft.name}" is ready! 🏘️ Start the chat.`); }
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
    const visibility=$('input[name="visibility"]:checked').value, audience=$('input[name="audience"]:checked')?.value;
    if(!audience)return toast("Choose who it's for first: 💙 Boys, 💗 Girls or 💜 Both.",true);
    const body=new FormData();body.append("caption",caption);body.append("description",$("#description").value.trim());body.append("visibility",visibility);body.append("audience",audience);if(file)body.append("media",file);
    if(file?.type.startsWith("video/")&&state.createThumb)body.append("thumb",state.createThumb,"thumb.jpg");
    try {
      const d=await api("/api/posts",{method:"POST",body});state.notice="";await refresh();
      // Public posts go to the feed; unlisted and private ones only show on your profile.
      if(visibility==="public"){state.page="feed";toast("Your post is published on this server! 🌸");}
      else if(visibility==="unlisted"){state.page="feed";toast("Your unlisted post is ready. Only your friends on Yakimma can see it. 👯");}
      else{state.page="profile";state.myPosts=null;await loadPageData();toast("Your private post is saved. Only you can see it, on your profile. 🔒");}
    }
    catch(err){toast(err.message,true);}
  });
  // ---- The song picked in Settings, played on a loop on every page. Browsers only let a page play sound after you've
  // tapped something on it, so if it can't start yet, it starts on your next tap. ----
  const music = Object.assign(new Audio(), { loop: true, volume: 0.5 });
  function syncMusic() {
    const song = state.user && state.songs?.find(s => s.id === state.user.song && s.file && s.ready && !s.lock);
    if (!song) { if (!music.paused) music.pause(); return; }
    const src = `/songs/${song.file}`;
    if (music.getAttribute("src") !== src) music.src = src;
    if (music.paused) music.play().catch(() => {});
  }
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, syncMusic);
  // Every password box gets the eye button (EYE_OPEN while the password is hidden as dots, EYE_CLOSED while it's
  // shown), including boxes added later.
  function addPasswordEyes() {
    for (const input of document.querySelectorAll('input[type="password"]:not([data-eye])')) {
      input.dataset.eye = "";
      const focused = document.activeElement === input, wrap = document.createElement("div"), eye = document.createElement("button");
      const show = shown => {
        const label = shown ? "Hide password" : "Show password";
        input.type = shown ? "text" : "password";
        Object.assign(eye, { innerHTML: shown ? EYE_CLOSED : EYE_OPEN, title: label });
        eye.setAttribute("aria-label", label);
        eye.setAttribute("aria-pressed", String(shown));
      };
      wrap.className = "password-wrap";
      eye.type = "button"; eye.className = "eye";
      eye.onclick = () => { show(input.type === "password"); input.focus(); };
      show(false);
      input.replaceWith(wrap);
      wrap.append(input, eye);
      if (focused) input.focus();
    }
  }
  new MutationObserver(addPasswordEyes).observe(document.body, { childList: true, subtree: true });
  $("#homeBtn").addEventListener("click",e=>{e.preventDefault();state.page="feed";state.notice="";render();});
  async function init(){
    // A post's link (/post/<code>, or an older /post/<number>) opens that post.
    const link = location.pathname.match(/^\/post\/([A-Za-z0-9_~-]+)$/);
    if (link) Object.assign(state, { page: "post", postKey: link[1] });
    // Back from signing in with Google: say how it went, and take ?signin= off the address.
    const signin = new URLSearchParams(location.search).get("signin");
    if (signin !== null) history.replaceState(null, "", location.pathname);
    try{
      await refresh();if(link)await loadPageData();render();
      if (signin === "google" && state.user) toast(`Welcome back, ${state.user.username}! 🩵`);
      else if (Object.hasOwn(SIGNIN_NOTES, signin) && SIGNIN_NOTES[signin]) toast(SIGNIN_NOTES[signin], true);
    }catch(err){toast(err.message,true);}
  }
  init();
})();
