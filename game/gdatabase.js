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
export async function submitScore({ name, score, thumbData }) {
  if (!SUPA_OK) throw new Error("Supabase not configured");

  const row = {
    name: String(name || "Player").slice(0, 40),
    score: Math.max(0, Math.floor(score || 0)),
    thumb_data: thumbData || null,
  };

  // insert 후 방금 레코드까지 받아오면 이후 로직이 편함
  const { data, error } = await supabase
    .from("scores")
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error("[submitScore] insert error:", error);
    throw error;                 // 호출부에서 catch → '업로드 실패' 처리
  }

  console.log("[submitScore] insert success:", data);
  return true;                    // 기존 호출부 호환 유지
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
// 📌 스토리지 bucket = "images"
// 📌 메타데이터 테이블 = "media"

export async function uploadMedia(file, { bucket="images", title="", password }={}) {
  if (!SUPA_OK) throw new Error("Supabase not configured");

  // ✨ 파일명 생성 (타임스탬프 + 랜덤) → 충돌 방지
  const ext = (file.name?.split(".").pop() || "png").toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = filename;

  // 1) Storage 업로드
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (upErr) throw upErr;

  // 2) media 테이블 기록
  const row = {
    bucket,
    path,
    title: String(title || ""),
    is_protected: !!password,
    password_hash: password ? await sha256Hex(password) : null,
  };

  const { error: insErr } = await supabase.from("media").insert(row).select().single();
  if (insErr) {
    console.error("[uploadMedia insert error]", insErr);
    throw insErr;
  }

  return { bucket, path }; // 필요하면 여기서 public URL도 같이 반환 가능
}
export const uploadImage = uploadMedia;

export async function listMedia({ bucket="images", limit=20 }={}) {
  if (!SUPA_OK) return [];
  const { data, error } = await supabase
    .from("media")
    .select("*")
    .eq("bucket", bucket)             // ✅ bucket 일치 확인
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
    .select("*")
    .eq("bucket", bucket)             // ✅ bucket 필터
    .ilike("title", `%${q}%`)
    .order("created_at",{ascending:false})
    .limit(limit);

  if (error) throw error;
  return data||[];
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

// ✅ 기본 public URL 생성기
export function getPublicUrl(path, bucket="images"){
  if (!SUPA_OK) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl || null;
}

// ✅ 보호된 항목일 경우 썸네일만 보여주고 싶다면 → signed URL
export async function getSignedUrl(path, bucket="images", expiresIn=60){
  if (!SUPA_OK) return null;
  const { data, error } = await supabase
    .storage.from(bucket)
    .createSignedUrl(path, expiresIn);  // 60초짜리 서명 URL
  if (error) {
    console.error("[getSignedUrl]", error);
    return null;
  }
  return data?.signedUrl || null;
}
