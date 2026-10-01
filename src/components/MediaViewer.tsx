'use client';

import React, { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, ExternalLink, Trash2, FileText, FileSpreadsheet, Presentation, AlertTriangle, Download, Share2, MoreHorizontal } from 'lucide-react';
import { FileItem } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const emptySubscribe = () => () => {};

interface MediaViewerProps {
  file?: FileItem;
  files?: FileItem[];
  initialIndex?: number;
  isOpen?: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onFileDeleted?: (fileId: string) => void;
}

export default function MediaViewer({
  file,
  files,
  initialIndex = 0,
  isOpen = true,
  onClose,
  onNext,
  onPrev,
  onFileDeleted,
}: MediaViewerProps) {
  const { role, getIdToken } = useAuth();
  const { showToast } = useToast();
  const [internalIndex, setInternalIndex] = useState(initialIndex);
  const [prevInitial, setPrevInitial] = useState(initialIndex);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Client-side hydration check for safe createPortal to document.body
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  useEffect(() => {
    console.info('[GALILEA MEDIA VIEWER 4E861B] MediaViewer mounted in React Portal');
  }, []);

  // Sync index during render if initialIndex changed
  if (initialIndex !== prevInitial) {
    setPrevInitial(initialIndex);
    setInternalIndex(initialIndex);
  }

  const currentFile = file ?? (files && files[internalIndex]);
  const hasFiles = Boolean(files && files.length > 0);

  const canGoNext = Boolean(onNext || (hasFiles && files && internalIndex < files.length - 1));
  const canGoPrev = Boolean(onPrev || (hasFiles && internalIndex > 0));

  const handleNext = useCallback(() => {
    if (onNext) {
      onNext();
    } else if (hasFiles && files) {
      setInternalIndex((prev) => (prev < files.length - 1 ? prev + 1 : prev));
    }
  }, [onNext, hasFiles, files]);

  const handlePrev = useCallback(() => {
    if (onPrev) {
      onPrev();
    } else if (hasFiles) {
      setInternalIndex((prev) => (prev > 0 ? prev - 1 : prev));
    }
  }, [onPrev, hasFiles]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && canGoNext) handleNext();
      if (e.key === 'ArrowLeft' && canGoPrev) handlePrev();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, canGoNext, canGoPrev, handleNext, handlePrev]);

  if (!isOpen || !currentFile || !isClient || typeof document === 'undefined') return null;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;

    try {
      setIsDownloading(true);
      const a = document.createElement('a');
      a.href = `/api/archive/download?fileId=${encodeURIComponent(currentFile.id)}`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showToast({
        type: 'success',
        message: 'Unduhan Selesai',
        description: `${currentFile.name} berhasil diunduh.`,
      });
    } catch (error) {
      showToast({
        type: 'error',
        message: 'Unduhan Gagal',
        description: (error as Error).message || 'Terjadi kesalahan saat mengunduh berkas.',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast({
        type: 'info',
        message: 'Link Disalin',
        description: 'Link berkas berhasil disalin.',
      });
    }).catch(() => {
      showToast({
        type: 'error',
        message: 'Gagal Menyalin',
        description: 'Tidak dapat menyalin link ke clipboard.',
      });
    });
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const shareUrl = window.location.href; 
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: currentFile.name,
          text: 'Lihat berkas GMAHK Galilea',
          url: shareUrl,
        });
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          copyToClipboard(shareUrl);
        }
      }
    } else {
      copyToClipboard(shareUrl);
    }
  };

  const handleDeleteClick = () => {
    if (role !== 'admin') {
      showToast({
        type: 'warning',
        message: 'Akses Terbatas',
        description: 'Hanya pengurus yang memiliki wewenang untuk menghapus berkas.',
      });
      return;
    }
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      setIsDeleting(true);
      const idToken = await getIdToken();
      const res = await fetch('/api/admin/trash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          fileId: currentFile.id,
          fileName: currentFile.name,
        }),
      });

      const json = await res.json();
      if (json.success) {
        showToast({
          type: 'success',
          message: 'Berkas Dipindahkan',
          description: `"${currentFile.name}" telah dipindahkan ke Sampah Google Drive.`,
        });
        if (onFileDeleted) {
          onFileDeleted(currentFile.id);
        } else {
          if (hasFiles && files && files.length > 1) {
            if (internalIndex < files.length - 1) {
               handleNext();
            } else {
               handlePrev();
            }
          } else {
            onClose();
          }
        }
      } else {
        showToast({
          type: 'error',
          message: 'Gagal Memindahkan Berkas',
          description: json.error || 'Terjadi kendala saat memindahkan berkas ke Sampah.',
        });
      }
    } catch (err) {
      console.error(err);
      showToast({
        type: 'error',
        message: 'Koneksi Terputus',
        description: 'Tidak dapat menghubungi server. Periksa kembali sambungan internet Anda.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const renderContent = () => {
    switch (currentFile.fileType) {
      case 'photo':
        return (
          <div className="relative w-full h-[60svh] flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/archive/media?fileId=${encodeURIComponent(currentFile.id)}`}
              alt={currentFile.name}
              className="max-h-full max-w-full object-contain drop-shadow-2xl"
            />
          </div>
        );

      case 'video':
        return (
          <div className="w-full max-w-5xl h-[75vh] bg-black border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center">
            <video
              src={`/api/archive/media?fileId=${encodeURIComponent(currentFile.id)}`}
              className="w-full h-full object-contain"
              controls
              playsInline
              preload="metadata"
            >
              Browser Anda belum mendukung pemutar video ini.
            </video>
          </div>
        );

      case 'pdf':
        return (
          <div className="w-full max-w-5xl h-[80vh] bg-black border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <iframe
              src={`/api/archive/media?fileId=${encodeURIComponent(currentFile.id)}`}
              className="w-full flex-1 border-0"
              title={currentFile.name}
            ></iframe>
          </div>
        );

      default:
        return (
          <div className="w-full max-w-md p-10 rounded-3xl bg-black border border-white/10 text-center shadow-2xl flex flex-col items-center">
            <div className="w-20 h-20 mb-6 rounded-full bg-white/5 flex items-center justify-center text-white">
              {currentFile.fileType === 'presentation' ? (
                <Presentation className="w-10 h-10" />
              ) : currentFile.fileType === 'spreadsheet' ? (
                <FileSpreadsheet className="w-10 h-10" />
              ) : (
                <FileText className="w-10 h-10" />
              )}
            </div>
            <h3 className="text-xl font-normal text-white mb-2 break-words leading-tight">{currentFile.name}</h3>
            <p className="text-sm text-white/60 mb-8 font-light">
              Dokumen ini dapat dibuka langsung di Google Drive atau diunduh ke perangkat Anda.
            </p>
          </div>
        );
    }
  };

  // Render directly to document.body using ReactDOM.createPortal()
  // This isolates MediaViewer completely from any ancestor stacking context,
  // transform, backdrop-filter, or layout context in ArchivePage or layout.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      data-testid="media-viewer-portal"
    >
      {/* TASK 4: BACKDROP (z-[9999]) */}
      <div
        className="fixed inset-0 z-[9999] bg-[#090909]/98"
        onClick={onClose}
        aria-modal="true"
        role="dialog"
      />

      {/* TASK 5: CONTENT (z-[10000]) */}
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-8 pb-32 pointer-events-none"
      >
        <div
          className="pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {renderContent()}
        </div>

        {/* Previous / Next navigation buttons */}
        {canGoPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            className="fixed left-2 sm:left-8 top-1/2 -translate-y-1/2 p-2 sm:p-4 bg-black/60 hover:bg-white/20 text-white transition-colors cursor-pointer pointer-events-auto z-[10005]"
            aria-label="Sebelumnya"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {canGoNext && (
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            className="fixed right-2 sm:right-8 top-1/2 -translate-y-1/2 p-2 sm:p-4 bg-black/60 hover:bg-white/20 text-white transition-colors cursor-pointer pointer-events-auto z-[10005]"
            aria-label="Selanjutnya"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* TASK 6: ACTION BAR (z-[10010]) */}
      <div
        className="fixed top-0 left-0 right-0 z-[10010] p-4 sm:p-6 flex items-start justify-between text-white pointer-events-none"
        data-testid="media-action-bar"
      >
        {/* Left spacer / marker */}
        <div className="max-w-2xl hidden sm:block text-[10px] font-mono tracking-[.2em] text-white/50 pt-3">GALILEA / MEDIA VIEWER
          <div className="hidden" data-testid="marker-galilea">[GALILEA MEDIA VIEWER 4E861B]</div>
        </div>

        {/* Right action bar buttons (pointer-events-auto) */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 ml-auto pointer-events-auto">

          <button
            onClick={handleDownload}
            disabled={isDownloading}
            data-testid="media-download"
            className="flex items-center justify-center h-10 sm:h-11 px-3 sm:px-4 gap-2 bg-[#e9e5dc] text-black hover:bg-white font-medium transition-colors"
            title="Unduh"
          >
            <Download className="w-4 h-4" />
            <span className="text-sm font-semibold">
              {isDownloading ? (
                'MENYIAPKAN...'
              ) : 'UNDUH'}
            </span>
          </button>

          <button
            onClick={handleShare}
            data-testid="media-share"
            className="flex items-center justify-center h-10 sm:h-11 px-3 sm:px-4 gap-2 bg-[#22211f] hover:bg-white/20 text-white transition-colors"
            title="Bagikan"
          >
            <Share2 className="w-4 h-4" />
            <span className="text-sm font-semibold">BAGIKAN</span>
          </button>

          {(currentFile.webViewLink || role === 'admin') && <div className="relative">
            <button type="button" onClick={() => setMoreOpen(value => !value)} aria-expanded={moreOpen} aria-label="Tindakan lainnya" className="h-10 sm:h-11 w-10 sm:w-11 bg-[#22211f] hover:bg-white/20 flex items-center justify-center"><MoreHorizontal size={20} /></button>
            {moreOpen && <div className="absolute right-0 top-full mt-2 min-w-48 bg-[#242320] border border-white/15 p-2 shadow-2xl">
          {currentFile.webViewLink && (
            <a
              href={currentFile.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="media-drive"
              className="flex items-center gap-3 p-3 text-xs hover:bg-white/10"
              title="Buka di Google Drive"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-4 h-4" /> Google Drive
            </a>
          )}

          {role === 'admin' && (
            <button
              onClick={handleDeleteClick}
              disabled={isDeleting}
              data-testid="media-delete"
              className="flex items-center gap-3 p-3 text-xs text-white/70 hover:bg-white/10"
              title="Pindahkan ke Sampah"
              aria-label="Pindahkan ke Sampah"
            >
              {isDeleting ? <span>MEMINDAHKAN...</span> : <><Trash2 className="w-4 h-4" /> Pindahkan ke Sampah</>}
            </button>
          )}
            </div>}
          </div>}

          <button
            onClick={onClose}
            data-testid="media-close"
            className="flex items-center justify-center h-10 sm:h-11 w-10 sm:w-11 bg-[#22211f] hover:bg-white/20 text-white transition-colors ml-1"
            title="Tutup"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* TASK 7: BOTTOM INFO BAR (z-[10000]) */}
      <div className="fixed bottom-0 left-0 right-0 z-[10000] px-4 sm:px-8 pb-5 flex flex-col items-center justify-center pointer-events-none">
        {hasFiles && files && !file && <div className="viewer-filmstrip" aria-label="Pilih media">
          {files.map((item, index) => <button key={item.id} type="button" aria-label={`Buka ${item.name}`} aria-pressed={internalIndex === index} onClick={() => setInternalIndex(index)}>
            {item.thumbnailUrl || item.fileType === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl || `/api/archive/media?fileId=${encodeURIComponent(item.id)}`} alt="" loading="lazy" />
            ) : <FileText size={20}/>}
          </button>)}
        </div>}
        <div
          className="bg-[#121211] px-5 py-4 flex flex-col items-start max-w-3xl w-full text-left border-t border-white/25 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-white font-normal font-serif text-lg mb-2 truncate w-full">{currentFile.name}</h2>
          <div className="flex items-center justify-start gap-3 text-[10px] font-mono tracking-wider text-white/50 flex-wrap uppercase font-light">
            <span>{currentFile.sabbathTitle}</span>
            <span className="w-1 h-1 rounded-full bg-white/30"></span>
            <span>{currentFile.category === 'documentation' ? 'Dokumentasi' : 'File Ibadah'}</span>
            <span className="w-1 h-1 rounded-full bg-white/30"></span>
            <span>{currentFile.fileType}</span>
            {hasFiles && files && (
              <>
                <span className="w-1 h-1 rounded-full bg-white/30"></span>
                <span>{internalIndex + 1} / {files.length}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* TASK 8: DELETE CONFIRMATION MODAL (z-[10020]) */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-black border border-white/10 rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-5 text-white">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-medium text-white mb-2">Pindahkan ke Sampah?</h3>
            <p className="text-white/60 text-sm mb-8 leading-relaxed font-light">
              Apakah Anda yakin ingin memindahkan <span className="font-medium text-white">{currentFile.name}</span> ke Sampah Google Drive?
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={confirmDelete}
                className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-white/80 text-black text-sm font-medium transition-colors"
              >
                Pindahkan ke Sampah
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="w-full py-3.5 px-4 rounded-xl bg-white/5 hover:bg-neutral-200 text-white text-sm font-medium transition-colors"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
