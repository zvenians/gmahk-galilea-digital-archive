import { getAdminFirestore } from './firebase-admin';
import { withArchiveMediaUrls } from './archive-media';
import { ActivityItem, ArchiveCategory, FileItem, SystemLog, AutomationStatus } from './types';
import { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getDriveAuthInfo, getGoogleDriveClient, classifyDriveError } from './drive';

/**
 * Indexes a new file in Firestore
 */
export async function indexFile(file: FileItem, userToken?: string): Promise<void> {
  // Store durable metadata only; legacy URLs are normalized on reads.
  const metadata = { ...file };
  delete metadata.thumbnailUrl;
  const db = getAdminFirestore();
  let adminError: unknown;
  if (db) {
    try {
      await db.collection('fileIndex').doc(file.id).set(metadata);
      return;
    } catch (err) {
      adminError = err;
      console.warn('[Firestore Admin] Index file failed:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback: Write via Firestore REST API with user's Firebase ID token
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    'gmahk-galilea-archive';

  if (userToken) {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fileIndex/${encodeURIComponent(file.id)}`;
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(metadata)) {
        if (typeof v === 'string') fields[k] = { stringValue: v };
        else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
        else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      });
      if (res.ok) {
        return;
      }
      const detail = await res.text();
      throw new Error(`Firestore REST menolak indeks (${res.status}): ${detail.slice(0, 300)}`);
    } catch (restErr) {
      console.warn('[Firestore REST] Error indexing file:', restErr);
      throw restErr;
    }
  }

  if (adminError) {
    throw adminError;
  }
  throw new Error('Firestore Admin tidak tersedia dan token pengguna tidak diberikan.');
}

/**
 * Retrieves files for a specific Sabbath and category
 */
export async function getFilesBySabbath(
  sabbathDate: string,
  category?: ArchiveCategory
): Promise<FileItem[]> {
  try {
    const db = getAdminFirestore();
    if (db) {
      let query: Query = db
        .collection('fileIndex')
        .where('sabbathDate', '==', sabbathDate);
      if (category) {
        query = query.where('category', '==', category);
      }
      const snap = await query.get();
      if (!snap.empty) {
        return snap.docs.map((d: QueryDocumentSnapshot) => withArchiveMediaUrls(d.data() as FileItem));
      }
    }
  } catch (err) {
    console.warn('Firestore getFilesBySabbath (Admin) failed:', err instanceof Error ? err.message : err);
  }

  // Fallback: Query via Firestore REST API with API key
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'gmahk-galilea-archive';
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (apiKey) {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'fileIndex' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'sabbathDate' },
              op: 'EQUAL',
              value: { stringValue: sabbathDate },
            },
          },
        },
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryBody),
      });
      if (res.ok) {
        const rows = await res.json();
        const items: FileItem[] = [];
        for (const row of rows) {
          if (row.document?.fields) {
            const f = row.document.fields;
            items.push({
              id: f.id?.stringValue || row.document.name.split('/').pop() || '',
              name: f.name?.stringValue || '',
              mimeType: f.mimeType?.stringValue || '',
              size: parseInt(f.size?.integerValue || '0', 10),
              category: (f.category?.stringValue as ArchiveCategory) || 'documentation',
              fileType: (f.fileType?.stringValue as FileItem['fileType']) || 'photo',
              sabbathDate: f.sabbathDate?.stringValue || sabbathDate,
              sabbathTitle: f.sabbathTitle?.stringValue || '',
              year: parseInt(f.year?.integerValue || sabbathDate.slice(0, 4) || String(new Date().getFullYear()), 10),
              quarter: parseInt(f.quarter?.integerValue || '3', 10),
              folderId: f.folderId?.stringValue || '',
              webViewLink: f.webViewLink?.stringValue,
              webContentLink: f.webContentLink?.stringValue,
              uploadedBy: f.uploadedBy?.stringValue,
              uploadedAt: f.uploadedAt?.stringValue || '',
              isRandomEligible: f.isRandomEligible?.booleanValue ?? true,
            });
          }
        }
        if (category) {
          return items.filter((i) => i.category === category).map(withArchiveMediaUrls);
        }
        return items.map(withArchiveMediaUrls);
      }
    }
  } catch (e) {
    console.warn('Firestore REST getFilesBySabbath failed:', e);
  }

  return [];
}

/**
 * Retrieves random photos and videos for the homepage without scanning all of Drive
 */
export async function getRandomArchiveSample(limitCount: number = 6): Promise<FileItem[]> {
  try {
    const db = getAdminFirestore();
    if (db) {
      const snap = await db
        .collection('fileIndex')
        .where('isRandomEligible', '==', true)
        .limit(limitCount * 2)
        .get();
      const all = snap.docs.map((d: QueryDocumentSnapshot) => withArchiveMediaUrls(d.data() as FileItem));
      const eligible = all.filter((item) =>
        item.category === 'documentation' &&
        (item.fileType === 'photo' || item.fileType === 'video')
      );
      if (eligible.length > 0) {
        return eligible.sort(() => 0.5 - Math.random()).slice(0, limitCount);
      }
    }
  } catch (err) {
    console.warn('Firestore getRandomArchiveSample (Admin) failed:', err instanceof Error ? err.message : err);
  }

  // Fallback: Query via Firestore REST API with API key
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'gmahk-galilea-archive';
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (apiKey) {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fileIndex?key=${apiKey}&pageSize=${limitCount * 2}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const documents = data.documents || [];
        const items: FileItem[] = [];
        for (const doc of documents) {
          const f = doc.fields;
          if (f) {
            items.push({
              id: f.id?.stringValue || doc.name.split('/').pop() || '',
              name: f.name?.stringValue || '',
              mimeType: f.mimeType?.stringValue || '',
              size: parseInt(f.size?.integerValue || '0', 10),
              category: (f.category?.stringValue as ArchiveCategory) || 'documentation',
              fileType: (f.fileType?.stringValue as FileItem['fileType']) || 'photo',
              sabbathDate: f.sabbathDate?.stringValue || '',
              sabbathTitle: f.sabbathTitle?.stringValue || '',
              year: parseInt(f.year?.integerValue || (f.sabbathDate?.stringValue || '').slice(0, 4) || String(new Date().getFullYear()), 10),
              quarter: parseInt(f.quarter?.integerValue || '3', 10),
              folderId: f.folderId?.stringValue || '',
              webViewLink: f.webViewLink?.stringValue,
              webContentLink: f.webContentLink?.stringValue,
              uploadedBy: f.uploadedBy?.stringValue,
              uploadedAt: f.uploadedAt?.stringValue || '',
              isRandomEligible: f.isRandomEligible?.booleanValue ?? true,
            });
          }
        }
        const eligibleItems = items.filter((item) =>
          item.category === 'documentation' &&
          item.isRandomEligible &&
          (item.fileType === 'photo' || item.fileType === 'video')
        );
        if (eligibleItems.length > 0) {
          return eligibleItems.sort(() => 0.5 - Math.random()).slice(0, limitCount).map(withArchiveMediaUrls);
        }
      }
    }
  } catch (e) {
    console.warn('Firestore REST getRandomArchiveSample failed:', e);
  }

  return [];
}

/**
 * Creates and records a new activity
 */
export async function createActivity(activity: ActivityItem): Promise<void> {
  try {
    const db = getAdminFirestore();
    if (db) {
      await db.collection('activities').doc(activity.id).set(activity);
    }
  } catch (err) {
    console.warn('Firestore createActivity failed:', err);
  }
}

/**
 * Lists activities
 */
export async function getActivities(): Promise<ActivityItem[]> {
  try {
    const db = getAdminFirestore();
    if (db) {
      const snap = await db.collection('activities').orderBy('createdAt', 'desc').limit(20).get();
      if (!snap.empty) {
        return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as ActivityItem);
      }
    }
  } catch (err) {
    console.warn('Firestore getActivities failed:', err);
  }
  return [];
}

/**
 * Logs an administrative or security event
 */
export async function logSystemEvent(log: Omit<SystemLog, 'id' | 'timestamp'>): Promise<void> {
  const entry: SystemLog = {
    ...log,
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
  };

  try {
    const db = getAdminFirestore();
    if (db) {
      await db.collection('systemLogs').doc(entry.id).set(entry);
    }
  } catch (err) {
    console.warn('Firestore logSystemEvent failed:', err);
  }
}

/**
 * Retrieves recent system audit logs
 */
export async function getSystemLogs(limitCount: number = 20): Promise<SystemLog[]> {
  try {
    const db = getAdminFirestore();
    if (db) {
      const snap = await db.collection('systemLogs').orderBy('timestamp', 'desc').limit(limitCount).get();
      if (!snap.empty) {
        return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as SystemLog);
      }
    }
  } catch (err) {
    console.warn('Firestore getSystemLogs failed:', err);
  }
  return [];
}

/**
 * Retrieves automation status with live OAuth token verification
 */
export async function getAutomationStatus(): Promise<AutomationStatus> {
  try {
    const db = getAdminFirestore();
    if (db) {
      const doc = await db.collection('automationStatus').doc('latest').get();
      if (doc.exists) {
        return doc.data() as AutomationStatus;
      }
    }
  } catch (err) {
    console.warn('Firestore getAutomationStatus failed:', err);
  }

  const driveInfo = getDriveAuthInfo();
  if (!driveInfo.isAuthenticated) {
    return {
      lastRun: new Date().toISOString(),
      status: 'AUTHENTICATION_REQUIRED',
      details: 'Google Drive belum terhubung. Kredensial User OAuth (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN) belum lengkap.',
      createdFoldersCount: 0,
    };
  }

  // Live lightweight read to verify OAuth token
  const drive = getGoogleDriveClient();
  if (drive) {
    try {
      await drive.files.list({
        pageSize: 1,
        fields: 'files(id)',
        spaces: 'drive',
      });
      return {
        lastRun: new Date().toISOString(),
        status: 'READY',
        details: `Google Drive terhubung dan terverifikasi aktif (${driveInfo.targetStorage}). Otomasi siap dijalankan.`,
        createdFoldersCount: 0,
      };
    } catch (testErr) {
      const classified = classifyDriveError(testErr);
      return {
        lastRun: new Date().toISOString(),
        status: 'FAILED',
        details: `Google Drive OAuth gagal [${classified.kind}] (Status ${classified.statusCode || 'N/A'}): ${classified.message}`,
        createdFoldersCount: 0,
        error: classified.message,
      };
    }
  }

  return {
    lastRun: new Date().toISOString(),
    status: 'READY',
    details: `Google Drive terhubung (${driveInfo.targetStorage}). Otomasi siap dijalankan.`,
    createdFoldersCount: 0,
  };
}
