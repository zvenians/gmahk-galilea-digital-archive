import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDIRECT_URI = 'http://localhost:3456/oauth2callback';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function noStoreHeaders(contentType: string): HeadersInit {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function page(body: string, script = '', status = 200): NextResponse {
  const nonce = crypto.randomUUID();
  const html = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Sambungkan Google Drive</title>
    <style nonce="${nonce}">
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #080808; color: #f7f7f7; }
      main { width: min(560px, calc(100vw - 40px)); padding: 36px; border: 1px solid #2a2a2a; border-radius: 24px; background: #111; }
      h1 { margin: 0 0 12px; font-size: 26px; }
      p { color: #aaa; line-height: 1.6; }
      label { display: block; margin: 24px 0 8px; font-size: 13px; color: #ccc; }
      input { box-sizing: border-box; width: 100%; padding: 13px 14px; border: 1px solid #333; border-radius: 12px; background: #080808; color: #fff; }
      button, a { display: inline-flex; align-items: center; justify-content: center; margin-top: 18px; padding: 12px 18px; border: 0; border-radius: 999px; background: #f5f5f5; color: #080808; font-weight: 700; text-decoration: none; cursor: pointer; }
      .muted { font-size: 13px; }
      #status { min-height: 20px; color: #7ee787; }
    </style>
  </head>
  <body><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body>
</html>`;

  const response = new NextResponse(html, {
    status,
    headers: noStoreHeaders('text/html; charset=utf-8'),
  });
  response.headers.set(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  );
  return response;
}

function getOauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('Kredensial OAuth Google belum tersedia di server.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('action') === 'start') {
    const authUrl = getOauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: [DRIVE_SCOPE],
    });
    return NextResponse.redirect(authUrl, 302);
  }

  return page(`
    <h1>Sambungkan ulang Google Drive</h1>
    <p>Mulai izin Google. Setelah dialihkan ke localhost (halaman tidak dapat dibuka itu normal), salin <strong>seluruh alamat</strong> dari bilah alamat lalu tempel di bawah. Safari mungkin menyembunyikan awalan <code>http://</code>. Alamat dapat memuat <code>iss=https://...</code> sebelum parameter <code>code=</code>; itu normal.</p>
    <a href="/api/drive-oauth?action=start">Mulai izin Google Drive</a>
    <form method="post">
      <label for="callbackUrl">Alamat callback localhost:3456/oauth2callback dari Safari (termasuk semua parameter)</label>
      <input id="callbackUrl" name="callbackUrl" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required />
      <button type="submit">Tukar dengan token</button>
    </form>
    <p class="muted">Halaman sementara ini akan dihapus setelah koneksi pulih.</p>
  `);
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const callbackUrl = String(form.get('callbackUrl') || '').trim();
    const normalizedUrl = callbackUrl.startsWith('localhost:3456/oauth2callback')
      ? `http://${callbackUrl}`
      : callbackUrl;
    let parsed: URL;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      return page('<h1>Alamat belum lengkap</h1><p>Yang ditempel bukan alamat callback. Salin seluruh alamat dari Safari, termasuk bagian setelah <code>localhost:3456/oauth2callback?</code>. Jika Safari tidak menampilkan <code>http://</code>, tempel saja alamat yang disalinnya. Jangan tempel token atau kode saja.</p><a href="/api/drive-oauth">Kembali</a>', '', 400);
    }
    if (parsed.origin !== 'http://localhost:3456' || parsed.pathname !== '/oauth2callback') {
      return page('<h1>Alamat callback tidak sesuai</h1><p>Gunakan alamat lengkap dari bilah alamat setelah Google mengalihkan ke localhost, bukan alamat halaman Galilea atau Google.</p><a href="/api/drive-oauth">Kembali</a>', '', 400);
    }

    const code = parsed.searchParams.get('code');
    if (!code) {
      return page('<h1>Kode tidak ditemukan</h1><p>Alamat localhost harus memuat parameter <code>code=</code>, yang bisa muncul setelah <code>iss=https://...</code>. Mulai lagi izin Google, lalu salin seluruh alamat callback.</p><a href="/api/drive-oauth">Kembali</a>', '', 400);
    }

    const { tokens } = await getOauthClient().getToken(code);
    if (!tokens.refresh_token) {
      return page('<h1>Refresh token tidak diterbitkan</h1><p>Cabut akses aplikasi lalu ulangi proses dengan persetujuan penuh.</p>');
    }

    const token = escapeHtml(tokens.refresh_token);
    return page(
      `<h1>Token Drive siap</h1>
       <p>Salin token secara aman lalu ganti <code>GOOGLE_DRIVE_REFRESH_TOKEN</code> di Vercel.</p>
       <label for="refreshToken">Refresh token</label>
       <input id="refreshToken" type="password" value="${token}" readonly />
       <button id="copyToken" type="button">Salin token</button>
       <p id="status" aria-live="polite"></p>`,
      `document.getElementById('copyToken').addEventListener('click', async () => {
         const value = document.getElementById('refreshToken').value;
         await navigator.clipboard.writeText(value);
         document.getElementById('status').textContent = 'Token tersalin.';
       });`
    );
  } catch (error) {
    console.error('[Drive OAuth reconnect] Failed:', error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('invalid_grant')) {
      return page('<h1>Kode sudah tidak berlaku</h1><p>Kode Google hanya dapat digunakan sekali dan cepat kedaluwarsa. Mulai ulang izin Google, lalu segera salin dan kirim alamat callback yang baru. Jangan gunakan alamat lama.</p><a href="/api/drive-oauth">Coba lagi</a>', '', 400);
    }
    return page('<h1>Otorisasi gagal</h1><p>Google belum dapat menukar kode ini. Mulai ulang izin dan gunakan alamat callback terbaru. Jika tetap gagal, konfigurasi OAuth perlu diperiksa.</p><a href="/api/drive-oauth">Coba lagi</a>', '', 502);
  }
}
