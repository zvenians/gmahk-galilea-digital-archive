import { it } from 'node:test';
import assert from 'node:assert/strict';
import { receivedBytes, transferToDrive, UploadExpiredError, UploadRequestError, uploadError, waitForRetry, UPLOAD_CHUNK_BYTES, type UploadReply, type UploadTransport } from '../src/lib/resumable-upload';

const done: UploadReply = { status: 200, range: null, body: '{"id":"saved-file"}' };
const incomplete = (end?: number): UploadReply => ({ status: 308, range: end === undefined ? null : `bytes=0-${end}`, body: '' });
const run = (file: Blob, transport: UploadTransport, extra = {}) => transferToDrive({ file, sessionUrl: 'https://example.test/session', signal: new AbortController().signal, transport, wait: async () => {}, ...extra });

it('handles photos, HEIC, MOV, audio, ZIP and unknown MIME types as unchanged bytes', async () => {
  for (const type of ['image/jpeg', 'image/heic', 'video/quicktime', 'video/mp4', 'audio/mpeg', 'application/zip', 'application/pdf', '']) {
    const bytes = new Uint8Array([0, 255, 17, 99]);
    const result = await run(new Blob([bytes], { type }), async (_url, range, body) => {
      assert.equal(range, 'bytes 0-3/4');
      assert.deepEqual(new Uint8Array(await body!.arrayBuffer()), bytes);
      assert.equal(body?.type, type || 'application/octet-stream');
      return done;
    });
    assert.equal(result, 'saved-file');
  }
});

it('sends exact 8 MiB boundaries and the final remainder without loading the whole file', async () => {
  const file = new Blob([new Uint8Array(UPLOAD_CHUNK_BYTES * 2 + 1)]);
  const ranges: string[] = [];
  await run(file, async (_url, range, body) => {
    ranges.push(range);
    assert.ok(body!.size <= UPLOAD_CHUNK_BYTES);
    return ranges.length < 3 ? incomplete(ranges.length * UPLOAD_CHUNK_BYTES - 1) : done;
  });
  assert.deepEqual(ranges, [`bytes 0-8388607/${file.size}`, `bytes 8388608-16777215/${file.size}`, `bytes 16777216-16777216/${file.size}`]);
});

it('recovers a lost final response using server status, without resending any bytes', async () => {
  let sends = 0, probes = 0;
  const id = await run(new Blob(['saved']), async () => { sends++; throw new UploadRequestError('CORS/network', true); }, {
    checkStatus: async () => { probes++; return done; },
  });
  assert.equal(id, 'saved-file'); assert.equal(sends, 1); assert.equal(probes, 1);
});

it('resumes from the server-confirmed byte offset after a partially stored chunk', async () => {
  let sends = 0;
  await run(new Blob([new Uint8Array(1024)]), async (_url, range, body) => {
    if (++sends === 1) throw new UploadRequestError('network', true);
    assert.equal(range, 'bytes 256-1023/1024'); assert.equal(body?.size, 768); return done;
  }, { checkStatus: async () => incomplete(255) });
});

it('does not loop forever on missing range / no progress', async () => {
  let sends = 0;
  await assert.rejects(run(new Blob(['test']), async () => { sends++; return incomplete(); }, { checkStatus: async () => incomplete() }), /Upload terhenti/);
  assert.equal(sends, 6);
});

it('bounds repeated failed status checks without sending another chunk', async () => {
  let sends = 0, probes = 0;
  await assert.rejects(run(new Blob(['test']), async () => { sends++; throw new UploadRequestError('network', true); }, {
    checkStatus: async () => { probes++; throw new UploadRequestError('timeout', true); },
  }), /Upload terhenti/);
  assert.equal(sends, 1); assert.equal(probes, 5);
});

it('expired sessions are reported to the bounded restart policy', async () => {
  await assert.rejects(run(new Blob(['test']), async () => ({ status: 404, range: null, body: '' })), UploadExpiredError);
});

it('does not retry permission or storage failures indefinitely', async () => {
  let sends = 0;
  await assert.rejects(run(new Blob(['test']), async () => { sends++; return { status: 403, range: null, body: 'storageQuotaExceeded' }; }), /kuota/);
  assert.equal(sends, 1);
  assert.equal(uploadError(403, 'userRateLimitExceeded').retryable, true);
});

it('abort interrupts backoff and no more network requests occur', async () => {
  const controller = new AbortController();
  const pending = waitForRetry(10000, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  let sends = 0;
  await assert.rejects(run(new Blob(['test']), async () => { sends++; return done; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(sends, 0);
});

it('supports safe byte offsets above 4 GB and rejects invalid ranges', () => {
  assert.equal(receivedBytes('bytes=0-5368709119', 6 * 1024 ** 3), 5368709120);
  for (const range of ['bytes=2-10', 'broken', 'bytes=0-NaN', 'bytes=0-1000']) assert.throws(() => receivedBytes(range, 20));
});

it('resume of an already completed session skips transfer entirely', async () => {
  await run(new Blob(['test']), async () => { assert.fail('must not send'); }, { resume: true, checkStatus: async () => done });
});
