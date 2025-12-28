// /game/gdatabase.js
// Supabase v2 클라이언트 + 스토리지 + DB(images) 유틸 (안정 가드 버전)

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.3/+esm";

// ---- 키 주입: window.__SUPABASE__ 우선, 없으면 상수 (빈값 금지) ----
const W = typeof window !== 'undefined' ? window : {};
const INJECT = W.__SUPABASE__ || {};
const SUPABASE_URL = INJECT.url || "https://dzztnkdcgrpqxfrxkyic.supabase.co";
const SUPABASE_ANON_KEY = INJECT.anon || "";  // 👈 실제 anon 키로 채우세요

export const SUPA_OK = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const supabase = SUPA_OK
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'gif-game' } },
    })
  : null;

if (!SUPA_OK) {
  console.warn('[supabase] anon 키가 비어있어 네트워크 기능을 비활성화합니다. window.__SUPABASE__ 또는 .env를 설정하세요.');
}

// ====== 공통 유틸 ======
const MAX_FILE_MB = 10;

export function bytesToMB(bytes){ return +(bytes / (1024 * 1024)).toFixed(2); }

export function sanitizeName(name){
  return (name || "upload.png").replace(/[^a-zA-Z0-9.\-_\u3131-\uD79D]/g, "_");
}

export async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(input, row){
  if (!row?.pwd_hash) return true;
  const hex = await sha256Hex(input || "");
  return hex === row.pwd_hash;
}

async function imageDimsFromFile(file){
  try{
    const bmp = await createImageBitmap(file);
    const w = bmp.width, h = bmp.height;
    bmp.close?.();
    return { width: w, height: h };
  }catch{
    const url = URL.createObjectURL(file);
    const img = new Image();
    const dims = await new Promise((res, rej)=>{
      img.onload = ()=>res({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = rej;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return dims;
  }
}

// ✅ 절대 URL 판별 (중복 프리픽스 방지용)
function isAbsolute(u){ return /^https?:\/\//i.test(u || ""); }

// 버킷이 public이면 getPublicUrl이 바로 동작.
// private이면 createSignedUrl로 우회.
// ✅ 절대 URL이 들어오면 그대로 반환하여 중복 프리픽스 방지
async function bestUrlOf(bucket, path){
  if (!SUPA_OK) return null;
  if (!path) return null;

  // 👇 이미 풀 URL이면 그대로 사용 (DB에 URL이 저장된 경우도 안전)
  if (isAbsolute(path)) return path;

  try{
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (data?.publicUrl) return data.publicUrl;
  }catch{}

  // private로 가정: 7일 서명 URL
  try{
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error) throw error;
    return data?.signedUrl || null;
  }catch(e){
    console.warn('[bestUrlOf] signedUrl 실패:', e?.message || e);
    return null;
  }
}

// ====== 업로드 ======
// kind: 'jelly' | 'player' | 'background'
export async function uploadImage(file, kind, { owner=null, password=null } = {}){
  if (!SUPA_OK) throw new Error('Supabase 키가 설정되지 않았습니다.');
  if (!file) throw new Error("파일이 없습니다.");
  const sizeMB = bytesToMB(file.size);
  if (sizeMB > MAX_FILE_MB) throw new Error(`파일이 너무 큽니다 (${sizeMB}MB > ${MAX_FILE_MB}MB)`);

  const random = Math.random().toString(36).slice(2, 8);
  const safeName = sanitizeName(file.name);
  const filename = `${Date.now()}-${random}-${safeName}`;
  const bucket = (kind === "background") ? "backs" : "images";
  const path   = filename;

  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (upErr) throw upErr;

  let width = null, height = null;
  try{
    const dims = await imageDimsFromFile(file);
    width = dims.width; height = dims.height;
  }catch{/* ignore */}

  let pwd_hash = null;
  if (password) pwd_hash = await sha256Hex(password);

  const { data: row, error: dbErr } = await supabase
    .from("images")
    .insert({ path, kind, width, height, owner, pwd_hash })
    .select("*")
    .single();

  if (dbErr) throw dbErr;

  const url = await bestUrlOf(bucket, path);
  return { row, url, bucket, path };
}

// ====== GIF 저장 ======
export async function saveGif(blob){
  if (!SUPA_OK) throw new Error('Supabase 키가 설정되지 않았습니다.');
  if (!blob) throw new Error("GIF Blob이 없습니다.");
  const random = Math.random().toString(36).slice(2, 8);
  const filename = `gif-${Date.now()}-${random}.gif`;

  const { error } = await supabase.storage.from("gifs").upload(filename, blob, {
    cacheControl: "3600",
    upsert: false,
    contentType: "image/gif",
  });
  if (error) throw error;

  const url = await bestUrlOf("gifs", filename);
  return { url, path: filename };
}

// ====== (옵션) kind별 리스트: DB에서만 ======
export async function listImages({ kind, limit=12, cursor=null } = {}){
  if (!SUPA_OK) throw new Error('Supabase 키가 설정되지 않았습니다.');
  let q = supabase.from("images")
    .select("*")
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) q = q.lt("created_at", cursor);

  const { data, error } = await q;
  if (error) throw error;

  const enriched = await Promise.all(data.map(async r => {
    const bucket = (r.kind === "background") ? "backs" : "images";
    return { ...r, public_url: await bestUrlOf(bucket, r.path), __bucket: bucket };
  }));

  const nextCursor = enriched.length ? enriched[enriched.length-1].created_at : null;
  return { rows: enriched, nextCursor };
}

// ====== 단일 피드: DB 우선, 실패 시 Storage fallback ======
export async function listUploads({ limit = 12, cursor = null } = {}) {
  if (!SUPA_OK) {
    // 네트워크 비활성 모드: 빈 피드
    return { rows: [], nextCursor: null, source: "disabled" };
  }

  // 1) DB(images) 우선
  try {
    let q = supabase.from("images")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (cursor) q = q.lt("created_at", cursor);

    const { data, error } = await q;
    if (error) throw error;

    const enriched = await Promise.all(data.map(async r => {
      const bucket = (r.kind === "background") ? "backs" : "images";
      return { ...r, public_url: await bestUrlOf(bucket, r.path), __bucket: bucket };
    }));

    const nextCursor = enriched.length ? enriched[enriched.length - 1].created_at : null;
    return { rows: enriched, nextCursor, source: "db" };
  } catch (err) {
    console.warn("[listUploads] DB 실패, storage fallback 사용:", err?.message);
  }

  // 2) Fallback: 스토리지에서 직접(backs + images) 조회
  const buckets = ["backs", "images"];
  let all = [];

  for (const b of buckets) {
    const { data: objs, error: e2 } = await supabase.storage.from(b).list("", {
      limit: 100,
      sortBy: { column: "updated_at", order: "desc" },
    });
    if (e2) { console.error("[storage.list]", b, e2.message || e2); continue; }

    const mapped = await Promise.all((objs || []).map(async o => {
      const url = await bestUrlOf(b, o.name);
      const kind = (b === "backs") ? "background" : "player";
      return {
        id: `${b}:${o.name}`,
        path: o.name,
        kind,
        created_at: o.updated_at || o.created_at || new Date().toISOString(),
        public_url: url,
        __bucket: b,
      };
    }));
    all.push(...mapped);
  }

  all.sort((a, b) => (new Date(b.created_at) - new Date(a.created_at)));
  const rows = all.slice(0, limit);
  const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
  return { rows, nextCursor, source: "storage" };
}
