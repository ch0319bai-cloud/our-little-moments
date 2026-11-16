import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const responseHeaders = headers(origin);
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (!origin || !allowedOrigins.includes(origin)) {
    return new Response(JSON.stringify({ error: "This site is not allowed to read the gallery." }), {
      status: 403,
      headers: responseHeaders,
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST." }), { status: 405, headers: responseHeaders });
  }

  try {
    const { data, error } = await admin
      .from("memories")
      .select("id,category,title,note,occurred_at,media_type,media_path,created_at,show_in_dome")
      .eq("status", "approved")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;

    const entries = await Promise.all((data ?? []).map(async (item) => {
      const { data: signed, error: signError } = await admin.storage
        .from("couple-memories")
        .createSignedUrl(item.media_path, 60 * 60);
      if (signError || !signed) return null;
      return {
        id: item.id,
        category: item.category,
        title: item.title,
        note: item.note,
        occurred_at: item.occurred_at,
        media_type: item.media_type,
        media_url: signed.signedUrl,
        created_at: item.created_at,
        show_in_dome: item.show_in_dome,
      };
    }));

    return new Response(JSON.stringify({ entries: entries.filter(Boolean) }), {
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("public-gallery failed", error);
    return new Response(JSON.stringify({ error: "Unable to load the gallery." }), {
      status: 500,
      headers: responseHeaders,
    });
  }
});
