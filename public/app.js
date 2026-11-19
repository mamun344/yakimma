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
    // postSearch: the 🔎 search on the Feed while it's open ({ q, kind: "all"|"video"|"text", posts: null until it searches }).
    postSearch: null,
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
  // ---- 🌐 Languages: public/i18n.js translates everything on the page (and in Old Mode) into the language picked. ----
  const { LANGUAGES, LANG_KEY, i18n, storedLang, langOf, locales, tr, countriesIn, useLanguage } = window.yakimmaLanguages;
  // Signed in: the language on your account is the one used here (picked on another device, it follows you). A language
  // picked here before signing in is saved to an account that has none.
  function syncLanguage() {
    const mine = state.user?.language, here = storedLang();
    if (!state.user) return;
    if (!mine) { if (here) api("/api/me/language", send("PUT", { language: here })).then(d => { state.user.language = d.user.language; }, () => {}); return; }
    if (mine === here) return;
    try { localStorage.setItem(LANG_KEY, mine); } catch {}
    // From English the page can just start translating; from another language it opens again.
    if (i18n.code === "en") useLanguage(mine).then(render); else location.reload();
  }
  // The language picker: the first time it can't be closed until a language is chosen. Choosing one says Welcome! in it,
  // then Yakimma opens again in that language.
  function languageModal(first = false) {
    const current = first ? null : i18n.code;
    $("#modalroot").innerHTML = `<div class="modalback lang-back" id="modalback"><section class="modal lang-modal" role="dialog" aria-modal="true" aria-labelledby="langTitle" translate="no">` +
      `<div class="row between"><h2 id="langTitle">🌐 Language · ভাষা · भाषा · اللغة · Idioma · 语言</h2>${first ? "" : `<button class="soft" id="closeModal" aria-label="Close">✕</button>`}</div>` +
      `<div class="lang-grid">${LANGUAGES.map(l => `<button class="lang-pick ${l.code === current ? "on" : ""}" data-lang="${l.code}" lang="${l.code}" dir="${l.rtl ? "rtl" : "ltr"}" aria-pressed="${l.code === current}">${l.name}</button>`).join("")}</div></section></div>`;
    if (!first) { $("#closeModal").onclick = closeModal; $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); }; }
    $(".lang-modal").onclick = async e => {
      const b = e.target.closest("[data-lang]");
      if (!b) return;
      const lang = langOf(b.dataset.lang);
      try { localStorage.setItem(LANG_KEY, lang.code); } catch {}
      if (state.user) await api("/api/me/language", send("PUT", { language: lang.code })).catch(() => {});
      $("#modalroot").innerHTML = `<div class="modalback lang-back"><section class="modal lang-welcome" role="dialog" aria-modal="true" aria-label="${safe(lang.welcome)}" translate="no" lang="${lang.code}" dir="${lang.rtl ? "rtl" : "ltr"}">` +
        `<div class="lang-hello">🌸</div><h2>${safe(lang.welcome)}</h2></section></div>`;
      // A moment to see Welcome!, then everything opens again in the new language.
      setTimeout(() => { try { sessionStorage.setItem("yakimma.welcomed", "1"); } catch {} location.reload(); }, 1600);
    };
  }
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
    // 🤪 CRAZZZYYY MODE turns the whole page around, but only in Arabic.
    const dir = crazyOn() && i18n.code === "ar" ? "rtl" : "ltr";
    if (root.dir !== dir) root.dir = dir;
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
    // In the 18+ zone only Kuchisake-onna's page (which takes the place of Nails) gets the 👹🩸 art (🤡🎉 in CRAZZZYYY MODE).
    const art = zone ? (state.page === "nails" ? (crazyOn() ? "🤡🎉" : "👹🩸") : "") : themeById(activeTheme())?.art || "🌸🩵";
    return `<section class="hero"><div><span class="pill">${zone ? "<span>🔞 18+ · </span>" : kidOn() ? "<span>🧸 KIDDY ZONE · </span>" : ""}<span>${tag}</span></span><h1>${title}</h1><p>${desc}</p></div>${art ? `<div style="font-size:3.2rem" aria-hidden="true">${art}</div>` : ""}</section>`;
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
  // Admins (the creator too) have 🛠️ Admin next to their name.
  const nameHTML = username => {
    const shown = shownName(username), admin = state.admins?.has(username?.toLowerCase()) ? ` <span class="admin-tag" title="Yakimma admin">🛠️ Admin</span>` : "";
    return `<span translate="no">${shown ? `${safe(shown)} <small class="at-name">@${safe(username)}</small>` : safe(username)}</span>` + admin;
  };
  // Text someone wrote, with each @username (a tag) picked out; tapping one opens that person's profile. The same pattern
  // is in server.js. Inside a button (like a chat bubble) a tag can't be a button too, so there it's a span.
  const TAG = /(^|[^A-Za-z0-9@])@([A-Za-z0-9]{3,20})(?![A-Za-z0-9])/g;
  const richText = (text, inButton = false) => `<span translate="no">${safe(text).replace(TAG, (_, before, name) =>
    before + (inButton ? `<span class="mention" data-mention="${name}">@${name}</span>` : `<button type="button" class="mention" data-mention="${name}">@${name}</button>`))}</span>`;
  // Something someone wrote (a group's name, a message in a line…), which isn't translated.
  const ugc = text => `<span translate="no">${safe(text)}</span>`;
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
  // ---- 🔔 Device notifications: the first time someone opens Yakimma signed in on a phone or laptop, it asks if their
  // notifications should pop up on that device too. Yes: the browser asks for permission, then everything that goes in
  // their 🔔 also pops up there by itself, even when Yakimma is closed (public/sw.js shows them; see "Notifications on
  // your phone or laptop" in server.js). No: they only show in 🔔. Each account on each device answers once, and can
  // change it in Settings. Signing out stops them on that device until that account signs in there again. ----
  const pushReady = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const pushKey = () => `yakimma.push.${state.user.id}`;
  const pushOn = () => pushReady() && stored(pushKey()) === "on" && Notification.permission === "granted";
  const keyBytes = b64 => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  async function pushSubscribe() {
    const reg = await navigator.serviceWorker.register("/sw.js"), key = keyBytes((await api("/api/push/key")).key);
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // An address made with an older key (if the server's keys changed) can't be used any more.
    const old = sub?.options.applicationServerKey;
    if (sub && !(old && old.byteLength === key.length && new Uint8Array(old).every((x, i) => x === key[i]))) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api("/api/push/subscribe", send("POST", { subscription: sub.toJSON() }));
  }
  async function pushUnsubscribe() {
    const sub = pushReady() && await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (!sub) return;
    await api("/api/push/unsubscribe", send("POST", { endpoint: sub.endpoint })).catch(() => {});
    await sub.unsubscribe();
  }
  async function setPush(on) {
    const save = choice => { try { localStorage.setItem(pushKey(), choice); } catch {} };
    if (!on) { save("off"); await pushUnsubscribe().catch(() => {}); return toast("OK! Your notifications only show in 🔔 on Yakimma."); }
    // Asked straight away (before anything else is awaited), while it still counts as the tap that asked for it.
    if (await Notification.requestPermission() !== "granted") { save("off"); return toast("Your browser didn't allow notifications, so they only show in 🔔 on Yakimma.", true); }
    try { await pushSubscribe(); save("on"); toast("Notifications are on! 🔔 This device shows them, even when Yakimma is closed."); }
    catch { save("off"); toast("This browser can't show Yakimma's notifications by itself, so they show in 🔔 on Yakimma.", true); }
  }
  function pushModal() {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="pushTitle"><h2 id="pushTitle">🔔 Turn on notifications?</h2>` +
      `<p>If you say yes, your phone or laptop shows your Yakimma notifications by itself (like friend requests, likes and comments), even when Yakimma is closed.</p>` +
      `<p class="muted-note">If you say no, they only show in 🔔 on Yakimma. You can change this in ⚙️ Settings.</p>` +
      `<div class="actions"><button class="primary" id="pushYes">🔔 Yes, turn them on</button><button class="soft" id="pushNo">No thanks</button></div></section></div>`;
    $("#pushYes").onclick = () => { closeModal(); setPush(true); };
    $("#pushNo").onclick = () => { closeModal(); setPush(false); };
  }
  // Called when Yakimma opens and after signing in. It asks once nothing else is open (like choosing a language).
  let pushAsked = false;
  function syncPush() {
    if (!state.user || !pushReady()) return;
    const choice = stored(pushKey());
    if (choice === "on") { if (Notification.permission === "granted") pushSubscribe().catch(() => {}); return; }
    if (choice || pushAsked || Notification.permission === "denied" || state.user.suspended || !state.user.gender) return;
    pushAsked = true;
    if (!$("#modalroot").innerHTML) return pushModal();
    const wait = new MutationObserver(() => { if (!$("#modalroot").innerHTML && state.user) { wait.disconnect(); pushModal(); } });
    wait.observe($("#modalroot"), { childList: true });
  }
  function pushPanel() {
    const why = !pushReady() ? "This browser can't show Yakimma's notifications by itself, so they show in 🔔 on Yakimma."
      : pushOn() ? "On: this device shows your notifications, even when Yakimma is closed."
      : Notification.permission === "denied" ? "Your browser is blocking Yakimma's notifications. Allow them in your browser's settings, then turn them on here."
      : "Off: your notifications only show in 🔔 on Yakimma.";
    return `<section class="panel"><h2>🔔 Notifications</h2><p class="muted-note">${why}</p>` +
      (pushReady() ? `<button class="soft" data-push="${pushOn() ? "off" : "on"}">${pushOn() ? "Turn off" : "🔔 Turn on"}</button>` : "") + `</section>`;
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
    gender: () => "is waiting for you to choose Boy or Girl for them 🚻",
    // Groups: someone asked to join one you're an admin of, added you to one, or reported one (only the creator gets those).
    group_request: n => `asked to join ${groupLabel(n.group)} 🙋`,
    group_added: n => `added you to ${groupLabel(n.group)} 👥`,
    group_report: n => `reported the group ${groupLabel(n.group)} 🚩`,
    user_report: () => "reported someone 🚩",
    admin_made: () => "made you an admin 🛠️",
    admin_removed: () => "took away your admin 🛠️",
    renamed: () => "changed your username ✏️",
    // The group's name goes after the words, so the whole sentence can be translated.
    missed_call: n => n.group ? `${n.details === "video" ? "video called the group, but you missed it 🎥" : "called the group, but you missed it 📞"} · ${groupLabel(n.group)}`
      : n.details === "video" ? "video called you, but you missed it 🎥" : "called you, but you missed it 📞"
  };
  const groupLabel = g => g ? `${safe(g.icon)} ${ugc(g.name)}` : "a group that's gone now";
  // Opening the bell shows the newest notifications (new ones highlighted) and marks them all as seen.
  async function toggleBell() {
    if ($("#notifMenu")) return $("#notifMenu").remove();
    const d = await api("/api/notifications");
    state.notifications = d.notifications;
    const row = n => `<button class="notif ${n.read ? "" : "new"}" role="menuitem" data-notif="${n.id}">${avatarHTML(n.actor.avatar, "tiny")}<span><strong>${nameHTML(n.actor.username)}</strong> ${NOTIFY_TEXT[n.kind]?.(n) || ""}` +
      `${n.details || n.comment ? `<small class="notif-quote" translate="no">“${safe(n.details || n.comment.preview)}”</small>` : ""}<small>${timeLabel(n.createdAt)}</small></span></button>`;
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
      Object.assign(state, { page: "reports", notice: "", groupView: null, chat: null });
      render(); await loadPageData(); render();
      return;
    }
    if (n.kind === "gender") {
      if (pageGone("safety")) return toast(goneNote("safety"), true);
      Object.assign(state, { page: "safety", notice: "", groupView: null, chat: null, safety: { tab: "genders", user: "" } });
      render(); await loadPageData(); render();
      return;
    }
    if (n.post) {
      if (n.comment) (state.comments ||= {})[n.post.id] = { open: true };
      if (n.post.groupKey) { await openGroup(n.post.groupKey, "posts"); if (n.comment) await loadComments(n.post.id); return; }
      Object.assign(state, { page: "post", postKey: n.post.code, single: null, notice: "", chat: null, groupView: null });
      render(); await loadPageData();
      if (n.comment && state.single?.post) await loadComments(n.post.id); else render();
      window.scrollTo(0, 0);
      return;
    }
    // Becoming an admin (or not) changes what you can do, so your account loads again first.
    if (n.kind.startsWith("admin_")) { await refresh(); render(); return openPerson(n.actor.id); }
    if (n.kind === "renamed") { await refresh(); return goTo("profile"); }
    if (n.group || n.kind.startsWith("group_")) {
      const g = n.group;
      if (!g) return toast("That group doesn't exist any more.", true);
      if (!g.member) { Object.assign(state, { page: "groups", groupView: null, chat: null, notice: "" }); render(); await loadPageData(); render(); return toast(`You're not in ${g.name}.`); }
      await openGroup(g.key);
      // Someone asking to join: their request is in Group info.
      if (n.kind === "group_request") await openGroupInfo();
      return;
    }
    if (n.message?.friendId) return openChat(n.message.friendId);
    if (n.kind === "missed_call") return openChat(n.actor.id);
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
      (g.secret ? `<p class="muted-note">This is a secret group. The only way in is its code.</p>` : `<div class="actions"><button class="primary" data-join-group="${safe(g.key)}">🙋 Ask to join</button></div>`) + `</section></div>`;
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
    const badge = label ? ` <span class="badge" aria-label="${label}">${requests + unread}</span>` : "";
    $('.nav[data-page="friends"]').innerHTML = `👯 Friends${badge}`;
    // While Friends is tucked away under Profile, its badge shows on Profile's arrow so you don't miss it.
    $('[data-nav-group="profile"]').innerHTML = navOpen.profile ? "" : badge;
  }
  // The menu's ▸ arrows open the pages tucked in under them (in public/index.html): Profile's opens Pictures, Settings
  // and Friends, Friends' opens Groups and Nails, and Shop's opens Codes. Which ones are open is kept in this browser.
  // Going to a tucked-away page opens the arrows above it, so you see where you are. An arrow with nothing to open
  // (Shop's for guests, who don't get Codes) leaves the menu.
  const NAV_KEY = "yakimma.navOpen";
  const navOpen = (() => { try { return JSON.parse(localStorage.getItem(NAV_KEY)) || {}; } catch { return {}; } })();
  let navPage = null;
  function navGroups() {
    const arrows = [...document.querySelectorAll(".nav-arrow")], groupOf = a => $(`#${a.getAttribute("aria-controls")}`);
    const pagesIn = a => [...groupOf(a).querySelectorAll(".nav")];
    if (state.page !== navPage) {
      navPage = state.page;
      for (const a of arrows) if (pagesIn(a).some(b => b.dataset.page === state.page)) navOpen[a.dataset.navGroup] = true;
    }
    for (const a of arrows) {
      const open = Boolean(navOpen[a.dataset.navGroup]);
      a.hidden = pagesIn(a).every(b => b.hidden);
      a.setAttribute("aria-expanded", String(open));
      groupOf(a).hidden = !open || a.hidden;
    }
    try { localStorage.setItem(NAV_KEY, JSON.stringify(navOpen)); } catch {}
  }
  function toggleNavGroup(g) { navOpen[g] = !navOpen[g]; navGroups(); friendsBadge(); }
  async function loadSocial() {
    if (!state.user) { state.social = { friends: [], incoming: [], outgoing: [] }; state.received = []; state.salon = null; return; }
    const [social, nails] = await Promise.all([api("/api/friends"), api("/api/nails")]);
    state.social = social; state.received = nails.received || [];
  }
  // ---- Old Mode (⚙️ Settings): this browser shows the first Yakimma that was released (public/old) instead. Someone
  // with something left to do here first (picking Boy or Girl, religion and country, or seeing their suspension) stays
  // here until it's done, and guests always see this one. ----
  const OLD_MODE = "yakimma.oldMode";
  const oldModeOn = () => { try { return localStorage.getItem(OLD_MODE) === "on"; } catch { return false; } };
  const oldModeOk = u => Boolean(u && u.gender && u.religion && u.country && !(u.suspended && !u.creator));
  async function refresh() {
    const [me, feed] = await Promise.all([api("/api/me"), api("/api/posts")]);
    if (oldModeOn() && oldModeOk(me.user)) return location.replace("/old/");
    state.user = me.user; state.displayNames = me.displayNames || {}; state.admins = new Set(me.admins || []); state.unread = me.notifications || 0; state.products = me.products || []; state.inventory = me.inventory || []; state.posts = feed.posts || []; state.learnData = me.learn || null; state.reportReasons = me.reportReasons || []; state.usernameCost = me.usernameCost; state.songs = me.songs || [];
    if (me.religions) Object.assign(state, { religions: me.religions, countries: countriesIn(me.countries) });
    state.googleSignIn = Boolean(me.googleSignIn);
    if (me.themes) state.themes = me.themes;
    if (me.nailOptions) state.nailOptions = me.nailOptions;
    if (me.avatarOptions) state.avatarOptions = me.avatarOptions;
    // A suspended account only sees the suspension screen (and the rules), so there's nothing else to load.
    if (state.user?.suspended) Object.assign(state, { social: { friends: [], incoming: [], outgoing: [] }, received: [] });
    else await loadSocial();
    wallet();
    syncLive();
    syncLanguage();
    if (state.user && !(state.user.religion && state.user.country)) identityModal();
    // An invite link opened before signing in opens once they have.
    else if (state.user && state.pendingInvite) { const code = state.pendingInvite; state.pendingInvite = null; setTimeout(() => openInvite(code)); }
  }
  // ---- ⚡ Live updates (see /api/events): when the creator makes you an admin or takes it away, your page changes the
  // moment it happens: admin-only pages and pop-ups close, and everything admin shows or goes. ----
  let live = null, liveFor = null;
  function syncLive() {
    const id = state.user?.id || null;
    if (id === liveFor) return;
    live?.close(); live = null; liveFor = id;
    if (!id || typeof EventSource !== "function") return;
    live = new EventSource("/api/events");
    live.addEventListener("account", async e => {
      const { admin } = JSON.parse(e.data || "{}");
      closeModal(); $("#accountMenu")?.remove();
      await refresh(); await loadPageData(); render();
      if (admin !== undefined) toast(admin ? "The creator made you an admin 🛠️" : "The creator took away your admin. You can't use admin things any more.");
    });
    // 📞 Someone's calling, or your call changed: check straight away. Reactions in a call float up as they come.
    live.addEventListener("call", () => pollCallSoon());
    live.addEventListener("callreact", e => { const d = JSON.parse(e.data || "{}"); showReaction(d.emoji, d.from); });
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
    if (state.user && state.page === "friends") await loadCallHistory();
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
  // Yours, if you picked them in Settings (😊 Quick reactions); otherwise the usual ones.
  const quickReactions = () => state.user?.quickReactions || QUICK_REACTIONS;
  function timeLabel(s) {
    const d = new Date(String(s).replace(" ", "T") + "Z");
    if (isNaN(d)) return "";
    const today = d.toDateString() === new Date().toDateString();
    return d.toLocaleString(locales(), today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  // Tapping a message selects it and shows its actions underneath.
  // A message in a line, for quotes, pins, starred messages and the reply bar: polls, events, photos and videos get an icon.
  const previewOf = m => (m.kind === "poll" ? "📊 " : m.kind === "event" ? "📅 " : m.mediaType?.startsWith("video/") ? "🎥 " : m.mediaType ? "📷 " : "") +
    (m.body || (m.mediaType?.startsWith("video/") ? "Video" : m.mediaType ? "Photo" : ""));
  function messageHTML(m) {
    const c = state.chat, mine = m.userId === state.user?.id, picked = c.selected === m.id, face = mine ? "" : personLink(m.userId, m.username, avatarHTML(m.avatar, "tiny"));
    // Yakimma's own notes about what happened in a group ("Mia added Sam") sit in the middle of the chat.
    if (m.system) return m.call && (c.friendId || c.group) ? callNoteHTML(m) : `<div class="msg-note" data-msg-id="${m.id}"><span>${safe(m.body)} · ${timeLabel(m.createdAt)}</span></div>`;
    if (m.deleted) return `<div class="msg ${mine ? "mine" : ""}" data-msg-id="${m.id}">${face}<div class="msg-body"><div class="bubble deleted"><span class="b-text">🚫 This message was deleted</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    // AI's chat has no actions to tap for: AI's tips and answers, and the questions you asked it (on your side).
    if (c.readOnly) return `<div class="msg ${mine ? "mine" : ""}">${face}<div class="msg-body"><div class="bubble"><span class="b-text">${safe(m.body)}</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    const name = c.names && !mine ? `<strong>${nameHTML(m.username)}</strong>` : "";
    const reactions = m.reactions.length ? `<div class="reactions">${m.reactions.map(r => `<button class="reaction ${r.mine ? "on" : ""}" data-react="${safe(r.emoji)}" data-msg="${m.id}" title="${safe(r.users.join(", "))}" aria-pressed="${r.mine}"><span class="emoji">${safe(r.emoji)}</span>${r.count}</button>`).join("")}</div>` : "";
    // The message it replies to: tapping it jumps there.
    const q = m.replyTo, quote = q ? `<span class="quote" data-jump-msg="${q.id}">${q.deleted ? "🚫 This message was deleted" : `<strong>${nameHTML(q.username)}</strong>${ugc(previewOf(q))}`}</span>` : "";
    const head = name + (m.forwarded ? `<span class="fwd">↪️ Forwarded</span>` : "") + quote;
    const meta = `<small>${m.starred ? "⭐ " : ""}${m.expiresAt ? "⏱️ " : ""}${timeLabel(m.createdAt)}${m.editedAt ? " · edited" : ""}</small>`;
    // Polls, events, photos and videos have their own buttons inside, so ⋯ opens their actions instead of tapping the bubble.
    const media = !m.mediaUrl ? "" : m.mediaType?.startsWith("video/") ? `<video class="chat-media" src="${safe(m.mediaUrl)}" controls playsinline preload="metadata"></video>`
      : `<button class="chat-media-btn" data-view-media="${safe(m.mediaUrl)}" aria-label="See the photo bigger"><img class="chat-media" src="${safe(m.mediaUrl)}" alt="" loading="lazy"></button>`;
    const bubble = m.poll || m.event || media
      ? `<div class="bubble card-bubble">${head}${m.poll ? pollHTML(m) : m.event ? eventHTML(m) : media + (m.body ? `<span class="b-text">${richText(m.body, true)}</span>` : "")}<div class="card-foot">${meta}<button class="link-btn" data-pick-msg="${m.id}" aria-expanded="${picked}" aria-label="Message actions">⋯</button></div></div>`
      : `<button class="bubble" data-pick-msg="${m.id}" aria-expanded="${picked}">${head}<span class="b-text">${richText(m.body, true)}</span>${meta}</button>`;
    return `<div class="msg ${mine ? "mine" : ""} ${picked ? "picked" : ""}" data-msg-id="${m.id}">${face}<div class="msg-body">${bubble}${reactions}${picked ? messageTools(m, mine) : ""}</div></div>`;
  }
  // 📊 A poll: tap an answer to vote (again to take it back). The bar shows how many of the people who voted picked it.
  function pollHTML(m) {
    const p = m.poll;
    return `<div class="poll"><b class="card-title">📊 ${safe(m.body)}</b><small>${p.multiple ? "Select one or more" : "Select one"}</small>` +
      p.options.map((o, i) => `<button class="poll-opt ${o.mine ? "on" : ""}" data-vote="${m.id}" data-option="${i}" aria-pressed="${o.mine}" title="${safe(o.voters.join(", ") || "No votes yet")}">` +
        `<span class="poll-check" aria-hidden="true">${o.mine ? "✓" : ""}</span><span class="poll-text">${safe(o.text)}</span><span class="poll-count">${o.votes}</span><span class="poll-bar" style="width:${p.voters ? Math.round(o.votes / p.voters * 100) : 0}%"></span></button>`).join("") +
      `<small>${p.voters} ${p.voters === 1 ? "person" : "people"} voted</small></div>`;
  }
  // 📅 An event: when it is, what it's about, and who's going.
  function eventHTML(m) {
    const e = m.event, when = new Date(e.at);
    const answer = (going, label, people) => `<button class="soft ${e.mine === going ? "on" : ""}" data-answer="${m.id}" data-going="${going}" aria-pressed="${e.mine === going}" title="${safe(people.join(", ") || "Nobody yet")}">${label} · ${people.length}</button>`;
    return `<div class="event"><b class="card-title">📅 ${safe(e.name)}</b><span>🕒 ${isNaN(when) ? "" : safe(when.toLocaleString(locales(), { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))}</span>` +
      (e.description ? `<span class="event-desc">${safe(e.description)}</span>` : "") + `<div class="row">${answer(true, "✅ Going", e.going)}${answer(false, "❌ Can't go", e.notGoing)}</div></div>`;
  }
  // 📌 The pinned messages on top of the chat. Tapping jumps to one and shows the next.
  function pinnedBarHTML() {
    const c = state.chat, pins = c.pinned || [], p = pins[(c.pinIndex || 0) % (pins.length || 1)];
    return `<div id="pinnedBar">${p ? `<button class="pinned-bar" data-jump-msg="${p.id}" data-next-pin>📌 <span><strong>${nameHTML(p.username)}</strong> ${ugc(previewOf(p))}</span>${pins.length > 1 ? `<small>${pins.length} pinned</small>` : ""}</button>` : ""}</div>`;
  }
  function jumpToMessage(id) {
    const el = document.querySelector(`#chatLog [data-msg-id="${id}"]`);
    if (!el) return toast("That message is too old to show here.", true);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
  }
  function messageTools(m, mine) {
    const c = state.chat, canDelete = mine || c.moderator, pinned = c.pinned?.some(p => p.id === m.id);
    // Pinning asks for how long, like WhatsApp.
    const pin = !c.canPin ? "" : pinned ? `<button class="soft" data-unpin-msg="${m.id}">📌 Unpin</button>`
      : c.pinFor === m.id ? `<span class="pin-for">Pin for ${[[1, "24 hours"], [7, "7 days"], [30, "30 days"]].map(([d, label]) => `<button class="soft" data-pin-msg="${m.id}" data-days="${d}">${label}</button>`).join("")}</span>`
      : `<button class="soft" data-pin-choose="${m.id}">📌 Pin</button>`;
    return `<div class="msg-tools" role="toolbar" aria-label="Message actions"><div class="quick">${quickReactions().map(e => `<button class="emoji-btn" data-react="${e}" data-msg="${m.id}" aria-label="React with ${e}">${e}</button>`).join("")}<button class="emoji-btn more" data-react-more="${m.id}" aria-label="All emojis" title="All emojis">＋</button></div>` +
      `<div class="tool-row">${c.cantSend ? "" : `<button class="soft" data-reply-msg="${m.id}">↩️ Reply</button>`}<button class="soft" data-forward-msg="${m.id}">↪️ Forward</button>` +
      `<button class="soft" data-star-msg="${m.id}" data-on="${!m.starred}">${m.starred ? "⭐ Unstar" : "⭐ Star"}</button>${pin}${mine && !m.forwarded && !m.kind && !m.mediaUrl ? `<button class="soft" data-edit-msg="${m.id}">✏️ Edit</button>` : ""}${canDelete ? `<button class="soft" data-delete-msg="${m.id}">🗑️ Delete</button>` : ""}${mine || isCreatorName(m.username) ? "" : `<button class="soft" data-block="${m.userId}" data-name="${safe(m.username)}">🚫 Block</button>`}</div></div>`;
  }
  const DISAPPEAR_LABELS = { 86400: "24 hours", 604800: "7 days", 7776000: "90 days" };
  // A chat can bring its own empty message (group chats do); friend chats use this one.
  const emptyChat = "No messages yet. Say hi! 👋";
  const logHTML = () => state.chat.messages.length ? state.chat.messages.map(messageHTML).join("") : `<p class="muted chat-empty">${state.chat.empty || emptyChat}</p>`;
  // What an empty group chat or post list says. Special groups put their intro on top.
  const groupEmpty = (g, line) => (g.intro ? `<strong>${safe(g.intro)}</strong><br>` : "") + line;
  function chatBox(placeholder) {
    const c = state.chat, editing = c.editing && c.messages.some(m => m.id === c.editing && !m.deleted);
    const log = pinnedBarHTML() + `<div class="chat-log" id="chatLog"${c.wallpaper ? ` style="background:${c.wallpaper}"` : ""}>${logHTML()}</div>`;
    if (c.readOnly) return log + (c.questions?.length ? `<p class="muted-note">Tap a question to ask AI:</p><div class="ai-questions">${c.questions.map((q, i) => `<button class="soft" data-ask-ai="${i}">${safe(q)}</button>`).join("")}</div>`
      : `<p class="muted-note">AI sends you tips here. You can't reply to AI yet.</p>`);
    if (c.cantSend) return log + `<p class="muted-note">🔒 ${safe(c.cantSend)}</p>`;
    const replying = !editing && c.replyTo && c.messages.find(m => m.id === c.replyTo && !m.deleted && !m.system);
    const lasts = DISAPPEAR_LABELS[c.disappear];
    return log + (lasts ? `<p class="muted-note disappear-note">⏱️ Disappearing messages are on: new messages go after ${lasts}.</p>` : "") +
      (editing ? `<div class="editing-bar"><span>✏️ Editing your message</span><button type="button" class="soft" id="cancelEdit">Cancel</button></div>` : "") +
      (replying ? `<div class="editing-bar reply-bar"><span>↩️ Replying to <strong>${nameHTML(replying.username)}</strong>: ${ugc(previewOf(replying).slice(0, 80))}</span><button type="button" class="soft" id="cancelReply" aria-label="Stop replying">✕</button></div>` : "") +
      (c.attach ? `<div class="attach-menu"><button type="button" class="soft" id="pickMedia">🖼️ Photos & videos</button><button type="button" class="soft" id="newPoll">📊 Poll</button>${c.group ? `<button type="button" class="soft" id="newEvent">📅 Event</button>` : ""}</div>` : "") +
      // The device's own picker: the whole photo library on a phone or tablet, or Finder on a Mac.
      `<input type="file" id="chatMedia" accept="image/*,video/*" multiple hidden>` +
      `<form id="chatForm" class="row nowrap chat-form"><button type="button" class="soft emoji-open" id="attachBtn" aria-label="Send photos, videos, a poll${c.group ? " or an event" : ""}" title="Photos, videos, polls${c.group ? " and events" : ""}" aria-expanded="${Boolean(c.attach)}">＋</button><button type="button" class="soft emoji-open" id="emojiInsert" aria-label="Add an emoji" title="Add an emoji">😊</button><label class="sr-only" for="chatInput">Message</label><input id="chatInput" maxlength="500" autocomplete="off" placeholder="${safe(placeholder)}" value="${safe(c.draft)}"><button class="primary" type="submit">${editing ? "Save" : "Send"}</button></form>` +
      `<p class="muted-note">Tap a message to react, reply, forward, star, pin, edit or delete it. Be kind 💗 Never share your password, address, or school.</p>`;
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
    if (d.pinned) { c.pinned = d.pinned; if ($("#pinnedBar")) $("#pinnedBar").outerHTML = pinnedBarHTML(); }
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
    state.groupView = { key, group: d.group, posts: d.posts, tab, caption: "", call: d.call || null };
    Object.assign(state, { wallpapers: d.wallpapers, disappearChoices: d.disappear });
    state.chat = { url: `${url}/messages`, ...d.chat, draft: "", names: true, group: true, selected: null, editing: null, empty: groupEmpty(d.group, "Type something to start the chat!"), ...groupChatRules(d.group) };
    render(); if (tab === "chat") showChat();
  }
  // What the group's settings mean for its chat: whether you can write in it (only admins can, if it says so), delete
  // anyone's messages and pin them, and your wallpaper and its disappearing messages.
  const groupChatRules = g => ({ cantSend: g.canSend === false ? "Only group admins can send messages in this group." : null, moderator: Boolean(g.admin),
    canPin: Boolean(g.canEdit), disappear: g.disappear || 0, wallpaper: state.wallpapers?.find(w => w.id === g.wallpaper)?.css || "" });
  async function openChat(friendId) {
    const url = `/api/friends/${friendId}/messages`, [d, info] = await Promise.all([api(url), api(`/api/friends/${friendId}/info`)]);
    Object.assign(state, { wallpapers: info.wallpapers, disappearChoices: info.disappearChoices });
    state.page = "friends"; state.notice = ""; state.groupView = null;
    state.chat = { url, friendId, ...d, draft: "", names: false, moderator: false, canPin: true, selected: null, editing: null, ...friendChatRules(info) };
    const f = state.social.friends.find(x => x.id === friendId);
    if (f) f.unread = 0;
    render(); showChat();
  }
  // Your own wallpaper for a friend chat, and its disappearing messages (which either friend can change).
  const friendChatRules = info => ({ disappear: info.disappear || 0, wallpaper: state.wallpapers?.find(w => w.id === info.wallpaper)?.css || "" });
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
    const c = state.chat, groups = (await api("/api/groups")).groups.filter(g => g.joined), friends = state.social.friends;
    const target = (attr, id, face, name) => `<button type="button" class="fwd-target" data-${attr}="${safe(id)}" data-name="${safe(name)}">${face}<span>${safe(name)}</span></button>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal fwd-modal" role="dialog" aria-modal="true" aria-labelledby="fwdTitle"><div class="row between"><h2 id="fwdTitle">↪️ Forward to…</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<h3>Friends</h3>${friends.length ? `<div class="fwd-list">${friends.map(f => target("fwd-friend", f.id, avatarHTML(f.avatar, "tiny"), f.username)).join("")}</div>` : `<p class="muted">No friends yet.</p>`}` +
      // Groups aren't in the kiddy zone.
      `<h3>Groups</h3>${groups.length ? `<div class="fwd-list">${groups.map(g => target("fwd-group", g.id, `<span class="avatar tiny" aria-hidden="true">${safe(g.icon)}</span>`, g.name)).join("")}</div>` : `<p class="muted">You're not in any groups yet.</p>`}` + `</section></div>`;
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
    const tag = m => (m.owner ? ` <span class="pill">👑 Owner</span>` : m.admin ? ` <span class="pill">Group admin</span>` : "") + (m.id === me ? ` <span class="pill">You</span>` : "");
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
  // ---- ℹ️ Group info, like WhatsApp: the group's photo or icon, name, description and members. Members edit its info
  // (or only admins, if its settings say so); admins change the settings, make members admins, add friends and remove
  // people. Nobody can change or remove the person who made the group. ----
  async function openGroupInfo() {
    state.groupInfo = { view: "info", ...(await api(`/api/groups/${state.groupView.group.id}/members`)) };
    drawGroupInfo();
  }
  // A picture cut to a square from its middle, 400×400, for a group photo.
  async function squarePhoto(file) {
    const src = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, fail) => Object.assign(new Image(), { onload() { ok(this); }, onerror: () => fail(new Error("That file couldn't be opened as a picture. Try a JPG or PNG.")), src }));
      const c = Object.assign(document.createElement("canvas"), { width: 400, height: 400 }), side = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 400, 400);
      return await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    } finally { URL.revokeObjectURL(src); }
  }
  // The group changed: show it everywhere, and load the list of groups again next time.
  function groupChanged(group) {
    state.groupView.group = group; state.groups = null;
    if (state.chat?.url?.startsWith(`/api/groups/${encodeURIComponent(state.groupView.key)}/`)) Object.assign(state.chat, { moderator: Boolean(group.admin), ...groupChatRules(group) });
    render(); drawGroupInfo(); pollChat();
  }
  // Someone was added, removed or asked in: the chat gets its note ("Mia added Sam") straight away.
  function membersChanged(d) {
    Object.assign(state.groupInfo, d); state.groupView.group.members = d.members.length; state.groups = null;
    render(); drawGroupInfo(); pollChat();
  }
  // ---- Shared by Group info and Contact info ----
  // 🖼️ Media and links: photos and videos sent in the chat (tap to see one bigger), the group's photo and video posts,
  // and links sent in the chat.
  function mediaLinksHTML(d) {
    if (!d) return `<p class="muted">Loading…</p>`;
    const thumb = (m, attr) => `<button class="gi-thumb" ${attr} title="${safe(m.caption || "")}">${m.mediaType?.startsWith("video/")
      ? (m.thumbUrl ? `<img src="${safe(m.thumbUrl)}" alt="">` : `<video src="${safe(m.mediaUrl)}" preload="metadata" muted></video>`) + `<span class="gi-play" aria-hidden="true">▶</span>` : `<img src="${safe(m.mediaUrl)}" alt="" loading="lazy">`}</button>`;
    const items = [...d.chatMedia.map(m => thumb(m, `data-view-media="${safe(m.mediaUrl)}"`)), ...d.media.map(p => thumb(p, `data-gi-post="${p.id}"`))];
    return `<h3>🖼️ Media (${items.length})</h3>` + (items.length ? `<div class="gi-media">${items.join("")}</div>` : `<p class="muted">No photos or videos yet.</p>`) +
      `<h3>🔗 Links (${d.links.length})</h3>` + (d.links.length ? `<div class="member-list">${d.links.map(l => `<div class="member gi-link">${linkAnchor(l.url)}<small>${nameHTML(l.username)} · ${timeLabel(l.createdAt)}</small></div>`).join("")}</div>`
        : `<p class="muted">No links sent in the chat yet.</p>`);
  }
  // ⭐ Starred messages: tap one to jump to it in the chat.
  const starredHTML = (list, attr) => !list ? `<p class="muted">Loading…</p>` : list.length
    ? `<div class="member-list">${list.map(m => `<button class="member gi-star" ${attr}="${m.id}"><span><strong>${nameHTML(m.username)}</strong> <small>${timeLabel(m.createdAt)}</small><br>${ugc(previewOf(m))}</span></button>`).join("")}</div>`
    : `<p class="muted">Nothing starred yet. Tap a message in the chat, then ⭐ Star, to keep it here.</p>`;
  // 🎨 Wallpapers for a chat, just for you.
  const wallpapersHTML = (current, attr) => `<p class="muted-note">Only you see the wallpaper you pick.</p><div class="gi-walls"><button class="gi-wall ${current ? "" : "on"}" ${attr}="" aria-pressed="${!current}"><span style="background:var(--surface2)"></span>Default</button>` +
    state.wallpapers.map(w => `<button class="gi-wall ${current === w.id ? "on" : ""}" ${attr}="${w.id}" aria-pressed="${current === w.id}"><span style="background:${w.css}"></span>${safe(w.name)}</button>`).join("") + `</div>`;
  // Group info's screens: "info" (everything), "edit", "add" (friends), "media" (media and links), "starred",
  // "wallpaper", "invite" (link) and "report".
  const GI_TITLES = { info: "ℹ️ Group info", edit: "✏️ Edit group info", add: "➕ Add members", media: "🖼️ Media and links", starred: "⭐ Starred messages", wallpaper: "🎨 Wallpaper", invite: "🔗 Invite via link", report: "🚩 Report group" };
  const back = `<div class="actions"><button class="soft" data-gi="info">← Back</button></div>`;
  function groupInfoBody(g, gi) {
    const me = state.user.id, n = gi.members.length, people = `${n} member${n === 1 ? "" : "s"}`;
    if (gi.view === "edit") return `<form id="giEditForm"><div class="gi-photo">${groupIconHTML(g, "big")}<div class="gi-photo-tools"><label class="file-btn soft"><input type="file" id="giPhoto" accept="image/jpeg,image/png,image/gif,image/webp">📷 ${g.photoUrl ? "Change photo" : "Add a photo"}</label>` +
      (g.photoUrl ? `<button type="button" class="soft" id="giRemovePhoto">Remove photo</button>` : "") + `</div></div>` +
      `<label for="giName">Group name</label><input id="giName" minlength="3" maxlength="40" required value="${safe(g.name)}">` +
      `<label for="giDesc">Description</label><textarea id="giDesc" maxlength="200" rows="3" placeholder="Tell people what the group is for">${safe(g.description)}</textarea>` +
      `<fieldset class="icon-pick"><legend>Icon${g.photoUrl ? " (shows when there's no photo)" : ""}</legend>${state.groupIcons.map(i => `<label><input type="radio" name="giIcon" value="${safe(i)}" ${i === g.icon ? "checked" : ""}><span>${safe(i)}</span></label>`).join("")}</fieldset>` +
      `<div class="actions"><button class="primary" type="submit">Save</button><button class="soft" type="button" data-gi="info">Cancel</button></div></form>`;
    if (gi.view === "add") {
      const inGroup = new Set(gi.members.map(m => m.id)), friends = state.social.friends.filter(f => !inGroup.has(f.id));
      return `<p>Add your friends to ${safe(g.name)}.</p>` + (friends.length
        ? `<div class="member-list">${friends.map(f => `<div class="member">${avatarHTML(f.avatar)}<strong>${nameHTML(f.username)}</strong><span class="member-tools"><button class="primary" data-gi-add="${f.id}">Add</button></span></div>`).join("")}</div>`
        : `<p class="muted">All your friends are in it already.</p>`) + back;
    }
    if (gi.view === "media") return mediaLinksHTML(gi.media) + back;
    if (gi.view === "starred") return starredHTML(gi.starred, "data-gi-jump") + back;
    if (gi.view === "wallpaper") return wallpapersHTML(g.wallpaper, "data-gi-wall") + back;
    if (gi.view === "invite") {
      if (!gi.invite) return `<p class="muted">Loading…</p>`;
      const link = `${location.origin}/group/${gi.invite}`;
      return `<p>Anyone with this link can ask to join ${safe(g.name)}, even someone who was removed. Only share it with people you trust.</p>` +
        `<label for="giInviteLink">Group link</label><input id="giInviteLink" readonly value="${safe(link)}"><div class="actions"><button class="primary" id="giCopyInvite">📋 Copy link</button>` +
        (g.admin ? `<button class="soft" id="giResetInvite">🔄 Reset link</button>` : "") + `</div>` + back;
    }
    if (gi.view === "report") return `<form id="giReportForm"><p>Tell the creator what's wrong with ${safe(g.name)}. Only the creator sees it.</p><fieldset class="visibility"><legend>Why are you reporting it?</legend>` +
      state.reportReasons.map((r, i) => `<label class="vis-option"><input type="radio" name="giReason" value="${safe(r)}" ${i ? "" : "checked"}><span><strong>${safe(r)}</strong></span></label>`).join("") + `</fieldset>` +
      `<label for="giReportWords">In your own words <small>(needed for Something else)</small></label><textarea id="giReportWords" maxlength="500" rows="3"></textarea>` +
      (g.ownerId === me ? "" : `<label class="check"><input type="checkbox" id="giReportLeave"> Exit the group too</label>`) +
      `<div class="actions"><button class="danger" type="submit">🚩 Report</button><button class="soft" type="button" data-gi="info">Cancel</button></div></form>`;
    // Everything, like WhatsApp's Group info.
    const made = new Date(String(g.createdAt).replace(" ", "T") + "Z"), row = (attr, label, extra = "") => `<button class="gi-row" ${attr}><span>${label}</span>${extra}<span aria-hidden="true">›</span></button>`;
    const select = (id, label, value, options) => `<label class="gi-select" for="${id}"><span>${label}</span><select id="${id}">${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
    const who = [["all", "All members"], ["admins", "Only admins"]], lasts = DISAPPEAR_LABELS[g.disappear];
    const tag = m => m.owner ? `<span class="pill">👑 Owner</span>` : m.admin ? `<span class="pill">Group admin</span>` : "";
    const isFriend = id => state.social.friends.some(f => f.id === id);
    const tools = m => m.id === me ? "" : `<span class="member-tools">${isFriend(m.id) ? `<button class="soft" data-gi-message="${m.id}">💬 Message</button>` : ""}` +
      (gi.manage && !m.owner ? `<button class="soft" data-gi-admin="${m.id}" data-on="${!m.admin}">${m.admin ? "Dismiss as admin" : "Make group admin"}</button><button class="soft" data-gi-remove="${m.id}" data-name="${safe(nameText(m.username))}">Remove</button>` : "") + `</span>`;
    return `<div class="gi-top">${groupIconHTML(g, "big")}<h3>${ugc(g.name)}</h3><p class="muted-note">Group · ${people}</p></div>` +
      (g.description ? `<p class="gi-desc" translate="no">${safe(g.description)}</p>` : `<p class="muted-note">No description yet.</p>`) +
      `<p class="muted-note">Created by ${safe(nameText(g.creator || g.owner))}${isNaN(made) ? "" : `, ${made.toLocaleDateString(locales(), { day: "numeric", month: "long", year: "numeric" })}`}</p>` +
      (g.canEdit ? `<button class="soft" data-gi="edit">✏️ Edit group info</button>` : `<p class="muted-note">🔒 Only group admins can edit this group's info.</p>`) +
      `<div class="gi-section">${row(`data-gi="media"`, "🖼️ Media and links")}${row(`data-gi="starred"`, "⭐ Starred messages")}` +
      (g.muted ? row(`data-gi-mute="off"`, "🔕 Muted", `<small>Tap to unmute</small>`) : `<div class="gi-row gi-mute"><span>🔔 Mute notifications</span><span class="member-tools">${[["8h", "8 hours"], ["1w", "1 week"], ["always", "Always"]].map(([v, l]) => `<button class="soft" data-gi-mute="${v}">${l}</button>`).join("")}</span></div>`) +
      row(`data-gi="wallpaper"`, "🎨 Wallpaper", `<small>${safe(state.wallpapers.find(w => w.id === g.wallpaper)?.name || "Default")}</small>`) +
      (g.canEdit ? select("giDisappear", "⏱️ Disappearing messages", g.disappear, state.disappearChoices) : `<div class="gi-row"><span>⏱️ Disappearing messages</span><small>${lasts || "Off"}</small></div>`) + `</div>` +
      (g.admin ? `<h3>⚙️ Group permissions</h3><div class="gi-section">${select("giAdminsEdit", "Edit group info", g.adminsEdit ? "admins" : "all", who)}${select("giAdminsSend", "Send messages", g.adminsSend ? "admins" : "all", who)}` +
        `${select("giAdminsAdd", "Add other members", g.adminsAdd ? "admins" : "all", who)}</div>` : "") +
      (gi.requests?.length ? `<h3>🙋 Asking to join (${gi.requests.length})</h3><div class="member-list">${gi.requests.map(r => `<div class="member">${personLink(r.id, r.username, `${avatarHTML(r.avatar)}<strong>${nameHTML(r.username)}</strong>`)}<span class="member-tools"><button class="primary" data-gi-request="${r.id}" data-approve="true">✅ Approve</button><button class="soft" data-gi-request="${r.id}" data-approve="false">Reject</button></span></div>`).join("")}</div>` : "") +
      `<div class="row between gi-members-head"><h3>👥 ${people}</h3>${gi.canAdd ? `<span class="member-tools"><button class="soft" data-gi="add">➕ Add members</button><button class="soft" data-gi="invite">🔗 Invite via link</button></span>` : ""}</div>` +
      `<label class="sr-only" for="giMemberSearch">Search members</label><input id="giMemberSearch" type="search" placeholder="🔎 Search members" autocomplete="off" value="${safe(gi.search || "")}">` +
      `<div class="member-list">${gi.members.map(m => `<div class="member gi-member" data-search="${safe(`${m.username} ${nameText(m.username)}`.toLowerCase())}">${personLink(m.id, m.username, `${avatarHTML(m.avatar)}<strong>${nameHTML(m.username)}</strong>`)}${tag(m)}${m.id === me ? `<span class="pill">You</span>` : ""}${tools(m)}</div>`).join("")}</div>` +
      `<p class="muted" id="giNoMember" hidden>No members match that search.</p>` +
      `<div class="actions gi-exit"><button class="danger" data-leave-group="${g.id}" data-name="${safe(g.name)}" data-owner="${g.ownerId === me}">🚪 Exit group</button><button class="danger" data-gi="report">🚩 Report group</button>` +
      (g.ownerId === me ? `<button class="danger" data-delete-group="${g.id}" data-name="${safe(g.name)}">🗑️ Delete group</button>` : "") + `</div>`;
  }
  function drawGroupInfo() {
    const g = state.groupView?.group, gi = state.groupInfo;
    if (!g || !gi) return closeModal();
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal group-info" role="dialog" aria-modal="true" aria-labelledby="giTitle"><div class="row between"><h2 id="giTitle">${GI_TITLES[gi.view]}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${groupInfoBody(g, gi)}<p class="muted-note error-text" id="giError" role="alert"></p></section></div>`;
    const url = `/api/groups/${g.id}`, fail = err => { $("#giError").textContent = err.message; };
    const close = () => { state.groupInfo = null; closeModal(); };
    $("#closeModal").onclick = close;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") close(); };
    const searchMembers = () => {
      const q = (gi.search = $("#giMemberSearch").value.trim().toLowerCase()); let shown = 0;
      document.querySelectorAll(".gi-member").forEach(m => { m.hidden = !m.dataset.search.includes(q); shown += !m.hidden; });
      $("#giNoMember").hidden = shown > 0;
    };
    if ($("#giMemberSearch")) { $("#giMemberSearch").oninput = searchMembers; if (gi.search) searchMembers(); }
    // Screens that need loading load when they open.
    const open = async view => {
      gi.view = view; drawGroupInfo();
      if (view === "media") gi.media = await api(`${url}/media`);
      else if (view === "starred") gi.starred = (await api(`${url}/starred`)).messages;
      else if (view === "invite") gi.invite = (await api(`${url}/invite`)).code;
      else return;
      if (state.groupInfo === gi && gi.view === view) drawGroupInfo();
    };
    // Going from Group info to a message, a post or a chat.
    const leaveTo = async (tab, then) => { close(); state.groupView.tab = tab; render(); if (tab === "chat") showChat(); await then(); };
    $(".group-info").onclick = async e => {
      const b = e.target.closest("button");
      if (!b) return;
      try {
        if (b.dataset.gi) await open(b.dataset.gi);
        else if (b.dataset.giAdmin) membersChanged(await api(`${url}/members/${b.dataset.giAdmin}/admin`, send("PUT", { admin: b.dataset.on === "true" })));
        else if (b.dataset.giRemove) { if (confirm(`Remove ${b.dataset.name} from ${g.name}? They can only come back if someone adds them or they use the invite link.`)) membersChanged(await api(`${url}/members/${b.dataset.giRemove}`, { method: "DELETE" })); }
        else if (b.dataset.giAdd) membersChanged(await api(`${url}/members`, send("POST", { userId: Number(b.dataset.giAdd) })));
        else if (b.dataset.giRequest) membersChanged(await api(`${url}/requests/${b.dataset.giRequest}`, send("POST", { approve: b.dataset.approve === "true" })));
        else if (b.dataset.giMessage) { close(); await openChat(Number(b.dataset.giMessage)); }
        else if (b.dataset.giMute) { groupChanged((await api(`${url}/mute`, send("PUT", { for: b.dataset.giMute }))).group); toast(b.dataset.giMute === "off" ? "Unmuted 🔔" : "Muted 🔕 You won't get 🔔 for tags in this group."); }
        else if (b.dataset.giWall !== undefined) groupChanged((await api(`${url}/wallpaper`, send("PUT", { wallpaper: b.dataset.giWall || null }))).group);
        else if (b.dataset.giPost) await leaveTo("posts", async () => { const el = document.querySelector(`[data-post="${b.dataset.giPost}"]`); el?.scrollIntoView({ block: "start" }); });
        else if (b.dataset.giJump) await leaveTo("chat", async () => { await pollChat(); jumpToMessage(Number(b.dataset.giJump)); });
        else if (b.id === "giCopyInvite") { await navigator.clipboard.writeText($("#giInviteLink").value); toast("Group link copied 📋"); }
        else if (b.id === "giResetInvite") { if (confirm("Reset the link? The old one stops working.")) { gi.invite = (await api(`${url}/invite/reset`, { method: "POST" })).code; drawGroupInfo(); toast("New link made 🔄"); } }
        else if (b.id === "giRemovePhoto") groupChanged((await api(`${url}/photo`, { method: "DELETE" })).group);
      } catch (err) { fail(err); }
    };
    $(".group-info").onchange = async e => {
      const t = e.target, settings = { giAdminsEdit: "adminsEdit", giAdminsSend: "adminsSend", giAdminsAdd: "adminsAdd" };
      try {
        if (t.id === "giPhoto" && t.files[0]) {
          const body = new FormData(); body.append("photo", await squarePhoto(t.files[0]), "group.jpg");
          groupChanged((await api(`${url}/photo`, { method: "POST", body })).group);
        } else if (settings[t.id]) groupChanged((await api(`${url}/settings`, send("PUT", { [settings[t.id]]: t.value === "admins" }))).group);
        else if (t.id === "giDisappear") groupChanged((await api(`${url}/disappearing`, send("PUT", { seconds: Number(t.value) }))).group);
      } catch (err) { fail(err); }
    };
    if ($("#giEditForm")) $("#giEditForm").onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await api(`${url}/info`, send("PUT", { name: $("#giName").value, description: $("#giDesc").value, icon: $('input[name="giIcon"]:checked')?.value }));
        gi.view = "info"; groupChanged(d.group); toast("Group info saved ✨");
      } catch (err) { fail(err); }
    };
    if ($("#giReportForm")) $("#giReportForm").onsubmit = async e => {
      e.preventDefault();
      const leave = Boolean($("#giReportLeave")?.checked);
      try {
        const d = await api(`${url}/report`, send("POST", { reason: $('input[name="giReason"]:checked').value, details: $("#giReportWords").value, leave }));
        if (leave) { setGroups(d); Object.assign(state, { groupView: null, chat: null }); }
        close(); render(); toast(`Thanks for telling us 🚩 The creator will look at ${g.name}.`);
      } catch (err) { fail(err); }
    };
  }
  // ---- 🔗 A group's invite link: see the group, then join it (or ask to, if its admins approve new members). ----
  async function openInvite(code) {
    let g;
    try { g = (await api(`/api/invites/${encodeURIComponent(code)}`)).group; } catch (err) { return toast(err.message, true); }
    const n = g.members, action = g.joined ? `<button class="primary" id="inviteGo">💬 Open group</button>` : g.requested ? `<button class="soft" disabled>⏳ Requested</button>`
      : `<button class="primary" id="inviteGo">🙋 Ask to join</button>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal group-info" role="dialog" aria-modal="true" aria-labelledby="inviteTitle"><div class="row between"><h2 id="inviteTitle">🔗 Group invite</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<div class="gi-top">${groupIconHTML(g, "big")}<h3>${ugc(g.name)}</h3><p class="muted-note">Group · ${n} member${n === 1 ? "" : "s"}</p></div>${g.description ? `<p class="gi-desc" translate="no">${safe(g.description)}</p>` : ""}` +
      `<div class="actions">${action}<button class="soft" id="inviteNo">Not now</button></div><p class="muted-note error-text" id="inviteError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = $("#inviteNo").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    if ($("#inviteGo")) $("#inviteGo").onclick = async () => {
      try {
        const d = g.joined ? { group: g } : await api(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST" });
        closeModal(); state.groups = null;
        if (d.group.joined) { await openGroup(String(d.group.id)); if (!g.joined) toast(`You joined ${d.group.name}! 🎉 Say hi in the chat.`); }
        else toast("You asked to join 🙋 A group admin will let you in.");
      } catch (err) { $("#inviteError").textContent = err.message; }
    };
  }
  // ---- 🖼️ A chat photo, as big as the screen. ----
  function mediaViewer(url) {
    $("#modalroot").innerHTML = `<div class="modalback media-viewer" id="modalback"><section class="media-view" role="dialog" aria-modal="true" aria-label="Photo">` +
      `<img src="${safe(url)}" alt=""><div class="actions"><a class="soft button-link" href="${safe(url)}" download>⬇️ Save</a><button class="soft" id="closeModal">✕ Close</button></div></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
  }
  // ---- 🖼️ Sending photos and videos. ＋ → Photos & videos opens the device's own picker: the whole photo library (or the
  // camera) on a phone or tablet, or Finder on a Mac. Up to 10 at once, 100 MB each; each one is its own message, and
  // the caption goes with the first. ----
  const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime"];
  const MAX_MEDIA_SIZE = 100 * 1024 * 1024, MAX_MEDIA_AT_ONCE = 10;
  function sendMediaModal(picked) {
    const c = state.chat, files = [...picked].slice(0, MAX_MEDIA_AT_ONCE), urls = files.map(f => URL.createObjectURL(f));
    const bad = files.find(f => !MEDIA_TYPES.includes(f.type)), big = files.find(f => f.size > MAX_MEDIA_SIZE);
    const n = files.length, what = files.every(f => f.type.startsWith("video/")) ? `video${n === 1 ? "" : "s"}` : files.some(f => f.type.startsWith("video/")) ? "photos and videos" : `photo${n === 1 ? "" : "s"}`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="mediaTitle"><div class="row between"><h2 id="mediaTitle">🖼️ Send ${n} ${what}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<div class="gi-media send-media">${files.map((f, i) => `<div class="gi-thumb">${f.type.startsWith("video/") ? `<video src="${urls[i]}" muted playsinline preload="metadata"></video><span class="gi-play" aria-hidden="true">▶</span>` : `<img src="${urls[i]}" alt="">`}</div>`).join("")}</div>` +
      (picked.length > MAX_MEDIA_AT_ONCE ? `<p class="muted-note">Only the first ${MAX_MEDIA_AT_ONCE} are sent at once.</p>` : "") +
      `<form id="mediaForm"><label for="mediaCaption">Caption <small>(optional)</small></label><input id="mediaCaption" maxlength="500" autocomplete="off" placeholder="Add a caption…">` +
      `<div class="actions"><button class="primary" type="submit" ${bad || big ? "disabled" : ""}>Send ➤</button></div></form>` +
      `<p class="muted-note error-text" id="mediaError" role="alert">${bad ? `${safe(bad.name)} can't be sent. Photos can be JPG, PNG, GIF or WebP, and videos MP4, WebM or MOV.` : big ? `${safe(big.name)} is bigger than 100 MB.` : ""}</p></section></div>`;
    const done = () => { urls.forEach(u => URL.revokeObjectURL(u)); closeModal(); };
    $("#closeModal").onclick = done;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") done(); };
    $("#mediaForm").onsubmit = async e => {
      e.preventDefault();
      const btn = $("#mediaForm [type=submit]"), caption = $("#mediaCaption").value.trim();
      btn.disabled = true;
      try {
        for (const [i, file] of files.entries()) {
          btn.textContent = n > 1 ? `Sending ${i + 1} of ${n}…` : "Sending…";
          const body = new FormData();
          body.append("media", file); body.append("since", c.rev);
          if (!i && caption) body.append("caption", caption);
          if (!i && c.replyTo) body.append("replyTo", c.replyTo);
          const d = await api(`${c.url}/media`, { method: "POST", body });
          if (state.chat === c) mergeChat(d);
        }
        c.replyTo = null; done(); render(); showChat();
      } catch (err) { $("#mediaError").textContent = err.message; btn.disabled = false; btn.textContent = "Send ➤"; }
    };
  }
  // ---- ℹ️ Contact info, for a chat with a friend, like WhatsApp's: their picture and name, media and links, starred
  // messages, mute, wallpaper, disappearing messages, groups you're both in, and Block and Report. ----
  async function openContactInfo() {
    const id = state.chat.friendId;
    state.contactInfo = { view: "info", ...(await api(`/api/friends/${id}/info`)) };
    drawContactInfo();
  }
  const CI_TITLES = { info: "ℹ️ Contact info", media: "🖼️ Media and links", starred: "⭐ Starred messages", wallpaper: "🎨 Wallpaper", report: "🚩 Report" };
  function drawContactInfo() {
    const ci = state.contactInfo, c = state.chat, u = ci?.user;
    if (!ci || !c?.friendId) return closeModal();
    const name = nameText(u.username), back = `<div class="actions"><button class="soft" data-ci="info">← Back</button></div>`;
    const row = (attr, label, extra = "") => `<button class="gi-row" ${attr}><span>${label}</span>${extra}<span aria-hidden="true">›</span></button>`;
    const body = ci.view === "media" ? mediaLinksHTML(ci.media) + back
      : ci.view === "starred" ? starredHTML(ci.starred, "data-ci-jump") + back
      : ci.view === "wallpaper" ? wallpapersHTML(ci.wallpaper, "data-ci-wall") + back
      : ci.view === "report" ? `<form id="ciReportForm"><p>Tell the creator what's wrong. Only the creator sees it.</p><fieldset class="visibility"><legend>Why are you reporting ${safe(name)}?</legend>` +
        state.reportReasons.map((r, i) => `<label class="vis-option"><input type="radio" name="ciReason" value="${safe(r)}" ${i ? "" : "checked"}><span><strong>${safe(r)}</strong></span></label>`).join("") + `</fieldset>` +
        `<label for="ciReportWords">In your own words <small>(needed for Something else)</small></label><textarea id="ciReportWords" maxlength="500" rows="3"></textarea>` +
        `<label class="check"><input type="checkbox" id="ciReportBlock"> Block ${safe(name)} too</label><div class="actions"><button class="danger" type="submit">🚩 Report</button><button class="soft" type="button" data-ci="info">Cancel</button></div></form>`
      : `<div class="gi-top">${avatarHTML(u.avatar, "big")}<h3>${nameHTML(u.username)}</h3><p class="muted-note">🔢 Account number ${u.accountNumber}</p><div class="actions ci-calls"><button class="soft" data-call-friend="${u.id}" data-video="0">📞 Voice call</button><button class="soft" data-call-friend="${u.id}" data-video="1">🎥 Video call</button><button class="soft" data-view-person="${u.id}">👤 See profile</button></div></div>` +
        `<div class="gi-section">${row(`data-ci="media"`, "🖼️ Media and links")}${row(`data-ci="starred"`, "⭐ Starred messages")}` +
        (ci.muted ? row(`data-ci-mute="off"`, "🔕 Muted", `<small>Tap to unmute</small>`) : `<div class="gi-row gi-mute"><span>🔔 Mute notifications</span><span class="member-tools">${[["8h", "8 hours"], ["1w", "1 week"], ["always", "Always"]].map(([v, l]) => `<button class="soft" data-ci-mute="${v}">${l}</button>`).join("")}</span></div>`) +
        row(`data-ci="wallpaper"`, "🎨 Wallpaper", `<small>${safe(state.wallpapers.find(w => w.id === ci.wallpaper)?.name || "Default")}</small>`) +
        `<label class="gi-select" for="ciDisappear"><span>⏱️ Disappearing messages</span><select id="ciDisappear">${state.disappearChoices.map(([v, l]) => `<option value="${v}" ${v === ci.disappear ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>` +
        `<h3>👥 ${ci.groups.length} group${ci.groups.length === 1 ? "" : "s"} in common</h3>` + (ci.groups.length ? `<div class="member-list">${ci.groups.map(g => `<button class="member gi-star" data-ci-group="${g.id}">${groupIconHTML(g)}<strong>${ugc(g.name)}</strong></button>`).join("")}</div>` : `<p class="muted">No groups in common yet.</p>`) +
        `<div class="actions gi-exit">${isCreatorName(u.username) ? "" : `<button class="danger" data-block="${u.id}" data-name="${safe(u.username)}">🚫 Block ${safe(name)}</button><button class="danger" data-ci="report">🚩 Report ${safe(name)}</button>`}</div>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal group-info contact-info" role="dialog" aria-modal="true" aria-labelledby="ciTitle"><div class="row between"><h2 id="ciTitle">${CI_TITLES[ci.view]}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${body}<p class="muted-note error-text" id="ciError" role="alert"></p></section></div>`;
    const url = `/api/friends/${u.id}`, fail = err => { $("#ciError").textContent = err.message; };
    const close = () => { state.contactInfo = null; closeModal(); };
    $("#closeModal").onclick = close;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") close(); };
    $(".contact-info").onclick = async e => {
      const b = e.target.closest("button");
      if (!b) return;
      try {
        if (b.dataset.ci) {
          ci.view = b.dataset.ci; drawContactInfo();
          if (ci.view === "media") ci.media = await api(`${url}/media`);
          else if (ci.view === "starred") ci.starred = (await api(`${url}/starred`)).messages;
          else return;
          if (state.contactInfo === ci) drawContactInfo();
        } else if (b.dataset.ciMute) {
          ci.muted = (await api(`${url}/mute`, send("PUT", { for: b.dataset.ciMute }))).muted;
          const f = state.social.friends.find(x => x.id === u.id); if (f) f.muted = ci.muted;
          drawContactInfo(); toast(ci.muted ? `Muted 🔕 You won't get 🔔 for tags from ${name}.` : "Unmuted 🔔");
        } else if (b.dataset.ciWall !== undefined) {
          ci.wallpaper = (await api(`${url}/wallpaper`, send("PUT", { wallpaper: b.dataset.ciWall || null }))).wallpaper;
          c.wallpaper = state.wallpapers.find(w => w.id === ci.wallpaper)?.css || ""; render(); drawContactInfo();
        } else if (b.dataset.ciJump) { close(); render(); showChat(); jumpToMessage(Number(b.dataset.ciJump)); }
        else if (b.dataset.ciGroup) { close(); await openGroup(b.dataset.ciGroup); }
      } catch (err) { fail(err); }
    };
    if ($("#ciDisappear")) $("#ciDisappear").onchange = async e => {
      try { ci.disappear = c.disappear = (await api(`${url}/disappearing`, send("PUT", { seconds: Number(e.target.value) }))).disappear; render(); drawContactInfo(); pollChat(); }
      catch (err) { fail(err); }
    };
    if ($("#ciReportForm")) $("#ciReportForm").onsubmit = async e => {
      e.preventDefault();
      try {
        await api(`/api/users/${u.id}/report`, send("POST", { reason: $('input[name="ciReason"]:checked').value, details: $("#ciReportWords").value }));
        const block = $("#ciReportBlock").checked;
        close(); toast("Thanks for telling us 🚩 The creator will look at it.");
        if (block) await blockPerson(u.id, u.username);
      } catch (err) { fail(err); }
    };
  }
  // ---- 📊 New poll and 📅 new event, from ＋ next to the chat box. ----
  function chatModal(title, form, onSubmit) {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="cmTitle"><div class="row between"><h2 id="cmTitle">${title}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<form id="cmForm">${form}<div class="actions"><button class="primary" type="submit">Send</button></div></form><p class="muted-note error-text" id="cmError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#cmForm").onsubmit = async e => {
      e.preventDefault();
      try { await onSubmit(); closeModal(); render(); } catch (err) { $("#cmError").textContent = err.message; }
    };
    $("#cmForm input, #cmForm textarea")?.focus();
  }
  const MAX_POLL_OPTIONS = 12;
  function pollModal() {
    const option = n => `<input class="poll-input" maxlength="100" placeholder="Answer ${n}" aria-label="Answer ${n}">`;
    chatModal("📊 New poll", `<label for="pollQ">Question</label><input id="pollQ" maxlength="255" required placeholder="Ask something">` +
      `<label>Answers</label><div id="pollOpts" class="poll-inputs">${option(1)}${option(2)}</div><button type="button" class="soft" id="addPollOpt">＋ Add an answer</button>` +
      `<label class="check"><input type="checkbox" id="pollMulti"> Let people pick more than one answer</label>`,
      () => chatAction("/polls", "POST", { question: $("#pollQ").value, options: [...document.querySelectorAll(".poll-input")].map(i => i.value.trim()).filter(Boolean), multiple: $("#pollMulti").checked }));
    $("#addPollOpt").onclick = () => {
      const n = document.querySelectorAll(".poll-input").length + 1;
      if (n <= MAX_POLL_OPTIONS) $("#pollOpts").insertAdjacentHTML("beforeend", option(n));
      if (n >= MAX_POLL_OPTIONS) $("#addPollOpt").hidden = true;
      document.querySelectorAll(".poll-input")[n - 1]?.focus();
    };
  }
  function eventModal() {
    const soon = new Date(Date.now() + 60 * 60 * 1000), local = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    chatModal("📅 New event", `<label for="evName">Event name</label><input id="evName" maxlength="100" required placeholder="e.g. Movie night">` +
      `<label for="evAt">When</label><input id="evAt" type="datetime-local" required value="${local(soon)}">` +
      `<label for="evDesc">What's it about? (optional)</label><textarea id="evDesc" maxlength="500" rows="3"></textarea>`,
      () => chatAction("/events", "POST", { name: $("#evName").value, at: new Date($("#evAt").value).toISOString(), description: $("#evDesc").value }));
  }
  async function blockPerson(id, name) {
    if (!confirm(`Block ${name}?\n\nYou won't see their messages or posts, they can't send you friend requests, and if you're friends they'll be removed.`)) return;
    state.social = await api("/api/blocks", send("POST", { userId: id }));
    // Blocking from a chat's Contact info closes it too.
    if (state.chat?.friendId === id) { state.chat = null; state.contactInfo = null; closeModal(); }
    state.posts = (await api("/api/posts")).posts;
    if (state.postSearch?.posts) state.postSearch.posts = state.postSearch.posts.filter(p => p.userId !== id);
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

  // ---- 📞 Calls, like WhatsApp: 📞 voice and 🎥 video calls with a friend (from your chat with them, their Contact info
  // or 📞 Calls on the Friends page) or a group (from its chat), with up to calling.max people. The call goes straight
  // between the devices (WebRTC) and isn't recorded: the server only rings people and passes on how each pair of devices
  // can reach each other (see "Calls" in server.js). The call screen sits on top of everything. In a call you can mute,
  // turn your camera on or off (so a voice call can become a video call), flip cameras, share your screen (on a
  // computer), send emoji reactions, add friends, and tap or drag your little picture. ⌄ shrinks the call: a video call
  // to a little floating video, a voice call to a green bar. A call coming in while you're in one rings too (call
  // waiting: Decline, or End & accept). ----
  // callNow: the call on this device ({ id, video, group, state: "calling"|"incoming"|"joining"|"on"|"ended"|"noanswer",
  // people (everyone else in it or being rung, from the server), peers (user id → connection), local, mic, cam, screen,
  // muted, camera, facing, since, minimized, swapped, pip and floatAt (corners: "tl", "tr", "bl" or "br"), sheet }).
  // callWaiting: a call ringing while you're in this one.
  let callNow = null, callWaiting = null;
  const calling = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], replies: [], reactions: [], max: 8, timer: null, poll: null, cams: 0,
    title: "", draggedAt: 0, after: 0, declined: new Set() };
  const CAMERA = facing => ({ facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } });
  const callTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const callFriend = id => state.social.friends.find(f => f.id === id);
  const talking = l => l && ["calling", "joining", "on"].includes(l.state);
  const canShare = () => Boolean(navigator.mediaDevices?.getDisplayMedia) && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  function callProblem() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return "Calls don't work here. Try an up-to-date browser, with Yakimma's secure (https) address.";
    return null;
  }
  const mediaProblem = err => err?.name === "NotAllowedError" ? "Yakimma needs your microphone for calls (and your camera for video calls). Allow them in your browser's settings and try again."
    : err?.name === "NotFoundError" ? "No microphone was found on this device." : err?.message || "The call couldn't start. Try again.";
  // Your microphone, and your camera for a video call. If the camera won't start, you're in the call without it.
  async function openMedia(l, video) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio, video: video ? CAMERA(l.facing) : false }); }
    catch (err) { if (!video || err?.name === "NotAllowedError") throw err; s = await navigator.mediaDevices.getUserMedia({ audio }); }
    if (callNow !== l) { s.getTracks().forEach(t => t.stop()); throw new Error(""); }
    Object.assign(l, { local: s, mic: s.getAudioTracks()[0], cam: s.getVideoTracks()[0] || null });
    l.camera = Boolean(l.cam);
    applyEffects(l);
    navigator.mediaDevices.enumerateDevices?.().then(d => { calling.cams = d.filter(x => x.kind === "videoinput").length; drawCall(); }).catch(() => {});
  }
  // What your video sends: your screen while you share it, otherwise your camera, with its effects (or nothing).
  const outVideo = l => l.screen || l.fxTrack || l.cam || null;
  // The server's view of the call: who's in it, who's being rung, and when you joined.
  function applyView(l, v) {
    Object.assign(l, { id: v.id, video: v.video, group: v.group || l.group, people: v.people, joinedAt: v.joinedAt ?? l.joinedAt, full: v.full, startedBy: v.startedBy, invitedBy: v.invitedBy });
  }

  // ---- ✨ Effects in video calls, like WhatsApp's: filters, backgrounds, Touch up and Low light (✨ at the top of the
  // call screen while your camera's on). Your camera goes through a canvas that draws the effect on every frame, and
  // that canvas is what everyone in the call sees (and your little picture). Backgrounds need to know where you are in
  // the picture: MediaPipe's selfie segmenter (served from /vendor/mediapipe, loaded the first time someone picks a
  // background) finds you, and everything behind you is blurred or swapped for a picture drawn here. Your choices are
  // kept in this browser for your next call. ----
  const CALL_FILTERS = [["none", "🚫", "None"], ["warm", "🔥", "Warm"], ["cool", "❄️", "Cool"], ["bw", "⚫", "Black & white"], ["leak", "✨", "Light leak"], ["dreamy", "💭", "Dreamy"],
    ["prism", "🌈", "Prism light"], ["fisheye", "🐟", "Fisheye"], ["vintage", "📺", "Vintage TV"], ["frosted", "🧊", "Frosted glass"], ["duo", "🎨", "Duo tone"]];
  const CALL_BACKGROUNDS = [["none", "🚫", "None"], ["blur", "💧", "Blur"], ["living", "🛋️", "Living room"], ["office", "🏢", "Office"], ["cafe", "☕", "Café"], ["pebbles", "🪨", "Pebbles"],
    ["foodie", "🍕", "Foodie"], ["smoosh", "🫧", "Smoosh"], ["beach", "🏖️", "Beach"], ["sunset", "🌇", "Sunset"], ["celebration", "🎉", "Celebration"], ["forest", "🌲", "Forest"]];
  const FX_KEY = "yakimma.callFx";
  const callFx = (() => { try { return { filter: "none", background: "none", touchUp: false, lowLight: false, ...JSON.parse(localStorage.getItem(FX_KEY) || "{}") }; } catch { return { filter: "none", background: "none", touchUp: false, lowLight: false }; } })();
  const saveFx = () => { try { localStorage.setItem(FX_KEY, JSON.stringify(callFx)); } catch {} };
  const effectsOn = () => callFx.filter !== "none" || callFx.background !== "none" || callFx.touchUp || callFx.lowLight;
  let segmenter = null, segmenterLoad = null;
  function loadSegmenter() {
    return segmenterLoad ||= (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("/vendor/mediapipe/vision_bundle.mjs");
      const files = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
      return segmenter = await ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: "/vendor/mediapipe/selfie-segmenter.tflite", delegate: "CPU" },
        runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
    })().catch(err => { segmenterLoad = null; throw err; });
  }
  // Starts or stops the effects for the camera you have now, after the camera or the effects change.
  function applyEffects(l) {
    if (!l.cam || !effectsOn()) { stopFx(l); return; }
    if (l.fx?.cam !== l.cam) { stopFx(l); startFx(l); }
    if (callFx.background !== "none" && !segmenter) {
      l.fxNote = "Getting backgrounds ready…";
      loadSegmenter().then(() => { if (l.fx) l.fx.seg = segmenter; l.fxNote = null; drawCall(); })
        .catch(() => { callFx.background = "none"; saveFx(); l.fxNote = "Backgrounds don't work on this device."; drawCall(); });
    }
  }
  const makeCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  function startFx(l) {
    const s = l.cam.getSettings?.() || {}, scale = Math.min(1, 640 / (s.width || 640));
    const W = Math.round((s.width || 640) * scale / 2) * 2, H = Math.round((s.height || 480) * scale / 2) * 2;
    const v = Object.assign(document.createElement("video"), { muted: true, playsInline: true, srcObject: new MediaStream([l.cam]) });
    callRoot(); $("#callFxSrc").append(v); v.play().catch(() => {});
    const canvas = makeCanvas(W, H), stage = makeCanvas(W, H), person = makeCanvas(W, H), small = makeCanvas(256, Math.round(256 * H / W)), mask = makeCanvas(1, 1);
    const f = l.fx = { cam: l.cam, v, W, H, canvas, ctx: canvas.getContext("2d"), stage, sctx: stage.getContext("2d"), person, pctx: person.getContext("2d"),
      small, smctx: small.getContext("2d"), mask, mctx: mask.getContext("2d"), seg: segmenter, track: canvas.captureStream(30).getVideoTracks()[0] };
    l.fxTrack = f.track;
    const next = () => v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    const tick = () => { if (l.fx !== f) return; try { renderFx(f); } catch {} next(); };
    next();
  }
  function stopFx(l) {
    const f = l.fx;
    l.fx = null; l.fxTrack = null;
    if (!f) return;
    f.track.stop(); f.v.srcObject = null; f.v.remove();
  }
  // One frame: you, in front of your background; then the filter, Low light and Touch up.
  function renderFx(f) {
    const { v, W, H, sctx } = f, t = performance.now();
    if (v.readyState < 2) return;
    if (callFx.background !== "none" && f.seg) {
      f.smctx.drawImage(v, 0, 0, f.small.width, f.small.height);
      f.seg.segmentForVideo(f.small, t, r => {
        const m = r.confidenceMasks?.[0];
        if (!m) return;
        const a = m.getAsFloat32Array();
        if (f.mask.width !== m.width || f.mask.height !== m.height) { f.mask.width = m.width; f.mask.height = m.height; f.maskData = f.mctx.createImageData(m.width, m.height); }
        // How sure it is that each spot is you, as how see-through you are there (soft at the edges).
        const d = f.maskData.data;
        for (let i = 0; i < a.length; i++) d[i * 4 + 3] = Math.max(0, Math.min(255, (a[i] - 0.25) * 510));
        f.mctx.putImageData(f.maskData, 0, 0);
      });
      f.pctx.globalCompositeOperation = "copy"; f.pctx.drawImage(v, 0, 0, W, H);
      f.pctx.globalCompositeOperation = "destination-in"; f.pctx.drawImage(f.mask, 0, 0, W, H);
      if (callFx.background === "blur") { sctx.filter = "blur(14px)"; sctx.drawImage(v, -24, -24, W + 48, H + 48); sctx.filter = "none"; }
      else sctx.drawImage(callBackground(callFx.background, W, H), 0, 0);
      sctx.drawImage(f.person, 0, 0);
    } else sctx.drawImage(v, 0, 0, W, H);
    const ctx = f.ctx, look = FX_LOOKS[callFx.filter] || FX_LOOKS.none;
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.filter = `${callFx.lowLight ? "brightness(1.45) contrast(1.08) saturate(1.1) " : ""}${look.css || ""}`.trim() || "none";
    if (look.fisheye) fisheye(ctx, f.stage, W, H); else ctx.drawImage(f.stage, 0, 0);
    ctx.filter = "none";
    // Touch up: a soft glow that smooths skin.
    if (callFx.touchUp) layer(ctx, "source-over", 0.35, () => { ctx.filter = "blur(3px)"; ctx.drawImage(f.canvas, 0, 0); });
    look.draw?.(ctx, W, H, t, f);
  }
  // Draws `paint` on top, blended in `mode` and see-through by `alpha`.
  function layer(ctx, mode, alpha, paint) { ctx.save(); ctx.globalCompositeOperation = mode; ctx.globalAlpha = alpha; paint(); ctx.restore(); }
  const fill = (ctx, W, H, style) => { ctx.fillStyle = style; ctx.fillRect(0, 0, W, H); };
  const radial = (ctx, x, y, r, inner, outer) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, inner); g.addColorStop(1, outer); return g; };
  const vignette = (ctx, W, H, strength) => layer(ctx, "source-over", 1, () => fill(ctx, W, H, (() => { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${strength})`); return g; })()));
  // Little textures made once: TV lines and frost.
  const fxCache = new Map();
  function cached(key, w, h, paint) {
    const k = `${key}:${w}x${h}`;
    if (!fxCache.has(k)) { const c = makeCanvas(w, h); paint(c.getContext("2d"), w, h); fxCache.set(k, c); }
    return fxCache.get(k);
  }
  // A random number maker that always gives the same numbers, so a picture looks the same every time it's drawn.
  const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const FX_LOOKS = {
    none: {},
    warm: { css: "sepia(.25) saturate(1.35) hue-rotate(-10deg) brightness(1.04)", draw: (c, W, H) => layer(c, "soft-light", 0.3, () => fill(c, W, H, "#ff8a3d")) },
    cool: { css: "saturate(1.05) hue-rotate(10deg) brightness(1.03)", draw: (c, W, H) => layer(c, "soft-light", 0.35, () => fill(c, W, H, "#3d8bff")) },
    bw: { css: "grayscale(1) contrast(1.15)" },
    leak: { css: "saturate(1.15) brightness(1.03)", draw: (c, W, H, t) => layer(c, "screen", 0.8, () => {
      for (const [x, y, r, col] of [[0.05 + 0.06 * Math.sin(t / 1900), 0.15, 0.55, "255,120,60"], [0.95, 0.8 + 0.07 * Math.sin(t / 2300), 0.5, "255,60,140"], [0.8, 0.05, 0.35, "255,210,90"]])
        fill(c, W, H, radial(c, x * W, y * H, r * W, `rgba(${col},.85)`, `rgba(${col},0)`));
    }) },
    dreamy: { css: "saturate(1.2) brightness(1.08) contrast(.95)", draw: (c, W, H, t, f) => {
      layer(c, "screen", 0.45, () => { c.filter = "blur(10px)"; c.drawImage(f.canvas, 0, 0); });
      layer(c, "soft-light", 0.35, () => fill(c, W, H, "#ffb3e6"));
    } },
    prism: { css: "saturate(1.2)", draw: (c, W, H, t) => layer(c, "soft-light", 0.6, () => {
      const s = (t / 30) % (2 * W), g = c.createLinearGradient(s - 2 * W, 0, s, H);
      ["#ff3b3b", "#ffb800", "#3bff6a", "#3bc8ff", "#9b3bff", "#ff3b9b", "#ff3b3b"].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
      fill(c, W, H, g);
    }) },
    fisheye: { fisheye: true, draw: (c, W, H) => vignette(c, W, H, 0.75) },
    vintage: { css: "sepia(.55) contrast(1.2) saturate(.85) brightness(.95)", draw: (c, W, H, t) => {
      layer(c, "multiply", 0.5, () => fill(c, W, H, c.createPattern(cached("tv", 4, 4, (x, w) => { x.fillStyle = "#fff"; x.fillRect(0, 0, w, 4); x.fillStyle = "#555"; x.fillRect(0, 2, w, 1); }), "repeat")));
      vignette(c, W, H, 0.7);
      layer(c, "source-over", 0.04 + 0.04 * Math.random(), () => fill(c, W, H, "#fff"));
    } },
    frosted: { css: "blur(5px) brightness(1.1) saturate(.9)", draw: (c, W, H) => {
      layer(c, "screen", 0.18, () => fill(c, W, H, "#dff3ff"));
      layer(c, "screen", 0.5, () => c.drawImage(cached("frost", W, H, (x, w, h) => { const rnd = seeded(7); for (let i = 0; i < w * h / 90; i++) { x.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.5})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } }), 0, 0));
    } },
    duo: { css: "grayscale(1) contrast(1.2)", draw: (c, W, H) => { layer(c, "multiply", 1, () => fill(c, W, H, "#ff5fa8")); layer(c, "screen", 1, () => fill(c, W, H, "#2a1b6e")); } }
  };
  // Fisheye: rings from the edge in, each a little bigger than the last, so the middle bulges out like a fish-eye lens.
  function fisheye(ctx, src, W, H) {
    ctx.drawImage(src, 0, 0);
    const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy), rings = 16;
    for (let i = 0; i < rings; i++) {
      const r = R * (1 - i / rings), s = Math.pow(R / r, 0.45);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.setTransform(s, 0, 0, s, cx - cx * s, cy - cy * s); ctx.drawImage(src, 0, 0); ctx.restore();
    }
  }
  // The picture backgrounds, drawn once for each size.
  const emoji = (c, e, x, y, size, turn = 0) => { c.save(); c.translate(x, y); c.rotate(turn); c.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(e, 0, 0); c.restore(); };
  const linear = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g; };
  const roundRect = (c, x, y, w, h, r, style) => { c.fillStyle = style; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); c.fill(); };
  const BACKGROUNDS = {
    living: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, 0, H, ["#f6e7d3", "#e7cfae"])); c.fillStyle = "#a8714a"; c.fillRect(0, H * 0.78, W, H * 0.22);
      roundRect(c, W * 0.62, H * 0.18, W * 0.26, H * 0.24, 6, "#7aa7c7"); c.strokeStyle = "#fff8ec"; c.lineWidth = 8; c.strokeRect(W * 0.62, H * 0.18, W * 0.26, H * 0.24);
      roundRect(c, W * 0.08, H * 0.55, W * 0.84, H * 0.26, 22, "#4f8f8b"); roundRect(c, W * 0.05, H * 0.5, W * 0.12, H * 0.33, 18, "#3f7a76"); roundRect(c, W * 0.83, H * 0.5, W * 0.12, H * 0.33, 18, "#3f7a76");
      emoji(c, "🪴", W * 0.12, H * 0.4, H * 0.18); emoji(c, "🖼️", W * 0.3, H * 0.27, H * 0.16); emoji(c, "🧸", W * 0.78, H * 0.6, H * 0.12);
    },
    office: (c, W, H) => {
      fill(c, W, H, "#e9eef2"); fill(c, W, H, linear(c, 0, 0, W, 0, ["rgba(255,255,255,0)", "rgba(255,255,255,.4)"]));
      roundRect(c, W * 0.55, H * 0.1, W * 0.4, H * 0.5, 4, linear(c, 0, H * 0.1, 0, H * 0.6, ["#8ecbff", "#d7efff"]));
      c.fillStyle = "#cfd8df"; for (const x of [0.55, 0.75, 0.95]) c.fillRect(W * x - 3, H * 0.1, 6, H * 0.5); c.fillRect(W * 0.55, H * 0.35 - 3, W * 0.4, 6);
      const rnd = seeded(3), books = ["#e5554f", "#f2b33d", "#4f9de5", "#5cc28a", "#a06ad9"];
      c.fillStyle = "#8b6b4e"; c.fillRect(W * 0.05, H * 0.3, W * 0.38, 6); c.fillRect(W * 0.05, H * 0.5, W * 0.38, 6);
      for (const shelf of [0.3, 0.5]) for (let x = W * 0.06; x < W * 0.42;) { const w = 8 + rnd() * 12, h = H * (0.1 + rnd() * 0.06); c.fillStyle = books[Math.floor(rnd() * books.length)]; c.fillRect(x, H * shelf - h, w, h); x += w + 2; }
      c.fillStyle = "#5a4636"; c.fillRect(0, H * 0.82, W, H * 0.18); emoji(c, "🪴", W * 0.5, H * 0.72, H * 0.16); emoji(c, "☕", W * 0.88, H * 0.78, H * 0.08);
    },
    cafe: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, 0, H, ["#6b4430", "#3d261b"])); roundRect(c, W * 0.08, H * 0.12, W * 0.42, H * 0.36, 8, "#2f3b35");
      c.strokeStyle = "#a57c52"; c.lineWidth = 8; c.strokeRect(W * 0.08, H * 0.12, W * 0.42, H * 0.36);
      emoji(c, "☕", W * 0.2, H * 0.26, H * 0.1); emoji(c, "🥐", W * 0.36, H * 0.24, H * 0.09); emoji(c, "🍰", W * 0.28, H * 0.4, H * 0.09);
      for (const x of [0.62, 0.78, 0.94]) { c.strokeStyle = "#222"; c.lineWidth = 2; c.beginPath(); c.moveTo(W * x, 0); c.lineTo(W * x, H * 0.22); c.stroke(); fill(c, W, H, radial(c, W * x, H * 0.25, H * 0.25, "rgba(255,200,120,.55)", "rgba(255,200,120,0)")); c.fillStyle = "#ffcf7a"; c.beginPath(); c.arc(W * x, H * 0.24, 12, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#8a5a3c"; c.fillRect(0, H * 0.8, W, H * 0.2); c.fillStyle = "#a8714a"; c.fillRect(0, H * 0.78, W, 10);
    },
    pebbles: (c, W, H) => {
      fill(c, W, H, "#d9cfc3"); const rnd = seeded(11), tones = ["#9e968c", "#b8afa4", "#7d756d", "#c9c0b4", "#8f877e", "#e4ddd3"];
      for (let i = 0; i < 160; i++) { const x = rnd() * W, y = rnd() * H, r = 10 + rnd() * 30; c.fillStyle = tones[Math.floor(rnd() * tones.length)]; c.beginPath(); c.ellipse(x, y, r * (1 + rnd() * 0.5), r, rnd() * Math.PI, 0, Math.PI * 2); c.fill(); c.fillStyle = "rgba(255,255,255,.25)"; c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.2, 0, 0, Math.PI * 2); c.fill(); }
    },
    foodie: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, W, H, ["#ffe1ec", "#fff4d6", "#dff5ff"])); const foods = ["🍕", "🍩", "🍓", "🍔", "🍉", "🧁", "🍟", "🍪", "🍦", "🥨"], rnd = seeded(5), size = H / 6;
      for (let y = size / 2, row = 0; y < H + size; y += size * 1.1, row++) for (let x = (row % 2) * size * 0.6; x < W + size; x += size * 1.2) emoji(c, foods[Math.floor(rnd() * foods.length)], x, y, size * 0.8, (rnd() - 0.5) * 0.8);
    },
    smoosh: (c, W, H) => {
      fill(c, W, H, "#ffd6f0"); const rnd = seeded(9), cols = ["255,99,178", "255,190,60", "90,200,255", "140,110,255", "80,230,170"];
      for (let i = 0; i < 9; i++) { const x = rnd() * W, y = rnd() * H, r = H * (0.3 + rnd() * 0.4), col = cols[i % cols.length]; fill(c, W, H, radial(c, x, y, r, `rgba(${col},.9)`, `rgba(${col},0)`)); }
    },
    beach: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, 0, H * 0.55, ["#59b7ff", "#bfe6ff"])); c.fillStyle = "#ffe27a"; c.beginPath(); c.arc(W * 0.8, H * 0.18, H * 0.09, 0, Math.PI * 2); c.fill();
      c.fillStyle = linear(c, 0, H * 0.5, 0, H * 0.72, ["#1f8fd6", "#5cd0e6"]); c.fillRect(0, H * 0.5, W, H * 0.22);
      c.strokeStyle = "rgba(255,255,255,.7)"; c.lineWidth = 3; for (const y of [0.56, 0.62, 0.68]) { c.beginPath(); for (let x = 0; x <= W; x += 20) c.lineTo(x, H * y + Math.sin(x / 25) * 3); c.stroke(); }
      c.fillStyle = linear(c, 0, H * 0.7, 0, H, ["#f6dfa5", "#e9c27c"]); c.beginPath(); c.moveTo(0, H * 0.74); c.quadraticCurveTo(W / 2, H * 0.68, W, H * 0.74); c.lineTo(W, H); c.lineTo(0, H); c.fill();
      emoji(c, "🌴", W * 0.1, H * 0.55, H * 0.4); emoji(c, "⛱️", W * 0.85, H * 0.78, H * 0.18); emoji(c, "🐚", W * 0.5, H * 0.92, H * 0.07);
    },
    sunset: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, 0, H, ["#2c1a4d", "#7a2f7a", "#ff6f61", "#ffb36b"])); c.fillStyle = "#ffd36b"; c.beginPath(); c.arc(W * 0.5, H * 0.72, H * 0.16, 0, Math.PI * 2); c.fill();
      for (const [y, col] of [[0.7, "#3a1f4f"], [0.8, "#24133a"]]) { c.fillStyle = col; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += W / 8) c.lineTo(x, H * y + Math.sin(x / W * 7 + y * 10) * H * 0.05); c.lineTo(W, H); c.fill(); }
    },
    celebration: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, W, H, ["#2b1055", "#7597de"])); const rnd = seeded(13), cols = ["#ff5f9e", "#ffd23f", "#3bceac", "#ee6c4d", "#9b5de5", "#fff"];
      for (let i = 0; i < 220; i++) { c.save(); c.translate(rnd() * W, rnd() * H); c.rotate(rnd() * Math.PI); c.fillStyle = cols[Math.floor(rnd() * cols.length)]; c.fillRect(-4, -2, 8, 4); c.restore(); }
      emoji(c, "🎈", W * 0.1, H * 0.3, H * 0.2); emoji(c, "🎈", W * 0.9, H * 0.25, H * 0.18); emoji(c, "🎉", W * 0.82, H * 0.75, H * 0.16); emoji(c, "✨", W * 0.2, H * 0.78, H * 0.12);
    },
    forest: (c, W, H) => {
      fill(c, W, H, linear(c, 0, 0, 0, H, ["#cdeccf", "#79b77e", "#2f6b3a"]));
      layer(c, "screen", 0.35, () => { for (const x of [0.2, 0.45, 0.7]) { c.fillStyle = linear(c, W * x, 0, W * x + 60, H, ["rgba(255,255,220,.8)", "rgba(255,255,220,0)"]); c.beginPath(); c.moveTo(W * x, 0); c.lineTo(W * x + 40, 0); c.lineTo(W * x + 140, H); c.lineTo(W * x + 60, H); c.fill(); } });
      const rnd = seeded(17);
      for (const [base, col, size] of [[0.75, "#4e8f55", 0.35], [0.85, "#356e3d", 0.45], [1, "#1f4d28", 0.55]]) for (let x = -20; x < W + 40; x += 40 + rnd() * 50) { const h = H * size * (0.7 + rnd() * 0.5); c.fillStyle = col; c.beginPath(); c.moveTo(x, H * base); c.lineTo(x + h * 0.3, H * base - h); c.lineTo(x + h * 0.6, H * base); c.fill(); }
    }
  };
  const callBackground = (name, W, H) => cached(`bg-${name}`, W, H, (c, w, h) => (BACKGROUNDS[name] || (() => fill(c, w, h, "#333")))(c, w, h));
  // The ✨ Effects sheet: Filters or Backgrounds, and Touch up and Low light.
  function effectsSheet(l) {
    const tab = l.fxTab || "filters", list = tab === "filters" ? CALL_FILTERS : CALL_BACKGROUNDS, now = tab === "filters" ? callFx.filter : callFx.background;
    return `<div class="call-sheet call-effects"><div class="chips" role="tablist">${[["filters", "Filters"], ["backgrounds", "Backgrounds"]].map(([id, label]) => `<button class="chip ${tab === id ? "on" : ""}" data-fx-tab="${id}" role="tab" aria-selected="${tab === id}">${label}</button>`).join("")}</div>` +
      `<div class="fx-row">${list.map(([id, icon, name]) => `<button class="fx-pick ${now === id ? "on" : ""}" data-fx-${tab === "filters" ? "filter" : "bg"}="${id}" aria-pressed="${now === id}"><span aria-hidden="true">${icon}</span><small>${name}</small></button>`).join("")}</div>` +
      (l.fxNote ? `<p class="muted-note" role="status">${l.fxNote}</p>` : "") +
      `<div class="row fx-toggles"><button class="soft ${callFx.touchUp ? "on" : ""}" id="fxTouchUp" aria-pressed="${callFx.touchUp}">✨ Touch up</button><button class="soft ${callFx.lowLight ? "on" : ""}" id="fxLowLight" aria-pressed="${callFx.lowLight}">💡 Low light</button><button class="soft" id="callSheetClose">✕ Close</button></div></div>`;
  }
  async function changeEffects(l, change) {
    Object.assign(callFx, change); saveFx();
    applyEffects(l);
    await sendVideo(l);
    attachCallMedia(); drawCall();
  }

  // ---- The connections: one to each other person in the call. Whoever joined later sends the offer. ----
  function newPeer(l, id) {
    const pc = new RTCPeerConnection({ iceServers: calling.iceServers }), peer = { id, pc, remote: new MediaStream(), connected: false };
    l.peers.set(id, peer);
    pc.ontrack = e => { peer.remote.addTrack(e.track); attachCallMedia(); };
    pc.onconnectionstatechange = () => {
      if (callNow !== l || l.peers.get(id) !== peer) return;
      const s = pc.connectionState;
      peer.connected = s === "connected"; peer.reconnecting = s === "disconnected";
      if (s === "connected" && l.state !== "on") { l.state = "on"; l.since ||= Date.now(); callTones(null); }
      if (s === "failed") {
        closePeer(l, id);
        // With just one other person, the call can't go on.
        if (!l.group && l.people.filter(p => p.state === "in").length <= 1) return hangUp("failed");
      }
      drawCall();
    };
    return peer;
  }
  function closePeer(l, id) {
    const peer = l.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    l.peers.delete(id);
    document.querySelector(`#callGrid [data-peer="${id}"]`)?.remove();
    document.querySelector(`#callAudios [data-peer="${id}"]`)?.remove();
  }
  // Calls send everything about how to reach a device in one go, once the browser has found its addresses (or after 3 seconds).
  const gathered = pc => new Promise(done => {
    if (pc.iceGatheringState === "complete") return done();
    const t = setTimeout(done, 3000);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); done(); } });
  });
  const sendSignal = (l, to, type, sdp) => api(`/api/calls/${l.id}/signal`, send("POST", { to, type, sdp }));
  async function offerTo(l, id) {
    const peer = newPeer(l, id);
    peer.audioTx = peer.pc.addTransceiver(l.mic, { direction: "sendrecv", streams: [l.local] });
    peer.videoTx = peer.pc.addTransceiver(outVideo(l) || "video", { direction: "sendrecv", streams: [l.local] });
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await gathered(peer.pc);
    if (callNow !== l || l.peers.get(id) !== peer) return;
    await sendSignal(l, id, "offer", peer.pc.localDescription).catch(() => closePeer(l, id));
  }
  async function onSignal(l, s) {
    if (s.type === "answer") {
      const peer = l.peers.get(s.from);
      if (peer?.pc.signalingState === "have-local-offer") await peer.pc.setRemoteDescription(s.sdp).catch(() => closePeer(l, s.from));
      return;
    }
    // An offer: a new connection (or a fresh one, if they connected again).
    closePeer(l, s.from);
    const peer = newPeer(l, s.from), pc = peer.pc;
    try {
      await pc.setRemoteDescription(s.sdp);
      const kind = k => pc.getTransceivers().find(t => t.receiver.track?.kind === k);
      peer.audioTx = kind("audio"); peer.videoTx = kind("video");
      for (const [t, track] of [[peer.audioTx, l.mic], [peer.videoTx, outVideo(l)]]) {
        if (!t) continue;
        t.direction = "sendrecv";
        await t.sender.replaceTrack(track);
        t.sender.setStreams?.(l.local);
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      if (callNow !== l || l.peers.get(s.from) !== peer) return;
      await sendSignal(l, s.from, "answer", pc.localDescription);
    } catch { closePeer(l, s.from); }
  }
  // Connections follow who's in the call: new people get one (from whoever joined later), people who left lose theirs.
  async function syncPeers(l) {
    const inIt = l.people.filter(p => p.state === "in");
    for (const id of [...l.peers.keys()]) if (!inIt.some(p => p.id === id)) closePeer(l, id);
    if (!l.joinedAt || !l.local) return;
    for (const p of inIt) if (!l.peers.has(p.id) && (l.joinedAt > p.joinedAt || (l.joinedAt === p.joinedAt && state.user.id > p.id))) offerTo(l, p.id);
  }

  // ---- Starting, answering, joining and ending calls ----
  // to: { friend: id } or { group: key }.
  async function startCall(to, video) {
    if (talking(callNow)) { callNow.minimized = false; return drawCall(); }
    const problem = callProblem();
    if (problem) return toast(problem, true);
    // A group's call that's already going on: join it.
    if (to.group && state.groupView?.key === to.group && state.groupView.call) return joinGroupCall(state.groupView.call.id, to.group, video);
    const friend = to.friend && (callFriend(to.friend) || state.callHistory?.flatMap(c => c.people).find(p => p.id === to.friend));
    if (to.friend && !friend) return toast("You can only call your friends.", true);
    if (callNow) closeCall();
    const g = to.group && state.groupView?.key === to.group ? state.groupView.group : null;
    const l = callNow = { id: null, video, state: "calling", startedBy: state.user.id, people: friend ? [{ ...friend, state: "ringing" }] : [], group: g ? { key: to.group, name: g.name, icon: g.icon } : null,
      peers: new Map(), muted: false, camera: video, facing: "user", pip: "br", floatAt: "br", to };
    drawCall();
    try {
      await openMedia(l, video);
      const d = await api(to.friend ? `/api/friends/${to.friend}/call` : `/api/groups/${encodeURIComponent(to.group)}/call`, send("POST", { video: l.camera }));
      if (callNow !== l) return api(`/api/calls/${d.call.id}/end`, send("POST", {})).catch(() => {});
      applyView(l, d.call);
      callTones("ringback");
      drawCall(); pollCallSoon();
    } catch (err) {
      if (callNow !== l) return;
      closeCall();
      if (err?.message !== "") toast(mediaProblem(err), true);
    }
  }
  // Answering a call that's ringing you, or joining a group's call: your microphone (and camera for a video call), then in.
  async function acceptCall(l = callNow) {
    if (!l || !["incoming", "joining"].includes(l.state)) return;
    const problem = callProblem();
    if (problem) { hangUp(); return toast(problem, true); }
    l.state = "joining"; callTones(null); restoreTitle(); drawCall();
    try {
      await openMedia(l, l.video);
      const d = await api(`/api/calls/${l.id}/join`, send("POST", { camera: l.camera }));
      if (callNow !== l) return api(`/api/calls/${l.id}/end`, send("POST", {})).catch(() => {});
      l.joined = true;
      applyView(l, d.call);
      await syncPeers(l);
      drawCall(); pollCallSoon();
    } catch (err) {
      if (callNow !== l) return;
      closeCall();
      if (err?.message !== "") toast(mediaProblem(err), true);
    }
  }
  function joinGroupCall(id, key, video) {
    if (talking(callNow)) { callNow.minimized = false; return drawCall(); }
    if (callNow) closeCall();
    const g = state.groupView?.key === key ? state.groupView.group : null;
    callNow = { id, video, state: "joining", people: [], group: g ? { key, name: g.name, icon: g.icon } : { key }, peers: new Map(), muted: false, camera: video, facing: "user", pip: "br", floatAt: "br" };
    acceptCall(callNow);
  }
  // Hanging up, cancelling, or declining (with a quick reply, if one was picked). "failed": the devices couldn't reach each other.
  function hangUp(why, reply) {
    const l = callNow;
    if (!l) return;
    if (l.id && !["ended", "noanswer"].includes(l.state)) api(`/api/calls/${l.id}/end`, send("POST", Number.isInteger(reply) ? { reply } : {})).catch(() => {});
    if (l.state === "incoming") calling.declined.add(l.id);
    closeCall(why === "failed" ? "The call couldn't connect. One of your networks may be blocking calls." : l.state === "on" ? "Call ended" : null);
  }
  function stopCallMedia(l) {
    stopFx(l);
    l.local?.getTracks().forEach(t => t.stop());
    l.cam?.stop(); l.screen?.stop();
    for (const id of [...(l.peers?.keys() || [])]) closePeer(l, id);
  }
  const restoreTitle = () => { if (calling.title) { document.title = calling.title; calling.title = ""; } };
  // Ends the call on this device. With a message, the call screen says it for a moment first.
  function closeCall(message) {
    const l = callNow;
    if (!l) return;
    stopCallMedia(l);
    callTones(message ? "end" : null);
    clearInterval(calling.timer); calling.timer = null;
    restoreTitle();
    callWaiting = null;
    if (message) {
      Object.assign(l, { state: "ended", endText: message, minimized: false, camera: false, sheet: null });
      drawCall();
      setTimeout(() => { if (callNow === l) { callNow = null; drawCall(); } }, 1800);
    } else { callNow = null; drawCall(); }
    syncMusic();
    if (state.page === "friends") loadCallHistory().then(render).catch(() => {});
  }
  // Muting, the camera and sharing your screen: everyone's screen shows it too.
  const sendCallStatus = l => l.id && api(`/api/calls/${l.id}/status`, send("PUT", { muted: l.muted, camera: Boolean(l.cam), screen: Boolean(l.screen) })).catch(() => {});
  async function sendVideo(l) { for (const peer of l.peers.values()) await peer.videoTx?.sender.replaceTrack(outVideo(l)).catch(() => {}); }
  function toggleMute() {
    const l = callNow;
    if (!l?.mic) return;
    l.muted = !l.muted; l.mic.enabled = !l.muted;
    sendCallStatus(l); drawCall();
  }
  async function useCamera(on, facing = callNow?.facing) {
    const l = callNow;
    if (!l?.local) return;
    try {
      const old = l.cam;
      let track = null;
      if (on) {
        track = (await navigator.mediaDevices.getUserMedia({ video: CAMERA(facing) })).getVideoTracks()[0];
        if (callNow !== l) return track.stop();
      }
      if (old) { old.stop(); l.local.removeTrack(old); }
      if (track) l.local.addTrack(track);
      Object.assign(l, { cam: track, camera: Boolean(track), facing });
      applyEffects(l);
      await sendVideo(l);
      attachCallMedia(); sendCallStatus(l); drawCall();
    } catch (err) { toast(err?.name === "NotAllowedError" ? "Yakimma needs your camera for that. Allow it in your browser's settings." : "Your camera couldn't start.", true); }
  }
  async function shareScreen(on) {
    const l = callNow;
    if (!l?.local) return;
    if (on) {
      try {
        const track = (await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })).getVideoTracks()[0];
        if (callNow !== l) return track.stop();
        track.onended = () => { if (callNow === l && l.screen === track) shareScreen(false); };
        l.screen = track;
      } catch { return; }
    } else { l.screen?.stop(); l.screen = null; }
    l.sheet = null;
    await sendVideo(l);
    attachCallMedia(); sendCallStatus(l); drawCall();
  }
  async function addToCall(id) {
    const l = callNow;
    if (!l?.id) return;
    try { applyView(l, (await api(`/api/calls/${l.id}/invite`, send("POST", { userId: id }))).call); l.sheet = null; drawCall(); }
    catch (err) { l.error = err.message; drawCall(); setTimeout(() => { if (l.error === err.message) { l.error = null; drawCall(); } }, 4000); }
  }
  // Emoji reactions float up on everyone's screen.
  function react(emoji) {
    const l = callNow;
    if (!l?.id) return;
    showReaction(emoji, state.user.id);
    api(`/api/calls/${l.id}/react`, send("POST", { emoji })).catch(() => {});
  }
  function showReaction(emoji, from) {
    const fx = $("#callFx"), l = callNow;
    if (!fx || !l) return;
    const who = from === state.user?.id ? "" : l.people.find(p => p.id === from);
    const el = document.createElement("div");
    el.className = "call-react";
    el.style.left = `${10 + Math.random() * 75}%`;
    el.innerHTML = `<span>${safe(emoji)}</span>${who ? `<small translate="no">${safe(nameText(who.username))}</small>` : ""}`;
    fx.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---- Sounds: "ring" for a call coming in, "ringback" while their phone rings, "waiting" for call waiting, "end". ----
  let toneCtx = null, toneTimer = null;
  function callTones(kind) {
    clearInterval(toneTimer); toneTimer = null;
    navigator.vibrate?.(0);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!kind || !Ctx) return;
    const ctx = toneCtx ||= new Ctx();
    ctx.resume?.().catch(() => {});
    const beep = (freq, at, len, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.02); g.gain.setValueAtTime(vol, at + len - 0.05); g.gain.linearRampToValueAtTime(0, at + len);
      o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + len);
    };
    const play = () => {
      const t = ctx.currentTime + 0.05;
      if (kind === "ring") { [[659, 0], [784, 0.18], [988, 0.36], [784, 0.6], [988, 0.78]].forEach(([f, d]) => beep(f, t + d, 0.16, 0.16)); navigator.vibrate?.([400, 200, 400]); }
      else if (kind === "ringback") beep(425, t, 1, 0.07);
      else if (kind === "waiting") { beep(440, t, 0.15, 0.08); beep(440, t + 0.3, 0.15, 0.08); }
      else { beep(480, t, 0.18, 0.1); beep(380, t + 0.22, 0.25, 0.1); }
    };
    play();
    if (kind !== "end") toneTimer = setInterval(play, kind === "ring" ? 2600 : 3000);
  }

  // ---- Checking on calls: the live connection (see syncLive) says when something changed, and this checks anyway,
  // every second and a half in a call (so the server knows this device is still there) and every few seconds otherwise. ----
  function pollCallSoon(wait = 0) {
    clearTimeout(calling.poll);
    calling.poll = setTimeout(async () => { await pollCall().catch(() => {}); pollCallSoon(talking(callNow) || callNow?.state === "incoming" ? 1500 : document.hidden ? 8000 : 4000); }, wait);
  }
  const incomingFrom = r => ({ id: r.id, video: r.video, group: r.group, state: "incoming", people: r.people, invitedBy: r.invitedBy, peers: new Map(), muted: false, camera: false, facing: "user", pip: "br", floatAt: "br" });
  async function pollCall() {
    if (!state.user) { if (callNow) closeCall(); return; }
    const key = state.page === "groups" ? state.groupView?.key : null;
    let d;
    const inIt = talking(callNow) ? callNow.id : null;
    try { d = await api(`/api/calls?after=${calling.after}${inIt ? `&in=${inIt}` : ""}${key ? `&group=${encodeURIComponent(key)}` : ""}`); } catch { return; }
    Object.assign(calling, { iceServers: d.iceServers, replies: d.replies, reactions: d.reactions, max: d.max });
    // The open group's "Ongoing call · Join" bar.
    if (key && state.groupView?.key === key && JSON.stringify(state.groupView.call || null) !== JSON.stringify(d.groupCall)) {
      state.groupView.call = d.groupCall;
      if (!document.activeElement?.matches("input,textarea")) render();
    }
    const l = callNow, c = d.call, r = d.ringing;
    if (talking(l)) {
      // Still starting the call, or still joining it: the server doesn't have this device in it yet.
      if (!l.id || (l.state === "joining" && !l.joined)) return;
      if (!c || c.id !== l.id) {
        // This device's call ended: everyone else hung up, nobody answered, or the connection was lost.
        const e = d.ended?.id === l.id ? d.ended : null;
        if (l.state === "calling" && (e?.how === "unanswered" || e?.how === "missed" || !e)) {
          stopCallMedia(l); callTones("end");
          Object.assign(l, { state: "noanswer", minimized: false, camera: false, sheet: null });
          return drawCall();
        }
        return closeCall(e?.how === "left" && l.state !== "on" ? "The call was lost." : "Call ended");
      }
      applyView(l, c);
      for (const s of d.signals) { calling.after = Math.max(calling.after, s.id); await onSignal(l, s); }
      await syncPeers(l);
      // Call waiting.
      const w = r && r.id !== l.id && !calling.declined.has(r.id) ? r : null;
      if (w?.id !== callWaiting?.id) { callWaiting = w; callTones(w ? "waiting" : l.state === "calling" ? "ringback" : null); }
      return drawCall();
    }
    if (l?.state === "incoming") {
      if (r?.id === l.id) { l.people = r.people; return drawCall(); }
      // It stopped ringing: they hung up, someone else answered for the group, or you answered on another device.
      const answeredHere = c?.id === l.id, who = l.people.find(p => p.id === l.invitedBy);
      closeCall();
      if (!answeredHere && who && !l.group) toast(`📞 Missed call from ${nameText(who.username)}`);
      return;
    }
    // Someone's calling. Calls this device didn't start or answer (on another tab or device) are left alone.
    if (r && !calling.declined.has(r.id) && !c) {
      if (callNow) closeCall();
      callNow = incomingFrom(r);
      callTones("ring");
      calling.title = document.title;
      const caller = r.people.find(p => p.id === r.invitedBy);
      document.title = tr(`${nameText(caller?.username || r.group?.name || "")} is calling…`);
      drawCall();
    }
  }
  pollCallSoon(1500);
  // Closing the page hangs up.
  window.addEventListener("pagehide", () => { if (callNow?.id && (talking(callNow) || callNow.state === "incoming")) navigator.sendBeacon?.(`/api/calls/${callNow.id}/end`); });
  async function loadCallHistory() { state.callHistory = (await api("/api/calls/history")).calls; }

  // ---- The call screen. The videos stay put; everything on top of them is drawn again as the call changes. ----
  function callRoot() {
    let root = $("#callroot");
    if (root) return root;
    root = document.createElement("div");
    root.id = "callroot";
    root.innerHTML = `<div class="call-screen" id="callScreen" role="dialog" aria-modal="true" aria-label="Call" hidden><div id="callGrid"></div><div id="callAudios" hidden></div>` +
      `<video id="callSelf" autoplay playsinline muted></video><div id="callFx" aria-hidden="true"></div><div class="call-ui" id="callUI"></div></div><div id="callFxSrc" aria-hidden="true"></div>` +
      `<button class="call-bar" id="callBar" hidden></button><div class="call-float" id="callFloat" hidden><video autoplay playsinline muted></video><span></span></div>`;
    document.body.append(root);
    root.addEventListener("click", callClick);
    root.addEventListener("pointerdown", dragPip);
    return root;
  }
  // Each other person gets a tile (their video, or their picture) and an audio player.
  function tileFor(p) {
    let tile = document.querySelector(`#callGrid [data-peer="${p.id}"]`);
    if (!tile) {
      tile = document.createElement("div");
      tile.className = "call-tile"; tile.dataset.peer = p.id;
      tile.innerHTML = `<video autoplay playsinline muted></video><div class="tile-info"></div>`;
      $("#callGrid").append(tile);
    }
    return tile;
  }
  function attachCallMedia() {
    callRoot();
    const l = callNow, set = (el, s) => { if (el && el.srcObject !== (s || null)) el.srcObject = s || null; };
    set($("#callSelf"), l && selfStream(l));
    if (!l) { $("#callGrid").innerHTML = ""; $("#callAudios").innerHTML = ""; set($("#callFloat video"), null); return; }
    for (const peer of l.peers.values()) {
      set(tileFor({ id: peer.id }).querySelector("video"), peer.remote);
      let audio = document.querySelector(`#callAudios [data-peer="${peer.id}"]`);
      if (!audio) { audio = document.createElement("audio"); audio.autoplay = true; audio.dataset.peer = peer.id; $("#callAudios").append(audio); }
      set(audio, peer.remote);
    }
  }
  // Your own video (your screen while you share it), as one stream that stays the same until the camera changes.
  function selfStream(l) {
    const track = outVideo(l);
    if (!track) return null;
    if (l.selfStream?.getVideoTracks()[0] !== track) l.selfStream = new MediaStream([track]);
    return l.selfStream;
  }
  function drawCall() {
    callRoot();
    const l = callNow, screen = $("#callScreen"), bar = $("#callBar"), float = $("#callFloat");
    if (!l) { screen.hidden = bar.hidden = float.hidden = true; attachCallMedia(); return; }
    attachCallMedia();
    const on = l.state === "on", done = ["ended", "noanswer"].includes(l.state), quiet = done || l.state === "incoming";
    // A call ringing you, or one that's over, shows the big picture rather than everyone's tiles.
    const shown = quiet ? [] : l.people.filter(p => p.state === "in" || p.state === "ringing");
    const one = quiet || (!l.group && shown.length <= 1), other = shown[0] || l.people.find(p => p.id === l.invitedBy) || l.people[0];
    const sees = p => p.state === "in" && l.peers.get(p.id)?.connected && (p.status?.camera || p.status?.screen);
    // Their video fills the screen in a call with one friend; with more, everyone's in a grid. Your own video fills the
    // screen while the call is starting, and is the little picture once it's on.
    const theirs = one && other && sees(other), mine = Boolean(outVideo(l)) && !done, mineBig = mine && one && !theirs && !on;
    const swap = Boolean(one && theirs && mine && l.swapped);
    screen.hidden = Boolean(l.minimized);
    screen.className = `call-screen ${one ? "one" : "many"} ${theirs ? "rv" : ""} ${mine ? "sv" : ""} ${mineBig ? "sbig" : ""} ${swap ? "swap" : ""} ${l.facing === "user" && !l.screen ? "front" : ""} pip-${l.pip}`;
    $("#callSelf").classList.toggle("pip", mine && !mineBig && !swap);
    // The tiles.
    const grid = $("#callGrid");
    grid.className = `n${Math.min(Math.max(shown.length, 1), 7)}`;
    for (const tile of grid.querySelectorAll(".call-tile")) if (!shown.some(p => String(p.id) === tile.dataset.peer)) tile.remove();
    for (const p of shown) {
      const tile = tileFor(p), cam = sees(p);
      tile.classList.toggle("cam", Boolean(cam)); tile.classList.toggle("screen", Boolean(cam && p.status?.screen));
      tile.classList.toggle("pip", swap && p === other);
      const status = p.state === "ringing" ? (p.rang ? "Ringing…" : "Calling…") : !l.peers.get(p.id)?.connected ? "Connecting…" : "";
      tile.querySelector(".tile-info").innerHTML = (cam ? "" : `<div class="call-face">${avatarHTML(p.avatar, "big")}</div>`) +
        `<strong translate="no">${p.status?.muted ? "🔇 " : ""}${safe(nameText(p.username))}</strong>${status ? `<small>${status}</small>` : ""}`;
    }
    // The words and buttons on top.
    const everyone = l.people.filter(p => p.state === "in" || p.state === "ringing");
    const title = l.group?.name ? `${safe(l.group.icon || "👥")} ${ugc(l.group.name)}` : everyone.length > 1 ? safe(everyone.map(p => nameText(p.username)).join(", ")) : other ? safe(nameText(other.username)) : "";
    const caller = l.people.find(p => p.id === l.invitedBy);
    const allRang = l.people.length && l.people.every(p => p.state !== "ringing" || p.rang);
    const status = l.state === "ended" ? l.endText : l.state === "noanswer" ? "No answer"
      : l.state === "incoming" ? (l.group ? (l.video ? "🎥 Yakimma group video call" : "📞 Yakimma group voice call") : l.video ? "🎥 Yakimma video call" : "📞 Yakimma voice call")
      : l.state === "calling" ? (allRang ? "Ringing…" : "Calling…") : l.state === "joining" ? "Connecting…"
      : [...l.peers.values()].some(p => p.reconnecting) && one ? "Reconnecting…" : callTime(Math.round((Date.now() - l.since) / 1000));
    const btn = (id, icon, label, cls = "", extra = "") => `<button class="call-btn-round ${cls}" id="${id}" aria-label="${label}" ${extra}><span aria-hidden="true">${icon}</span><small>${label}</small></button>`;
    const sheet = l.sheet === "react" ? `<div class="call-sheet call-reacts">${calling.reactions.map(e => `<button data-call-react="${e}" aria-label="${e}">${e}</button>`).join("")}</div>`
      : l.sheet === "more" ? `<div class="call-sheet">${l.cam && calling.cams > 1 ? `<button class="soft" id="callFlip">🔄 Flip camera</button>` : ""}` +
        (canShare() ? `<button class="soft" id="callShare">${l.screen ? "🖥️ Stop sharing your screen" : "🖥️ Share your screen"}</button>` : "") +
        `<button class="soft" id="callAdd">👤＋ Add people</button><button class="soft" id="callSheetClose">✕ Close</button></div>`
      : l.sheet === "add" ? addPeopleSheet(l) : l.sheet === "effects" && l.cam ? effectsSheet(l) : "";
    const controls = l.state === "incoming"
      ? (l.replying ? `<div class="call-replies">${calling.replies.map((r, i) => `<button class="soft" data-call-reply="${i}">${safe(r)}</button>`).join("")}<button class="soft" id="callReplyBack">← Back</button></div>`
        : btn("callDecline", "✕", "Decline", "red") + btn("callMessage", "💬", "Message") + btn("callAccept", l.video ? "🎥" : "📞", "Accept", "green"))
      : l.state === "noanswer" ? btn("callClose", "✕", "Cancel") + btn("callAgain", l.video ? "🎥" : "📞", "Call again", "green")
      : l.state === "ended" ? ""
      : btn("callReact", "😊", "React", l.sheet === "react" ? "on" : "", l.id ? "" : "disabled") + btn("callCamera", l.cam ? "🎥" : "📷", l.cam ? "Camera off" : "Camera on", l.cam ? "on" : "") +
        btn("callMute", l.muted ? "🔇" : "🎙️", l.muted ? "Unmute" : "Mute", l.muted ? "on" : "") + btn("callMore", "⋯", "More", l.sheet === "more" || l.sheet === "add" ? "on" : "", l.id ? "" : "disabled") + btn("callEnd", "📞", "End", "red end");
    // "Turn on your camera?" when someone turns theirs on in a voice call.
    const camOn = !l.cam && on && l.people.find(p => p.state === "in" && p.status?.camera && !(l.camPrompted ||= new Set()).has(p.id));
    const waiting = callWaiting && `<div class="call-waiting" role="alert">📞 <span><strong translate="no">${safe(nameText(callWaiting.people.find(p => p.id === callWaiting.invitedBy)?.username || callWaiting.group?.name || ""))}</strong> <span>is calling…</span></span>` +
      `<button class="soft" id="waitDecline">Decline</button><button class="primary" id="waitAccept">End & accept</button></div>`;
    $("#callUI").innerHTML = `<div class="call-top">${done || l.state === "incoming" ? "<span></span>" : `<button class="call-min" id="callMin" aria-label="Make the call small">⌄</button>`}` +
        `<small class="call-lock">🔒 Goes straight to your friend. Not recorded.</small>` +
        `<span class="call-top-right">${l.cam && talking(l) ? `<button class="call-min ${l.sheet === "effects" ? "on" : ""}" id="callEffects" aria-label="Effects" title="Effects">✨</button>` : ""}` +
        `${talking(l) && l.id && !l.full ? `<button class="call-min" id="callAdd" aria-label="Add people">👤＋</button>` : ""}</span></div>` +
      (waiting || "") + (l.error ? `<p class="call-chip call-error" role="alert">${safe(l.error)}</p>` : "") +
      (l.screen ? `<p class="call-chip">🖥️ <span>You're sharing your screen</span> <button class="soft" id="callShareStop">Stop</button></p>` : "") +
      `<div class="call-who">${one && !theirs && !mineBig ? `<div class="call-face">${l.group?.icon && !other ? `<span class="avatar big">${safe(l.group.icon)}</span>` : other ? avatarHTML(other.avatar, "big") : ""}</div>` : ""}` +
        `<h2 translate="no">${title}</h2>${l.state === "incoming" && (l.group || l.people.length > 1) && caller ? `<p><span translate="no">${safe(nameText(caller.username))}</span> <span>is calling…</span></p>` : ""}` +
        `<p id="callStatus" ${on ? 'translate="no"' : ""}>${safe(status)}</p>` +
        (one && on && other?.status?.muted ? `<p class="call-chip">🔇 <span>${safe(nameText(other.username))} is muted</span></p>` : "") +
        (camOn ? `<p class="call-chip">📹 <span>${safe(nameText(camOn.username))} turned on their camera</span> <button class="soft" id="callCamYes" data-for="${camOn.id}">Turn on mine</button><button class="soft" id="callCamNo" data-for="${camOn.id}" aria-label="No thanks">✕</button></p>` : "") + `</div>` +
      sheet + `<div class="call-controls">${controls}</div>`;
    // Small: a video call becomes a floating video (yours if nobody else's camera is on), a voice call a green bar.
    const floatVideo = l.minimized && ([...l.peers.values()].find(p => sees(l.people.find(x => x.id === p.id) || {}))?.remote || selfStream(l));
    float.hidden = !floatVideo;
    bar.hidden = !l.minimized || Boolean(floatVideo);
    if (floatVideo) {
      const v = float.querySelector("video");
      if (v.srcObject?.id !== floatVideo.id) v.srcObject = floatVideo;
      float.className = `call-float at-${l.floatAt}`;
      float.querySelector("span").innerHTML = `<span translate="no" id="callFloatTime">${on ? callTime(Math.round((Date.now() - l.since) / 1000)) : ""}</span>`;
    }
    if (l.minimized && !floatVideo) bar.innerHTML = `<span>📞 <strong translate="no">${title}</strong> · <span translate="no" id="callBarTime">${on ? callTime(Math.round((Date.now() - l.since) / 1000)) : ""}</span></span><span>Tap to return to the call</span>`;
    // The call's timer, every second while it's on.
    if (on && !calling.timer) calling.timer = setInterval(() => {
      if (callNow?.state !== "on") return;
      const t = callTime(Math.round((Date.now() - callNow.since) / 1000));
      for (const id of ["callBarTime", "callFloatTime"]) if ($("#" + id)) $("#" + id).textContent = t;
      if ($("#callStatus") && /^\d+:\d\d$/.test($("#callStatus").textContent)) $("#callStatus").textContent = t;
    }, 1000);
    syncMusic();
  }
  // 👤＋ Add people: your friends who aren't in the call yet.
  function addPeopleSheet(l) {
    const inIt = new Set(l.people.filter(p => p.state === "in" || p.state === "ringing").map(p => p.id));
    const friends = state.social.friends.filter(f => f.canTalk !== false && !inIt.has(f.id));
    return `<div class="call-sheet call-add"><h3>👤＋ Add people</h3><p class="muted-note">Up to ${calling.max} people can be in a call.</p>` +
      (friends.length ? friends.map(f => `<div class="call-add-row">${avatarHTML(f.avatar, "tiny")}<strong translate="no">${safe(nameText(f.username))}</strong><button class="primary" data-call-invite="${f.id}">Add</button></div>`).join("")
        : `<p class="muted-note">All your friends are already in the call.</p>`) + `<button class="soft" id="callSheetClose">✕ Close</button></div>`;
  }
  // Dragging the little picture (or the floating video), like WhatsApp: it follows your finger (or mouse), and when you
  // let go it slides to the nearest corner of the screen. A tap without dragging isn't a drag.
  function dragPip(e) {
    const el = e.target.closest?.(".pip, .call-float"), l = callNow;
    if (!el || !l || (e.pointerType === "mouse" && e.button !== 0)) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    el.setPointerCapture?.(e.pointerId);
    const move = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      el.classList.add("dragging");
      el.style.translate = `${dx}px ${dy}px`;
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.classList.remove("dragging");
      if (!moved || callNow !== l) { el.style.translate = ""; return; }
      calling.draggedAt = Date.now();
      // Where it was let go, then which corner that's nearest to; it slides there from where it was dropped.
      const dropped = el.getBoundingClientRect(), x = dropped.left + dropped.width / 2, y = dropped.top + dropped.height / 2;
      const corner = (y < innerHeight / 2 ? "t" : "b") + (x < innerWidth / 2 ? "l" : "r");
      if (el.id === "callFloat") l.floatAt = corner; else l.pip = corner;
      el.style.translate = "";
      drawCall();
      const now = el.getBoundingClientRect();
      el.style.translate = `${dropped.left - now.left}px ${dropped.top - now.top}px`;
      el.getBoundingClientRect();
      el.classList.add("settling");
      el.style.translate = "";
      setTimeout(() => el.classList.remove("settling"), 300);
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }
  async function callClick(e) {
    const b = e.target.closest("button, .pip, .call-float");
    const l = callNow;
    if (!b || !l) return;
    const dragged = Date.now() - calling.draggedAt < 400;
    // Tapping the little picture swaps it with the big one.
    if (b.classList.contains("pip")) { if (!dragged && l.people.length === 1) { l.swapped = !l.swapped; drawCall(); } return; }
    if (b.id === "callFloat") { if (!dragged) { l.minimized = false; drawCall(); } return; }
    if (b.id === "callBar") { l.minimized = false; return drawCall(); }
    if (b.id === "callMin") { l.minimized = true; l.sheet = null; return drawCall(); }
    if (b.id === "callAccept") return acceptCall();
    if (b.id === "callDecline") return hangUp();
    if (b.id === "callMessage") { l.replying = true; return drawCall(); }
    if (b.id === "callReplyBack") { l.replying = false; return drawCall(); }
    if (b.dataset.callReply !== undefined) { const who = l.people.find(p => p.id === l.invitedBy); hangUp(null, Number(b.dataset.callReply)); return who && toast(`💬 Sent to ${nameText(who.username)}.`); }
    if (b.id === "callEnd") return hangUp();
    if (b.id === "callMute") return toggleMute();
    if (b.id === "callCamera") return useCamera(!l.cam);
    if (b.id === "callFlip") { l.sheet = null; return useCamera(true, l.facing === "user" ? "environment" : "user"); }
    if (b.id === "callShare") return shareScreen(!l.screen);
    if (b.id === "callShareStop") return shareScreen(false);
    if (b.id === "callReact") { l.sheet = l.sheet === "react" ? null : "react"; return drawCall(); }
    if (b.dataset.callReact) { l.sheet = null; drawCall(); return react(b.dataset.callReact); }
    if (b.id === "callMore") { l.sheet = l.sheet === "more" || l.sheet === "add" ? null : "more"; return drawCall(); }
    if (b.id === "callAdd") { l.sheet = "add"; return drawCall(); }
    if (b.id === "callSheetClose") { l.sheet = null; return drawCall(); }
    // ✨ Effects.
    if (b.id === "callEffects") { l.sheet = l.sheet === "effects" ? null : "effects"; return drawCall(); }
    if (b.dataset.fxTab) { l.fxTab = b.dataset.fxTab; return drawCall(); }
    if (b.dataset.fxFilter) return changeEffects(l, { filter: b.dataset.fxFilter });
    if (b.dataset.fxBg) return changeEffects(l, { background: b.dataset.fxBg });
    if (b.id === "fxTouchUp") return changeEffects(l, { touchUp: !callFx.touchUp });
    if (b.id === "fxLowLight") return changeEffects(l, { lowLight: !callFx.lowLight });
    if (b.dataset.callInvite) return addToCall(Number(b.dataset.callInvite));
    if (b.id === "callCamYes") { l.camPrompted.add(Number(b.dataset.for)); return useCamera(true); }
    if (b.id === "callCamNo") { l.camPrompted.add(Number(b.dataset.for)); return drawCall(); }
    if (b.id === "callClose") { callNow = null; return drawCall(); }
    if (b.id === "callAgain") { const { to, video } = l; callNow = null; return startCall(to, video); }
    // Call waiting: decline the new call, or end this one and answer it.
    if (b.id === "waitDecline" && callWaiting) { calling.declined.add(callWaiting.id); api(`/api/calls/${callWaiting.id}/end`, send("POST", {})).catch(() => {}); callWaiting = null; callTones(null); return drawCall(); }
    if (b.id === "waitAccept" && callWaiting) {
      const next = incomingFrom(callWaiting);
      if (l.id) api(`/api/calls/${l.id}/end`, send("POST", {})).catch(() => {});
      callWaiting = null; stopCallMedia(l); callTones(null);
      callNow = next;
      return acceptCall(next);
    }
  }
  // A call's note in a chat, like WhatsApp's: tap it to call back.
  function callNoteHTML(m) {
    const c = m.call, mine = m.userId === state.user?.id, icon = c.video ? "🎥" : "📞", what = c.video ? "Video call" : "Voice call";
    const text = c.secs !== null ? `<span>${icon} ${what}</span> · <span translate="no">${callTime(c.secs)}</span>`
      : mine ? `<span>${icon} ${what}</span> · <span>No answer</span>` : `<span class="missed">${icon} ${c.video ? "Missed video call" : "Missed voice call"}</span> · <span>Tap to call back</span>`;
    const target = state.chat.friendId ? `data-call-friend="${state.chat.friendId}"` : `data-call-group="${safe(state.groupView?.key || "")}"`;
    return `<div class="msg-note call-note" data-msg-id="${m.id}"><button class="call-note-btn" ${target} data-video="${c.video ? 1 : 0}" title="Call back">${text} · <span>${timeLabel(m.createdAt)}</span></button></div>`;
  }
  // A group's call buttons and its "Ongoing call · Join" bar, for the top of its page.
  function groupCallBar(v) {
    const c = v.call, buttons = `<button class="soft call-btn" data-call-group="${safe(v.key)}" data-video="1" title="Video call" aria-label="Video call">🎥</button><button class="soft call-btn" data-call-group="${safe(v.key)}" data-video="0" title="Voice call" aria-label="Voice call">📞</button>`;
    if (!c) return { buttons, bar: "" };
    const here = callNow?.id === c.id && talking(callNow);
    return { buttons, bar: `<div class="group-call-bar"><span>${c.video ? "🎥" : "📞"} <span>${c.video ? "Ongoing video call" : "Ongoing voice call"}</span> · <span>${c.count === 1 ? "1 person" : `${c.count} people`}</span></span>` +
      `<span class="group-call-faces">${c.people.map(p => avatarHTML(p.avatar, "tiny")).join("")}</span>` +
      (here ? `<button class="primary" id="returnToCall">Return to call</button>` : `<button class="primary" data-join-call="${c.id}" data-video="${c.video ? 1 : 0}">Join</button>`) + `</div>` };
  }
  // 📞 Calls on the Friends page, like WhatsApp's Calls tab: ＋ New call, All or Missed, and your calls (tap one for
  // its call info, or its button to call back).
  const callWho = c => c.group ? `${safe(c.group.icon)} ${ugc(c.group.name)}` : c.people.map(p => nameHTML(p.username)).join(", ");
  const callMissed = c => !c.outgoing && c.secs === null;
  const callBackBtn = c => !c.callBack ? "" : `<button class="soft call-btn" ${c.callBack.group ? `data-call-group="${safe(c.callBack.group)}"` : `data-call-friend="${c.callBack.friend}"`} data-video="${c.video ? 1 : 0}" title="${c.video ? "Video call" : "Voice call"}" aria-label="${c.video ? "Video call" : "Voice call"}">${c.video ? "🎥" : "📞"}</button>`;
  function callLine(c) {
    const how = c.outgoing ? "↗️ Outgoing" : callMissed(c) ? "↙️ Missed" : "↙️ Incoming";
    return `<span class="${callMissed(c) ? "missed" : ""}">${how}</span>${c.secs !== null ? ` · <span translate="no">${callTime(c.secs)}</span>` : c.outgoing ? " · <span>No answer</span>" : ""} · <span>${timeLabel(c.createdAt)}</span>`;
  }
  function callsPanel() {
    const all = state.callHistory, list = all && (state.callFilter === "missed" ? all.filter(callMissed) : all), shown = state.allCalls ? list : list?.slice(0, 8);
    const face = c => c.group ? `<span class="avatar">${safe(c.group.icon)}</span>` : avatarHTML(c.people[0]?.avatar);
    const row = c => `<div class="person call-row"><button class="call-row-main" data-call-info="${c.id}">${face(c)}<span><strong>${callWho(c)}</strong><small>${callLine(c)}</small></span></button>${callBackBtn(c)}</div>`;
    const callable = state.social.friends.filter(f => f.canTalk !== false);
    return `<section class="panel calls-panel"><div class="row between"><h2>📞 Calls</h2><div class="row"><button class="${state.newCall ? "soft" : "primary"}" id="newCallBtn">${state.newCall ? "✕ Close" : "＋ New call"}</button>` +
        (all?.length ? `<button class="soft" id="clearCallsBtn">🗑️ Clear call log</button>` : "") + `</div></div>` +
      (state.newCall ? `<div class="new-call">${callable.length ? callable.map(f => `<div class="person"><div class="person-main">${avatarHTML(f.avatar)}<strong>${nameHTML(f.username)}</strong></div><div class="row">` +
        `<button class="soft call-btn" data-call-friend="${f.id}" data-video="0" title="Voice call" aria-label="Voice call">📞</button><button class="soft call-btn" data-call-friend="${f.id}" data-video="1" title="Video call" aria-label="Video call">🎥</button></div></div>`).join("")
        : `<p class="muted-note">Add a friend to call them.</p>`}<p class="muted-note">👥 To call a group, tap 📞 or 🎥 at the top of the group.</p></div>` : "") +
      (!all ? `<p class="muted">Loading your calls…</p>` : !all.length ? `<p class="muted-note">No calls yet. Tap 📞 or 🎥 in a chat with a friend, or ＋ New call, to call them.</p>`
        : `<div class="chips" role="group" aria-label="Which calls">${[["all", "All"], ["missed", "Missed"]].map(([id, label]) => `<button class="chip ${(state.callFilter || "all") === id ? "on" : ""}" data-call-filter="${id}" aria-pressed="${(state.callFilter || "all") === id}">${label}</button>`).join("")}</div>` +
          (list.length ? `<h3>Recent</h3>${shown.map(row).join("")}` + (list.length > 8 ? `<button class="soft" id="allCallsBtn">${state.allCalls ? "Show less ⬆️" : `Show all ${list.length} ⬇️`}</button>` : "") : `<p class="muted-note">No missed calls. 🎉</p>`)) + `</section>`;
  }
  // Call info, like WhatsApp's: who it was with, and every call with them (or that group) in your Calls list.
  function callInfoModal(id) {
    const c = state.callHistory?.find(x => x.id === id);
    if (!c) return;
    const same = state.callHistory.filter(x => c.group ? x.group?.key === c.group.key : !x.group && x.people.length === 1 && x.people[0].id === c.people[0]?.id && c.people.length === 1);
    const list = c.people.length === 1 || c.group ? same : [c];
    const chat = c.group ? (c.group.member ? `<button class="soft" data-call-chat-group="${safe(c.group.key)}">💬 Message</button>` : "") : c.callBack ? `<button class="soft" data-chat="${c.callBack.friend}">💬 Message</button>` : "";
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal call-info" role="dialog" aria-modal="true" aria-labelledby="callInfoTitle"><div class="row between"><h2 id="callInfoTitle">📞 Call info</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<div class="gi-top">${c.group ? `<span class="avatar big">${safe(c.group.icon)}</span>` : avatarHTML(c.people[0]?.avatar, "big")}<h3>${callWho(c)}</h3>` +
        (c.group || c.people.length > 1 ? `<p class="muted-note">${c.people.map(p => nameHTML(p.username)).join(", ")}</p>` : "") +
        `<div class="actions ci-calls">${c.callBack ? `<button class="soft" ${c.callBack.group ? `data-call-group="${safe(c.callBack.group)}"` : `data-call-friend="${c.callBack.friend}"`} data-video="0">📞 Voice call</button><button class="soft" ${c.callBack.group ? `data-call-group="${safe(c.callBack.group)}"` : `data-call-friend="${c.callBack.friend}"`} data-video="1">🎥 Video call</button>` : ""}${chat}</div></div>` +
      `<div class="call-info-list">${list.map(x => `<div class="call-info-row"><span>${x.video ? "🎥" : "📞"} <span class="${callMissed(x) ? "missed" : ""}">${x.outgoing ? "Outgoing" : callMissed(x) ? "Missed" : "Incoming"}</span></span><small>${x.secs !== null ? `<span translate="no">${callTime(x.secs)}</span> · ` : x.outgoing ? "<span>No answer</span> · " : ""}<span>${timeLabel(x.createdAt)}</span></small><button class="soft" data-call-forget="${x.id}" aria-label="Delete from call log" title="Delete from call log">🗑️</button></div>`).join("")}</div></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
  }

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
  // ---- 🔎 Searching posts, from the button next to the creator's name on the Feed. While the search is open, the Feed
  // shows what it found instead of the newest posts. ----
  const SEARCH_KINDS = [["all", "📋 All posts", "post"], ["video", "🎬 Videos", "video"], ["photo", "📸 Photos", "photo"], ["text", "📝 Text posts", "text post"]];
  async function searchPosts(q, kind) {
    state.postSearch = { q, kind, posts: zonePosts((await api(`/api/search/posts?q=${encodeURIComponent(q)}&kind=${kind}`)).posts) };
  }
  function postSearchPanel() {
    const s = state.postSearch, n = s.posts?.length, what = SEARCH_KINDS.find(k => k[0] === s.kind)[2] + (n === 1 ? "" : "s");
    const found = !s.posts ? "Type words from a post, or tap 🎬 Videos, 📸 Photos or 📝 Text posts."
      : n ? `${n === 100 ? "Showing the 100 newest" : `Found ${n}`} ${what}${s.q ? ` with "${safe(s.q)}"` : ""}.`
      : `No ${what}${s.q ? ` with "${safe(s.q)}"` : ""} yet. Try other words.`;
    return `<section class="panel"><div class="row between"><h2>🔎 Search posts</h2><button class="soft" id="closePostSearch">✕ Close</button></div>` +
      `<form id="postSearchForm" class="row nowrap"><label class="sr-only" for="postSearchText">Words in the post</label><input id="postSearchText" type="search" maxlength="100" placeholder="Words in a caption or description" autocomplete="off" value="${safe(s.q)}"><button class="primary" type="submit">Search</button></form>` +
      `<div class="chips search-kinds" role="group" aria-label="Which posts">${SEARCH_KINDS.map(([id, label]) => `<button class="chip ${s.kind === id ? "on" : ""}" data-search-kind="${id}" aria-pressed="${s.kind === id}">${label}</button>`).join("")}</div>` +
      `<p class="muted-note">${found}</p></section>`;
  }
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
    // Friends can start chatting from here too, like 💬 Chat in Friends (with its unread count).
    const unread = state.social.friends.find(f => f.id === u.id)?.unread || 0;
    const chat = !isFriend ? "" : p.canTalk ? `<button class="primary" data-chat="${u.id}">💬 Chat${unread ? ` <span class="badge" aria-label="${unread} unread">${unread}</span>` : ""}</button>`
      : `<button class="soft" disabled title="${cantChatWhy()}">🔞 Can't chat</button>`;
    const helper = state.user.assistant?.id === u.id ? `<button class="soft" data-assistant-remove="1">🤝 Your assistant ✓</button>`
      : isFriend && !kidOn() && !p.zoneNote ? `<button class="soft" data-assistant="${u.id}">🤝 Make my assistant</button>` : "";
    const nickname = isFriend ? `<button class="soft" data-nickname="${u.id}" data-name="${safe(u.username)}">🏷️ Nickname</button>` : "";
    const suspend = !state.user.creator || isCreatorName(u.username) ? ""
      : p.suspended ? `<button class="soft" data-unsuspend="${u.id}" data-name="${safe(u.username)}">Lift the suspension</button>` : `<button class="soft" data-suspend="${u.id}" data-name="${safe(u.username)}">⛔ Suspend</button>`;
    // Only the creator makes people admins, or takes it away.
    const adminSwitch = !state.user.creator || isCreatorName(u.username) ? ""
      : `<button class="soft" data-set-admin="${u.id}" data-on="${!p.admin}" data-name="${safe(u.username)}">${p.admin ? "Remove as admin" : "🛠️ Make admin"}</button>`;
    // The creator can change anyone's profile picture and username.
    const creatorEdit = !state.user.creator || isCreatorName(u.username) ? ""
      : `<button class="soft" data-edit-avatar="${u.id}">🎨 Change picture</button><button class="soft" data-rename="${u.id}" data-name="${safe(u.username)}">✏️ Change Username</button>`;
    const actions = (p.zoneNote ? `${p.friend === "none" ? "" : friend + chat}${p.youFollow ? follow : ""}` : friend + chat + follow) + helper + nickname + suspend + adminSwitch + creatorEdit;
    // Like a YouTube channel: everything, just their videos, or just their photo and text posts.
    const isVideo = x => x.mediaType?.startsWith("video/"), tab = state.personTab || "all";
    const posts = zonePosts(p.posts), lists = { all: posts, videos: posts.filter(isVideo), posts: posts.filter(x => !isVideo(x)) }, shown = lists[tab];
    const tabs = [["all", "All"], ["videos", "🎬 Videos"], ["posts", "📝 Posts"]].map(([id, label]) => `<button class="step ${tab === id ? "on" : ""}" data-person-tab="${id}" aria-pressed="${tab === id}">${label} (${lists[id].length})</button>`).join("");
    return hero(`${safe(nameText(u.username))} 👤`, `See ${safe(nameText(u.username))}'s wallet, items and posts, send a friend request, or follow them.`, "PROFILE") +
      `<section class="panel"><button class="soft" data-page="friends">← Friends</button><div class="posthead" style="margin-top:12px"><button class="avatar-edit" data-view-avatar="person" aria-label="See ${safe(nameText(u.username))}'s profile picture">${avatarHTML(u.avatar, "big")}</button><div><h2 style="margin:0">${nameHTML(u.username)}</h2>` +
      `<small>🔢 Account number ${u.accountNumber}${p.followsYou ? " · Follows you" : ""}</small></div></div>` +
      `<div class="row person-things">${thing("🐱", p.mc, "MC")}${thing("💌", p.lc, "LC")}${thing("🎁", p.items, plural(p.items, "item"))}${thing("👯", p.friends, plural(p.friends, "friend"))}${identityPills(u)}` +
      `${followPills(u.id, p.followers, p.following, u.username)}</div>${linksHTML(u.links)}${p.suspended ? `<p class="notice error">⛔ Suspended until ${safe(untilText(p.suspended))}${p.suspended.reason ? `: ${safe(p.suspended.reason)}` : ""}</p>` : ""}${assistantLines(p, false)}${actions ? `<div class="actions">${actions}</div>` : ""}${p.zoneNote ? `<p class="muted-note">${safe(p.zoneNote)}</p>` : ""}</section>` +
      `<section class="panel"><h3>${safe(nameText(u.username))}'s posts (${posts.length})</h3><div class="tabs" role="group" aria-label="Which posts">${tabs}</div>${shown.length ? "" : `<p class="muted">${crazyZone() === "adult" ? NO_CRAZY_POSTS : tab === "videos" ? "No videos to see yet." : "No posts to see yet."}</p>`}</section><div class="feed">${shown.map(postCard).join("")}</div>`;
  }
  // Why you can't chat with a friend: only the kiddy zone keeps friends apart (you're in it, or they are).
  const cantChatWhy = () => kidOn() ? "You're in the kiddy zone, so you can only talk to friends who are in it too." : "They're in the kiddy zone right now, so you can't talk to them.";
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
      `<section class="panel"><div class="row chat-head"><button class="soft" data-page="friends">← Friends</button>${personLink(chatting.id, chatting.username, `${avatarHTML(chatting.avatar)}<strong>${nameHTML(chatting.username)}</strong>`)}<span class="chat-tools"><button class="soft call-btn" data-call-friend="${chatting.id}" data-video="1" title="Video call" aria-label="Video call">🎥</button><button class="soft call-btn" data-call-friend="${chatting.id}" data-video="0" title="Voice call" aria-label="Voice call">📞</button><button class="soft contact-info-btn" id="contactInfoBtn">ℹ️ Contact info</button></span></div>${chatBox(`Message ${nameText(chatting.username)}`)}</section>`;
    return top +
      `<section class="panel"><h2>Find people 🔎</h2><form id="friendForm" class="row nowrap"><label class="sr-only" for="friendName">Their username or display name</label><input id="friendName" maxlength="30" placeholder="Their username or display name" autocomplete="off" required value="${safe(state.friendSearch?.q || "")}"><button class="primary" type="submit">Search</button></form>` +
        (state.friendSearch ? (state.friendSearch.users.map(personCard).join("") || `<p class="muted">Nobody has a username or display name like "${safe(state.friendSearch.q)}".</p>`)
          : `<p class="muted-note">Open someone's profile to send them a friend request or follow them.</p>`) + `</section>` +
      `<section class="panel"><h2>👥 Everyone on Yakimma</h2><p class="muted-note">Scroll down to see more people.</p><div id="peopleList">${(state.people?.users || []).map(personCard).join("")}</div>${peopleEnd()}</section>` +
      (incoming.length ? `<section class="panel"><h2>Friend requests 💌</h2>${incoming.map(r => personRow(r, "wants to be your friend", `<button class="primary" data-accept="${r.requestId}">Accept</button><button class="soft" data-reject="${r.requestId}">Decline</button>${block(r)}`)).join("")}</section>` : "") +
      (ai ? `<section class="panel"><h2>AI assistant</h2>${personRow(ai, "Your Yakimma helper. AI messages you tips, like what you need to buy something in the Shop.", `<button class="primary" id="aiChat">💬 Chat${ai.unread ? ` <span class="badge" aria-label="${ai.unread} unread">${ai.unread}</span>` : ""}</button>`)}</section>` : "") +
      `<section class="panel"><h2>My friends (${friends.length})</h2>${friends.length ? friends.map(f => personRow(f, `<span class="tone-dot" style="background:${toneHex(f.handTone)}"></span> ${safe(toneName(f.handTone))} hand`, (f.canTalk === false ? `<button class="soft" disabled title="${cantChatWhy()}">🔞 Can't chat</button>` : `<button class="primary" data-chat="${f.id}">💬 Chat${f.muted ? " 🔕" : ""}${f.unread ? ` <span class="badge ${f.muted ? "muted" : ""}" aria-label="${f.unread} unread">${f.unread}</span>` : ""}</button>`) + (zoneOn() || f.canTalk === false ? "" : `<button class="soft" data-salon="${f.id}">💅 Do their nails</button>`) + `<button class="soft" data-unfriend="${f.id}" data-name="${safe(f.username)}">Remove</button>${block(f)}`)).join("") : `<p class="muted">No friends yet. Send a request above! 🌸</p>`}</section>` +
      callsPanel() +
      (outgoing.length ? `<section class="panel"><h2>Sent requests</h2>${outgoing.map(r => personRow(r, "waiting for them to accept…", `<button class="soft" data-reject="${r.requestId}">Cancel</button>`)).join("")}</section>` : "") +
      (blocked.length ? `<section class="panel"><h2>Blocked (${blocked.length})</h2>${blocked.map(p => personRow(p, "blocked", `<button class="soft" data-unblock="${p.id}" data-name="${safe(p.username)}">Unblock</button>`, false)).join("")}<p class="muted-note">People you block can't send you friend requests, and you won't see their messages or posts.</p></section>` : "");
  }
  function receivedGallery(limit) {
    if (!state.received.length) return `<p class="muted">No nail sets yet. Do your own nails, or when a friend does them, they show up here. 💌</p>`;
    // Whole sentences for your own sets, so they can be translated ("you" isn't a name).
    const mine = r => r.artistId === state.user.id;
    return `<div class="gallery">${state.received.slice(0, limit).map(r => `<figure class="look">${handSVG(toneHex(state.user.handTone), r.design, { label: mine(r) ? "Nails by you" : `Nails by ${r.artist}` })}<figcaption><strong>${mine(r) ? "by you" : `by ${safe(r.artist)}`}</strong><small>${safe(r.createdAt)}</small></figcaption></figure>`).join("")}</div>`;
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
  // A group's photo, or its icon when it has none.
  const groupIconHTML = (g, size = "") => g.photoUrl ? `<div class="group-icon photo ${size}"><img src="${safe(g.photoUrl)}" alt=""></div>` : `<div class="group-icon ${size}" aria-hidden="true">${safe(g.icon)}</div>`;
  function groupCard(g) {
    const mine = state.user?.id === g.ownerId, del = `<button class="soft" data-delete-group="${g.id}" data-name="${safe(g.name)}">Delete</button>`;
    // New messages since you last opened its chat, greyed out when you muted it.
    const unread = g.unread ? ` <span class="badge ${g.muted ? "muted" : ""}" aria-label="${g.unread} new message${g.unread === 1 ? "" : "s"}">${g.unread > 99 ? "99+" : g.unread}</span>` : "";
    const open = g.joined ? `<button class="primary" data-open-group="${g.id}">💬 Open${unread}</button>` : "";
    // Admins can delete anyone's group (but not the secret ones, which are built in). Joining a regular group asks its
    // admins; a secret group's code is all it takes.
    const action = !state.user ? "" : mine ? `${open}${del}`
      : g.joined ? `${open}<button class="soft" data-leave-group="${g.id}" data-name="${safe(g.name)}">Leave</button>`
      : g.secret && !g.unlocked ? `<button class="soft" data-page="codes">🔒 Needs a code</button>`
      : g.requested ? `<button class="soft" data-cancel-request="${g.id}" title="Take back your request">⏳ Requested</button>`
      : `<button class="primary" data-join-group="${g.id}">${g.secret ? "Join" : "🙋 Ask to join"}</button>`;
    const tag = (g.secret ? ` <span class="pill">🔑 Secret</span>` : "") + (mine ? ` <span class="pill">Yours</span>` : g.joined ? ` <span class="pill">Joined ✓</span>` : "") + (g.muted ? ` <span class="pill" title="Muted">🔕</span>` : "");
    return `<article class="group-card" data-search="${safe(`${g.name} ${g.description}`.toLowerCase())}">${groupIconHTML(g)}` +
      `<div class="group-body"><h3>${ugc(g.name)}${tag}</h3>${g.description ? `<p translate="no">${safe(g.description)}</p>` : ""}<div class="row">${facesButton(g)}<small>${g.secret ? "secret group" : `made by ${safe(g.owner)}`}</small></div></div>` +
      `<div class="group-actions">${action}${state.user?.admin && !mine && !g.secret ? del : ""}</div></article>`;
  }
  function groupPage() {
    const v = state.groupView, g = v.group;
    const top = hero(`${g.photoUrl ? `<img class="title-photo" src="${safe(g.photoUrl)}" alt="">` : safe(g.icon)} ${ugc(g.name)}`, g.description ? ugc(g.description) : `A group made by ${ugc(g.owner)}.`, g.secret ? "SECRET GROUP" : "GROUP");
    const info = g.joined && !g.secret ? `<button class="soft" id="groupInfoBtn">ℹ️ Group info</button>` : "";
    const calls = g.joined ? groupCallBar(v) : { buttons: "", bar: "" };
    const head = `<section class="panel"><div class="row between"><button class="soft" data-page="groups">← All groups</button><div class="row">${calls.buttons}${info}${facesButton(g)}</div></div>${calls.bar}`;
    if (!g.joined) return top + head + `<p>Join this group to see its posts and chat.</p></section>`;
    const tabs = [["chat", "💬 Chat"], ["posts", "📸 Posts"]].map(([id, label]) => `<button class="step ${v.tab === id ? "on" : ""}" data-group-tab="${id}" role="tab" aria-selected="${v.tab === id}">${label}</button>`).join("");
    const body = v.tab === "chat" ? `<section class="panel">${chatBox(`Message ${g.name}`)}</section>` :
      (g.canSend === false ? `<section class="panel"><p class="muted-note">🔒 Only group admins can post in this group.</p></section>` : `<section class="panel"><form id="groupPostForm"><label for="gpCaption">Post to ${safe(g.name)}</label><textarea id="gpCaption" maxlength="240" rows="2" required placeholder="Share something with the group…">${safe(v.caption)}</textarea>` +
      `<label for="gpMedia">Add a photo or video (optional)</label><input id="gpMedia" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime">` +
      `<div class="actions"><button class="primary" type="submit">Post to group ✨</button></div></form></section>`) +
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
  // ⭐ Rating Yakimma, right next to the Settings title: tap a star (tap another to change it). The creator sees
  // everyone's on the Reports page.
  const ratingStars = () => `<span class="rate-stars" role="group" aria-label="Rate Yakimma" title="Rate Yakimma">${[1, 2, 3, 4, 5].map(n =>
    `<button class="rate-star ${n <= (state.user.rating || 0) ? "on" : ""}" data-rate="${n}" aria-label="${n === 1 ? "1 star" : `${n} stars`}" aria-pressed="${n === state.user.rating}">⭐</button>`).join("")}</span>`;
  // 😊 The emojis that show first when you tap a message in a chat. Tap one to swap it for any emoji.
  const reactionsPanel = () => `<section class="panel"><h2>😊 Quick reactions</h2><p class="muted-note">These show first when you tap a message in a chat. Tap one to change it.</p>` +
    `<div class="quick-pick">${quickReactions().map((e, i) => `<button class="emoji-btn" data-pick-reaction="${i}" aria-label="Change ${e}">${e}</button>`).join("")}</div>` +
    (state.user.quickReactions ? `<button class="soft" data-reset-reactions>↺ Back to the usual ones</button>` : "") + `</section>`;
  async function saveReactions(emojis) {
    state.user = (await api("/api/me/quick-reactions", send("PUT", { emojis }))).user;
    toast("Your quick reactions are saved 😊");
  }
  function settingsPage() {
    const current = activeTheme();
    const cards = state.themes.filter(t => !t.gift || state.inventory.includes(t.item)).map(t => {
      const unlocked = !t.item || (state.user && state.inventory.includes(t.item)), product = state.products.find(p => p.id === t.item);
      const status = t.id === current ? "Using ✓" : unlocked ? "Tap to use" : `🔒 ${product ? priceLabel(product) : ""} in the Shop`;
      return `<button class="theme-card ${t.id === current ? "on" : ""}" data-theme="${t.id}" ${unlocked ? `data-use-theme="${t.id}"` : `data-page="shop"`} aria-pressed="${t.id === current}"><span class="theme-preview" aria-hidden="true"><i></i><i></i><i></i></span><strong>${t.icon} ${safe(t.name)}</strong><small>${status}</small></button>`;
    }).join("");
    return hero(`Settings ⚙️${state.user ? ratingStars() : ""}`, "Choose how Yakimma looks.", "YOUR PREFERENCES") +
      `<section class="panel"><h2>🌐 Language</h2><p class="muted-note">Yakimma is in <strong translate="no">${langOf(i18n.code).name}</strong>.</p><button class="soft" data-open-language>Change language</button></section>` +
      pushPanel() + (state.user ? reactionsPanel() : "") +
      `<section class="panel"><h2>Color theme</h2><div class="theme-grid">${cards}</div><p class="muted-note">${zoneOn() ? "The 18+ zone has its own theme. When you turn 18+ off, your normal theme comes back." : state.user ? "Your theme is saved to your account, so it follows you on any device." : "Free themes are saved in this browser. Sign in and buy Goth or Pastel in the Shop to unlock them."}</p></section>` +
      songPanel() + (crazyZonePanels() ?? adultPanel() + kidPanel()) +
      `<section class="panel"><h3>Safety reminder 🔐</h3><p class="muted-note">Never share your password.</p></section>` +
      `<div class="actions mode-btns"><button class="soft" id="oldModeBtn">Turn on Old Mode?</button><button class="soft crazy-btn ${crazyOn() ? "on" : ""}" id="crazyBtn" aria-pressed="${crazyOn()}"><span translate="no">🤪 CRAZZZYYY MODE</span>${crazyOn() ? " ✓" : ""}</button></div>`;
  }
  // In CRAZZZYYY MODE, the 18+ zone and the kiddy zone open straight away, as pretend zones (see crazyZone). Someone in a
  // real zone keeps the real panels, so a kid can't leave a real kiddy zone this way.
  function crazyZonePanels() {
    if (!crazyOn() || !state.user || realZone() || realKid()) return null;
    const z = crazyZone(), note = `<p class="muted-note">🤪 CRAZZZYYY MODE: it opens straight away, with no checks.</p>`;
    return (z === "kid" ? "" : `<section class="panel"><h2>🔞 18+</h2>` + (z === "adult"
      ? `<p>🤪 You're in CRAZZZYYY MODE's 18+ zone. It's open to everyone, so none of the 18+ posts are in it.</p><button class="danger" data-crazy-zone="">Turn off 18+</button>`
      : `${note}<button class="primary" data-crazy-zone="adult">Turn on 18+?</button>`) + `</section>`) +
      (z === "adult" ? "" : `<section class="panel"><h2>🧸 Kiddy zone</h2>` + (z === "kid"
      ? `<p>🤪 You're in CRAZZZYYY MODE's kiddy zone. It's only in this browser, so there's no parent lock.</p><button class="danger" data-crazy-zone="">Turn off the kiddy zone</button>`
      : `${note}<button class="primary" data-crazy-zone="kid">Turn on the kiddy zone?</button>`) + `</section>`);
  }
  // ---- 🔗 Links on your profile (up to MAX_LINKS), added and taken off on your Profile page. Everyone sees them, except in the
  // kiddy zone, which has none. ----
  const MAX_LINKS = 5;
  const linkAnchor = url => { let label = url; try { const u = new URL(url); label = (u.hostname.replace(/^www\./, "") + u.pathname + u.search).replace(/\/$/, ""); } catch {}
    return `<a class="profile-link" translate="no" href="${safe(url)}" target="_blank" rel="noopener noreferrer nofollow ugc">🔗 ${safe(label.length > 40 ? label.slice(0, 39) + "…" : label)}</a>`; };
  const linksHTML = links => links?.length ? `<div class="profile-links">${links.map(linkAnchor).join("")}</div>` : "";
  function linksPanel() {
    if (kidOn()) return `<section class="panel"><h2>🔗 My links</h2><p class="muted-note">Links aren't in the kiddy zone.</p></section>`;
    const links = state.user.links || [];
    return `<section class="panel"><h2>🔗 My links</h2><p class="muted-note">Your links show on your profile for everyone on Yakimma to see and open, so only add ones you're happy to share.</p>` +
      links.map((l, i) => `<div class="link-row">${linkAnchor(l)}<button class="soft" data-remove-link="${i}">Remove</button></div>`).join("") +
      (links.length < MAX_LINKS
        ? `<form id="linkForm" class="row nowrap"><label class="sr-only" for="linkInput">Web address</label><input id="linkInput" maxlength="300" inputmode="url" autocomplete="off" placeholder="https://example.com" required><button class="primary" type="submit">Add link</button></form>`
        : `<p class="muted-note">You have ${MAX_LINKS} links, the most you can have. Remove one to add another.</p>`) + `</section>`;
  }
  async function saveLinks(links, message) { state.user = (await api("/api/me/links", send("PUT", { links }))).user; toast(message); }
  // Admins can switch between the zones straight away, so they see both panels in every zone and skip the checks.
  const adminZoneNote = () => state.user?.admin ? `<p class="muted-note">🛠️ You're an admin, so you can switch zones straight away, without the checks.</p>` : "";
  const SONG_LOCKS = { adult: "🔞 Unlocks once you've been in the 18+ zone", kids: "🧸 Not in the kiddy zone", bangladeshiMuslim: "☪️🇧🇩 Only for Muslims from Bangladesh" };
  function songPanel() {
    if (!state.user) return "";
    const current = state.user.song;
    return `<section class="panel"><h2>🎵 Song</h2><p class="muted-note">Pick a song to play while you use Yakimma. It keeps playing on every page.</p><div class="song-list">` +
      state.songs.map(s => `<button class="song ${s.id === current ? "on" : ""}" data-song="${s.id}" aria-pressed="${s.id === current}" ${s.ready && !s.lock ? "" : "disabled"}>` +
        `<span>${s.lock ? "🔒" : s.file ? "🎵" : "🔇"} ${ugc(s.name)}</span><small>${!s.ready ? "Not added yet" : SONG_LOCKS[s.lock] || (s.id === current ? (s.file ? "Playing ✓" : "On ✓") : "")}</small></button>`).join("") + `</div></section>`;
  }
  function adultPanel() {
    const adult = state.user?.adult;
    if (!adult || (kidOn() && !state.user.admin)) return "";
    return `<section class="panel"><h2>🔞 18+</h2>` + (adult.on
      ? `<p>You're in the 18+ zone. You only see 18+ posts and groups, and you can only add people who are 18+. You can still talk to the friends you already have.</p><button class="danger" id="adultOff">Turn off 18+</button>`
      : (adminZoneNote() || `<p class="muted-note">${adult.verified ? "You've already done the 18+ checks, so you only need to confirm." : "For grown-ups only. To turn it on, you confirm you're 18+, enter a code we email you, and do a face scan."}</p>`) +
        `<button class="primary" id="adultStart">Turn on 18+?</button>`) + `</section>`;
  }
  function kidPanel() {
    const kid = state.user?.kid;
    if (!kid || (zoneOn() && !state.user.admin)) return "";
    if (state.user.admin) return `<section class="panel"><h2>🧸 Kiddy zone</h2>${adminZoneNote()}` +
      (kid.on ? `<p>You're in the kiddy zone.</p><button class="danger" id="kidOffAdmin">Turn off the kiddy zone</button>` : `<button class="primary" id="kidStart">Turn on the kiddy zone?</button>`) + `</section>`;
    return `<section class="panel"><h2>🧸 Kiddy zone</h2>` + (kid.on
      ? `<p>You're in the kiddy zone. You only see kiddy zone posts, you can only add and talk to friends who are in it too, and you have Feed, Profile, Pictures, Settings, Rules, Friends, Groups (only ones made in the kiddy zone), Nails, Learn, the Shop, Codes, About The Creator and 🔔 notifications. Only a parent can turn it off or sign out.</p>` +
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
    return `<section class="panel"><div class="row between"><h3>My posts (${m.total})</h3><button class="primary" data-page="create" data-from="profile">＋ Upload post</button></div>${m.total > 1 ? `<div class="tabs" role="group" aria-label="Order of your posts">${order}</div>` : ""}</section>` +
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
  // The person who posted it, and the creator, can tap the label to change who it's for. Once the creator has changed
  // someone's post it shows 🔒 to them instead, and tapping it says to contact the creator.
  function audiencePill(p) {
    const [, label] = AUDIENCE.find(a => a[0] === p.audience) || AUDIENCE[2];
    if (state.user?.creator || (state.user?.id === p.userId && !p.audienceLocked)) return ` <button class="pill aud ${p.audience}" data-post-audience="${p.id}" title="Change who it's for">${label} ✏️</button>`;
    if (state.user?.id === p.userId) return ` <button class="pill aud ${p.audience}" data-audience-locked title="Only the creator can change who it's for now">${label} 🔒</button>`;
    return ` <span class="pill aud ${p.audience}">${label}</span>`;
  }
  function audienceLockedModal() {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="lockTitle"><div class="row between"><h2 id="lockTitle">🔒 Locked by the creator</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p>The creator changed who this post is for, so you can't change it anymore.</p><p>To change it, contact the creator: <a href="mailto:manharuwycse@gmail.com">manharuwycse@gmail.com</a></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
  }
  function audienceModal(id) {
    const post = shownPosts(id)[0], now = post?.audience || "both";
    const locks = state.user.creator && post && post.userId !== state.user.id
      ? `<p class="muted-note">🔒 If you change it, ${safe(nameText(post.username))} can't change it anymore. Only you can.</p>` : "";
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="audTitle"><div class="row between"><h2 id="audTitle">🚻 Who is it for?</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` + locks +
      `<form id="audForm"><fieldset class="visibility"><legend>Who this post is for</legend>${AUDIENCE.map(([a, label, about]) => `<label class="vis-option"><input type="radio" name="newAudience" value="${a}" ${a === now ? "checked" : ""}><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
      `<div class="actions"><button class="primary" type="submit">Save</button></div></form><p class="muted-note error-text" id="audError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#audForm").onsubmit = async e => {
      e.preventDefault();
      const audience = $('input[name="newAudience"]:checked').value;
      try {
        const d = await api(`/api/posts/${id}/audience`, send("PUT", { audience }));
        for (const p of shownPosts(id)) Object.assign(p, { audience, audienceLocked: d.locked });
        closeModal(); render(); toast(`Now it's for: ${AUDIENCE.find(a => a[0] === audience)[1]}`);
      } catch (err) { $("#audError").textContent = err.message; }
    };
  }
  const postLink = code => `${location.origin}/post/${code}`;
  // Every copy of a post that's on show (feed, profiles, a group, its own page), to update them all at once.
  const shownPosts = id => [state.posts, state.postSearch?.posts, state.myPosts?.posts, state.playlist, state.groupView?.posts, state.reports?.posts, state.person?.posts, state.single?.post && [state.single.post]]
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
    const p = [...state.posts, ...(state.postSearch?.posts || []), ...(state.myPosts?.posts || []), ...(state.groupView?.posts || []), ...(state.reports?.posts || []), ...(state.person?.posts || []), ...(state.single?.post ? [state.single.post] : [])].find(x => x.id === id);
    const whose = p && p.userId !== state.user.id ? `${p.username}'s post` : "your post";
    if (!confirm(`Delete ${whose}? This can't be undone.`)) return;
    await api(`/api/posts/${id}`, { method: "DELETE" });
    const gone = list => list?.filter(x => x.id !== id);
    state.posts = gone(state.posts);
    if (state.postSearch?.posts) state.postSearch.posts = gone(state.postSearch.posts);
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
    // ⭐ Everyone's rating of Yakimma (from next to the Settings title), newest first. Only the creator gets these.
    const r = state.reports.ratings;
    const ratings = !r ? "" : `<section class="panel"><h2>⭐ Ratings</h2>` + (r.count
      ? `<p class="rating-average"><strong>${r.average.toFixed(1)} ⭐</strong> ${r.count === 1 ? "out of 5, from 1 person" : `out of 5, from ${r.count} people`}</p>` +
        r.list.map(x => `<div class="safety-row">${personLink(x.id, x.username, `${avatarHTML(x.avatar, "tiny")}<strong>${nameHTML(x.username)}</strong>`)}<span class="row"><span aria-label="${x.stars === 1 ? "1 star" : `${x.stars} stars`}">${"⭐".repeat(x.stars)}</span><small class="muted">${timeLabel(x.ratedAt)}</small></span></div>`).join("")
      : `<p class="muted">Nobody has rated Yakimma yet.</p>`) + `</section>`;
    return top + ratings + (posts + reportedComments || `<section class="panel empty">No reported posts or comments right now. 🎉</section>`);
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
  const untilText = s => new Date(s.until).toLocaleString(locales(), { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  // ---- 🚻 Boy or girl: everyone picks one, then does a face scan (the creator only picks). Until then Yakimma only
  // shows this page (and the rules). If the scan doesn't agree, or can't tell, the creator decides and they wait. ----
  const GENDERS = { boy: { icon: "💙", name: "Boy", zone: "Boys" }, girl: { icon: "💗", name: "Girl", zone: "Girls" } };
  function genderPage() {
    const waiting = GENDERS[state.user.genderWaiting], signOut = realKid() ? "" : `<button class="soft" id="logout">🚪 Sign out</button>`;
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
      `<div class="actions"><button class="primary" data-page="rules">📜 Read the rules</button>${realKid() ? "" : `<button class="soft" id="logout">🚪 Sign out</button>`}</div></section>`;
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
    if (d && v.tab === "chats") body = `<h3>👯 Friend chats</h3>${d.friends.map(c => `<div class="safety-row"><span class="row">${who(c.a)} <span aria-hidden="true">💬</span> ${who(c.b)}</span><span class="row"><small>${c.messages} message${c.messages === 1 ? "" : "s"}</small>${when(c.lastAt)}<button class="soft" data-safety-chat="${c.a.id}" data-with="${c.b.id}" data-title="${safe(nameText(c.a.username))} and ${safe(nameText(c.b.username))}">Open</button></span></div>`).join("") || `<p class="muted">No friend chats.</p>`}` +
      `<h3>🏘️ Group chats</h3>${d.groups.map(g => `<div class="safety-row"><strong>${safe(g.icon)} ${safe(g.name)}${g.secret ? " 🔐" : ""}</strong><span class="row"><small>${g.messages ? `${g.messages} message${g.messages === 1 ? "" : "s"}` : "No messages"}</small>${g.lastAt ? when(g.lastAt) : ""}<button class="soft" data-safety-group="${safe(g.key)}" data-title="${safe(g.icon)} ${safe(g.name)}">Open</button></span></div>`).join("") || `<p class="muted">No group chats.</p>`}`;
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
  // Any chat on the Safety page, without being in it: reading it tells nobody, and what you write shows to everyone in it
  // as a 🛡️ Creator note (it doesn't make you a member or their friend).
  async function openSafetyChat(query, title) {
    const d = await api(`/api/safety/chat?${query}`);
    const media = m => !m.mediaUrl ? "" : m.mediaType?.startsWith("video/") ? `<video class="chat-media" src="${safe(m.mediaUrl)}" controls playsinline preload="metadata"></video>` : `<img class="chat-media" src="${safe(m.mediaUrl)}" alt="">`;
    const msg = m => m.system ? `<div class="msg-note"><span>${safe(m.body)} · ${timeLabel(m.createdAt)}</span></div>`
      : m.deleted ? `<div class="msg"><div class="msg-body"><div class="bubble deleted"><span class="b-text">🚫 ${safe(nameText(m.username))} deleted a message</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`
      : `<div class="msg">${personLink(m.userId, m.username, avatarHTML(m.avatar, "tiny"))}<div class="msg-body"><div class="bubble"><strong>${nameHTML(m.username)}</strong>${media(m)}<span class="b-text">${safe(m.kind === "poll" ? "📊 " : m.kind === "event" ? "📅 " : "")}${richText(m.body)}</span><small>${timeLabel(m.createdAt)}</small></div></div></div>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal tagged-modal" role="dialog" aria-modal="true" aria-labelledby="safetyChatTitle"><div class="row between"><h2 id="safetyChatTitle">🛡️ ${safe(title)}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<p class="muted-note">Only you can read this here. Tap someone's picture to open their profile (and suspend them if you need to).</p><div class="chat-log">${d.messages.map(msg).join("") || `<p class="muted">No messages.</p>`}</div>` +
      `<form id="safetyChatForm" class="row nowrap chat-form"><label class="sr-only" for="safetyChatText">Write in this chat</label><input id="safetyChatText" maxlength="500" placeholder="Write as 🛡️ Creator…" autocomplete="off"><button class="primary" type="submit">Send</button></form>` +
      `<p class="muted-note">What you send shows to everyone in this chat as a 🛡️ Creator note. Reading it doesn't tell anyone.</p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#safetyChatForm").onsubmit = async e => {
      e.preventDefault();
      const text = $("#safetyChatText").value.trim();
      if (!text) return;
      try { await api("/api/safety/chat", send("POST", { ...Object.fromEntries(new URLSearchParams(query)), text })); await openSafetyChat(query, title); $("#safetyChatText").focus(); }
      catch (err) { toast(err.message, true); }
    };
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
  const postCopies = id => [state.posts, state.postSearch?.posts, state.groupView?.posts, state.person?.posts, state.playlist, state.myPosts?.posts, state.reports?.posts, state.single?.post && [state.single.post]]
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
  // 🔗 Each page has its own address (/Feed, /Profile, /Nails…) in the address bar, so it can be reloaded, bookmarked or
  // shared, and the browser's back and forward buttons go between pages. Someone's profile is /@username and a post is
  // /post/<code>. Capitals don't matter when opening one (/profile opens Profile too).
  const PAGE_PATHS = { feed: "Feed", create: "Upload", profile: "Profile", pictures: "Pictures", settings: "Settings", rules: "Rules", friends: "Friends", groups: "Groups", nails: "Nails", learn: "Learn", shop: "Shop", codes: "Codes", reports: "Reports", safety: "Safety", about: "About", ads: "Advertisement" };
  const pageAt = path => Object.keys(PAGE_PATHS).find(p => `/${PAGE_PATHS[p]}`.toLowerCase() === path.toLowerCase());
  const personAt = path => path.match(/^\/@([^/]+)$/)?.[1];
  // The next address replaces the one in the history instead of adding to it: on opening Yakimma, and on going back or
  // forward (so a page that's gone, like Settings after signing out, can't keep sending you back to it).
  let replacePath = true;
  function syncPath() {
    const path = state.page === "post" ? `/post/${state.postKey}` : state.page === "person" ? `/@${state.person.user.username}` : PAGE_PATHS[state.page] && `/${PAGE_PATHS[state.page]}`;
    if (!path) return;
    if (location.pathname !== encodeURI(path)) history[replacePath ? "replaceState" : "pushState"](null, "", encodeURI(path));
    replacePath = false;
  }
  // Going to another page (from the menu, a link, or back and forward): whatever was open on the last page closes.
  async function goTo(page, more = {}) {
    Object.assign(state, { page, createFrom: undefined, notice: "", codeWin: null, groupView: null, chat: null, kuchi: null, learn: null }, more);
    render(); await loadPageData(); render();
  }
  addEventListener("popstate", () => {
    replacePath = true;
    const name = personAt(location.pathname), post = location.pathname.match(/^\/post\/([A-Za-z0-9_~-]+)$/);
    (name ? openTag(decodeURIComponent(name)) : goTo(post ? "post" : pageAt(location.pathname) || "feed", post ? { postKey: post[1], single: null } : {}))
      .catch(err => toast(err.message, true));
  });
  function render() {
    applyTheme();
    syncMusic();
    wallet();
    if (pageGone(state.page) || (state.page === "reports" && !state.user?.admin) || (state.page === "safety" && !state.user?.creator)) state.page = "feed";
    if (state.page === "person" && !(state.user && state.person)) state.page = "friends";
    syncPath();
    document.querySelectorAll(".nav").forEach(b => { b.classList.toggle("active", b.dataset.page === state.page); b.hidden = pageGone(b.dataset.page) || (b.dataset.page === "reports" && !state.user?.admin) || (b.dataset.page === "safety" && !state.user?.creator); });
    navGroups();
    friendsBadge();
    $("#helpBtn").hidden = Boolean(state.chat);
    // In the 18+ zone, Kuchisake-onna takes the place of Nails.
    $('.nav[data-page="nails"]').textContent = !zoneOn() ? "💅 Nails" : crazyOn() ? "🤡 Kuchisake-onna" : "👹 Kuchisake-onna";
    screamButton();
    stalk();
    let html = "";
    if (state.user?.suspended && !state.user.creator && state.page !== "rules") {
      html = suspendedPage();
    } else if (state.user && !state.user.gender && state.page !== "rules") {
      html = genderPage();
    } else if (state.page === "feed") {
      const s = state.postSearch;
      html = `<div class="home-top"><p class="home-name">Mahdiya Faiza Manha</p><p class="home-email">Email me: <a href="mailto:manharuwycse@gmail.com">manharuwycse@gmail.com</a></p><button class="search-bar" id="postSearchBtn" title="Search posts" aria-pressed="${Boolean(s)}">🔎 <span class="search-bar-hint">Search Bar</span></button></div>` +
      (s ? postSearchPanel() + `<div class="feed">${(s.posts || []).map(postCard).join("")}</div>` :
      hero("The world you can show off", "Upload videos you already made, watch posts, and earn 10 MC when someone likes your post.", "WELCOME TO YAKIMMA") +
      `<section class="panel"><div class="row between"><div><h2>Welcome to your feed 🌸</h2><small>Be kind, be creative, and show off your style.</small></div><button class="primary" data-page="create">＋ Upload post</button></div></section>` + zoneBanner() +
      `<div class="feed">${zonePosts(state.posts).map(postCard).join("") || `<div class="panel empty">${crazyZone() === "adult" ? NO_CRAZY_POSTS : "No posts yet. Sign in and share the first one! 🌸"}</div>`}</div>`);
    } else if (state.page === "create") {
      html = hero("Upload your moment", "Choose a video you already made or a photo. Yakimma does not record videos inside the website.", "CREATE A POST") +
      `<section class="panel"><h2>Make a post</h2>${!state.user?`<p>Please sign in before posting.</p><button class="primary" id="openAuth">Sign in / Create account</button>`:`<form id="postForm"><label for="postType">Post type</label><select id="postType"><option value="video">Video</option><option value="photo">Photo</option><option value="text">Text only</option></select><label for="media">Choose an existing photo or video</label><input id="media" name="media" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"><small>Maximum 100 MB per file in this starter. Uploads are stored on the server running this app.</small><fieldset class="thumb-box" id="thumbBox" hidden><legend>🖼️ Thumbnail</legend><p class="muted-note">This picture shows on your video before it plays. We picked a moment for you. Change it if you like.</p>${thumbPickerHTML()}</fieldset><label for="caption">Caption</label><textarea id="caption" maxlength="240" rows="3" required placeholder="Write something fun..."></textarea>` +
        `<label for="description">Description <small>(optional)</small></label><textarea id="description" maxlength="2000" rows="5" placeholder="Tell people more about your post"></textarea>` +
        `<fieldset class="visibility"><legend>Who can see it?</legend>${VISIBILITY.map(([id, label, about], i) => `<label class="vis-option"><input type="radio" name="visibility" value="${id}" ${i ? "" : "checked"}><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
        `<fieldset class="visibility"><legend>Who is it for? <small>(you have to choose)</small></legend>${AUDIENCE.map(([id, label, about]) => `<label class="vis-option"><input type="radio" name="audience" value="${id}" required><span><strong>${label}</strong><small>${about}</small></span></label>`).join("")}</fieldset>` +
        `<div class="actions"><button class="primary" type="submit">Publish post ✨</button><button class="soft" type="button" data-page="${state.createFrom || "feed"}">Cancel</button></div></form>`}</section>`;
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
      `<section class="panel"><div class="posthead">${state.user?`<button class="avatar-edit" data-view-avatar="me" aria-label="See your profile picture">${avatarHTML(state.user.avatar,"big")}<span class="avatar-edit-badge" aria-hidden="true">🔍</span></button>`:avatarHTML(null,"big")}<div><h2 style="margin:0">${state.user?nameHTML(state.user.username):"Guest"}</h2><small>${state.user?`🔢 Account number ${state.user.accountNumber}`:"Browsing as a guest"}</small></div></div>${state.user?`<div class="row"><span class="pill">🐱 ${state.user.mc} MC</span><span class="pill">💌 ${state.user.lc} LC</span><span class="pill">🎁 ${state.inventory.length} items</span><span class="pill">👯 ${state.social.friends.length} friend${state.social.friends.length===1?"":"s"}</span>${identityPills(state.user)}${followPills(state.user.id, state.social.follows?.followers ?? 0, state.social.follows?.following ?? 0, state.user.username)}</div>${assistantLines(state.user, true)}<div class="actions"><button class="soft" id="editAvatarBtn">🎨 Change picture</button><button class="soft" id="changeUsername">✏️ Change Username</button>${state.user.admin?`<button class="soft" id="changeDisplayName">🪪 Display name</button>`:""}<button class="soft" id="emailBtn">📧 Email</button><button class="danger" id="logout">Sign out</button></div>`:`<button class="primary" id="openAuth">Create account / Sign in</button>`}</section>${state.user?linksPanel():""}${state.user?`<section class="panel"><h3>📲 Quick sign in</h3><p class="muted-note">Signing in on a new device? Tap <strong>📲 Quick sign in</strong> on it, then type the code it shows here and press <strong>✅ Confirm</strong>.</p><form class="quick-confirm" id="quickConfirmForm"><input id="quickConfirmCode" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code from new device" aria-label="Quick sign-in code from your new device"><button class="soft" type="submit">✅ Confirm</button></form></section>${deleteAccountPanel()}`:""}<section class="panel"><h3>My collection</h3>${state.inventory.length?[...state.products.filter(p=>state.inventory.includes(p.id)).map(p=>`${p.icon} ${safe(p.name)}`),...state.nailOptions.arts.filter(a=>a.item&&state.inventory.includes(a.item)).map(a=>`${a.icon} ${safe(a.name)} sticker`),...state.themes.filter(t=>t.gift&&state.inventory.includes(t.item)).map(t=>`${t.icon} ${safe(t.name)} theme`)].map(x=>`<span class="pill">${x}</span> `).join(""):`<p class="muted">Visit the shop to collect something cute.</p>`}</section>` +
      (state.user ? `<section class="panel"><h3>My nails 💅</h3>${receivedGallery(3)}</section>` + (crazyZone() === "adult" ? `<section class="panel"><p class="muted-note">${NO_CRAZY_POSTS}</p></section>` : playlistSection() + myPostsSection()) : "");
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
  // ---- 🤪 CRAZZZYYY MODE (the button next to Old Mode in ⚙️ Settings, kept in this browser). Arabic turns the whole
  // page around (no other language or zone does). Kuchisake-onna has a clown face. The 18+ zone and the
  // kiddy zone open straight away with no checks, as pretend zones that are only in this browser: the server still has
  // you in the normal site, so nobody gets the real 18+ zone's posts and chats, or out of a real kiddy zone. The pretend
  // 18+ zone is open to everyone, so it has no posts at all. ----
  const CRAZY_KEY = "yakimma.crazy", CRAZY_ZONE_KEY = "yakimma.crazyZone";
  const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const crazyOn = () => stored(CRAZY_KEY) === "on";
  const realZone = () => Boolean(state.user?.adult?.on), realKid = () => Boolean(state.user?.kid?.on);
  // "adult", "kid" or null. Someone in a real zone stays in it.
  const crazyZone = () => crazyOn() && state.user && !realZone() && !realKid() ? stored(CRAZY_ZONE_KEY) : null;
  const zoneOn = () => realZone() || crazyZone() === "adult";
  const NO_CRAZY_POSTS = "🤪 There are no posts in CRAZZZYYY MODE's 18+ zone, because it's open to everyone.";
  // In CRAZZZYYY MODE everything is fast: the page scrolls CRAZY_SCROLL times farther for the same turn of the mouse
  // wheel, and CRAZY_SWIPE times farther for a swipe on a phone. Chats, pop-ups and the call screen still scroll normally,
  // so you can read them.
  const CRAZY_SCROLL = 5, CRAZY_SWIPE = 3;
  let crazyTouchY = null;
  // Whether something inside the page (a chat, a pop-up, a list) should scroll instead of the page.
  function scrollsItself(el, down) {
    if ($("#modalroot")?.children.length || (callNow && !callNow.minimized)) return true;
    for (let n = el instanceof Element ? el : null; n && n !== document.body; n = n.parentElement) {
      const y = getComputedStyle(n).overflowY;
      if ((y === "auto" || y === "scroll") && n.scrollHeight > n.clientHeight + 1 && (down ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0)) return true;
    }
    return false;
  }
  document.addEventListener("wheel", e => {
    if (!crazyOn() || e.ctrlKey || !e.deltaY || scrollsItself(e.target, e.deltaY > 0)) return;
    e.preventDefault();
    // The wheel can count in pixels, lines or pages.
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    window.scrollBy({ top: px * CRAZY_SCROLL, behavior: "instant" });
  }, { passive: false });
  document.addEventListener("touchstart", e => { crazyTouchY = crazyOn() && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (crazyTouchY === null || !crazyOn()) return;
    const y = e.touches[0].clientY, dy = crazyTouchY - y;
    if (!dy || scrollsItself(e.target, dy > 0)) return;
    e.preventDefault();
    crazyTouchY = y;
    window.scrollBy({ top: dy * CRAZY_SWIPE, behavior: "instant" });
  }, { passive: false });
  const zonePosts = posts => crazyZone() === "adult" ? [] : posts;
  const kidOn = () => realKid() || crazyZone() === "kid";
  // Pages guests don't see, pages that aren't in the 18+ zone or the kiddy zone, and pages that are only in the kiddy
  // zone: they leave the menu, and links to them say so instead of opening them. In CRAZZZYYY MODE, Advertisement is
  // in the 18+ zone and the pretend kiddy zone too (but never in a real kiddy zone, which a parent set up).
  const GUEST_GONE = ["pictures", "settings", "codes", "reports", "safety"], ZONE_GONE = ["about", "ads"];
  const KID_GONE = ["ads", "reports", "safety"], KID_ONLY = ["learn"];
  const crazyAds = page => page === "ads" && crazyOn() && !realKid();
  const pageGone = page => !crazyAds(page) && ((!state.user && GUEST_GONE.includes(page)) || (zoneOn() && ZONE_GONE.includes(page)) || (crazyZone() === "adult" && page === "create")
    || (kidOn() ? KID_GONE.includes(page) : KID_ONLY.includes(page)));
  const goneNote = page => !state.user && GUEST_GONE.includes(page) ? `🔐 Sign in to use ${PAGE_NAMES[page]}.`
    : crazyZone() === "adult" && page === "create" ? NO_CRAZY_POSTS
    : kidOn() ? `🧸 ${PAGE_NAMES[page]} isn't in the kiddy zone.` : KID_ONLY.includes(page) ? `🧸 ${PAGE_NAMES[page]} is only in the kiddy zone.`
    : `🔞 ${PAGE_NAMES[page]} isn't in the 18+ zone. Turn 18+ off in ⚙️ Settings to use it.`;
  // Turning the zone on or off changes what you see everywhere, so everything is loaded again.
  async function zoneChanged(user) {
    Object.assign(state, { user, chat: null, groupView: null, salon: null, groups: null, myPosts: null, playlist: null, kuchi: null, learn: null, person: null, friendSearch: null, people: null, postSearch: null });
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
      confirm: `<p>The 18+ zone is only for grown-ups. In it you only see 18+ posts and groups, and you can only add people who are 18+. You can still talk to the friends you already have.</p><p><strong>Only go on if you are 18 or older.</strong></p><div class="actions"><button class="primary" id="adultYes">I'm 18 or older</button><button class="soft" id="adultCancel">Cancel</button></div>`,
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
      confirm: `<p>The kiddy zone is a safe part of Yakimma for kids. In it you only see posts made in the kiddy zone, you can only add and talk to friends who are in it too, and you have Feed, Profile, Pictures, Settings, Rules, Friends, Groups (only ones made in the kiddy zone), Nails, Learn, the Shop, Codes, About The Creator and 🔔 notifications.</p>` +
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
  // The creator changing someone else's username (free). They get a 🔔 with the new one, since they sign in with it.
  function renameModal(id, username) {
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="renameTitle"><div class="row between"><h2 id="renameTitle">✏️ Change Username · <span translate="no">@${safe(username)}</span></h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `<form id="renameForm"><label for="renameInput">New username</label><input id="renameInput" maxlength="20" autocomplete="off" required value="${safe(username)}">` +
      `<p class="muted-note">Only letters and numbers, 3 to 20 of them, with no spaces.</p><p class="muted-note">They'll get a 🔔 with their new username, since they sign in with it.</p>` +
      `<div class="actions"><button class="primary" type="submit">Change it</button></div></form><p class="muted-note error-text" id="renameError" role="alert"></p></section></div>`;
    $("#closeModal").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    $("#renameForm").onsubmit = async e => {
      e.preventDefault();
      const name = $("#renameInput").value.trim();
      try { await api(`/api/users/${id}/username`, send("PUT", { username: name })); closeModal(); await openPerson(id); toast(`Their username is now ${name} ✏️`); }
      catch (err) { $("#renameError").textContent = err.message; }
    };
    $("#renameInput").select();
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
    ["🔐", "Keep private things private", "Never share your password, your address or your school."],
    ["🙅", "Be yourself", "Don't pretend to be someone else, and don't copy other people's usernames."],
    ["📸", "Only post what's yours", "Post photos and videos you made, or that you're allowed to share."],
    ["📢", "No spam", "Don't post the same thing again and again, or beg people for likes or MC."],
    ["🚩", "Report it, don't fight it", "If you see something bad, tap 🚩 Report and the admins will look at it."],
    ["🤥", "False reporting can cause suspensions", "Be careful! Lying is bad!", "It can cause a suspension."],
    ["🖼️", "Do not Copy", "If seen copying the Creator's Profile Picture can cause a suspension!", "It can cause a 5-day suspension for impersonation."],
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
  async function signedOut(message = "You're signed out. See you soon! 👋") {
    hangUp();
    await pushUnsubscribe().catch(() => {});
    Object.assign(state, { groupView: null, chat: null, myPosts: null, playlist: null, pictures: null, learn: null, person: null, friendSearch: null, people: null, postSearch: null });
    await refresh();
    state.page = "feed";
    toast(message);
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
    const level = learnInfo().levels[subject], seen = new Map(), step = level.region === "asia" ? 1 : -1;
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
  // 🤪 In CRAZZZYYY MODE's kiddy zone (a pretend zone, only in this browser), nobody chooses your lessons: you learn
  // whatever subject and class you want, with no parent. The faith subjects still only open for accounts of that
  // religion. The classes are kept in this browser, not on the account. A real kiddy zone always has its parent.
  const crazyLearn = () => crazyZone() === "kid", crazyLearnKey = () => `yakimma.crazyLearn.${state.user?.id}`;
  function learnInfo() {
    if (!crazyLearn()) return state.learnData;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(crazyLearnKey())); } catch {}
    return { verified: LEARN_SUBJECTS.filter(x => x.who).map(x => x.id), levels: saved?.levels || {} };
  }
  function saveCrazyLevel(subject, grade, region) {
    const levels = { ...learnInfo().levels, [subject]: { grade, region } };
    try { localStorage.setItem(crazyLearnKey(), JSON.stringify({ levels })); } catch {}
  }
  function learnPage() {
    const top = hero("Learn! 📚", "Pick a subject and play a quiz made for your class.", "LEARN & PLAY"), L = state.learn ||= {};
    if (L.quiz) return top + quizView(L.quiz);
    if (L.subject) return top + subjectView(L.subject);
    const card = s => {
      const locked = learnLocked(s), level = learnInfo().levels[s.id];
      const note = locked ? `🔒 Only if your religion is ${s.name}` : !crazyLearn() && s.note && (state.learnData.verified.includes(s.id) ? "✅ Verified by a parent" : s.note);
      return `<button class="learn-subject" data-learn-subject="${s.id}" ${locked ? "disabled" : ""}><span class="learn-icon" aria-hidden="true">${s.icon}</span><strong>${s.name}</strong>` +
        `${note ? `<small>${note}</small>` : ""}${level ? `<small>${levelLabel(level)}</small>` : ""}</button>`;
    };
    return top + `<section class="panel"><h2>Which subject do you want to learn?</h2><div class="learn-subjects">${LEARN_SUBJECTS.map(card).join("")}</div></section>`;
  }
  function subjectView(id) {
    const s = LEARN_SUBJECTS.find(x => x.id === id), level = learnInfo().levels[id];
    const body = state.learn.unlocked === id
      ? `<h3>Which class are you in?</h3><div class="grade-list">${Array.from({ length: 9 }, (_, i) => `<button class="${level?.grade === i + 1 ? "primary" : "soft"}" data-learn-grade="${i + 1}">Class ${i + 1}</button>`).join("")}</div>`
      : level ? `<p>You're learning <strong>${levelLabel(level)}</strong>.</p><div class="actions"><button class="primary" data-learn-start>▶ Start the quiz</button><button class="soft" data-learn-unlock>${crazyLearn() ? "Change class" : "🔒 Change class"}</button></div>`
      : `<p>${crazyLearn() ? "🤪 In CRAZZZYYY MODE, nobody chooses your lessons. Learn what you want!" : "A parent chooses your class with the parent password."}</p><button class="primary" data-learn-unlock>${crazyLearn() ? "Choose your class" : "🔒 Choose your class"}</button>`;
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
    // English answers are the English being learned, so they stay in English whatever language Yakimma is in.
    const keep = q.subject === "english" ? ' translate="no"' : "";
    return `<section class="panel learn-quiz"><div class="row between">${title}<small>Question ${q.at + 1} of ${total} · ⭐ ${q.score}</small></div><p class="learn-question">${safe(item.q)}</p>${item.pic || ""}` +
      `<div class="learn-choices">${item.choices.map((c, i) => `<button class="learn-choice ${answered && c === item.right ? "right" : answered && i === q.picked ? "wrong" : ""}" data-learn-choice="${i}" ${answered ? "disabled" : ""}${keep}>${safe(c)}</button>`).join("")}</div>` +
      (answered ? `<p class="learn-feedback" role="status">${gotIt ? "✅ Correct! Well done!" : `❌ Not quite. The answer is <strong${keep}>${safe(item.right)}</strong>.`}</p>` +
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
    if (state.user.admin || crazyLearn()) return submit({}).catch(err => toast(err.message, true));
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
    if (!s.who || learnInfo().verified.includes(id)) return open();
    askParent(`${s.icon} Verify by a parent`, `Parent: if your child is ${s.who}, type the parent password or scan your face to open ${s.name}.`, async proof => {
      state.learnData = await api(`/api/learn/${id}/verify`, send("POST", proof));
      closeModal(); open();
    }, { face: true });
  }
  function unlockGrades() {
    askParent("🔒 Choose your class", "Parent: type the parent password to choose the class.", async proof => {
      if (!crazyLearn()) await api("/api/kid/check", send("POST", proof));
      closeModal(); state.learn.unlocked = state.learn.subject; render();
    });
  }
  // After a class is picked: where the child is from, then the parent password to save both and start the quiz.
  function regionModal(subject, grade) {
    learnModal("Are you from?", `<div class="grade-list"><button class="soft" data-learn-region="asia">🌏 Asia?</button><button class="soft" data-learn-region="western">🌍 Western?</button></div>`);
    for (const btn of document.querySelectorAll("[data-learn-region]")) btn.onclick = () => {
      const region = btn.dataset.learnRegion;
      askParent(REGION_NAMES[region], `Parent: type the parent password to confirm Class ${grade}, from ${region === "asia" ? "Asia" : "the West"}.`, async proof => {
        if (crazyLearn()) saveCrazyLevel(subject, grade, region);
        else state.learnData = await api(`/api/learn/${subject}`, send("PUT", { grade, region, ...proof }));
        closeModal(); state.learn.unlocked = null; await startQuiz(subject);
      });
    };
  }

  // ---- Kuchisake-onna 👹: in the 18+ zone she takes the place of Nails. ----
  const SCREAM_KEY = "yakimma.scream";
  let screamOff = false;
  try { screamOff = localStorage.getItem(SCREAM_KEY) === "off"; } catch {}
  const KUCHI_ANGRY = { angry: true, ja: "一体どういうクソみたいな答えだよ？", en: "WHAT KIND OF FUCKING ANSWER IS THAT?" };
  // 🤪 In CRAZZZYYY MODE anyone can walk into the 18+ zone, so the clown keeps it clean when she's angry.
  const CLOWN_ANGRY = { angry: true, ja: "なんだその答えは？！", en: "WHAT KIND OF ANSWER IS THAT?! 🤡" };
  const CLOWN_BYE = { ja: "オッケー、バイバーイ！いい一日を！", en: "OK, Byeee have a great day!" };
  const KUCHI = {
    ask: { masked: true, ja: "私は美しいですか？", en: "Am I beautiful?", answers: true },
    smile: { masked: false, ja: "こんな感じでも？", en: "Even like this?", answers: true },
    angry: { masked: true, ...KUCHI_ANGRY },
    angrySmile: { masked: false, ...KUCHI_ANGRY },
    bye: { masked: false, ja: "そうか、次はうまくいくといいね。", en: "Ok, better luck next time." }
  };
  const kuchiLine = step => !crazyOn() ? KUCHI[step] : { ...KUCHI[step], ...(KUCHI[step].angry ? CLOWN_ANGRY : step === "bye" ? CLOWN_BYE : {}) };
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
    const k = state.kuchi ||= { step: "ask" }, line = kuchiLine(k.step);
    const clown = crazyOn();
    return hero(clown ? "Kuchisake-onna 🤡" : "Kuchisake-onna 👹", clown ? "A woman in a mask stops you in a Carnival. She has a question for you…" : "A woman in a mask stops you on a dark street. She has a question for you…", clown ? "THE CLOWN-FACED WOMAN" : "THE SPLIT-MOUTHED WOMAN") +
      `<section class="panel kuchi"><div class="kuchi-stage ${k.screaming ? "screaming" : ""}">${kuchiSVG(line, k.step === "smile")}</div>` +
      `<div class="kuchi-talk" role="status"><p class="kuchi-ja" lang="ja">${line.ja}</p><p class="kuchi-en">(${line.en})</p></div>` +
      `<div class="actions kuchi-answers">${line.answers ? `<button class="primary" data-kuchi="yes"><span lang="ja">はい</span> (Yes)</button><button class="soft" data-kuchi="no"><span lang="ja">いいえ</span> (No)</button>` : `<button class="soft" data-kuchi="again">Meet her again…</button>`}</div>` +
      `<p class="muted-note kuchi-note">${screamOff ? "🔇 Scary sounds are off. Tap 👹 at the top to turn them back on." : "🔊 She screams! Tap 👹 at the top to turn scary sounds off."}</p>` +
      (stalked() ? `<p class="muted-note kuchi-note">Something very tall is following you now… <span lang="ja">ぽ…ぽ…ぽ…</span><br>To make her leave, turn 18+ off in ⚙️ Settings and take ${HACHI_PHOTOS} photos of nails with 📷 (${countOf("nailphotos")} of ${HACHI_PHOTOS} so far). Your nails are in 💅 Nails and on your 🌷 Profile.</p>` : "") +
      // Where the idea came from. The link starts the video at 4:20.
      `<p class="muted-note kuchi-note">Credit: I got this from <a href="https://www.youtube.com/watch?v=dl4YQr4C-H0&amp;t=260s" target="_blank" rel="noopener noreferrer">https://www.youtube.com/watch?v=dl4YQr4C-H0</a> (go to 4:20).</p></section>`;
  }
  // Her picture: a dark street, long black hair, a red coat and a white mask… or what's under it. `drop` animates the mask coming down.
  // 🤪 In CRAZZZYYY MODE she's a clown: white face paint, blue diamonds round her eyes, a red nose, rainbow puffs of
  // hair, pom-poms on her coat and a huge painted smile (a frown when she's angry) instead of the cut mouth.
  function kuchiSVG(line, drop) {
    const clown = crazyOn(), iris = line.angry ? "#e0001b" : "#140708";
    const eye = x => `<path d="M${x-17} 160Q${x} 147 ${x+17} 160Q${x} 170 ${x-17} 160Z" fill="#efe8e1"/><circle cx="${x}" cy="159.5" r="6.5" fill="${iris}"/><circle cx="${x+2}" cy="157.5" r="1.6" fill="#fff" opacity=".8"/><path d="M${x-15} 168Q${x} 176 ${x+15} 168" stroke="#6e4752" stroke-width="2.5" fill="none" opacity=".55"/>`;
    const brows = line.angry ? `<path d="M117 139L152 152M203 139L168 152" stroke="#0b0709" stroke-width="5" stroke-linecap="round"/>` : `<path d="M120 145Q135 138 151 144M169 144Q185 138 200 145" stroke="#0b0709" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
    // Points along a curve from cheek (104, 194) to cheek (216, 194), bending towards (160, y): for the lips and teeth.
    const lip = (y, s) => [(1-s)*(1-s)*104 + 2*(1-s)*s*160 + s*s*216, (1-s)*(1-s)*194 + 2*(1-s)*s*y + s*s*194];
    const teeth = (y, dir) => Array.from({ length: 13 }, (_, i) => { const [x, ty] = lip(y, 0.1 + i * 0.8 / 12); return `<path d="M${x-3.4} ${ty}L${x+3.4} ${ty}L${x} ${ty+dir*8}Z" fill="#f4eee0"/>`; }).join("");
    const low = line.angry ? 300 : 246;
    const mouth = `<path d="M104 194Q160 214 216 194Q160 ${low} 104 194Z" fill="#2a0004" stroke="#7a0012" stroke-width="2"/>${teeth(214, 1)}${teeth(low, -1)}` +
      `<path d="M104 194L93 185M216 194L227 185" stroke="#7a0012" stroke-width="3" stroke-linecap="round"/><path d="M96 183l4 6M100 186l-6 1M224 183l-4 6M220 186l6 1" stroke="#3a0006" stroke-width="1.4"/>` +
      `<path d="M106 197q2 9 0 15M214 197q-2 9 0 15" stroke="#9a0016" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
    const clownMouth = line.angry
      ? `<path d="M100 222Q160 184 220 222Q160 204 100 222Z" fill="#e8112d"/><path d="M118 214Q160 194 202 214Q160 204 118 214Z" fill="#4a000c"/><path d="M100 222q-6 3 -7 11M220 222q6 3 7 11" stroke="#e8112d" stroke-width="4" stroke-linecap="round" fill="none"/>`
      : `<path d="M100 192Q160 222 220 192Q160 262 100 192Z" fill="#e8112d"/><path d="M118 204Q160 226 202 204Q160 240 118 204Z" fill="#4a000c"/><path d="M124 207Q160 226 196 207Q160 222 124 207Z" fill="#fff"/>` +
        `<ellipse cx="160" cy="226" rx="11" ry="4" fill="#ff6f91"/><path d="M100 192q-8 -4 -8 -12M220 192q8 -4 8 -12" stroke="#e8112d" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    const paint = `<ellipse cx="160" cy="172" rx="57" ry="71" fill="#fffefc"/>` + [136, 184].map(x => `<path d="M${x} 132L${x+12} 160L${x} 190L${x-12} 160Z" fill="#3f7cff" opacity=".9"/>`).join("") +
      `<circle cx="114" cy="196" r="10" fill="#ff8fb1" opacity=".7"/><circle cx="206" cy="196" r="10" fill="#ff8fb1" opacity=".7"/>`;
    const nose = `<circle cx="160" cy="180" r="12" fill="#e8112d"/><circle cx="156" cy="175" r="3.5" fill="#fff" opacity=".75"/>`;
    const puffs = [[96, 104, "#ff7a00"], [83, 128, "#ffd400"], [88, 153, "#2ecc71"], [224, 104, "#3f7cff"], [237, 128, "#c158ff"], [232, 153, "#ff3d7f"]].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="16" fill="${c}"/>`).join("");
    const pompoms = `<circle cx="160" cy="350" r="8" fill="#ffd400"/><circle cx="160" cy="372" r="8" fill="#3f7cff"/>`;
    const maskOn = `<path d="M106 186Q160 172 214 186L210 236Q160 262 110 236Z" fill="#f2f2ef" stroke="#c9c9c4" stroke-width="1.5"/><path d="M110 202Q160 192 210 202M111 216Q160 208 209 216M113 229Q160 222 207 229" stroke="#d2d2cc" stroke-width="2" fill="none"/><path d="M106 190Q96 178 102 162M214 190Q224 178 218 162" stroke="#e4e4df" stroke-width="2.5" fill="none"/>`;
    const maskDown = `<g class="${drop ? "kuchi-drop" : ""}"><path d="M120 250Q160 266 200 250L196 270Q160 286 124 270Z" fill="#f2f2ef" stroke="#c9c9c4" stroke-width="1.5"/><path d="M123 260Q160 274 197 260" stroke="#d2d2cc" stroke-width="2" fill="none"/><path d="M120 253Q100 220 102 170M200 253Q220 220 218 170" stroke="#e4e4df" stroke-width="2.5" fill="none"/></g>`;
    const label = clown ? (line.masked ? "A clown with long black hair, a red nose and a white mask over her mouth" : "The clown with her mask pulled down, showing a huge painted smile")
      : line.masked ? "A pale woman with long black hair and a white mask over her mouth" : "The woman with her mask pulled down, showing a mouth cut from ear to ear";
    return `<svg viewBox="0 0 320 380" role="img" aria-label="${label}">` +
      `<defs><linearGradient id="kuchiNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160a0d"/><stop offset="1" stop-color="#040203"/></linearGradient><radialGradient id="kuchiLamp" cx="0.85" cy="0.08" r="0.55"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".35"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient><radialGradient id="kuchiSkin" cx="0.5" cy="0.4" r="0.6"><stop offset="0.55" stop-color="#ece4dd"/><stop offset="1" stop-color="#bdaea6"/></radialGradient></defs>` +
      `<rect width="320" height="380" fill="url(#kuchiNight)"/><rect width="320" height="380" fill="url(#kuchiLamp)"/><path d="M262 0V120" stroke="#2a1d1f" stroke-width="6"/><circle cx="262" cy="34" r="9" fill="#ffd9a0" opacity=".85"/>` +
      `<path d="M40 380Q60 292 132 272L160 302L188 272Q260 292 280 380Z" fill="#4d0b13"/><path d="M132 272L160 336L150 380M188 272L160 336L170 380" stroke="#2a0509" stroke-width="3" fill="none"/>${clown ? pompoms : ""}` +
      `<g class="kuchi-head"><path d="M88 124Q92 58 160 56Q228 58 232 124L248 330Q160 352 72 330Z" fill="#0b0709"/><rect x="141" y="226" width="38" height="56" fill="#d9cfc8"/>` +
      `<ellipse cx="160" cy="170" rx="60" ry="76" fill="url(#kuchiSkin)"/>${clown ? paint : ""}${eye(136)}${eye(184)}${brows}${clown ? "" : `<path d="M160 168v14" stroke="#b9aaa2" stroke-width="2" stroke-linecap="round"/>`}` +
      (line.masked ? maskOn : `<g class="${drop ? "kuchi-reveal" : ""}">${clown ? clownMouth : mouth}</g>${maskDown}`) + (clown ? nose : "") +
      `<path d="M98 140Q100 80 160 78Q220 80 222 140Q206 110 190 133Q176 108 160 128Q144 108 130 133Q114 110 98 140Z" fill="#0b0709"/><path d="M100 128Q90 210 102 312L90 312Q78 210 92 126ZM220 128Q230 210 218 312L230 312Q242 210 228 126Z" fill="#0b0709"/>${clown ? puffs : ""}</g>` +
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
    her.innerHTML = crazyOn() ? chickenSVG() : hachiSVG();
    document.body.append(her);
    setTimeout(() => her.remove(), 5600);
    if (!warn) return;
    $(".hachi-warn")?.remove();
    const note = document.createElement("div");
    note.className = "hachi-warn";
    note.setAttribute("role", "alert");
    note.innerHTML = `${crazyOn() ? "🐔 Hachishakusama IS FOLLOWING YOU!! 🐔" : "⚠️ Hachishakusama IS STALKING YOU!! ⚠️"}<small lang="ja">ぽ…ぽ…ぽ… (po… po… po…)</small>`;
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
  // 🤪 In CRAZZZYYY MODE she's a girl in a very tall chicken mascot costume: a red comb, big cartoon eyes and a beak on
  // the hood, wings and orange chicken feet, and her own smiling face looking out of the hood.
  function chickenSVG() {
    const foot = x => `<path d="M${x} 560V612" stroke="#ff9f1a" stroke-width="7"/><path d="M${x} 612l-15 10M${x} 612v15M${x} 612l15 10" stroke="#ff9f1a" stroke-width="6" stroke-linecap="round"/>`;
    return `<svg viewBox="0 0 160 640">${foot(64)}${foot(96)}` +
      `<path d="M30 210Q18 420 40 560Q80 592 120 560Q142 420 130 210Q80 178 30 210Z" fill="#fff3b0"/><path d="M50 300q10 12 20 0q10 12 20 0q10 12 20 0M46 360q11 12 22 0q11 12 22 0q11 12 22 0M48 420q11 12 22 0q11 12 22 0q11 12 22 0" stroke="#f2d66b" stroke-width="3" fill="none"/>` +
      `<path d="M33 236Q0 330 20 430Q44 390 46 300Z" fill="#ffe680"/><path d="M127 236Q160 330 140 430Q116 390 114 300Z" fill="#ffe680"/>` +
      `<path d="M58 54Q58 22 72 36Q76 12 89 32Q98 14 104 40Q116 34 106 58Z" fill="#e8112d"/><path d="M52 160h56v64H52z" fill="#fff3b0"/><ellipse cx="80" cy="118" rx="56" ry="66" fill="#fff3b0"/>` +
      `<circle cx="61" cy="80" r="10" fill="#fff"/><circle cx="99" cy="80" r="10" fill="#fff"/><circle cx="63" cy="81" r="5" fill="#1b1416"/><circle cx="97" cy="81" r="5" fill="#1b1416"/>` +
      `<path d="M66 92Q80 86 94 92L80 110Z" fill="#ff9f1a"/>` +
      `<ellipse cx="80" cy="144" rx="24" ry="26" fill="#f7d9c4" stroke="#f2d66b" stroke-width="3"/><path d="M57 142Q58 119 80 119Q102 119 103 142Q94 129 86 135Q80 125 74 135Q66 129 57 142Z" fill="#3a2418"/>` +
      `<path d="M67 148q4 -5 8 0M85 148q4 -5 8 0" stroke="#2a1a14" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="64" cy="156" r="4.5" fill="#ff8fb1" opacity=".75"/><circle cx="96" cy="156" r="4.5" fill="#ff8fb1" opacity=".75"/>` +
      `<path d="M69 156Q80 172 91 156Z" fill="#8a1c2b"/><path d="M71 157Q80 160 89 157" stroke="#fff" stroke-width="2.5"/></svg>`;
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
    // below: it goes right under the ad before it (Follow Me On YouTube), not beside it. See .ad-below in style.css.
    { icon: "👾", title: "Join The Galaxy Cuties!", name: "Discord", url: "https://discord.com/channels/1369922723475624009/1369922728240615466", below: true },
    { icon: "📲", title: "Install This App!", name: "Fax Hero: Send Fax from iPhone", url: "https://apps.apple.com/us/app/fax-hero-send-fax-from-iphone/id6670707717" },
    { icon: "🌌", title: "Play My Sekai Games!", name: "Sekai", url: "https://sekai.ai/?creator=18041026" }
  ];
  function adsPage() {
    return hero("Advertisement 🎉", "", "ADVERTISEMENT") +
      `<div class="ads">${ADS.map(a => `<article class="panel ad${a.below ? " ad-below" : ""}"><div class="ad-icon" aria-hidden="true">${a.icon}</div><h2>${safe(a.title)}</h2><p class="muted-note">${safe(a.name)}</p>` +
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
        syncPush();
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
  // ---- 🗑️ Deleting your account, on your Profile under Quick sign in: "Are you sure?", then a code emailed to you (in
  // the kiddy zone, to the parent), then it's gone. Admins can delete theirs too (being an admin goes with it); only the
  // creator's account can't be deleted. ----
  const deleteAccountPanel = () => `<section class="panel"><h3>🗑️ Delete account</h3>` + (state.user.creator
    ? `<p class="muted-note">The creator's account can't be deleted.</p></section>`
    : `<p class="muted-note">This deletes your account and everything on it: your posts, pictures, friends, chats, MC, LC and the groups you made. It can't be undone.</p><button class="danger" id="deleteAccountBtn">🗑️ Delete my account</button></section>`);
  function deleteAccountModal(step = "sure", info = {}) {
    const kid = realKid(), to = kid ? "the parent's email" : `<strong>${safe(state.user.email)}</strong>`;
    const body = step === "sure"
      ? `<p><strong>Are you sure?</strong> Your account and everything on it will be deleted: your posts, pictures, friends, chats, MC, LC and the groups you made. This can't be undone.</p>` +
        (!kid && !state.user.email ? `<p>To make sure it's really you, we email you a code, so add your email first.</p><div class="actions"><button class="primary" id="deleteAddEmail">📧 Add my email</button><button class="soft" id="deleteKeep">No, keep my account</button></div>`
          : `<p>To make sure it's really you, we'll email a code to ${to}.</p><div class="actions"><button class="danger" id="deleteSendCode">Yes, send the code</button><button class="soft" id="deleteKeep">No, keep my account</button></div>`)
      : `<p>${info.testCode ? `Email isn't set up on this computer, so here's the code instead: <strong class="code-tag">${safe(info.testCode)}</strong>` : `We sent a code to ${to}. It works for 10 minutes.`} Typing it deletes your account.</p>` +
        `<form id="deleteCodeForm"><label for="deleteCode">6-digit code</label><input id="deleteCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><div class="actions"><button class="danger" type="submit">🗑️ Delete my account</button><button class="soft" type="button" id="deleteKeep">No, keep my account</button></div></form>`;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="deleteTitle"><div class="row between"><h2 id="deleteTitle">🗑️ Delete your account</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      `${body}<p class="muted-note error-text" id="deleteError" role="alert"></p></section></div>`;
    const fail = err => { $("#deleteError").textContent = err.message; };
    $("#closeModal").onclick = $("#deleteKeep").onclick = closeModal;
    $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
    if (step === "sure") {
      if ($("#deleteAddEmail")) $("#deleteAddEmail").onclick = () => emailModal();
      if ($("#deleteSendCode")) $("#deleteSendCode").onclick = async () => {
        // The button waits while the email is sent, so pressing it again can't send a second code.
        const btn = $("#deleteSendCode"); btn.disabled = true; btn.textContent = "Sending…";
        try { const d = await api("/api/me/delete", send("POST", { confirm: true })); deleteAccountModal("code", { testCode: d.testCode }); }
        catch (err) { fail(err); btn.disabled = false; btn.textContent = "Yes, send the code"; }
      };
      return;
    }
    $("#deleteCodeForm").onsubmit = async e => {
      e.preventDefault();
      try { await api("/api/me/delete/code", send("POST", { code: $("#deleteCode").value })); closeModal(); await signedOut("Your account is deleted. Goodbye! 👋"); }
      catch (err) { fail(err); }
    };
    $("#deleteCode").focus();
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
  // Your profile picture, or someone else's when the creator changes it (them: their id, username, avatar and admin).
  function openAvatarEditor(them = null) {
    const o = state.avatarOptions, who = them || state.user, current = who.avatar, C = 480, base = them ? `/api/users/${them.id}/avatar` : "/api/me/avatar";
    const title = them ? `🎨 Change picture · <span translate="no">@${safe(them.username)}</span>` : "🎨 Your profile picture";
    if (current.fixed) {
      $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatarTitle"><div class="row between"><h2 id="avatarTitle">${title}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
        `<div class="avatar-preview">${avatarHTML(current, "huge")}</div><p class="notice">🔒 Your profile picture is fixed, so it can't be changed.</p></section></div>`;
      $("#closeModal").onclick = closeModal;
      $("#modalback").onclick = e => { if (e.target.id === "modalback") closeModal(); };
      return;
    }
    let emoji = current.emoji, bg = current.bg, img = null, zoom = 1, ox = 0, oy = 0;
    $("#modalroot").innerHTML = `<div class="modalback" id="modalback"><section class="modal avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatarTitle"><div class="row between"><h2 id="avatarTitle">${title}</h2><button class="soft" id="closeModal" aria-label="Close">✕</button></div>` +
      (!them && state.user.admin ? `<p class="muted-note">🛠️ You're an admin, so you can pick 🛠️ too. Nobody else can.</p>` : "") +
      `<div class="row"><button type="button" id="tabEmoji">🌷 Emoji avatar</button><button type="button" id="tabPhoto">📷 Photo</button></div>` +
      `<div id="emojiPane"><div class="avatar-preview" id="emojiPreview"></div><h3>Pick a character</h3><div class="emoji-grid">${[...(who.admin ? [o.adminEmoji] : []), ...o.emojis].map(e => `<button type="button" class="emoji-pick" data-av-emoji="${safe(e)}" aria-label="${safe(e)}">${safe(e)}</button>`).join("")}</div>` +
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
    const saved = async (d, message) => {
      closeModal();
      if (them) { await openPerson(them.id); return toast("Profile picture updated! 📸"); }
      state.user = d.user; await refresh(); await loadPageData(); toast(message);
    };
    $("#savePhoto").onclick = async () => {
      // Re-drawing at 400×400 keeps uploads small and strips hidden photo data such as location.
      const out = document.createElement("canvas"); out.width = out.height = 400;
      out.getContext("2d").drawImage(canvas, 0, 0, 400, 400);
      const blob = await new Promise(r => out.toBlob(r, "image/jpeg", 0.9));
      const body = new FormData(); body.append("photo", blob, "avatar.jpg");
      $("#savePhoto").disabled = true;
      try { await saved(await api(`${base}-photo`, { method: "POST", body }), "Profile picture updated! 📸"); }
      catch (err) { fail(err.message); $("#savePhoto").disabled = false; }
    };
    if ($("#removePhoto")) $("#removePhoto").onclick = async () => {
      try { await saved(await api(`${base}-photo`, { method: "DELETE" }), "Photo removed. Your emoji avatar is back! 🌷"); } catch (err) { fail(err.message); }
    };
    $("#saveEmojiAvatar").onclick = async () => {
      try { await saved(await api(base, send("PUT", { emoji, bg })), "Avatar saved! 🌷"); } catch (err) { fail(err.message); }
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
    $(".top-actions").insertAdjacentHTML("beforeend", `<div class="account-menu" id="accountMenu" role="menu"><div class="account-menu-head">${avatarHTML(state.user.avatar)}<div><strong>${nameHTML(state.user.username)}</strong><small>🐱 ${state.user.mc} MC · 💌 ${state.user.lc} LC</small></div></div><button class="menu-item" role="menuitem" data-page="profile">🌷 My profile</button><button class="menu-item" role="menuitem" id="menuAvatar">🎨 Change picture</button>${realKid() && !state.user.admin ? `<p class="menu-note">🧸 In the kiddy zone, only a parent can sign out, from 🌷 My profile.</p>` : `<button class="menu-item signout" role="menuitem" id="logout">🚪 Sign out</button>`}</div>`);
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
    // Tapping a reply's quote or the 📌 pinned bar jumps to that message (the bar then shows the next pin).
    const jump = e.target.closest("[data-jump-msg]");
    if (jump && state.chat) { jumpToMessage(Number(jump.dataset.jumpMsg)); if (jump.dataset.nextPin !== undefined) { state.chat.pinIndex = (state.chat.pinIndex || 0) + 1; $("#pinnedBar").outerHTML = pinnedBarHTML(); } return; }
    const b=e.target.closest("button"); if(!b)return;
    const s = state.salon;
    try {
      if(b.dataset.navGroup){toggleNavGroup(b.dataset.navGroup);return;}
      if(b.dataset.page){
        if(pageGone(b.dataset.page)){toast(goneNote(b.dataset.page),true);return;}
        await goTo(b.dataset.page,{createFrom:b.dataset.from});
        return;
      }
      if(b.dataset.push){await setPush(b.dataset.push==="on");return;}
      if(b.dataset.rate){const n=Number(b.dataset.rate);state.user=(await api("/api/me/rating",send("PUT",{stars:n}))).user;toast(`Thanks for rating Yakimma! ${"⭐".repeat(n)}`);return;}
      if(b.dataset.pickReaction){const i=Number(b.dataset.pickReaction);await openEmojiPicker("😊 Pick a reaction",async emoji=>{
        // Picking one that's already there swaps the two, so each emoji shows once.
        const list=[...quickReactions()],at=list.indexOf(emoji);if(at>=0)list[at]=list[i];list[i]=emoji;
        try{await saveReactions(list);}catch(err){toast(err.message,true);}});return;}
      if(b.dataset.resetReactions!==undefined){await saveReactions(null);return;}
      if(b.id==="accountBtn"){state.user?toggleAccountMenu():openAuth("login");return;}
      // 🙋 Need Help? opens AI's chat in Friends, to ask it questions about Yakimma.
      if(b.id==="helpBtn"){if(!state.user){toast("Sign in to ask AI for help 🤖",true);openAuth("login");return;}await openAIChat();return;}
      if(b.dataset.askAi!==undefined&&state.chat?.ai){
        b.disabled=true;
        try{mergeChat(await api("/api/ai/ask",send("POST",{question:Number(b.dataset.askAi),since:state.chat.rev})));}finally{b.disabled=false;}
        return;
      }
      if(b.id==="openAuth"){openAuth("signup");return;}
      if(b.dataset.signIn!==undefined){openAuth("login");return;}
      if(["editAvatarBtn","menuAvatar"].includes(b.id)){openAvatarEditor();return;}
      if(b.dataset.editAvatar&&state.person?.user.id===Number(b.dataset.editAvatar)){openAvatarEditor({...state.person.user,admin:state.person.admin});return;}
      if(b.dataset.rename){renameModal(Number(b.dataset.rename),b.dataset.name);return;}
      if(b.dataset.viewAvatar){const me=b.dataset.viewAvatar==="me",u=me?state.user:state.person.user;avatarViewer(u.avatar,u.username,me);return;}
      if(b.dataset.myOrder){state.myPosts={...state.myPosts,order:b.dataset.myOrder};await loadMyPosts();render();return;}
      if(b.id==="moreMyPosts"){b.disabled=true;await loadMyPosts(true);render();return;}
      // 🔎 on the Feed opens the post search, or closes it. Picking All, Videos or Text posts searches straight away.
      if(b.id==="oldModeBtn"){try{localStorage.setItem(OLD_MODE,"on");}catch{return toast("Old Mode can't be saved in this browser.",true);}if(oldModeOk(state.user))location.assign("/old/");return;}
      // 📞 Calling a friend, from a chat, Contact info, a call's note or the Calls list.
      if(b.dataset.callFriend||b.dataset.callGroup){state.contactInfo=null;closeModal();await startCall(b.dataset.callFriend?{friend:Number(b.dataset.callFriend)}:{group:b.dataset.callGroup},b.dataset.video==="1");return;}
      if(b.dataset.joinCall){joinGroupCall(Number(b.dataset.joinCall),state.groupView.key,b.dataset.video==="1");return;}
      if(b.id==="returnToCall"){if(callNow){callNow.minimized=false;drawCall();}return;}
      if(b.id==="newCallBtn"){state.newCall=!state.newCall;render();return;}
      if(b.id==="allCallsBtn"){state.allCalls=!state.allCalls;render();return;}
      if(b.dataset.callFilter){state.callFilter=b.dataset.callFilter;state.allCalls=false;render();return;}
      if(b.dataset.callInfo){callInfoModal(Number(b.dataset.callInfo));return;}
      if(b.dataset.callForget){const id=Number(b.dataset.callForget);await api(`/api/calls/history/${id}`,{method:"DELETE"});state.callHistory=state.callHistory.filter(c=>c.id!==id);closeModal();render();toast("Deleted from your call log.");return;}
      if(b.id==="clearCallsBtn"){if(!confirm("Clear your whole call log?"))return;await api("/api/calls/history",{method:"DELETE"});state.callHistory=[];render();toast("Your call log is cleared.");return;}
      if(b.dataset.callChatGroup){closeModal();await openGroup(b.dataset.callChatGroup);return;}
      if(b.id==="crazyBtn"){const on=!crazyOn();try{if(on)localStorage.setItem(CRAZY_KEY,"on");else{localStorage.removeItem(CRAZY_KEY);localStorage.removeItem(CRAZY_ZONE_KEY);}}catch{return toast("CRAZZZYYY MODE can't be saved in this browser.",true);}await zoneChanged(state.user);toast(on?"🤪 CRAZZZYYY MODE is on!":"CRAZZZYYY MODE is off.");return;}
      if(b.dataset.crazyZone!==undefined){const z=b.dataset.crazyZone,was=crazyZone();try{if(z)localStorage.setItem(CRAZY_ZONE_KEY,z);else localStorage.removeItem(CRAZY_ZONE_KEY);}catch{return toast("CRAZZZYYY MODE can't be saved in this browser.",true);}await zoneChanged(state.user);
        toast(z==="adult"?"Welcome to the 18+ zone 👹":z==="kid"?"Welcome to the kiddy zone 🧸 Have fun!":was==="adult"?"18+ is off. Welcome back! 🌸":"The kiddy zone is off. Welcome back! 🌸");return;}
      if(b.id==="postSearchBtn"){state.postSearch=state.postSearch?null:{q:"",kind:"all",posts:null};render();if(state.postSearch)$("#postSearchText").focus();return;}
      if(b.id==="closePostSearch"){state.postSearch=null;render();return;}
      if(b.dataset.searchKind){await searchPosts($("#postSearchText").value.trim(),b.dataset.searchKind);render();return;}
      if(b.id==="logout"){if(realKid()&&!state.user.admin)return kidSignOut();await api("/api/logout",{method:"POST"});await signedOut();return;}
      if(b.dataset.like){const d=await api(`/api/posts/${b.dataset.like}/like`,{method:"POST"});if(state.groupView)state.groupView.posts=d.posts;else state.posts=d.posts;for(const theirs of [state.postSearch?.posts?.find(x=>x.id===Number(b.dataset.like)),state.person?.posts.find(x=>x.id===Number(b.dataset.like)),state.playlist?.find(x=>x.id===Number(b.dataset.like)),state.single?.post?.id===Number(b.dataset.like)&&state.single.post])if(theirs){theirs.liked=d.liked;theirs.likes+=d.liked?1:-1;}state.user=d.user;state.notice=d.rewarded?"You earned 10 MC! 🐱":"";render();return;}
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
      if(b.id==="deleteAccountBtn"){deleteAccountModal();return;}
      if(b.dataset.removeLink){await saveLinks(state.user.links.filter((_,i)=>i!==Number(b.dataset.removeLink)),"Link removed.");return;}
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
      if(b.dataset.audienceLocked!==undefined){audienceLockedModal();return;}
      if(b.dataset.setAdmin){const on=b.dataset.on==="true";if(!confirm(on?`Make ${b.dataset.name} an admin?\n\nThey'll have 🛠️ Admin next to their name, a display name, 🛠️ as a picture they can pick, the Reports page, and can delete anyone's posts, comments, messages and groups.`:`Remove ${b.dataset.name} as an admin?`))return;const d=await api(`/api/users/${b.dataset.setAdmin}/admin`,send("PUT",{admin:on}));state.person=d;state.admins=new Set(d.admins);state.displayNames=d.displayNames;toast(on?`${b.dataset.name} is an admin now 🛠️`:`${b.dataset.name} isn't an admin any more.`);return;}
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
      if(b.dataset.joinGroup){closeModal();const d=await api(`/api/groups/${b.dataset.joinGroup}/join`,{method:"POST"});setGroups(d);if(d.requested){toast("You asked to join 🙋 A group admin will let you in.");return;}await openGroup(b.dataset.joinGroup);toast("You joined the group! 🎉 Say hi in the chat.");return;}
      if(b.dataset.cancelRequest){setGroups(await api(`/api/groups/${b.dataset.cancelRequest}/request`,{method:"DELETE"}));toast("You took back your request to join.");return;}
      if(b.dataset.openGroup){await openGroup(b.dataset.openGroup);return;}
      if(b.dataset.members){if(!state.user){openAuth("login");return;}await openMembers(b.dataset.members);return;}
      if(b.dataset.groupTab&&state.groupView){state.groupView.tab=b.dataset.groupTab;render();if(b.dataset.groupTab==="chat"){showChat();await pollChat();}return;}
      if(b.dataset.chat){closeModal();await openChat(Number(b.dataset.chat));return;}
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
        if(b.dataset.replyMsg){Object.assign(c,{replyTo:Number(b.dataset.replyMsg),selected:null,editing:null});render();focusChat();return;}
        if(b.id==="cancelReply"){c.replyTo=null;render();return;}
        if(b.dataset.starMsg){c.selected=null;await chatAction(`/${b.dataset.starMsg}/star`,b.dataset.on==="true"?"POST":"DELETE");toast(b.dataset.on==="true"?"Starred ⭐ Find it in Group info.":"Unstarred.");return;}
        if(b.dataset.pinChoose){c.pinFor=Number(b.dataset.pinChoose);drawLog();return;}
        if(b.dataset.pinMsg){Object.assign(c,{selected:null,pinFor:null,pinIndex:0});await chatAction(`/${b.dataset.pinMsg}/pin`,"POST",{days:Number(b.dataset.days)});return;}
        if(b.dataset.unpinMsg){c.selected=null;await chatAction(`/${b.dataset.unpinMsg}/pin`,"DELETE");return;}
        if(b.dataset.vote){await chatAction(`/${b.dataset.vote}/vote`,"POST",{option:Number(b.dataset.option)});return;}
        if(b.dataset.answer){await chatAction(`/${b.dataset.answer}/answer`,"POST",{going:b.dataset.going==="true"});return;}
        if(b.id==="attachBtn"){c.attach=!c.attach;render();return;}
        if(b.id==="newPoll"){c.attach=false;render();pollModal();return;}
        if(b.id==="pickMedia"){$("#chatMedia").click();return;}
        if(b.id==="contactInfoBtn"){await openContactInfo();return;}
        if(b.id==="newEvent"){c.attach=false;render();eventModal();return;}
      }
      if(b.dataset.block){await blockPerson(Number(b.dataset.block),b.dataset.name);return;}
      if(b.dataset.unblock){state.social=await api(`/api/blocks/${b.dataset.unblock}`,{method:"DELETE"});state.posts=(await api("/api/posts")).posts;toast(`${b.dataset.name} is unblocked.`);return;}
      // Leaving or deleting from inside the group (its Group info) goes back to all the groups.
      if(b.dataset.leaveGroup){if(!confirm(b.dataset.owner==="true"?`Exit "${b.dataset.name}"?\n\nYou're its owner, so an admin (or the member who's been in it longest) becomes the owner. If nobody else is in it, it's deleted.`:`Exit "${b.dataset.name}"?`))return;setGroups(await api(`/api/groups/${b.dataset.leaveGroup}/join`,{method:"DELETE"}));Object.assign(state,{groupView:null,chat:null,groupInfo:null});closeModal();toast("You left the group.");return;}
      if(b.dataset.deleteGroup){if(!confirm(`Delete the group "${b.dataset.name}"? This can't be undone.`))return;setGroups(await api(`/api/groups/${b.dataset.deleteGroup}`,{method:"DELETE"}));Object.assign(state,{groupView:null,chat:null,groupInfo:null});closeModal();toast("Group deleted.");return;}
      if(b.id==="groupInfoBtn"){await openGroupInfo();return;}
      if(b.dataset.openLanguage!==undefined){languageModal();return;}
      if(b.dataset.viewMedia){mediaViewer(b.dataset.viewMedia);return;}
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
  // Photos and videos picked for a chat.
  document.addEventListener("change", e => {
    if (e.target.id !== "chatMedia" || !e.target.files.length || !state.chat) return;
    const files = [...e.target.files];
    e.target.value = ""; state.chat.attach = false; render();
    sendMediaModal(files);
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
    if(e.target.id==="linkForm"){
      e.preventDefault();
      try { await saveLinks([...(state.user.links||[]),$("#linkInput").value.trim()],"Link added! 🔗 It's on your profile."); }
      catch(err){toast(err.message,true);}
      return;
    }
    if(e.target.id==="postSearchForm"){
      e.preventDefault();
      try { await searchPosts($("#postSearchText").value.trim(),state.postSearch.kind);state.notice="";render(); }
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
      const c=state.chat, body=$("#chatInput").value.trim(), editing=c?.editing, replyTo=c?.replyTo;
      if(!c||!body)return;
      $("#chatInput").value="";c.draft="";
      try {
        if(editing){c.editing=null;await chatAction(`/${editing}`,"PATCH",{body});render();focusChat();}
        else if(replyTo){c.replyTo=null;await chatAction("","POST",{body,replyTo});render();focusChat();}
        else await chatAction("","POST",{body});
      }
      catch(err){c.draft=body;c.editing=editing;c.replyTo=replyTo;toast(err.message,true);}
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
      const d=await api("/api/posts",{method:"POST",body});state.notice="";state.postSearch=null;await refresh();
      // Public and unlisted posts go to the feed, or back to your profile if you started there. Private ones only show on
      // your profile.
      if(state.createFrom==="profile"||visibility==="private"){state.page="profile";state.myPosts=null;await loadPageData();}
      else state.page="feed";
      toast(visibility==="public"?"Your post is published on this server! 🌸":visibility==="unlisted"?"Your unlisted post is ready. Only your friends on Yakimma can see it. 👯":"Your private post is saved. Only you can see it, on your profile. 🔒");
    }
    catch(err){toast(err.message,true);}
  });
  // ---- The song picked in Settings, played on a loop on every page. Browsers only let a page play sound after you've
  // tapped something on it, so if it can't start yet, it starts on your next tap. ----
  const music = Object.assign(new Audio(), { loop: true, volume: 0.5 });
  function syncMusic() {
    // Songs stop during a call.
    if (callNow && callNow.state !== "ended") { if (!music.paused) music.pause(); return; }
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
    // A post's link (/post/<code>, or an older /post/<number>) opens that post. A group's invite link (/group/<code>)
    // opens the group to join (after signing in).
    const link = location.pathname.match(/^\/post\/([A-Za-z0-9_~-]+)$/), invite = location.pathname.match(/^\/group\/([A-Za-z0-9_-]+)$/);
    if (invite) state.pendingInvite = invite[1];
    if (link) Object.assign(state, { page: "post", postKey: link[1] });
    const page = pageAt(location.pathname), name = personAt(location.pathname);
    if (page) state.page = page;
    // Back from signing in with Google: say how it went, and take ?signin= off the address.
    const signin = new URLSearchParams(location.search).get("signin");
    if (signin !== null) history.replaceState(null, "", location.pathname);
    try{
      await useLanguage(storedLang() || "en");
      await refresh();if(link||page)await loadPageData();render();
      if (name) { replacePath = true; await openTag(decodeURIComponent(name)); }
      $("#footerLang").textContent = `🌐 ${langOf(i18n.code).name}`;
      // Nobody has picked a language here yet: ask (this one can't be closed until they do).
      if (!storedLang() && !state.user?.language) languageModal(true);
      if (state.pendingInvite && !state.user) { toast("Sign in to join the group 🔗", true); openAuth("login"); }
      if (signin === "google" && state.user) toast(`Welcome back, ${state.user.username}! 🩵`);
      else if (Object.hasOwn(SIGNIN_NOTES, signin) && SIGNIN_NOTES[signin]) toast(SIGNIN_NOTES[signin], true);
      syncPush();
    }catch(err){toast(err.message,true);}
  }
  init();
})();
