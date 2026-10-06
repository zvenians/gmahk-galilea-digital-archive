import { it } from 'node:test';
import assert from 'node:assert/strict';
import { google } from 'googleapis';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/upload/route';
import { createGuestUploadIdentity, createUploadSessionToken } from '../src/lib/upload-session';

it('only confirms success after Drive verifies the file, size and destination', async t => {
  const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'UPLOAD_SESSION_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'local-test-client', GOOGLE_CLIENT_SECRET: 'local-test-secret', GOOGLE_DRIVE_REFRESH_TOKEN: 'local-test-refresh', UPLOAD_SESSION_SECRET: 'local-test-signing' });
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request in unit test'); });
  let metadata: Record<string, unknown> = {};
  let unavailable = false;
  t.mock.method(google, 'drive', () => ({ files: { get: async () => {
    if (unavailable) throw new Error('Drive unavailable');
    return { data: metadata };
  } } }) as unknown as ReturnType<typeof google.drive>);
  try {
    const guest = createGuestUploadIdentity();
    const uploadToken = createUploadSessionToken({ uid: guest.uid, fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 100,
      category: 'documentation', sabbathDate: '2026-10-10', sabbathTitle: '10 Oktober 2026', year: 2026, quarter: 4,
      folderId: 'selected-sabbath-folder', folderPath: 'Dokumentasi/2026/10 Oktober 2026' });
    const finalize = () => POST(new NextRequest('http://localhost/api/upload', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `galilea-upload-guest=${guest.cookie}` },
      body: JSON.stringify({ action: 'finalize', fileId: 'verified-id', uploadToken }),
    }));
    const valid = { id: 'verified-id', name: 'photo.jpg', size: '100', mimeType: 'image/jpeg', parents: ['selected-sabbath-folder'], trashed: false };
    for (const bad of [{ size: '50' }, { parents: ['other-folder'] }, { trashed: true }, { name: 'other.jpg' }]) {
      metadata = { ...valid, ...bad };
      const response = await finalize();
      assert.equal(response.status, 409); assert.equal((await response.json()).success, false);
    }
    unavailable = true;
    const failed = await finalize();
    assert.equal(failed.status, 500); assert.equal((await failed.json()).success, false);
    unavailable = false; metadata = valid;
    const response = await finalize(); const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.success, true);
    assert.equal(result.data.id, 'verified-id'); assert.equal(result.data.size, 100);
    assert.equal(result.data.folderId, 'selected-sabbath-folder');
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
