# Dice Throne Podcast

A web app for your podcast. It has two pages:

- **The listener page** (`/`) — anyone can tune in while you're live, play past episodes, and follow the show on Spotify.
- **The studio** (`/studio`) — your private page. Check your mic, go live, record, and publish the episode. Published episodes go into your RSS feed (`/feed.xml`), and Spotify picks them up from there automatically.

Think of the RSS feed as a quest board. Your app pins new episodes on it, and Spotify comes by every few hours to check for new ones. You only tell Spotify where the board is once.

## How the pieces fit

| Piece | What it does | Cost to start |
|---|---|---|
| **Netlify** | Hosts the pages and runs the small server functions | Free plan |
| **Supabase** | Stores episode audio files and the episode list | Free plan |
| **LiveKit Cloud** | Carries the live audio to listeners | Free plan |
| **Spotify for Creators** | Reads your feed and lists the show on Spotify | Free |

No `npm install` is needed. The project has no packages to download; Netlify deploys it as-is.

## Setup

Do these in order. It takes about 30–45 minutes the first time.

### 1. Put the code on GitHub

1. On GitHub, create a new repository called `dice-throne-podcast` (private is fine).
2. Click **Add file → Upload files**, drag in everything from this folder (including the `netlify`, `public`, `supabase` and `tests` folders), and commit.

### 2. Set up Supabase (episode storage)

1. Go to [supabase.com](https://supabase.com), sign in, and create a new project.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**. This creates the episode list and a public `podcast` storage bucket.
3. Open **Project Settings → API Keys** (older dashboards: **Project Settings → API**) and copy two things:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **secret** key (starts with `sb_secret_`). Older projects call it the **service_role** key. Either works.

Keep the secret key private. It only goes into Netlify, never into your page code.

### 3. Set up LiveKit (live broadcasting)

Skip this step if you only want recorded episodes for now. You can add it later.

1. Go to [cloud.livekit.io](https://cloud.livekit.io), sign in, and create a project.
2. Open **Settings → API Keys** and create a key. Copy:
   - the **WebSocket URL** (starts with `wss://`)
   - the **API key**
   - the **API secret** (shown once, so copy it right away)

### 4. Deploy on Netlify

1. In Netlify, choose **Add new site → Import an existing project**, connect GitHub, and pick the repository.
2. Leave the build settings alone. `netlify.toml` already tells Netlify what to do.
3. Before (or right after) the first deploy, open **Site configuration → Environment variables** and add these:

| Variable | What to put |
|---|---|
| `HOST_PASSWORD` | A long password only you (and co-hosts) know. It unlocks the studio. |
| `OWNER_EMAIL` | An email you can check. Spotify sends its verification code here, and it's visible in your feed. |
| `SUPABASE_URL` | Project URL from step 2 |
| `SUPABASE_SECRET_KEY` | Secret key from step 2 |
| `LIVEKIT_URL` | WebSocket URL from step 3 |
| `LIVEKIT_API_KEY` | API key from step 3 |
| `LIVEKIT_API_SECRET` | API secret from step 3 |
| `SHOW_AUTHOR` | Your name or the show's crew name |

Optional ones are listed in `.env.example` (show title, description, language, category, explicit flag, Spotify link).

4. Go to **Deploys → Trigger deploy → Deploy site**. Environment changes only apply after a new deploy.

### 5. Check everything in the studio

Open `https://YOUR-SITE.netlify.app/studio` and sign in with your host password. If anything is missing, a **Finish setting up** panel lists what to fix. When every item has a check mark, you're ready.

### 6. Publish your first episode

Spotify won't accept a feed with no episodes, so publish one first. A short intro episode works.

### 7. Submit the feed to Spotify (one time only)

1. In the studio's **Spotify** panel, copy your feed link (`https://YOUR-SITE.netlify.app/feed.xml`).
2. Go to [creators.spotify.com](https://creators.spotify.com) and log in.
3. Choose **Add a new show → Find an existing show → Somewhere else**, and paste the feed link.
4. Spotify emails a code to `OWNER_EMAIL`. Enter it, check the details, pick a category, and submit.
5. Once the show is live on Spotify, copy its Spotify link, add it as `SPOTIFY_SHOW_URL` in Netlify, and redeploy. "Follow on Spotify" buttons then appear on your listener page.

From now on, every episode you publish shows up on Spotify on its own, usually within a few hours. The same feed link also works for Apple Podcasts, Pocket Casts and other apps.

## Running a show

1. Open the studio and click **Turn on mic**. Talk normally: the die should show 4 or 5 pips. If it only reaches 1 or 2, move closer or turn up your mic. If it sits at 6, back off a little.
2. Type your name on air.
3. Leave **Broadcast live** and **Record an episode** on (or turn one off).
4. Click **Start show**. Share your listener page link so people can tune in.
5. Click **End show** when you're done. The recording opens in the **Publish episode** panel.
6. Listen back, add a title and description, and click **Publish episode**.

Tips:

- **Keep the studio tab open and your computer awake** during the show. If the tab closes by accident, reopen the studio: the recording up to that point shows under **Unsaved recordings**.
- **Download MP3** keeps a copy on your computer. It's a good habit before publishing.
- Already have an episode recorded somewhere else? Use **Publish an audio file instead** at the bottom of the Episodes panel.

### Co-hosts

A co-host on another computer opens the same studio link, signs in with the host password, **turns off "Record an episode"**, and clicks **Start show**. You hear each other, listeners hear both of you, and their voice is mixed into your recording. Everyone should wear headphones so voices don't echo back into the mics.

If you're in the same room, just share one microphone.

## Limits worth knowing

- **Episode length.** On Supabase's free plan, one file can be at most 50 MB. The studio records 64 kbps MP3, about 29 MB per hour, so shows up to about 1 hour 45 minutes fit. The studio warns you as you get close.
- **Longer shows.** Either raise the file limit on a paid Supabase plan (then set `MAX_UPLOAD_MB` in Netlify to match), or change `MP3_KBPS` at the top of `public/js/studio.js` to a lower value like `48`.
- **Free plan pauses.** Free Supabase projects can be paused after a stretch with no activity. Your feed being checked usually keeps it awake, but if episodes stop playing, open the Supabase dashboard and restore the project.
- **Usage limits.** Each service's free plan has monthly limits (bandwidth for downloads, minutes for live listeners). Check their pricing pages as the show grows.
- **Music.** Don't play copyrighted music on the show, live or recorded. Spotify can remove episodes for it.

## Changing the name or cover

- Show name and description: set `SHOW_TITLE`, `SHOW_DESCRIPTION` and `SHOW_AUTHOR` in Netlify and redeploy. The page titles in `public/index.html` and `public/studio.html` are just the fallback text before the page loads, so update those too.
- Cover art: replace `public/cover.jpg` (square, 1400–3000 pixels, JPG or PNG) and `public/cover-600.jpg` (the same image at 600 × 600). The cover that comes with the project has the name baked into the image, so redo it if you rename the show.

## Testing on your own computer

```bash
npm install -g netlify-cli
cp .env.example .env      # then fill in .env
netlify dev               # opens http://localhost:8888
npm test                  # runs the server tests (no accounts needed)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Studio says "HOST_PASSWORD is not set" | Add it in Netlify, then **trigger a new deploy**. |
| "The episodes table is missing" | Run `supabase/schema.sql` in the Supabase SQL editor. |
| "Microphone access is blocked" | Click the icon left of the address bar and allow the microphone. |
| Listeners can't tune in | Check the LiveKit item in the studio's setup panel. |
| Spotify verification email never arrives | Check `OWNER_EMAIL` is right, redeploy, then submit again. Also check spam. |
| New episode isn't on Spotify yet | Give it a few hours. Make sure it shows at `/feed.xml`. |

## What's in the folder

```
public/                  The pages people see
  index.html             Listener page
  studio.html            Host studio
  js/listen.js           Live player + episode list
  js/studio.js           Mic, live broadcast, recording, publishing
  js/recorder.js         Records audio and builds the MP3
  js/recorder-worklet.js Collects raw audio on the audio thread
  js/mp3-worker.js       Encodes MP3 in the background
  js/recovery.js         Saves recordings in the browser in case the tab closes
  vendor/lame.min.js     MP3 encoder (lamejs, LGPL)
netlify/functions/       Small server functions (the API)
  feed.js                /feed.xml — the RSS feed Spotify reads
  episodes.js            List, publish and remove episodes
  upload-url.js          One-time upload links for audio files
  live-token.js          Passes for hosts and listeners to join the live show
  live-status.js         Tells the listener page if you're live
  health.js              The studio's setup checklist
netlify/lib/             Shared server code (Supabase, LiveKit, RSS)
supabase/schema.sql      Database + storage setup
tests/                   Server tests (npm test)
```
