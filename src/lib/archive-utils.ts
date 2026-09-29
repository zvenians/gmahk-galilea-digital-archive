import { FileItem } from './types';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getLatestDatedArchiveFile(files: FileItem[]): FileItem | undefined {
  let latest: FileItem | undefined;
  for (const file of files) {
    if (!ISO_DATE_PATTERN.test(file.sabbathDate)) continue;
    if (!latest || file.sabbathDate > latest.sabbathDate) latest = file;
  }
  return latest;
}
