import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
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
import { createUploadSessionToken, verifyUploadSessionToken } from '@/lib/upload-session';

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
    const authorization = await requireAdmin(req);
    if (!authorization.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: authorization.status === 'forbidden'
            ? 'Hanya admin yang dapat mengunggah berkas.'
            : 'Silakan masuk sebagai admin untuk mengunggah berkas.',
        },
        { status: authorization.status === 'forbidden' ? 403 : 401 }
      );
    }

    const session = authorization.session;
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    
    // We expect a JSON payload
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Format permintaan tidak valid. Harap gunakan JSON.' }, { status: 400 });
    }

    const action = body.action;

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
                size: fileSize
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
                fields: 'id, name, mimeType, parents, webViewLink, webContentLink, thumbnailLink, size, createdTime, trashed'
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
            thumbnailUrl: driveFile.thumbnailLink
              ? driveFile.thumbnailLink.replace(/=s\d+/, '=s1200')
              : undefined,
            webViewLink: driveFile.webViewLink || undefined,
            webContentLink: driveFile.webContentLink || undefined,
            uploadedBy: session.email,
            uploadedAt: driveFile.createdTime || new Date().toISOString(),
            isRandomEligible: fileType === 'photo' || fileType === 'video',
        };

        try {
            await indexFile(fileItem, token);
        } catch (indexErr) {
            safeLog('FINALIZE_FAIL_INDEX', { fileId, fileName: uploadSession.fileName, error: (indexErr as Error).message });
            return NextResponse.json({ success: false, error: 'Gagal mencatat data ke database.' }, { status: 500 });
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
                    fileName: uploadSession.fileName
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
            data: fileItem
        });
    }

    return NextResponse.json({ success: false, error: 'Aksi tidak valid.' }, { status: 400 });

  } catch (error) {
    console.error('API Upload error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
