import { auth } from "@/app/auth";
import {
  DEFAULT_LEARNING_LANGUAGE,
  DEFAULT_NATIVE_LANGUAGE,
  getLanguage,
} from "@/app/lib/languages";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || "public";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGE_COLUMNS = [
  "title_target",
  "description_target",
  "target_language_code",
  "native_language_code",
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sbHeaders(session) {
  const bearer = supabaseServiceRoleKey || session?.supabaseAccessToken || supabaseAnonKey;
  return {
    "Content-Type": "application/json",
    apikey: supabaseServiceRoleKey || supabaseAnonKey,
    Authorization: `Bearer ${bearer}`,
    "Content-Profile": supabaseSchema,
    "Accept-Profile": supabaseSchema,
    Accept: "application/json",
    Prefer: "return=representation",
  };
}

const SLUG_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

function optionalText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

function isMissingLanguageColumns(payload) {
  const code = String(payload?.code || "");
  const description = [payload?.message, payload?.details, payload?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const missingColumn = description.includes("schema cache")
    || description.includes("does not exist")
    || description.includes("could not find");
  return (code === "PGRST204" || code === "42703" || missingColumn)
    && LANGUAGE_COLUMNS.some((column) => description.includes(column));
}

async function insertScenario(row, session) {
  const res = await fetch(`${supabaseUrl}/rest/v1/scenarios`, {
    method: "POST",
    headers: sbHeaders(session),
    body: JSON.stringify(row),
    cache: "no-store",
  });
  const text = await res.text();
  return { res, data: parseJson(text, null) };
}

function legacyTargetValue(body, prefix, languageCode) {
  if (languageCode === "en") return body[`${prefix}_en`];
  if (languageCode === "ja") return body[`${prefix}_ja`];
  if (languageCode === "zh-CN") return body[`${prefix}_zh`];
  return null;
}

// GET /api/scenarios?categories=true        → distinct categories derived from system scenarios
// GET /api/scenarios?categorySlug={slug}    → system scenarios in a category
// GET /api/scenarios?id={uuid}              → single scenario
// GET /api/scenarios?mine=true              → current user's scenarios (auth required)
// GET /api/scenarios?public=true            → all user-generated public scenarios
export async function GET(req) {
  try {
    if (!supabaseUrl || (!supabaseServiceRoleKey && !supabaseAnonKey)) {
      return jsonResponse({ error: "Missing Supabase env configuration" }, 500);
    }

    const { searchParams } = new URL(req.url);

    // Derive distinct categories from system scenarios (user_id IS NULL)
    if (searchParams.get("categories") === "true") {
      const query = new URLSearchParams({
        user_id: "is.null",
        is_active: "eq.true",
        select: "category_slug,category_name_zh,category_name_en,category_name_ja,category_icon,category_sort",
        order: "category_sort.asc,category_slug.asc",
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
        headers: sbHeaders(),
        cache: "no-store",
      });
      const rows = await res.json().catch(() => []);
      if (!res.ok) {
        console.error("Failed to fetch scenario categories:", res.status, rows);
        return jsonResponse({ error: "Failed to fetch categories" }, 502);
      }

      // Deduplicate by category_slug and normalize field names for the frontend
      const seen = new Set();
      const categories = rows
        .filter((r) => {
          if (seen.has(r.category_slug)) return false;
          seen.add(r.category_slug);
          return true;
        })
        .map((r) => ({
          id: r.category_slug,          // use slug as stable id
          slug: r.category_slug,
          name_zh: r.category_name_zh,
          name_en: r.category_name_en,
          name_ja: r.category_name_ja,
          icon: r.category_icon,
          sort_order: r.category_sort,
        }));
      return jsonResponse({ ok: true, data: categories });
    }

    // User's own scenarios (auth required)
    if (searchParams.get("mine") === "true") {
      const session = await auth();
      if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);
      if (!UUID_PATTERN.test(session.user.id)) {
        return jsonResponse({ error: "Account storage is not provisioned" }, 503);
      }
      const query = new URLSearchParams({
        user_id: `eq.${session.user.id}`,
        is_active: "eq.true",
        order: "created_at.desc",
        select: "*",
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
        headers: sbHeaders(session),
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        console.error("Failed to fetch user scenarios:", res.status, data);
        return jsonResponse({ error: "Failed to fetch user scenarios" }, 502);
      }
      return jsonResponse({ ok: true, data });
    }

    // Public user-generated scenarios
    if (searchParams.get("public") === "true") {
      const query = new URLSearchParams({
        user_id: "not.is.null",
        is_public: "eq.true",
        is_active: "eq.true",
        order: "created_at.desc",
        select: "*",
        limit: "50",
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
        headers: sbHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        console.error("Failed to fetch public scenarios:", res.status, data);
        return jsonResponse({ error: "Failed to fetch public scenarios" }, 502);
      }
      return jsonResponse({ ok: true, data });
    }

    // System scenarios by category slug
    const categorySlug = searchParams.get("categorySlug");
    if (categorySlug) {
      if (categorySlug.length > 80 || !SLUG_PATTERN.test(categorySlug)) {
        return jsonResponse({ error: "Invalid category slug" }, 400);
      }
      const query = new URLSearchParams({
        category_slug: `eq.${categorySlug}`,
        user_id: "is.null",
        is_active: "eq.true",
        order: "sort_order.asc,title_en.asc",
        select: "*",
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
        headers: sbHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        console.error("Failed to fetch scenarios:", res.status, data);
        return jsonResponse({ error: "Failed to fetch scenarios" }, 502);
      }
      return jsonResponse({ ok: true, data });
    }

    // Single scenario by id
    const id = searchParams.get("id");
    if (id) {
      if (!UUID_PATTERN.test(id)) return jsonResponse({ error: "Invalid scenario id" }, 400);
      const session = await auth();
      const visibility = [
        "and(user_id.is.null,is_active.eq.true)",
        "and(is_public.eq.true,is_active.eq.true)",
      ];
      if (session?.user?.id && UUID_PATTERN.test(session.user.id)) {
        visibility.push(`user_id.eq.${session.user.id}`);
      }
      const query = new URLSearchParams({
        id: `eq.${id}`,
        or: `(${visibility.join(",")})`,
        select: "*",
        limit: "1",
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
        headers: sbHeaders(session),
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        console.error("Failed to fetch scenario:", res.status, data);
        return jsonResponse({ error: "Failed to fetch scenario" }, 502);
      }
      return jsonResponse({ ok: true, data: data[0] || null });
    }

    return jsonResponse(
      { error: "Provide ?categories=true, ?categorySlug=, ?id=, ?mine=true, or ?public=true" },
      400
    );
  } catch (error) {
    console.error("Scenario GET error:", error);
    return jsonResponse({ error: "Unable to fetch scenarios" }, 500);
  }
}

// POST /api/scenarios — save a user-generated scenario
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);
    if (!UUID_PATTERN.test(session.user.id)) {
      return jsonResponse({ error: "Account storage is not provisioned" }, 503);
    }
    if (!supabaseUrl || (!supabaseServiceRoleKey && !supabaseAnonKey)) {
      return jsonResponse({ error: "Scenario storage is not configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const targetCode = body.target_language_code
      ?? body.learningLanguage?.code
      ?? DEFAULT_LEARNING_LANGUAGE.code;
    const nativeCode = body.native_language_code
      ?? body.nativeLanguage?.code
      ?? DEFAULT_NATIVE_LANGUAGE.code;
    const learningLanguage = getLanguage(targetCode, { allowChinese: false });
    const nativeLanguage = getLanguage(nativeCode);
    if (!learningLanguage || !nativeLanguage || learningLanguage.code === nativeLanguage.code) {
      return jsonResponse({ error: "Unsupported learning or native language code" }, 400);
    }

    const titleZh = optionalText(body.title_zh, 200);
    const titleEn = optionalText(body.title_en, 200);
    const systemPrompt = optionalText(body.system_prompt, 12000);
    const titleTarget = optionalText(
      body.title_target ?? legacyTargetValue(body, "title", learningLanguage.code),
      200
    );
    const descriptionTarget = optionalText(
      body.description_target ?? legacyTargetValue(body, "description", learningLanguage.code),
      12000
    );

    if (!titleZh || !titleEn || !titleTarget || !systemPrompt) {
      return jsonResponse(
        { error: "title_zh, title_en, title_target, and system_prompt are required" },
        400
      );
    }

    const requestedCategory = body.category_slug || body.category_suggestion;
    const categorySlug = typeof requestedCategory === "string"
      && requestedCategory.length <= 80
      && SLUG_PATTERN.test(requestedCategory)
      ? requestedCategory
      : "other";

    const row = {
      user_id: session.user.id,
      is_public: body.is_public === true,
      // Category info for user scenarios
      category_slug: categorySlug,
      category_name_zh: optionalText(body.category_name_zh, 100)
        || (body.is_public === true ? "社区场景" : "我的场景"),
      category_name_en: optionalText(body.category_name_en, 100)
        || (body.is_public === true ? "Community" : "My Scenarios"),
      category_name_ja: optionalText(body.category_name_ja, 100),
      category_icon: optionalText(body.category_icon, 16) || "✨",
      category_sort: 99,
      // Content
      title_zh: titleZh,
      title_en: titleEn,
      title_ja: optionalText(body.title_ja, 200),
      description_zh: optionalText(body.description_zh, 12000),
      description_en: optionalText(body.description_en, 12000),
      description_ja: optionalText(body.description_ja, 12000),
      title_target: titleTarget,
      description_target: descriptionTarget,
      target_language_code: learningLanguage.code,
      native_language_code: nativeLanguage.code,
      difficulty: ["beginner", "intermediate", "advanced"].includes(body.difficulty)
        ? body.difficulty
        : "intermediate",
      system_prompt: systemPrompt,
      sort_order: 0,
      is_active: true,
    };

    let result = await insertScenario(row, session);
    let usedLegacySchema = false;
    if (!result.res.ok && isMissingLanguageColumns(result.data)) {
      if (
        learningLanguage.code !== DEFAULT_LEARNING_LANGUAGE.code
        || nativeLanguage.code !== DEFAULT_NATIVE_LANGUAGE.code
      ) {
        return jsonResponse({ error: "Scenario storage is being upgraded; please retry shortly" }, 503);
      }
      const legacyRow = { ...row };
      for (const column of LANGUAGE_COLUMNS) delete legacyRow[column];
      result = await insertScenario(legacyRow, session);
      usedLegacySchema = true;
    }
    if (!result.res.ok) {
      console.error("Failed to save scenario:", result.res.status, result.data);
      return jsonResponse({ error: "Failed to save scenario" }, 502);
    }
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    return jsonResponse({ ok: true, data, ...(usedLegacySchema ? { legacySchema: true } : {}) });
  } catch (error) {
    console.error("Scenario POST error:", error);
    return jsonResponse({ error: "Unable to save scenario" }, 500);
  }
}

// DELETE /api/scenarios?id={uuid} — delete user's own scenario only
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);
    if (!UUID_PATTERN.test(session.user.id)) {
      return jsonResponse({ error: "Account storage is not provisioned" }, 503);
    }
    if (!supabaseUrl || (!supabaseServiceRoleKey && !supabaseAnonKey)) {
      return jsonResponse({ error: "Scenario storage is not configured" }, 500);
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return jsonResponse({ error: "id is required" }, 400);
    if (!UUID_PATTERN.test(id)) return jsonResponse({ error: "Invalid scenario id" }, 400);

    const query = new URLSearchParams({
      id: `eq.${id}`,
      user_id: `eq.${session.user.id}`,
    });
    const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
      method: "DELETE",
      headers: sbHeaders(session),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      console.error("Failed to delete scenario:", res.status, data);
      return jsonResponse({ error: "Delete failed" }, 502);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Scenario DELETE error:", error);
    return jsonResponse({ error: "Unable to delete scenario" }, 500);
  }
}
