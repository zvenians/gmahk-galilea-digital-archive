'use client';

import React, { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  X,
  FileText,
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import { ArchiveCategory, SabbathInfo } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import Navbar from '@/components/Navbar';

interface QueueItem {
  id: string;
  file: File;
  status: 'WAITING' | 'UPLOADING' | 'SUCCESS' | 'ERROR';
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
  sessionUrl?: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [CLIENT_BUILD_VERSION] = useState("1b19bee_diagnostic_2");

  useEffect(() => {
    console.log(`[Diagnostic] CLIENT_BUILD_VERSION: ${CLIENT_BUILD_VERSION}`);
  }, [CLIENT_BUILD_VERSION]);

  const [category, setCategory] = useState<ArchiveCategory>(queryCategory || 'documentation');
  const [sabbathList, setSabbathList] = useState<SabbathInfo[]>([]);
  const [defaultSabbath, setDefaultSabbath] = useState<SabbathInfo | null>(null);
  const [selectedSabbathDate, setSelectedSabbathDate] = useState<string>(querySabbath);
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
        const allQuarterSabs: SabbathInfo[] = json.data.quarter?.sabbaths || [];
        setDefaultSabbath(defaultSab);
        setSabbathList(allQuarterSabs);
        if (!querySabbath && defaultSab) {
          setSelectedSabbathDate(defaultSab.date);
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

  useEffect(() => {
    if (uploadActive) {
      processQueue();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, uploadActive]);

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
            message: 'Unggahan Selesai',
            description: `${queue.length} berkas berhasil diunggah.`,
          });
        } else {
          showToast({
            type: 'warning',
            message: 'Unggahan Selesai Sebagian',
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

  const startUpload = async (id: string) => {
    const item = queue.find(q => q.id === id);
    if (!item) return;

    setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'UPLOADING', progress: 0 } : q));

    try {
      const idToken = await getIdToken();
      
      let sessionUrl = item.sessionUrl;
      let safeFileName = item.safeFileName;
      let destination = item.destination;

      const initSession = async () => {
          const initRes = await fetch('/api/upload', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
              },
              body: JSON.stringify({
                  action: 'init',
                  fileName: item.file.name,
                  mimeType: item.file.type || 'application/octet-stream',
                  fileSize: item.file.size,
                  category,
                  sabbathDate: destination?.sabbathDate || selectedSabbathDate
              })
          });
          const initData = await initRes.json();
          if (!initData.success) throw new Error(initData.error || 'Gagal inisialisasi upload');
          sessionUrl = initData.sessionUrl;
          safeFileName = initData.safeFileName;
          destination = initData.destination;
          setQueue(prev => prev.map(q => q.id === id ? { ...q, sessionUrl, safeFileName, destination } : q));
      };

      if (!sessionUrl) {
          await initSession();
      }

      if (!sessionUrl) {
          throw new Error('Sesi upload tidak dapat dibuat');
      }

      const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunk
      const totalSize = item.file.size;
      let start = 0;
      let driveFileId = null;

      const diagLog = (event: string, details: Record<string, unknown> = {}) => {
          const safeDetails = { ...details };
          if (safeDetails.sessionUrl) safeDetails.sessionUrl = '***';
          console.log(`[UploadDiag Client ${new Date().toISOString()}] ${event}:`, JSON.stringify(safeDetails));
      };

      // Check session status to see where to resume (or if it's expired)
      try {
          diagLog('CHECK_SESSION_START', { totalSize });
          const checkRes = await fetch(sessionUrl, {
              method: 'PUT',
              headers: { 'Content-Range': `bytes */${totalSize}` }
          });
          diagLog('CHECK_SESSION_RESULT', { status: checkRes.status, range: checkRes.headers.get('Range') });
          
          if (checkRes.status === 308) {
              const range = checkRes.headers.get('Range');
              if (range) {
                  const parts = range.split('-');
                  start = parseInt(parts[1], 10) + 1;
              } else {
                  start = 0;
              }
          } else if (checkRes.status === 200 || checkRes.status === 201) {
              const data = await checkRes.json();
              driveFileId = data.id;
              start = totalSize;
          } else if (checkRes.status === 404) {
              diagLog('SESSION_404', { detail: 'Session expired before start' });
              await initSession();
              start = 0;
          }
      } catch (err) {
          diagLog('CHECK_SESSION_ERROR', { error: (err as Error).message });
      }

      let currentXhr: XMLHttpRequest | null = null;
      let isAborted = false;
      const abortHandler = () => {
          isAborted = true;
          if (currentXhr) currentXhr.abort();
      };
      
      setQueue(prev => prev.map(q => q.id === id ? { ...q, xhr: { abort: abortHandler } as unknown as XMLHttpRequest } : q));

      let retries = 0;
      const MAX_RETRIES = 7;

      while (start < totalSize && !isAborted) {
          const end = Math.min(start + CHUNK_SIZE, totalSize);
          const chunk = item.file.slice(start, end);
          
          diagLog('CHUNK_START', { start, end, totalSize, chunkSize: end - start, retries });
          const chunkStartTime = Date.now();
          
          try {
              const result = await new Promise<{status: number, range?: string | null, responseText?: string, id?: string}>((resolve, reject) => {
                  currentXhr = new XMLHttpRequest();
                  currentXhr.open('PUT', sessionUrl as string);
                  currentXhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${totalSize}`);
                  
                  currentXhr.upload.addEventListener('progress', (event) => {
                      if (event.lengthComputable) {
                          const loaded = start + event.loaded;
                          const percentComplete = Math.round((loaded / totalSize) * 100);
                          setQueue(prev => prev.map(q => q.id === id ? { ...q, progress: percentComplete } : q));
                      }
                  });
                  
                  currentXhr.addEventListener('load', () => {
                      resolve({
                          status: currentXhr!.status,
                          range: currentXhr!.getResponseHeader('Range'),
                          responseText: currentXhr!.responseText
                      });
                  });
                  
                  currentXhr.addEventListener('error', () => reject(new Error('NETWORK_ERROR')));
                  currentXhr.addEventListener('abort', () => reject(new Error('ABORTED')));
                  currentXhr.addEventListener('timeout', () => reject(new Error('TIMEOUT')));
                  currentXhr.timeout = 600000; // 10 minutes timeout per chunk
                  
                  currentXhr.send(chunk);
              });

              const elapsedMs = Date.now() - chunkStartTime;
              diagLog('CHUNK_END', { status: result.status, range: result.range, elapsedMs });

              if (result.status === 308) {
                  if (result.range) {
                      const parts = result.range.split('-');
                      start = parseInt(parts[1], 10) + 1;
                  } else {
                      diagLog('CHUNK_308_NO_RANGE', { start });
                      throw new Error('RETRY_HTTP_308_NO_RANGE'); // Force check query in catch block
                  }
                  retries = 0;
              } else if (result.status === 200 || result.status === 201) {
                  let data;
                  try { data = JSON.parse(result.responseText || '{}'); } catch {}
                  driveFileId = data?.id;
                  start = totalSize;
                  retries = 0;
              } else if (result.status === 404) {
                  diagLog('SESSION_404', { detail: 'Session expired during chunk' });
                  await initSession();
                  start = 0;
                  retries = 0;
              } else if ([408, 429, 500, 502, 503, 504].includes(result.status)) {
                  diagLog('CHUNK_HTTP_RETRYABLE', { status: result.status });
                  throw new Error(`RETRY_HTTP_${result.status}`);
              } else {
                  diagLog('CHUNK_HTTP_FATAL', { status: result.status, responseText: result.responseText });
                  throw new Error(`HTTP_${result.status}: ${result.responseText || ''}`);
              }

          } catch (err: unknown) {
              const errMsg = (err as Error).message;
              const elapsedMs = Date.now() - chunkStartTime;
              diagLog('CHUNK_EXCEPTION', { error: errMsg, elapsedMs, retries });
              
              if (errMsg === 'ABORTED' || isAborted) {
                  throw new Error('Dibatalkan pengguna');
              }
              if (errMsg.startsWith('HTTP_') && !errMsg.startsWith('RETRY_HTTP_')) {
                  throw new Error(`Gagal upload chunk: ${errMsg}`);
              }
              
              retries++;
              if (retries > MAX_RETRIES) {
                  throw new Error(`Gagal setelah ${MAX_RETRIES} percobaan: ${errMsg}`);
              }
              
              const backoff = Math.min(1000 * Math.pow(2, retries), 30000);
              diagLog('CHUNK_BACKOFF', { backoff, retries });
              await new Promise(r => setTimeout(r, backoff));
              
              if (isAborted) throw new Error('Dibatalkan pengguna');
              
              // Verify server's actual state before retrying
              try {
                  diagLog('CHECK_SESSION_START_RETRY', { totalSize });
                  const checkXhr = new XMLHttpRequest();
                  const checkResult = await new Promise<{status: number, range?: string | null, responseText?: string}>((resolve, reject) => {
                      checkXhr.open('PUT', sessionUrl as string);
                      checkXhr.setRequestHeader('Content-Range', `bytes */${totalSize}`);
                      checkXhr.onload = () => resolve({
                          status: checkXhr.status,
                          range: checkXhr.getResponseHeader('Range'),
                          responseText: checkXhr.responseText
                      });
                      checkXhr.onerror = () => reject(new Error('NETWORK_ERROR'));
                      checkXhr.onabort = () => reject(new Error('ABORTED'));
                      checkXhr.send();
                  });
                  
                  diagLog('CHECK_SESSION_RESULT_RETRY', { status: checkResult.status, range: checkResult.range });
                  if (checkResult.status === 308) {
                      if (checkResult.range) {
                          const parts = checkResult.range.split('-');
                          start = parseInt(parts[1], 10) + 1;
                      } else {
                          start = 0;
                      }
                  } else if (checkResult.status === 200 || checkResult.status === 201) {
                      const data = JSON.parse(checkResult.responseText || '{}');
                      driveFileId = data.id;
                      start = totalSize;
                  } else if (checkResult.status === 404) {
                      diagLog('SESSION_404_RETRY', { detail: 'Session expired detected on retry check' });
                      await initSession();
                      start = 0;
                  }
              } catch (checkErr) {
                  diagLog('CHECK_SESSION_ERROR_RETRY', { error: (checkErr as Error).message });
              }
          }
      }
      
      if (isAborted) {
          throw new Error('Dibatalkan pengguna');
      }

      if (!driveFileId) {
          throw new Error('Upload selesai tetapi tidak mendapatkan ID file dari Google Drive');
      }

      // Step 3: FINALIZE
      const finalizeRes = await fetch('/api/upload', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
          },
          body: JSON.stringify({
              action: 'finalize',
              fileId: driveFileId,
              fileName: safeFileName,
              mimeType: item.file.type || 'application/octet-stream',
              fileSize: item.file.size,
              category,
              destination
          })
      });
      
      const finalizeData = await finalizeRes.json();
      if (!finalizeData.success) {
          throw new Error(finalizeData.error || 'Gagal finalisasi upload');
      }

      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'SUCCESS', progress: 100 } : q));

    } catch (err: unknown) {
      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'ERROR', error: (err as Error).message || 'Kesalahan internal' } : q));
    }
  };

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
    const validFiles = files.filter(f => f.size > 0);
    const emptyFiles = files.filter(f => f.size === 0);
    
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
  
  const overallProgress = totalFiles === 0 ? 0 : Math.round((queue.reduce((acc, curr) => acc + curr.progress, 0)) / totalFiles);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-32">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-medium tracking-tight">Pusat Unggahan</h1>
          <Link
            href="/archive"
            onClick={(e) => {
              if (uploadActive) {
                e.preventDefault();
                setShowCloseConfirm(true);
              }
            }}
            className="p-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </Link>
        </div>

        {/* Configuration Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
            <h3 className="text-sm text-white/50 mb-3">Tujuan Penyimpanan</h3>
            <div className="flex bg-black/40 rounded-full p-1 border border-white/5">
              <button
                onClick={() => setCategory('documentation')}
                disabled={uploadActive}
                className={`flex-1 py-2 text-sm font-medium rounded-full transition-colors ${
                  category === 'documentation' ? 'bg-white text-black' : 'text-white hover:bg-white/10'
                }`}
              >
                Dokumentasi
              </button>
              <button
                onClick={() => setCategory('worship')}
                disabled={uploadActive}
                className={`flex-1 py-2 text-sm font-medium rounded-full transition-colors ${
                  category === 'worship' ? 'bg-white text-black' : 'text-white hover:bg-white/10'
                }`}
              >
                File Ibadah
              </button>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 relative">
            <h3 className="text-sm text-white/50 mb-3">Pilih Hari Sabat</h3>
            <button
              onClick={() => !uploadActive && setShowDatePicker(!showDatePicker)}
              className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-left flex justify-between items-center hover:bg-white/5 transition-colors"
            >
              <div>
                <div className="text-sm font-medium text-white">
                  {sabbathList.find(s => s.date === selectedSabbathDate)?.formattedTitle || defaultSabbath?.formattedTitle || 'Sabat Kustom'}
                </div>
                <div className="text-xs text-white/40 mt-1">{selectedSabbathDate}</div>
              </div>
            </button>

            {showDatePicker && (
              <div className="absolute top-full left-0 right-0 mt-2 z-20 bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl max-h-60 overflow-y-auto">
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
                      <span className="text-[10px] uppercase bg-white/10 text-white/60 px-2 py-0.5 rounded-full">Default</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Dropzone */}
        {!uploadActive && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-colors ${
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
            <div className="w-16 h-16 rounded-full bg-white/10 mx-auto flex items-center justify-center mb-4">
              <UploadIcon className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Seret & Letakkan Berkas di Sini</h3>
            <p className="text-white/50 text-sm">Pilih berkas dari perangkat Anda</p>
          </div>
        )}

        {/* Queue Display */}
        {totalFiles > 0 && (
          <div className="mt-8">
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

            <div className="space-y-3">
              {queue.map(item => (
                <div key={item.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-black/50 flex items-center justify-center flex-shrink-0">
                    {item.file.type.startsWith('image/') ? <ImageIcon className="w-5 h-5 text-white/70" /> :
                     item.file.type.startsWith('video/') ? <Video className="w-5 h-5 text-white/70" /> :
                     <FileText className="w-5 h-5 text-white/70" />}
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

      {/* Close Confirmation Modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl text-center">
            <h3 className="text-xl font-medium mb-2">Unggahan Masih Berlangsung</h3>
            <p className="text-white/60 text-sm mb-6">Meninggalkan halaman ini akan membatalkan unggahan yang belum selesai.</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-white/80 transition-colors"
              >
                Tetap di Halaman
              </button>
              <Link
                href="/archive"
                onClick={handleCancelAll}
                className="w-full py-3 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 font-medium transition-colors"
              >
                Batalkan Unggahan
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
