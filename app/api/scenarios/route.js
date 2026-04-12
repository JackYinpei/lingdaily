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

function headers() {
  const bearer = supabaseServiceRoleKey || supabaseAnonKey;
  return {
    apikey: supabaseServiceRoleKey || supabaseAnonKey,
    Authorization: `Bearer ${bearer}`,
    "Content-Profile": supabaseSchema,
    Accept: "application/json",
  };
}

// Public read-only endpoint
// GET /api/scenarios?categories=true           → list all scenario categories
// GET /api/scenarios?categoryId={uuid}         → list scenarios in a category
// GET /api/scenarios?id={uuid}                 → single scenario
export async function GET(req) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Missing Supabase env configuration" }, 500);
    }

    const { searchParams } = new URL(req.url);

    // List categories
    if (searchParams.get("categories") === "true") {
      const url = `${supabaseUrl}/rest/v1/scenario_categories?order=sort_order.asc,name_en.asc&select=*`;
      const res = await fetch(url, { headers: headers(), cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch categories" }, res.status);
      return jsonResponse({ ok: true, data });
    }

    // List scenarios by category
    const categoryId = searchParams.get("categoryId");
    if (categoryId) {
      const query = new URLSearchParams({
        category_id: `eq.${categoryId}`,
        is_active: "eq.true",
        order: "sort_order.asc,title_en.asc",
        select: "*",
      });
      const url = `${supabaseUrl}/rest/v1/scenarios?${query}`;
      const res = await fetch(url, { headers: headers(), cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch scenarios" }, res.status);
      return jsonResponse({ ok: true, data });
    }

    // Single scenario
    const id = searchParams.get("id");
    if (id) {
      const url = `${supabaseUrl}/rest/v1/scenarios?id=eq.${id}&select=*&limit=1`;
      const res = await fetch(url, { headers: headers(), cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (!res.ok) return jsonResponse({ error: data?.message || "Failed to fetch scenario" }, res.status);
      return jsonResponse({ ok: true, data: data[0] || null });
    }

    return jsonResponse({ error: "Provide ?categories=true, ?categoryId=, or ?id=" }, 400);
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}
