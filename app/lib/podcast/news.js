// Fetch and parse Kagi RSS for the podcast pipeline.
// Keeps to the top N items per category, stripping HTML from descriptions.

const KAGI_CATEGORIES = ["world", "tech", "business"];
const PER_CATEGORY = 3;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractTag(block, tag) {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i").exec(block);
  if (cdata) return cdata[1].trim();
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return plain ? decodeEntities(plain[1]).trim() : "";
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseItems(xml) {
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const title = stripHtml(extractTag(block, "title"));
    const link = extractTag(block, "link");
    const description = stripHtml(extractTag(block, "description"));
    const pubDate = extractTag(block, "pubDate");
    if (title) items.push({ title, link, description, pubDate });
  }
  return items;
}

async function fetchCategory(category) {
  const url = `https://news.kagi.com/${category}.xml`;
  const res = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: { "User-Agent": "LingDaily/1.0 (+https://lingdaily.ai)" },
  });
  if (!res.ok) throw new Error(`Kagi ${category} upstream ${res.status}`);
  const xml = await res.text();
  return parseItems(xml).slice(0, PER_CATEGORY);
}

export async function fetchPodcastNews() {
  const results = await Promise.all(
    KAGI_CATEGORIES.map(async (category) => {
      const items = await fetchCategory(category);
      return { category, items };
    })
  );
  const total = results.reduce((sum, r) => sum + r.items.length, 0);
  if (total === 0) throw new Error("No news items fetched from Kagi");
  return results;
}
