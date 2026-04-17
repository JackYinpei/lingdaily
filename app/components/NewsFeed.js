"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { NewsCard } from "./NewsCard";

// 新闻分类数据，保留一些主要的英文分类
const categories = [
  { categoryId: 'world', categoryName: 'World', sourceLanguage: 'en' },
  { categoryId: 'usa', categoryName: 'USA', sourceLanguage: 'en' },
  { categoryId: 'business', categoryName: 'Business', sourceLanguage: 'en' },
  { categoryId: 'tech', categoryName: 'Technology', sourceLanguage: 'en' },
  { categoryId: 'science', categoryName: 'Science', sourceLanguage: 'en' },
  { categoryId: 'sports', categoryName: 'Sports', sourceLanguage: 'en' },
  { categoryId: 'gaming', categoryName: 'Gaming', sourceLanguage: 'en' },
  { categoryId: 'bay', categoryName: 'Bay Area', sourceLanguage: 'en' },

  { categoryId: '3d_printing', categoryName: '3D Printing', sourceLanguage: 'en' },
  { categoryId: 'africa', categoryName: 'Africa', sourceLanguage: 'en' },
  { categoryId: 'ai', categoryName: 'AI', sourceLanguage: 'en' },
  { categoryId: 'apple', categoryName: 'Apple', sourceLanguage: 'en' },
  { categoryId: 'argentina', categoryName: 'Argentina', sourceLanguage: 'es' },
  { categoryId: 'australia', categoryName: 'Australia', sourceLanguage: 'en' },
  { categoryId: 'austria', categoryName: 'Austria', sourceLanguage: 'de' },
  { categoryId: 'belgium', categoryName: 'Belgium', sourceLanguage: 'nl' },
  { categoryId: 'bitcoin', categoryName: 'Bitcoin', sourceLanguage: 'en' },
  { categoryId: 'brazil', categoryName: 'Brazil', sourceLanguage: 'pt' },
  { categoryId: 'canada', categoryName: 'Canada', sourceLanguage: 'en' },
  { categoryId: 'catholic', categoryName: 'Catholic', sourceLanguage: 'en' },
  { categoryId: 'china', categoryName: 'China', sourceLanguage: 'zh-Hans' },
  { categoryId: 'coffee', categoryName: 'Coffee', sourceLanguage: 'en' },
  { categoryId: 'colombia', categoryName: 'Colombia', sourceLanguage: 'es' },
  { categoryId: 'costa_rica', categoryName: 'Costa Rica', sourceLanguage: 'es' },
  { categoryId: 'croatia', categoryName: 'Croatia', sourceLanguage: 'hr' },
  { categoryId: 'cryptocurrency', categoryName: 'Cryptocurrency', sourceLanguage: 'en' },
  { categoryId: 'cybersecurity', categoryName: 'Cybersecurity', sourceLanguage: 'en' },
  { categoryId: 'czech_republic', categoryName: 'Czech Republic', sourceLanguage: 'cs' },
  { categoryId: 'denmark', categoryName: 'Denmark', sourceLanguage: 'dk' },
  { categoryId: 'economy', categoryName: 'Economy', sourceLanguage: 'en' },
  { categoryId: 'estonia', categoryName: 'Estonia', sourceLanguage: 'et' },
  { categoryId: 'europe', categoryName: 'Europe', sourceLanguage: 'en' },
  { categoryId: 'finland', categoryName: 'Finland', sourceLanguage: 'fi' },
  { categoryId: 'formula_1', categoryName: 'Formula 1', sourceLanguage: 'en' },
  { categoryId: 'france', categoryName: 'France', sourceLanguage: 'fr' },
  { categoryId: 'french_music', categoryName: 'French Music', sourceLanguage: 'fr' },
  { categoryId: 'germany', categoryName: 'Germany', sourceLanguage: 'de' },
  { categoryId: 'germany_|_baden-württemberg', categoryName: 'Germany | Baden-Württemberg', sourceLanguage: 'de' },
  { categoryId: 'germany_|_hesse', categoryName: 'Germany | Hesse', sourceLanguage: 'de' },
  { categoryId: 'google', categoryName: 'Google', sourceLanguage: 'en' },
  { categoryId: 'greece', categoryName: 'Greece', sourceLanguage: 'gr' },
  { categoryId: 'healthcare_|_usa', categoryName: 'Healthcare | USA', sourceLanguage: 'en' },
  { categoryId: 'hong_kong', categoryName: 'Hong Kong', sourceLanguage: 'en' },
  { categoryId: 'hungary', categoryName: 'Hungary', sourceLanguage: 'hu' },
  { categoryId: 'india', categoryName: 'India', sourceLanguage: 'en' },
  { categoryId: 'india_|_tamil nadu', categoryName: 'Tamil Nadu', sourceLanguage: 'ta' },
  { categoryId: 'iran', categoryName: 'Iran', sourceLanguage: 'en' },
  { categoryId: 'ireland', categoryName: 'Ireland', sourceLanguage: 'en' },
  { categoryId: 'israel', categoryName: 'Israel', sourceLanguage: 'he' },
  { categoryId: 'italy', categoryName: 'Italy', sourceLanguage: 'it' },
  { categoryId: 'japan', categoryName: 'Japan', sourceLanguage: 'ja' },
  { categoryId: 'linux_oss', categoryName: 'Linux & OSS', sourceLanguage: 'en' },
  { categoryId: 'lithuania', categoryName: 'Lithuania', sourceLanguage: 'lt' },
  { categoryId: 'mexico', categoryName: 'Mexico', sourceLanguage: 'es' },
  { categoryId: 'microsoft', categoryName: 'Microsoft', sourceLanguage: 'en' },
  { categoryId: 'middle_east', categoryName: 'Middle East', sourceLanguage: 'en' },
  { categoryId: 'morocco', categoryName: 'Morocco', sourceLanguage: 'ar' },
  { categoryId: 'new_zealand', categoryName: 'New Zealand', sourceLanguage: 'en' },
  { categoryId: 'nfl', categoryName: 'NFL', sourceLanguage: 'en' },
  { categoryId: 'nhl', categoryName: 'NHL', sourceLanguage: 'en' },
  { categoryId: 'nintendo', categoryName: 'Nintendo', sourceLanguage: 'en' },
  { categoryId: 'norway', categoryName: 'Norway', sourceLanguage: 'no' },
  { categoryId: 'pakistan', categoryName: 'Pakistan', sourceLanguage: 'en' },
  { categoryId: 'palestine', categoryName: 'Palestine', sourceLanguage: 'en' },
  { categoryId: 'philippines', categoryName: 'Philippines', sourceLanguage: 'en' },
  { categoryId: 'podcasting', categoryName: 'Podcasting', sourceLanguage: 'en' },
  { categoryId: 'poland', categoryName: 'Poland', sourceLanguage: 'pl' },
  { categoryId: 'portugal', categoryName: 'Portugal', sourceLanguage: 'pt' },
  { categoryId: 'privacy', categoryName: 'Privacy', sourceLanguage: 'en' },
  { categoryId: 'romania', categoryName: 'Romania', sourceLanguage: 'ro' },
  { categoryId: 'russia', categoryName: 'Russia', sourceLanguage: 'ru' },
  { categoryId: 'serbia', categoryName: 'Serbia', sourceLanguage: 'sr' },
  { categoryId: 'simulation_games', categoryName: 'Simulation Games', sourceLanguage: 'en' },
  { categoryId: 'singapore', categoryName: 'Singapore', sourceLanguage: 'en' },
  { categoryId: 'slovakia', categoryName: 'Slovakia', sourceLanguage: 'sk' },
  { categoryId: 'slovenia', categoryName: 'Slovenia', sourceLanguage: 'sl' },
  { categoryId: 'south_korea', categoryName: 'South Korea', sourceLanguage: 'ko' },
  { categoryId: 'spain', categoryName: 'Spain', sourceLanguage: 'es' },
  { categoryId: 'sweden', categoryName: 'Sweden', sourceLanguage: 'sv' },
  { categoryId: 'switzerland_(de)', categoryName: 'Switzerland (DE)', sourceLanguage: 'de' },
  { categoryId: 'switzerland_(fr)', categoryName: 'Switzerland (FR)', sourceLanguage: 'fr' },
  { categoryId: 'taiwan', categoryName: 'Taiwan', sourceLanguage: 'zh-Hant' },
  { categoryId: 'thailand', categoryName: 'Thailand', sourceLanguage: 'th' },
  { categoryId: 'the_netherlands', categoryName: 'The Netherlands', sourceLanguage: 'nl' },
  { categoryId: 'turkey', categoryName: 'Turkey', sourceLanguage: 'tr' },
  { categoryId: 'uk', categoryName: 'UK', sourceLanguage: 'en' },
  { categoryId: 'ukraine', categoryName: 'Ukraine', sourceLanguage: 'uk' },

  { categoryId: 'usa_|_austin, tx', categoryName: 'USA | Austin, TX', sourceLanguage: 'en' },
  { categoryId: 'usa_|_chicago', categoryName: 'USA | Chicago', sourceLanguage: 'en' },
  { categoryId: 'usa_|_colorado', categoryName: 'USA | Colorado', sourceLanguage: 'en' },
  { categoryId: 'usa_|_hawaii', categoryName: 'USA | Hawaii', sourceLanguage: 'en' },
  { categoryId: 'usa_|_michigan', categoryName: 'USA | Michigan', sourceLanguage: 'en' },
  { categoryId: 'usa_|_minnesota', categoryName: 'USA | Minnesota', sourceLanguage: 'en' },
  { categoryId: 'usa_|_nevada', categoryName: 'USA | Nevada', sourceLanguage: 'en' },
  { categoryId: 'usa_|_new mexico', categoryName: 'USA | New Mexico', sourceLanguage: 'en' },
  { categoryId: 'usa_|_new york city', categoryName: 'USA | New York City', sourceLanguage: 'en' },
  { categoryId: 'usa_|_ohio', categoryName: 'USA | Ohio', sourceLanguage: 'en' },
  { categoryId: 'usa_|_utah', categoryName: 'USA | Utah', sourceLanguage: 'en' },
  { categoryId: 'usa_|_vermont', categoryName: 'USA | Vermont', sourceLanguage: 'en' },
  { categoryId: 'usa_|_virginia', categoryName: 'USA | Virginia', sourceLanguage: 'en' },
  { categoryId: 'usa_|_washington', categoryName: 'USA | Washington', sourceLanguage: 'en' },

  { categoryId: 'watches_&_horology', categoryName: 'Watches & Horology', sourceLanguage: 'en' },
  { categoryId: 'onthisday', categoryName: 'On This Day', sourceLanguage: 'en' }
];


export default function NewsFeed({ onArticleSelect, onCategoryChange, selectedNews = null, targetLanguage = 'zh-CN', nativeLanguage = 'zh-CN', isMobile = false }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(categories[0].categoryId);
  const [isReady, setIsReady] = useState(false);
  const cardRefs = useRef({});
  const listContainerRef = useRef(null);
  const previousScrollLeftRef = useRef(null);

  const fetchNews = useCallback(async (category) => {
    setLoading(true);
    setError(null);
    setArticles([]);

    try {
      const response = await fetch(`/api/news?category=${encodeURIComponent(category)}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to fetch news for category: ${category}`);
      }
      const rssText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(rssText, 'application/xml');
      const items = xmlDoc.querySelectorAll('item');

      const newArticles = Array.from(items).map((item, index) => {
        let description = item.querySelector('description')?.textContent || '';
        const sourcesIndex = description.indexOf('<h3>Sources:</h3>');
        if (sourcesIndex !== -1) {
          description = description.substring(0, sourcesIndex);
        }

        const imgMatch = description.match(/<img src='([^']*)'/);
        const urlToImage = imgMatch ? imgMatch[1] : null;

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
        description = description.trim();

        return {
          id: `${category}-${index}`,
          title: item.querySelector('title')?.textContent || 'Untitled',
          link: item.querySelector('link')?.textContent || '',
          description: description || 'No description available',
          urlToImage: urlToImage,
          category: categories.find(cat => cat.categoryId === category)?.categoryName || 'News',
          date: item.querySelector('pubDate')?.textContent || new Date().toISOString(),
        };
      });

      setArticles(newArticles);

    } catch (err) {
      console.error('Failed to fetch news:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount: restore saved category from localStorage, then mark ready.
  // Both setSelectedCategory and setIsReady are batched into the same re-render,
  // so the fetch effect below will fire exactly once with the correct category.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lingdaily-category');
      if (saved && categories.some(c => c.categoryId === saved)) {
        setSelectedCategory(saved);
      }
    } catch (_) { /* ignore */ }
    setIsReady(true);
  }, []);

  // Fetch news whenever category changes, but only after the initial restore is done.
  useEffect(() => {
    if (!isReady) return;
    fetchNews(selectedCategory);
  }, [selectedCategory, isReady, fetchNews]);

  // Handle user clicking a category button: persist + update state + notify parent
  const handleCategoryClick = useCallback((categoryId) => {
    setSelectedCategory(categoryId);
    try { localStorage.setItem('lingdaily-category', categoryId); } catch (_) { /* ignore */ }
    onCategoryChange?.();
  }, [onCategoryChange]);

  const translateArticleTitles = useCallback((newArticles) => {
    newArticles.forEach((article) => {
      if (!article.title) return;
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: article.title, targetLang: nativeLanguage }),
      })
        .then(res => res.ok ? res.json() : null)
        .then(transData => {
          if (transData && transData.translation) {
            setArticles(prevArticles =>
              prevArticles.map(prevArticle =>
                prevArticle.link === article.link
                  ? { ...prevArticle, translatedTitle: transData.translation }
                  : prevArticle
              )
            );
          }
        })
        .catch(err => {
          console.error(`Failed to translate article title: "${article.title}"`, err);
        });
    });
  }, [nativeLanguage]);

  const mobileHasSelection = Boolean(isMobile && selectedNews);

  useEffect(() => {
    if (!isMobile) return;

    const container = listContainerRef.current;
    if (!container) return;

    if (selectedNews) {
      if (previousScrollLeftRef.current === null) {
        previousScrollLeftRef.current = container.scrollLeft;
      }

      const target = cardRefs.current[selectedNews.id];
      if (!target) return;

      const containerStyle = window.getComputedStyle(container);
      const paddingLeft = parseFloat(containerStyle.paddingLeft || "0");
      const containerWidth = container.clientWidth;
      const cardWidth = target.offsetWidth;
      const targetLeft = target.offsetLeft;
      const targetTop = target.offsetTop;

      console.log(
        `[NewsFeed] Selected card "${selectedNews.id}" position -> left: ${targetLeft}, top: ${targetTop}, width: ${cardWidth}`
      );

      let nextScrollLeft = targetLeft - paddingLeft - (containerWidth - cardWidth) / 2;
      const maxScroll = container.scrollWidth - containerWidth;
      nextScrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScroll));

      container.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
      return;
    }

    if (previousScrollLeftRef.current !== null) {
      const restorePosition = previousScrollLeftRef.current;
      previousScrollLeftRef.current = null;
      container.scrollTo({ left: restorePosition, behavior: "smooth" });
    }
  }, [isMobile, selectedNews]);

  const categorySelectorRef = useRef(null);

  // Auto-scroll category bar so the selected category is visible
  // Also re-runs when loading finishes to handle the DOM being stable after fetch
  useEffect(() => {
    const container = categorySelectorRef.current;
    if (!container) return;
    const activeBtn = container.querySelector('[data-category-active="true"]');
    if (activeBtn) {
      // scrollIntoView with inline 'center' puts the button in the middle of the scrollable area
      activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedCategory, loading]);

  const hasSelectedNews = mobileHasSelection;

  const categorySelectorJSX = (
    <div
      className={`transition-all duration-500 ease-in-out ${isMobile ? "px-2 sticky top-0 bg-background z-10" : "px-2"} ${hasSelectedNews
          ? 'max-h-0 opacity-0 pointer-events-none overflow-hidden -translate-y-2 mb-0 custom-scroll'
          : 'max-h-24 opacity-100 pointer-events-auto mb-4 translate-y-0'
        }`}
    >
      <div className={`relative flex items-center min-h-0 transition-all duration-500 ease-in-out ${hasSelectedNews ? "scale-95" : "scale-100"}`}>
        <div
          ref={categorySelectorRef}
          className={`flex overflow-x-auto custom-scroll gap-2 py-2 transition-opacity duration-300 ease-in-out ${hasSelectedNews ? "opacity-0" : "opacity-100"}`}
          style={{
            touchAction: 'pan-x pinch-zoom',
            overscrollBehaviorX: 'contain',
            overscrollBehaviorY: 'none'
          }}
          aria-hidden={hasSelectedNews}
        >
          {categories.map((category) => (
            <button
              key={category.categoryId}
              data-category-active={selectedCategory === category.categoryId ? "true" : null}
              onClick={() => handleCategoryClick(category.categoryId)}
              disabled={loading}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap ${selectedCategory === category.categoryId
                  ? "bg-primary text-primary-foreground shadow-md scale-105"
                  : "bg-secondary hover:bg-secondary/80 text-secondary-foreground hover:scale-102"
                } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {category.categoryName}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div>
        {categorySelectorJSX}
        <div className={isMobile ? "flex gap-3" : "space-y-4 px-2 py-2"}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className={`bg-card rounded-lg border p-4 ${isMobile ? "min-w-[280px]" : ""}`}>
                <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-muted rounded w-full mb-1"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {categorySelectorJSX}
        <div className="p-4">
          <div className="text-red-500 bg-red-100 p-3 rounded-lg">
            Error loading news: {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {categorySelectorJSX}
      <div
        ref={isMobile ? listContainerRef : null}
        className={isMobile ? "flex gap-3 overflow-x-auto custom-scroll px-2" : "space-y-4 px-2 py-2"}
        style={isMobile ? {
          touchAction: 'pan-x pinch-zoom',
          scrollBehavior: 'smooth',
          overscrollBehaviorX: 'contain',
          overscrollBehaviorY: 'none'
        } : {}}
      >
        {articles.map((article) => {
          // 转换数据格式以匹配现有NewsCard组件
          const newsData = {
            id: article.id,
            title: article.translatedTitle || article.title,
            description: article.description,
            category: article.category,
            date: article.date,
            originalTitle: article.title,
            link: article.link,
            urlToImage: article.urlToImage
          };

          const isSelected = selectedNews?.id === article.id;

          return (
            <div
              key={article.id}
              className={
                isMobile
                  ? mobileHasSelection
                    ? `flex-shrink-0 transition-all duration-300 ease-in-out w-full min-w-full max-w-full h-[25vh] ${isSelected ? "scale-100 opacity-100" : "scale-95 opacity-80"}`
                    : "flex-shrink-0 transition-all duration-300 ease-in-out w-[260px] h-48"
                  : `transition-all duration-300 ease-in-out ${isSelected ? "h-96" : "h-48"}`
              }
              ref={(el) => {
                if (el) {
                  cardRefs.current[article.id] = el;
                } else {
                  delete cardRefs.current[article.id];
                }
              }}
            >
              <NewsCard
                news={newsData}
                isSelected={isSelected}
                onSelect={() => onArticleSelect && onArticleSelect(isSelected ? null : newsData)}
                compact={isMobile}
                mobileHasSelection={mobileHasSelection}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
