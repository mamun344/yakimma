# Yakimma — real website starter

**Tagline:** The world you can show off  
**Style:** Pink + teal

This is a runnable first backend/frontend starter—not a published website yet. It supports real local sign-up/login, password hashing, database-backed posts and balances, video/photo uploads, likes, the MC-to-LC exchange, shop purchases, real friends, and a Nail Salon.

## What works in this starter

- Sign up and sign in with a username and password.
- Passwords are hashed before they are saved.
- Posts and likes are stored in SQLite.
- Upload an existing image or video (the site does not record videos).
- Every *new unique user's first like on a post* rewards the post owner 10 MC. Removing and re-adding the same like does not farm another reward.
- Exchange 1,000 MC for 1 LC.
- Shop prices: Nails 10 MC, Speed 40 MC, Effects 70 MC, Goth Theme 1 LC, Pastel Theme 2 LC.
- Buy items; purchases and balances are stored in the database.
- **Profile pictures:** pick an emoji avatar and background colour, or upload a photo and drag/zoom it to fit the circle. Photos are resized to 400×400 in the browser (which also strips hidden data such as location) and checked on the server to be real images.
- **Friends:** send, accept, decline and cancel friend requests between real accounts, and remove friends.
- **Nail Salon:** locked until you buy Nails (10 MC). Pick your hand's skin tone, then choose a friend and give them a manicure: shape, length, polish colour, finish (glossy, matte, shimmer, chrome) and nail art per nail. Finished sets are saved and show on the friend's profile.
- Responsive pink-and-teal layout and the four requested sidebar sections.

## Before you run it

Install Node.js 20 or newer. Then, in this folder:

```bash
npm install
npm start
```

Open http://localhost:3000

New accounts start with 0 MC. To test the Nail Salon locally, make a second account (for example in a private window), like a post from the first account to earn 10 MC, then unlock Nails in the Shop.

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
