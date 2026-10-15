// Saves the email settings for 18+ codes into .env, then checks them by signing in to the email server.
// The password is never shown.
//
//   npm run email-setup
//       Asks for each setting. The password shows as *** while you type it.
//
//   pbpaste | npm run email-setup -- --host mail.example.com --user you@example.com --password-stdin
//       The same without questions (handy as a `!` command in Claude Code): copy the password first, and it's read
//       from the clipboard. Add --port 587 if your server doesn't use 465.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { parseEnv } = require("util");
const { mailSettings, createMailer } = require("../email");

const envFile = path.join(__dirname, "..", ".env");
const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").replace(/\n$/, "").split("\n") : [];
// Read .env exactly the way Yakimma does, so quotes and # in a saved value are understood the same way.
const saved = parseEnv(lines.join("\n"));
// In .env, a # can start a comment, so a value with anything unusual in it (like a # in a password) goes in quotes.
function envValue(value) {
  if (/^[\w@.:\/+-]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!/["\\]/.test(value)) return `"${value}"`;
  return null;
}
const flag = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

function ask(question, fallback = "") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `, answer => { rl.close(); resolve(answer.trim() || fallback); }));
}
// Reads a password key by key, showing a * for each letter instead of the letter itself.
function askHidden(question) {
  const stdin = process.stdin;
  process.stdout.write(`${question}: `);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise(resolve => {
    let text = "";
    const onKey = keys => {
      for (const key of keys) {
        if (key === "\r" || key === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onKey);
          process.stdout.write("\n");
          return resolve(text);
        }
        if (key === "\u0003") { process.stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (key === "\u007f" || key === "\b") { if (text) { text = text.slice(0, -1); process.stdout.write("\b \b"); } }
        else if (key >= " ") { text += key; process.stdout.write("*"); }
      }
    };
    stdin.on("data", onKey);
  });
}
const readStdin = () => new Promise(resolve => { let text = ""; process.stdin.on("data", d => { text += d; }).on("end", () => resolve(text.trim())); });

(async () => {
  const fromStdin = process.argv.includes("--password-stdin"), interactive = process.stdin.isTTY && !fromStdin;
  const value = async (name, key, question, fallback) => flag(name) ?? (interactive ? ask(question, saved[key] || fallback) : saved[key] || fallback);
  const set = {
    SMTP_HOST: await value("host", "SMTP_HOST", "Outgoing server (e.g. mail.yourdomain.com)", ""),
    SMTP_PORT: await value("port", "SMTP_PORT", "Port", "465"),
    SMTP_USER: await value("user", "SMTP_USER", "Username (the whole email address)", "")
  };
  if (flag("from")) set.MAIL_FROM = flag("from");
  // Pressing Enter at the password keeps the one already saved.
  set.SMTP_PASS = fromStdin ? await readStdin() : interactive ? await askHidden("Password (hidden)") || saved.SMTP_PASS || "" : "";
  const missing = Object.entries({ "--host": set.SMTP_HOST, "--user": set.SMTP_USER, "the password": set.SMTP_PASS }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Nothing saved: missing ${missing.join(", ")}.\nRun \`npm run email-setup\` in a Terminal window to be asked for each setting, or see the top of scripts/email-setup.js.`);
    process.exit(1);
  }

  if (Object.values(set).some(v => envValue(v) === null)) {
    console.error("Nothing saved: the password has both ' and \" (or \\) in it, which .env can't hold. Choose a different password.");
    process.exit(1);
  }
  // Change the lines already in .env, and add any that aren't there yet. Everything else in the file stays as it was.
  const out = lines.map(l => { const key = l.match(/^([A-Z_]+)=/)?.[1]; return key in set ? `${key}=${envValue(set[key])}` : l; });
  for (const key of Object.keys(set)) if (!lines.some(l => l.startsWith(`${key}=`))) out.push(`${key}=${envValue(set[key])}`);
  fs.writeFileSync(envFile, out.join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);

  const settings = mailSettings({ ...saved, ...set });
  console.log(`Saved to .env: ${settings.host}, port ${settings.port}, ${settings.user} (password hidden).`);
  try {
    await createMailer(settings).verify();
    console.log(`✅ Signed in to ${settings.host}. 18+ codes will be emailed from ${settings.from}. Restart Yakimma to start using it.`);
  } catch (err) {
    console.error(`❌ Couldn't sign in to ${settings.host}: ${err.message}`);
    if (/certificate|altnames|self.signed/i.test(err.message)) console.error("Tip: use the server name cPanel shows under \"Secure SSL/TLS Settings\" as the outgoing server.");
    process.exit(1);
  }
})();
