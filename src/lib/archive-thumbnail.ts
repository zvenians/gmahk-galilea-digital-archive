import type { drive_v3, google } from 'googleapis';
import { classifyDriveError, DriveError } from './drive';
import { getArchiveMediaUrl } from './archive-media';

type Dependencies = {
  getDrive: () => drive_v3.Drive | null;
  isManaged: (fileId: string) => Promise<boolean>;
};

/** Only server-supplied Google image URLs may receive the Drive credential. */
export function isGoogleThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') &&
      (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'));
  } catch {
    return false;
  }
}

export function createArchiveThumbnailHandler({ getDrive, isManaged }: Dependencies) {
  return async function GET(req: Request): Promise<Response> {
    const failure = (message: string, status: number) => new Response(message, {
      status, headers: { 'Cache-Control': 'no-store' },
    });
    try {
      const fileId = new URL(req.url).searchParams.get('fileId')?.trim();
      if (!fileId) return failure('Missing fileId', 400);
      const drive = getDrive();
      if (!drive) throw new DriveError('AUTH_ERROR', 'Drive client not authenticated');
      if (!(await isManaged(fileId))) return failure('File not found in managed archive boundary', 403);

      // Obtain a fresh link on every cache miss; never read it from Firestore.
      const metadata = await drive.files.get({ fileId, fields: 'mimeType,thumbnailLink,trashed' });
      if (metadata.data.trashed) return failure('File not found', 404);
      const link = metadata.data.thumbnailLink;
      if (!link) {
        if (metadata.data.mimeType?.startsWith('image/')) {
          return new Response(null, { status: 302, headers: {
            Location: getArchiveMediaUrl(fileId), 'Cache-Control': 'no-store',
          } });
        }
        return failure('Pratinjau belum tersedia', 404);
      }
      if (!isGoogleThumbnailUrl(link)) return failure('Invalid thumbnail source', 502);

      const auth = drive.context._options.auth as InstanceType<typeof google.auth.OAuth2>;
      // Prevent credentials from following a redirect to another host.
      const response = await auth.request<ArrayBuffer>({
        url: link.replace(/=s\d+(?:-[a-z]+)?$/, '=s1200'),
        responseType: 'arraybuffer', redirect: 'error', timeout: 15_000,
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return failure('Invalid thumbnail response', 502);
      return new Response(new Uint8Array(response.data), { headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff',
      } });
    } catch (error) {
      // Do not log Google request objects: they may contain bearer credentials.
      const classified = classifyDriveError(error);
      console.error('Thumbnail proxy error:', classified.kind, classified.statusCode);
      if (classified.kind === 'AUTH_ERROR') return failure('Koneksi Google Drive sedang tidak tersedia.', 503);
      if (classified.kind === 'NOT_FOUND') return failure('File not found', 404);
      return failure('Pratinjau sementara tidak dapat dimuat', 502);
    }
  };
}
