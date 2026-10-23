// Builds the podcast RSS feed. Spotify (and Apple, Pocket Casts, etc.)
// read this file every few hours and pick up any new episodes.

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(value) {
  return String(value ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(value) {
  const clean = String(value ?? '').replace(INVALID_XML, '');
  return `<![CDATA[${clean.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

// Turns plain text with blank lines into simple HTML paragraphs.
function toHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeXml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function buildFeed(cfg, episodes, now = new Date()) {
  const { show, siteUrl, feedUrl } = cfg;
  const published = episodes
    .filter((ep) => new Date(ep.published_at) <= now)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const lastBuild = published.length ? new Date(published[0].published_at) : now;

  const items = published.map((ep) => {
    const lines = [
      '    <item>',
      `      <title>${escapeXml(ep.title)}</title>`,
      `      <description>${cdata(ep.description || ep.title)}</description>`,
      ep.description ? `      <content:encoded>${cdata(toHtml(ep.description))}</content:encoded>` : null,
      `      <link>${escapeXml(`${siteUrl}/#episode-${ep.id}`)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(ep.id)}</guid>`,
      `      <pubDate>${new Date(ep.published_at).toUTCString()}</pubDate>`,
      `      <enclosure url="${escapeXml(ep.audio_url)}" length="${Number(ep.audio_bytes) || 0}" type="${escapeXml(ep.audio_type || 'audio/mpeg')}"/>`,
      `      <itunes:duration>${Math.max(0, Math.round(Number(ep.duration_seconds) || 0))}</itunes:duration>`,
      ep.season_number != null ? `      <itunes:season>${Number(ep.season_number)}</itunes:season>` : null,
      ep.episode_number != null ? `      <itunes:episode>${Number(ep.episode_number)}</itunes:episode>` : null,
      '      <itunes:episodeType>full</itunes:episodeType>',
      `      <itunes:explicit>${ep.explicit ? 'true' : 'false'}</itunes:explicit>`,
      '    </item>',
    ];
    return lines.filter(Boolean).join('\n');
  });

  const category = show.subcategory
    ? `<itunes:category text="${escapeXml(show.category)}"><itunes:category text="${escapeXml(show.subcategory)}"/></itunes:category>`
    : `<itunes:category text="${escapeXml(show.category)}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(show.title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <language>${escapeXml(show.language)}</language>
    <description>${cdata(show.description)}</description>
    <copyright>${escapeXml(`© ${now.getUTCFullYear()} ${show.author}`)}</copyright>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
    <generator>Dice Throne Podcast app</generator>
    <itunes:author>${escapeXml(show.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${escapeXml(show.ownerName)}</itunes:name>
      <itunes:email>${escapeXml(show.ownerEmail)}</itunes:email>
    </itunes:owner>
    <itunes:image href="${escapeXml(show.coverUrl)}"/>
    <image>
      <url>${escapeXml(show.coverUrl)}</url>
      <title>${escapeXml(show.title)}</title>
      <link>${escapeXml(siteUrl)}</link>
    </image>
    ${category}
    <itunes:explicit>${show.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${items.join('\n')}
  </channel>
</rss>
`;
}
