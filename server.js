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
const { mailSettings, createMailer } = require("./email");

// Private settings (like the email app password below) can go in a .env file next to this one. It's never committed.
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

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
-- Pictures someone took of the website with the 📷 camera. Only they can see them, on their Pictures page.
CREATE TABLE IF NOT EXISTS pictures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  place TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pictures_user ON pictures(user_id, id);
-- Messages from the AI assistant to one person. AI isn't a real account, so it never uses up an account number.
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS ai_messages_user ON ai_messages(user_id, id);
-- Someone part-way through turning on 18+: where their email code went, the code (hashed), and whether they've entered it.
CREATE TABLE IF NOT EXISTS adult_checks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  email_ok INTEGER NOT NULL DEFAULT 0
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
  ["theme", "TEXT NOT NULL DEFAULT 'pink'"],
  // When they passed the 18+ checks (see the 18+ zone below), and whether they're in the 18+ zone right now.
  ["adult_verified_at", "TEXT"],
  ["adult_on", "INTEGER NOT NULL DEFAULT 0"],
  // The 18+ zone has its own theme (Blood to start with), so leaving the zone brings back your normal one.
  ["zone_theme", "TEXT NOT NULL DEFAULT 'blood'"]
]) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}
// Posts made inside a group have its key (see findGroup) and only show in that group, never on the main feed.
if (!db.prepare("PRAGMA table_info(posts)").all().some(c => c.name === "group_key")) db.exec("ALTER TABLE posts ADD COLUMN group_key TEXT");
// Posts and groups made in the 18+ zone are marked adult, and only show there.
for (const table of ["posts", "community_groups"]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === "adult")) db.exec(`ALTER TABLE ${table} ADD COLUMN adult INTEGER NOT NULL DEFAULT 0`);
}
db.exec("CREATE INDEX IF NOT EXISTS posts_group ON posts(group_key, id)");
db.exec("CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, id)");
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
  { id: "pastel", name: "Pastel", icon: "🩷", art: "🌈🍭", item: "pastel" },
  // A gift for entering the 18+ zone, yours to keep. It's never in the Shop, and Settings only lists it for people who have it.
  { id: "blood", name: "Blood", icon: "🩸", art: "🩸🥀", item: "blood-theme", gift: true }
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
// `intro` is shown above the usual message in the group's chat and posts while they're still empty.
const secretGroups = [
  { id: "cuties", name: "Cuties", icon: "💖", description: "A secret group for cuties who found the code. 💖", intro: "A special group for special people chosen by the Owner!" }
];
// Every emoji people can react with. The same file feeds the emoji picker in the browser.
const emojiSet = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "public", "emoji-data.json"), "utf8")).flatMap(g => g.emojis.map(e => e[0])));
// Icons people can pick for their own groups. A secret group's icon is only ever its own, so it's never offered here.
const groupIcons = ["🏘️", "🌸", "🎨", "🎮", "📚", "🎵", "⚽", "🐱", "🐶", "🦄", "💅", "🍰", "🌈", "⭐", "🎀", "🧸"]
  .filter(icon => !secretGroups.some(g => g.icon === icon));
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
// A nail wears as much art as you like, each piece in its own colour: arts = [{ id, color }].
// Older sets stored one `art` with one `accent` colour, so turn those into a list too.
const nailArtsOf = n => Array.isArray(n?.arts) ? n.arts : n?.art && n.art !== "none" ? [{ id: n.art, color: n.accent }] : [];
const upgradeDesign = d => ({ ...d, nails: d.nails.map(n => ({ color: n.color, finish: n.finish, arts: nailArtsOf(n) })) });
// Where a piece of art sits once it's been moved, sized or turned (see artPlaces in app.js). Art that's never been
// moved has none of these and sits at its home spot. Moved art has all four.
const ART_PLACE = { x: [-1, 1], y: [0, 1], size: [0.3, 3], turn: [-180, 180] };
const artPlaceOf = a => Object.keys(ART_PLACE).some(k => a?.[k] !== undefined)
  ? Object.fromEntries(Object.keys(ART_PLACE).map(k => [k, Math.round(Number(a[k]) * 1000) / 1000])) : {};
const placeOk = a => Object.entries(ART_PLACE).every(([k, [lo, hi]]) => a[k] === undefined || (a[k] >= lo && a[k] <= hi));
// Only accept designs built from known options so stored data is always safe to render.
function cleanDesign(input) {
  if (!input || typeof input !== "object") return null;
  if (!hasOption(nailOptions.shapes, input.shape) || !hasOption(nailOptions.lengths, input.length)) return null;
  if (!Array.isArray(input.nails) || input.nails.length !== 5) return null;
  const nails = input.nails.map(n => ({
    color: String(n?.color || "").toLowerCase(),
    finish: n?.finish,
    arts: nailArtsOf(n).map(a => ({ id: a?.id, color: String(a?.color || "").toLowerCase(), ...artPlaceOf(a) }))
  }));
  // Each piece of art can go on a nail once, so a nail never holds more than the whole art list.
  const valid = nails.every(n => HEX_COLOR.test(n.color) && hasOption(nailOptions.finishes, n.finish)
    && n.arts.every(a => a.id !== "none" && hasOption(nailOptions.arts, a.id) && HEX_COLOR.test(a.color) && placeOk(a))
    && new Set(n.arts.map(a => a.id)).size === n.arts.length);
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
const pictureLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "You're taking pictures very fast. Take a little break and try again." } });
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
// Pictures taken with the 📷 camera. The browser draws them as JPEGs; each person can keep up to MAX_PICTURES.
const MAX_PICTURES = 100;
const pictureUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => cb(null, `picture-${crypto.randomUUID()}.jpg`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(file.mimetype === "image/jpeg" ? null : new Error("Pictures must be JPEGs."), file.mimetype === "image/jpeg")
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
  return db.prepare("SELECT id, username, mc, lc, hand_tone, avatar_emoji, avatar_bg, avatar_path, theme, zone_theme, adult_verified_at, adult_on FROM users WHERE id = ?").get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function avatarOf(row) {
  return { emoji: row.avatar_emoji, bg: row.avatar_bg, photoUrl: row.avatar_path ? `/uploads/${encodeURIComponent(row.avatar_path)}` : null };
}
// Every account has its own 13-digit number, in sign-up order: the first is 0000000000000, the next 0000000000001,
// and so on up to 9999999999999. Account ids start at 1 and are never reused, so the number is the id minus one.
const MAX_ACCOUNTS = 10 ** 13;
const accountNumber = id => String(id - 1).padStart(13, "0");
function publicUser(row) {
  return row ? { id: row.id, accountNumber: accountNumber(row.id), username: row.username, mc: row.mc, lc: row.lc, handTone: row.hand_tone, avatar: avatarOf(row), theme: row.adult_on ? row.zone_theme : row.theme,
    adult: { verified: Boolean(row.adult_verified_at), on: Boolean(row.adult_on) } } : null;
}
function ownsItem(userId, itemId) {
  return Boolean(db.prepare("SELECT 1 FROM inventory WHERE user_id=? AND item_id=?").get(userId, itemId));
}
function areFriends(a, b) {
  return Boolean(db.prepare(`SELECT 1 FROM friendships WHERE status='accepted'
    AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`).get(a, b, b, a));
}
// ---- 18+ zone ----
// Someone is 18+ once they've confirmed it, entered the code sent to their email and passed the face scan. Turning 18+ on
// puts them in the 18+ zone: they only see posts and groups made there, they can only talk to people who are 18+, and
// nobody outside the zone sees any of it.
const adultRow = userId => db.prepare("SELECT adult_verified_at AS verifiedAt, adult_on AS zone FROM users WHERE id=?").get(userId || 0);
const isAdult = userId => Boolean(adultRow(userId)?.verifiedAt);
const inZone = userId => Boolean(adultRow(userId)?.zone);
// Two people can talk unless one of them is in the 18+ zone; then both have to be 18+.
const canTalk = (a, b) => (!inZone(a) && !inZone(b)) || (isAdult(a) && isAdult(b));
const talkError = me => inZone(me) ? "You're in the 18+ zone, so you can only talk to people who are 18+." : "They're in the 18+ zone right now, so you can't talk to them.";
// 18+ groups are only for people in the zone, and people in the zone can only use 18+ groups.
// Says what's wrong (and the status to answer with) when someone can't use a group from where they are.
function groupZoneError(userId, group) {
  if (group.adult && !inZone(userId)) return { status: 404, error: "That group doesn't exist any more." };
  if (!group.adult && inZone(userId)) return { status: 403, error: "You're in the 18+ zone. Turn off 18+ in Settings to visit this group." };
  return null;
}
// The AI assistant in Friends. It has its own chat with each person, where it sends tips (like how to afford something in the Shop).
const AI = { userId: 0, username: "AI", avatar: { emoji: "🤖", bg: "sky", photoUrl: null } };
// Send someone a message from AI, unless it would just repeat the last thing AI told them.
function aiSay(userId, body) {
  if (db.prepare("SELECT body FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT 1").get(userId)?.body === body) return;
  db.prepare("INSERT INTO ai_messages(user_id,body) VALUES(?,?)").run(userId, body);
}
// The newest 100 AI messages (or only the ones after `since`), shaped like chat messages so the chat box can show them.
function aiMessages(userId, since = 0) {
  const rows = db.prepare("SELECT * FROM (SELECT id, body, created_at AS createdAt FROM ai_messages WHERE user_id=? AND id>? ORDER BY id DESC LIMIT 100) ORDER BY id").all(userId, since);
  return {
    messages: rows.map(m => ({ id: m.id, rev: m.id, ...AI, body: m.body, forwarded: false, createdAt: m.createdAt, editedAt: null, deleted: false, reactions: [] })),
    rev: db.prepare("SELECT COALESCE(MAX(id), 0) AS rev FROM ai_messages WHERE user_id=?").get(userId).rev
  };
}
function friendsPayload(userId) {
  const rows = db.prepare(`
    SELECT f.id, f.status, f.requester_id AS requesterId, f.created_at AS createdAt,
      u.id AS userId, u.username, u.hand_tone AS handTone, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      (SELECT COUNT(*) FROM messages d WHERE d.sender_id=u.id AND d.recipient_id=? AND d.read_at IS NULL AND d.deleted_at IS NULL) AS unread,
      u.adult_verified_at, u.adult_on
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id=? OR f.addressee_id=?
    ORDER BY u.username COLLATE NOCASE
  `).all(userId, userId, userId, userId);
  const pending = rows.filter(r => r.status === "pending");
  const request = r => ({ requestId: r.id, userId: r.userId, username: r.username, avatar: avatarOf(r), createdAt: r.createdAt });
  const me = adultRow(userId), talks = r => (!me?.zone && !r.adult_on) || Boolean(me?.verifiedAt && r.adult_verified_at);
  return {
    ai: { ...AI, unread: db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE user_id=? AND read_at IS NULL").get(userId).n },
    friends: rows.filter(r => r.status === "accepted").map(r => ({ id: r.userId, username: r.username, handTone: r.handTone, avatar: avatarOf(r), unread: r.unread, canTalk: talks(r) })),
    incoming: pending.filter(r => r.requesterId !== userId).map(request),
    outgoing: pending.filter(r => r.requesterId === userId).map(request),
    blocked: db.prepare(`SELECT u.id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=? ORDER BY u.username COLLATE NOCASE`).all(userId).map(r => ({ id: r.id, username: r.username, avatar: avatarOf(r) }))
  };
}
function receivedDesigns(userId) {
  return db.prepare(`
    SELECT d.id, d.design, d.created_at AS createdAt, d.artist_id AS artistId, u.username AS artist
    FROM nail_designs d JOIN users u ON u.id=d.artist_id
    WHERE d.client_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=d.client_id AND b.blocked_id=d.artist_id)
    ORDER BY d.id DESC LIMIT 12
  `).all(userId).map(d => ({ ...d, design: upgradeDesign(JSON.parse(d.design)) }));
}
// Pass onlyId (a regular group's number) to build just that group's card.
function groupsPayload(viewerId, onlyId) {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.icon, g.owner_id AS ownerId, u.username AS owner,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id) AS members,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=?) AS joined
    FROM community_groups g JOIN users u ON u.id=g.owner_id
    WHERE ${onlyId ? "g.id=?" : "g.adult=?"} ORDER BY members DESC, g.id DESC LIMIT 200
  `).all(viewerId || 0, onlyId || (inZone(viewerId) ? 1 : 0));
  // The first few members of each group, for the little row of faces on its card.
  const faces = {};
  for (const f of db.prepare(`
    SELECT * FROM (
      SELECT m.group_id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path,
        ROW_NUMBER() OVER (PARTITION BY m.group_id ORDER BY m.joined_at, m.user_id) AS n
      FROM group_members m JOIN users u ON u.id=m.user_id
    ) WHERE n <= 5
  `).all()) (faces[f.group_id] ||= []).push({ username: f.username, avatar: avatarOf(f) });
  const secret = onlyId || inZone(viewerId) ? [] : secretGroups.map(g => secretGroupCard(viewerId, g));
  return { groups: [...secret, ...groups.map(g => ({ ...g, joined: Boolean(g.joined), faces: faces[g.id] || [] }))], icons: groupIcons };
}
function secretGroupCard(viewerId, g) {
  return {
    id: g.id, name: g.name, description: g.description, icon: g.icon, intro: g.intro || null, ownerId: null, owner: null, secret: true,
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
  const id = Number(key), row = Number.isSafeInteger(id) && db.prepare("SELECT id, adult FROM community_groups WHERE id=?").get(id);
  return row ? { key: String(row.id), id: row.id, adult: Boolean(row.adult) } : null;
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
  const zone = groupZoneError(req.session.userId, group);
  if (zone) { res.status(zone.status).json({ error: zone.error }); return null; }
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
  if (!canTalk(req.session.userId, friendId)) { res.status(403).json({ error: talkError(req.session.userId) }); return null; }
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
// Posts as the browser shows them; `where` picks which ones, in id order ("DESC" is newest first).
function selectPosts(viewerId, where, params, order = "DESC", limit = 100) {
  return db.prepare(`
    SELECT p.id, p.user_id AS userId, u.username, p.caption, p.media_path AS mediaPath,
      p.media_type AS mediaType, p.created_at AS createdAt, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE ${where}
    ORDER BY p.id ${order} LIMIT ?
  `).all(viewerId || 0, ...params, limit).map(p => ({
    id: p.id, userId: p.userId, username: p.username, avatar: avatarOf(p), caption: p.caption,
    mediaUrl: p.mediaPath ? `/uploads/${encodeURIComponent(p.mediaPath)}` : null,
    mediaType: p.mediaType, createdAt: p.createdAt, likes: p.likes, liked: Boolean(p.liked)
  }));
}
// The newest 100 posts on the main feed (or in a group), hiding people the viewer blocked.
function postRows(viewerId, groupKey = null) {
  return selectPosts(viewerId, "p.group_key IS ? AND p.adult=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=p.user_id)", [groupKey, inZone(viewerId) ? 1 : 0, viewerId || 0]);
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
    if (/\s/.test(username)) return res.status(400).json({ error: "Do not use spaces. Usernames can only have letters and numbers." });
    if (/[^A-Za-z0-9]/.test(username)) return res.status(400).json({ error: "Do not use symbols. Usernames can only have letters and numbers." });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: "Username must be 3–20 letters or numbers." });    // Passwords can have any letters, numbers, symbols or emojis, but no spaces.
    if (/\s/.test(password)) return res.status(400).json({ error: "Do not use spaces in your password." });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must be 8–200 characters." });
    const hash = await bcrypt.hash(password, 12);
    if ((db.prepare("SELECT seq FROM sqlite_sequence WHERE name='users'").get()?.seq || 0) >= MAX_ACCOUNTS) {
      return res.status(403).json({ error: "Yakimma is full: every account number has been given out." });
    }
    // Usernames are compared ignoring capitals (the column is COLLATE NOCASE), so "Cutie" and "cutie" are the same name.
    const result = db.prepare("INSERT INTO users(username,password_hash,mc) VALUES(?,?,0)").run(username, hash);
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = Number(result.lastInsertRowid);
      res.json({ user: publicUser(currentUser(req)), products });
    });
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Do not copy usernames. Someone already has that username, and changing capital letters still counts as the same name." });
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

// Your own feed posts for your profile, newest or oldest first, a page at a time. `after` is the last post id already shown.
const MY_POSTS_PAGE = 12;
app.get("/api/me/posts", requireAuth, (req, res) => {
  const me = req.session.userId, oldest = req.query.order === "oldest", after = Number(req.query.after), adult = inZone(me) ? 1 : 0;
  const from = Number.isSafeInteger(after) && after > 0 ? ` AND p.id ${oldest ? ">" : "<"} ?` : "";
  const posts = selectPosts(me, `p.user_id=? AND p.group_key IS NULL AND p.adult=?${from}`, from ? [me, adult, after] : [me, adult], oldest ? "ASC" : "DESC", MY_POSTS_PAGE + 1);
  res.json({
    posts: posts.slice(0, MY_POSTS_PAGE), more: posts.length > MY_POSTS_PAGE,
    total: db.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND group_key IS NULL AND adult=?").get(me, adult).n
  });
});

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
      const result = db.prepare("INSERT INTO posts(user_id,caption,media_path,media_type,group_key,adult) VALUES(?,?,?,?,?,?)")
        .run(req.session.userId, caption, req.file ? path.basename(req.file.filename) : null, type, groupKey, inZone(req.session.userId) ? 1 : 0);
      res.status(201).json({ postId: Number(result.lastInsertRowid), posts: postRows(req.session.userId, groupKey) });
    } catch (e) { next(e); }
  });
}
app.post("/api/posts", requireAuth, (req, res, next) => createPost(req, res, next, null));

const likeTransaction = db.transaction((userId, postId) => {
  const post = db.prepare("SELECT id,user_id,group_key AS groupKey,adult FROM posts WHERE id=?").get(postId);
  if (!post || Boolean(post.adult) !== inZone(userId)) return { error: "Post not found.", status: 404 };
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
    const u = db.prepare("SELECT mc,lc FROM users WHERE id=?").get(req.session.userId), have = p.currency === "MC" ? u.mc : u.lc;
    // Every item has a Buy button. If you can't afford it, AI tells you in Friends how much more you need and how to get it.
    if (have < p.price) {
      const howTo = p.currency === "MC" ? "🐱 Earn MC by posting: every new person's first like on your post gives you 10 MC. Secret codes on the Codes page can give MC too!"
        : "💌 Win LoveCards on the Codes page, or swap 1,000 MC for 1 LC in the Shop.";
      aiSay(req.session.userId, `Hi! You tried to buy ${p.icon} ${p.name}. It costs ${p.price} ${p.currency} and you have ${have} ${p.currency}, so you need ${p.price - have} more ${p.currency}. ${howTo}`);
      return { error: `You can't afford ${p.name} yet. 🤖 AI sent you a message in Friends.` };
    }
    if (p.currency === "MC") db.prepare("UPDATE users SET mc=mc-? WHERE id=?").run(p.price, req.session.userId);
    else db.prepare("UPDATE users SET lc=lc-? WHERE id=?").run(p.price, req.session.userId);
    db.prepare("INSERT INTO inventory(user_id,item_id) VALUES(?,?)").run(req.session.userId, p.id);
    // A newly bought theme goes on straight away.
    const theme = themes.find(t => t.item === p.id);
    if (theme) setTheme(req.session.userId, theme.id);
    return { ok: true };
  });
  const result = tx();
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: publicUser(currentUser(req)), inventory: inventoryOf(req.session.userId) });
});

// Choosing a theme in the 18+ zone sets the zone's theme; anywhere else, your normal one.
const setTheme = (userId, themeId) => db.prepare(`UPDATE users SET ${inZone(userId) ? "zone_theme" : "theme"}=? WHERE id=?`).run(themeId, userId);
app.put("/api/me/theme", requireAuth, (req, res) => {
  const theme = themes.find(t => t.id === req.body.theme);
  if (!theme) return res.status(400).json({ error: "Choose one of the themes." });
  if (theme.item && !ownsItem(req.session.userId, theme.item)) return res.status(403).json({ error: theme.gift ? "You don't have that theme." : `Buy the ${theme.name} theme in the Shop first.` });
  setTheme(req.session.userId, theme.id);
  res.json({ user: publicUser(currentUser(req)) });
});

// Turning on 18+ takes four steps: confirm you're 18+, give an email, enter the code sent to it, then pass a face scan.
// The face scan runs in the browser and only sends the age it guessed. Guesses can be a few years off, so it has to
// guess at least ADULT_FACE_AGE. Once all four are done you're 18+ for good, and can turn the zone on and off any time.
const ADULT_FACE_AGE = 21;
const ADULT_CODE_MINUTES = 10, ADULT_CODE_TRIES = 5;
const adultLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: "Too many tries. Please wait 15 minutes and try again." } });
// The 18+ codes are emailed over SMTP; see email.js for the settings. Without a password, a copy of Yakimma running on
// your own computer shows the code on screen instead, and the live site says email isn't set up.
const mail = mailSettings(), mailer = createMailer(mail);
// Sign in to the email server once at start, so the log says straight away whether 18+ codes can be emailed.
if (mailer && !mail.from.includes("@")) console.error(`Email: codes would come from "${mail.from}", which isn't an email address. Set MAIL_FROM to the address they should come from.`);
if (mailer) mailer.verify().then(
  () => console.log(`Email: signed in to ${mail.host}. 18+ codes are emailed from ${mail.from}.`),
  err => console.error(`Email: couldn't sign in to ${mail.host} (${err.message}). Check the SMTP settings. 18+ codes can't be emailed.`));
else console.log("Email: no SMTP_PASS yet, so 18+ codes are shown on screen instead of emailed.");
const hashCode = code => crypto.createHash("sha256").update(code).digest();

app.post("/api/adult/email", requireAuth, adultLimiter, async (req, res, next) => {
  const me = req.session.userId, email = String(req.body.email || "").trim().slice(0, 254);
  if (req.body.confirm !== true) return res.status(400).json({ error: "Confirm you are 18+ first." });
  if (isAdult(me)) return res.status(400).json({ error: "You've already done the 18+ checks." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Type your whole email address, like name@example.com." });
  if (!mailer && isProduction) return res.status(503).json({ error: "Yakimma can't send emails yet, so 18+ can't be turned on right now." });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  db.prepare(`INSERT INTO adult_checks(user_id,email,code_hash,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, code_hash=excluded.code_hash, expires_at=excluded.expires_at, tries=0, email_ok=0`)
    .run(me, email, hashCode(code).toString("hex"), Date.now() + ADULT_CODE_MINUTES * 60 * 1000);
  if (!mailer) return res.json({ sent: false, testCode: code });
  try {
    const sent = await mailer.sendMail({
      from: { name: "Yakimma", address: mail.from }, to: email, subject: "Your Yakimma 18+ code",
      text: `Your Yakimma 18+ code is ${code}\n\nIt works for ${ADULT_CODE_MINUTES} minutes. If you didn't ask for this code, you can ignore this email.`
    });
    // The email server's reply has an id you can look up in cPanel's Track Delivery if the email doesn't arrive.
    console.log(`Email: 18+ code handed to ${mail.host} (${sent.response})`);
  } catch (err) {
    db.prepare("DELETE FROM adult_checks WHERE user_id=?").run(me);
    console.error("18+ code email failed:", err.message);
    return res.status(502).json({ error: "That email couldn't be sent. Check the address and try again." });
  }
  res.json({ sent: true });
});

app.post("/api/adult/code", requireAuth, adultLimiter, (req, res) => {
  const me = req.session.userId, check = db.prepare("SELECT * FROM adult_checks WHERE user_id=?").get(me);
  if (!check) return res.status(400).json({ error: "Ask for a code first." });
  if (check.expires_at < Date.now() || check.tries >= ADULT_CODE_TRIES) return res.status(400).json({ error: "That code has run out. Go back and ask for a new one." });
  const given = hashCode(String(req.body.code || "").replace(/\D/g, "")), wanted = Buffer.from(check.code_hash, "hex");
  if (!crypto.timingSafeEqual(given, wanted)) {
    db.prepare("UPDATE adult_checks SET tries=tries+1 WHERE user_id=?").run(me);
    return res.status(400).json({ error: "That code isn't right. Check your email and try again." });
  }
  db.prepare("UPDATE adult_checks SET email_ok=1 WHERE user_id=?").run(me);
  res.json({ ok: true });
});

app.post("/api/adult/face", requireAuth, adultLimiter, (req, res) => {
  const me = req.session.userId, check = db.prepare("SELECT email_ok FROM adult_checks WHERE user_id=?").get(me), age = Number(req.body.age);
  if (!check?.email_ok) return res.status(400).json({ error: "Enter the code from your email first." });
  if (!Number.isFinite(age)) return res.status(400).json({ error: "The face scan didn't finish. Try again." });
  if (age < ADULT_FACE_AGE) return res.status(403).json({ error: "The face scan couldn't tell that you're 18+, so 18+ stays off." });
  const gift = passAdultChecks(me);
  res.json({ user: publicUser(currentUser(req)), gift });
});
// The last check is done: they're 18+, and in the zone. The email was only needed for the code, so it isn't kept.
// Says whether they just got the Blood theme.
const passAdultChecks = db.transaction(userId => {
  db.prepare("UPDATE users SET adult_verified_at=CURRENT_TIMESTAMP, adult_on=1 WHERE id=?").run(userId);
  db.prepare("DELETE FROM adult_checks WHERE user_id=?").run(userId);
  return giveBloodTheme(userId);
});
// Entering the 18+ zone gives you the Blood theme for free. Says whether you just got it.
const giveBloodTheme = userId => db.prepare("INSERT OR IGNORE INTO inventory(user_id,item_id) VALUES(?,'blood-theme')").run(userId).changes > 0;

// Only on Yakimma running on your own computer (localhost), these accounts can skip the face scan by typing their
// username and password. It never works on the live site, or from another device on your network. Write names in small letters.
const FACE_SCAN_SKIPPERS = ["bleh", "manhatukfayay"];
const fromThisComputer = req => !isProduction && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
app.post("/api/adult/face-skip", requireAuth, adultLimiter, async (req, res, next) => {
  try {
    if (!fromThisComputer(req)) return res.status(404).json({ error: "Skipping the face scan only works on Yakimma running on your own computer." });
    const me = currentUser(req), check = db.prepare("SELECT email_ok FROM adult_checks WHERE user_id=?").get(me.id);
    if (!check?.email_ok) return res.status(400).json({ error: "Enter the code from your email first." });
    if (String(req.body.username || "").trim().toLowerCase() !== me.username.toLowerCase()) return res.status(403).json({ error: "Type the username you're signed in with." });
    if (!FACE_SCAN_SKIPPERS.includes(me.username.toLowerCase())) return res.status(403).json({ error: "This account can't skip the face scan." });
    const { password_hash: hash } = db.prepare("SELECT password_hash FROM users WHERE id=?").get(me.id);
    if (!await bcrypt.compare(String(req.body.password || ""), hash)) return res.status(403).json({ error: "That password isn't right." });
    const gift = passAdultChecks(me.id);
    res.json({ user: publicUser(currentUser(req)), gift });
  } catch (err) { next(err); }
});

// Turn the 18+ zone on (only once you're 18+) or off.
app.put("/api/adult", requireAuth, (req, res) => {
  const me = req.session.userId, on = req.body.on === true;
  if (on && !isAdult(me)) return res.status(403).json({ error: "Do the 18+ checks first." });
  db.prepare("UPDATE users SET adult_on=? WHERE id=?").run(on ? 1 : 0, me);
  res.json({ user: publicUser(currentUser(req)), gift: on && giveBloodTheme(me) });
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
  let groupId;
  try {
    db.transaction(() => {
      groupId = Number(db.prepare("INSERT INTO community_groups(name,description,icon,owner_id,adult) VALUES(?,?,?,?,?)").run(name, description, icon, me, inZone(me) ? 1 : 0).lastInsertRowid);
      db.prepare("INSERT INTO group_members(group_id,user_id) VALUES(?,?)").run(groupId, me);
    })();
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "There's already a group with that name." });
    return next(err);
  }
  res.status(201).json({ ...groupsPayload(me), groupId });
});

app.post("/api/groups/:id/join", requireAuth, (req, res) => {
  const found = findGroup(req.params.id), zone = found && groupZoneError(req.session.userId, found);
  if (zone) return res.status(zone.status).json({ error: zone.error });
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
  const me = currentUser(req)?.id, zone = groupZoneError(me, group);
  if (zone) return res.status(zone.status).json({ error: zone.error });
  const card = groupCard(me, group);
  if (!me || !isGroupMember(me, group)) return res.json({ group: card, posts: [], chat: { messages: [], rev: 0 } });
  res.json({ group: card, posts: postRows(me, group.key), chat: chatMessages(me, groupChatFor(group, me)) });
});

// Everyone in a group, for the list you get by tapping the faces on it. The person who made it comes first.
app.get("/api/groups/:id/members", requireAuth, (req, res) => {
  const group = findGroup(req.params.id);
  if (!group) return res.status(404).json({ error: "That group doesn't exist any more." });
  const zone = groupZoneError(req.session.userId, group);
  if (zone) return res.status(zone.status).json({ error: zone.error });
  // Secret groups have no owner.
  const info = group.secret || db.prepare("SELECT name, icon, owner_id AS ownerId FROM community_groups WHERE id=?").get(group.id), ownerId = info.ownerId || 0;
  const [table, key] = group.secret ? ["secret_group_members", group.key] : ["group_members", group.id];
  const members = db.prepare(`SELECT u.id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM ${table} m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? ORDER BY u.id=? DESC, u.username COLLATE NOCASE`).all(key, ownerId);
  res.json({ name: info.name, icon: info.icon, members: members.map(m => ({ id: m.id, username: m.username, avatar: avatarOf(m), owner: m.id === ownerId })) });
});

app.post("/api/groups/:id/posts", requireAuth, (req, res, next) => {
  const group = memberGroup(req, res);
  if (group) createPost(req, res, next, group.key);
});

app.get("/api/friends", requireAuth, (req, res) => res.json(friendsPayload(req.session.userId)));

// Your chat with the AI assistant. Opening or checking it marks AI's messages as read.
app.get("/api/ai/messages", requireAuth, (req, res) => {
  db.prepare("UPDATE ai_messages SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL").run(req.session.userId);
  res.json(aiMessages(req.session.userId, sinceRev(req.query.since)));
});

app.post("/api/friends/request", requireAuth, friendLimiter, (req, res) => {
  const me = req.session.userId;
  const other = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(String(req.body.username || "").trim());
  if (!other) return res.status(404).json({ error: "No Yakimma account has that username." });
  if (other.id === me) return res.status(400).json({ error: "You can't add yourself as a friend." });
  if (inZone(me) && !isAdult(other.id)) return res.status(403).json({ error: "You're in the 18+ zone, so you can only add people who are 18+." });
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
      if (!group || !isGroupMember(me, group) || groupZoneError(me, group)) return res.status(403).json({ error: "You can only forward to groups you're in." });
      to = groupChatFor(group, me);
    } else {
      const friendId = Number(req.body.toFriend);
      if (!Number.isSafeInteger(friendId) || !areFriends(me, friendId)) return res.status(403).json({ error: "You can only forward to your friends." });
      if (!canTalk(me, friendId)) return res.status(403).json({ error: talkError(me) });
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
  // You can do your own nails, or a friend's.
  if (friendId !== me && (!Number.isSafeInteger(friendId) || !areFriends(me, friendId))) return res.status(403).json({ error: "You can only do nails for yourself or your friends." });
  if (friendId !== me && !canTalk(me, friendId)) return res.status(403).json({ error: talkError(me) });
  const design = cleanDesign(req.body.design);
  if (!design) return res.status(400).json({ error: "That nail design isn't valid." });
  const locked = design.nails.flatMap(n => n.arts).map(a => nailOptions.arts.find(o => o.id === a.id)).find(a => a.item && !ownsItem(me, a.item));
  if (locked) return res.status(403).json({ error: `You need the ${locked.name} sticker to use it. Find its secret code!` });
  const result = db.prepare("INSERT INTO nail_designs(artist_id,client_id,design) VALUES(?,?,?)").run(me, friendId, JSON.stringify(design));
  res.status(201).json({ designId: Number(result.lastInsertRowid) });
});

const picturesPayload = userId => ({
  pictures: db.prepare("SELECT id, path, place, created_at AS createdAt FROM pictures WHERE user_id=? ORDER BY id DESC").all(userId)
    .map(p => ({ id: p.id, url: `/uploads/${encodeURIComponent(p.path)}`, place: p.place, createdAt: p.createdAt })),
  max: MAX_PICTURES
});
app.get("/api/pictures", requireAuth, (req, res) => res.json(picturesPayload(req.session.userId)));

app.post("/api/pictures", requireAuth, pictureLimiter, (req, res, next) => {
  pictureUpload.single("picture")(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That picture is too big to save." : err.message || "The picture couldn't be saved." });
    if (!req.file) return res.status(400).json({ error: "No picture was taken." });
    const me = req.session.userId, drop = () => fs.unlink(req.file.path, () => {});
    try {
      if (!isImageFile(req.file.path)) { drop(); return res.status(400).json({ error: "That isn't a picture we can keep." }); }
      if (db.prepare("SELECT COUNT(*) AS n FROM pictures WHERE user_id=?").get(me).n >= MAX_PICTURES) {
        drop(); return res.status(400).json({ error: `You have ${MAX_PICTURES} pictures. Delete some in Pictures 🌇 to take more.` });
      }
      db.prepare("INSERT INTO pictures(user_id,path,place) VALUES(?,?,?)").run(me, req.file.filename, cleanText(req.body.place).slice(0, 60));
      res.status(201).json(picturesPayload(me));
    } catch (e) { drop(); next(e); }
  });
});

app.delete("/api/pictures/:id", requireAuth, (req, res) => {
  const me = req.session.userId, picture = db.prepare("SELECT id, path FROM pictures WHERE id=? AND user_id=?").get(Number(req.params.id), me);
  if (!picture) return res.status(404).json({ error: "That picture isn't there any more." });
  db.prepare("DELETE FROM pictures WHERE id=?").run(picture.id);
  fs.unlink(path.join(uploadDir, path.basename(picture.path)), () => {});
  res.json(picturesPayload(me));
});

// The library the 📷 camera uses to draw the page into a picture. The browser only loads it the first time you take one.
app.get("/vendor/modern-screenshot.js", (_req, res) => res.sendFile(path.join(__dirname, "node_modules", "modern-screenshot", "dist", "index.js")));
// The 18+ face scan's library and its two models (finding a face, and guessing its age). It all runs in the browser.
const FACE_DIR = path.join(__dirname, "node_modules", "@vladmandic", "face-api");
const FACE_MODELS = new Set(["tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model.bin", "age_gender_model-weights_manifest.json", "age_gender_model.bin"]);
app.get("/vendor/face-api.js", (_req, res) => res.sendFile(path.join(FACE_DIR, "dist", "face-api.js")));
app.get("/vendor/face-model/:file", (req, res) => FACE_MODELS.has(req.params.file) ? res.sendFile(path.join(FACE_DIR, "model", req.params.file)) : res.sendStatus(404));

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
