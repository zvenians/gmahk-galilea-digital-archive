export type UserRole = 'admin' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  createdAt: string;
  lastLogin: string;
}

export type ArchiveCategory = 'documentation' | 'worship';

export type FileFormatType =
  | 'photo'
  | 'video'
  | 'pdf'
  | 'presentation'
  | 'document'
  | 'spreadsheet'
  | 'other';

export interface FileItem {
  id: string; // Google Drive File ID
  name: string;
  mimeType: string;
  size: number;
  category: ArchiveCategory;
  fileType: FileFormatType;
  sabbathDate: string; // e.g. '2026-09-12'
  sabbathTitle: string; // e.g. '12 September 2026'
  year: number;
  quarter: number; // 1..4
  folderId: string;
  thumbnailUrl?: string; // Runtime internal proxy URL; never persisted as a Drive thumbnailLink.
  webViewLink?: string;
  webContentLink?: string;
  uploadedBy?: string;
  uploadedAt: string;
  isRandomEligible: boolean;
}

export interface SabbathInfo {
  date: string; // YYYY-MM-DD
  formattedTitle: string; // e.g. '12 September 2026'
  year: number;
  quarter: number;
  quarterTitle: string; // 'Triwulan I' .. 'Triwulan IV'
  isPast: boolean;
  isToday: boolean;
  isUpcoming: boolean;
  documentationFolderId?: string;
  worshipFolderId?: string;
  fileCount?: {
    documentation: number;
    worship: number;
    total: number;
  };
}

export interface QuarterInfo {
  year: number;
  quarter: number; // 1..4
  title: string; // 'Triwulan I' .. 'Triwulan IV'
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  sabbaths: SabbathInfo[];
}

export interface ActivityItem {
  id: string;
  title: string; // e.g. 'KKR Pemuda - 19 September 2026'
  date: string;
  year: number;
  quarter: number;
  category: ArchiveCategory;
  folderId?: string;
  createdBy: string;
  createdAt: string;
}

export interface SystemLog {
  id: string;
  type: 'AUTH' | 'UPLOAD' | 'DELETE' | 'AUTOMATION' | 'SECURITY_ALERT';
  message: string;
  userId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationStatus {
  lastRun: string;
  status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' | 'AUTHENTICATION_REQUIRED' | 'READY';
  details: string;
  createdFoldersCount: number;
  logs?: string[];
  error?: string;
}
