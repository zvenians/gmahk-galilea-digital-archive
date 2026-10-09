import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { determineFileType, getGoogleDriveClient, isFileInManagedArchive } from '@/lib/drive';
import { requireAdmin } from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (!authResult.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAdminFirestore();
    if (!db) return NextResponse.json({ success: false, error: 'Firestore error' }, { status: 500 });

    const snapshot = await db.collection('fileIndex')
      .where('isRandomEligible', '==', true)
      .get();

    const results = {
      scanned: snapshot.docs.length,
      invalidated: 0,
      refreshed: 0,
      errors: 0,
    };

    for (const doc of snapshot.docs) {
      try {
        const fileId = doc.id;
        const isManaged = await isFileInManagedArchive(fileId);
        if (!isManaged) {
          await doc.ref.update({ isRandomEligible: false });
          results.invalidated++;
          continue;
        }
        const drive = getGoogleDriveClient();
        if (!drive) throw new Error('Google Drive belum terhubung.');
        const metadata = await drive.files.get({
          fileId,
          fields: 'id,name,mimeType,size,webViewLink,webContentLink,createdTime,trashed',
        });
        if (metadata.data.trashed) {
          await doc.ref.update({ isRandomEligible: false });
          results.invalidated++;
          continue;
        }
        const current = doc.data();
        const fileType = determineFileType(metadata.data.mimeType || '', metadata.data.name || current.name || '');
        await doc.ref.set({
          name: metadata.data.name || current.name,
          mimeType: metadata.data.mimeType || current.mimeType,
          size: Number(metadata.data.size || current.size || 0),
          fileType,
          thumbnailUrl: FieldValue.delete(),
          webViewLink: metadata.data.webViewLink || null,
          webContentLink: metadata.data.webContentLink || null,
          uploadedAt: metadata.data.createdTime || current.uploadedAt,
          isRandomEligible: fileType === 'photo' || fileType === 'video',
        }, { merge: true });
        results.refreshed++;
      } catch (err) {
        console.error('Error reconciling file:', doc.id, err);
        results.errors++;
      }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error: unknown) {
    console.error('Reconcile error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
