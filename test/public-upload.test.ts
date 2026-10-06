import { it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/upload/route';
import { createGuestUploadIdentity, verifyGuestUploadIdentity, createUploadSessionToken } from '../src/lib/upload-session';

process.env.UPLOAD_SESSION_SECRET = 'public-upload-local-test-secret-only';
const request = (body: unknown, cookie?: string, origin?: string) => new NextRequest('http://localhost:3000/api/upload', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `galilea-upload-guest=${cookie}` } : {}), ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify(body),
});

it('creates an HttpOnly guest session without Google/Firebase login', async () => {
  const response = await POST(request({ action: 'guest' }));
  assert.equal(response.status, 200);
  const cookie = response.cookies.get('galilea-upload-guest');
  assert.ok(cookie?.value);
  assert.ok(verifyGuestUploadIdentity(cookie.value)?.startsWith('guest-'));
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
  assert.match(response.headers.get('set-cookie') || '', /SameSite=strict/i);
});

it('reuses one guest identity for concurrent queue items', async () => {
  const guest = createGuestUploadIdentity();
  const response = await POST(request({ action: 'guest' }, guest.cookie));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(verifyGuestUploadIdentity(guest.cookie), guest.uid);
});

it('does not allow a forged guest cookie or missing upload session', async () => {
  const guest = createGuestUploadIdentity();
  assert.equal(verifyGuestUploadIdentity(`${guest.cookie}x`), null);
  const response = await POST(request({ action: 'init', fileName: 'foto.jpg', fileSize: 1 }));
  assert.equal(response.status, 401);
});

it('permits guest init to reach normal file/date validation without admin access', async () => {
  const guest = createGuestUploadIdentity();
  const response = await POST(request({ action: 'init', fileName: 'foto.jpg', fileSize: 12, sabbathDate: '2027-01-01' }, guest.cookie));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /bukan hari Sabat/);
  const empty = await POST(request({ action: 'init', fileName: 'foto.jpg', fileSize: 0 }, guest.cookie));
  assert.equal(empty.status, 400);
});

it('keeps finalize bound to the guest that owns the upload, including destination date', async () => {
  const owner = createGuestUploadIdentity(), other = createGuestUploadIdentity();
  const token = createUploadSessionToken({ uid: owner.uid, fileName: 'foto.jpg', mimeType: 'image/jpeg', fileSize: 12,
    category: 'documentation', sabbathDate: '2027-01-02', sabbathTitle: '2 Januari 2027', year: 2027, quarter: 1,
    folderId: 'managed-folder', folderPath: 'Dokumentasi/2027/Triwulan I/2 Januari 2027' });
  const response = await POST(request({ action: 'finalize', fileId: 'file-id', uploadToken: token }, other.cookie));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /bukan milik akun ini/);
});

it('rejects cross-origin upload session creation', async () => {
  const response = await POST(request({ action: 'guest' }, undefined, 'https://unrelated.example'));
  assert.equal(response.status, 403);
});

it('accepts the real same-origin Host when Next uses an internal proxy URL', async () => {
  const response = await POST(new NextRequest('http://localhost:3000/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'archive.example', Origin: 'https://archive.example' },
    body: JSON.stringify({ action: 'guest' }),
  }));
  assert.equal(response.status, 200);
});

it('status probes require the owner and only allow a server-signed Google URL', async () => {
  const guest = createGuestUploadIdentity();
  const token = createUploadSessionToken({ uid: guest.uid, fileName: 'probe.bin', mimeType: 'application/octet-stream', fileSize: 8,
    category: 'documentation', sabbathDate: '2026-10-03', sabbathTitle: '3 Oktober 2026', year: 2026, quarter: 4,
    folderId: 'folder', folderPath: 'folder', sessionUrl: 'https://unrelated.example/upload' });
  assert.equal((await POST(request({ action: 'status', uploadToken: token }, createGuestUploadIdentity().cookie))).status, 400);
  assert.equal((await POST(request({ action: 'status', uploadToken: token }, guest.cookie))).status, 400);
  assert.equal((await POST(request({ action: 'status', sessionUrl: 'http://localhost/' }, guest.cookie))).status, 400);
});

it('relays a completed Drive response without uploading bytes or following redirects', async () => {
  const guest = createGuestUploadIdentity();
  const token = createUploadSessionToken({ uid: guest.uid, fileName: 'probe.bin', mimeType: 'application/octet-stream', fileSize: 8,
    category: 'documentation', sabbathDate: '2026-10-03', sabbathTitle: '3 Oktober 2026', year: 2026, quarter: 4,
    folderId: 'folder', folderPath: 'folder', sessionUrl: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test' });
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, 'PUT'); assert.equal(init?.redirect, 'manual'); assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get('Content-Range'), 'bytes */8');
    return new Response('{"id":"saved-file"}', { status: 200 });
  };
  try {
    const response = await POST(request({ action: 'status', uploadToken: token }, guest.cookie));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, 200); assert.equal(JSON.parse(data.body).id, 'saved-file');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = original; }
});
