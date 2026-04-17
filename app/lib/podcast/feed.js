// Maintain the podcast manifest and regenerate feed.xml (RSS 2.0 + iTunes).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CHANNEL = {
    title: "LingDaily",
    subtitle: "每天十分钟，LL和DD带你精读世界新闻",
    description:
        "A daily bilingual English/Mandarin news podcast. Two friendly hosts cover the day's top stories in world, tech, and business — with Chinese glosses for advanced vocabulary to help learners pick up natural English.",
    author: "LingDaily",
    ownerName: "LingDaily",
    ownerEmail: "slivery@linux.do",
    language: "en-US",
    category: "News",
    subcategory: "Daily News",
    explicit: "no",
};

function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function cdata(s) {
    return `<![CDATA[${String(s).replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function rfc2822(isoDate) {
    return new Date(isoDate).toUTCString();
}

function getBaseUrl() {
    const raw =
        process.env.PODCAST_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        "http://localhost:8000";
    return raw.replace(/\/+$/, "");
}

export async function loadManifest(manifestPath) {
    try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.episodes)) return { episodes: [] };
        return parsed;
    } catch (err) {
        if (err.code === "ENOENT") return { episodes: [] };
        throw err;
    }
}

export async function upsertEpisode(manifest, episode) {
    const filtered = manifest.episodes.filter((e) => e.id !== episode.id);
    filtered.push(episode);
    filtered.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    return { episodes: filtered };
}

export async function saveManifest(manifestPath, manifest) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export function renderFeedXml(manifest) {
    const baseUrl = getBaseUrl();
    const feedUrl = `${baseUrl}/podcasts/feed.xml`;
    const siteUrl = baseUrl;
    const imageUrl =
        process.env.PODCAST_IMAGE_URL || `${baseUrl}/podcasts/icon.png`;
    const lastBuildDate = rfc2822(
        manifest.episodes[0]?.pubDate || new Date().toISOString(),
    );

    const items = manifest.episodes
        .map((ep) => {
            const enclosureUrl = `${baseUrl}/podcasts/${ep.filename}`;
            return `    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${cdata(ep.summary || "")}</description>
      <itunes:summary>${cdata(ep.summary || "")}</itunes:summary>
      <pubDate>${rfc2822(ep.pubDate)}</pubDate>
      <guid isPermaLink="false">lingdaily-podcast-${escapeXml(ep.id)}</guid>
      <link>${escapeXml(enclosureUrl)}</link>
      <enclosure url="${escapeXml(enclosureUrl)}" length="${ep.size || 0}" type="audio/mpeg"/>
      <itunes:duration>${formatDuration(ep.duration)}</itunes:duration>
      <itunes:explicit>${CHANNEL.explicit}</itunes:explicit>
    </item>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.apple.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(CHANNEL.title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <description>${cdata(CHANNEL.description)}</description>
    <language>${CHANNEL.language}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <itunes:author>${escapeXml(CHANNEL.author)}</itunes:author>
    <itunes:summary>${cdata(CHANNEL.description)}</itunes:summary>
    <itunes:subtitle>${escapeXml(CHANNEL.subtitle)}</itunes:subtitle>
    <itunes:owner>
      <itunes:name>${escapeXml(CHANNEL.ownerName)}</itunes:name>
      <itunes:email>${escapeXml(CHANNEL.ownerEmail)}</itunes:email>
    </itunes:owner>
    <itunes:image href="${escapeXml(imageUrl)}"/>
    <itunes:category text="${escapeXml(CHANNEL.category)}">
      <itunes:category text="${escapeXml(CHANNEL.subcategory)}"/>
    </itunes:category>
    <itunes:explicit>${CHANNEL.explicit}</itunes:explicit>
${items}
  </channel>
</rss>
`;
}

export async function writeFeed(feedPath, manifest) {
    const xml = renderFeedXml(manifest);
    await writeFile(feedPath, xml, "utf8");
}

export function buildEpisodeEnclosureUrl(filename) {
    return `${getBaseUrl()}/podcasts/${filename}`;
}
