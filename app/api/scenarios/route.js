import { auth } from "@/app/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || "public";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sbHeaders() {
  const bearer = supabaseServiceRoleKey || supabaseAnonKey;
  return {
    "Content-Type": "application/json",
    apikey: supabaseServiceRoleKey || supabaseAnonKey,
    Authorization: `Bearer ${bearer}`,
    "Content-Profile": supabaseSchema,
    Accept: "application/json",
    Prefer: "return=representation",
  };
}

// GET /api/scenarios?categories=true        → distinct categories derived from system scenarios
// GET /api/scenarios?categorySlug={slug}    → system scenarios in a category
// GET /api/scenarios?id={uuid}              → single scenario
// GET /api/scenarios?mine=true              → current user's scenarios (auth required)
// GET /api/scenarios?public=true            → all user-generated public scenarios
export async function GET(req) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
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
      if (!res.ok) return jsonResponse({ error: rows?.message || "Failed to fetch categories" }, res.status);

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
      const query = new URLSearchParams({
        user_id: `eq.${session.user.id}`,
        is_active: "eq.true",
        order: "created_at.desc",
        select: "*",
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?${query}`, {
        headers: sbHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch user scenarios" }, res.status);
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
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch public scenarios" }, res.status);
      return jsonResponse({ ok: true, data });
    }

    // System scenarios by category slug
    const categorySlug = searchParams.get("categorySlug");
    if (categorySlug) {
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
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch scenarios" }, res.status);
      return jsonResponse({ ok: true, data });
    }

    // Single scenario by id
    const id = searchParams.get("id");
    if (id) {
      const res = await fetch(`${supabaseUrl}/rest/v1/scenarios?id=eq.${id}&select=*&limit=1`, {
        headers: sbHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch scenario" }, res.status);
      return jsonResponse({ ok: true, data: data[0] || null });
    }

    return jsonResponse(
      { error: "Provide ?categories=true, ?categorySlug=, ?id=, ?mine=true, or ?public=true" },
      400
    );
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

// POST /api/scenarios — save a user-generated scenario
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);
    if (!supabaseUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const body = await req.json().catch(() => ({}));
    const { title_zh, title_en, description_zh, description_en, difficulty, system_prompt } = body;

    if (!title_zh || !title_en || !system_prompt) {
      return jsonResponse({ error: "title_zh, title_en, and system_prompt are required" }, 400);
    }

    const row = {
      user_id: session.user.id,
      is_public: body.is_public === true,
      // Category info for user scenarios
      category_slug: body.category_slug || "other",
      category_name_zh: body.category_name_zh || (body.is_public === true ? "社区场景" : "我的场景"),
      category_name_en: body.category_name_en || (body.is_public === true ? "Community" : "My Scenarios"),
      category_name_ja: body.category_name_ja || null,
      category_icon: body.category_icon || "✨",
      category_sort: 99,
      // Content
      title_zh,
      title_en,
      title_ja: body.title_ja || null,
      description_zh: description_zh || null,
      description_en: description_en || null,
      description_ja: body.description_ja || null,
      difficulty: ["beginner", "intermediate", "advanced"].includes(difficulty) ? difficulty : "intermediate",
      system_prompt,
      sort_order: 0,
      is_active: true,
    };

    const res = await fetch(`${supabaseUrl}/rest/v1/scenarios`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify(row),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return jsonResponse({ error: data?.message || "Failed to save scenario" }, res.status);
    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

// DELETE /api/scenarios?id={uuid} — delete user's own scenario only
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);
    if (!supabaseUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return jsonResponse({ error: "id is required" }, 400);

    const res = await fetch(
      `${supabaseUrl}/rest/v1/scenarios?id=eq.${id}&user_id=eq.${session.user.id}`,
      { method: "DELETE", headers: sbHeaders(), cache: "no-store" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return jsonResponse({ error: data?.message || "Delete failed" }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}
