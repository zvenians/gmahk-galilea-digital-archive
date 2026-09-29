import { NextRequest, NextResponse } from 'next/server';
import { getGoogleDriveClient, isFileInManagedArchive } from '@/lib/drive';

export const dynamic = 'force-dynamic';

function toWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (error: Error) => controller.error(error));
    },
    cancel() {
      if ('destroy' in nodeStream && typeof nodeStream.destroy === 'function') {
        nodeStream.destroy();
      }
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const fileId = new URL(req.url).searchParams.get('fileId')?.trim();
    if (!fileId) return new NextResponse('Missing fileId', { status: 400 });

    if (!(await isFileInManagedArchive(fileId))) {
      return new NextResponse('File not found in managed archive boundary', { status: 403 });
    }

    const drive = getGoogleDriveClient();
    if (!drive) return new NextResponse('Drive client not authenticated', { status: 500 });

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

    return new NextResponse(toWebStream(response.data as unknown as NodeJS.ReadableStream), {
      status: response.status === 206 || contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error('Media proxy error:', error);
    return new NextResponse('Media sementara tidak dapat dimuat', { status: 502 });
  }
}
