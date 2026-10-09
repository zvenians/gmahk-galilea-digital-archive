import type { FileItem } from './types';

export function getArchiveMediaUrl(fileId: string): string {
  return `/api/archive/media?fileId=${encodeURIComponent(fileId)}`;
}

export function getArchiveThumbnailUrl(fileId: string): string {
  return `/api/archive/thumbnail?fileId=${encodeURIComponent(fileId)}`;
}

/** Ignore legacy thumbnailLink values, including ones read from old indexes. */
export function withArchiveMediaUrls(file: FileItem): FileItem {
  return { ...file, thumbnailUrl: getArchiveThumbnailUrl(file.id) };
}
