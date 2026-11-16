import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedHosts = (Deno.env.get("TURNSTILE_HOSTNAMES") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const BUCKET = "couple-memories";
const MAX_BYTES = 50 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const CATEGORIES = new Set(["memories", "portraits", "meetups", "games"]);
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function verifyChallenge(token: string, ip: string | null) {
  if (!TURNSTILE_SECRET || !token) return false;
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return false;
  const result = await response.json();
  return Boolean(
    result.success &&
    typeof result.hostname === "string" &&
    allowedHosts.includes(result.hostname.toLowerCase()),
  );
}

async function cleanExpiredIntents() {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("upload_intents")
    .select("id,media_path")
    .lt("expires_at", now)
    .limit(50);
  if (!data?.length) return;
  await admin.storage.from(BUCKET).remove(data.map((item) => item.media_path));
  await admin.from("upload_intents").delete().in("id", data.map((item) => item.id));
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (!origin || !allowedOrigins.includes(origin)) {
    return json(403, { error: "This site is not allowed to submit." }, headers);
  }
  if (request.method !== "POST") return json(405, { error: "Use POST." }, headers);

  try {
    const payload = await request.json();
    const action = payload.action;
    if (action === "cancel") {
      const intentId = String(payload.intentId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(intentId)) {
        return json(400, { error: "Invalid upload." }, headers);
      }
      const { data: intent } = await admin
        .from("upload_intents")
        .select("id,media_path")
        .eq("id", intentId)
        .maybeSingle();
      if (intent) {
        await admin.storage.from(BUCKET).remove([intent.media_path]);
        await admin.from("upload_intents").delete().eq("id", intent.id);
      }
      return json(200, { ok: true }, headers);
    }

    if (action === "prepare") {
      const challengeOk = await verifyChallenge(
        String(payload.turnstileToken ?? ""),
        request.headers.get("cf-connecting-ip"),
      );
      if (!challengeOk) return json(400, { error: "验证未通过，请重新验证后再试。" }, headers);

      const category = String(payload.category ?? "");
      const title = String(payload.title ?? "").trim();
      const note = String(payload.note ?? "").trim();
      const occurredAt = payload.occurredAt ? String(payload.occurredAt) : null;
      const mimeType = String(payload.mimeType ?? "").toLowerCase();
      const fileSize = Number(payload.fileSize);
      const extension = MIME_EXTENSIONS[mimeType];

      if (!CATEGORIES.has(category)) return json(400, { error: "请选择一个相册分类。" }, headers);
      if (!title || title.length > 100) return json(400, { error: "标题需为 1 到 100 个字符。" }, headers);
      if (note.length > 600) return json(400, { error: "说明不能超过 600 个字符。" }, headers);
      if (occurredAt && !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
        return json(400, { error: "日期格式不正确。" }, headers);
      }
      if (!extension || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
        return json(400, { error: "仅支持 JPG、PNG、WebP、GIF、MP4 或 WebM，单个文件不超过 50 MB。" }, headers);
      }

      await cleanExpiredIntents();
      const mediaPath = category + "/" + crypto.randomUUID() + "." + extension;
      const { data: signed, error: signError } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(mediaPath, { upsert: false });
      if (signError || !signed) throw signError ?? new Error("Could not prepare upload.");

      const mediaType = mimeType.startsWith("video/") ? "video" : "image";
      const { data: intent, error: insertError } = await admin
        .from("upload_intents")
        .insert({
          category,
          title,
          note: note || null,
          occurred_at: occurredAt,
          media_type: mediaType,
          media_path: mediaPath,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
        .select("id")
        .single();
      if (insertError || !intent) throw insertError ?? new Error("Could not create upload intent.");

      return json(200, {
        intentId: intent.id,
        path: signed.path,
        token: signed.token,
      }, headers);
    }

    if (action === "prepareBatch") {
      const challengeOk = await verifyChallenge(
        String(payload.turnstileToken ?? ""),
        request.headers.get("cf-connecting-ip"),
      );
      if (!challengeOk) return json(400, { error: "验证未通过，请重新验证后再试。" }, headers);

      const category = String(payload.category ?? "");
      const title = String(payload.title ?? "").trim();
      const note = String(payload.note ?? "").trim();
      const occurredAt = payload.occurredAt ? String(payload.occurredAt) : null;
      const files = Array.isArray(payload.files) ? payload.files : [];
      if (!CATEGORIES.has(category)) return json(400, { error: "请选择一个相册分类。" }, headers);
      if (!title || title.length > 100) return json(400, { error: "标题需为 1 到 100 个字符。" }, headers);
      if (note.length > 600) return json(400, { error: "说明不能超过 600 个字符。" }, headers);
      if (occurredAt && !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
        return json(400, { error: "日期格式不正确。" }, headers);
      }
      if (files.length < 1 || files.length > 10) return json(400, { error: "一次最多选择 10 个文件。" }, headers);
      for (const file of files) {
        const mimeType = String(file.mimeType ?? "").toLowerCase();
        const fileSize = Number(file.fileSize);
        if (!MIME_EXTENSIONS[mimeType] || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
          return json(400, { error: "仅支持 JPG、PNG、WebP、GIF、MP4 或 WebM，单个文件不超过 50 MB。" }, headers);
        }
      }

      await cleanExpiredIntents();
      const uploads: { intentId: string; path: string; token: string; mediaPath: string }[] = [];
      for (const file of files) {
        const mimeType = String(file.mimeType).toLowerCase();
        const extension = MIME_EXTENSIONS[mimeType];
        const mediaPath = category + "/" + crypto.randomUUID() + "." + extension;
        const { data: signed, error: signError } = await admin.storage
          .from(BUCKET)
          .createSignedUploadUrl(mediaPath, { upsert: false });
        if (signError || !signed) throw signError ?? new Error("Could not prepare upload.");

        const { data: intent, error: insertError } = await admin
          .from("upload_intents")
          .insert({
            category,
            title,
            note: note || null,
            occurred_at: occurredAt,
            media_type: mimeType.startsWith("video/") ? "video" : "image",
            media_path: mediaPath,
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          })
          .select("id")
          .single();
        if (insertError || !intent) throw insertError ?? new Error("Could not create upload intent.");
        uploads.push({ intentId: intent.id, path: signed.path, token: signed.token, mediaPath });
      }

      return json(200, {
        uploads: uploads.map(({ intentId, path, token }) => ({ intentId, path, token })),
      }, headers);
    }

    if (action === "finalize") {
      const intentId = String(payload.intentId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(intentId)) {
        return json(400, { error: "上传会话已失效，请重新提交。" }, headers);
      }
      const { data: intent, error: intentError } = await admin
        .from("upload_intents")
        .select("*")
        .eq("id", intentId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (intentError || !intent) return json(400, { error: "上传会话已过期，请重新提交。" }, headers);

      const parts = intent.media_path.split("/");
      const folder = parts.slice(0, -1).join("/");
      const filename = parts[parts.length - 1];
      const { data: objects, error: listError } = await admin.storage
        .from(BUCKET)
        .list(folder, { search: filename, limit: 5 });
      const uploaded = objects?.find((item) => item.name === filename);
      if (listError || !uploaded) return json(400, { error: "文件没有上传完成，请重试。" }, headers);

      const size = Number(uploaded.metadata?.size ?? 0);
      if (size <= 0 || size > MAX_BYTES) {
        await admin.storage.from(BUCKET).remove([intent.media_path]);
        await admin.from("upload_intents").delete().eq("id", intent.id);
        return json(400, { error: "文件大小不符合要求。" }, headers);
      }

      const { error: insertError } = await admin.from("memories").insert({
        category: intent.category,
        title: intent.title,
        note: intent.note,
        occurred_at: intent.occurred_at,
        media_type: intent.media_type,
        media_path: intent.media_path,
        status: "pending",
      });
      if (insertError) throw insertError;
      await admin.from("upload_intents").delete().eq("id", intent.id);
      return json(200, { ok: true }, headers);
    }

    return json(400, { error: "Unknown submission action." }, headers);
  } catch (error) {
    console.error("public-submit failed", error);
    return json(500, { error: "提交暂时失败，请稍后再试。" }, headers);
  }
});
