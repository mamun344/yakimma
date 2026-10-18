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
-- A parent part-way through setting up the kiddy zone (or a new parent password): where their code went, the code
-- (hashed), and whether they've entered it.
CREATE TABLE IF NOT EXISTS kid_checks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  email_ok INTEGER NOT NULL DEFAULT 0
);
-- Learn! 📚: the class (1 to 9) and region a parent chose for each subject.
-- Learn! 📚: faith subjects (Islam, Christianity) a parent has verified for the child.
CREATE TABLE IF NOT EXISTS learn_verified (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  PRIMARY KEY(user_id, subject)
);
CREATE TABLE IF NOT EXISTS learn_levels (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  grade INTEGER NOT NULL,
  region TEXT NOT NULL,
  PRIMARY KEY(user_id, subject)
);
-- Someone reporting a post they think is bad. Yakimma's admins see reported posts on the Reports page.
CREATE TABLE IF NOT EXISTS post_reports (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id, reporter_id)
);
-- Posts someone put in the playlist on their Profile, because they like them or want to see them later.
CREATE TABLE IF NOT EXISTS playlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, post_id)
);
-- Following someone: one way, no request needed.
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(follower_id, followee_id),
  CHECK(follower_id <> followee_id)
);
CREATE TABLE IF NOT EXISTS code_redemptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, code)
);
-- Comments on posts. Anyone who can see a post can comment on it.
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, id);
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(comment_id, user_id, emoji)
);
-- What the 🔔 bell shows someone (user_id): another person (actor_id) tagged them, sent or accepted a friend request,
-- followed them, liked or commented on their post, reacted to their message or comment, or made them their assistant.
-- kind is tag, request, friend, follow, like, comment, reply, reaction or assistant; the post, comment or message is the one it's about.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  emoji TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
-- Nicknames people give their friends (see /api/friends/:userId/nickname). Only the person who gave one sees it, and
-- only while they're still friends.
-- Someone reporting a comment, like post_reports. "Something else" has the reporter's own words in details.
CREATE TABLE IF NOT EXISTS comment_reports (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(comment_id, reporter_id)
);
CREATE TABLE IF NOT EXISTS nicknames (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  PRIMARY KEY(owner_id, friend_id)
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
  ["zone_theme", "TEXT NOT NULL DEFAULT 'blood'"],
  // The kiddy zone (see below): the parent's email and parent-only password once a parent has set it up, and whether
  // the account is in the kiddy zone right now.
  ["kid_email", "TEXT"],
  ["kid_pass_hash", "TEXT"],
  // The parent's face, so only they can sign out of the kiddy zone. It's kept as numbers (see sameFace), never as a picture.
  ["kid_face", "TEXT"],
  ["kid_on", "INTEGER NOT NULL DEFAULT 0"],
  // Whether a parent verified the account for Learn's Islam subject (older versions; it's in learn_verified now).
  ["learn_muslim", "INTEGER NOT NULL DEFAULT 0"],
  // The song picked in Settings (see SONGS).
  ["song", "TEXT NOT NULL DEFAULT 'none'"],
  // Chosen when making an account (see RELIGIONS and COUNTRIES), and shown on the profile for everyone to see.
  ["religion", "TEXT"],
  ["country", "TEXT"],
  // The child's and the parent's birth dates (YYYY-MM-DD), filled in when a parent sets up the kiddy zone. Never shared.
  ["kid_birth_date", "TEXT"],
  ["parent_birth_date", "TEXT"],
  // A name shown along with the username. Only admins can have one (see canHaveDisplayName).
  ["display_name", "TEXT"],
  // Someone this person trusts, shown as their 🤝 Assistant on their profile (see /api/me/assistant).
  ["assistant_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
  // A suspension the creator gave: until when (milliseconds since 1970) and why. See /api/users/:id/suspend.
  ["suspended_until", "INTEGER"],
  ["suspend_reason", "TEXT"]
]) {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}
// A reply to a comment has the comment it answers. Replies are one level deep, and go when that comment goes.
if (!db.prepare("PRAGMA table_info(comments)").all().some(c => c.name === "parent_id")) db.exec("ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE");
// The creator's account used to be called Manhatukfayay. Now its username is Creator and Manhatukfayay is its display
// name. Only the creator can be called Creator, so anyone who already was becomes user<id> first.
{
  const creator = db.prepare("SELECT id FROM users WHERE username='manhatukfayay'").get();
  if (creator) db.transaction(() => {
    db.prepare("UPDATE users SET username='user' || id WHERE username='creator' AND id<>?").run(creator.id);
    db.prepare("UPDATE users SET username='Creator', display_name=COALESCE(display_name,'Manhatukfayay') WHERE id=?").run(creator.id);
  })();
}
// Posts made inside a group have its key (see findGroup) and only show in that group, never on the main feed.
if (!db.prepare("PRAGMA table_info(posts)").all().some(c => c.name === "group_key")) db.exec("ALTER TABLE posts ADD COLUMN group_key TEXT");
// Posts and groups made in the 18+ zone are marked adult, and only show there.
for (const table of ["posts", "community_groups"]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === "adult")) db.exec(`ALTER TABLE ${table} ADD COLUMN adult INTEGER NOT NULL DEFAULT 0`);
}
// Posts made in the kiddy zone are marked kid, and only show there.
if (!db.prepare("PRAGMA table_info(posts)").all().some(c => c.name === "kid")) db.exec("ALTER TABLE posts ADD COLUMN kid INTEGER NOT NULL DEFAULT 0");
// A video post can have a thumbnail: a picture shown on it before it plays (see /api/posts/:id/thumbnail).
if (!db.prepare("PRAGMA table_info(posts)").all().some(c => c.name === "thumb_path")) db.exec("ALTER TABLE posts ADD COLUMN thumb_path TEXT");
// Reporting a post for "Something else" needs the reporter to say what's wrong, in their own words, for the admins.
if (!db.prepare("PRAGMA table_info(post_reports)").all().some(c => c.name === "details")) db.exec("ALTER TABLE post_reports ADD COLUMN details TEXT");
// Like YouTube, a post has a description under its caption, and who can see it: "public" (everyone, on the feed and the
// person's profile), "unlisted" (only the person's friends on Yakimma) or "private" (only the person who posted it).
// The person can change it any time.
const postColumns = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
for (const [name, definition] of [["description", "TEXT NOT NULL DEFAULT ''"], ["visibility", "TEXT NOT NULL DEFAULT 'public'"]]) {
  if (!postColumns.includes(name)) db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
}
const VISIBILITIES = ["public", "unlisted", "private"], MAX_DESCRIPTION = 2000;
// Every post has its own link, /post/<code>, with a random 13-character code of letters, numbers and symbols. Yakimma
// picks it, never the person posting, and every code has at least one letter, one number and one symbol. The symbols
// are ones that are safe in a link.
const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", CODE_NUMBERS = "0123456789", CODE_SYMBOLS = "-_~", CODE_LENGTH = 13;
function newPostCode() {
  const any = CODE_LETTERS + CODE_NUMBERS + CODE_SYMBOLS, from = set => set[crypto.randomInt(set.length)];
  for (;;) {
    const chars = [from(CODE_LETTERS), from(CODE_NUMBERS), from(CODE_SYMBOLS), ...Array.from({ length: CODE_LENGTH - 3 }, () => from(any))];
    for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    const code = chars.join("");
    if (!db.prepare("SELECT 1 FROM posts WHERE code=?").get(code)) return code;
  }
}
// Posts from before codes get one now.
if (!postColumns.includes("code")) db.exec("ALTER TABLE posts ADD COLUMN code TEXT");
for (const { id } of db.prepare("SELECT id FROM posts WHERE code IS NULL").all()) db.prepare("UPDATE posts SET code=? WHERE id=?").run(newPostCode(), id);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS posts_code ON posts(code)");
// For lists of posts: public ones, and unlisted ones by the viewer or the viewer's friends. Its 3 ?s are the viewer.
const SEES_POST = `(p.visibility='public' OR (p.visibility='unlisted' AND (p.user_id=? OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted'
  AND ((f.requester_id=p.user_id AND f.addressee_id=?) OR (f.addressee_id=p.user_id AND f.requester_id=?))))))`;
// Whether someone can see one post: public, theirs, or unlisted by a friend.
const seesPost = (viewerId, post) => post.visibility === "public" || post.userId === viewerId || (post.visibility === "unlisted" && areFriends(viewerId, post.userId));
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
// Sign-ins are kept in the database, so they survive the server restarting (and new versions going live), and each
// visit keeps you signed in for another SESSION_DAYS, so refreshing or coming back to Yakimma never signs you out.
const SESSION_DAYS = 365, DAY = 24 * 60 * 60 * 1000;
db.exec("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)");
const sessionExpiry = sess => new Date(sess.cookie?.expires || Date.now() + SESSION_DAYS * DAY).getTime();
class DatabaseSessionStore extends session.Store {
  get(sid, done) {
    try {
      const row = db.prepare("SELECT data, expires FROM sessions WHERE sid=?").get(sid);
      done(null, row && row.expires > Date.now() ? JSON.parse(row.data) : null);
    } catch (err) { done(err); }
  }
  set(sid, sess, done) {
    try {
      db.prepare("INSERT INTO sessions(sid,data,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires")
        .run(sid, JSON.stringify(sess), sessionExpiry(sess));
      done?.();
    } catch (err) { done?.(err); }
  }
  touch(sid, sess, done) {
    try { db.prepare("UPDATE sessions SET expires=? WHERE sid=?").run(sessionExpiry(sess), sid); done?.(); } catch (err) { done?.(err); }
  }
  destroy(sid, done) {
    try { db.prepare("DELETE FROM sessions WHERE sid=?").run(sid); done?.(); } catch (err) { done?.(err); }
  }
}
// Sign-ins nobody has used for SESSION_DAYS are cleared out once a day.
setInterval(() => db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now()), DAY).unref();
app.use(session({
  name: "yakimma.sid",
  secret: SESSION_SECRET || "local-development-only-change-before-launch",
  store: new DatabaseSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: SESSION_DAYS * DAY
  }
}));

// Only faces that don't match count, so nobody can keep trying faces until one gets through.
const kidFaceLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: "Too many face scans that didn't match. Please wait 15 minutes and try again." } });
// A face from the face scan is 128 numbers that describe it. Two scans are the same person when their numbers are
// close: the face scan's own guide says under 0.6, and KID_FACE_MATCH is a bit stricter.
const KID_FACE_MATCH = 0.5;
const cleanFace = face => Array.isArray(face) && face.length === 128 && face.every(Number.isFinite) ? face.map(Number) : null;
const sameFace = (a, b) => Math.hypot(...a.map((x, i) => x - b[i])) < KID_FACE_MATCH;
// The kiddy zone only has Feed, Profile, Settings, Friends, Nails, Learn and the Shop, so groups, codes, pictures and
// the Reports page are closed in it.
app.use(/^\/api\/(groups|codes|pictures|reports)(\/|$)/, (req, res, next) => inKidZone(req.session.userId) ? res.status(403).json({ error: "That isn't in the kiddy zone." }) : next());

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
  // The post's photo or video, and a thumbnail picture for a video.
  limits: { fileSize: 100 * 1024 * 1024, files: 2 },
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
// A new thumbnail for a video post that's already up.
const thumbUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `thumb-${crypto.randomUUID()}${AVATAR_TYPES[file.mimetype]}`)
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
  // Only whether the kiddy zone birth dates are filled in. The dates themselves are never sent anywhere.
  return db.prepare(`SELECT id, username, mc, lc, hand_tone, avatar_emoji, avatar_bg, avatar_path, theme, zone_theme, adult_verified_at, adult_on, kid_pass_hash, kid_face, kid_on, song, religion, country, suspended_until, suspend_reason,
    (kid_birth_date IS NOT NULL AND parent_birth_date IS NOT NULL) AS kid_birth_dates FROM users WHERE id = ?`).get(req.session.userId) || null;
}
// A suspended account can't do anything until its suspension is over (it can still sign out and read the rules).
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "Please sign in first." });
  const suspended = suspensionOf(u);
  if (suspended) return res.status(403).json({ error: suspendedMessage(suspended), suspended });
  next();
}
// ---- ⛔ Suspensions: only the creator gives them, for any number of days, with a reason the person sees. ----
// The creator can never be suspended, whatever is saved.
const suspensionOf = row => !isCreator(row?.username) && row?.suspended_until > Date.now() ? { until: row.suspended_until, reason: row.suspend_reason || "" } : null;
const suspendedMessage = s => {
  const days = Math.ceil((s.until - Date.now()) / (24 * 60 * 60 * 1000));
  return `Your account is suspended for ${days} more day${days === 1 ? "" : "s"}.${s.reason ? ` Reason: ${s.reason}` : ""}`;
};
const MAX_SUSPENSION_DAYS = 3650;
function requireCreator(req, res, next) {
  if (!isCreator(currentUser(req)?.username)) return res.status(403).json({ error: "Only the creator can do that." });
  next();
}
// Some accounts have a picture that's always theirs and can't be changed, not even to 🛠️. Write names in small letters.
const FIXED_AVATARS = { creator: "/badges/pastel-yakimma-cat.jpg" };
const fixedAvatarOf = username => FIXED_AVATARS[username?.toLowerCase()] || null;
// Admins' profile picture is always 🛠️, which proves they're admins. Nobody else can pick it (it isn't in avatarOptions).
const ADMIN_EMOJI = "🛠️";
function avatarOf(row) {
  const fixed = fixedAvatarOf(row.username);
  if (fixed) return { emoji: row.avatar_emoji, bg: row.avatar_bg, photoUrl: fixed, fixed: true };
  if (ADMINS.includes(row.username?.toLowerCase())) return { emoji: ADMIN_EMOJI, bg: row.avatar_bg, photoUrl: null };
  return { emoji: row.avatar_emoji, bg: row.avatar_bg, photoUrl: row.avatar_path ? `/uploads/${encodeURIComponent(row.avatar_path)}` : null };
}
// Every account has its own 13-digit number, in sign-up order: the first is 0000000000000, the next 0000000000001,
// and so on up to 9999999999999. Account ids start at 1 and are never reused, so the number is the id minus one.
const MAX_ACCOUNTS = 10 ** 13;
const accountNumber = id => String(id - 1).padStart(13, "0");
// Yakimma's admins: they can delete anyone's posts, groups and group chat messages, and they see the Reports page.
// So they can check how things look, they can also switch into the 18+ zone or the kiddy zone (and out again) without
// the checks, the parent password or the parent's face. Write names in small letters.
const ADMINS = ["bleh", "creator"];
// Admins (the creator too) can have a display name as well as their username. It shows first, with @username after it.
const canHaveDisplayName = username => ADMINS.includes(username?.toLowerCase());
const displayNames = () => Object.fromEntries(db.prepare("SELECT username, display_name FROM users WHERE display_name IS NOT NULL").all()
  .filter(r => canHaveDisplayName(r.username)).map(r => [r.username.toLowerCase(), r.display_name]));
// "Creator" belongs to the creator: nobody else can have that word anywhere in their username or display name. Their old
// username, Manhatukfayay, is kept for them too, so nobody can pretend to be them.
const isCreator = username => username?.toLowerCase() === "creator";
const creatorOnlyName = name => /creator|manhatukfayay/i.test(name.replace(/\s/g, ""));
const CREATOR_ONLY = "Only the creator can have that name.";
const isAdmin = userId => ADMINS.includes(db.prepare("SELECT username FROM users WHERE id=?").get(userId || 0)?.username.toLowerCase());
function publicUser(row) {
  return row ? { id: row.id, accountNumber: accountNumber(row.id), username: row.username, mc: row.mc, lc: row.lc, handTone: row.hand_tone, avatar: avatarOf(row), theme: row.adult_on ? row.zone_theme : row.theme, song: row.song, admin: ADMINS.includes(row.username.toLowerCase()), creator: isCreator(row.username), suspended: suspensionOf(row),
    religion: row.religion, country: row.country,
    adult: { verified: Boolean(row.adult_verified_at), on: Boolean(row.adult_on) },
    kid: { ready: Boolean(row.kid_pass_hash), face: Boolean(row.kid_face), on: Boolean(row.kid_on), birthDates: Boolean(row.kid_birth_dates) },
    ...assistantInfo(row.id, row.id) } : null;
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
// ---- Kiddy zone 🧸 ----
// A zone for kids that a parent turns on: they give their email, type the code sent to it, choose a parent-only
// password, scan their face if they want, and fill in the child's and their own birth dates (kept private). In the zone a kid only sees posts made there, can only add and talk to friends who are
// in it too, and only has Feed, Profile, Settings, Friends, Nails, Learn and the Shop. Only the parent password turns it off,
// and only the parent's face can sign out.
const kidRow = userId => db.prepare("SELECT kid_email AS email, kid_pass_hash AS passHash, kid_face AS face, kid_on AS zone FROM users WHERE id=?").get(userId || 0);
const inKidZone = userId => Boolean(kidRow(userId)?.zone);
// Which posts someone sees and makes: [adult, kid].
const postZone = userId => [inZone(userId) ? 1 : 0, inKidZone(userId) ? 1 : 0];
// Two people can talk unless one of them is in a zone: in the 18+ zone both have to be 18+, and in the kiddy zone
// both have to be in it.
const canTalk = (a, b) => inKidZone(a) || inKidZone(b) ? inKidZone(a) && inKidZone(b) : (!inZone(a) && !inZone(b)) || (isAdult(a) && isAdult(b));
const talkError = (me, other) => inKidZone(me) ? "You're in the kiddy zone, so you can only talk to friends who are in it too."
  : inKidZone(other) ? "They're in the kiddy zone right now, so you can't talk to them."
  : inZone(me) ? "You're in the 18+ zone, so you can only talk to people who are 18+." : "They're in the 18+ zone right now, so you can't talk to them.";
// 18+ groups are only for people in the zone, and people in the zone can only use 18+ groups. Groups aren't in the kiddy zone.
// Says what's wrong (and the status to answer with) when someone can't use a group from where they are.
function groupZoneError(userId, group) {
  if (inKidZone(userId)) return { status: 403, error: "Groups aren't in the kiddy zone." };
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
      u.adult_verified_at, u.adult_on, u.kid_on
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id=? OR f.addressee_id=?
    ORDER BY u.username COLLATE NOCASE
  `).all(userId, userId, userId, userId);
  const pending = rows.filter(r => r.status === "pending");
  const request = r => ({ requestId: r.id, userId: r.userId, username: r.username, avatar: avatarOf(r), createdAt: r.createdAt });
  const me = adultRow(userId), kid = inKidZone(userId);
  const talks = r => kid || r.kid_on ? Boolean(kid && r.kid_on) : (!me?.zone && !r.adult_on) || Boolean(me?.verifiedAt && r.adult_verified_at);
  return {
    ai: { ...AI, unread: db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE user_id=? AND read_at IS NULL").get(userId).n },
    friends: rows.filter(r => r.status === "accepted").map(r => ({ id: r.userId, username: r.username, handTone: r.handTone, avatar: avatarOf(r), unread: r.unread, canTalk: talks(r) })),
    incoming: pending.filter(r => r.requesterId !== userId).map(request),
    outgoing: pending.filter(r => r.requesterId === userId).map(request),
    blocked: db.prepare(`SELECT u.id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=? ORDER BY u.username COLLATE NOCASE`).all(userId).map(r => ({ id: r.id, username: r.username, avatar: avatarOf(r) })),
    follows: followCounts(userId),
    nicknames: nicknamesOf(userId)
  };
}
// The nicknames someone gave their friends, by username in small letters.
const nicknamesOf = userId => Object.fromEntries(db.prepare(`SELECT u.id, u.username, n.nickname FROM nicknames n JOIN users u ON u.id=n.friend_id
  WHERE n.owner_id=?`).all(userId).filter(r => areFriends(userId, r.id)).map(r => [r.username.toLowerCase(), r.nickname]));
const followCounts = userId => ({
  followers: db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followee_id=?").get(userId).n,
  following: db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id=?").get(userId).n
});
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

// ---- 🔔 Notifications and @tags ----
// Tells someone what another person did, for their 🔔 bell. Nothing goes to yourself, between people where one blocked
// the other, or twice for the same thing (like liking a post, unliking it and liking it again).
function notify(userId, actorId, kind, { postId = null, commentId = null, messageId = null, emoji = null } = {}) {
  if (!userId || !actorId || userId === actorId || !canSee(userId, actorId)) return;
  const same = db.prepare(`SELECT 1 FROM notifications WHERE user_id=? AND actor_id=? AND kind=? AND post_id IS ? AND comment_id IS ? AND message_id IS ? AND emoji IS ?`)
    .get(userId, actorId, kind, postId, commentId, messageId, emoji);
  if (!same) db.prepare("INSERT INTO notifications(user_id,actor_id,kind,post_id,comment_id,message_id,emoji) VALUES(?,?,?,?,?,?,?)")
    .run(userId, actorId, kind, postId, commentId, messageId, emoji);
}
// Writing @username in a post, a comment or a chat message tags that person. The same pattern is in app.js.
const MENTION = /(^|[^A-Za-z0-9@])@([A-Za-z0-9]{3,20})(?![A-Za-z0-9])/g;
const MAX_TAGS = 20;
function taggedIds(...texts) {
  const names = [...new Set([...texts.join(" ").matchAll(MENTION)].map(m => m[2].toLowerCase()))].slice(0, MAX_TAGS);
  return names.map(name => db.prepare("SELECT id FROM users WHERE username=?").get(name)?.id).filter(Boolean);
}
// Tags in a post or one of its comments only reach people who can see that post.
function notifyPostTags(actorId, postId, texts, commentId = null, except = []) {
  const post = playlistPost(postId);
  for (const id of taggedIds(...texts)) if (post && !except.includes(id) && canOpenPost(id, post)) notify(id, actorId, "tag", { postId, commentId });
}
// Tags in a friend chat only reach the friend. Tags in a group chat reach anyone who could use that group from their zone,
// even if they're not in it: they can then see the messages they were tagged in there, and nothing else (see /tagged).
function notifyChatTags(actorId, chat, messageId, body) {
  const group = chat.groupKey && findGroup(chat.groupKey);
  for (const id of taggedIds(body)) {
    const reaches = group ? !groupZoneError(id, group) : id === chat.friendId;
    if (reaches) notify(id, actorId, "tag", { messageId });
  }
}
// A group's name and icon, and whether someone is in it, for their notifications.
function groupBrief(key, userId) {
  const group = findGroup(key), row = group && (group.secret || db.prepare("SELECT name, icon FROM community_groups WHERE id=?").get(group.id));
  return row ? { key: group.key, name: row.name, icon: row.icon, member: isGroupMember(userId, group), secret: Boolean(group.secret) } : null;
}
const NOTIFICATIONS_SHOWN = 50;
// Someone's newest notifications, leaving out people they can't see (because of a block) and deleted messages.
function notificationsPayload(userId) {
  const rows = db.prepare(`SELECT n.id, n.kind, n.emoji, n.created_at AS createdAt, n.read_at AS readAt, n.comment_id AS commentId,
      n.actor_id AS actorId, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      p.id AS postId, p.code AS postCode, p.group_key AS postGroup, c.body AS commentBody,
      m.id AS messageId, m.group_key AS messageGroup, m.deleted_at AS messageDeleted
    FROM notifications n JOIN users u ON u.id=n.actor_id
      LEFT JOIN posts p ON p.id=n.post_id LEFT JOIN comments c ON c.id=n.comment_id LEFT JOIN messages m ON m.id=n.message_id
    WHERE n.user_id=? ORDER BY n.id DESC LIMIT ?`).all(userId, NOTIFICATIONS_SHOWN * 2);
  const notifications = rows.filter(n => canSee(userId, n.actorId) && !n.messageDeleted).slice(0, NOTIFICATIONS_SHOWN).map(n => ({
    id: n.id, kind: n.kind, emoji: n.emoji, createdAt: n.createdAt, read: Boolean(n.readAt),
    actor: { id: n.actorId, username: n.username, avatar: avatarOf(n) },
    post: n.postId ? { id: n.postId, code: n.postCode, groupKey: n.postGroup } : null,
    comment: n.commentId ? { id: n.commentId, preview: n.commentBody.slice(0, 80) } : null,
    // A message is in a group's chat (which you might not be in), or in your chat with the person who did it.
    message: n.messageId ? { id: n.messageId, group: n.messageGroup ? groupBrief(n.messageGroup, userId) : null, friendId: n.messageGroup ? null : n.actorId } : null
  }));
  return { notifications, unread: unreadNotifications(userId) };
}
const unreadNotifications = userId => db.prepare(`SELECT COUNT(*) AS n FROM notifications n LEFT JOIN messages m ON m.id=n.message_id
  WHERE n.user_id=? AND n.read_at IS NULL AND m.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocks b
    WHERE (b.blocker_id=n.user_id AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=n.user_id))`).get(userId).n;
// The friend in the URL. Only friends can chat with each other.
function chatFriend(req, res) {
  const friendId = Number(req.params.userId);
  if (!Number.isSafeInteger(friendId) || !areFriends(req.session.userId, friendId)) { res.status(403).json({ error: "You can only chat with your friends." }); return null; }
  if (!canTalk(req.session.userId, friendId)) { res.status(403).json({ error: talkError(req.session.userId, friendId) }); return null; }
  return friendId;
}
// A chat is a group's chat or a chat between two friends; `where` picks its messages.
const groupChatFor = (group, userId) => ({
  where: "m.group_key=?", params: [group.key], groupKey: group.key,
  // The person who made a group can delete anyone's messages in it.
  moderator: (!group.secret && db.prepare("SELECT owner_id FROM community_groups WHERE id=?").get(group.id)?.owner_id === userId) || isAdmin(userId)
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
  const reactions = reactionsOn("message_reactions", "message_id", rows, viewerId);
  return {
    messages: rows.map(m => ({
      id: m.id, rev: m.rev, userId: m.userId, username: m.username, avatar: avatarOf(m), body: m.body, forwarded: Boolean(m.forwarded),
      createdAt: m.createdAt, editedAt: m.editedAt, deleted: Boolean(m.deletedAt), reactions: reactions[m.id] || []
    })),
    rev: db.prepare(`SELECT COALESCE(MAX(m.rev), 0) AS rev FROM messages m WHERE ${chat.where}`).get(...chat.params).rev
  };
}
// The reactions on some messages or comments (`rows`), by id: each emoji with how many, whether the viewer picked it, and who did.
function reactionsOn(table, column, rows, viewerId) {
  const reactions = {};
  if (rows.length) for (const r of db.prepare(`SELECT r.${column} AS id, r.emoji, r.user_id AS userId, u.username
      FROM ${table} r JOIN users u ON u.id=r.user_id
      WHERE r.${column} IN (${rows.map(() => "?").join(",")}) ORDER BY r.created_at, r.rowid`).all(...rows.map(m => m.id))) {
    const list = (reactions[r.id] ||= []);
    let e = list.find(x => x.emoji === r.emoji);
    if (!e) list.push(e = { emoji: r.emoji, count: 0, mine: false, users: [] });
    e.count++; e.mine ||= r.userId === viewerId; e.users.push(r.username);
  }
  return reactions;
}
const insertMessage = (chat, senderId, body, forwarded = 0) => db.prepare("INSERT INTO messages(group_key,sender_id,recipient_id,body,forwarded,rev) VALUES(?,?,?,?,?,?)")
  .run(chat.groupKey ?? null, senderId, chat.friendId ?? null, body, forwarded, nextRev());
const markRead = (me, chat) => { if (chat.friendId) db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE sender_id=? AND recipient_id=? AND read_at IS NULL").run(chat.friendId, me); };
// Posts as the browser shows them; `where` picks which ones, in id order ("DESC" is newest first).
function selectPosts(viewerId, where, params, order = "DESC", limit = 100) {
  return db.prepare(`
    SELECT p.id, p.code, p.user_id AS userId, u.username, p.caption, p.description, p.visibility, p.group_key AS groupKey, p.media_path AS mediaPath,
      p.thumb_path AS thumbPath, p.media_type AS mediaType, p.created_at AS createdAt, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,
      EXISTS(SELECT 1 FROM playlist s WHERE s.post_id=p.id AND s.user_id=?) AS inPlaylist,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=c.user_id)) AS comments
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE ${where}
    ORDER BY p.id ${order} LIMIT ?
  `).all(viewerId || 0, viewerId || 0, viewerId || 0, ...params, limit).map(p => ({
    id: p.id, code: p.code, userId: p.userId, username: p.username, avatar: avatarOf(p), caption: p.caption, description: p.description, visibility: p.visibility, inGroup: Boolean(p.groupKey),
    mediaUrl: p.mediaPath ? `/uploads/${encodeURIComponent(p.mediaPath)}` : null, thumbUrl: p.thumbPath ? `/uploads/${encodeURIComponent(p.thumbPath)}` : null,
    mediaType: p.mediaType, createdAt: p.createdAt, likes: p.likes, liked: Boolean(p.liked), inPlaylist: Boolean(p.inPlaylist), comments: p.comments
  }));
}
// The newest 100 posts on the main feed (or in a group) the viewer may see (public, or unlisted by them or a friend),
// hiding people the viewer blocked.
function postRows(viewerId, groupKey = null) {
  const v = viewerId || 0;
  return selectPosts(viewerId, `p.group_key IS ? AND ${SEES_POST} AND p.adult=? AND p.kid=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=p.user_id)`, [groupKey, v, v, v, ...postZone(viewerId), v]);
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
  if (!u) return res.json({ user: null, products, themes, nailOptions, avatarOptions, reportReasons: REPORT_REASONS, religions: RELIGIONS, countries: COUNTRIES, displayNames: displayNames() });
  res.json({ user: publicUser(u), displayNames: displayNames(), notifications: unreadNotifications(u.id), inventory: inventoryOf(u.id), products, themes, nailOptions, avatarOptions, reportReasons: REPORT_REASONS, religions: RELIGIONS, countries: COUNTRIES, learn: learnPayload(u.id), usernameCost: USERNAME_COST, songs: songsPayload(u.id) });
});

// ---- Religion and country ----
// Everyone chooses both when they make an account (older accounts are asked once), and they show on their profile for
// everyone to see. Only people whose religion is Islam can open Learn's Islam subject, and only Muslims from Bangladesh
// can play the Quran Gojol song.
const RELIGIONS = [
  { id: "islam", name: "Islam", icon: "☪️" },
  { id: "christianity", name: "Christianity", icon: "✝️" },
  { id: "hinduism", name: "Hinduism", icon: "🕉️" },
  { id: "buddhism", name: "Buddhism", icon: "☸️" },
  { id: "judaism", name: "Judaism", icon: "✡️" },
  { id: "sikhism", name: "Sikhism", icon: "☬" },
  { id: "other", name: "Other religion", icon: "🙏" },
  { id: "none", name: "No religion", icon: "🌱" }
];
// Every country by its two-letter code, with its English name and flag, in A to Z order.
const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" }), COUNTRY_NAME_FIXES = { PS: "Palestine" };
const COUNTRIES = `AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF
  CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL
  GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI
  LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM
  PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD
  TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(/\s+/)
  .map(code => ({ code, name: COUNTRY_NAME_FIXES[code] || COUNTRY_NAMES.of(code), flag: String.fromCodePoint(...[...code].map(c => 0x1F1A5 + c.charCodeAt(0))) }))
  .sort((a, b) => a.name.localeCompare(b.name));
// What's wrong with a chosen religion and country, if anything.
const identityProblem = (religion, country) => !RELIGIONS.some(r => r.id === religion) ? "Choose your religion."
  : !COUNTRIES.some(c => c.code === country) ? "Choose your country." : null;
const identityOf = userId => db.prepare("SELECT religion, country FROM users WHERE id=?").get(userId) || {};
const isMuslim = userId => identityOf(userId).religion === "islam";
// Accounts made before religion and country were asked for choose them once.
app.put("/api/me/identity", requireAuth, (req, res) => {
  const me = req.session.userId, { religion, country } = req.body;
  const had = identityOf(me);
  if (had.religion && had.country) return res.status(400).json({ error: "Your religion and country are already chosen." });
  if (identityProblem(religion, country)) return res.status(400).json({ error: identityProblem(religion, country) });
  db.prepare("UPDATE users SET religion=?, country=? WHERE id=?").run(religion, country, me);
  res.json({ user: publicUser(currentUser(req)), songs: songsPayload(me) });
});

// What's wrong with a new username, if anything. Used when signing up and when changing your username.
const usernameProblem = name => /\s/.test(name) ? "Do not use spaces. Usernames can only have letters and numbers."
  : /[^A-Za-z0-9]/.test(name) ? "Do not use symbols. Usernames can only have letters and numbers."
  : name.length < 3 || name.length > 20 ? "Username must be 3–20 letters or numbers." : null;
const COPIED_USERNAME = "Do not copy usernames. Someone already has that username, and changing capital letters still counts as the same name.";
app.post("/api/signup", authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (usernameProblem(username)) return res.status(400).json({ error: usernameProblem(username) });
    if (creatorOnlyName(username)) return res.status(403).json({ error: CREATOR_ONLY });
    // Passwords can have any letters, numbers, symbols or emojis, but no spaces.
    if (/\s/.test(password)) return res.status(400).json({ error: "Do not use spaces in your password." });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must be 8–200 characters." });
    const { religion, country } = req.body;
    if (identityProblem(religion, country)) return res.status(400).json({ error: identityProblem(religion, country) });
    const hash = await bcrypt.hash(password, 12);
    if ((db.prepare("SELECT seq FROM sqlite_sequence WHERE name='users'").get()?.seq || 0) >= MAX_ACCOUNTS) {
      return res.status(403).json({ error: "Yakimma is full: every account number has been given out." });
    }
    // Usernames are compared ignoring capitals (the column is COLLATE NOCASE), so "Cutie" and "cutie" are the same name.
    const result = db.prepare("INSERT INTO users(username,password_hash,mc,religion,country) VALUES(?,?,0,?,?)").run(username, hash, religion, country);
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = Number(result.lastInsertRowid);
      res.json({ user: publicUser(currentUser(req)), products });
    });
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: COPIED_USERNAME });
    next(err);
  }
});

// Songs to play while you use Yakimma, picked in Settings. Each one plays from public/songs/<file>, and one whose
// file isn't there yet shows as "Not added yet". Songs marked `adult` only unlock once you've been in the 18+ zone
// (passed the 18+ checks; admins can always use them), and they and songs marked `notKids` are locked in the kiddy
// zone. Songs marked `bangladeshiMuslim` only unlock for people whose religion is Islam and whose country is Bangladesh.
// Every other song plays in any zone. Songs marked `last` (Quran Gojol) always show at the bottom of the list, below
// any songs added after them. To add a song, put its .mp3 in public/songs and add it here.
const SONGS = [
  { id: "none", name: "Default (No Song)" },
  { id: "gnarlyyy", name: "Gnarlyyy", file: "gnarlyyy.mp3", adult: true },
  { id: "gameboy", name: "GameBoy", file: "gameboy.mp3" },
  { id: "dolly-babe", name: "Dolly Babe", file: "dolly-babe.mp3", adult: true },
  { id: "i-know-you-belongg", name: "I Know You Belongg", file: "i-know-you-belongg.mp3", adult: true },
  { id: "how-you-like-that", name: "How You Like That?", file: "how-you-like-that.mp3" },
  { id: "quran-gojol", name: "Quran Gojol", file: "quran-gojol.mp3", bangladeshiMuslim: true, last: true },
  { id: "love-funk", name: "Love Funk", file: "love-funk.mp3" },
  { id: "thats-how-life-goes", name: "That's How Life Goes", file: "thats-how-life-goes.mp3" },
  { id: "trending", name: "Trending", file: "trending.mp3" }
].sort((a, b) => Boolean(a.last) - Boolean(b.last));
// Each song with whether its file is there and why it's locked for this person, if it is: "adult" (not been in the
// 18+ zone yet), "kids" (they're in the kiddy zone) or "bangladeshiMuslim" (their religion isn't Islam or their country
// isn't Bangladesh).
function songsPayload(userId) {
  const grown = isAdult(userId) || isAdmin(userId), kid = inKidZone(userId), { religion, country } = identityOf(userId);
  const bangladeshiMuslim = religion === "islam" && country === "BD";
  return SONGS.map(s => ({ ...s, ready: !s.file || fs.existsSync(path.join(__dirname, "public", "songs", s.file)),
    lock: s.adult && !grown ? "adult" : (s.adult || s.notKids) && kid ? "kids" : s.bangladeshiMuslim && !bangladeshiMuslim ? "bangladeshiMuslim" : null }));
}
app.put("/api/me/song", requireAuth, (req, res) => {
  const song = songsPayload(req.session.userId).find(s => s.id === req.body.song);
  if (!song) return res.status(400).json({ error: "There's no song like that." });
  if (!song.ready) return res.status(400).json({ error: `${song.name} isn't added to Yakimma yet.` });
  if (song.lock) return res.status(403).json({ error: { adult: `${song.name} unlocks once you've been in the 18+ zone.`, kids: `${song.name} isn't in the kiddy zone.`,
    bangladeshiMuslim: `${song.name} is only for Muslims from Bangladesh.` }[song.lock] });
  db.prepare("UPDATE users SET song=? WHERE id=?").run(song.id, req.session.userId);
  res.json({ user: publicUser(currentUser(req)) });
});

// Changing your username on your Profile. Changing only capital letters (like "cutie" to "Cutie") is free; a whole new
// username costs USERNAME_COST MC. Nobody can copy someone else's username. Admin powers come from the username, so
// admins can only change their capital letters, and nobody else can take an admin's name.
const USERNAME_COST = 50;
app.put("/api/me/username", requireAuth, (req, res) => {
  const me = currentUser(req), username = String(req.body.username || "").trim(), whole = req.body.whole === true;
  if (usernameProblem(username)) return res.status(400).json({ error: usernameProblem(username) });
  if (username === me.username) return res.status(400).json({ error: "That's already your username." });
  if (creatorOnlyName(username) && !isCreator(me.username)) return res.status(403).json({ error: CREATOR_ONLY });
  const sameLetters = username.toLowerCase() === me.username.toLowerCase();
  if (!whole && !sameLetters) return res.status(400).json({ error: "Here you can only change which letters are capitals. For new letters, use Change Whole Username." });
  if (whole && sameLetters) return res.status(400).json({ error: "That only changes capital letters, which is free. Use Change Capitalization instead." });
  if (whole && isAdmin(me.id)) return res.status(403).json({ error: "Admin usernames can only change their capital letters." });
  const taken = [...ADMINS, ...FACE_SCAN_SKIPPERS].includes(username.toLowerCase()) || db.prepare("SELECT 1 FROM users WHERE username=? AND id<>?").get(username, me.id);
  if (whole && taken) return res.status(409).json({ error: COPIED_USERNAME });
  if (whole && me.mc < USERNAME_COST) return res.status(400).json({ error: `A whole new username costs ${USERNAME_COST} MC, and you have ${me.mc} MC.` });
  try {
    db.transaction(() => {
      db.prepare("UPDATE users SET username=? WHERE id=?").run(username, me.id);
      if (whole) db.prepare("UPDATE users SET mc=mc-? WHERE id=?").run(USERNAME_COST, me.id);
    })();
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: COPIED_USERNAME });
    throw err;
  }
  res.json({ user: publicUser(currentUser(req)) });
});

// Admins set their display name on their Profile. Leaving it empty takes it away.
app.put("/api/me/display-name", requireAuth, (req, res) => {
  const me = currentUser(req), name = String(req.body.displayName ?? "").trim().replace(/\s+/g, " ");
  if (!canHaveDisplayName(me.username)) return res.status(403).json({ error: "Only admins can have a display name." });
  if ([...name].length > 30) return res.status(400).json({ error: "Display names can be up to 30 characters." });
  if (/\p{Cc}/u.test(name)) return res.status(400).json({ error: "That display name has a character that can't be used." });
  if (name && creatorOnlyName(name) && !isCreator(me.username)) return res.status(403).json({ error: CREATOR_ONLY });
  db.prepare("UPDATE users SET display_name=? WHERE id=?").run(name || null, me.id);
  res.json({ user: publicUser(currentUser(req)), displayNames: displayNames() });
});

app.post("/api/login", authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "Username or password is incorrect." });
    if (suspensionOf(row)) return res.status(403).json({ error: suspendedMessage(suspensionOf(row)) });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = row.id;
      res.json({ user: publicUser(currentUser(req)), products });
    });
  } catch (err) { next(err); }
});

// In the kiddy zone only a parent (or an admin) can sign out: with the parent password, or a face scan that matches the
// parent's saved face.
app.post("/api/logout", kidFaceLimiter, async (req, res, next) => {
  const me = req.session.userId, kid = kidRow(me);
  if (kid?.zone && !isAdmin(me)) {
    if (req.body.face !== undefined) {
      const face = cleanFace(req.body.face);
      if (!kid.face) return res.status(400).json({ error: "No parent face is saved yet, so use the parent password." });
      if (!face || !sameFace(face, JSON.parse(kid.face))) return res.status(403).json({ error: "That isn't the parent's face, so you can't sign out of the kiddy zone." });
    } else {
      try { if (!await parentPasswordOk(me, req.body.password)) return wrongParentPassword(res); } catch (err) { return next(err); }
    }
  }
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
  const me = req.session.userId, oldest = req.query.order === "oldest", after = Number(req.query.after), zone = postZone(me);
  const from = Number.isSafeInteger(after) && after > 0 ? ` AND p.id ${oldest ? ">" : "<"} ?` : "";
  const posts = selectPosts(me, `p.user_id=? AND p.group_key IS NULL AND p.adult=? AND p.kid=?${from}`, from ? [me, ...zone, after] : [me, ...zone], oldest ? "ASC" : "DESC", MY_POSTS_PAGE + 1);
  res.json({
    posts: posts.slice(0, MY_POSTS_PAGE), more: posts.length > MY_POSTS_PAGE,
    total: db.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND group_key IS NULL AND adult=? AND kid=?").get(me, ...zone).n
  });
});

// Makes a post on the main feed, or inside a group when groupKey is given.
function createPost(req, res, next, groupKey) {
  upload.fields([{ name: "media", maxCount: 1 }, { name: "thumb", maxCount: 1 }])(req, res, err => {
    if (err) return apiError(err, req, res, next);
    req.file = req.files?.media?.[0];
    // A thumbnail is only kept for a video, and only if it's a real picture.
    const thumbFile = req.files?.thumb?.[0];
    const thumb = thumbFile && req.file?.mimetype.startsWith("video/") && thumbFile.mimetype.startsWith("image/") && isImageFile(thumbFile.path) ? thumbFile : null;
    if (thumbFile && !thumb) fs.unlink(thumbFile.path, () => {});
    try {
      const caption = String(req.body.caption || "").trim().slice(0, 240), description = String(req.body.description || "").trim().slice(0, MAX_DESCRIPTION);
      // Group posts are always public to the group.
      const visibility = !groupKey && VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : "public";
      if (!caption) {
        for (const f of [req.file, thumb]) if (f) fs.unlink(f.path, () => {});
        return res.status(400).json({ error: "Add a caption before posting." });
      }
      const type = req.file ? req.file.mimetype : null;
      const code = newPostCode();
      const result = db.prepare("INSERT INTO posts(user_id,code,caption,description,visibility,media_path,media_type,thumb_path,group_key,adult,kid) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(req.session.userId, code, caption, description, visibility, req.file ? path.basename(req.file.filename) : null, type, thumb ? path.basename(thumb.filename) : null, groupKey, ...postZone(req.session.userId));
      notifyPostTags(req.session.userId, Number(result.lastInsertRowid), [caption, description]);
      res.status(201).json({ postId: Number(result.lastInsertRowid), code, posts: postRows(req.session.userId, groupKey) });
    } catch (e) { next(e); }
  });
}
app.post("/api/posts", requireAuth, (req, res, next) => createPost(req, res, next, null));

// One post, for its link (/post/<code>): public posts for anyone who could see them from where they are, unlisted ones
// only for the person's friends, and private ones only for the person who posted them. Older links used the post's number.
app.get("/api/posts/:key", (req, res) => {
  const me = currentUser(req)?.id || 0, key = String(req.params.key), byNumber = /^\d+$/.test(key);
  const [post] = selectPosts(me, `${byNumber ? "p.id=?" : "p.code=?"} AND p.group_key IS NULL AND p.adult=? AND p.kid=?`, [byNumber ? Number(key) : key, ...postZone(me)], "DESC", 1);
  const blocked = post && me && db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(me, post.userId, post.userId, me);
  if (!post || blocked || !seesPost(me, post)) return res.status(404).json({ error: "This post isn't available. It may be only for friends, private, or deleted." });
  res.json({ post });
});

// Changing who can see your own post, any time. Group posts are always public to the group.
app.put("/api/posts/:id/visibility", requireAuth, (req, res) => {
  const me = req.session.userId, post = db.prepare("SELECT id, user_id, group_key FROM posts WHERE id=?").get(Number(req.params.id)), visibility = req.body.visibility;
  if (!post || post.user_id !== me) return res.status(404).json({ error: "You can only change your own posts." });
  if (post.group_key) return res.status(400).json({ error: "Group posts are always seen by the whole group." });
  if (!VISIBILITIES.includes(visibility)) return res.status(400).json({ error: "Choose Public, Unlisted or Private." });
  db.prepare("UPDATE posts SET visibility=? WHERE id=?").run(visibility, post.id);
  res.json({ ok: true, visibility });
});

// The person who posted a video can give it a thumbnail, or a new one, any time.
app.put("/api/posts/:id/thumbnail", requireAuth, (req, res, next) => {
  const post = db.prepare("SELECT id, user_id, media_type, thumb_path FROM posts WHERE id=?").get(Number(req.params.id));
  if (!post || post.user_id !== req.session.userId) return res.status(404).json({ error: "You can only change your own posts." });
  if (!post.media_type?.startsWith("video/")) return res.status(400).json({ error: "Only videos have thumbnails." });
  thumbUpload.single("thumb")(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Thumbnails must be 5 MB or smaller." : err.message || "Upload could not be completed." });
    if (!req.file) return res.status(400).json({ error: "Choose a picture first." });
    try {
      if (!isImageFile(req.file.path)) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: "That file isn't a picture we can use." }); }
      db.prepare("UPDATE posts SET thumb_path=? WHERE id=?").run(req.file.filename, post.id);
      if (post.thumb_path) fs.unlink(path.join(uploadDir, path.basename(post.thumb_path)), () => {});
      res.json({ thumbUrl: `/uploads/${encodeURIComponent(req.file.filename)}` });
    } catch (e) { next(e); }
  });
});

// You can delete your own posts (videos, photos and text). Admins can delete anyone's.
app.delete("/api/posts/:id", requireAuth, (req, res) => {
  const me = req.session.userId, post = db.prepare("SELECT id, user_id, media_path, thumb_path FROM posts WHERE id=?").get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: "That post is already gone." });
  if (post.user_id !== me && !isAdmin(me)) return res.status(403).json({ error: "You can only delete your own posts." });
  db.prepare("DELETE FROM posts WHERE id=?").run(post.id);
  for (const file of [post.media_path, post.thumb_path]) if (file) fs.unlink(path.join(uploadDir, path.basename(file)), () => {});
  res.json({ ok: true });
});

// Reporting someone else's post. Each person can report a post once (reporting again changes the reason).
const REPORT_REASONS = ["😠 Mean or bullying", "🧸 Not OK for kids", "📢 Spam", "❓ Something else"];
const SOMETHING_ELSE = REPORT_REASONS.at(-1), MAX_REPORT_DETAILS = 500;
const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "You're reporting a lot. Please wait a little while." } });
app.post("/api/posts/:id/report", requireAuth, reportLimiter, (req, res) => {
  const me = req.session.userId, post = db.prepare("SELECT id, user_id AS userId, user_id, adult, kid, visibility FROM posts WHERE id=?").get(Number(req.params.id)), [adult, kid] = postZone(me);
  if (!post || post.adult !== adult || post.kid !== kid || !seesPost(me, post)) return res.status(404).json({ error: "Post not found." });
  if (post.user_id === me) return res.status(400).json({ error: "You can't report your own post. You can delete it instead." });
  if (!REPORT_REASONS.includes(req.body.reason)) return res.status(400).json({ error: "Choose why you're reporting it." });
  // "Something else" has to say what's wrong, in the reporter's own words. The other reasons don't take any words.
  const details = req.body.reason === SOMETHING_ELSE ? cleanText(req.body.details).slice(0, MAX_REPORT_DETAILS) : null;
  if (req.body.reason === SOMETHING_ELSE && details.length < 3) return res.status(400).json({ error: "Write what's wrong in your own words, so the admins know." });
  db.prepare(`INSERT INTO post_reports(post_id,reporter_id,reason,details) VALUES(?,?,?,?)
    ON CONFLICT(post_id,reporter_id) DO UPDATE SET reason=excluded.reason, details=excluded.details, created_at=CURRENT_TIMESTAMP`).run(post.id, me, req.body.reason, details);
  res.json({ ok: true });
});
// Reporting someone else's comment works the same way.
app.post("/api/comments/:id/report", requireAuth, reportLimiter, (req, res) => {
  const me = req.session.userId, found = seenComment(req, res);
  if (!found) return;
  if (found.comment.userId === me) return res.status(400).json({ error: "You can't report your own comment. You can delete it instead." });
  if (!REPORT_REASONS.includes(req.body.reason)) return res.status(400).json({ error: "Choose why you're reporting it." });
  const details = req.body.reason === SOMETHING_ELSE ? cleanText(req.body.details).slice(0, MAX_REPORT_DETAILS) : null;
  if (req.body.reason === SOMETHING_ELSE && details.length < 3) return res.status(400).json({ error: "Write what's wrong in your own words, so the admins know." });
  db.prepare(`INSERT INTO comment_reports(comment_id,reporter_id,reason,details) VALUES(?,?,?,?)
    ON CONFLICT(comment_id,reporter_id) DO UPDATE SET reason=excluded.reason, details=excluded.details, created_at=CURRENT_TIMESTAMP`).run(found.comment.id, me, req.body.reason, details);
  res.json({ ok: true });
});
// The Reports page, for admins (it isn't in the kiddy zone): reported 18+ posts in the 18+ zone, and reported posts from
// the normal site and the kiddy zone everywhere else, newest report first, with who reported them and why.
function requireAdmin(req, res, next) {
  if (!isAdmin(req.session.userId)) return res.status(403).json({ error: "Only Yakimma's admins can see reports." });
  next();
}
function reportsPayload(userId) {
  const reports = {};
  for (const r of db.prepare(`SELECT r.post_id AS postId, r.reason, r.details, r.created_at AS createdAt, u.id AS reporterId, u.username, p.kid FROM post_reports r
    JOIN users u ON u.id=r.reporter_id JOIN posts p ON p.id=r.post_id ORDER BY r.created_at DESC`).all()) (reports[r.postId] ||= []).push(r);
  const posts = selectPosts(userId, "p.id IN (SELECT post_id FROM post_reports) AND p.adult=?", [inZone(userId) ? 1 : 0], "DESC", 200)
    .map(p => ({ ...p, kid: Boolean(reports[p.id][0].kid), reports: reports[p.id].map(({ kid, ...r }) => r) }))
    .sort((a, b) => b.reports[0].createdAt.localeCompare(a.reports[0].createdAt));
  // Reported comments, with the post they're on, newest report first.
  const byComment = {};
  for (const r of db.prepare(`SELECT r.comment_id AS commentId, r.reason, r.details, r.created_at AS createdAt, u.id AS reporterId, u.username
    FROM comment_reports r JOIN users u ON u.id=r.reporter_id JOIN comments c ON c.id=r.comment_id JOIN posts p ON p.id=c.post_id
    WHERE p.adult=? ORDER BY r.created_at DESC`).all(inZone(userId) ? 1 : 0)) (byComment[r.commentId] ||= []).push(r);
  const comments = Object.keys(byComment).map(Number).map(id => {
    const c = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, c.user_id AS userId, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      p.id AS postId, p.code AS postCode, p.caption AS postCaption, p.group_key AS postGroup, p.user_id AS postUserId, p.kid
      FROM comments c JOIN users u ON u.id=c.user_id JOIN posts p ON p.id=c.post_id WHERE c.id=?`).get(id);
    return { id: c.id, body: c.body, createdAt: c.createdAt, userId: c.userId, username: c.username, avatar: avatarOf(c), kid: Boolean(c.kid),
      post: { id: c.postId, code: c.postCode, caption: c.postCaption, groupKey: c.postGroup },
      canDelete: canDeleteComment(userId, { userId: c.userId }, { userId: c.postUserId }), reports: byComment[id] };
  });
  return { posts, comments };
}
app.get("/api/reports", requireAuth, requireAdmin, (req, res) => res.json(reportsPayload(req.session.userId)));
// Keeping a reported comment: its reports are cleared.
app.delete("/api/reports/comments/:commentId", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM comment_reports WHERE comment_id=?").run(Number(req.params.commentId));
  res.json(reportsPayload(req.session.userId));
});
// Keeping a reported post: its reports are cleared.
app.delete("/api/reports/:postId", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM post_reports WHERE post_id=?").run(Number(req.params.postId));
  res.json(reportsPayload(req.session.userId));
});

const likeTransaction = db.transaction((userId, postId) => {
  const post = db.prepare("SELECT id,user_id,user_id AS userId,group_key AS groupKey,adult,kid,visibility FROM posts WHERE id=?").get(postId), [adult, kid] = postZone(userId);
  if (!post || post.adult !== adult || post.kid !== kid || !seesPost(userId, post)) return { error: "Post not found.", status: 404 };
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
  notify(post.user_id, userId, "like", { postId });
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

// ---- Comments 💬 ----
// Anyone who can see a post can read its comments and write one (guests can only read), or reply to one. Replies are one
// level deep: a reply to a reply goes under the same comment. A comment can be deleted by the person who wrote it, the
// person whose post it is, or the creator, and its replies go with it. People can react to comments with emojis.
const MAX_COMMENT = 500, COMMENTS_SHOWN = 500;
const commentLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "You're commenting very fast. Take a little break and try again." } });
// The post in the URL, if the viewer can see it. Otherwise this answers with an error and returns null.
function seenPost(req, res) {
  const id = Number(req.params.id), post = Number.isSafeInteger(id) && playlistPost(id);
  if (!post || !canOpenPost(req.session.userId || 0, post)) { res.status(404).json({ error: "This post isn't available any more." }); return null; }
  return post;
}
// The comment in the URL and its post, if the viewer can see them.
function seenComment(req, res) {
  const id = Number(req.params.id), comment = Number.isSafeInteger(id) && db.prepare("SELECT id, post_id AS postId, user_id AS userId FROM comments WHERE id=?").get(id);
  const post = comment && playlistPost(comment.postId);
  if (!post || !canOpenPost(req.session.userId, post)) { res.status(404).json({ error: "That comment isn't there any more." }); return null; }
  return { comment, post };
}
const canDeleteComment = (userId, comment, post) => Boolean(userId) && (comment.userId === userId || post.userId === userId
  || isCreator(db.prepare("SELECT username FROM users WHERE id=?").get(userId)?.username));
// A post's comments, oldest first, each with its replies (oldest first), leaving out people the viewer blocked and
// replies to comments the viewer can't see.
function commentsPayload(viewerId, post) {
  const rows = db.prepare(`SELECT * FROM (
      SELECT c.id, c.parent_id AS parentId, c.user_id AS userId, c.body, c.created_at AS createdAt, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path
      FROM comments c JOIN users u ON u.id=c.user_id
      WHERE c.post_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=c.user_id)
      ORDER BY c.id DESC LIMIT ?
    ) ORDER BY id`).all(post.id, viewerId || 0, COMMENTS_SHOWN);
  const reactions = reactionsOn("comment_reactions", "comment_id", rows, viewerId);
  const shape = c => ({ id: c.id, userId: c.userId, username: c.username, avatar: avatarOf(c), body: c.body, createdAt: c.createdAt,
    reactions: reactions[c.id] || [], canDelete: canDeleteComment(viewerId, c, post) });
  const comments = rows.filter(c => !c.parentId).map(c => ({ ...shape(c), replies: rows.filter(r => r.parentId === c.id).map(shape) }));
  return { comments, count: comments.reduce((n, c) => n + 1 + c.replies.length, 0) };
}
app.get("/api/posts/:id/comments", (req, res) => {
  const post = seenPost(req, res);
  if (post) res.json(commentsPayload(req.session.userId, post));
});
app.post("/api/posts/:id/comments", requireAuth, commentLimiter, (req, res) => {
  const me = req.session.userId, post = seenPost(req, res);
  if (!post) return;
  const body = cleanText(req.body.body).slice(0, MAX_COMMENT);
  if (!body) return res.status(400).json({ error: "Write a comment first." });
  // A reply to a reply goes under the same comment.
  let parent = null;
  if (req.body.parentId != null) {
    parent = db.prepare("SELECT id, parent_id AS parentId, user_id AS userId FROM comments WHERE id=? AND post_id=?").get(Number(req.body.parentId), post.id);
    if (parent?.parentId) parent = db.prepare("SELECT id, user_id AS userId FROM comments WHERE id=?").get(parent.parentId);
    if (!parent || !canSee(me, parent.userId)) return res.status(404).json({ error: "That comment isn't there any more." });
  }
  const commentId = Number(db.prepare("INSERT INTO comments(post_id,user_id,body,parent_id) VALUES(?,?,?,?)").run(post.id, me, body, parent?.id ?? null).lastInsertRowid);
  if (parent) notify(parent.userId, me, "reply", { postId: post.id, commentId });
  if (parent?.userId !== post.userId) notify(post.userId, me, "comment", { postId: post.id, commentId });
  notifyPostTags(me, post.id, [body], commentId, [post.userId, parent?.userId]);
  res.status(201).json(commentsPayload(me, post));
});
app.delete("/api/comments/:id", requireAuth, (req, res) => {
  const me = req.session.userId, found = seenComment(req, res);
  if (!found) return;
  if (!canDeleteComment(me, found.comment, found.post)) return res.status(403).json({ error: "Only the person who wrote it, the person whose post it is, or the creator can delete this comment." });
  db.prepare("DELETE FROM comments WHERE id=?").run(found.comment.id);
  res.json(commentsPayload(me, found.post));
});
// Picking an emoji adds your reaction to a comment; picking the same one again takes it away.
app.post("/api/comments/:id/reactions", requireAuth, reactionLimiter, (req, res) => {
  const me = req.session.userId, found = seenComment(req, res);
  if (!found) return;
  const { comment, post } = found, emoji = String(req.body.emoji || "");
  if (!emojiSet.has(emoji)) return res.status(400).json({ error: "Pick one of the emojis." });
  const error = db.transaction(() => {
    if (db.prepare("DELETE FROM comment_reactions WHERE comment_id=? AND user_id=? AND emoji=?").run(comment.id, me, emoji).changes) return null;
    if (db.prepare("SELECT COUNT(*) AS n FROM comment_reactions WHERE comment_id=? AND user_id=?").get(comment.id, me).n >= MAX_REACTIONS) return `You can add up to ${MAX_REACTIONS} reactions to one comment.`;
    db.prepare("INSERT INTO comment_reactions(comment_id,user_id,emoji) VALUES(?,?,?)").run(comment.id, me, emoji);
    notify(comment.userId, me, "reaction", { postId: post.id, commentId: comment.id, emoji });
    return null;
  })();
  if (error) return res.status(400).json({ error });
  res.json(commentsPayload(me, post));
});

// ---- Playlist 🎶 ----
// Anyone signed in can put a post (theirs or someone else's) in the playlist on their Profile, to see it again later.
// The playlist only shows posts they can still see from where they are, newest added first, so posts that were deleted,
// made private, are from someone blocked, are in a group they left, or are from another zone drop out.
function canOpenPost(userId, post) {
  const [adult, kid] = postZone(userId);
  if (post.adult !== adult || post.kid !== kid || !seesPost(userId, post)) return false;
  if (db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(userId, post.userId, post.userId, userId)) return false;
  const group = post.groupKey && findGroup(post.groupKey);
  return !post.groupKey || Boolean(group && isGroupMember(userId, group));
}
const PLAYLIST_LIMIT = 200;
const playlistPost = id => db.prepare("SELECT id, user_id AS userId, visibility, group_key AS groupKey, adult, kid FROM posts WHERE id=?").get(id);
function playlistPayload(userId) {
  const ids = db.prepare(`SELECT p.id, p.user_id AS userId, p.visibility, p.group_key AS groupKey, p.adult, p.kid FROM playlist s JOIN posts p ON p.id=s.post_id
    WHERE s.user_id=? ORDER BY s.created_at DESC, s.rowid DESC LIMIT ?`).all(userId, PLAYLIST_LIMIT).filter(p => canOpenPost(userId, p)).map(p => p.id);
  if (!ids.length) return { posts: [] };
  const posts = selectPosts(userId, `p.id IN (${ids.map(() => "?").join(",")})`, ids, "DESC", ids.length);
  return { posts: ids.map(id => posts.find(p => p.id === id)).filter(Boolean) };
}
app.get("/api/me/playlist", requireAuth, (req, res) => res.json(playlistPayload(req.session.userId)));
app.post("/api/posts/:id/playlist", requireAuth, (req, res) => {
  const me = req.session.userId, post = playlistPost(Number(req.params.id));
  if (!post || !canOpenPost(me, post)) return res.status(404).json({ error: "That post isn't available any more." });
  if (db.prepare("SELECT COUNT(*) AS n FROM playlist WHERE user_id=?").get(me).n >= PLAYLIST_LIMIT) return res.status(400).json({ error: `Your playlist is full (${PLAYLIST_LIMIT} posts). Take some out first.` });
  db.prepare("INSERT OR IGNORE INTO playlist(user_id,post_id) VALUES(?,?)").run(me, post.id);
  res.json({ inPlaylist: true });
});
app.delete("/api/posts/:id/playlist", requireAuth, (req, res) => {
  db.prepare("DELETE FROM playlist WHERE user_id=? AND post_id=?").run(req.session.userId, Number(req.params.id));
  res.json({ inPlaylist: false });
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
// Each new code replaces the last one, so pressing "Send the code" twice used to send two emails where only the newer
// code worked. A code sent to the same email less than CODE_RESEND_SECONDS ago is now kept instead (unless it's used up),
// and asking again says how long to wait. Gives the seconds left to wait, or 0 if a new code can be sent.
const CODE_RESEND_SECONDS = 60;
function codeResendWait(table, userId, email, minutes, maxTries) {
  const check = db.prepare(`SELECT email, expires_at, tries, email_ok FROM ${table} WHERE user_id=?`).get(userId);
  if (!check || check.email !== email || check.email_ok || check.tries >= maxTries) return 0;
  const sentAt = check.expires_at - minutes * 60 * 1000;
  return Math.max(0, Math.ceil((sentAt + CODE_RESEND_SECONDS * 1000 - Date.now()) / 1000));
}
const codeJustSent = (res, wait) => res.status(429).json({ error: `We sent a code less than a minute ago, so use that one. Check the email, and its spam folder. You can ask for a new code in ${wait} second${wait === 1 ? "" : "s"}.` });

app.post("/api/adult/email", requireAuth, adultLimiter, async (req, res, next) => {
  const me = req.session.userId, email = String(req.body.email || "").trim().slice(0, 254);
  if (req.body.confirm !== true) return res.status(400).json({ error: "Confirm you are 18+ first." });
  if (inKidZone(me)) return res.status(403).json({ error: "18+ isn't in the kiddy zone." });
  if (isAdult(me)) return res.status(400).json({ error: "You've already done the 18+ checks." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Type your whole email address, like name@example.com." });
  if (!mailer && isProduction) return res.status(503).json({ error: "Yakimma can't send emails yet, so 18+ can't be turned on right now." });
  const wait = codeResendWait("adult_checks", me, email, ADULT_CODE_MINUTES, ADULT_CODE_TRIES);
  if (wait) return codeJustSent(res, wait);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  db.prepare(`INSERT INTO adult_checks(user_id,email,code_hash,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, code_hash=excluded.code_hash, expires_at=excluded.expires_at, tries=0, email_ok=0`)
    .run(me, email, hashCode(code).toString("hex"), Date.now() + ADULT_CODE_MINUTES * 60 * 1000);
  if (!mailer) return res.json({ sent: false, testCode: code });
  try {
    const sent = await mailer.sendMail({
      // The code is in the subject too, so each email stands on its own instead of being grouped with older codes.
      from: { name: "Yakimma", address: mail.from }, to: email, subject: `Your Yakimma 18+ code: ${code}`,
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
const FACE_SCAN_SKIPPERS = ["bleh", "creator"];
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
  const me = req.session.userId, on = req.body.on === true, admin = isAdmin(me);
  if (on && !isAdult(me) && !admin) return res.status(403).json({ error: "Do the 18+ checks first." });
  if (on && inKidZone(me) && !admin) return res.status(403).json({ error: "18+ isn't in the kiddy zone." });
  db.prepare("UPDATE users SET adult_on=? WHERE id=?").run(on ? 1 : 0, me);
  // An admin can go straight from the kiddy zone to the 18+ zone.
  if (on) db.prepare("UPDATE users SET kid_on=0 WHERE id=?").run(me);
  res.json({ user: publicUser(currentUser(req)), gift: on && giveBloodTheme(me) });
});

// A parent sets up the kiddy zone in three steps: their email, the code sent to it, then a parent-only password, which
// puts the account in the zone. The parent's email is kept, so if they forget the password they can get a new code and
// choose another one. Once a parent has set it up the code always goes to their email, never a new one.
const KID_CODE_MINUTES = 10, KID_CODE_TRIES = 5, KID_PASSWORD_MIN = 6;
const kidLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: "Too many tries. Please wait 15 minutes and try again." } });
// Only wrong parent passwords count, so nobody can guess it by trying lots.
const kidPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: "Too many wrong passwords. Please wait 15 minutes and try again." } });

app.post("/api/kid/email", requireAuth, kidLimiter, async (req, res) => {
  const me = req.session.userId, saved = kidRow(me).email, email = saved || String(req.body.email || "").trim().slice(0, 254);
  if (inZone(me)) return res.status(403).json({ error: "Turn off 18+ first." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Type the parent's whole email address, like name@example.com." });
  if (!mailer && isProduction) return res.status(503).json({ error: "Yakimma can't send emails yet, so the kiddy zone can't be set up right now." });
  const wait = codeResendWait("kid_checks", me, email, KID_CODE_MINUTES, KID_CODE_TRIES);
  if (wait) return codeJustSent(res, wait);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  db.prepare(`INSERT INTO kid_checks(user_id,email,code_hash,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, code_hash=excluded.code_hash, expires_at=excluded.expires_at, tries=0, email_ok=0`)
    .run(me, email, hashCode(code).toString("hex"), Date.now() + KID_CODE_MINUTES * 60 * 1000);
  if (!mailer) return res.json({ sent: false, testCode: code });
  const why = saved ? `Someone asked for a new parent password for the kiddy zone on the Yakimma account ${currentUser(req).username}.`
    : `The Yakimma account ${currentUser(req).username} wants to turn on the kiddy zone, a safe part of Yakimma for kids. Only a parent should do this.`;
  try {
    const sent = await mailer.sendMail({
      from: { name: "Yakimma", address: mail.from }, to: email, subject: `Your Yakimma kiddy zone code: ${code}`,
      text: `${why}\n\nYour parent code is ${code}\n\nType it on Yakimma, then choose a parent-only password. Only that password can turn the kiddy zone off. ` +
        `The code works for ${KID_CODE_MINUTES} minutes. If you didn't ask for this code, you can ignore this email.`
    });
    console.log(`Email: kiddy zone code handed to ${mail.host} (${sent.response})`);
  } catch (err) {
    db.prepare("DELETE FROM kid_checks WHERE user_id=?").run(me);
    console.error("Kiddy zone code email failed:", err.message);
    return res.status(502).json({ error: "That email couldn't be sent. Check the address and try again." });
  }
  res.json({ sent: true });
});

app.post("/api/kid/code", requireAuth, kidLimiter, (req, res) => {
  const me = req.session.userId, check = db.prepare("SELECT * FROM kid_checks WHERE user_id=?").get(me);
  if (!check) return res.status(400).json({ error: "Ask for a code first." });
  if (check.expires_at < Date.now() || check.tries >= KID_CODE_TRIES) return res.status(400).json({ error: "That code has run out. Go back and ask for a new one." });
  const given = hashCode(String(req.body.code || "").replace(/\D/g, "")), wanted = Buffer.from(check.code_hash, "hex");
  if (!crypto.timingSafeEqual(given, wanted)) {
    db.prepare("UPDATE kid_checks SET tries=tries+1 WHERE user_id=?").run(me);
    return res.status(400).json({ error: "That code isn't right. Check the parent's email and try again." });
  }
  db.prepare("UPDATE kid_checks SET email_ok=1 WHERE user_id=?").run(me);
  res.json({ ok: true });
});

// The last steps: the parent chooses their password (or a new one), scans their face if they want, and fills in the
// child's and their own birth dates, and the account goes into the kiddy zone. Choosing a new password keeps the face
// and birth dates already saved (accounts set up before birth dates were asked for fill them in then too).
app.post("/api/kid/password", requireAuth, kidLimiter, async (req, res, next) => {
  try {
    const me = req.session.userId, check = db.prepare("SELECT email, email_ok FROM kid_checks WHERE user_id=?").get(me), password = String(req.body.password || "");
    if (!check?.email_ok) return res.status(400).json({ error: "Enter the code from the parent's email first." });
    if (password.length < KID_PASSWORD_MIN || password.length > 200) return res.status(400).json({ error: `The parent password must be ${KID_PASSWORD_MIN}–200 characters.` });
    // The parent's face is up to the parent: they can scan it now, skip it, or save it later in Settings.
    const face = req.body.face === undefined ? null : parentFace(req.body);
    if (face?.error) return res.status(400).json(face);
    // The birth dates are needed unless they're already saved (a new password keeps them).
    const born = hasBirthDates(me) ? null : birthDates(req.body);
    if (born?.error) return res.status(400).json(born);
    enterKidZone(me, { email: check.email, passHash: await bcrypt.hash(password, 12), face: face?.face, born });
    // A parent who forgot the password has often guessed wrong a few times first. Their new password is right, so the
    // wrong guesses (and the tries spent getting the code) no longer count, or the new password would be locked too.
    await Promise.all([kidPasswordLimiter.resetKey(req.ip), kidLimiter.resetKey(req.ip)]);
    res.json({ user: publicUser(currentUser(req)) });
  } catch (err) { next(err); }
});
// The parent's face from a face scan, which has to look grown-up (like the 18+ face scan), or what's wrong with it.
function parentFace({ face, age }) {
  const clean = cleanFace(face);
  if (!clean || !Number.isFinite(Number(age))) return { error: "The parent's face scan didn't finish. Try again." };
  if (Number(age) < ADULT_FACE_AGE) return { error: "The face scan couldn't tell that this is a grown-up. A parent has to scan their own face." };
  return { face: JSON.stringify(clean) };
}
// The child's and the parent's birth dates from the last setup step, or what's wrong with them. They're kept private:
// they're never sent to anyone, not even back to the account itself.
function birthDates({ childBirthDate, parentBirthDate }) {
  const day = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : null;
  const child = day(childBirthDate), parent = day(parentBirthDate);
  // A day ahead of today in UTC, so today counts wherever the parent is.
  const latest = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const grownUp = new Date(Date.now() + 24 * 60 * 60 * 1000); grownUp.setUTCFullYear(grownUp.getUTCFullYear() - 18);
  if (!child || !parent) return { error: "Fill in both birth dates: the child's and the parent's." };
  if (child > latest || parent > latest) return { error: "A birth date can't be in the future." };
  if (child < "1900-01-01" || parent < "1900-01-01") return { error: "Check the birth dates. One of them is too long ago." };
  if (parent >= child) return { error: "The parent has to be born before the child." };
  if (parent > grownUp.toISOString().slice(0, 10)) return { error: "The parent has to be 18 or older." };
  return { child, parent };
}
const hasBirthDates = userId => Boolean(db.prepare("SELECT 1 FROM users WHERE id=? AND kid_birth_date IS NOT NULL AND parent_birth_date IS NOT NULL").get(userId));
// Puts someone in the kiddy zone, saving the parent's email, password, face and the birth dates when they've just been
// chosen. 18+ goes off, along with any 18+ checks they'd started.
const enterKidZone = db.transaction((userId, parent) => {
  if (parent?.email) db.prepare("UPDATE users SET kid_email=?, kid_pass_hash=? WHERE id=?").run(parent.email, parent.passHash, userId);
  if (parent?.face) db.prepare("UPDATE users SET kid_face=? WHERE id=?").run(parent.face, userId);
  if (parent?.born) db.prepare("UPDATE users SET kid_birth_date=?, parent_birth_date=? WHERE id=?").run(parent.born.child, parent.born.parent, userId);
  db.prepare("UPDATE users SET kid_on=1, adult_on=0 WHERE id=?").run(userId);
  db.prepare("DELETE FROM kid_checks WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM adult_checks WHERE user_id=?").run(userId);
});

// Save a new parent face (when a different parent takes over, or the account was set up before faces), with the parent password.
app.put("/api/kid/face", requireAuth, kidPasswordLimiter, async (req, res, next) => {
  try {
    const me = req.session.userId, { passHash } = kidRow(me);
    if (!passHash) return res.status(403).json({ error: "A parent has to set up the kiddy zone first." });
    if (!await bcrypt.compare(String(req.body.password || ""), passHash)) return res.status(403).json({ error: "That parent password isn't right." });
    const face = parentFace(req.body);
    if (face.error) return res.status(400).json(face);
    db.prepare("UPDATE users SET kid_face=? WHERE id=?").run(face.face, me);
    res.json({ user: publicUser(currentUser(req)) });
  } catch (err) { next(err); }
});

// ---- Learn! 📚 ----
// A quiz game, only in the kiddy zone. With the parent password, a parent chooses each subject's class (1 to 9) and
// whether the child is from Asia or the West, and verifies the child's faith before Islam or Christianity opens. Each
// only opens at all for accounts of that religion: Islam for Islam, Christianity for Christianity.
const LEARN_SUBJECTS = ["math", "english", "science", "islam", "christianity"], FAITH_SUBJECTS = ["islam", "christianity"], LEARN_REGIONS = ["asia", "western"];
// Why a faith subject is locked for someone's religion, or null if it isn't.
const religionLock = (userId, subject) => FAITH_SUBJECTS.includes(subject) && identityOf(userId).religion !== subject
  ? `${subject === "islam" ? "Islam" : "Christianity"} is only for accounts whose religion is ${subject === "islam" ? "Islam" : "Christianity"}.` : null;
// Islam verifications from before learn_verified move into it.
db.exec("INSERT OR IGNORE INTO learn_verified(user_id,subject) SELECT id,'islam' FROM users WHERE learn_muslim=1");
function learnPayload(userId) {
  const levels = {};
  for (const l of db.prepare("SELECT subject, grade, region FROM learn_levels WHERE user_id=?").all(userId)) levels[l.subject] = { grade: l.grade, region: l.region };
  return { verified: db.prepare("SELECT subject FROM learn_verified WHERE user_id=?").all(userId).map(v => v.subject), levels };
}
const requireKidZone = (req, res, next) => inKidZone(req.session.userId) ? next() : res.status(403).json({ error: "Learn! is only in the kiddy zone." });
// Admins never need the parent password.
const parentPasswordOk = async (userId, password) => {
  const { passHash } = kidRow(userId);
  return isAdmin(userId) || (Boolean(passHash) && bcrypt.compare(String(password || ""), passHash));
};
const wrongParentPassword = res => res.status(403).json({ error: "That parent password isn't right." });
// Only checks the parent password, so a parent can open the class list.
app.post("/api/kid/check", requireAuth, kidPasswordLimiter, async (req, res, next) => {
  try { await parentPasswordOk(req.session.userId, req.body.password) ? res.json({ ok: true }) : wrongParentPassword(res); } catch (err) { next(err); }
});
// A parent verifying a faith subject (Islam or Christianity) for their child, with the parent password or a face scan
// that matches the parent's saved face.
app.post("/api/learn/:subject/verify", requireAuth, requireKidZone, kidPasswordLimiter, async (req, res, next) => {
  try {
    const me = req.session.userId, subject = req.params.subject;
    if (!FAITH_SUBJECTS.includes(subject)) return res.status(404).json({ error: "Only Islam and Christianity need a parent to verify." });
    if (religionLock(me, subject)) return res.status(403).json({ error: religionLock(me, subject) });
    if (req.body.face !== undefined) {
      const saved = kidRow(me).face, face = cleanFace(req.body.face);
      if (!saved) return res.status(400).json({ error: "No parent face is saved yet, so use the parent password." });
      if (!face || !sameFace(face, JSON.parse(saved))) return res.status(403).json({ error: "That isn't the parent's face. Try again, or use the parent password." });
    } else if (!await parentPasswordOk(me, req.body.password)) return wrongParentPassword(res);
    db.prepare("INSERT OR IGNORE INTO learn_verified(user_id,subject) VALUES(?,?)").run(me, subject);
    res.json(learnPayload(me));
  } catch (err) { next(err); }
});
app.put("/api/learn/:subject", requireAuth, requireKidZone, kidPasswordLimiter, async (req, res, next) => {
  try {
    const me = req.session.userId, subject = req.params.subject, grade = Number(req.body.grade), region = req.body.region;
    if (!LEARN_SUBJECTS.includes(subject)) return res.status(404).json({ error: "There's no subject like that." });
    if (religionLock(me, subject)) return res.status(403).json({ error: religionLock(me, subject) });
    if (!Number.isInteger(grade) || grade < 1 || grade > 9) return res.status(400).json({ error: "Choose a class from 1 to 9." });
    if (!LEARN_REGIONS.includes(region)) return res.status(400).json({ error: "Choose Asia or Western." });
    if (!await parentPasswordOk(me, req.body.password)) return wrongParentPassword(res);
    if (FAITH_SUBJECTS.includes(subject) && !learnPayload(me).verified.includes(subject)) return res.status(403).json({ error: "A parent needs to verify this subject first." });
    db.prepare(`INSERT INTO learn_levels(user_id,subject,grade,region) VALUES(?,?,?,?)
      ON CONFLICT(user_id,subject) DO UPDATE SET grade=excluded.grade, region=excluded.region`).run(me, subject, grade, region);
    res.json(learnPayload(me));
  } catch (err) { next(err); }
});

// Turn the kiddy zone on (once a parent has set it up) or off (only with the parent password).
app.put("/api/kid", requireAuth, kidPasswordLimiter, async (req, res, next) => {
  try {
    const me = req.session.userId, on = req.body.on === true, admin = isAdmin(me);
    if (!kidRow(me).passHash && !admin) return res.status(403).json({ error: "A parent has to set up the kiddy zone first." });
    if (on && inZone(me) && !admin) return res.status(403).json({ error: "Turn off 18+ first." });
    // Accounts set up before birth dates were asked for fill them in before going back in.
    const born = on && !admin && !hasBirthDates(me) ? birthDates(req.body) : null;
    if (born?.error) return res.status(400).json(born);
    if (on) enterKidZone(me, { born });
    else if (!await parentPasswordOk(me, req.body.password)) return wrongParentPassword(res);
    else db.prepare("UPDATE users SET kid_on=0 WHERE id=?").run(me);
    res.json({ user: publicUser(currentUser(req)) });
  } catch (err) { next(err); }
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
    if (!db.prepare("DELETE FROM community_groups WHERE id=? AND (owner_id=? OR ?)").run(id, me, isAdmin(me) ? 1 : 0).changes) return null;
    // The group's posts and chat go with it.
    const media = db.prepare("SELECT media_path, thumb_path FROM posts WHERE group_key=?").all(key).flatMap(r => [r.media_path, r.thumb_path]).filter(Boolean);
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
// Someone tagged in a group they're not in can see the messages they were tagged in there (the newest 100 messages, and
// any older ones they were tagged in), but nothing else: every other message comes back blurred, without who sent it
// or what it says. Only for people who were tagged there at least once.
app.get("/api/groups/:id/tagged", requireAuth, (req, res) => {
  const me = req.session.userId, group = findGroup(req.params.id);
  if (!group) return res.status(404).json({ error: "That group doesn't exist any more." });
  const zone = groupZoneError(me, group);
  if (zone) return res.status(zone.status).json({ error: zone.error });
  if (isGroupMember(me, group)) return res.json({ member: true });
  const tagged = new Set(db.prepare(`SELECT n.message_id AS id FROM notifications n JOIN messages m ON m.id=n.message_id
    WHERE n.user_id=? AND n.kind='tag' AND m.group_key=?`).all(me, group.key).map(r => r.id));
  if (!tagged.size) return res.status(403).json({ error: "Join the group first to see its chat." });
  const rows = db.prepare(`SELECT m.id, m.sender_id AS userId, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path, m.body, m.created_at AS createdAt, m.deleted_at AS deletedAt
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.group_key=? AND (m.id IN (SELECT id FROM messages WHERE group_key=? ORDER BY id DESC LIMIT 100) OR m.id IN (${[...tagged].map(() => "?").join(",")}))
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=m.sender_id)
    ORDER BY m.id`).all(group.key, group.key, ...tagged, me);
  res.json({
    member: false, group: groupBrief(group.key, me),
    messages: rows.map(m => !tagged.has(m.id) ? { id: m.id, hidden: true }
      : m.deletedAt ? { id: m.id, deleted: true, createdAt: m.createdAt }
      : { id: m.id, userId: m.userId, username: m.username, avatar: avatarOf(m), body: m.body, createdAt: m.createdAt })
  });
});

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

// The 🔔 bell: your newest notifications, or just how many you haven't seen. Opening it marks them all as seen.
app.get("/api/notifications", requireAuth, (req, res) => res.json(notificationsPayload(req.session.userId)));
app.get("/api/notifications/unread", requireAuth, (req, res) => res.json({ unread: unreadNotifications(req.session.userId) }));
app.post("/api/notifications/read", requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL").run(req.session.userId);
  res.json({ unread: 0 });
});

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
  const zoneErr = zoneError(me, other.id);
  if (zoneErr) return res.status(403).json({ error: zoneErr });
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
      notify(other.id, me, "friend");
      return { accepted: true };
    }
    db.prepare("INSERT INTO friendships(requester_id,addressee_id) VALUES(?,?)").run(me, other.id);
    notify(other.id, me, "request");
    return { requested: true };
  });
  const result = tx();
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ...result, ...friendsPayload(me) });
});

app.post("/api/friends/requests/:id/accept", requireAuth, (req, res) => {
  const me = req.session.userId, request = db.prepare("SELECT requester_id FROM friendships WHERE id=? AND addressee_id=? AND status='pending'").get(Number(req.params.id), me);
  const info = db.prepare(`UPDATE friendships SET status='accepted', responded_at=CURRENT_TIMESTAMP
    WHERE id=? AND addressee_id=? AND status='pending'`).run(Number(req.params.id), me);
  if (!info.changes) return res.status(404).json({ error: "That friend request is no longer available." });
  notify(request.requester_id, me, "friend");
  res.json(friendsPayload(me));
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
  endAssistants(me, other);
  res.json(friendsPayload(me));
});

// Anyone with friends can give a friend a nickname that only they see, shown instead of their name everywhere. Leaving
// it empty takes it off. Nobody else can be nicknamed after the creator.
app.put("/api/friends/:userId/nickname", requireAuth, (req, res) => {
  const me = req.session.userId, friendId = Number(req.params.userId), name = String(req.body.nickname ?? "").trim().replace(/\s+/g, " ");
  if (!Number.isSafeInteger(friendId) || !areFriends(me, friendId)) return res.status(403).json({ error: "You can only give nicknames to your friends." });
  if ([...name].length > 30) return res.status(400).json({ error: "Nicknames can be up to 30 characters." });
  if (/\p{Cc}/u.test(name)) return res.status(400).json({ error: "That nickname has a character that can't be used." });
  if (name && creatorOnlyName(name) && !isCreator(db.prepare("SELECT username FROM users WHERE id=?").get(friendId).username)) return res.status(403).json({ error: CREATOR_ONLY });
  if (name) db.prepare("INSERT INTO nicknames(owner_id,friend_id,nickname) VALUES(?,?,?) ON CONFLICT(owner_id,friend_id) DO UPDATE SET nickname=excluded.nickname").run(me, friendId, name);
  else db.prepare("DELETE FROM nicknames WHERE owner_id=? AND friend_id=?").run(me, friendId);
  res.json({ nicknames: nicknamesOf(me) });
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
    const sent = insertMessage(chat, req.session.userId, body);
    notifyChatTags(req.session.userId, chat, Number(sent.lastInsertRowid), body);
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
        notify(msg.sender_id, me, "reaction", { messageId: msg.id, emoji });
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
      if (!canTalk(me, friendId)) return res.status(403).json({ error: talkError(me, friendId) });
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
    db.prepare("DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)").run(me, other, other, me);
    endAssistants(me, other);
  })();
  res.json(friendsPayload(me));
});

// ---- Finding people 🔎 ----
// Searching usernames on the Friends page, scrolling through everyone on Yakimma, and seeing someone's profile and who
// follows them. You find everyone, whatever zone they're in, except people who blocked you or you blocked. Sending a
// friend request or following someone still has the zone rules (see zoneError).
function canSee(viewerId, otherId) {
  return viewerId === otherId || !db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(viewerId, otherId, otherId, viewerId);
}
// Why someone can't add or follow another person from the zone they're in, or null if they can.
function zoneError(me, other) {
  if (inZone(me) && !isAdult(other)) return "You're in the 18+ zone, so you can only add and follow people who are 18+.";
  if (inKidZone(me) && !inKidZone(other)) return "You're in the kiddy zone, so you can only add and follow people who are in it too.";
  if (!inKidZone(me) && inKidZone(other)) return "They're in the kiddy zone, so only people in the kiddy zone can add or follow them.";
  return null;
}
// The creator suspends someone for any number of days, with a reason they'll see, or lifts it early.
// Nobody can suspend the creator.
app.post("/api/users/:id/suspend", requireAuth, requireCreator, (req, res) => {
  const id = Number(req.params.id), days = Math.floor(Number(req.body.days)), reason = cleanText(req.body.reason).slice(0, 300);
  const u = Number.isSafeInteger(id) && db.prepare("SELECT id, username FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "That person couldn't be found." });
  if (isCreator(u.username)) return res.status(400).json({ error: "The creator can't be suspended." });
  if (!(days >= 1 && days <= MAX_SUSPENSION_DAYS)) return res.status(400).json({ error: `Choose 1 to ${MAX_SUSPENSION_DAYS} days.` });
  const until = Date.now() + days * 24 * 60 * 60 * 1000;
  db.prepare("UPDATE users SET suspended_until=?, suspend_reason=? WHERE id=?").run(until, reason || null, id);
  res.json({ ok: true, until });
});
app.delete("/api/users/:id/suspend", requireAuth, requireCreator, (req, res) => {
  db.prepare("UPDATE users SET suspended_until=NULL, suspend_reason=NULL WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- 🛡️ Safety: only for the creator. Every chat (friend chats and group chats), comment and private or unlisted post,
// newest first, to keep Yakimma safe. `user` (a username) shows only what that person was part of. ----
function safetyUser(req) {
  const name = String(req.query.user || "").trim();
  return name ? db.prepare("SELECT id FROM users WHERE username=?").get(name)?.id ?? -1 : null;
}
const SAFETY_SHOWN = 200;
app.get("/api/safety/chats", requireAuth, requireCreator, (req, res) => {
  const who = safetyUser(req);
  const friend = db.prepare(`SELECT MIN(sender_id, recipient_id) AS a, MAX(sender_id, recipient_id) AS b, COUNT(*) AS messages, MAX(created_at) AS lastAt
    FROM messages WHERE recipient_id IS NOT NULL ${who ? "AND (sender_id=? OR recipient_id=?)" : ""} GROUP BY a, b ORDER BY lastAt DESC LIMIT ?`).all(...(who ? [who, who] : []), SAFETY_SHOWN);
  const person = id => personBrief(db.prepare("SELECT id, username, avatar_emoji, avatar_bg, avatar_path FROM users WHERE id=?").get(id));
  const groups = db.prepare(`SELECT group_key AS key, COUNT(*) AS messages, MAX(created_at) AS lastAt FROM messages
    WHERE group_key IS NOT NULL ${who ? "AND group_key IN (SELECT group_key FROM messages WHERE sender_id=?)" : ""} GROUP BY group_key ORDER BY lastAt DESC LIMIT ?`).all(...(who ? [who] : []), SAFETY_SHOWN);
  res.json({
    friends: friend.map(c => ({ a: person(c.a), b: person(c.b), messages: c.messages, lastAt: c.lastAt })),
    groups: groups.map(g => ({ ...(groupBrief(g.key, 0) || { key: g.key, name: "A deleted group", icon: "🏘️" }), messages: g.messages, lastAt: g.lastAt }))
  });
});
// One chat, read-only: between two people (a and b), or a group's.
app.get("/api/safety/chat", requireAuth, requireCreator, (req, res) => {
  const a = Number(req.query.a), b = Number(req.query.b), group = req.query.group ? String(req.query.group) : null;
  const rows = db.prepare(`SELECT * FROM (SELECT m.id, m.sender_id AS userId, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path, m.body, m.created_at AS createdAt, m.deleted_at AS deletedAt
      FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE ${group ? "m.group_key=?" : "((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))"} ORDER BY m.id DESC LIMIT ?) ORDER BY id`)
    .all(...(group ? [group] : [a, b, b, a]), SAFETY_SHOWN);
  res.json({ messages: rows.map(m => ({ id: m.id, userId: m.userId, username: m.username, avatar: avatarOf(m), body: m.body, createdAt: m.createdAt, deleted: Boolean(m.deletedAt) })) });
});
app.get("/api/safety/comments", requireAuth, requireCreator, (req, res) => {
  const who = safetyUser(req);
  const rows = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, c.user_id AS userId, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path,
      p.id AS postId, p.code AS postCode, p.caption AS postCaption, p.group_key AS postGroup, p.visibility
    FROM comments c JOIN users u ON u.id=c.user_id JOIN posts p ON p.id=c.post_id ${who ? "WHERE c.user_id=?" : ""} ORDER BY c.id DESC LIMIT ?`).all(...(who ? [who] : []), SAFETY_SHOWN);
  res.json({ comments: rows.map(c => ({ id: c.id, body: c.body, createdAt: c.createdAt, userId: c.userId, username: c.username, avatar: avatarOf(c),
    post: { id: c.postId, code: c.postCode, caption: c.postCaption, groupKey: c.postGroup, visibility: c.visibility } })) });
});
app.get("/api/safety/posts", requireAuth, requireCreator, (req, res) => {
  const who = safetyUser(req);
  res.json({ posts: selectPosts(req.session.userId, `p.visibility<>'public'${who ? " AND p.user_id=?" : ""}`, who ? [who] : [], "DESC", SAFETY_SHOWN) });
});
app.get("/api/safety/suspended", requireAuth, requireCreator, (req, res) => {
  const rows = db.prepare("SELECT id, username, avatar_emoji, avatar_bg, avatar_path, suspended_until, suspend_reason FROM users WHERE suspended_until>? ORDER BY suspended_until").all(Date.now());
  res.json({ users: rows.map(u => ({ ...personBrief(u), suspended: suspensionOf(u) })) });
});

// ---- 🤝 Assistant ----
// Everyone can choose one friend they trust as their assistant. Anyone can see it on both their profiles: "Assistant"
// on yours, and "Assistant to" on theirs. Nobody can choose one in the kiddy zone, and choosing someone follows the same
// zone rules as following them. When two people stop being friends (or one blocks the other), the assistant goes.
const personBrief = u => ({ id: u.id, username: u.username, avatar: avatarOf(u) });
const endAssistants = (a, b) => db.prepare("UPDATE users SET assistant_id=NULL WHERE (id=? AND assistant_id=?) OR (id=? AND assistant_id=?)").run(a, b, b, a);
function assistantInfo(viewerId, userId) {
  const a = db.prepare("SELECT u.id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM users o JOIN users u ON u.id=o.assistant_id WHERE o.id=?").get(userId);
  const of = db.prepare("SELECT id, username, avatar_emoji, avatar_bg, avatar_path FROM users WHERE assistant_id=? ORDER BY username COLLATE NOCASE LIMIT 100").all(userId);
  return { assistant: a && canSee(viewerId, a.id) ? personBrief(a) : null, assistantOf: of.filter(u => canSee(viewerId, u.id)).map(personBrief) };
}
app.put("/api/me/assistant", requireAuth, (req, res) => {
  const me = req.session.userId, id = req.body.userId == null ? null : Number(req.body.userId);
  if (id !== null) {
    if (inKidZone(me)) return res.status(403).json({ error: "You can't choose an assistant in the kiddy zone." });
    if (!Number.isSafeInteger(id) || !db.prepare("SELECT 1 FROM users WHERE id=?").get(id) || !canSee(me, id)) return res.status(404).json({ error: "That person couldn't be found." });
    if (id === me) return res.status(400).json({ error: "You can't be your own assistant." });
    if (!areFriends(me, id)) return res.status(403).json({ error: "You can only choose a friend as your assistant. Send them a friend request first." });
    const zoneErr = zoneError(me, id);
    if (zoneErr) return res.status(403).json({ error: zoneErr.replace("add and follow", "choose") });
  }
  const before = db.prepare("SELECT assistant_id FROM users WHERE id=?").get(me).assistant_id;
  db.prepare("UPDATE users SET assistant_id=? WHERE id=?").run(id, me);
  if (id && id !== before) notify(id, me, "assistant");
  res.json({ user: publicUser(currentUser(req)) });
});
// Someone in a list of people, with how many followers they have and how many people they follow.
const personItem = u => ({ id: u.id, username: u.username, avatar: avatarOf(u), ...followCounts(u.id) });
const SEARCH_RESULTS = 20;
// Finds people by their username, an admin's display name, or a nickname you gave a friend.
app.get("/api/users", requireAuth, (req, res) => {
  const me = req.session.userId, text = String(req.query.q || "").trim().replace(/\s+/g, " ").slice(0, 30);
  const q = text.replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  if (!text) return res.json({ users: [] });
  // Usernames: exact matches first, then names that start with the search, then shorter names.
  const byUsername = q ? db.prepare(`SELECT id, username, avatar_emoji, avatar_bg, avatar_path FROM users WHERE username LIKE ? AND id<>?
    ORDER BY lower(username)=lower(?) DESC, username LIKE ? DESC, length(username), username COLLATE NOCASE LIMIT 200`).all(`%${q}%`, me, q, `${q}%`) : [];
  const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const byDisplayName = db.prepare(`SELECT id, username, display_name, avatar_emoji, avatar_bg, avatar_path FROM users WHERE display_name LIKE ? ESCAPE '\\' AND id<>?`)
    .all(like, me).filter(u => canHaveDisplayName(u.username));
  // The nicknames you gave your friends find them too (only for you).
  const byNickname = db.prepare(`SELECT u.id, u.username, n.nickname, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM nicknames n JOIN users u ON u.id=n.friend_id
    WHERE n.owner_id=? AND n.nickname LIKE ? ESCAPE '\\'`).all(me, like).filter(u => areFriends(me, u.id));
  // Someone whose username, display name or nickname is exactly the search comes first, then nicknames, display names
  // and usernames.
  const exact = u => [u.username, u.display_name, u.nickname].some(n => n?.toLowerCase() === text.toLowerCase());
  const seen = new Set();
  const users = [...byNickname, ...byDisplayName, ...byUsername].sort((a, b) => exact(b) - exact(a))
    .filter(u => !seen.has(u.id) && seen.add(u.id) && canSee(me, u.id)).slice(0, SEARCH_RESULTS).map(personItem);
  res.json({ users });
});
// Everyone you could find, a page at a time in sign-up order, for scrolling through on the Friends page. `after` is
// the last account already looked at; `next` says where to carry on, or is null once every account has been seen.
const PEOPLE_PAGE = 30;
app.get("/api/people", requireAuth, (req, res) => {
  const me = req.session.userId, users = [], batch = db.prepare("SELECT id, username, avatar_emoji, avatar_bg, avatar_path FROM users WHERE id>? ORDER BY id LIMIT 100");
  let next = Math.max(0, Number(req.query.after) || 0);
  while (users.length < PEOPLE_PAGE) {
    const rows = batch.all(next);
    if (!rows.length) { next = null; break; }
    for (const u of rows) {
      next = u.id;
      if (u.id !== me && canSee(me, u.id)) users.push(personItem(u));
      if (users.length === PEOPLE_PAGE) break;
    }
  }
  res.json({ users, next });
});
// Someone's profile: who they are, their MC, LC, items, friends and followers, whether you're friends or following,
// and their posts you're allowed to see.
function profilePayload(viewerId, userId) {
  const u = db.prepare("SELECT id, username, mc, lc, avatar_emoji, avatar_bg, avatar_path FROM users WHERE id=?").get(userId);
  const f = db.prepare(`SELECT id, status, requester_id AS requesterId FROM friendships
    WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`).get(viewerId, userId, userId, viewerId);
  return {
    user: { id: u.id, username: u.username, accountNumber: accountNumber(u.id), avatar: avatarOf(u), ...identityOf(userId) },
    mc: u.mc, lc: u.lc,
    items: db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE user_id=?").get(userId).n,
    friends: db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE status='accepted' AND (requester_id=? OR addressee_id=?)").get(userId, userId).n,
    ...followCounts(userId),
    youFollow: Boolean(db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(viewerId, userId)),
    followsYou: Boolean(db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(userId, viewerId)),
    friend: !f ? "none" : f.status === "accepted" ? "friends" : f.requesterId === viewerId ? "sent" : "received",
    zoneNote: zoneError(viewerId, userId),
    requestId: f?.id ?? null,
    ...assistantInfo(viewerId, userId),
    suspended: isCreator(db.prepare("SELECT username FROM users WHERE id=?").get(viewerId)?.username) ? suspensionOf(db.prepare("SELECT suspended_until, suspend_reason FROM users WHERE id=?").get(userId)) : null,
    posts: selectPosts(viewerId, `p.user_id=? AND p.group_key IS NULL AND ${SEES_POST} AND p.adult=? AND p.kid=?`, [userId, viewerId, viewerId, viewerId, ...postZone(viewerId)], "DESC", 30)
  };
}
// The person in the URL, if the viewer may see them.
function seenPerson(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || !db.prepare("SELECT 1 FROM users WHERE id=?").get(id) || !canSee(req.session.userId, id)) { res.status(404).json({ error: "That person couldn't be found." }); return null; }
  return id;
}
app.get("/api/users/:id", requireAuth, (req, res) => {
  const id = seenPerson(req, res);
  if (id) res.json(profilePayload(req.session.userId, id));
});
// Who follows someone, or who they follow, for anyone whose profile you can see (yourself too), with their own follower
// counts. People you can't see (because of a block) are left out and only counted.
for (const [list, them, they] of [["followers", "follower_id", "followee_id"], ["following", "followee_id", "follower_id"]]) {
  app.get(`/api/users/:id/${list}`, requireAuth, (req, res) => {
    const me = req.session.userId, id = seenPerson(req, res);
    if (!id) return;
    const rows = db.prepare(`SELECT u.id, u.username, u.avatar_emoji, u.avatar_bg, u.avatar_path FROM follows f JOIN users u ON u.id=f.${them}
      WHERE f.${they}=? ORDER BY f.created_at DESC LIMIT 500`).all(id);
    const users = rows.filter(u => canSee(me, u.id)).map(personItem);
    res.json({ users, hidden: rows.length - users.length });
  });
}
const followLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "You're following and unfollowing very fast. Please wait a little while." } });
app.post("/api/users/:id/follow", requireAuth, followLimiter, (req, res) => {
  const me = req.session.userId, id = seenPerson(req, res);
  if (!id) return;
  if (id === me) return res.status(400).json({ error: "You can't follow yourself." });
  const zoneErr = zoneError(me, id);
  if (zoneErr) return res.status(403).json({ error: zoneErr });
  if (db.prepare("INSERT OR IGNORE INTO follows(follower_id,followee_id) VALUES(?,?)").run(me, id).changes) notify(id, me, "follow");
  res.json(profilePayload(me, id));
});
app.delete("/api/users/:id/follow", requireAuth, (req, res) => {
  const me = req.session.userId, id = Number(req.params.id);
  db.prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=?").run(me, id);
  res.json(Number.isSafeInteger(id) && canSee(me, id) && db.prepare("SELECT 1 FROM users WHERE id=?").get(id) ? profilePayload(me, id) : { ok: true });
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

// Accounts with a fixed picture can't save a new one. This runs before the upload, so no file is kept.
function requireChangeableAvatar(req, res, next) {
  if (fixedAvatarOf(currentUser(req).username)) return res.status(403).json({ error: "Your profile picture is fixed, so it can't be changed." });
  next();
}

app.put("/api/me/avatar", requireAuth, requireChangeableAvatar, (req, res) => {
  const { emoji, bg } = req.body;
  if (!avatarOptions.emojis.includes(emoji) || !hasOption(avatarOptions.backgrounds, bg)) return res.status(400).json({ error: "Choose one of the avatar characters and backgrounds." });
  db.prepare("UPDATE users SET avatar_emoji=?, avatar_bg=? WHERE id=?").run(emoji, bg, req.session.userId);
  // Picking an emoji avatar replaces any uploaded photo.
  setAvatarPhoto(req.session.userId, null);
  res.json({ user: publicUser(currentUser(req)) });
});

app.post("/api/me/avatar-photo", requireAuth, requireChangeableAvatar, (req, res, next) => {
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

app.delete("/api/me/avatar-photo", requireAuth, requireChangeableAvatar, (req, res) => {
  setAvatarPhoto(req.session.userId, null);
  res.json({ user: publicUser(currentUser(req)) });
});

app.get("/api/nails", requireAuth, (req, res) => res.json({ received: receivedDesigns(req.session.userId) }));

app.post("/api/nails", requireAuth, (req, res) => {
  const me = req.session.userId, friendId = Number(req.body.friendId);
  if (!ownsItem(me, "nails")) return res.status(403).json({ error: "Unlock Nails in the Shop first." });
  // You can do your own nails, or a friend's.
  if (friendId !== me && (!Number.isSafeInteger(friendId) || !areFriends(me, friendId))) return res.status(403).json({ error: "You can only do nails for yourself or your friends." });
  if (friendId !== me && !canTalk(me, friendId)) return res.status(403).json({ error: talkError(me, friendId) });
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
const FACE_MODELS = new Set(["tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model.bin", "age_gender_model-weights_manifest.json", "age_gender_model.bin",
  // For recognising the parent's face in the kiddy zone.
  "face_landmark_68_model-weights_manifest.json", "face_landmark_68_model.bin", "face_recognition_model-weights_manifest.json", "face_recognition_model.bin"]);
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
