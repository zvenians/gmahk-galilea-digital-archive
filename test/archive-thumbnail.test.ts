import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { drive_v3 } from 'googleapis';
import { createArchiveThumbnailHandler, isGoogleThumbnailUrl } from '../src/lib/archive-thumbnail';
import { getArchiveMediaUrl, withArchiveMediaUrls } from '../src/lib/archive-media';
import type { FileItem } from '../src/lib/types';
import { clearDriveCache, DriveError, isFileInManagedArchive } from '../src/lib/drive';

function fixture(options: {
  managed?: boolean; mimeType?: string; link?: string | null;
  trashed?: boolean; boundaryError?: Error; contentType?: string;
} = {}) {
  const calls: string[] = [];
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const drive = {
    files: { get: async ({ fileId }: { fileId: string }) => {
      calls.push(`metadata:${fileId}`);
      return { data: {
        mimeType: options.mimeType || 'video/mp4', trashed: options.trashed,
        thumbnailLink: options.link === undefined ? 'https://lh3.googleusercontent.com/private=s220' : options.link,
      } };
    } },
    context: { _options: { auth: { request: async (args: { url: string; redirect: string }) => {
      calls.push(`authenticated:${args.url}`);
      assert.equal(args.redirect, 'error');
      return { data: bytes.buffer, headers: new Headers({ 'content-type': options.contentType || 'image/png' }) };
    } } } },
  } as unknown as drive_v3.Drive;
  const handler = createArchiveThumbnailHandler({
    getDrive: () => drive,
    isManaged: async id => {
      calls.push(`boundary:${id}`);
      if (options.boundaryError) throw options.boundaryError;
      return options.managed ?? true;
    },
  });
  return { handler, calls, bytes };
}

describe('Private archive thumbnail proxy', () => {
  it('fetches fresh metadata and returns authenticated thumbnail bytes, never the Google URL', async () => {
    const { handler, calls, bytes } = fixture();
    const response = await handler(new Request('https://galilea.test/api/archive/thumbnail?fileId=private-video'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('location'), null);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.deepEqual(calls, ['boundary:private-video', 'metadata:private-video', 'authenticated:https://lh3.googleusercontent.com/private=s1200']);
    await handler(new Request('https://galilea.test/api/archive/thumbnail?fileId=private-video'));
    assert.equal(calls.filter(call => call.startsWith('metadata:')).length, 2);
  });

  it('rejects out-of-bound files before requesting metadata or bytes', async () => {
    const { handler, calls } = fixture({ managed: false });
    const response = await handler(new Request('https://galilea.test/?fileId=outside'));
    assert.equal(response.status, 403);
    assert.deepEqual(calls, ['boundary:outside']);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('keeps missing thumbnails and trash out of success caches', async () => {
    for (const options of [{ link: null }, { trashed: true }]) {
      const { handler, calls } = fixture(options);
      const response = await handler(new Request('https://galilea.test/?fileId=video'));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!calls.some(call => call.startsWith('authenticated:')));
    }
  });

  it('falls back to the internal original endpoint for images without a thumbnail', async () => {
    const { handler } = fixture({ mimeType: 'image/jpeg', link: null });
    const response = await handler(new Request('https://galilea.test/?fileId=photo'));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), getArchiveMediaUrl('photo'));
  });

  it('reports failed OAuth as unavailable, without exposing or caching the upstream error', async () => {
    const { handler } = fixture({ boundaryError: new Error('invalid_grant secret-value') });
    const response = await handler(new Request('https://galilea.test/?fileId=private'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes('secret-value'));
  });

  it('rejects unsafe thumbnail origins and non-image responses', async () => {
    for (const value of ['http://lh3.googleusercontent.com/x', 'https://googleusercontent.com.evil.test/x', 'https://evil.test/x', 'https://user@lh3.googleusercontent.com/x']) {
      assert.equal(isGoogleThumbnailUrl(value), false);
      const { handler, calls } = fixture({ link: value });
      assert.equal((await handler(new Request('https://galilea.test/?fileId=f'))).status, 502);
      assert.ok(!calls.some(call => call.startsWith('authenticated:')));
    }
    const { handler } = fixture({ contentType: 'text/html' });
    assert.equal((await handler(new Request('https://galilea.test/?fileId=f'))).status, 502);
  });

  it('handles missing IDs and absent credentials without upstream requests', async () => {
    const { handler, calls } = fixture();
    assert.equal((await handler(new Request('https://galilea.test/'))).status, 400);
    assert.deepEqual(calls, []);
    const unavailable = createArchiveThumbnailHandler({ getDrive: () => null, isManaged: async () => true });
    assert.equal((await unavailable(new Request('https://galilea.test/?fileId=f'))).status, 503);
  });

  it('replaces expired legacy index URLs without mutating metadata', () => {
    const legacy = { id: 'photo & 1', thumbnailUrl: 'https://lh3.googleusercontent.com/expired', name: 'photo' } as FileItem;
    const normalized = withArchiveMediaUrls(legacy);
    assert.equal(normalized.thumbnailUrl, '/api/archive/thumbnail?fileId=photo%20%26%201');
    assert.equal(legacy.thumbnailUrl, 'https://lh3.googleusercontent.com/expired');
    assert.equal(normalized.name, legacy.name);
  });

  it('does not invalidate an indexed file when boundary validation loses Drive authentication', async () => {
    const previousRoot = process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID;
    process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID = 'managed-root';
    clearDriveCache();
    try {
      const unavailable = { files: { get: async () => { throw new Error('invalid_grant'); } } } as unknown as drive_v3.Drive;
      await assert.rejects(isFileInManagedArchive('f', unavailable), (error: unknown) =>
        error instanceof DriveError && error.kind === 'AUTH_ERROR');
      const missing = { files: { get: async () => { throw { code: 404, message: 'File not found' }; } } } as unknown as drive_v3.Drive;
      assert.equal(await isFileInManagedArchive('f', missing), false);
      const managed = { files: { get: async () => ({ data: { parents: ['managed-root'] } }) } } as unknown as drive_v3.Drive;
      assert.equal(await isFileInManagedArchive('f', managed), true);
    } finally {
      clearDriveCache();
      if (previousRoot === undefined) delete process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID;
      else process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID = previousRoot;
    }
  });
});
