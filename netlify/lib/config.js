// Reads every setting from Netlify environment variables.
// Change these in Netlify: Site configuration > Environment variables.

const read = (key) => String(process.env[key] ?? '').trim();

export function getConfig() {
  // Netlify sets URL automatically to your site's main address.
  const siteUrl = (read('SITE_URL') || read('URL') || 'http://localhost:8888').replace(/\/+$/, '');
  const author = read('SHOW_AUTHOR') || 'Dice Throne Podcast';

  return {
    siteUrl,
    feedUrl: `${siteUrl}/feed.xml`,
    hostPassword: read('HOST_PASSWORD'),
    maxUploadMb: Number(read('MAX_UPLOAD_MB')) || 50,
    show: {
      title: read('SHOW_TITLE') || 'Dice Throne Podcast',
      description:
        read('SHOW_DESCRIPTION') ||
        'Dice, heroes and table talk. New episodes and live shows from the Dice Throne Podcast.',
      author,
      ownerName: read('OWNER_NAME') || author,
      ownerEmail: read('OWNER_EMAIL'),
      language: read('SHOW_LANGUAGE') || 'en-us',
      explicit: /^(1|true|yes)$/i.test(read('SHOW_EXPLICIT')),
      category: read('SHOW_CATEGORY') || 'Leisure',
      subcategory: read('SHOW_SUBCATEGORY') || 'Games',
      coverUrl: read('SHOW_COVER_URL') || `${siteUrl}/cover.jpg`,
      spotifyUrl: read('SPOTIFY_SHOW_URL'),
    },
    supabase: {
      url: read('SUPABASE_URL').replace(/\/+$/, ''),
      // Supabase calls this the "secret" key (older projects: "service_role" key).
      key: read('SUPABASE_SECRET_KEY') || read('SUPABASE_SERVICE_ROLE_KEY'),
      bucket: read('SUPABASE_BUCKET') || 'podcast',
    },
    livekit: {
      url: read('LIVEKIT_URL').replace(/\/+$/, ''),
      apiKey: read('LIVEKIT_API_KEY'),
      apiSecret: read('LIVEKIT_API_SECRET'),
      room: read('LIVEKIT_ROOM') || 'dice-throne-live',
    },
  };
}

export const hasSupabase = (cfg) => Boolean(cfg.supabase.url && cfg.supabase.key);
export const hasLivekit = (cfg) =>
  Boolean(cfg.livekit.url && cfg.livekit.apiKey && cfg.livekit.apiSecret);
