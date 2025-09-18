// /game/requestSignedUrl.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./gdatabase.js";

function getClientKeyAndUrl() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase URL/Key를 찾지 못했습니다.");
  }
  return { supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY };
}

async function rawFetchMediaSign(id, password) {
  const { supabaseUrl, supabaseKey } = getClientKeyAndUrl();
  const body = { id };
  const pw = String(password ?? "").trim();  // 👈 무조건 문자열로 변환
  if (pw) body.password = pw;

  const res = await fetch(`${supabaseUrl}/functions/v1/media-sign`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabaseKey,
      authorization: "Bearer " + supabaseKey,
    },
    body: JSON.stringify(body),
  });

  let json = null;
  try { json = await res.clone().json(); } catch {}
  return { ok: res.ok, status: res.status, json };
}

/**
 * Edge Function `media-sign` → 서명 URL
 */
export async function requestSignedUrl(id, password = "") {
  const f = await rawFetchMediaSign(id, password);
  if (f.ok && f.json?.url) return f.json.url;
  throw new Error(f.json?.error || "서명 실패");
}
