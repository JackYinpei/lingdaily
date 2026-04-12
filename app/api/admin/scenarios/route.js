import { checkAdmin } from "@/app/lib/adminAuth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || "public";
const tableUrl = supabaseUrl ? `${supabaseUrl}/rest/v1/scenarios` : null;

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
    Prefer: "return=representation",
  };
}

// Admin: list all scenarios (including inactive)
export async function GET(req) {
  try {
    const session = await checkAdmin();
    if (!session) return jsonResponse({ error: "Forbidden" }, 403);
    if (!tableUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("categoryId");

    const query = new URLSearchParams({ order: "sort_order.asc,title_en.asc", select: "*" });
    if (categoryId) query.set("category_id", `eq.${categoryId}`);

    const res = await fetch(`${tableUrl}?${query}`, {
      headers: sbHeaders(),
      cache: "no-store",
    });
    const data = await res.json().catch(() => []);
    if (!res.ok) return jsonResponse({ error: data?.message || "Fetch failed" }, res.status);
    return jsonResponse({ ok: true, data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

export async function POST(req) {
  try {
    const session = await checkAdmin();
    if (!session) return jsonResponse({ error: "Forbidden" }, 403);
    if (!tableUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const body = await req.json().catch(() => ({}));
    const { category_id, title_zh, title_en, system_prompt } = body;
    if (!category_id || !title_zh || !title_en || !system_prompt) {
      return jsonResponse({ error: "category_id, title_zh, title_en, system_prompt are required" }, 400);
    }

    const row = {
      category_id,
      title_zh,
      title_en,
      title_ja: body.title_ja || null,
      description_zh: body.description_zh || null,
      description_en: body.description_en || null,
      description_ja: body.description_ja || null,
      difficulty: body.difficulty || "intermediate",
      system_prompt,
      sort_order: body.sort_order ?? 0,
      is_active: body.is_active !== false,
    };

    const res = await fetch(tableUrl, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify(row),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return jsonResponse({ error: data?.message || "Create failed" }, res.status);
    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

export async function PUT(req) {
  try {
    const session = await checkAdmin();
    if (!session) return jsonResponse({ error: "Forbidden" }, 403);
    if (!tableUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const body = await req.json().catch(() => ({}));
    const { id, ...fields } = body;
    if (!id) return jsonResponse({ error: "id is required" }, 400);

    const res = await fetch(`${tableUrl}?id=eq.${id}`, {
      method: "PATCH",
      headers: sbHeaders(),
      body: JSON.stringify(fields),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return jsonResponse({ error: data?.message || "Update failed" }, res.status);
    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

export async function DELETE(req) {
  try {
    const session = await checkAdmin();
    if (!session) return jsonResponse({ error: "Forbidden" }, 403);
    if (!tableUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return jsonResponse({ error: "id is required" }, 400);

    const res = await fetch(`${tableUrl}?id=eq.${id}`, {
      method: "DELETE",
      headers: sbHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return jsonResponse({ error: data?.message || "Delete failed" }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}
