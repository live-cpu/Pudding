// /game/gdatabase.js
// ES Modules + Supabase JS v2
// - Supabase URL/KEY는 game.html에서 window.SUPABASE_URL / window.SUPABASE_ANON_KEY 로 주입
// - Pixi v7 전역 필요 없음

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- 환경 ----
export const SUPABASE_URL      = window.SUPABASE_URL      ?? "";
export const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY ?? "";
export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession:false }})
  : null;

export const SUPA_OK = !!supabase;

// ---- 유틸 ----
export async function sha256Hex(text){
  const enc = new TextEncoder().encode(String(text));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

export function canvasToThumbDataURL(canvas, size=96){
  const w = canvas.width, h = canvas.height;
  const s = size / Math.max(w, h);
  const tw = Math.round(w * s), th = Math.round(h * s);
  const off = document.createElement("canvas");
  off.width = tw; off.height = th;
  off.getContext("2d").drawImage(canvas, 0, 0, tw, th);
  return off.toDataURL("image/png");
}

export async function imageUrlToThumbDataURL(url, size=96){
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = size / Math.max(w, h);
  const tw = Math.round(w * s), th = Math.round(h * s);
  const off = document.createElement("canvas");
  off.width = tw; off.height = th;
  off.getContext("2d").drawImage(img, 0, 0, tw, th);
  return off.toDataURL("image/png");
}

// ---- Scores ----
// ---- Scores ----
let lastScoreUploadAt = 0;              // 마지막 업로드 시각(ms)
const SCORE_UPLOAD_COOLDOWN = 10_000;   // 10초

export async function submitScore({ name, score, thumbData }) {
  if (!SUPA_OK) throw new Error("Supabase not configured");

  const now = Date.now();
  if (now - lastScoreUploadAt < SCORE_UPLOAD_COOLDOWN) {
    const wait = Math.ceil((SCORE_UPLOAD_COOLDOWN - (now - lastScoreUploadAt)) / 1000);
    alert(`⏳ ${wait}초 뒤에 다시 업로드할 수 있어요!`);
    return false;  // 쿨다운 중 → 업로드 안 함
  }
  lastScoreUploadAt = now;

  const row = {
    name: String(name || "Player").slice(0, 40),
    score: Math.max(0, Math.floor(score || 0)),
    thumb_data: thumbData || null,
  };

  const { data, error } = await supabase
    .from("scores")
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error("[submitScore] insert error:", error);
    lastScoreUploadAt = 0; // 실패하면 쿨다운 초기화 (원하면 유지해도 됨)
    throw error;
  }

  console.log("[submitScore] insert success:", data);
  return true;
}

export async function getTopScores(limit=200){
  if (!SUPA_OK) return [];
  const { data, error } = await supabase
    .from("scores")
    .select("id,name,score,thumb_data,created_at")
    .order("score",{ascending:false})
    .order("created_at",{ascending:true})
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---- Media (갤러리) ----
// ---- Media (갤러리) ----
export async function uploadMedia(file, { bucket="images", title="", password }={}) {
  if (!SUPA_OK) throw new Error("Supabase not configured");

  const ext = (file.name?.split(".").pop() || "png").toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = filename;

  // 썸네일 생성
  const thumbCanvas = document.createElement("canvas");
  const img = await new Promise((resolve, reject) => {
    const tmp = new Image();
    tmp.onload = () => resolve(tmp);
    tmp.onerror = reject;
    tmp.src = URL.createObjectURL(file);
  });
  const ctx = thumbCanvas.getContext("2d");
  const maxSize = 200;
  const scale = Math.min(maxSize / img.width, maxSize / img.height);
  thumbCanvas.width = Math.round(img.width * scale);
  thumbCanvas.height = Math.round(img.height * scale);
  ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const blob = await new Promise(res => thumbCanvas.toBlob(res, "image/png"));
  const thumbFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}-thumb.png`;
  const thumb_path = thumbFilename;

  // 1) 원본 업로드
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (upErr) throw upErr;

  // 2) 썸네일 업로드
  const { error: thErr } = await supabase.storage.from(bucket).upload(thumb_path, blob, {
    upsert: false,
    contentType: "image/png",
    cacheControl: "3600",
  });
  if (thErr) throw thErr;

  // 3) Edge Function 호출
  console.log("[uploadMedia] call", { bucket, path, title, password, thumb_path });
  const res = await fetch(`${SUPABASE_URL}/functions/v1/media-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // ✅ Verify JWT가 켜져 있으면 꼭 필요
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ bucket, path, title, password, thumb_path })
  });

  console.log("[uploadMedia] response status", res.status);
  const data = await res.json().catch(err => {
    console.error("[uploadMedia] JSON parse error", err);
    return { error: "JSON parse failed" };
  });
  console.log("[uploadMedia] response body", data);

  if (data.error) {
    throw new Error(data.error);
  }

  return { bucket, path, thumb_path };
}

// ---- Media (갤러리) ----
export async function listMedia({ bucket="images", limit=20 }={}) {
  if (!SUPA_OK) return [];
  const { data, error } = await supabase
    .from("media")
    .select("id,bucket,path,title,is_protected,password_hash,thumb_path,created_at") // ✅ thumb_path 포함
    .eq("bucket", bucket)
    .order("created_at",{ascending:false})
    .limit(limit);

  if (error) {
    console.error("[listMedia]", error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export async function searchMedia(q, { bucket="images", limit=50 }={}) {
  if (!SUPA_OK) return [];
  const { data, error } = await supabase
    .from("media")
    .select("id,bucket,path,title,is_protected,password_hash,thumb_path,created_at") // ✅ thumb_path 포함
    .eq("bucket", bucket)
    .ilike("title", `%${q}%`)
    .order("created_at",{ascending:false})
    .limit(limit);

  if (error) {
    console.error("[searchMedia]", error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export async function renameMediaTitle(id, title){
  if (!SUPA_OK) return false;
  const { error } = await supabase.from("media").update({title}).eq("id", id);
  if (error) throw error;
  return true;
}

export function displayName(row){
  return row?.title || "Untitled";
}

// ✅ 공개용 URL (보호된 항목은 이거 대신 getSignedUrl 써야 함)
export function getPublicUrl(path, bucket="images"){
  if (!SUPA_OK) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl || null;
}

// ✅ 보호된 항목일 경우 썸네일만 보여주고 싶다면 → media-sign 함수 호출
export async function getSignedUrl(id, password, expiresIn=60) {
  if (!SUPA_OK) return null;
  try {
     const res = await fetch(`${SUPABASE_URL}/functions/v1/media-sign`, {
    method: "POST",
    headers: {
     "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ id, password })
  });
    const data = await res.json();
    console.log("[getSignedUrl response]", data);
    if (data.url) return data.url;
    console.warn("[getSignedUrl] error", data.error);
    return null;
  } catch (e) {
    console.error("[getSignedUrl] fetch fail", e);
    return null;
  }
}
