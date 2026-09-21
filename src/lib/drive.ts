import { google } from 'googleapis';
import { Readable } from 'stream';
import { ArchiveCategory, FileFormatType, FileItem, SabbathInfo } from './types';
import {
  parseSabbathDetails,
  isValidSabbathDate,
  getSabbathsInQuarter,
  getQuarterTitle,
  getNearestSabbath,
  getWitaDateParts,
  formatSabbathTitle,
  getQuarterFromMonth,
} from './sabbath';


interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class DriveMemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries = 500;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number = 60): void {
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const driveCache = new DriveMemoryCache();

/**
 * Clears all cached Google Drive folder structures, tree results, and file lists.
 * Call after uploads or file deletions to ensure immediate data freshness.
 */
export function clearDriveCache(): void {
  driveCache.clear();
}

export interface DriveFolderResult {
  id: string;
  name: string;
  isExisting: boolean;
}

export type DriveErrorKind = 'NOT_FOUND' | 'PERMISSION_ERROR' | 'AUTH_ERROR' | 'API_ERROR';

export class DriveError extends Error {
  kind: DriveErrorKind;
  statusCode?: number;

  constructor(kind: DriveErrorKind, message: string, statusCode?: number) {
    super(`[${kind}] ${message}`);
    this.name = 'DriveError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export function classifyDriveError(err: unknown): DriveError {
  if (err instanceof DriveError) return err;

  const errorObj = err as {
    code?: number | string;
    status?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };

  const status =
    typeof errorObj?.status === 'number'
      ? errorObj.status
      : typeof errorObj?.code === 'number'
      ? errorObj.code
      : undefined;

  const msg = errorObj?.message || String(err);
  const reason = errorObj?.errors?.[0]?.reason || '';

  if (
    msg.includes('invalid_grant') ||
    reason === 'authError' ||
    status === 401 ||
    msg.includes('unauthorized_client') ||
    msg.includes('invalid_client')
  ) {
    let specificMsg = `Autentikasi Google Drive OAuth gagal: ${msg}`;
    if (msg.includes('invalid_grant')) {
      specificMsg = 'Google Drive refresh token invalid atau sudah kedaluwarsa (invalid_grant). Mohon perbarui GOOGLE_DRIVE_REFRESH_TOKEN.';
    } else if (msg.includes('unauthorized_client') || msg.includes('invalid_client')) {
      specificMsg = 'Kredensial OAuth Google Drive (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) tidak valid.';
    }
    return new DriveError('AUTH_ERROR', specificMsg, status || 401);
  }

  if (
    status === 403 ||
    reason === 'insufficientFilePermissions' ||
    reason === 'forbidden' ||
    msg.includes('The caller does not have permission')
  ) {
    return new DriveError('PERMISSION_ERROR', `Izin Google Drive ditolak: ${msg}`, status || 403);
  }

  if (status === 404 || reason === 'notFound' || msg.includes('File not found')) {
    return new DriveError('NOT_FOUND', `Folder atau berkas tidak ditemukan di Google Drive: ${msg}`, 404);
  }

  if (msg.includes('Could not load the default credentials')) {
    return new DriveError('AUTH_ERROR', 'Google Drive kredensial server tidak ditemukan (ADC tidak tersedia di Vercel). Pastikan User OAuth dikonfigurasi.', 401);
  }

  return new DriveError('API_ERROR', `Kesalahan Google Drive API (${status || 'unknown'}): ${msg}`, status);
}

/**
 * Returns an authenticated Google Drive client:
 * 1. Primary & only strategy in production: User OAuth 2.0 (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN)
 *    -> Operates directly on the user's personal Google Drive (My Drive).
 * 2. Secondary fallback: Explicit Service Account (if configured via FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY).
 *
 * NOTE: Application Default Credentials (ADC) and local service-account.json files are EXPLICITLY NOT USED.
 * Silent fallback to ADC causes "Could not load the default credentials" in serverless environments like Vercel.
 */
export function getGoogleDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();

  // 1. PRIMARY: User OAuth 2.0 with Refresh Token (Personal My Drive)
  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  // 2. Secondary: Explicit Service Account (only if explicitly set in environment)
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  let privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (clientEmail && privateKey && !privateKey.includes('YOUR_KEY_HERE')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return google.drive({ version: 'v3', auth });
  }

  // NO silent fallback to ADC or local service-account.json files!
  return null;
}

/**
 * Returns descriptive status and safe diagnostics of current Google Drive authentication.
 * Never exposes actual secrets.
 */
export function getDriveAuthInfo(): {
  isAuthenticated: boolean;
  strategy: 'oauth_user' | 'service_account' | 'none';
  targetStorage: string;
  diagnostics: {
    clientId: 'PRESENT' | 'MISSING';
    clientSecret: 'PRESENT' | 'MISSING';
    refreshToken: 'PRESENT' | 'MISSING';
    rootFolderId: 'PRESENT' | 'MISSING';
    dokumentasiFolderId: 'PRESENT' | 'MISSING';
    fileIbadahFolderId: 'PRESENT' | 'MISSING';
  };
} {
  const hasClientId = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const hasClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
  const hasRefreshToken = Boolean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim());
  const hasRootId = Boolean(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim());
  const hasDokId = Boolean(process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID?.trim());
  const hasIbadahId = Boolean(process.env.GOOGLE_DRIVE_FILE_IBADAH_FOLDER_ID?.trim());

  const diagnostics = {
    clientId: hasClientId ? ('PRESENT' as const) : ('MISSING' as const),
    clientSecret: hasClientSecret ? ('PRESENT' as const) : ('MISSING' as const),
    refreshToken: hasRefreshToken ? ('PRESENT' as const) : ('MISSING' as const),
    rootFolderId: hasRootId ? ('PRESENT' as const) : ('MISSING' as const),
    dokumentasiFolderId: hasDokId ? ('PRESENT' as const) : ('MISSING' as const),
    fileIbadahFolderId: hasIbadahId ? ('PRESENT' as const) : ('MISSING' as const),
  };

  if (hasClientId && hasClientSecret && hasRefreshToken) {
    return {
      isAuthenticated: true,
      strategy: 'oauth_user',
      targetStorage: 'My Drive Pribadi Akun Google (User OAuth 2.0)',
      diagnostics,
    };
  }

  if (process.env.FIREBASE_CLIENT_EMAIL?.trim() && process.env.FIREBASE_PRIVATE_KEY?.trim()) {
    return {
      isAuthenticated: true,
      strategy: 'service_account',
      targetStorage: 'Service Account Storage',
      diagnostics,
    };
  }

  return {
    isAuthenticated: false,
    strategy: 'none',
    targetStorage: 'Belum Terhubung',
    diagnostics,
  };
}

/**
 * Finds an existing folder by name inside a parent folder
 */
export async function findFolderByName(
  parentFolderId: string,
  folderName: string
): Promise<string | null> {
  const cacheKey = `folder:${parentFolderId}:${folderName}`;
  const cached = driveCache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const drive = getGoogleDriveClient();
  if (!drive) {
    if (process.env.NODE_ENV === 'test' && !process.env.GOOGLE_CLIENT_ID) {
      return null;
    }
    throw new DriveError('AUTH_ERROR', 'Google Drive client tidak terautentikasi. Kredensial tidak ditemukan.', 401);
  }

  try {
    const escapedName = folderName.replace(/'/g, "\\'");
    const res = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    const files = res.data.files;
    if (files && files.length > 0 && files[0].id) {
      driveCache.set(cacheKey, files[0].id, 300); // Cache for 5 minutes
      return files[0].id;
    }
    return null;
  } catch (err) {
    const classified = classifyDriveError(err);
    console.error(`[Drive] Error searching folder '${folderName}' in parent '${parentFolderId}':`, classified.message);
    throw classified;
  }
}

/**
 * Idempotently ensures a folder exists inside a parent folder.
 * If it already exists, returns the existing ID without creating a duplicate.
 */
export async function ensureFolder(
  parentFolderId: string,
  folderName: string
): Promise<DriveFolderResult> {
  const drive = getGoogleDriveClient();
  if (!drive) {
    // Development/test fallback mock ID when no Google credentials configured
    const mockId = `mock_folder_${folderName.replace(/\s+/g, '_')}`;
    return { id: mockId, name: folderName, isExisting: false };
  }

  const existingId = await findFolderByName(parentFolderId, folderName);
  if (existingId) {
    return { id: existingId, name: folderName, isExisting: true };
  }

  try {
    const res = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id, name',
    });

    const createdId = res.data.id || '';
    if (createdId) {
      driveCache.set(`folder:${parentFolderId}:${folderName}`, createdId, 300);
    }

    return {
      id: createdId,
      name: folderName,
      isExisting: false,
    };
  } catch (err) {
    throw classifyDriveError(err);
  }
}

/**
 * Creates a manual event folder directly under the corresponding Year/Quarter folder.
 */
export async function createActivityFolderInDrive(
  title: string,
  year: number,
  quarter: number,
  category: ArchiveCategory
): Promise<{ folderId: string; folderPath: string }> {
  const categoryFolderId =
    category === 'documentation'
      ? process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID
      : process.env.GOOGLE_DRIVE_FILE_IBADAH_FOLDER_ID;

  if (!categoryFolderId) {
    throw new Error('Konfigurasi Root Folder ID Google Drive tidak ditemukan.');
  }

  const categoryName = category === 'documentation' ? 'Dokumentasi' : 'File Ibadah';
  
  // Parse quarter string like 'Triwulan III'
  const quarters = ['Triwulan I', 'Triwulan II', 'Triwulan III', 'Triwulan IV'];
  const quarterTitle = quarters[quarter - 1] || `Triwulan ${quarter}`;

  // 1. Ensure Year folder
  const yearRes = await ensureFolder(categoryFolderId, year.toString());

  // 2. Ensure Quarter folder
  const quarterRes = await ensureFolder(yearRes.id, quarterTitle);

  // 3. Ensure Activity Folder
  const activityRes = await ensureFolder(quarterRes.id, title);

  const folderPath = `GMAHK Galilea/${categoryName}/${year}/${quarterTitle}/${title}`;

  return {
    folderId: activityRes.id,
    folderPath,
  };
}

/**
 * Moves a file or folder to Google Drive Trash (Admin only action)
 */
export async function moveToTrash(fileId: string): Promise<boolean> {
  const drive = getGoogleDriveClient();
  if (!drive) {
    throw new Error('Google Drive client is not authenticated');
  }

  try {
    await drive.files.update({
      fileId,
      requestBody: {
        trashed: true,
      },
    });
    return true;
  } catch (err) {
    console.error(`Error trashing file ${fileId}:`, err);
    return false;
  }
}

/**
 * Uploads a file stream directly to a Google Drive folder (Old method, synchronous)
 */
export async function uploadFileToDrive(params: {
  folderId: string;
  name: string;
  mimeType: string;
  stream: Readable;
}): Promise<{ id: string; webViewLink?: string; webContentLink?: string; size?: number }> {
  const drive = getGoogleDriveClient();
  if (!drive) {
    throw new DriveError('AUTH_ERROR', 'Google Drive client tidak terautentikasi. Kredensial User OAuth tidak ditemukan.', 401);
  }

  try {
    const res = await drive.files.create({
      requestBody: {
        name: params.name,
        parents: [params.folderId],
      },
      media: {
        mimeType: params.mimeType,
        body: params.stream,
      },
      fields: 'id, name, webViewLink, webContentLink, size',
    });

    return {
      id: res.data.id || '',
      webViewLink: res.data.webViewLink || undefined,
      webContentLink: res.data.webContentLink || undefined,
      size: res.data.size ? parseInt(res.data.size, 10) : undefined,
    };
  } catch (err) {
    throw classifyDriveError(err);
  }
}

/**
 * Creates a resumable upload session and returns the session URL.
 */
export async function createResumableUploadSession(params: {
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
}): Promise<string> {
  const drive = getGoogleDriveClient();
  if (!drive) {
    throw new DriveError('AUTH_ERROR', 'Google Drive client tidak terautentikasi.', 401);
  }

  const auth = drive.context._options.auth as unknown as { getAccessToken?: () => Promise<string | { token?: string | null }> };
  let token: string | null = null;
  if (auth && auth.getAccessToken) {
    const res = await auth.getAccessToken();
    token = typeof res === 'string' ? res : (res?.token || null);
  }
  
  if (!token) {
    throw new DriveError('AUTH_ERROR', 'Tidak bisa mendapatkan access token dari Google API client.', 401);
  }

  const metadata = {
    name: params.name,
    parents: [params.folderId],
  };

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': params.mimeType,
      'X-Upload-Content-Length': params.size.toString(),
    },
    body: JSON.stringify(metadata)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new DriveError('API_ERROR', `Gagal membuat sesi upload: ${response.statusText}. Detail: ${text}`, response.status);
  }

  const sessionUrl = response.headers.get('Location');
  if (!sessionUrl) {
    throw new DriveError('API_ERROR', 'Tidak mendapatkan URL sesi (Location header) dari Google Drive', 500);
  }

  return sessionUrl;
}

/**
 * Finds an existing file by name inside a parent folder
 */
export async function findFileByName(
  parentFolderId: string,
  fileName: string
): Promise<string | null> {
  const drive = getGoogleDriveClient();
  if (!drive) return null;

  try {
    const escapedName = fileName.replace(/'/g, "\\'");
    const res = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${escapedName}' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    const files = res.data.files;
    if (files && files.length > 0 && files[0].id) {
      return files[0].id;
    }
    return null;
  } catch (err) {
    console.error(`Error finding file ${fileName} in ${parentFolderId}:`, err);
    return null;
  }
}

/**
 * Returns a non-colliding file name inside the parent folder.
 * If 'file.jpg' exists, returns 'file (1).jpg', 'file (2).jpg', etc.
 */
export async function getNonCollidingFileName(
  parentFolderId: string,
  fileName: string
): Promise<string> {
  let candidate = fileName;
  let counter = 1;

  while (await findFileByName(parentFolderId, candidate)) {
    const dotIdx = fileName.lastIndexOf('.');
    if (dotIdx !== -1) {
      const base = fileName.substring(0, dotIdx);
      const ext = fileName.substring(dotIdx);
      candidate = `${base} (${counter})${ext}`;
    } else {
      candidate = `${fileName} (${counter})`;
    }
    counter++;
    if (counter > 50) break;
  }

  return candidate;
}

/**
 * Strictly resolves and ensures the managed Sabbath archive destination folder:
 * GMAHK Galilea/
 * └── Dokumentasi atau File Ibadah/
 *     └── Year (e.g. 2026)/
 *         └── Quarter (e.g. Triwulan III)/
 *             └── Sabbath (e.g. 12 September 2026)/
 *
 * This guarantees boundary protection:
 * - Only managed root folders are used
 * - Client cannot supply an arbitrary folder ID
 * - Folders are ensured idempotently
 */
export async function resolveSabbathDestinationFolder(
  category: ArchiveCategory,
  sabbathDate: string
): Promise<{
  folderId: string;
  folderPath: string;
  year: number;
  quarter: number;
  quarterTitle: string;
  sabbathTitle: string;
  isExisting: boolean;
}> {
  if (!isValidSabbathDate(sabbathDate)) {
    throw new Error(`Tanggal '${sabbathDate}' bukan hari Sabat yang valid.`);
  }

  const { year, quarter, quarterTitle, formattedTitle } = parseSabbathDetails(sabbathDate);
  const categoryFolderId =
    category === 'documentation'
      ? (process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID || 'managed_dok_root')
      : (process.env.GOOGLE_DRIVE_FILE_IBADAH_FOLDER_ID || 'managed_ibadah_root');

  const categoryName = category === 'documentation' ? 'Dokumentasi' : 'File Ibadah';

  // 1. Ensure Year folder (e.g. 2026) under category root
  const yearRes = await ensureFolder(categoryFolderId, year.toString());

  // 2. Ensure Quarter folder (e.g. Triwulan III) under Year
  const quarterRes = await ensureFolder(yearRes.id, quarterTitle);

  // 3. Ensure Sabbath folder (e.g. 12 September 2026) under Quarter
  const sabbathRes = await ensureFolder(quarterRes.id, formattedTitle);

  const folderPath = `GMAHK Galilea/${categoryName}/${year}/${quarterTitle}/${formattedTitle}`;

  return {
    folderId: sabbathRes.id,
    folderPath,
    year,
    quarter,
    quarterTitle,
    sabbathTitle: formattedTitle,
    isExisting: sabbathRes.isExisting,
  };
}

/**
 * Accurately determines file format category based on mimeType and extension
 */
export function determineFileType(mimeType: string, filename: string): FileFormatType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg'].includes(ext)) {
    return 'photo';
  }
  if (mimeType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp'].includes(ext)) {
    return 'video';
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    ext === 'ppt' ||
    ext === 'pptx' ||
    ext === 'key' ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint')
  ) {
    return 'presentation';
  }
  if (
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'txt' ||
    ext === 'rtf' ||
    mimeType.includes('word') ||
    mimeType.includes('document')
  ) {
    return 'document';
  }
  if (
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv' ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel')
  ) {
    return 'spreadsheet';
  }
  return 'other';
}

const INDO_MONTH_MAP: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, pebruari: 2, feb: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, ags: 8, aug: 8,
  september: 9, sep: 9,
  oktober: 10, okt: 10, oct: 10,
  november: 11, nopember: 11, nov: 11,
  desember: 12, des: 12, dec: 12,
};

/**
 * Parses Indonesian date folder names into ISO YYYY-MM-DD
 * Examples: '12 September 2026', 'Sabat, 12 September 2026', '2026-09-12'
 */
export function parseIndonesianDateStringToIso(str: string): string | null {
  if (!str) return null;
  const trimmed = str.trim();

  // 1. ISO format: YYYY-MM-DD
  const isoMatch = trimmed.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. Indonesian word format: e.g. "12 September 2026" or "Sabat, 12 September 2026"
  const wordMatch = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/);
  if (wordMatch) {
    const day = parseInt(wordMatch[1], 10);
    const mStr = wordMatch[2].toLowerCase();
    const year = parseInt(wordMatch[3], 10);
    const month = INDO_MONTH_MAP[mStr];
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 3. DD-MM-YYYY or DD/MM/YYYY
  const slashMatch = trimmed.match(/(\d{1,2})[-/](\d{1,2})[-/](20\d{2})/);
  if (slashMatch) {
    const d = parseInt(slashMatch[1], 10);
    const m = parseInt(slashMatch[2], 10);
    const y = parseInt(slashMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Parses quarter number (1..4) from folder names like 'Triwulan I', 'Triwulan 3', etc.
 */
export function parseQuarterFromFolderName(name: string): number | null {
  if (!name) return null;
  const n = name.trim().toUpperCase();
  if (n.includes('TRIWULAN IV') || n.includes('TRIWULAN 4') || n.includes('Q4') || n.includes('T4')) return 4;
  if (n.includes('TRIWULAN III') || n.includes('TRIWULAN 3') || n.includes('Q3') || n.includes('T3')) return 3;
  if (n.includes('TRIWULAN II') || n.includes('TRIWULAN 2') || n.includes('Q2') || n.includes('T2')) return 2;
  if (n.includes('TRIWULAN I') || n.includes('TRIWULAN 1') || n.includes('Q1') || n.includes('T1')) return 1;
  return null;
}

export interface DiscoverArchiveTreeParams {
  category?: ArchiveCategory;
  year?: number;
  quarter?: number;
  sabbath?: string;
}

export interface DiscoveredArchiveTreeResult {
  availableYears: number[];
  selectedYear: number;
  quarters: Array<{ quarter: number; title: string; folderId?: string }>;
  selectedQuarter: number;
  sabbaths: SabbathInfo[];
  selectedSabbath: string;
  files: FileItem[];
}

/**
 * Dynamically discovers the real Google Drive folder hierarchy:
 * Category Root -> Year Folders -> Quarter Folders -> Sabbath & Activity Folders -> Real Files
 * Uses Google Drive as ground truth, gracefully integrates Firestore metadata,
 * and ensures active Sabbath always points to the nearest active Sabbath in WITA.
 */
export async function discoverArchiveTree(
  params: DiscoverArchiveTreeParams = {}
): Promise<DiscoveredArchiveTreeResult> {
  const targetCategory: ArchiveCategory = params.category || 'documentation';
  const cacheKey = `tree:${targetCategory}:${params.year || 'auto'}:${params.quarter || 'auto'}:${params.sabbath || 'auto'}`;
  const cachedTree = driveCache.get<DiscoveredArchiveTreeResult>(cacheKey);
  if (cachedTree) {
    return cachedTree;
  }

  const nearest = getNearestSabbath();
  const todayStr = getWitaDateParts().dateStr;

  const drive = getGoogleDriveClient();
  if (!drive) {
    // Offline / dev fallback when no Google credentials configured
    const selectedYear = params.year || nearest.year;
    const selectedQuarter = params.quarter || nearest.quarter;
    const availableYears = [selectedYear, selectedYear - 1];
    const quarters = [1, 2, 3, 4].map((q) => ({
      quarter: q,
      title: getQuarterTitle(q),
    }));
    const sabbaths = getSabbathsInQuarter(selectedYear, selectedQuarter);
    let activeSabbath = params.sabbath || '';
    if (!activeSabbath) {
      if (selectedYear === nearest.year && selectedQuarter === nearest.quarter) {
        activeSabbath = nearest.date;
      } else {
        activeSabbath = sabbaths.length > 0 ? sabbaths[0].date : '';
      }
    }
    let files: FileItem[] = [];
    if (process.env.NODE_ENV !== 'test') {
      try {
        const { getFilesBySabbath } = await import('./firestore');
        files = await getFilesBySabbath(activeSabbath, targetCategory);
      } catch {
        files = [];
      }
    }
    return {
      availableYears,
      selectedYear,
      quarters,
      selectedQuarter,
      sabbaths,
      selectedSabbath: activeSabbath,
      files,
    };
  }

  // 1. Identify Category Root Folder in Google Drive
  let categoryFolderId =
    targetCategory === 'documentation'
      ? process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID?.trim()
      : process.env.GOOGLE_DRIVE_FILE_IBADAH_FOLDER_ID?.trim();

  // If specific category folder ID is not explicitly set, search inside root folder
  if (!categoryFolderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim()) {
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID.trim();
    const targetName = targetCategory === 'documentation' ? 'Dokumentasi' : 'File Ibadah';
    categoryFolderId = (await findFolderByName(rootId, targetName)) || undefined;
  }

  // 2. Discover Available Years in Google Drive
  const yearFoldersMap = new Map<number, string>();
  if (categoryFolderId) {
    try {
      const yearsRes = await drive.files.list({
        q: `'${categoryFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 100,
      });
      for (const f of yearsRes.data.files || []) {
        if (f.id && f.name) {
          const m = f.name.match(/\b(20\d{2})\b/);
          if (m) {
            yearFoldersMap.set(parseInt(m[1], 10), f.id);
          }
        }
      }
    } catch (err) {
      console.error('[Drive] Error listing year folders:', err);
    }
  }

  // Guarantee current year is at least present
  if (!yearFoldersMap.has(nearest.year)) {
    yearFoldersMap.set(nearest.year, '');
  }

  const availableYears = Array.from(yearFoldersMap.keys()).sort((a, b) => b - a);

  // Determine Selected Year
  let selectedYear = params.year;
  if (!selectedYear || !availableYears.includes(selectedYear)) {
    selectedYear = availableYears.includes(nearest.year) ? nearest.year : availableYears[0];
  }

  let selectedYearFolderId = yearFoldersMap.get(selectedYear);
  if ((!selectedYearFolderId || selectedYearFolderId === '') && categoryFolderId) {
    selectedYearFolderId = (await findFolderByName(categoryFolderId, selectedYear.toString())) || undefined;
  }

  // 3. Discover Quarters for Selected Year
  const quarterFoldersMap = new Map<number, { id: string; name: string }>();
  if (selectedYearFolderId) {
    try {
      const qRes = await drive.files.list({
        q: `'${selectedYearFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 50,
      });
      for (const f of qRes.data.files || []) {
        if (f.id && f.name) {
          const qNum = parseQuarterFromFolderName(f.name);
          if (qNum) {
            quarterFoldersMap.set(qNum, { id: f.id, name: f.name });
          }
        }
      }
    } catch (err) {
      console.error('[Drive] Error listing quarter folders:', err);
    }
  }

  const quarters = [1, 2, 3, 4].map((q) => {
    const discovered = quarterFoldersMap.get(q);
    return {
      quarter: q,
      title: discovered ? discovered.name : getQuarterTitle(q),
      folderId: discovered?.id,
    };
  });

  // Determine Selected Quarter
  let selectedQuarter = params.quarter;
  if (!selectedQuarter || selectedQuarter < 1 || selectedQuarter > 4) {
    if (selectedYear === nearest.year) {
      selectedQuarter = nearest.quarter;
    } else if (quarterFoldersMap.size > 0) {
      selectedQuarter = Math.max(...quarterFoldersMap.keys());
    } else {
      selectedQuarter = 1;
    }
  }

  let selectedQuarterFolderId = quarterFoldersMap.get(selectedQuarter)?.id;
  if (!selectedQuarterFolderId && selectedYearFolderId) {
    selectedQuarterFolderId = (await findFolderByName(selectedYearFolderId, getQuarterTitle(selectedQuarter))) || undefined;
  }

  // 4. Discover Sabbaths & Activity Folders in Quarter
  const discoveredSabbathsMap = new Map<string, { id: string; name: string }>();
  const customFolders: Array<{ id: string; name: string }> = [];

  if (selectedQuarterFolderId) {
    try {
      const sRes = await drive.files.list({
        q: `'${selectedQuarterFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 100,
      });
      for (const f of sRes.data.files || []) {
        if (f.id && f.name) {
          const iso = parseIndonesianDateStringToIso(f.name);
          if (iso) {
            discoveredSabbathsMap.set(iso, { id: f.id, name: f.name });
          } else {
            customFolders.push({ id: f.id, name: f.name });
          }
        }
      }
    } catch (err) {
      console.error('[Drive] Error listing sabbath folders:', err);
    }
  }

  // Merge with standard calculated Sabbaths for this quarter
  const standardSabbaths = getSabbathsInQuarter(selectedYear, selectedQuarter);
  const sabbaths: SabbathInfo[] = standardSabbaths.map((sab) => {
    const discovered = discoveredSabbathsMap.get(sab.date);
    return {
      ...sab,
      documentationFolderId: targetCategory === 'documentation' ? discovered?.id : undefined,
      worshipFolderId: targetCategory === 'worship' ? discovered?.id : undefined,
    };
  });

  // Add any discovered date folders not in standard Saturdays
  for (const [isoDate, folder] of discoveredSabbathsMap.entries()) {
    if (!sabbaths.some((s) => s.date === isoDate)) {
      const [y, m] = isoDate.split('-').map(Number);
      const q = getQuarterFromMonth(m);
      sabbaths.push({
        date: isoDate,
        formattedTitle: formatSabbathTitle(isoDate),
        year: y,
        quarter: q,
        quarterTitle: getQuarterTitle(q),
        isPast: isoDate < todayStr,
        isToday: isoDate === todayStr,
        isUpcoming: isoDate >= todayStr,
        documentationFolderId: targetCategory === 'documentation' ? folder.id : undefined,
        worshipFolderId: targetCategory === 'worship' ? folder.id : undefined,
      });
    }
  }

  // Add custom activity folders (e.g. 'Kegiatan Khusus')
  for (const cf of customFolders) {
    sabbaths.push({
      date: cf.name,
      formattedTitle: cf.name,
      year: selectedYear,
      quarter: selectedQuarter,
      quarterTitle: getQuarterTitle(selectedQuarter),
      isPast: false,
      isToday: false,
      isUpcoming: false,
      documentationFolderId: targetCategory === 'documentation' ? cf.id : undefined,
      worshipFolderId: targetCategory === 'worship' ? cf.id : undefined,
    });
  }

  // Sort sabbaths chronologically, custom folders follow
  sabbaths.sort((a, b) => {
    const aIsDate = /^\d{4}-\d{2}-\d{2}$/.test(a.date);
    const bIsDate = /^\d{4}-\d{2}-\d{2}$/.test(b.date);
    if (aIsDate && bIsDate) return a.date.localeCompare(b.date);
    if (aIsDate && !bIsDate) return -1;
    if (!aIsDate && bIsDate) return 1;
    return a.formattedTitle.localeCompare(b.formattedTitle);
  });

  // 5. Determine Active Sabbath
  let activeSabbath = '';
  if (params.sabbath) {
    const matched = sabbaths.find(
      (s) => s.date === params.sabbath || s.formattedTitle === params.sabbath
    );
    if (matched) {
      activeSabbath = matched.date;
    }
  }

  if (!activeSabbath) {
    if (selectedYear === nearest.year && selectedQuarter === nearest.quarter) {
      // Current active quarter: auto-select nearest Sabbath in WITA
      const nearestInQuarter = sabbaths.find((s) => s.date === nearest.date);
      activeSabbath = nearestInQuarter ? nearestInQuarter.date : nearest.date;
    } else {
      // Previous or future quarter: pick latest folder with Drive presence, or first
      const withDriveFolder = sabbaths.filter((s) =>
        targetCategory === 'documentation' ? s.documentationFolderId : s.worshipFolderId
      );
      if (withDriveFolder.length > 0) {
        activeSabbath = withDriveFolder[withDriveFolder.length - 1].date;
      } else if (sabbaths.length > 0) {
        activeSabbath = sabbaths[0].date;
      }
    }
  }

  // 6. Query Files for Active Sabbath directly from Google Drive
  let activeFolderId: string | undefined;
  const activeSabObj = sabbaths.find((s) => s.date === activeSabbath);
  if (activeSabObj) {
    activeFolderId =
      targetCategory === 'documentation'
        ? activeSabObj.documentationFolderId
        : activeSabObj.worshipFolderId;
  }

  if (!activeFolderId && selectedQuarterFolderId && activeSabObj) {
    // Search folder by title in Drive
    activeFolderId = (await findFolderByName(selectedQuarterFolderId, activeSabObj.formattedTitle)) || undefined;
    if (!activeFolderId && activeSabObj.formattedTitle.includes('Sabat, ')) {
      const clean = activeSabObj.formattedTitle.replace('Sabat, ', '');
      activeFolderId = (await findFolderByName(selectedQuarterFolderId, clean)) || undefined;
    }
  }

  let driveFiles: FileItem[] = [];
  if (activeFolderId) {
    try {
      const fRes = await drive.files.list({
        q: `'${activeFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, mimeType, size, webViewLink, webContentLink, thumbnailLink, createdTime)',
        spaces: 'drive',
        pageSize: 100,
        orderBy: 'name asc',
      });

      driveFiles = (fRes.data.files || []).map((f) => ({
        id: f.id || '',
        name: f.name || 'Berkas Galilea',
        mimeType: f.mimeType || 'application/octet-stream',
        size: parseInt(f.size || '0', 10),
        category: targetCategory,
        fileType: determineFileType(f.mimeType || '', f.name || ''),
        sabbathDate: activeSabbath,
        sabbathTitle: activeSabObj?.formattedTitle || activeSabbath,
        year: selectedYear,
        quarter: selectedQuarter,
        folderId: activeFolderId!,
        thumbnailUrl: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+/, '=s800') : undefined,
        webViewLink: f.webViewLink || undefined,
        webContentLink: f.webContentLink || undefined,
        uploadedAt: f.createdTime || new Date().toISOString(),
        isRandomEligible: true,
      }));
    } catch (err) {
      console.error('[Drive] Error listing files in sabbath folder:', err);
    }
  }

  // Merge with Firestore if indexed
  let firestoreFiles: FileItem[] = [];
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { getFilesBySabbath } = await import('./firestore');
      firestoreFiles = await getFilesBySabbath(activeSabbath, targetCategory);
    } catch {
      firestoreFiles = [];
    }
  }

  const fileMap = new Map<string, FileItem>();
  for (const ff of firestoreFiles) {
    fileMap.set(ff.id, ff);
  }
  for (const df of driveFiles) {
    const existing = fileMap.get(df.id);
    if (existing) {
      fileMap.set(df.id, {
        ...existing,
        thumbnailUrl: df.thumbnailUrl || existing.thumbnailUrl,
        webViewLink: df.webViewLink || existing.webViewLink,
        webContentLink: df.webContentLink || existing.webContentLink,
        size: df.size || existing.size,
      });
    } else {
      fileMap.set(df.id, df);
    }
  }

  const files = Array.from(fileMap.values());

  const result: DiscoveredArchiveTreeResult = {
    availableYears,
    selectedYear,
    quarters,
    selectedQuarter,
    sabbaths,
    selectedSabbath: activeSabbath,
    files,
  };

  driveCache.set(cacheKey, result, 60); // Cache for 60 seconds

  return result;
}

/**
 * Fetches random images or videos directly from Google Drive for homepage showcase
 */
export async function getRandomFilesFromDrive(count: number = 6): Promise<FileItem[]> {
  try {
    const drive = getGoogleDriveClient();
    if (!drive) return [];

    const tree = await discoverArchiveTree({ category: 'documentation' });
    let eligible: FileItem[] = [];

    // Sort sabbaths from newest to oldest
    const sortedSabbaths = [...tree.sabbaths].sort((a, b) => b.date.localeCompare(a.date));

    for (const sab of sortedSabbaths) {
      if (eligible.length >= count) break;
      if (!sab.documentationFolderId) continue;

      const folderFilesCacheKey = `sabbath_files:${sab.documentationFolderId}`;
      let files = driveCache.get<FileItem[]>(folderFilesCacheKey);

      if (!files) {
        try {
          const fRes = await drive.files.list({
            q: `'${sab.documentationFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name, mimeType, size, webViewLink, webContentLink, thumbnailLink, createdTime)',
            spaces: 'drive',
            pageSize: 20,
          });

          files = (fRes.data.files || []).map((f) => ({
            id: f.id || '',
            name: f.name || 'Berkas Galilea',
            mimeType: f.mimeType || 'application/octet-stream',
            size: parseInt(f.size || '0', 10),
            category: 'documentation' as ArchiveCategory,
            fileType: determineFileType(f.mimeType || '', f.name || ''),
            sabbathDate: sab.date,
            sabbathTitle: sab.formattedTitle,
            year: sab.year,
            quarter: sab.quarter,
            folderId: sab.documentationFolderId!,
            thumbnailUrl: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+/, '=s800') : undefined,
            webViewLink: f.webViewLink || undefined,
            webContentLink: f.webContentLink || undefined,
            uploadedAt: f.createdTime || new Date().toISOString(),
            isRandomEligible: true,
          }));

          driveCache.set(folderFilesCacheKey, files, 60); // Cache for 60 seconds
        } catch (err) {
          console.warn(`[Drive] Error fetching files for sabbath ${sab.date}:`, err);
          files = [];
        }
      }

      const photosAndVideos = files.filter(f => f.fileType === 'photo' || f.fileType === 'video');
      eligible = [...eligible, ...photosAndVideos];
    }

    if (eligible.length > 0) {
      return eligible.sort(() => 0.5 - Math.random()).slice(0, count);
    }
  } catch (err) {
    console.warn('[Drive] getRandomFilesFromDrive fallback failed:', err);
  }
  return [];
}


/**
 * Global Managed-Folder Validator
 * Ensures a file belongs to either GMAHK Galilea/Dokumentasi or GMAHK Galilea/File Ibadah.
 */
export async function isFileInManagedArchive(fileId: string): Promise<boolean> {
  const drive = getGoogleDriveClient();
  if (!drive) return false;

  const validRoots = [
    process.env.GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID,
    process.env.GOOGLE_DRIVE_FILE_IBADAH_FOLDER_ID,
  ].filter(Boolean);

  if (validRoots.length === 0) return false;

  try {
    let currentId = fileId;
    let depth = 0;
    
    while (depth < 10) {
      const parentCacheKey = `parent:${currentId}`;
      let parents = driveCache.get<string[]>(parentCacheKey);

      if (!parents) {
        const res = await drive.files.get({
          fileId: currentId,
          fields: 'id, parents',
        });
        parents = res.data.parents || [];
        if (parents.length > 0) {
          driveCache.set(parentCacheKey, parents, 600); // Cache parent relations for 10 minutes
        }
      }

      if (!parents || parents.length === 0) {
        return false;
      }
      
      for (const parentId of parents) {
        if (validRoots.includes(parentId)) {
          return true;
        }
      }
      
      currentId = parents[0];
      depth++;
    }
    
    return false;
  } catch (err) {
    console.error('Error validating managed archive boundary for', fileId, err);
    return false;
  }
}
