// The RSS feed Spotify reads: https://your-site/feed.xml
import { getConfig, hasSupabase } from '../lib/config.js';
import { handle, allow } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { buildFeed } from '../lib/rss.js';

export default handle(async (req) => {
  allow(req, 'GET', 'HEAD');
  const cfg = getConfig();
  const episodes = hasSupabase(cfg) ? await supabase(cfg).listEpisodes() : [];
  return new Response(buildFeed(cfg, episodes), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      // Netlify's CDN keeps a copy for 5 minutes so apps polling the feed stay cheap.
      'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
});

export const config = { path: '/feed.xml' };
