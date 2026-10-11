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
CREATE TABLE IF NOT EXISTS community_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS secret_group_members (
  group_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id, user_id)
);
-- A message is in a group chat (group_key) or a chat between two friends (recipient_id), never both.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  forwarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  read_at TEXT,
  rev INTEGER NOT NULL,
  CHECK((group_key IS NULL) <> (recipient_id IS NULL))
);
CREATE INDEX IF NOT EXISTS messages_group ON messages(group_key, id);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS messages_rev ON messages(rev);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS code_redemptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, code)
);
`);
// Databases created by older versions need the newer user columns.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
for (const [name, definition] of [
  ["hand_tone", "TEXT NOT NULL DEFAULT 'sand'"],
  ["avatar_emoji", "TEXT NOT NULL DEFAULT '🌷'"],
  ["avatar_bg", "TEXT NOT NULL DEFAULT 'cotton'"],
  ["avatar_path", "TEXT"],
  ["theme", "TEXT NOT NULL DEFAULT 'pink'"]
]) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}
// Posts made inside a group have its key (see findGroup) and only show in that group, never on the main feed.
if (!db.prepare("PRAGMA table_info(posts)").all().some(c => c.name === "group_key")) db.exec("ALTER TABLE posts ADD COLUMN group_key TEXT");
db.exec("CREATE INDEX IF NOT EXISTS posts_group ON posts(group_key, id)");
// Chats used to be kept in two tables. Move any old messages into `messages` once, then remove the old tables.
const oldChatTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('group_messages','direct_messages')").all().map(t => t.name);
if (oldChatTables.length) db.transaction(() => {
  if (oldChatTables.includes("group_messages")) db.exec(`INSERT INTO messages(group_key,sender_id,body,created_at,rev)
    SELECT group_key,user_id,body,created_at,0 FROM group_messages ORDER BY id; DROP TABLE group_messages`);
  if (oldChatTables.includes("direct_messages")) db.exec(`INSERT INTO messages(sender_id,recipient_id,body,created_at,read_at,rev)
    SELECT sender_id,recipient_id,body,created_at,read_at,0 FROM direct_messages ORDER BY id; DROP TABLE direct_messages`);
  db.exec("UPDATE messages SET rev=id WHERE rev=0");
})();

const products = [
  { id: "nails", name: "Nails", icon: "💅", price: 1, currency: "LC", description: "Unlock the Nail Salon and do your friends' nails." },
  { id: "speed", name: "Speed", icon: "⏩", price: 40, currency: "MC", description: "Watch videos faster or slower when bored." },
  { id: "effects", name: "Effects", icon: "✨", price: 70, currency: "MC", description: "Add playful viewing effects to other videos." },
  { id: "goth", name: "Goth Theme", icon: "🖤", price: 10, currency: "MC", description: "Turns Yakimma dark: mostly black, with deep red and purple." },
  { id: "pastel", name: "Pastel Theme", icon: "🩷", price: 20, currency: "MC", description: "Turns Yakimma into a rainbow of bright pastel colours." }
];
// Themes in Settings. A theme with an `item` must be bought in the Shop first.
const themes = [
  { id: "pink", name: "Pink & Teal", icon: "🌸", art: "🌸🩵" },
  { id: "rose", name: "Rose Pink", icon: "🌹", art: "🌹💗" },
  { id: "mint", name: "Mint Teal", icon: "🍃", art: "🍃🩵" },
  { id: "goth", name: "Goth", icon: "🖤", art: "🦇🖤", item: "goth" },
  { id: "pastel", name: "Pastel", icon: "🩷", art: "🌈🍭", item: "pastel" }
];
// Secret codes for the Codes page. Each account can use each code once. Change the prizes here.
// A prize can be MC, LC, an `item` (a nail sticker from nailOptions.arts) or a `group` (one of secretGroups).
const codes = {
  B97C91: { lc: 10 },
  "286F6B": { lc: 9 },
  LU7M67: { mc: 500 },
  LU8M67: { mc: 700 },
  "256870": { group: "cuties" },
  M30W57: { item: "gingercat-sticker" }
};
// Secret groups are part of Yakimma itself: nobody owns them, and the only way in is their code.
const secretGroups = [
  { id: "cuties", name: "Cuties", icon: "🎀", description: "A secret group for cuties who found the code. 💖" }
];
// Every emoji people can react with. The same file feeds the emoji picker in the browser.
const emojiSet = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "public", "emoji-data.json"), "utf8")).flatMap(g => g.emojis.map(e => e[0])));
const groupIcons = ["🏘️", "🌸", "🎨", "🎮", "📚", "🎵", "⚽", "🐱", "🐶", "🦄", "💅", "🍰", "🌈", "⭐", "🎀", "🧸"];
const MAX_GROUPS_PER_PERSON = 5;

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
    { id: "flower", name: "Flower", icon: "🌸" }, { id: "gem", name: "Gem", icon: "💎" },
    // Stickers with an `item` can only be used by people who own that item.
    { id: "gingercat", name: "Ginger cat", icon: "🐱", item: "gingercat-sticker" }
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
// Only wrong or reused codes count, so nobody can guess codes by trying thousands.
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: "Too many wrong codes. Please wait 15 minutes and try again." } });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "You're sending messages very fast. Take a little break and try again." } });
const reactionLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "You're reacting very fast. Take a little break and try again." } });
const groupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "You're making groups very fast. Please wait a little while." } });
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
  return db.prepare("SELECT id, username, mc, lc, hand_tone, avatar_emoji, avatar_bg, avatar_path, theme FROM users WHERE id = ?").get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function avatarOf(row) {
  return { emoji: row.avatar_emoji, bg: row.avatar_bg, photoUrl: row.avatar_path ? `/uploads/${encodeURIComponent(row.avatar_path)}` : null };
}
function publicUser(row) {
  return row ? { id: row.id, username: row.username, mc: row.mc, lc: row.lc, handTone: row.hand_tone, avatar: avatarOf(row), theme: row.theme } : null;
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
      u.id AS userId, u.username, u.hand_tone AS handTone, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      (SELECT COUNT(*) FROM messages d WHERE d.sender_id=u.id AND d.recipient_id=? AND d.read_at IS NULL AND d.deleted_at IS NULL) AS unread
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id=? OR f.addressee_id=?
    ORDER BY u.username COLLATE NOCASE
  `).all(userId, userId, userId, userId);
  const pending = rows.filter(r => r.status === "pending");
  const request = r => ({ requestId: r.id, userId: r.userId, username: r.username, avatar: avatarOf(r), createdAt: r.createdAt });
  return {
    friends: rows.filter(r => r.status === "accepted").map(r => ({ id: r.userId, username: r.username, handTone: r.handTone, avatar: avatarOf(r), unread: r.unread })),
    incoming: pending.filter(r => r.requesterId !== userId).map(request),
    outgoing: pending.filter(r => r.requesterId === userId).map(request),
    blocked: db.prepare(`SELECT u.id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=? ORDER BY u.username COLLATE NOCASE`).all(userId).map(r => ({ id: r.id, username: r.username, avatar: avatarOf(r) }))
  };
}
function receivedDesigns(userId) {
  return db.prepare(`
    SELECT d.id, d.design, d.created_at AS createdAt, u.username AS artist
    FROM nail_designs d JOIN users u ON u.id=d.artist_id
    WHERE d.client_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=d.client_id AND b.blocked_id=d.artist_id)
    ORDER BY d.id DESC LIMIT 12
  `).all(userId).map(d => ({ ...d, design: JSON.parse(d.design) }));
}
// Pass onlyId (a regular group's number) to build just that group's card.
function groupsPayload(viewerId, onlyId) {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.icon, g.owner_id AS ownerId, u.username AS owner,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id) AS members,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=?) AS joined
    FROM community_groups g JOIN users u ON u.id=g.owner_id
    ${onlyId ? "WHERE g.id=?" : ""} ORDER BY members DESC, g.id DESC LIMIT 200
  `).all(viewerId || 0, ...(onlyId ? [onlyId] : []));
  // The first few members of each group, for the little row of faces on its card.
  const faces = {};
  for (const f of db.prepare(`
    SELECT * FROM (
      SELECT m.group_id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path,
        ROW_NUMBER() OVER (PARTITION BY m.group_id ORDER BY m.joined_at, m.user_id) AS n
      FROM group_members m JOIN users u ON u.id=m.user_id
    ) WHERE n <= 5
  `).all()) (faces[f.group_id] ||= []).push({ username: f.username, avatar: avatarOf(f) });
  const secret = onlyId ? [] : secretGroups.map(g => secretGroupCard(viewerId, g));
  return { groups: [...secret, ...groups.map(g => ({ ...g, joined: Boolean(g.joined), faces: faces[g.id] || [] }))], icons: groupIcons };
}
function secretGroupCard(viewerId, g) {
  return {
    id: g.id, name: g.name, description: g.description, icon: g.icon, ownerId: null, owner: null, secret: true,
    unlocked: Boolean(viewerId && secretGroupUnlocked(viewerId, g.id)),
    members: db.prepare("SELECT COUNT(*) AS n FROM secret_group_members WHERE group_id=?").get(g.id).n,
    joined: Boolean(db.prepare("SELECT 1 FROM secret_group_members WHERE group_id=? AND user_id=?").get(g.id, viewerId || 0)),
    faces: db.prepare(`SELECT u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM secret_group_members m JOIN users u ON u.id=m.user_id
      WHERE m.group_id=? ORDER BY m.joined_at, m.user_id LIMIT 5`).all(g.id).map(f => ({ username: f.username, avatar: avatarOf(f) }))
  };
}
// A group's key is a regular group's number as text (e.g. "12"), or a secret group's id (e.g. "cuties").
function findGroup(key) {
  const secret = secretGroups.find(g => g.id === key);
  if (secret) return { key: secret.id, secret };
  const id = Number(key), row = Number.isSafeInteger(id) && db.prepare("SELECT id FROM community_groups WHERE id=?").get(id);
  return row ? { key: String(row.id), id: row.id } : null;
}
function isGroupMember(userId, group) {
  return Boolean(group.secret
    ? db.prepare("SELECT 1 FROM secret_group_members WHERE group_id=? AND user_id=?").get(group.key, userId)
    : db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?").get(group.id, userId));
}
const groupCard = (viewerId, group) => group.secret ? secretGroupCard(viewerId, group.secret) : groupsPayload(viewerId, group.id).groups[0];
// The group in the URL, if the signed-in person is in it. Otherwise this answers with an error and returns null.
function memberGroup(req, res) {
  const group = findGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "That group doesn't exist any more." }); return null; }
  if (!isGroupMember(req.session.userId, group)) { res.status(403).json({ error: "Join the group first to see its posts and chat." }); return null; }
  return group;
}
function secretGroupUnlocked(userId, groupId) {
  const code = Object.keys(codes).find(c => codes[c].group === groupId);
  return Boolean(code && db.prepare("SELECT 1 FROM code_redemptions WHERE user_id=? AND code=?").get(userId, code));
}
// What a code gives, in the shape the Codes page shows.
function prizeOf(code) {
  const p = codes[code], sticker = p.item && nailOptions.arts.find(a => a.item === p.item), group = p.group && secretGroups.find(g => g.id === p.group);
  return { mc: p.mc || 0, lc: p.lc || 0, sticker: sticker ? { name: sticker.name, icon: sticker.icon } : null, group: group ? { name: group.name, icon: group.icon } : null };
}
function codesPayload(userId) {
  const redeemed = db.prepare("SELECT code, redeemed_at AS redeemedAt FROM code_redemptions WHERE user_id=? ORDER BY redeemed_at DESC, code")
    .all(userId).filter(r => Object.hasOwn(codes, r.code))
    .map(r => ({ ...r, ...prizeOf(r.code) }));
  return { redeemed, total: Object.keys(codes).length };
}
const inventoryOf = userId => db.prepare("SELECT item_id FROM inventory WHERE user_id=?").all(userId).map(x => x.item_id);
const cleanText = s => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const MAX_MESSAGE = 500;
const MAX_REACTIONS = 20;
// The friend in the URL. Only friends can chat with each other.
function chatFriend(req, res) {
  const friendId = Number(req.params.userId);
  if (!Number.isSafeInteger(friendId) || !areFriends(req.session.userId, friendId)) { res.status(403).json({ error: "You can only chat with your friends." }); return null; }
  return friendId;
}
// A chat is a group's chat or a chat between two friends; `where` picks its messages.
const groupChatFor = (group, userId) => ({
  where: "m.group_key=?", params: [group.key], groupKey: group.key,
  // The person who made a group can delete anyone's messages in it.
  moderator: !group.secret && db.prepare("SELECT owner_id FROM community_groups WHERE id=?").get(group.id)?.owner_id === userId
});
const friendChatFor = (me, friendId) => ({ where: "((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))", params: [me, friendId, friendId, me], friendId });
function groupChatOf(req, res) { const group = memberGroup(req, res); return group && groupChatFor(group, req.session.userId); }
function friendChatOf(req, res) { const friendId = chatFriend(req, res); return friendId && friendChatFor(req.session.userId, friendId); }
// Every new, edited, deleted or reacted-to message gets a higher rev, so a chat can ask for everything that changed since the rev it has.
const nextRev = () => db.prepare("SELECT COALESCE(MAX(rev), 0) + 1 AS n FROM messages").get().n;
const sinceRev = v => Math.max(0, Math.floor(Number(v)) || 0);
// The newest 100 messages in a chat (or only the ones changed since `since`), hiding people the viewer blocked.
function chatMessages(viewerId, chat, since = 0) {
  const rows = db.prepare(`SELECT * FROM (
      SELECT m.id, m.rev, m.sender_id AS userId, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path,
        m.body, m.forwarded, m.created_at AS createdAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt
      FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE ${chat.where} AND m.rev>? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=m.sender_id)
      ORDER BY m.id DESC LIMIT 100
    ) ORDER BY id`).all(...chat.params, since, viewerId);
  const reactions = {};
  if (rows.length) for (const r of db.prepare(`SELECT r.message_id AS id, r.emoji, r.user_id AS userId, u.username
      FROM message_reactions r JOIN users u ON u.id=r.user_id
      WHERE r.message_id IN (${rows.map(() => "?").join(",")}) ORDER BY r.created_at, r.rowid`).all(...rows.map(m => m.id))) {
    const list = (reactions[r.id] ||= []);
    let e = list.find(x => x.emoji === r.emoji);
    if (!e) list.push(e = { emoji: r.emoji, count: 0, mine: false, users: [] });
    e.count++; e.mine ||= r.userId === viewerId; e.users.push(r.username);
  }
  return {
    messages: rows.map(m => ({
      id: m.id, rev: m.rev, userId: m.userId, username: m.username, avatar: avatarOf(m), body: m.body, forwarded: Boolean(m.forwarded),
      createdAt: m.createdAt, editedAt: m.editedAt, deleted: Boolean(m.deletedAt), reactions: reactions[m.id] || []
    })),
    rev: db.prepare(`SELECT COALESCE(MAX(m.rev), 0) AS rev FROM messages m WHERE ${chat.where}`).get(...chat.params).rev
  };
}
const insertMessage = (chat, senderId, body, forwarded = 0) => db.prepare("INSERT INTO messages(group_key,sender_id,recipient_id,body,forwarded,rev) VALUES(?,?,?,?,?,?)")
  .run(chat.groupKey ?? null, senderId, chat.friendId ?? null, body, forwarded, nextRev());
const markRead = (me, chat) => { if (chat.friendId) db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE sender_id=? AND recipient_id=? AND read_at IS NULL").run(chat.friendId, me); };
function postRows(viewerId, groupKey = null) {
  return db.prepare(`
    SELECT p.id, p.user_id AS userId, u.username, p.caption, p.media_path AS mediaPath,
      p.media_type AS mediaType, p.created_at AS createdAt, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.group_key IS ? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=p.user_id)
    ORDER BY p.id DESC LIMIT 100
  `).all(viewerId || 0, groupKey, viewerId || 0).map(p => ({
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
  if (!u) return res.json({ user: null, products, themes, nailOptions, avatarOptions });
  res.json({ user: publicUser(u), inventory: inventoryOf(u.id), products, themes, nailOptions, avatarOptions });
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

// Makes a post on the main feed, or inside a group when groupKey is given.
function createPost(req, res, next, groupKey) {
  upload.single("media")(req, res, err => {
    if (err) return apiError(err, req, res, next);
    try {
      const caption = String(req.body.caption || "").trim().slice(0, 240);
      if (!caption) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "Add a caption before posting." });
      }
      const type = req.file ? req.file.mimetype : null;
      const result = db.prepare("INSERT INTO posts(user_id,caption,media_path,media_type,group_key) VALUES(?,?,?,?,?)")
        .run(req.session.userId, caption, req.file ? path.basename(req.file.filename) : null, type, groupKey);
      res.status(201).json({ postId: Number(result.lastInsertRowid), posts: postRows(req.session.userId, groupKey) });
    } catch (e) { next(e); }
  });
}
app.post("/api/posts", requireAuth, (req, res, next) => createPost(req, res, next, null));

const likeTransaction = db.transaction((userId, postId) => {
  const post = db.prepare("SELECT id,user_id,group_key AS groupKey FROM posts WHERE id=?").get(postId);
  if (!post) return { error: "Post not found.", status: 404 };
  if (post.groupKey) {
    const group = findGroup(post.groupKey);
    if (!group || !isGroupMember(userId, group)) return { error: "Join the group first to like its posts.", status: 403 };
  }
  if (post.user_id === userId) return { error: "You cannot like your own post.", status: 400 };
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(userId, postId);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(userId, postId);
    return { liked: false, groupKey: post.groupKey };
  }
  db.prepare("INSERT INTO likes(user_id,post_id) VALUES(?,?)").run(userId, postId);
  const reward = db.prepare("INSERT OR IGNORE INTO like_rewards(liker_id,post_id) VALUES(?,?)").run(userId, postId);
  if (reward.changes) db.prepare("UPDATE users SET mc=mc+10 WHERE id=?").run(post.user_id);
  return { liked: true, rewarded: Boolean(reward.changes), groupKey: post.groupKey };
});
app.post("/api/posts/:id/like", requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isSafeInteger(postId) || postId < 1) return res.status(400).json({ error: "Invalid post." });
  const result = likeTransaction(req.session.userId, postId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ...result, posts: postRows(req.session.userId, result.groupKey), user: publicUser(currentUser(req)) });
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
    // A newly bought theme goes on straight away.
    const theme = themes.find(t => t.item === p.id);
    if (theme) db.prepare("UPDATE users SET theme=? WHERE id=?").run(theme.id, req.session.userId);
    return { ok: true };
  });
  const result = tx();
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: publicUser(currentUser(req)), inventory: inventoryOf(req.session.userId) });
});

app.put("/api/me/theme", requireAuth, (req, res) => {
  const theme = themes.find(t => t.id === req.body.theme);
  if (!theme) return res.status(400).json({ error: "Choose one of the themes." });
  if (theme.item && !ownsItem(req.session.userId, theme.item)) return res.status(403).json({ error: `Buy the ${theme.name} theme in the Shop first.` });
  db.prepare("UPDATE users SET theme=? WHERE id=?").run(theme.id, req.session.userId);
  res.json({ user: publicUser(currentUser(req)) });
});

app.get("/api/codes", requireAuth, (req, res) => res.json(codesPayload(req.session.userId)));

app.post("/api/codes", requireAuth, codeLimiter, (req, res) => {
  const me = req.session.userId;
  const code = String(req.body.code || "").toUpperCase().replace(/[\s-]/g, "").slice(0, 20);
  const prize = Object.hasOwn(codes, code) ? codes[code] : null;
  if (!prize) return res.status(400).json({ error: "That code doesn't work. Check it and try again." });
  const tx = db.transaction(() => {
    if (!db.prepare("INSERT OR IGNORE INTO code_redemptions(user_id,code) VALUES(?,?)").run(me, code).changes) return false;
    db.prepare("UPDATE users SET mc=mc+?, lc=lc+? WHERE id=?").run(prize.mc || 0, prize.lc || 0, me);
    if (prize.item) db.prepare("INSERT OR IGNORE INTO inventory(user_id,item_id) VALUES(?,?)").run(me, prize.item);
    // A secret group's code lets you in straight away. You can leave and come back any time after that.
    if (prize.group) db.prepare("INSERT OR IGNORE INTO secret_group_members(group_id,user_id) VALUES(?,?)").run(prize.group, me);
    return true;
  });
  if (!tx()) return res.status(400).json({ error: "You've already used this code." });
  res.json({ won: { code, ...prizeOf(code) }, user: publicUser(currentUser(req)), inventory: inventoryOf(me), ...codesPayload(me) });
});

app.get("/api/groups", (req, res) => res.json(groupsPayload(currentUser(req)?.id)));

app.post("/api/groups", requireAuth, groupLimiter, (req, res, next) => {
  const me = req.session.userId;
  const name = cleanText(req.body.name), description = cleanText(req.body.description).slice(0, 200);
  const icon = groupIcons.includes(req.body.icon) ? req.body.icon : groupIcons[0];
  if (name.length < 3 || name.length > 40) return res.status(400).json({ error: "Group names must be 3–40 characters." });
  if (secretGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "There's already a group with that name." });
  if (db.prepare("SELECT COUNT(*) AS n FROM community_groups WHERE owner_id=?").get(me).n >= MAX_GROUPS_PER_PERSON) {
    return res.status(400).json({ error: `You can make up to ${MAX_GROUPS_PER_PERSON} groups.` });
  }
  try {
    db.transaction(() => {
      const group = db.prepare("INSERT INTO community_groups(name,description,icon,owner_id) VALUES(?,?,?,?)").run(name, description, icon, me);
      db.prepare("INSERT INTO group_members(group_id,user_id) VALUES(?,?)").run(group.lastInsertRowid, me);
    })();
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "There's already a group with that name." });
    return next(err);
  }
  res.status(201).json(groupsPayload(me));
});

app.post("/api/groups/:id/join", requireAuth, (req, res) => {
  const secret = secretGroups.find(g => g.id === req.params.id);
  if (secret) {
    if (!secretGroupUnlocked(req.session.userId, secret.id)) return res.status(403).json({ error: `${secret.name} is a secret group. Enter its code on the Codes page to get in.` });
    db.prepare("INSERT OR IGNORE INTO secret_group_members(group_id,user_id) VALUES(?,?)").run(secret.id, req.session.userId);
    return res.json(groupsPayload(req.session.userId));
  }
  const group = db.prepare("SELECT id FROM community_groups WHERE id=?").get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: "That group doesn't exist any more." });
  db.prepare("INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)").run(group.id, req.session.userId);
  res.json(groupsPayload(req.session.userId));
});

app.delete("/api/groups/:id/join", requireAuth, (req, res) => {
  const secret = secretGroups.find(g => g.id === req.params.id);
  if (secret) {
    db.prepare("DELETE FROM secret_group_members WHERE group_id=? AND user_id=?").run(secret.id, req.session.userId);
    return res.json(groupsPayload(req.session.userId));
  }
  const me = req.session.userId, group = db.prepare("SELECT id, owner_id FROM community_groups WHERE id=?").get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: "That group doesn't exist any more." });
  if (group.owner_id === me) return res.status(400).json({ error: "You made this group, so you can't leave it. You can delete it instead." });
  db.prepare("DELETE FROM group_members WHERE group_id=? AND user_id=?").run(group.id, me);
  res.json(groupsPayload(me));
});

// Only the person who made a group can delete it; its members are removed with it.
app.delete("/api/groups/:id", requireAuth, (req, res) => {
  const me = req.session.userId, id = Number(req.params.id), key = String(id);
  const files = db.transaction(() => {
    if (!db.prepare("DELETE FROM community_groups WHERE id=? AND owner_id=?").run(id, me).changes) return null;
    // The group's posts and chat go with it.
    const media = db.prepare("SELECT media_path FROM posts WHERE group_key=? AND media_path IS NOT NULL").all(key).map(r => r.media_path);
    db.prepare("DELETE FROM posts WHERE group_key=?").run(key);
    db.prepare("DELETE FROM messages WHERE group_key=?").run(key);
    return media;
  })();
  if (!files) return res.status(404).json({ error: "You can only delete groups you made." });
  for (const f of files) fs.unlink(path.join(uploadDir, path.basename(f)), () => {});
  res.json(groupsPayload(me));
});

// Anyone can see a group's card; only members get its posts and chat.
app.get("/api/groups/:id", (req, res) => {
  const group = findGroup(req.params.id);
  if (!group) return res.status(404).json({ error: "That group doesn't exist any more." });
  const me = currentUser(req)?.id, card = groupCard(me, group);
  if (!me || !isGroupMember(me, group)) return res.json({ group: card, posts: [], chat: { messages: [], rev: 0 } });
  res.json({ group: card, posts: postRows(me, group.key), chat: chatMessages(me, groupChatFor(group, me)) });
});

app.post("/api/groups/:id/posts", requireAuth, (req, res, next) => {
  const group = memberGroup(req, res);
  if (group) createPost(req, res, next, group.key);
});

app.get("/api/friends", requireAuth, (req, res) => res.json(friendsPayload(req.session.userId)));

app.post("/api/friends/request", requireAuth, friendLimiter, (req, res) => {
  const me = req.session.userId;
  const other = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(String(req.body.username || "").trim());
  if (!other) return res.status(404).json({ error: "No Yakimma account has that username." });
  if (other.id === me) return res.status(400).json({ error: "You can't add yourself as a friend." });
  if (db.prepare("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?").get(me, other.id)) return res.status(400).json({ error: "You blocked this person. Unblock them on the Friends page first." });
  if (db.prepare("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?").get(other.id, me)) return res.status(403).json({ error: "You can't send a friend request to this person." });
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

// Group chats and friend chats share the same message actions. Each action answers with everything
// that changed since the `since` rev the browser sent, so the chat never misses an update.
for (const [base, chatOf] of [["/api/groups/:id/messages", groupChatOf], ["/api/friends/:userId/messages", friendChatOf]]) {
  // The message in the URL, if it's in this chat. Otherwise this answers with an error and returns null.
  const messageIn = (req, res, chat) => {
    const id = Number(req.params.messageId);
    const msg = Number.isSafeInteger(id) && db.prepare(`SELECT m.* FROM messages m WHERE m.id=? AND ${chat.where}`).get(id, ...chat.params);
    if (!msg || msg.deleted_at) { res.status(404).json({ error: "That message isn't there any more." }); return null; }
    return msg;
  };

  // Opening or checking a friend chat marks their messages as read.
  app.get(base, requireAuth, (req, res) => {
    const chat = chatOf(req, res);
    if (!chat) return;
    markRead(req.session.userId, chat);
    res.json(chatMessages(req.session.userId, chat, sinceRev(req.query.since)));
  });

  app.post(base, requireAuth, messageLimiter, (req, res) => {
    const chat = chatOf(req, res);
    if (!chat) return;
    const body = cleanText(req.body.body).slice(0, MAX_MESSAGE);
    if (!body) return res.status(400).json({ error: "Write a message first." });
    insertMessage(chat, req.session.userId, body);
    markRead(req.session.userId, chat);
    res.status(201).json(chatMessages(req.session.userId, chat, sinceRev(req.body.since)));
  });

  app.patch(`${base}/:messageId`, requireAuth, messageLimiter, (req, res) => {
    const chat = chatOf(req, res), msg = chat && messageIn(req, res, chat);
    if (!msg) return;
    if (msg.sender_id !== req.session.userId) return res.status(403).json({ error: "You can only edit your own messages." });
    if (msg.forwarded) return res.status(400).json({ error: "Forwarded messages can't be edited." });
    const body = cleanText(req.body.body).slice(0, MAX_MESSAGE);
    if (!body) return res.status(400).json({ error: "A message can't be empty. You can delete it instead." });
    if (body !== msg.body) db.prepare("UPDATE messages SET body=?, edited_at=CURRENT_TIMESTAMP, rev=? WHERE id=?").run(body, nextRev(), msg.id);
    res.json(chatMessages(req.session.userId, chat, sinceRev(req.body.since)));
  });

  // Deleted messages stay in the chat as "This message was deleted", so replies still make sense.
  app.delete(`${base}/:messageId`, requireAuth, (req, res) => {
    const chat = chatOf(req, res), msg = chat && messageIn(req, res, chat);
    if (!msg) return;
    if (msg.sender_id !== req.session.userId && !chat.moderator) return res.status(403).json({ error: "You can only delete your own messages." });
    db.transaction(() => {
      db.prepare("UPDATE messages SET body='', deleted_at=CURRENT_TIMESTAMP, rev=? WHERE id=?").run(nextRev(), msg.id);
      db.prepare("DELETE FROM message_reactions WHERE message_id=?").run(msg.id);
    })();
    res.json(chatMessages(req.session.userId, chat, sinceRev(req.query.since)));
  });

  // Picking an emoji adds your reaction; picking the same one again takes it away.
  app.post(`${base}/:messageId/reactions`, requireAuth, reactionLimiter, (req, res) => {
    const me = req.session.userId, chat = chatOf(req, res), msg = chat && messageIn(req, res, chat);
    if (!msg) return;
    const emoji = String(req.body.emoji || "");
    if (!emojiSet.has(emoji)) return res.status(400).json({ error: "Pick one of the emojis." });
    const error = db.transaction(() => {
      if (!db.prepare("DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?").run(msg.id, me, emoji).changes) {
        if (db.prepare("SELECT COUNT(*) AS n FROM message_reactions WHERE message_id=? AND user_id=?").get(msg.id, me).n >= MAX_REACTIONS) return `You can add up to ${MAX_REACTIONS} reactions to one message.`;
        db.prepare("INSERT INTO message_reactions(message_id,user_id,emoji) VALUES(?,?,?)").run(msg.id, me, emoji);
      }
      db.prepare("UPDATE messages SET rev=? WHERE id=?").run(nextRev(), msg.id);
    })();
    if (error) return res.status(400).json({ error });
    res.json(chatMessages(me, chat, sinceRev(req.body.since)));
  });

  // Forward a copy to one of your friends or a group you're in. It's marked as forwarded.
  app.post(`${base}/:messageId/forward`, requireAuth, messageLimiter, (req, res) => {
    const me = req.session.userId, chat = chatOf(req, res), msg = chat && messageIn(req, res, chat);
    if (!msg) return;
    let to;
    if (req.body.toGroup != null) {
      const group = findGroup(String(req.body.toGroup));
      if (!group || !isGroupMember(me, group)) return res.status(403).json({ error: "You can only forward to groups you're in." });
      to = groupChatFor(group, me);
    } else {
      const friendId = Number(req.body.toFriend);
      if (!Number.isSafeInteger(friendId) || !areFriends(me, friendId)) return res.status(403).json({ error: "You can only forward to your friends." });
      to = friendChatFor(me, friendId);
    }
    insertMessage(to, me, msg.body, 1);
    res.json({ ok: true });
  });
}

// Blocking someone hides their messages and posts from you, stops their friend requests, and ends any friendship.
app.post("/api/blocks", requireAuth, (req, res) => {
  const me = req.session.userId, other = Number(req.body.userId);
  if (!Number.isSafeInteger(other) || !db.prepare("SELECT 1 FROM users WHERE id=?").get(other)) return res.status(404).json({ error: "That person couldn't be found." });
  if (other === me) return res.status(400).json({ error: "You can't block yourself." });
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO blocks(blocker_id,blocked_id) VALUES(?,?)").run(me, other);
    db.prepare("DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)").run(me, other, other, me);
  })();
  res.json(friendsPayload(me));
});

app.delete("/api/blocks/:userId", requireAuth, (req, res) => {
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(req.session.userId, Number(req.params.userId));
  res.json(friendsPayload(req.session.userId));
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
  const locked = design.nails.map(n => nailOptions.arts.find(a => a.id === n.art)).find(a => a.item && !ownsItem(me, a.item));
  if (locked) return res.status(403).json({ error: `You need the ${locked.name} sticker to use it. Find its secret code!` });
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
