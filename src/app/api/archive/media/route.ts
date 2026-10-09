import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { classifyDriveError, getGoogleDriveClient, isFileInManagedArchive } from '@/lib/drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const fileId = new URL(req.url).searchParams.get('fileId')?.trim();
    if (!fileId) return new NextResponse('Missing fileId', { status: 400 });

    const drive = getGoogleDriveClient();
    if (!drive) return new NextResponse('Koneksi Google Drive sedang tidak tersedia.', { status: 503, headers: { 'Cache-Control': 'no-store' } });

    if (!(await isFileInManagedArchive(fileId))) {
      return new NextResponse('File not found in managed archive boundary', { status: 403 });
    }

    const metadata = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,trashed',
    });
    if (metadata.data.trashed) return new NextResponse('File not found', { status: 404 });

    const range = req.headers.get('range') || undefined;
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : undefined,
      }
    );

    const headers = new Headers();
    headers.set('Content-Type', metadata.data.mimeType || 'application/octet-stream');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    headers.set('X-Content-Type-Options', 'nosniff');

    const upstreamHeaders = response.headers as unknown as {
      get?: (name: string) => string | null;
      [key: string]: unknown;
    };
    const getUpstreamHeader = (name: string): string | undefined => {
      if (typeof upstreamHeaders.get === 'function') return upstreamHeaders.get(name) || undefined;
      const value = upstreamHeaders[name];
      return typeof value === 'string' ? value : undefined;
    };
    const contentRange = getUpstreamHeader('content-range');
    const contentLength = getUpstreamHeader('content-length') || (range ? undefined : metadata.data.size || undefined);
    if (contentRange) headers.set('Content-Range', contentRange);
    if (contentLength) headers.set('Content-Length', String(contentLength));

    // Native conversion honors backpressure and destroys the upstream on cancel.
    return new NextResponse(Readable.toWeb(response.data as unknown as Readable) as ReadableStream<Uint8Array>, {
      status: response.status === 206 || contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    const classified = classifyDriveError(error);
    console.error('Media proxy error:', classified.kind, classified.statusCode);
    const status = classified.kind === 'AUTH_ERROR' ? 503 : classified.kind === 'NOT_FOUND' ? 404 : classified.statusCode === 416 ? 416 : 502;
    return new NextResponse(status === 503 ? 'Koneksi Google Drive sedang tidak tersedia.' : 'Media sementara tidak dapat dimuat', { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
