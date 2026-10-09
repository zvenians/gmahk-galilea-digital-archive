import { getGoogleDriveClient, isFileInManagedArchive } from '@/lib/drive';
import { createArchiveThumbnailHandler } from '@/lib/archive-thumbnail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = createArchiveThumbnailHandler({
  getDrive: getGoogleDriveClient,
  isManaged: isFileInManagedArchive,
});
