import { NextRequest, NextResponse } from 'next/server';
import { getRandomArchiveSample } from '@/lib/firestore';
import { classifyDriveError, getRandomFilesFromDrive } from '@/lib/drive';
import { getLatestDatedArchiveFile } from '@/lib/archive-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedCount = parseInt(searchParams.get('count') || '10', 10);
    const count = Number.isFinite(requestedCount) ? Math.min(Math.max(requestedCount, 1), 12) : 10;

    const driveItems = await getRandomFilesFromDrive(count);
    const indexedItems = driveItems.length < count
      ? await getRandomArchiveSample(count)
      : [];
    const randomItems = [...driveItems];
    const existingIds = new Set(randomItems.map((item) => item.id));
    for (const item of indexedItems) {
      if (!existingIds.has(item.id) && randomItems.length < count) {
        randomItems.push(item);
        existingIds.add(item.id);
      }
    }

    const latestItem = getLatestDatedArchiveFile(randomItems);

    return NextResponse.json({
      success: true,
      data: randomItems,
      featuredSabbath: latestItem ? {
        date: latestItem.sabbathDate,
        formattedTitle: latestItem.sabbathTitle,
        year: latestItem.year,
        quarter: latestItem.quarter,
      } : null,
    });
  } catch (error) {
    console.error('API Random archive error:', error);
    if (classifyDriveError(error).kind === 'AUTH_ERROR') {
      return NextResponse.json({ success: false, code: 'DRIVE_AUTH_ERROR', error: 'Koneksi Google Drive sedang tidak tersedia.' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: 'Failed to fetch random archive' }, { status: 500 });
  }
}
