import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth-server';
import { getDefaultUploadSabbath, isValidSabbathDate } from '@/lib/sabbath';
import {
  resolveSabbathDestinationFolder,
  getNonCollidingFileName,
  classifyDriveError,
  determineFileType,
  clearDriveCache,
  createResumableUploadSession,
  getGoogleDriveClient,
} from '@/lib/drive';
import { indexFile, logSystemEvent } from '@/lib/firestore';
import { ArchiveCategory, FileItem } from '@/lib/types';
import { createGuestUploadIdentity, verifyGuestUploadIdentity, createUploadSessionToken, verifyUploadSessionToken } from '@/lib/upload-session';

const MAX_DRIVE_FILE_SIZE = 5 * 1024 * 1024 * 1024 * 1024;

function sanitizeFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 240);
}

export async function POST(req: NextRequest) {
  try {
    // Public upload only. Admin routes retain their independent role guards.
    // Reject cross-origin writes; a signed HttpOnly guest cookie owns each
    // anonymous session, while signed-in uploads keep their verified UID.
    const origin = req.headers.get('origin');
    // Next's internal URL may use localhost behind a proxy. Compare against
    // the actual request Host, not the internal server origin.
    const requestHost = req.headers.get('host') || new URL(req.url).host;
    let allowedOrigin = !origin;
    if (origin) {
      try {
        const source = new URL(origin);
        allowedOrigin = ['http:', 'https:'].includes(source.protocol) && source.host === requestHost;
      } catch { allowedOrigin = false; }
    }
    if (req.headers.get('sec-fetch-site') === 'cross-site' || !allowedOrigin) {
      return NextResponse.json({ success: false, error: 'Asal permintaan unggahan tidak diizinkan.' }, { status: 403 });
    }
    const authHeader = req.headers.get('Authorization');
    const account = authHeader ? await authenticateRequest(req) : null;
    if (authHeader && !account) {
      return NextResponse.json(
        {
          success: false,
          error: 'Sesi akun sudah berakhir. Muat ulang halaman dan coba lagi.',
        },
        { status: 401 }
      );
    }

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    
    // We expect a JSON payload
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Format permintaan tidak valid. Harap gunakan JSON.' }, { status: 400 });
    }

    const action = body.action;

    const guestUid = verifyGuestUploadIdentity(req.cookies.get('galilea-upload-guest')?.value);
    if (action === 'guest') {
      const response = NextResponse.json({ success: true });
      if (!account && !guestUid) {
        const guest = createGuestUploadIdentity();
        response.cookies.set('galilea-upload-guest', guest.cookie, {
          httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
          path: '/api/upload', maxAge: 86400,
        });
      }
      return response;
    }
    const session = account || (guestUid ? { uid: guestUid, email: 'Tamu' } : null);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Sesi unggahan belum siap. Muat ulang halaman dan coba lagi.' }, { status: 401 });
    }

    const safeLog = (event: string, details: Record<string, unknown>) => {
        console.log(`[UploadDiag Server ${new Date().toISOString()}] ${event}:`, JSON.stringify(details));
    };

    if (action === 'init') {
        const { mimeType, category: rawCategory, sabbathDate: rawSabbathDate } = body;
        const fileName = sanitizeFileName(body.fileName);
        const fileSize = Number(body.fileSize);
        const normalizedMimeType = typeof mimeType === 'string' && mimeType.trim()
          ? mimeType.trim().slice(0, 150)
          : 'application/octet-stream';
        const category: ArchiveCategory = rawCategory === 'worship' ? 'worship' : 'documentation';
        let targetSabbathDate = typeof rawSabbathDate === 'string' ? rawSabbathDate.trim() : '';

        if (!fileName || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
            return NextResponse.json({ success: false, error: 'Nama dan ukuran berkas diperlukan.' }, { status: 400 });
        }
        if (fileSize > MAX_DRIVE_FILE_SIZE) {
            return NextResponse.json({ success: false, error: 'Ukuran berkas melampaui batas Google Drive (5 TB).' }, { status: 413 });
        }

        if (!targetSabbathDate) {
            const defaultSabbath = getDefaultUploadSabbath();
            targetSabbathDate = defaultSabbath.date;
        } else if (!isValidSabbathDate(targetSabbathDate)) {
            return NextResponse.json(
                { success: false, error: `Tanggal '${targetSabbathDate}' bukan hari Sabat yang valid. Format yang diharapkan adalah YYYY-MM-DD (hari Sabtu).` },
                { status: 400 }
            );
        }

        let destination;
        try {
            destination = await resolveSabbathDestinationFolder(category, targetSabbathDate);
        } catch (destErr) {
            const classified = classifyDriveError(destErr);
            console.error('[Upload Init] Destination folder resolution error:', classified.message);
            return NextResponse.json(
                { success: false, error: `Gagal menyiapkan folder tujuan [${classified.kind}]: ${classified.message}` },
                { status: 500 }
            );
        }

        let safeFileName;
        let sessionUrl;
        try {
            safeFileName = await getNonCollidingFileName(destination.folderId, fileName);
            sessionUrl = await createResumableUploadSession({
                folderId: destination.folderId,
                name: safeFileName,
                mimeType: normalizedMimeType,
                size: fileSize,
                origin: origin || undefined,
            });
        } catch (uploadErr) {
            const classified = classifyDriveError(uploadErr);
            safeLog('INIT_FAIL', { fileName, fileSize, error: classified.message });
            return NextResponse.json(
                { success: false, error: `Gagal membuat sesi unggahan [${classified.kind}]: ${classified.message}` },
                { status: 500 }
            );
        }

        const uploadToken = createUploadSessionToken({
            uid: session.uid,
            fileName: safeFileName,
            mimeType: normalizedMimeType,
            fileSize,
            category,
            sabbathDate: targetSabbathDate,
            sabbathTitle: destination.sabbathTitle,
            year: destination.year,
            quarter: destination.quarter,
            folderId: destination.folderId,
            folderPath: destination.folderPath,
            sessionUrl,
        });

        safeLog('INIT_SUCCESS', { fileName, safeFileName, fileSize, category, folderId: destination.folderId, uid: session.uid });

        return NextResponse.json({
            success: true,
            sessionUrl,
            uploadToken,
            safeFileName,
            destination: {
                folderId: destination.folderId,
                folderPath: destination.folderPath,
                sabbathTitle: destination.sabbathTitle,
                sabbathDate: targetSabbathDate,
                year: destination.year,
                quarter: destination.quarter,
                category
            }
        });
    }

    if (action === 'status') {
        let uploadSession;
        try {
            uploadSession = verifyUploadSessionToken(typeof body.uploadToken === 'string' ? body.uploadToken : '', session.uid);
        } catch {
            return NextResponse.json({ success: false, error: 'Sesi upload tidak valid. Mulai ulang upload ini.' }, { status: 400 });
        }
        // Only a server-signed Google URL may be contacted. Never accept a
        // client-supplied URL or follow redirects (SSRF/capability protection).
        const url = uploadSession.sessionUrl ? new URL(uploadSession.sessionUrl) : null;
        if (!url || url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || url.port || url.username || url.password || url.pathname !== '/upload/drive/v3/files' || url.searchParams.get('uploadType') !== 'resumable') {
            return NextResponse.json({ success: false, error: 'Sesi upload lama sudah berakhir. Mulai ulang upload ini.' }, { status: 400 });
        }
        const response = await fetch(url, {
            method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(30000),
            headers: { 'Content-Length': '0', 'Content-Range': `bytes */${uploadSession.fileSize}` },
        });
        const responseBody = await response.text();
        safeLog('STATUS_CHECK', { status: response.status });
        return NextResponse.json({ success: true, status: response.status, range: response.headers.get('Range'), body: responseBody }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'finalize') {
        const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : '';
        const uploadToken = typeof body.uploadToken === 'string' ? body.uploadToken : '';
        
        if (!fileId || !uploadToken) {
            safeLog('FINALIZE_FAIL_BAD_REQUEST', { fileId });
            return NextResponse.json({ success: false, error: 'Data finalisasi tidak lengkap.' }, { status: 400 });
        }

        let uploadSession;
        try {
            uploadSession = verifyUploadSessionToken(uploadToken, session.uid);
        } catch (err) {
            safeLog('FINALIZE_FAIL_TOKEN', { fileId, error: (err as Error).message });
            return NextResponse.json({ success: false, error: (err as Error).message }, { status: 400 });
        }

        const drive = getGoogleDriveClient();
        if (!drive) {
            return NextResponse.json({ success: false, error: 'Google Drive tidak terautentikasi.' }, { status: 500 });
        }

        let driveFile;
        try {
            const res = await drive.files.get({
                fileId,
                fields: 'id, name, mimeType, parents, webViewLink, webContentLink, size, createdTime, trashed'
            });
            driveFile = res.data;
        } catch (err) {
            const classified = classifyDriveError(err);
            safeLog('FINALIZE_FAIL_DRIVE_GET', { fileId, fileName: uploadSession.fileName, error: classified.message });
            return NextResponse.json(
                { success: false, error: `Gagal mengambil metadata file dari Google Drive [${classified.kind}]: ${classified.message}` },
                { status: 500 }
            );
        }

        const actualSize = Number(driveFile.size || 0);
        const isExpectedFile =
          !driveFile.trashed &&
          driveFile.name === uploadSession.fileName &&
          driveFile.parents?.includes(uploadSession.folderId) &&
          actualSize === uploadSession.fileSize;

        if (!isExpectedFile) {
          safeLog('FINALIZE_FAIL_MISMATCH', {
            fileId,
            expectedName: uploadSession.fileName,
            actualName: driveFile.name,
            expectedFolderId: uploadSession.folderId,
            actualParents: driveFile.parents,
            expectedSize: uploadSession.fileSize,
            actualSize,
          });
          return NextResponse.json(
            { success: false, error: 'Berkas Google Drive tidak sesuai dengan sesi unggahan.' },
            { status: 409 }
          );
        }

        const actualMimeType = driveFile.mimeType || uploadSession.mimeType;
        const fileType = determineFileType(actualMimeType, uploadSession.fileName);
        
        safeLog('FINALIZE_VERIFY_SIZE', { fileId, fileName: uploadSession.fileName, actualSize, reportedSize: uploadSession.fileSize });

        const fileItem: FileItem = {
            id: driveFile.id || fileId,
            name: uploadSession.fileName,
            mimeType: actualMimeType,
            size: actualSize,
            category: uploadSession.category,
            fileType,
            sabbathDate: uploadSession.sabbathDate,
            sabbathTitle: uploadSession.sabbathTitle,
            year: uploadSession.year,
            quarter: uploadSession.quarter,
            folderId: uploadSession.folderId,
            ...(driveFile.webViewLink ? { webViewLink: driveFile.webViewLink } : {}),
            ...(driveFile.webContentLink ? { webContentLink: driveFile.webContentLink } : {}),
            uploadedBy: session.email,
            uploadedAt: driveFile.createdTime || new Date().toISOString(),
            isRandomEligible: fileType === 'photo' || fileType === 'video',
        };

        let indexPending = false;
        try {
            await indexFile(fileItem, token);
        } catch (indexErr) {
            safeLog('FINALIZE_FAIL_INDEX', { fileId, fileName: uploadSession.fileName, error: (indexErr as Error).message });
            // Archive discovery reads Drive directly. Guests have no Firebase
            // REST token. For all uploaders, keep a verified Drive upload successful. Report
            // a pending auxiliary index instead of prompting a duplicate upload.
            indexPending = true;
        }

        try {
            await logSystemEvent({
                type: 'UPLOAD',
                message: `1 berkas diunggah ke ${uploadSession.folderPath}`,
                userId: session?.uid,
                metadata: {
                    count: 1,
                    category: uploadSession.category,
                    sabbathDate: uploadSession.sabbathDate,
                    folderPath: uploadSession.folderPath,
                    fileName: uploadSession.fileName,
                    indexPending,
                },
            });
        } catch (logErr) {
            safeLog('FINALIZE_FAIL_LOG', { fileId, fileName: uploadSession.fileName, error: (logErr as Error).message });
            // continue, non-fatal
        }

        safeLog('FINALIZE_SUCCESS', { fileId, fileName: uploadSession.fileName, actualSize });

        clearDriveCache();

        return NextResponse.json({
            success: true,
            message: `Berkas berhasil diunggah ke Sabat ${uploadSession.sabbathTitle}`,
            data: fileItem,
            indexPending,
        });
    }

    return NextResponse.json({ success: false, error: 'Aksi tidak valid.' }, { status: 400 });

  } catch (error) {
    console.error('API Upload error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
