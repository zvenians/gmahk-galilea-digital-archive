// Browser-to-Drive transfer. File bytes never pass through a Vercel function.
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 4;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 ** 2;
export type UploadReply = { status: number; range: string | null; body: string };
export type UploadTransport = (url: string, range: string, body: Blob | undefined, signal: AbortSignal, progress?: (loaded: number) => void) => Promise<UploadReply>;

export class UploadExpiredError extends Error {
  constructor() { super('Sesi upload berakhir. Coba lagi untuk memulai sesi baru.'); }
}
export class UploadRequestError extends Error {
  constructor(message: string, public retryable = false) { super(message); }
}

export function uploadError(status: number, body = ''): UploadRequestError {
  if (/storageQuotaExceeded|quotaExceeded|dailyLimitExceeded/i.test(body)) return new UploadRequestError('Penyimpanan atau kuota Google Drive sudah penuh. Hubungi admin.');
  if ([408, 429, 500, 502, 503, 504].includes(status) || (status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(body))) return new UploadRequestError('Google Drive sedang sibuk. Mencoba lagi…', true);
  if (status === 401 || status === 403) return new UploadRequestError('Google Drive menolak upload ini. Hubungi admin untuk memeriksa akses penyimpanan.');
  return new UploadRequestError(`Upload belum berhasil (kode ${status}). Coba lagi.`);
}

export function receivedBytes(range: string | null, size: number): number {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/i.exec(range.trim());
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > size) throw new UploadRequestError('Posisi upload dari Google Drive tidak valid. Coba lagi.');
  return offset;
}

export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export const sendUploadRequest: UploadTransport = (url, range, body, signal, progress) => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const clean = () => signal.removeEventListener('abort', abort);
    xhr.open('PUT', url);
    xhr.timeout = body ? 600000 : 45000;
    xhr.setRequestHeader('Content-Range', range);
    if (body) xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress?.(event.loaded); };
    xhr.onload = () => { clean(); resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), body: xhr.responseText }); };
    xhr.onerror = () => { clean(); reject(new UploadRequestError('Koneksi terputus. Periksa internet lalu coba lagi.', true)); };
    xhr.ontimeout = () => { clean(); reject(new UploadRequestError('Koneksi terlalu lama. Periksa internet lalu coba lagi.', true)); };
    xhr.onabort = () => { clean(); reject(signal.reason || new DOMException('Upload dibatalkan.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
};

export async function transferToDrive(options: {
  file: Blob; sessionUrl: string; signal: AbortSignal; resume?: boolean;
  onProgress?: (percent: number) => void;
  onRetry?: (attempt: number) => void;
  transport?: UploadTransport;
  checkStatus?: () => Promise<UploadReply>;
  wait?: typeof waitForRetry;
}): Promise<string> {
  const { file, sessionUrl, signal, onProgress, onRetry } = options;
  const send = options.transport || sendUploadRequest;
  const wait = options.wait || waitForRetry;
  let offset = 0, failures = 0, probe = options.resume || false;
  while (true) {
    signal.throwIfAborted();
    const checking = probe || offset === file.size;
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
    try {
      const reply = checking && options.checkStatus ? await options.checkStatus() : await send(sessionUrl, checking ? `bytes */${file.size}` : `bytes ${offset}-${end - 1}/${file.size}`,
        checking ? undefined : file.slice(offset, end, file.type || 'application/octet-stream'), signal,
        loaded => onProgress?.(Math.min(99, Math.round((offset + loaded) / file.size * 100))));
      signal.throwIfAborted();
      if (reply.status === 404 || reply.status === 410) throw new UploadExpiredError();
      if (reply.status === 200 || reply.status === 201) {
        let id: unknown;
        try { id = JSON.parse(reply.body).id; } catch { /* retry status, never resend a completed file */ }
        if (typeof id !== 'string' || !id) throw new UploadRequestError('Google Drive belum mengirim konfirmasi file. Coba lagi.', true);
        onProgress?.(99);
        return id;
      }
      if (reply.status !== 308) throw uploadError(reply.status, reply.body);
      const next = receivedBytes(reply.range, file.size);
      if (checking && next === file.size) throw new UploadRequestError('Menunggu konfirmasi Google Drive…', true);
      if (next > end && !checking) throw new UploadRequestError('Konfirmasi ukuran upload tidak sesuai. Coba lagi.');
      // A status probe with no stored bytes is valid; a chunk with no
      // advancement is not. Never assume the entire chunk was received.
      if (!checking && next <= offset) throw new UploadRequestError('Upload belum bergerak. Memeriksa koneksi…', true);
      if (next > offset) failures = 0;
      offset = next;
      probe = false;
      onProgress?.(Math.min(99, Math.round(offset / file.size * 100)));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof UploadExpiredError || !(error instanceof UploadRequestError) || !error.retryable) throw error;
      if (++failures > 5) throw new UploadRequestError('Upload terhenti. Periksa internet, lalu tekan Coba lagi untuk melanjutkan.');
      onRetry?.(failures);
      await wait(Math.min(1000 * 2 ** (failures - 1), 15000), signal);
      // A failed request may have been saved remotely. Resolve its state
      // before sending any further bytes (including the last chunk).
      probe = true;
    }
  }
}

export async function uploadApi<T>(body: object, token: string | null, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/upload', {
      method: 'POST', credentials: 'same-origin',
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    signal.throwIfAborted();
    throw new UploadRequestError('Server belum merespons. Periksa internet lalu coba lagi.', true);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new UploadRequestError(data?.error || `Upload belum berhasil (kode ${response.status}). Coba lagi.`, response.status === 429 || response.status >= 500);
  return data as T;
}
