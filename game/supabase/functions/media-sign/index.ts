// supabase/functions/media-sign/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = 'sha256-cors-dynamic-v1';

// 동적 CORS 헬퍼
function buildCors(req: Request) {
  const origin = req.headers.get('origin') || '*';
  // 브라우저가 요구한 헤더 목록을 그대로 허용 (예: authorization, apikey, content-type, x-client-info, x-supabase-api-version 등)
  const reqHdr = req.headers.get('access-control-request-headers') || 'authorization, x-client-info, apikey, content-type';
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': reqHdr,
    'Access-Control-Max-Age': '86400',
  };
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  // 1) 프리플라이트는 무조건 204 + CORS 헤더 반환
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCors(req) });
  }

  const cors = buildCors(req);

  try {
    const { id, password } = await req.json();

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const EXPIRES = parseInt(Deno.env.get('ACCESS_TTL') ?? '60', 10);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Debug 로그
    console.log('[media-sign]', { VERSION, id, hasPassword: !!password });

    // 2) 메타 조회
    const { data: row, error } = await admin
      .from('media')
      .select('id,bucket,path,is_protected,password_hash')
      .eq('id', id)
      .single();

    if (error || !row) {
      return new Response(JSON.stringify({ error: 'not_found', version: VERSION }), {
        status: 404, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    // 3) 비밀번호 검증 (SHA-256)
    if (row.is_protected) {
      const pw = (password ?? '').trim();
      if (!pw) {
        return new Response(JSON.stringify({ error: 'password_required', version: VERSION }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...cors }
        });
      }
      const enc = new TextEncoder().encode(pw);
      const digest = await crypto.subtle.digest('SHA-256', enc);
      const hex = toHex(digest).toLowerCase();
      const ok = (row.password_hash ?? '').toLowerCase() === hex;
      if (!ok) {
        return new Response(JSON.stringify({ error: 'invalid_password', version: VERSION }), {
          status: 403, headers: { 'Content-Type': 'application/json', ...cors }
        });
      }
    }

    // 4) 서명 URL
    const { data: signed, error: signErr } = await admin
      .storage
      .from(row.bucket)
      .createSignedUrl(row.path, EXPIRES);

    if (signErr) {
      return new Response(JSON.stringify({ error: 'sign_failed', detail: signErr.message, version: VERSION }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    return new Response(JSON.stringify({ url: signed.signedUrl, expiresIn: EXPIRES, version: VERSION }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...cors }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bad_request', detail: String(e), version: VERSION }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...buildCors(req) }
    });
  }
});
