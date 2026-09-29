import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drive_v3 } from 'googleapis';
import { determineFileType, isConfiguredValue, listAllDriveFiles } from '../src/lib/drive';
import { createUploadSessionToken, verifyUploadSessionToken } from '../src/lib/upload-session';
import { getLatestDatedArchiveFile } from '../src/lib/archive-utils';
import { FileItem } from '../src/lib/types';

describe('Upload session integrity', () => {
  process.env.UPLOAD_SESSION_SECRET = 'test-secret-with-enough-entropy-for-hmac';

  const payload = {
    uid: 'admin-123',
    fileName: 'video besar.mp4',
    mimeType: 'video/mp4',
    fileSize: 150 * 1024 * 1024,
    category: 'documentation' as const,
    sabbathDate: '2026-09-26',
    sabbathTitle: '26 September 2026',
    year: 2026,
    quarter: 3,
    folderId: 'folder-managed',
    folderPath: 'GMAHK Galilea/Dokumentasi/2026/Triwulan III/26 September 2026',
  };

  it('mengikat metadata video >100 MB ke akun admin', () => {
    const token = createUploadSessionToken(payload);
    const verified = verifyUploadSessionToken(token, payload.uid);
    assert.equal(verified.fileSize, 150 * 1024 * 1024);
    assert.equal(verified.folderId, 'folder-managed');
    assert.equal(verified.fileName, 'video besar.mp4');
  });

  it('menolak token yang dimanipulasi atau dipakai akun lain', () => {
    const token = createUploadSessionToken(payload);
    assert.throws(() => verifyUploadSessionToken(`${token}x`, payload.uid), /tidak valid/);
    assert.throws(() => verifyUploadSessionToken(token, 'admin-lain'), /bukan milik akun ini/);
  });

  it('menolak sesi yang sudah kedaluwarsa', () => {
    const token = createUploadSessionToken(payload, -1);
    assert.throws(() => verifyUploadSessionToken(token, payload.uid), /kedaluwarsa/);
  });
});

describe('Archive reliability regressions', () => {
  it('menganggap nilai contoh konfigurasi sebagai belum dikonfigurasi', () => {
    assert.equal(isConfiguredValue(undefined), false);
    assert.equal(isConfiguredValue('your-google-oauth-client-id'), false);
    assert.equal(isConfiguredValue('replace-with-a-long-random-secret'), false);
    assert.equal(isConfiguredValue('-----BEGIN PRIVATE KEY-----\\nYOUR_KEY_HERE'), false);
    assert.equal(isConfiguredValue('real-config-value'), true);
  });

  it('mengenali format media dan dokumen modern', () => {
    assert.equal(determineFileType('application/octet-stream', 'foto.avif'), 'photo');
    assert.equal(determineFileType('application/octet-stream', 'kamera.heif'), 'photo');
    assert.equal(determineFileType('application/octet-stream', 'rekaman.m2ts'), 'video');
    assert.equal(determineFileType('application/octet-stream', 'materi.odp'), 'presentation');
    assert.equal(determineFileType('application/octet-stream', 'laporan.odt'), 'document');
    assert.equal(determineFileType('application/octet-stream', 'rekap.ods'), 'spreadsheet');
  });

  it('mengikuti nextPageToken sampai seluruh hasil Drive terkumpul', async () => {
    const calls: Array<string | undefined> = [];
    const fakeDrive = {
      files: {
        list: async ({ pageToken }: { pageToken?: string }) => {
          calls.push(pageToken);
          return pageToken
            ? { data: { files: [{ id: '3' }] } }
            : { data: { files: [{ id: '1' }, { id: '2' }], nextPageToken: 'page-2' } };
        },
      },
    } as unknown as drive_v3.Drive;

    const files = await listAllDriveFiles({ q: 'trashed = false', fields: 'files(id)' }, fakeDrive);
    assert.deepEqual(files.map((file) => file.id), ['1', '2', '3']);
    assert.deepEqual(calls, [undefined, 'page-2']);
  });

  it('memilih tanggal arsip terbaru tanpa mengubah urutan galeri', () => {
    const base = { name: 'media', mimeType: 'image/jpeg', size: 1, category: 'documentation', fileType: 'photo', sabbathTitle: '', year: 2026, quarter: 3, folderId: 'f', uploadedAt: '', isRandomEligible: true } as const;
    const files: FileItem[] = [
      { ...base, id: 'a', sabbathDate: '2026-09-12' },
      { ...base, id: 'custom', sabbathDate: 'KKR Pemuda' },
      { ...base, id: 'b', sabbathDate: '2026-09-26' },
    ];
    assert.equal(getLatestDatedArchiveFile(files)?.id, 'b');
    assert.deepEqual(files.map((file) => file.id), ['a', 'custom', 'b']);
  });
});
