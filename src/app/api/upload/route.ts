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
  getGoogleDriveClient
} from '@/lib/drive';
import { indexFile, logSystemEvent } from '@/lib/firestore';
import { ArchiveCategory, FileItem } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split('Bearer ')[1]?.trim() : undefined;

    const session = await authenticateRequest(req);
    
    // We expect a JSON payload
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Format permintaan tidak valid. Harap gunakan JSON.' }, { status: 400 });
    }

    const action = body.action;

    if (action === 'init') {
        const { fileName, mimeType, fileSize, category: rawCategory, sabbathDate: rawSabbathDate } = body;
        const category: ArchiveCategory = rawCategory === 'worship' ? 'worship' : 'documentation';
        let targetSabbathDate = rawSabbathDate?.trim() || null;

        if (!fileName || !fileSize) {
            return NextResponse.json({ success: false, error: 'Nama dan ukuran berkas diperlukan.' }, { status: 400 });
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
                mimeType: mimeType || 'application/octet-stream',
                size: fileSize
            });
        } catch (uploadErr) {
            const classified = classifyDriveError(uploadErr);
            console.error(`[Upload Init] Failed to create session for '${fileName}':`, classified.message);
            return NextResponse.json(
                { success: false, error: `Gagal membuat sesi unggahan [${classified.kind}]: ${classified.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            sessionUrl,
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
        const { fileId, fileName, mimeType, fileSize, category, destination } = body;
        
        if (!fileId || !fileName || !destination) {
            return NextResponse.json({ success: false, error: 'Data finalisasi tidak lengkap.' }, { status: 400 });
        }

        const drive = getGoogleDriveClient();
        if (!drive) {
            return NextResponse.json({ success: false, error: 'Google Drive tidak terautentikasi.' }, { status: 500 });
        }

        let driveFile;
        try {
            const res = await drive.files.get({
                fileId,
                fields: 'id, name, webViewLink, webContentLink, size'
            });
            driveFile = res.data;
        } catch (err) {
            const classified = classifyDriveError(err);
            return NextResponse.json(
                { success: false, error: `Gagal mengambil metadata file dari Google Drive [${classified.kind}]: ${classified.message}` },
                { status: 500 }
            );
        }

        const actualMimeType = mimeType || 'application/octet-stream';
        const fileType = determineFileType(actualMimeType, fileName);

        const fileItem: FileItem = {
            id: driveFile.id || fileId,
            name: fileName,
            mimeType: actualMimeType,
            size: driveFile.size ? parseInt(driveFile.size, 10) : fileSize,
            category,
            fileType,
            sabbathDate: destination.sabbathDate,
            sabbathTitle: destination.sabbathTitle,
            year: destination.year,
            quarter: destination.quarter,
            folderId: destination.folderId,
            webViewLink: driveFile.webViewLink || undefined,
            webContentLink: driveFile.webContentLink || undefined,
            uploadedBy: session?.email || 'jemaat@gmahk-galilea.org',
            uploadedAt: new Date().toISOString(),
            isRandomEligible: fileType === 'photo' || fileType === 'video',
        };

        await indexFile(fileItem, token);

        await logSystemEvent({
            type: 'UPLOAD',
            message: `1 berkas diunggah ke ${destination.folderPath}`,
            userId: session?.uid,
            metadata: {
                count: 1,
                category,
                sabbathDate: destination.sabbathDate,
                folderPath: destination.folderPath,
                fileName: fileName
            },
        });

        clearDriveCache();

        return NextResponse.json({
            success: true,
            message: `Berkas berhasil diunggah ke Sabat ${destination.sabbathTitle}`,
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
