'use client';

import React, { useEffect, useMemo, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  X,
  ArrowLeft,
  FileText,
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Image as ImageIcon,
} from 'lucide-react';
import { ArchiveCategory, SabbathInfo } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import StudioAccount from '@/components/archive/StudioAccount';
import UploadThumbnail from '@/components/archive/UploadThumbnail';
import { MAX_UPLOAD_BYTES, transferToDrive, uploadApi, UploadExpiredError, UploadRequestError, waitForRetry, type UploadReply } from '@/lib/resumable-upload';
import { getDefaultUploadSabbath, getSabbathsInQuarter, isValidSabbathDate, parseSabbathDetails } from '@/lib/sabbath';

interface QueueItem {
  id: string;
  file: File;
  status: 'WAITING' | 'UPLOADING' | 'SUCCESS' | 'ERROR';
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
  sessionUrl?: string;
  uploadToken?: string;
  driveFileId?: string;
  safeFileName?: string;
  destination?: Record<string, unknown>;
}

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySabbath = searchParams.get('sabbath') || '';
  const queryCategory = searchParams.get('category') as ArchiveCategory | null;

  const { showToast } = useToast();
  const { getIdToken } = useAuth();
  const guestSession = useRef<Promise<void> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (stepTimer.current) clearTimeout(stepTimer.current); }, []);

  const [category, setCategory] = useState<ArchiveCategory>(queryCategory === 'worship' ? 'worship' : 'documentation');
  const [uploadPeriod, setUploadPeriod] = useState(() => {
    const initial = isValidSabbathDate(querySabbath) ? parseSabbathDetails(querySabbath) : getDefaultUploadSabbath();
    return { year: initial.year, quarter: initial.quarter };
  });
  const sabbathList = useMemo(() => getSabbathsInQuarter(uploadPeriod.year, uploadPeriod.quarter), [uploadPeriod.year, uploadPeriod.quarter]);
  const [defaultSabbath, setDefaultSabbath] = useState<SabbathInfo | null>(null);
  const [selectedSabbathDate, setSelectedSabbathDate] = useState<string>(() => isValidSabbathDate(querySabbath) ? querySabbath : getDefaultUploadSabbath().date);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadActive, setUploadActive] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  
  const MAX_CONCURRENT = 3;

  useEffect(() => {
    let isMounted = true;
    fetch('/api/sabbath')
      .then((res) => res.json())
      .then((json) => {
        if (!isMounted || !json.success) return;
        const defaultSab: SabbathInfo = json.data.defaultUpload || json.data.nextSabbath;
        setDefaultSabbath(defaultSab);
        if (!isValidSabbathDate(querySabbath) && defaultSab) {
          setSelectedSabbathDate(defaultSab.date);
          setUploadPeriod({ year: defaultSab.year, quarter: defaultSab.quarter });
        }
      })
      .catch((err) => console.error(err));
    return () => { isMounted = false; };
  }, [querySabbath]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (uploadActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [uploadActive]);

  const running = useRef(new Map<string, AbortController>());
  useEffect(() => { const controllers = running.current; return () => { controllers.forEach(controller => controller.abort()); }; }, []);

  const startUpload = async (id: string) => {
    const item = queue.find(q => q.id === id);
    if (!item || running.current.has(id)) return;
    const controller = new AbortController();
    running.current.set(id, controller);
    const { signal } = controller;
    const update = (patch: Partial<QueueItem>) => setQueue(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
    update({ status: 'UPLOADING', error: undefined, xhr: { abort: () => controller.abort() } as XMLHttpRequest });
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        guestSession.current ??= uploadApi({ action: 'guest' }, null, AbortSignal.timeout(90000))
          .then(() => {}).catch(error => { guestSession.current = null; throw error; });
        await guestSession.current;
      }
      signal.throwIfAborted();
      let sessionUrl = item.sessionUrl;
      let uploadToken = item.uploadToken;
      let driveFileId = item.driveFileId;
      // Freeze the destination for retries even if the form is changed later.
      const uploadCategory = (item.destination?.category as ArchiveCategory) || category;
      const uploadDate = item.destination?.sabbathDate || selectedSabbathDate;
      let resume = Boolean(sessionUrl);
      let restarts = 0;
      while (!driveFileId) {
        if (!sessionUrl) {
          const init = await uploadApi<{ sessionUrl: string; uploadToken: string; safeFileName: string; destination: Record<string, unknown> }>({
            action: 'init', fileName: item.file.name, mimeType: item.file.type || 'application/octet-stream',
            fileSize: item.file.size, category: uploadCategory, sabbathDate: uploadDate,
          }, idToken, signal);
          sessionUrl = init.sessionUrl;
          uploadToken = init.uploadToken;
          update({ ...init, progress: 0 });
          resume = false;
        }
        try {
          driveFileId = await transferToDrive({ file: item.file, sessionUrl, signal, resume,
            checkStatus: () => uploadApi<UploadReply>({ action: 'status', uploadToken }, idToken, signal),
            onProgress: progress => update({ progress, error: undefined }),
            onRetry: attempt => update({ error: 'Koneksi terputus. Mencoba lagi (' + attempt + '/5)…' }),
          });
          // Keep the completed ID: retrying finalize must not re-upload bytes.
          update({ driveFileId, progress: 99, error: undefined });
        } catch (error) {
          if (!(error instanceof UploadExpiredError) || restarts++ >= 1) throw error;
          sessionUrl = undefined;
          update({ sessionUrl: undefined, uploadToken: undefined, progress: 0 });
        }
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const confirmation = await uploadApi<{ data?: { id?: string; size?: number } }>({ action: 'finalize', fileId: driveFileId, uploadToken }, idToken, signal);
          if (confirmation.data?.id !== driveFileId || confirmation.data?.size !== item.file.size) {
            throw new UploadRequestError('Konfirmasi Google Drive belum lengkap. Tekan Coba lagi untuk memeriksa file.', true);
          }
          break;
        } catch (error) {
          if (!(error instanceof UploadRequestError) || !error.retryable || attempt >= 2) throw error;
          update({ error: 'File sudah terkirim. Menunggu konfirmasi…' });
          await waitForRetry(1000 * 2 ** attempt, signal);
        }
      }
      signal.throwIfAborted();
      update({ status: 'SUCCESS', progress: 100, error: undefined });
    } catch (error) {
      update({ status: 'ERROR', error: signal.aborted ? 'Upload dibatalkan.' : (error as Error).message || 'Upload belum berhasil. Coba lagi.' });
    } finally {
      running.current.delete(id);
    }
  };

  const processQueue = async () => {
    const activeUploads = queue.filter(q => q.status === 'UPLOADING').length;
    if (activeUploads >= MAX_CONCURRENT) return;

    const waitingItems = queue.filter(q => q.status === 'WAITING');
    if (waitingItems.length === 0) {
      if (activeUploads === 0 && queue.length > 0) {
        setUploadActive(false);
        const failed = queue.filter(q => q.status === 'ERROR').length;
        if (failed === 0) {
          showToast({
            type: 'success',
            message: 'Tersimpan di Google Drive',
            description: `${queue.length} file berhasil diunggah.`,
          });
        } else {
          showToast({
            type: 'warning',
            message: 'Sebagian file belum terunggah',
            description: `${queue.length - failed} berhasil, ${failed} gagal.`,
          });
        }
        router.refresh();
        fetch('/api/sabbath?_t=' + Date.now()).catch(()=>{});
      }
      return;
    }

    const toStart = waitingItems.slice(0, MAX_CONCURRENT - activeUploads);
    
    toStart.forEach(item => {
      startUpload(item.id);
    });
  };

  useEffect(() => {
    if (uploadActive) {
      const timer = window.setTimeout(() => { void processQueue(); }, 0);
      return () => window.clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, uploadActive]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(Array.from(e.target.files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  };

  const addFilesToQueue = (files: File[]) => {
    const validFiles = files.filter(f => f.size > 0 && f.size <= MAX_UPLOAD_BYTES);
    const emptyFiles = files.filter(f => f.size === 0);
    if (files.some(file => file.size > MAX_UPLOAD_BYTES)) {
      showToast({ type: 'warning', message: 'File terlalu besar', description: 'Batas Google Drive adalah 5 TB per file. File yang melebihi batas tidak ditambahkan.' });
    }
    
    if (emptyFiles.length > 0) {
      showToast({
        type: 'warning',
        message: 'Berkas Kosong',
        description: `${emptyFiles.length} berkas diabaikan karena ukurannya 0 byte.`,
      });
    }

    if (validFiles.length === 0) return;

    const newItems: QueueItem[] = validFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      status: 'WAITING',
      progress: 0,
    }));
    setQueue(prev => [...prev, ...newItems]);
  };

  const removeQueueItem = (id: string) => {
    const item = queue.find(q => q.id === id);
    if (item?.xhr && item.status === 'UPLOADING') {
      item.xhr.abort();
    }
    setQueue(prev => prev.filter(q => q.id !== id));
  };

  const retryItem = (id: string) => {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'WAITING', progress: 0, error: undefined } : q));
    setUploadActive(true);
  };

  const handleStartUploads = () => {
    if (queue.filter(q => q.status === 'WAITING').length === 0) return;
    setUploadActive(true);
  };

  const handleRetryAll = () => {
    setQueue(prev => prev.map(q => q.status === 'ERROR' ? { ...q, status: 'WAITING', progress: 0, error: undefined } : q));
    setUploadActive(true);
  };

  const handleCancelAll = () => {
    queue.forEach(item => {
      if (item.xhr && item.status === 'UPLOADING') {
        item.xhr.abort();
      }
    });
    setUploadActive(false);
    setShowCloseConfirm(false);
    setQueue(prev => prev.map(q => q.status === 'UPLOADING' || q.status === 'WAITING' ? { ...q, status: 'ERROR', error: 'Dibatalkan pengguna' } : q));
  };

  const totalFiles = queue.length;
  const successFiles = queue.filter(q => q.status === 'SUCCESS').length;
  const errorFiles = queue.filter(q => q.status === 'ERROR').length;
  const waitingFiles = queue.filter(q => q.status === 'WAITING').length;
  const activeFiles = queue.filter(q => q.status === 'UPLOADING').length;
  const archiveHref = `/archive?category=${category}&sabbath=${encodeURIComponent(selectedSabbathDate)}`;
  
  const overallProgress = totalFiles === 0 ? 0 : Math.round((queue.reduce((acc, curr) => acc + curr.progress, 0)) / totalFiles);

  const [uiStep, setUiStep] = useState(() => searchParams.get('step') === 'files' && isValidSabbathDate(querySabbath) ? 3 : 1);
  const [stepLeaving, setStepLeaving] = useState(false);
  const moveStep = (next: number) => {
    if (stepLeaving || uploadActive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setUiStep(next); return; }
    setStepLeaving(true);
    stepTimer.current = setTimeout(() => { setUiStep(next); setStepLeaving(false); }, 170);
  };
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <main className="studio-upload min-h-screen text-white">
      <div className="studio-upload-canvas max-w-5xl mx-auto px-6 py-12 sm:py-20">
        <div className="studio-upload-account"><StudioAccount disabled={uploadActive} /></div>
        <div className="studio-upload-heading flex items-start justify-between mb-12 sm:mb-20">
          <div><p className="studio-upload-kicker">GALILEA / UNGGAH</p><h1 className="studio-upload-title">Unggah <em>file.</em></h1><p className="studio-upload-intro">Unggah foto, video, atau dokumen tanpa perlu masuk. Pilih kategori dan tanggal Sabatnya dulu.</p></div>
          <Link
            href={archiveHref}
            onClick={(e) => {
              if (uploadActive) {
                e.preventDefault();
                setShowCloseConfirm(true);
              }
            }}
            className="p-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            aria-label="Kembali ke arsip"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>

        <div className="studio-upload-steps" aria-label="Langkah unggah" style={{ '--step-progress': `${(uiStep - 1) / 3 * 100}%` } as React.CSSProperties}>{[['Tujuan', 'Pilih kategori'], ['Sabat', 'Tentukan tanggal Sabat'], ['File', 'Pilih dari perangkat'], ['Periksa', 'Cek lalu unggah']].map(([label, description], index) => <span key={label} aria-current={uiStep === index + 1 ? 'step' : undefined} data-complete={uiStep > index + 1}><i aria-hidden="true" /><strong>0{index + 1}</strong><b>{label}</b><small>{description}</small></span>)}</div>
        <div className={`studio-upload-step-body ${stepLeaving ? 'studio-upload-step-leaving' : ''}`} key={uiStep}>
        <div className="mb-8">
          <div className="studio-upload-section" hidden={uiStep !== 1}>
            <h3><span>01</span> Simpan di mana?</h3><p>Pilih kategori yang sesuai dengan filemu.</p>
            <div className="studio-upload-options">
              <button
                onClick={() => setCategory('documentation')}
                disabled={uploadActive}
                className={`flex-1 py-3 text-sm transition-colors ${
                  category === 'documentation' ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                <ImageIcon className="w-6 h-6 mb-5" /> Dokumentasi
                <small>Foto dan video kegiatan jemaat.</small>
              </button>
              <button
                onClick={() => setCategory('worship')}
                disabled={uploadActive}
                className={`flex-1 py-3 text-sm transition-colors ${
                  category === 'worship' ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                <FileText className="w-6 h-6 mb-5" /> Berkas Ibadah
                <small>Materi ibadah, laporan, dan dokumen lainnya.</small>
              </button>
            </div>
          </div>

          <div className="studio-upload-section relative" hidden={uiStep !== 2}>
            <h3><span>02</span> Tanggal Sabat</h3><p>Pilih tanggal Sabat untuk file ini.</p>
            <div className="studio-upload-period">
              <label>Tahun<select aria-label="Tahun unggahan" value={uploadPeriod.year} disabled={uploadActive} onChange={event => {
                const year = Number(event.target.value);
                setUploadPeriod(current => ({ ...current, year }));
                setSelectedSabbathDate(getSabbathsInQuarter(year, uploadPeriod.quarter)[0].date);
                setShowDatePicker(true);
              }}>{Array.from(new Set([uploadPeriod.year, ...Array.from({ length: 8 }, (_, index) => (defaultSabbath?.year || getDefaultUploadSabbath().year) + 1 - index)])).sort((a, b) => b - a).map(year => <option key={year} value={year}>{year}</option>)}</select></label>
              <label>Triwulan<select aria-label="Triwulan unggahan" value={uploadPeriod.quarter} disabled={uploadActive} onChange={event => {
                const quarter = Number(event.target.value);
                setUploadPeriod(current => ({ ...current, quarter }));
                setSelectedSabbathDate(getSabbathsInQuarter(uploadPeriod.year, quarter)[0].date);
                setShowDatePicker(true);
              }}>{[1, 2, 3, 4].map(quarter => <option key={quarter} value={quarter}>{['I', 'II', 'III', 'IV'][quarter - 1]}</option>)}</select></label>
            </div>
            <button
              onClick={() => !uploadActive && setShowDatePicker(!showDatePicker)}
              className="w-full bg-[#22211f] border-b border-white/30 p-4 text-left flex justify-between items-center hover:bg-white/10 transition-colors"
            >
              <div>
                <div className="text-sm font-medium text-white">
                  {parseSabbathDetails(selectedSabbathDate)?.formattedTitle || 'Pilih tanggal Sabat'}
                </div>
                <div className="text-xs text-white/40 mt-1">{selectedSabbathDate}</div>
              </div>
            </button>

            {showDatePicker && (
              <div className="absolute top-full left-0 right-0 mt-2 z-20 bg-[#22211f] border border-white/10 overflow-hidden shadow-2xl max-h-60 overflow-y-auto">
                {sabbathList.map((sab) => (
                  <button
                    key={sab.date}
                    onClick={() => {
                      setSelectedSabbathDate(sab.date);
                      setShowDatePicker(false);
                    }}
                    className={`w-full p-4 text-left text-sm transition-colors flex justify-between items-center ${
                      selectedSabbathDate === sab.date ? 'bg-white/10 text-white font-medium' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <span>{sab.formattedTitle}</span>
                    {sab.isToday ? (
                      <span className="text-[10px] uppercase bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Sabat Ini</span>
                    ) : sab.date === defaultSabbath?.date ? (
                      <span className="text-[10px] uppercase bg-white/10 text-white/60 px-2 py-0.5 rounded-full">Disarankan</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div hidden={uiStep !== 3}>
        <div className="studio-upload-section mb-5"><h3><span>03</span> Pilih file</h3><p>{category === 'documentation' ? 'Dokumentasi' : 'Berkas Ibadah'} · {parseSabbathDetails(selectedSabbathDate).formattedTitle}</p><p>Seret ke area ini atau pilih dari perangkat.</p></div>
        {!uploadActive && <div className="studio-upload-tray-scene" data-filled={totalFiles > 0}>
          <div className="studio-upload-tray-papers" aria-hidden="true">{[0, 1, 2].map(index => <span key={index}>{queue[index] && <UploadThumbnail file={queue[index].file} />}</span>)}</div>
          <div className="studio-upload-tray-rim" aria-hidden="true" />
        {(
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Pilih berkas dari perangkat"
            onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInputRef.current?.click(); } }}
            className={`studio-upload-drop border border-dashed p-12 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-white bg-white/5' : 'border-white/20 hover:border-white/40 hover:bg-white/5'
            }`}
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="w-16 h-16 border border-white/20 mx-auto flex items-center justify-center mb-4">
              <UploadIcon className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Seret &amp; lepas file di sini</h3>
            <p className="text-white/50 text-sm">atau pilih dari perangkat. Semua format file diterima.</p>
            <p className="text-white/40 text-xs mt-3">Maksimal 5 TB per file, sesuai sisa ruang dan kuota Google Drive. Biarkan halaman ini terbuka selama upload.</p>
          </div>
        )}</div>}

        <p className="text-sm text-white/60 mt-4" role="status">{totalFiles} berkas dipilih</p>
        {totalFiles > 0 && <div className="studio-upload-drawer" aria-label="Berkas dipilih">{queue.slice(0, 3).map(item => <div key={item.id}><span className="studio-upload-mini"><UploadThumbnail file={item.file} /></span><span>{item.file.name}<small>{formatBytes(item.file.size)} · Siap diunggah</small></span><CheckCircle2 size={16} /></div>)}</div>}
        </div>
        <div hidden={uiStep !== 4}>
        <div className="studio-upload-section mb-5"><h3><span>04</span> Periksa &amp; unggah</h3><p>{category === 'documentation' ? 'Dokumentasi' : 'Berkas Ibadah'} · {selectedSabbathDate}. Sudah sesuai? Tekan Mulai unggah.</p></div>
        {totalFiles === 0 && <p className="studio-upload-waiting">Berkas yang dipilih akan muncul di sini sebelum diunggah.</p>}
        {totalFiles > 0 && (
          <div className="mt-5">
            <div className="flex justify-between items-end mb-4">
              <div>
                <h2 className="text-lg font-medium text-white">Antrean ({totalFiles} berkas)</h2>
                {(uploadActive || successFiles > 0 || errorFiles > 0) && (
                  <p className="text-sm text-white/50 mt-1">
                    {successFiles} selesai, {errorFiles} gagal, {waitingFiles + activeFiles} antre
                  </p>
                )}
              </div>
              
              {uploadActive ? (
                <div className="text-right">
                  <div className="text-sm font-medium mb-1">{overallProgress}% Selesai</div>
                  <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-white transition-all duration-300" style={{ width: `${overallProgress}%` }}></div>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {errorFiles > 0 && (
                    <button
                      onClick={handleRetryAll}
                      className="bg-white/10 text-white px-6 py-2 rounded-full font-medium text-sm hover:bg-white/20 transition-colors"
                    >
                      COBA LAGI SEMUA
                    </button>
                  )}
                  {waitingFiles > 0 && (
                    <button
                      onClick={handleStartUploads}
                      className="bg-white text-black px-6 py-2 rounded-full font-medium text-sm hover:bg-white/80 transition-colors"
                    >
                      MULAI UNGGAH
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="studio-upload-queue space-y-3">
              {queue.map(item => (
                <div key={item.id} data-status={item.status} className="studio-upload-queue-item bg-[#1b1a18] border-b border-white/10 p-4 flex items-center gap-4">
                  <div className="studio-upload-mini w-10 h-10 bg-black/50 flex items-center justify-center flex-shrink-0">
                    <UploadThumbnail file={item.file} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-white truncate pr-4">{item.file.name}</span>
                      <span className="text-xs text-white/40 whitespace-nowrap">{formatBytes(item.file.size)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-black/50 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            item.status === 'ERROR' ? 'bg-red-500' : 
                            item.status === 'SUCCESS' ? 'bg-green-500' : 'bg-white'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        ></div>
                      </div>
                      <span className="text-xs font-medium w-10 text-right">
                        {item.status === 'SUCCESS' ? <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" /> :
                         item.status === 'ERROR' ? <AlertCircle className="w-4 h-4 text-red-500 ml-auto" /> :
                         `${item.progress}%`}
                      </span>
                    </div>
                    {item.error && <p className="text-xs text-red-400 mt-1">{item.error}</p>}
                  </div>
                  
                  {!uploadActive && item.status === 'ERROR' && (
                    <button onClick={() => retryItem(item.id)} className="p-2 rounded-full hover:bg-white/10 text-white/70" title="Coba Lagi">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                  
                  {!uploadActive && item.status !== 'SUCCESS' && (
                    <button onClick={() => removeQueueItem(item.id)} className="p-2 rounded-full hover:bg-white/10 text-white/70" title="Hapus">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
        </div>
        <div className="studio-upload-navigation">
          <button type="button" disabled={uiStep === 1 || uploadActive || stepLeaving} onClick={() => moveStep(uiStep - 1)}>← Kembali</button>
          <span>{uiStep} / 4</span>
          {uiStep < 4 && <button type="button" disabled={stepLeaving || (uiStep === 3 && totalFiles === 0)} onClick={() => moveStep(uiStep + 1)}>Lanjut →</button>}
        </div>
      </div>

      {/* Close Confirmation Modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl text-center">
            <h3 className="text-xl font-medium mb-2">Upload masih berjalan</h3>
            <p className="text-white/60 text-sm mb-6">Kalau keluar sekarang, upload yang belum selesai akan dibatalkan.</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-white/80 transition-colors"
              >
                Lanjutkan upload
              </button>
              <Link
                href={archiveHref}
                onClick={handleCancelAll}
                className="w-full py-3 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 font-medium transition-colors"
              >
                Batalkan dan keluar
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <UploadContent />
    </Suspense>
  );
}
