# Yakimma — real website starter

**Tagline:** The world you can show off  
**Style:** Pink + teal

This is a runnable first backend/frontend starter—not a published website yet. It supports real local sign-up/login, password hashing, database-backed posts and balances, video/photo uploads, likes, the MC-to-LC exchange, shop purchases, themes, real friends, groups, secret codes, and a Nail Salon.

## What works in this starter

- Sign up and sign in with a username and password.
- Passwords are hashed before they are saved.
- Posts and likes are stored in SQLite.
- Upload an existing image or video (the site does not record videos).
- Every *new unique user's first like on a post* rewards the post owner 10 MC. Removing and re-adding the same like does not farm another reward.
- Exchange 1,000 MC for 1 LC.
- Shop prices: Nails 1 LC, Speed 40 MC, Effects 70 MC, Goth Theme 10 MC, Pastel Theme 20 MC.
- Buy items; purchases and balances are stored in the database.
- **Themes:** pick a theme in Settings. Pink & Teal, Rose Pink and Mint Teal are free. Goth (mostly black) and Pastel (rainbow pastels) unlock in the Shop and switch on as soon as you buy them. A signed-in person's theme is saved to their account.
- **Groups:** browse groups people have made, search them, join and leave. Anyone signed in can start up to 5 groups, and only the person who made a group can delete it (its posts and chat are deleted with it). Open a group you're in to chat with the other members or share posts (text, photo or video) that only members can see and like.
- **Codes:** enter secret codes to win MC, LC, a ginger cat nail sticker, or a key to the secret group Cuties. Each account can use each code once, and too many wrong guesses means a 15-minute wait. The codes and their prizes are in the `codes` list near the top of `server.js`.
- **Profile pictures:** pick an emoji avatar and background colour, or upload a photo and drag/zoom it to fit the circle. Photos are resized to 400×400 in the browser (which also strips hidden data such as location) and checked on the server to be real images.
- **Friends:** send, accept, decline and cancel friend requests between real accounts, and remove friends. Friends can chat privately; unread messages show as a number on the Friends button.
- **Chats** check for new messages every 3 seconds while open. Messages can be up to 500 characters, and sending more than 30 a minute means a short wait.
- **Message actions:** tap a message to react with any of 1,898 emojis (Unicode Emoji 15.1, from `public/emoji-data.json`), forward it to a friend or group, or edit or delete your own. Deleted messages show as "This message was deleted". The person who made a group can delete anyone's messages in it. Emojis use the device's own emoji font, so they're Apple emojis on iPhone, iPad and Mac.
- **Blocking:** block someone from a chat message, a post, a friend request or your friends list. You won't see their messages or posts, they can't send you friend requests, and any friendship ends. Unblock them in the Blocked list on the Friends page.
- **Nail Salon:** locked until you buy Nails (1 LC). Pick your hand's skin tone, then choose a friend and give them a manicure: shape, length, polish colour, finish (glossy, matte, shimmer, chrome) and nail art per nail. Finished sets are saved and show on the friend's profile.
- Responsive layout with the sidebar sections, and Mahdiya Faiza Manha's name at the top of the home page.

## Before you run it

Install Node.js 20 or newer. The live server runs Node 20.20.2, and `.nvmrc` pins that version so `nvm use` matches it. Then, in this folder:

```bash
npm install
npm start
```

Open http://localhost:3000

New accounts start with 0 MC. To test the Nail Salon locally, enter a code that gives LoveCards on the Codes page, then unlock Nails in the Shop. You'll also need a friend: make a second account (for example in a private window) and send a friend request.

The codes live in `server.js`, so anyone who can read the source code can see them. Keep the GitLab repository private.

## Deploying to Render

`render.yaml` sets up a Node **Web Service** with a 5 GB persistent disk mounted at `/var/data`. The database and uploads are stored there, so they survive deploys and restarts.

1. Push this folder to a GitHub or GitLab repository.
2. In Render, choose **New → Blueprint** and pick the repository.
3. Approve the plan. Render creates the service and disk, and generates `SESSION_SECRET` for you.

A disk needs a paid instance (Starter or higher). It also limits the service to one instance, and each deploy has a few seconds of downtime. Logins are kept in memory, so everyone is signed out whenever the service restarts.

Locally nothing changes: without `DATA_DIR` and `UPLOAD_DIR` set, the app uses the `data/` and `uploads/` folders here.

## Important limitations before public launch

This is a **local MVP**, not a deployed social network. SQLite and local upload files are fine for development, but not enough for a reliable public site with many users. Before launch, have an experienced developer configure:

1. PostgreSQL or another managed production database.
2. Private object storage/CDN for uploads (for example, Cloudflare R2 or an equivalent).
3. A strong `SESSION_SECRET` environment variable and HTTPS.
4. Production session storage (not Express's default in-memory store).
5. Upload quotas, video transcoding, moderation/reporting, blocking, deletion, backup and recovery.
6. Age-appropriate privacy/safety policies and legal review, especially because social platforms can attract young users.
7. Friend-request safety: blocking, reporting, and notifications. Friends and the Nail Salon work, but pages refresh when you open them rather than updating live.
8. Real viewing controls. Speed/effects should apply to the actual video player; the initial UI includes speed control and simple viewing effects.

Do not commit real passwords, secrets, private user data, or uploaded media to source control. Do not expose this local development server directly to the public internet.

## Currency / anti-abuse notes

The server—not the browser—calculates balances and purchase costs. A post owner cannot earn MC by liking their own post. Each liker can reward a given post only once, even if they unlike and like again. A production version should also add spam detection, bot/fake-account controls and clear moderation rules.

## Suggested next build step

Add blocking/reporting for friend requests and live updates (so a friend sees new nails without reopening the page). After that, move uploads to object storage and deploy the site behind HTTPS.
