import { checkAdmin } from "@/app/lib/adminAuth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || "public";
const tableUrl = supabaseUrl ? `${supabaseUrl}/rest/v1/scenario_categories` : null;

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

export async function POST(req) {
  try {
    const session = await checkAdmin();
    if (!session) return jsonResponse({ error: "Forbidden" }, 403);
    if (!tableUrl) return jsonResponse({ error: "Missing Supabase config" }, 500);

    const body = await req.json().catch(() => ({}));
    const { slug, name_zh, name_en, name_ja, icon, sort_order } = body;
    if (!slug || !name_zh || !name_en) {
      return jsonResponse({ error: "slug, name_zh, name_en are required" }, 400);
    }

    const res = await fetch(tableUrl, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ slug, name_zh, name_en, name_ja: name_ja || null, icon: icon || null, sort_order: sort_order ?? 0 }),
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
