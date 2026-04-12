import { auth } from "@/app/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || "public";

const tableUrl = supabaseUrl ? `${supabaseUrl}/rest/v1/chat_history` : null;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req) {
  try {
    if (!tableUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Missing Supabase env configuration" }, 500);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => ({}));
    const {
      newsKey,
      newsTitle,
      newsContent,
      history,
      summary,
      sourceType,
    } = payload || {};

    if (!newsKey || typeof newsKey !== "string") {
      return jsonResponse({ error: "'newsKey' is required" }, 400);
    }

    if (!Array.isArray(history)) {
      return jsonResponse({ error: "'history' must be an array" }, 400);
    }

    const row = {
      user_id: session.user.id,
      news_key: newsKey,
      news_title: newsTitle ?? null,
      news: newsContent ?? null,
      history,
      summary: typeof summary === "string" ? summary : summary ?? null,
      source_type: sourceType || "news",
    };

    const bearer = supabaseServiceRoleKey || session.supabaseAccessToken || supabaseAnonKey;
    const apiKeyHeader = supabaseServiceRoleKey || supabaseAnonKey;

    const response = await fetch(`${tableUrl}?on_conflict=user_id,news_key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKeyHeader,
        Authorization: `Bearer ${bearer}`,
        "Content-Profile": supabaseSchema,
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.hint || data?.error || data?.raw || "Failed to upsert chat history";
      return jsonResponse({ error: message, details: data }, response.status || 400);
    }

    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

export async function GET(req) {
  try {
    if (!tableUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Missing Supabase env configuration" }, 500);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { searchParams } = new URL(req.url);
    const newsKey = searchParams.get("newsKey");
    const limitParam = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 20;

    const query = new URLSearchParams();
    query.set("user_id", `eq.${session.user.id}`);
    query.set("select", "id,news_key,news_title,news,history,summary,created_at,updated_at");
    query.set("order", "updated_at.desc");
    query.set("limit", String(limit));
    if (newsKey) {
      query.set("news_key", `eq.${newsKey}`);
      query.set("limit", "1");
    }

    const bearer = supabaseServiceRoleKey || session.supabaseAccessToken || supabaseAnonKey;
    const apiKeyHeader = supabaseServiceRoleKey || supabaseAnonKey;

    const response = await fetch(`${tableUrl}?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: apiKeyHeader,
        Authorization: `Bearer ${bearer}`,
        "Content-Profile": supabaseSchema,
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : [];
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.hint || data?.error || data?.raw || "Failed to fetch chat history";
      return jsonResponse({ error: message, details: data }, response.status || 400);
    }

    return jsonResponse({ ok: true, data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}

export async function DELETE(req) {
  try {
    if (!tableUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Missing Supabase env configuration" }, 500);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { searchParams } = new URL(req.url);
    const newsKey = searchParams.get("newsKey");

    if (!newsKey) {
      return jsonResponse({ error: "'newsKey' is required" }, 400);
    }

    const query = new URLSearchParams();
    query.set("user_id", `eq.${session.user.id}`);
    query.set("news_key", `eq.${newsKey}`);

    const bearer = supabaseServiceRoleKey || session.supabaseAccessToken || supabaseAnonKey;
    const apiKeyHeader = supabaseServiceRoleKey || supabaseAnonKey;

    const response = await fetch(`${tableUrl}?${query.toString()}`, {
      method: "DELETE",
      headers: {
        apikey: apiKeyHeader,
        Authorization: `Bearer ${bearer}`,
        "Content-Profile": supabaseSchema,
        Prefer: "return=representation",
      },
      cache: "no-store",
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.hint || data?.error || data?.raw || "Failed to delete chat history";
      return jsonResponse({ error: message, details: data }, response.status || 400);
    }

    return jsonResponse({ ok: true, data });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}
