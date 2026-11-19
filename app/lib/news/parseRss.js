// Turns a Kagi News RSS feed into the article shape rendered by NewsFeed.
// The cleanup rules target Kagi's description markup: a trailing
// `<h3>Sources:</h3>` block, single-quoted `<img src='...'>` and
// trailing `(Publisher)` references.

export function extractKagiImage(html) {
  const imgMatch = html.match(/<img src='([^']*)'/);
  return imgMatch ? imgMatch[1] : null;
}

export function stripKagiSources(html) {
  const sourcesIndex = html.indexOf('<h3>Sources:</h3>');
  return sourcesIndex !== -1 ? html.substring(0, sourcesIndex) : html;
}

export function cleanKagiDescription(html) {
  let description = html;
  // Remove images and <br> tags
  description = description.replace(/<img[^>]*>/gi, '');
  description = description.replace(/<br\s*\/?>/gi, '\n');
  // Convert structural HTML to formatted text
  description = description.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n$1\n');
  description = description.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n• $1');
  description = description.replace(/<\/p>/gi, '\n');
  description = description.replace(/<p[^>]*>/gi, '');
  // Strip remaining HTML tags
  description = description.replace(/<[^>]*>/g, '');
  // Decode HTML entities
  description = description
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // Remove bracket patterns with URLs/file extensions
  description = description.replace(/\[[^\]]*?(?:#\d+|\.[a-z]{2,4})[^\]]*?\]/gi, '');
  // Remove standalone source/link references like "(Reuters)" or "(The Hindu)"
  description = description.replace(/\s*\([^)]*\)\s*$/gm, '');
  // Clean up excessive whitespace while preserving intentional line breaks
  description = description.replace(/[ \t]+/g, ' ');
  description = description.replace(/\n{3,}/g, '\n\n');
  return description.trim();
}

export function parseKagiRss(rssText, category, categoryData) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(rssText, 'application/xml');
  const items = xmlDoc.querySelectorAll('item');

  return Array.from(items).map((item, index) => {
    const rawDescription = stripKagiSources(item.querySelector('description')?.textContent || '');
    const description = cleanKagiDescription(rawDescription);

    return {
      id: `${category}-${index}`,
      title: item.querySelector('title')?.textContent || 'Untitled',
      link: item.querySelector('link')?.textContent || '',
      description: description || 'No description available',
      urlToImage: extractKagiImage(rawDescription),
      category: categoryData?.categoryName || 'News',
      sourceLanguage: categoryData?.sourceLanguage || 'en',
      date: item.querySelector('pubDate')?.textContent || new Date().toISOString(),
    };
  });
}
