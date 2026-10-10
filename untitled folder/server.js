const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (isProduction && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
  throw new Error("Set SESSION_SECRET to a random value of at least 32 characters in production.");
}
if (isProduction) app.set("trust proxy", 1);

// On a host with a persistent disk (e.g. Render), point these at folders on the disk.
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "yakimma.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  mc INTEGER NOT NULL DEFAULT 0 CHECK(mc >= 0),
  lc INTEGER NOT NULL DEFAULT 0 CHECK(lc >= 0),
  hand_tone TEXT NOT NULL DEFAULT 'sand',
  avatar_emoji TEXT NOT NULL DEFAULT '🌷',
  avatar_bg TEXT NOT NULL DEFAULT 'cotton',
  avatar_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '',
  media_path TEXT,
  media_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS like_rewards (
  liker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(liker_id, post_id)
);
CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, item_id)
);
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT,
  CHECK(requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair ON friendships(min(requester_id, addressee_id), max(requester_id, addressee_id));
CREATE TABLE IF NOT EXISTS nail_designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  design TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS nail_designs_client ON nail_designs(client_id, id);
`);
// Databases created by older versions need the newer user columns.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
for (const [name, definition] of [
  ["hand_tone", "TEXT NOT NULL DEFAULT 'sand'"],
  ["avatar_emoji", "TEXT NOT NULL DEFAULT '🌷'"],
  ["avatar_bg", "TEXT NOT NULL DEFAULT 'cotton'"],
  ["avatar_path", "TEXT"]
]) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}

const products = [
  { id: "nails", name: "Nails", icon: "💅", price: 10, currency: "MC", description: "Unlock the Nail Salon and do your friends' nails." },
  { id: "speed", name: "Speed", icon: "⏩", price: 40, currency: "MC", description: "Watch videos faster or slower when bored." },
  { id: "effects", name: "Effects", icon: "✨", price: 70, currency: "MC", description: "Add playful viewing effects to other videos." },
  { id: "goth", name: "Goth Theme", icon: "🖤", price: 1, currency: "LC", description: "A dark goth theme for your profile." },
  { id: "pastel", name: "Pastel Theme", icon: "🩷", price: 2, currency: "LC", description: "A soft pastel theme for your profile." }
];

const nailOptions = {
  skinTones: [
    { id: "porcelain", name: "Porcelain", hex: "#fbe3d6" },
    { id: "ivory", name: "Ivory", hex: "#f3cfb3" },
    { id: "sand", name: "Sand", hex: "#e7b98f" },
    { id: "honey", name: "Honey", hex: "#d19a6a" },
    { id: "caramel", name: "Caramel", hex: "#b57a4d" },
    { id: "cinnamon", name: "Cinnamon", hex: "#8d5a3b" },
    { id: "cocoa", name: "Cocoa", hex: "#6b4029" },
    { id: "espresso", name: "Espresso", hex: "#4a2a1a" }
  ],
  shapes: [
    { id: "round", name: "Round" }, { id: "square", name: "Square" }, { id: "oval", name: "Oval" },
    { id: "almond", name: "Almond" }, { id: "coffin", name: "Coffin" }, { id: "stiletto", name: "Stiletto" }
  ],
  lengths: [{ id: "short", name: "Short" }, { id: "medium", name: "Medium" }, { id: "long", name: "Long" }],
  finishes: [
    { id: "glossy", name: "Glossy", icon: "✨" }, { id: "matte", name: "Matte", icon: "🌫️" },
    { id: "shimmer", name: "Shimmer", icon: "🌟" }, { id: "chrome", name: "Chrome", icon: "🪞" }
  ],
  arts: [
    { id: "none", name: "Plain", icon: "⚪" }, { id: "french", name: "French tip", icon: "🤍" },
    { id: "ombre", name: "Ombré", icon: "🌅" }, { id: "dots", name: "Dots", icon: "🫧" },
    { id: "heart", name: "Heart", icon: "💗" }, { id: "star", name: "Star", icon: "⭐" },
    { id: "flower", name: "Flower", icon: "🌸" }, { id: "gem", name: "Gem", icon: "💎" }
  ],
  polishes: [
    { name: "Ballet Slipper", hex: "#f7d4d8" }, { name: "Bubblegum", hex: "#ff8fc0" }, { name: "Hot Pink", hex: "#ff4fa0" },
    { name: "Cherry", hex: "#d7263d" }, { name: "Wine", hex: "#7a1f3d" }, { name: "Coral", hex: "#ff7f6a" },
    { name: "Peach", hex: "#ffc4a3" }, { name: "Butter", hex: "#ffe680" }, { name: "Mint", hex: "#9eebd2" },
    { name: "Teal", hex: "#2ec4b6" }, { name: "Sky", hex: "#8fd3ff" }, { name: "Navy", hex: "#23305e" },
    { name: "Lilac", hex: "#c9b3ff" }, { name: "Grape", hex: "#7e4bc9" }, { name: "Nude", hex: "#e8c4a8" },
    { name: "Milky White", hex: "#faf6f0" }, { name: "Silver", hex: "#c9cdd3" }, { name: "Gold", hex: "#d9b45a" },
    { name: "Midnight", hex: "#1e1b22" }
  ]
};
const avatarOptions = {
  emojis: ["🌷","🌸","🌼","🍓","🍒","🧁","🍩","🌈","⭐","🌙","💖","🎀","👑","💅","🐱","🐰","🦊","🐻","🐼","🐨","🐸","🦄","🐶","🦋","🐧","🐙","🎧","🎨"],
  backgrounds: [
    { id: "cotton", name: "Cotton candy", css: "linear-gradient(135deg,#ffe0ef,#d8f8f3)" },
    { id: "rose", name: "Rose", css: "#ffc7dd" }, { id: "peach", name: "Peach", css: "#ffd8c2" },
    { id: "butter", name: "Butter", css: "#fff1b8" }, { id: "mint", name: "Mint", css: "#c8f5e8" },
    { id: "sky", name: "Sky", css: "#cfe9ff" }, { id: "lilac", name: "Lilac", css: "#e6dbff" },
    { id: "sunset", name: "Sunset", css: "linear-gradient(135deg,#ffb3c7,#ffd59e)" },
    { id: "ocean", name: "Ocean", css: "linear-gradient(135deg,#9ee7e0,#8fb8ff)" },
    { id: "galaxy", name: "Galaxy", css: "linear-gradient(135deg,#2b2350,#7e4bc9)" },
    { id: "goth", name: "Goth", css: "#29232e" }
  ]
};
const hasOption = (list, id) => list.some(o => o.id === id);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Only accept designs built from known options so stored data is always safe to render.
function cleanDesign(input) {
  if (!input || typeof input !== "object") return null;
  if (!hasOption(nailOptions.shapes, input.shape) || !hasOption(nailOptions.lengths, input.length)) return null;
  if (!Array.isArray(input.nails) || input.nails.length !== 5) return null;
  const nails = input.nails.map(n => ({
    color: String(n?.color || "").toLowerCase(),
    finish: n?.finish,
    art: n?.art,
    accent: String(n?.accent || "").toLowerCase()
  }));
  const valid = nails.every(n => HEX_COLOR.test(n.color) && HEX_COLOR.test(n.accent)
    && hasOption(nailOptions.finishes, n.finish) && hasOption(nailOptions.arts, n.art));
  return valid ? { shape: input.shape, length: input.length, nails } : null;
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(session({
  name: "yakimma.sid",
  secret: SESSION_SECRET || "local-development-only-change-before-launch",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const friendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: "Too many friend requests. Please wait a little while." } });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/i;
    cb(allowed.test(file.mimetype) ? null : new Error("Choose a JPG, PNG, GIF, WebP, MP4, WebM, or MOV file."), allowed.test(file.mimetype));
  }
});

const AVATAR_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `avatar-${crypto.randomUUID()}${AVATAR_TYPES[file.mimetype]}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(AVATAR_TYPES[file.mimetype] ? null : new Error("Choose a JPG, PNG, GIF, or WebP picture."), Boolean(AVATAR_TYPES[file.mimetype]))
});
// Check the file's first bytes so only real images are kept, whatever the browser claimed.
function isImageFile(filePath) {
  const fd = fs.openSync(filePath, "r"), head = Buffer.alloc(12);
  try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
  return head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || head.subarray(0, 4).toString("latin1") === "GIF8"
    || (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP");
}
function setAvatarPhoto(userId, filename) {
  const old = db.prepare("SELECT avatar_path FROM users WHERE id=?").get(userId)?.avatar_path;
  db.prepare("UPDATE users SET avatar_path=? WHERE id=?").run(filename, userId);
  if (old && old !== filename) fs.unlink(path.join(uploadDir, path.basename(old)), () => {});
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id, username, mc, lc, hand_tone, avatar_emoji, avatar_bg, avatar_path FROM users WHERE id = ?").get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function avatarOf(row) {
  return { emoji: row.avatar_emoji, bg: row.avatar_bg, photoUrl: row.avatar_path ? `/uploads/${encodeURIComponent(row.avatar_path)}` : null };
}
function publicUser(row) {
  return row ? { id: row.id, username: row.username, mc: row.mc, lc: row.lc, handTone: row.hand_tone, avatar: avatarOf(row) } : null;
}
function ownsItem(userId, itemId) {
  return Boolean(db.prepare("SELECT 1 FROM inventory WHERE user_id=? AND item_id=?").get(userId, itemId));
}
function areFriends(a, b) {
  return Boolean(db.prepare(`SELECT 1 FROM friendships WHERE status='accepted'
    AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`).get(a, b, b, a));
}
function friendsPayload(userId) {
  const rows = db.prepare(`
    SELECT f.id, f.status, f.requester_id AS requesterId, f.created_at AS createdAt,
      u.id AS userId, u.username, u.hand_tone AS handTone, u.avatar_emoji, u.avatar_bg, u.avatar_path
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id=? OR f.addressee_id=?
    ORDER BY u.username COLLATE NOCASE
  `).all(userId, userId, userId);
  const pending = rows.filter(r => r.status === "pending");
  const request = r => ({ requestId: r.id, userId: r.userId, username: r.username, avatar: avatarOf(r), createdAt: r.createdAt });
  return {
    friends: rows.filter(r => r.status === "accepted").map(r => ({ id: r.userId, username: r.username, handTone: r.handTone, avatar: avatarOf(r) })),
    incoming: pending.filter(r => r.requesterId !== userId).map(request),
    outgoing: pending.filter(r => r.requesterId === userId).map(request)
  };
}
function receivedDesigns(userId) {
  return db.prepare(`
    SELECT d.id, d.design, d.created_at AS createdAt, u.username AS artist
    FROM nail_designs d JOIN users u ON u.id=d.artist_id
    WHERE d.client_id=? ORDER BY d.id DESC LIMIT 12
  `).all(userId).map(d => ({ ...d, design: JSON.parse(d.design) }));
}
function postRows(viewerId) {
  return db.prepare(`
    SELECT p.id, p.user_id AS userId, u.username, p.caption, p.media_path AS mediaPath,
      p.media_type AS mediaType, p.created_at AS createdAt, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id
    ORDER BY p.id DESC LIMIT 100
  `).all(viewerId || 0).map(p => ({
    id: p.id, userId: p.userId, username: p.username, avatar: avatarOf(p), caption: p.caption,
    mediaUrl: p.mediaPath ? `/uploads/${encodeURIComponent(p.mediaPath)}` : null,
    mediaType: p.mediaType, createdAt: p.createdAt, likes: p.likes, liked: Boolean(p.liked)
  }));
}
function apiError(err, _req, res, _next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Files must be 100 MB or smaller." : "Upload could not be completed." });
  }
  if (err) return res.status(400).json({ error: err.message || "Something went wrong." });
  res.status(500).json({ error: "Unexpected server error." });
}

app.get("/api/me", (req, res) => {
  const u = currentUser(req);
  if (!u) return res.json({ user: null, products, nailOptions, avatarOptions });
  const items = db.prepare("SELECT item_id FROM inventory WHERE user_id=?").all(u.id).map(x => x.item_id);
  res.json({ user: publicUser(u), inventory: items, products, nailOptions, avatarOptions });
});

app.post("/api/signup", authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3–20 letters, numbers, or underscores." });
    if (password.length < 10 || password.length > 200) return res.status(400).json({ error: "Password must be 10–200 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(username,password_hash,mc) VALUES(?,?,0)").run(username, hash);
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = Number(result.lastInsertRowid);
      res.json({ user: publicUser(currentUser(req)), products });
    });
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That username is already taken." });
    next(err);
  }
});

app.post("/api/login", authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "Username or password is incorrect." });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = row.id;
      res.json({ user: publicUser(currentUser(req)), products });
    });
  } catch (err) { next(err); }
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("yakimma.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
    res.json({ ok: true });
  });
});

app.get("/api/posts", (req, res) => res.json({ posts: postRows(currentUser(req)?.id) }));

app.post("/api/posts", requireAuth, (req, res, next) => {
  upload.single("media")(req, res, err => {
    if (err) return apiError(err, req, res, next);
    try {
      const caption = String(req.body.caption || "").trim().slice(0, 240);
      if (!caption) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "Add a caption before posting." });
      }
      const type = req.file ? req.file.mimetype : null;
      const result = db.prepare("INSERT INTO posts(user_id,caption,media_path,media_type) VALUES(?,?,?,?)")
        .run(req.session.userId, caption, req.file ? path.basename(req.file.filename) : null, type);
      res.status(201).json({ postId: Number(result.lastInsertRowid) });
    } catch (e) { next(e); }
  });
});

const likeTransaction = db.transaction((userId, postId) => {
  const post = db.prepare("SELECT id,user_id FROM posts WHERE id=?").get(postId);
  if (!post) return { error: "Post not found.", status: 404 };
  if (post.user_id === userId) return { error: "You cannot like your own post.", status: 400 };
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(userId, postId);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(userId, postId);
    return { liked: false };
  }
  db.prepare("INSERT INTO likes(user_id,post_id) VALUES(?,?)").run(userId, postId);
  const reward = db.prepare("INSERT OR IGNORE INTO like_rewards(liker_id,post_id) VALUES(?,?)").run(userId, postId);
  if (reward.changes) db.prepare("UPDATE users SET mc=mc+10 WHERE id=?").run(post.user_id);
  return { liked: true, rewarded: Boolean(reward.changes) };
});
app.post("/api/posts/:id/like", requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isSafeInteger(postId) || postId < 1) return res.status(400).json({ error: "Invalid post." });
  const result = likeTransaction(req.session.userId, postId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ...result, posts: postRows(req.session.userId), user: publicUser(currentUser(req)) });
});

app.post("/api/exchange", requireAuth, (req, res) => {
  const tx = db.transaction(() => {
    const u = db.prepare("SELECT mc,lc FROM users WHERE id=?").get(req.session.userId);
    if (u.mc < 1000) return false;
    db.prepare("UPDATE users SET mc=mc-1000, lc=lc+1 WHERE id=?").run(req.session.userId);
    return true;
  });
  if (!tx()) return res.status(400).json({ error: "You need 1,000 MC to exchange for 1 LC." });
  res.json({ user: publicUser(currentUser(req)) });
});

app.post("/api/shop/:itemId/buy", requireAuth, (req, res) => {
  const p = products.find(x => x.id === req.params.itemId);
  if (!p) return res.status(404).json({ error: "That item does not exist." });
  const tx = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM inventory WHERE user_id=? AND item_id=?").get(req.session.userId, p.id)) return { error: "You already own this item." };
    const u = db.prepare("SELECT mc,lc FROM users WHERE id=?").get(req.session.userId);
    if (p.currency === "MC" && u.mc < p.price) return { error: "Not enough MC." };
    if (p.currency === "LC" && u.lc < p.price) return { error: "Not enough LC." };
    if (p.currency === "MC") db.prepare("UPDATE users SET mc=mc-? WHERE id=?").run(p.price, req.session.userId);
    else db.prepare("UPDATE users SET lc=lc-? WHERE id=?").run(p.price, req.session.userId);
    db.prepare("INSERT INTO inventory(user_id,item_id) VALUES(?,?)").run(req.session.userId, p.id);
    return { ok: true };
  });
  const result = tx();
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: publicUser(currentUser(req)), inventory: db.prepare("SELECT item_id FROM inventory WHERE user_id=?").all(req.session.userId).map(x => x.item_id) });
});

app.get("/api/friends", requireAuth, (req, res) => res.json(friendsPayload(req.session.userId)));

app.post("/api/friends/request", requireAuth, friendLimiter, (req, res) => {
  const me = req.session.userId;
  const other = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(String(req.body.username || "").trim());
  if (!other) return res.status(404).json({ error: "No Yakimma account has that username." });
  if (other.id === me) return res.status(400).json({ error: "You can't add yourself as a friend." });
  const tx = db.transaction(() => {
    const existing = db.prepare(`SELECT id, status, requester_id FROM friendships
      WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`).get(me, other.id, other.id, me);
    if (existing?.status === "accepted") return { error: "You're already friends." };
    if (existing?.requester_id === me) return { error: "You already sent them a request." };
    if (existing) {
      // They already asked us, so asking back simply accepts.
      db.prepare("UPDATE friendships SET status='accepted', responded_at=CURRENT_TIMESTAMP WHERE id=?").run(existing.id);
      return { accepted: true };
    }
    db.prepare("INSERT INTO friendships(requester_id,addressee_id) VALUES(?,?)").run(me, other.id);
    return { requested: true };
  });
  const result = tx();
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ...result, ...friendsPayload(me) });
});

app.post("/api/friends/requests/:id/accept", requireAuth, (req, res) => {
  const info = db.prepare(`UPDATE friendships SET status='accepted', responded_at=CURRENT_TIMESTAMP
    WHERE id=? AND addressee_id=? AND status='pending'`).run(Number(req.params.id), req.session.userId);
  if (!info.changes) return res.status(404).json({ error: "That friend request is no longer available." });
  res.json(friendsPayload(req.session.userId));
});

// Declining an incoming request and cancelling an outgoing one both remove it.
app.delete("/api/friends/requests/:id", requireAuth, (req, res) => {
  const me = req.session.userId;
  const info = db.prepare(`DELETE FROM friendships WHERE id=? AND status='pending'
    AND (requester_id=? OR addressee_id=?)`).run(Number(req.params.id), me, me);
  if (!info.changes) return res.status(404).json({ error: "That friend request is no longer available." });
  res.json(friendsPayload(me));
});

app.delete("/api/friends/:userId", requireAuth, (req, res) => {
  const me = req.session.userId, other = Number(req.params.userId);
  db.prepare(`DELETE FROM friendships WHERE status='accepted'
    AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`).run(me, other, other, me);
  res.json(friendsPayload(me));
});

app.put("/api/me/hand-tone", requireAuth, (req, res) => {
  const tone = req.body.tone;
  if (!hasOption(nailOptions.skinTones, tone)) return res.status(400).json({ error: "Choose one of the skin tones." });
  db.prepare("UPDATE users SET hand_tone=? WHERE id=?").run(tone, req.session.userId);
  res.json({ user: publicUser(currentUser(req)) });
});

app.put("/api/me/avatar", requireAuth, (req, res) => {
  const { emoji, bg } = req.body;
  if (!avatarOptions.emojis.includes(emoji) || !hasOption(avatarOptions.backgrounds, bg)) return res.status(400).json({ error: "Choose one of the avatar characters and backgrounds." });
  db.prepare("UPDATE users SET avatar_emoji=?, avatar_bg=? WHERE id=?").run(emoji, bg, req.session.userId);
  // Picking an emoji avatar replaces any uploaded photo.
  setAvatarPhoto(req.session.userId, null);
  res.json({ user: publicUser(currentUser(req)) });
});

app.post("/api/me/avatar-photo", requireAuth, (req, res, next) => {
  avatarUpload.single("photo")(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Profile pictures must be 5 MB or smaller." : err.message || "Upload could not be completed." });
    if (!req.file) return res.status(400).json({ error: "Choose a picture first." });
    try {
      if (!isImageFile(req.file.path)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "That file isn't a picture we can use." });
      }
      setAvatarPhoto(req.session.userId, req.file.filename);
      res.json({ user: publicUser(currentUser(req)) });
    } catch (e) { next(e); }
  });
});

app.delete("/api/me/avatar-photo", requireAuth, (req, res) => {
  setAvatarPhoto(req.session.userId, null);
  res.json({ user: publicUser(currentUser(req)) });
});

app.get("/api/nails", requireAuth, (req, res) => res.json({ received: receivedDesigns(req.session.userId) }));

app.post("/api/nails", requireAuth, (req, res) => {
  const me = req.session.userId, friendId = Number(req.body.friendId);
  if (!ownsItem(me, "nails")) return res.status(403).json({ error: "Unlock Nails in the Shop first." });
  if (!Number.isSafeInteger(friendId) || !areFriends(me, friendId)) return res.status(403).json({ error: "You can only do nails for your friends." });
  const design = cleanDesign(req.body.design);
  if (!design) return res.status(400).json({ error: "That nail design isn't valid." });
  const result = db.prepare("INSERT INTO nail_designs(artist_id,client_id,design) VALUES(?,?,?)").run(me, friendId, JSON.stringify(design));
  res.status(201).json({ designId: Number(result.lastInsertRowid) });
});

app.get("/uploads/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const full = path.join(uploadDir, filename);
  if (!fs.existsSync(full)) return res.sendStatus(404);
  res.sendFile(full);
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error. Please try again." });
});

app.listen(PORT, () => console.log(`Yakimma is running at http://localhost:${PORT}`));
