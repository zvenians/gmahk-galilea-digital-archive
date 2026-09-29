import { createHmac, timingSafeEqual } from 'crypto';
import { ArchiveCategory } from './types';

export interface UploadSessionPayload {
  version: 1;
  uid: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  category: ArchiveCategory;
  sabbathDate: string;
  sabbathTitle: string;
  year: number;
  quarter: number;
  folderId: string;
  folderPath: string;
  expiresAt: number;
}

function getSigningSecret(): string {
  const secret =
    process.env.UPLOAD_SESSION_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.FIREBASE_PRIVATE_KEY?.trim();

  if (!secret) {
    throw new Error('UPLOAD_SESSION_SECRET belum dikonfigurasi.');
  }

  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', getSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
}

export function createUploadSessionToken(
  payload: Omit<UploadSessionPayload, 'version' | 'expiresAt'>,
  ttlMs: number = 24 * 60 * 60 * 1000
): string {
  const completePayload: UploadSessionPayload = {
    ...payload,
    version: 1,
    expiresAt: Date.now() + ttlMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(completePayload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyUploadSessionToken(token: string, uid: string): UploadSessionPayload {
  const [encodedPayload, suppliedSignature, ...extra] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extra.length > 0) {
    throw new Error('Token sesi unggahan tidak valid.');
  }

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw new Error('Token sesi unggahan tidak valid.');
  }

  let payload: UploadSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Data sesi unggahan tidak dapat dibaca.');
  }

  if (payload.version !== 1 || payload.uid !== uid || payload.expiresAt <= Date.now()) {
    throw new Error('Sesi unggahan sudah kedaluwarsa atau bukan milik akun ini.');
  }

  return payload;
}
