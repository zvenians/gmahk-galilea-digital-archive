'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Search,
} from 'lucide-react';
import { ArchiveCategory, FileItem, SabbathInfo } from '@/lib/types';
import { getNearestSabbath } from '@/lib/sabbath';
import MediaViewer from '@/components/MediaViewer';

function ArchiveContent() {
  const searchParams = useSearchParams();
  const initialCategory = (searchParams.get('category') as ArchiveCategory) || 'documentation';
  const initialSabbath = searchParams.get('sabbath') || '';

  const initialNearest = getNearestSabbath();
  const [year, setYear] = useState<number>(initialNearest.year);
  const [quarter, setQuarter] = useState<number>(initialNearest.quarter);
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video' | 'document'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [availableYears, setAvailableYears] = useState<number[]>([initialNearest.year, initialNearest.year - 1]);
  const [quarters, setQuarters] = useState<Array<{ quarter: number; title: string }>>([
    { quarter: 1, title: 'Triwulan I' },
    { quarter: 2, title: 'Triwulan II' },
    { quarter: 3, title: 'Triwulan III' },
    { quarter: 4, title: 'Triwulan IV' },
  ]);

  const [sabbaths, setSabbaths] = useState<SabbathInfo[]>([]);
  const [selectedSabbath, setSelectedSabbath] = useState<string>(initialSabbath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    const sabbathParam = selectedSabbath ? `&sabbath=${encodeURIComponent(selectedSabbath)}` : '';
    const url = `/api/archive/tree?year=${year}&quarter=${quarter}&category=${category}${sabbathParam}`;

    fetch(url)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Arsip belum dapat dimuat');
        return json;
      })
      .then((json) => {
        if (isMounted && json.success && json.data) {
          setLoadError(false);
          if (json.data.availableYears?.length) {
            setAvailableYears(json.data.availableYears);
          }
          if (json.data.quarters?.length) {
            setQuarters(json.data.quarters);
          }
          setSabbaths(json.data.sabbaths || []);
          if (json.data.selectedSabbath && selectedSabbath !== json.data.selectedSabbath) {
            setSelectedSabbath(json.data.selectedSabbath);
          }
          setFiles(json.data.files || []);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Archive tree fetch error:', err);
        setFiles([]);
        setLoadError(true);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, [year, quarter, category, selectedSabbath, retryCount]);

  const filteredFiles = files.filter((file) => {
    let matchType = true;
    if (filterType === 'photo') matchType = file.fileType === 'photo';
    else if (filterType === 'video') matchType = file.fileType === 'video';
    else if (filterType === 'document') {
      matchType = ['pdf', 'presentation', 'document', 'spreadsheet', 'other'].includes(file.fileType);
    }
    const matchSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchSearch;
  });

  const getEmptyMessage = () => {
    if (searchQuery.trim()) return 'Kami belum menemukan yang Anda cari.';
    if (filterType === 'photo') return 'Belum ada foto di sini.';
    if (filterType === 'video') return 'Belum ada video di sini.';
    if (filterType === 'document' || category === 'worship') return 'Belum ada berkas ibadah.';
    return 'Belum ada dokumentasi di sini. Simpan momen untuk dikenang bersama.';
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black pb-32">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-12">
        
        {/* 1. EDITORIAL OPENING */}
        <section className="pt-24 sm:pt-32 pb-16">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-12">
            <div>
              <span className="editorial-eyebrow">
                {category === 'documentation' ? 'ARSIP FOTOGRAFI & VISUAL' : 'ARSIP BERKAS IBADAH'}
              </span>
              <h1 className="editorial-title uppercase">
                {category === 'documentation' ? 'DOKUMENTASI' : 'BERKAS'}
              </h1>
              <p className="editorial-desc mt-6">
                {category === 'documentation'
                  ? 'Jelajahi kembali memori pelayanan, Sabat, dan kebersamaan jemaat Galilea dalam arsip visual.'
                  : 'Kumpulan tata ibadah, presentasi, dan materi pengajaran jemaat Galilea.'}
              </p>
            </div>

            {/* Category Toggle */}
            <div className="flex flex-col gap-2 bg-white/5 border border-white/10 p-2 rounded-2xl w-full md:w-auto">
              <button
                onClick={() => {
                  if (category !== 'documentation') {
                    setLoading(true);
                    setSelectedSabbath('');
                    setCategory('documentation');
                  }
                }}
                className={`px-6 py-3 rounded-xl text-xs font-mono tracking-widest uppercase transition-all ${
                  category === 'documentation' ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                }`}
              >
                FOTO & VIDEO
              </button>
              <button
                onClick={() => {
                  if (category !== 'worship') {
                    setLoading(true);
                    setSelectedSabbath('');
                    setCategory('worship');
                  }
                }}
                className={`px-6 py-3 rounded-xl text-xs font-mono tracking-widest uppercase transition-all ${
                  category === 'worship' ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                }`}
              >
                BERKAS IBADAH
              </button>
            </div>
          </div>
        </section>

        {/* 2. TIMELINE NAVIGATION (YEAR / QUARTER) */}
        <div className="py-8 border-y border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="flex flex-wrap items-center gap-6">
            <span className="editorial-meta">GALILEA /</span>
            <select
              value={year}
              onChange={(e) => {
                const newYear = parseInt(e.target.value, 10);
                setLoading(true);
                setSelectedSabbath('');
                setYear(newYear);
              }}
              className="bg-transparent text-2xl sm:text-4xl font-light text-white focus:outline-none cursor-pointer appearance-none"
            >
              {availableYears.map((y) => (
                <option key={y} className="bg-black text-white" value={y}>
                  {y}
                </option>
              ))}
            </select>

            <div className="w-[1px] h-8 bg-white/10 hidden sm:block" />

            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              {quarters.map((q) => (
                <button
                  key={q.quarter}
                  onClick={() => {
                    if (quarter !== q.quarter) {
                      setLoading(true);
                      setSelectedSabbath('');
                      setQuarter(q.quarter);
                    }
                  }}
                  className={`px-5 py-2.5 rounded-full text-[10px] font-mono tracking-widest uppercase transition-all whitespace-nowrap ${
                    quarter === q.quarter ? 'bg-white text-black' : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {q.title.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="relative max-w-sm w-full">
            <Search className="w-4 h-4 text-white/30 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari dalam arsip..."
              className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-full text-white placeholder-white/30 text-sm focus:outline-none focus:border-white/40 transition-colors"
            />
          </div>
        </div>

        {/* 3. SABBATH SELECTOR (TIMELINE) */}
        {sabbaths.length > 0 && (
          <section className="border-b border-white/10 py-8">
            <div className="mb-5 flex items-end justify-between gap-6">
              <div>
                <span className="editorial-meta">PILIH TANGGAL SABAT</span>
                <h2 className="mt-2 text-2xl font-light text-white">{sabbaths.find((sab) => sab.date === selectedSabbath)?.formattedTitle || 'Koleksi terbaru'}</h2>
              </div>
              <span className="hidden text-[10px] font-mono uppercase tracking-[0.18em] text-white/35 sm:block">Geser untuk melihat tanggal lain</span>
            </div>
            <div className="scrollbar-none flex snap-x items-stretch gap-3 overflow-x-auto pb-2">
              {sabbaths.map((sab) => {
                const isSelected = selectedSabbath === sab.date || selectedSabbath === sab.formattedTitle;
                const parts = /^\d{4}-\d{2}-\d{2}$/.test(sab.date) ? sab.date.split('-') : null;
                return (
                  <button
                    key={sab.date}
                    onClick={() => {
                      if (selectedSabbath !== sab.date) {
                        setLoading(true);
                        setSelectedSabbath(sab.date);
                      }
                    }}
                    className={`min-w-[9.5rem] snap-start rounded-2xl border p-4 text-left transition-all ${isSelected ? 'border-white bg-white text-black shadow-[0_18px_50px_rgba(255,255,255,.12)]' : 'border-white/10 bg-white/[0.025] text-white hover:border-white/30 hover:bg-white/[0.06]'}`}
                  >
                    <span className={`block text-[9px] font-mono uppercase tracking-[0.18em] ${isSelected ? 'text-black/50' : 'text-white/35'}`}>{isSelected ? 'TERPILIH' : sab.isUpcoming ? 'MENDATANG' : 'ARSIP'}</span>
                    {parts ? <><span className="mt-5 block text-3xl font-light leading-none">{Number(parts[2])}</span><span className={`mt-2 block text-[10px] font-mono uppercase tracking-wider ${isSelected ? 'text-black/60' : 'text-white/55'}`}>{sab.formattedTitle.replace(/^\d+\s+/, '')}</span></> : <span className="mt-5 block text-sm font-light">{sab.formattedTitle}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* 3.5. TYPE FILTERS */}
        <div className="pt-8 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(
              [
                { id: 'all', label: 'SEMUA' },
                { id: 'photo', label: 'FOTO' },
                { id: 'video', label: 'VIDEO' },
                { id: 'document', label: 'DOKUMEN' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterType(f.id)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-mono tracking-widest uppercase transition-all cursor-pointer ${
                  filterType === f.id
                    ? 'bg-white text-black'
                    : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <span className="editorial-meta">
            {loading ? 'MEMUAT...' : loadError ? 'ARSIP TIDAK TERSEDIA' : `${filteredFiles.length} BERKAS`}
          </span>
        </div>

        {/* 4. GALLERY */}
        <div className="pt-8">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 animate-fade-in">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex flex-col gap-4">
                  <div className="aspect-[4/3] w-full rounded-2xl bg-white/5 animate-shimmer" />
                  <div className="h-4 w-1/2 rounded bg-white/5 animate-shimmer" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div role="alert" className="flex flex-col items-center rounded-3xl border border-amber-200/20 bg-amber-100/[0.04] px-6 py-20 text-center">
              <h2 className="mb-4 text-3xl font-light">Arsip belum dapat dimuat.</h2>
              <p className="max-w-md text-sm leading-relaxed text-white/55">Koneksi ke Google Drive sedang bermasalah. Berkas yang tersimpan tidak terhapus.</p>
              <button type="button" onClick={() => { setLoading(true); setRetryCount((count) => count + 1); }} className="editorial-button-secondary mt-7">Coba lagi</button>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="py-40 flex flex-col items-center justify-center text-center">
              <h2 className="text-3xl sm:text-5xl font-light text-white/20 mb-6 uppercase tracking-tight">KOSONG</h2>
              <p className="editorial-desc mb-8">{getEmptyMessage()}</p>
            </div>
          ) : (
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-8 space-y-8 animate-fade-in-up">
              {filteredFiles.map((file, idx) => {
                return (
                  <div
                    key={file.id}
                    onClick={() => setViewerIndex(idx)}
                    className="group cursor-pointer break-inside-avoid relative overflow-hidden rounded-2xl bg-white/5 border border-white/10"
                  >
                    {file.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={file.thumbnailUrl}
                        alt={file.name}
                        onError={(event) => {
                          const fallback = `/api/archive/media?fileId=${encodeURIComponent(file.id)}`;
                          if (event.currentTarget.src !== new URL(fallback, window.location.origin).href) {
                            event.currentTarget.src = fallback;
                          }
                        }}
                        className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105 filter grayscale hover:grayscale-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-[4/3] flex items-center justify-center text-white/20">
                        {file.fileType === 'video' ? <VideoIcon className="w-12 h-12" /> : file.fileType === 'photo' ? <ImageIcon className="w-12 h-12" /> : <FileText className="w-12 h-12" />}
                      </div>
                    )}
                    
                    <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white text-[9px] font-mono tracking-widest uppercase">
                      {file.fileType}
                    </div>

                    <div className="absolute inset-x-0 bottom-0 p-6 pt-12 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                      <p className="text-white text-lg font-medium drop-shadow-md truncate">{file.name}</p>
                      <p className="editorial-meta mt-1">{file.sabbathTitle}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {viewerIndex !== null && filteredFiles[viewerIndex] && (
        <MediaViewer
          file={filteredFiles[viewerIndex]}
          files={filteredFiles}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNext={viewerIndex < filteredFiles.length - 1 ? () => setViewerIndex(viewerIndex + 1) : undefined}
          onPrev={viewerIndex > 0 ? () => setViewerIndex(viewerIndex - 1) : undefined}
          onFileDeleted={(deletedId) => {
            setFiles((prev) => prev.filter((f) => f.id !== deletedId));
            // Background refetch with cache busting
            const sabbathParam = selectedSabbath ? `&sabbath=${encodeURIComponent(selectedSabbath)}` : '';
            const url = `/api/archive/tree?year=${year}&quarter=${quarter}&category=${category}${sabbathParam}&_t=${Date.now()}`;
            fetch(url)
              .then((res) => res.json())
              .then((json) => {
                if (json.success && json.data) {
                  setFiles(json.data.files || []);
                  if (json.data.sabbaths) {
                    setSabbaths(json.data.sabbaths);
                  }
                  if (json.data.availableYears?.length) {
                    setAvailableYears(json.data.availableYears);
                  }
                  if (json.data.quarters?.length) {
                    setQuarters(json.data.quarters);
                  }
                }
              })
              .catch(console.error);
          }}
        />
      )}
    </div>
  );
}

export default function ArchivePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ArchiveContent />
    </Suspense>
  );
}
