'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Image as ImageIcon, Play, Video as VideoIcon } from 'lucide-react';
import { FileItem } from '@/lib/types';
import { getNearestSabbath } from '@/lib/sabbath';
import MediaViewer from '@/components/MediaViewer';

interface FeaturedSabbath {
  date: string;
  formattedTitle: string;
  year: number;
  quarter: number;
}

function MediaCard({ file, featured, onOpen }: { file: FileItem; featured?: boolean; onOpen: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = file.thumbnailUrl && !imageFailed ? file.thumbnailUrl : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.035] text-left ${featured ? 'md:col-span-2 md:row-span-2 min-h-[30rem]' : 'min-h-[15rem]'}`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={file.name} onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover grayscale transition duration-700 group-hover:scale-[1.035] group-hover:grayscale-0" loading={featured ? 'eager' : 'lazy'} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.08] to-transparent text-white/25">
          {file.fileType === 'video' ? <VideoIcon className="h-10 w-10" /> : <ImageIcon className="h-10 w-10" />}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/5 to-transparent opacity-90" />
      {file.fileType === 'video' && <span className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 backdrop-blur-md"><Play className="h-4 w-4 fill-white" /></span>}
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
        <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">{file.sabbathTitle}</p>
        <h3 className={`${featured ? 'text-2xl sm:text-3xl' : 'text-base'} line-clamp-2 font-light leading-tight text-white`}>{file.name}</h3>
      </div>
    </button>
  );
}

export default function Home() {
  const fallbackSabbath = useMemo(() => getNearestSabbath(), []);
  const [featuredSabbath, setFeaturedSabbath] = useState<FeaturedSabbath>({ date: fallbackSabbath.date, formattedTitle: fallbackSabbath.formattedTitle, year: fallbackSabbath.year, quarter: fallbackSabbath.quarter });
  const [hasArchivedSabbath, setHasArchivedSabbath] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/archive/random?count=12')
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Arsip belum dapat dimuat');
        return json;
      })
      .then((json) => {
        if (!active) return;
        setLoadError(false);
        setMediaFiles(json.success ? json.data || [] : []);
        if (json.success && json.featuredSabbath) {
          setFeaturedSabbath(json.featuredSabbath);
          setHasArchivedSabbath(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setLoadError(true);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  const visibleDates = useMemo(() => {
    const byDate = new Map<string, string>();
    for (const file of mediaFiles) byDate.set(file.sabbathDate, file.sabbathTitle);
    return [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 5);
  }, [mediaFiles]);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black">
      <section className="relative flex min-h-[37rem] w-full items-center overflow-hidden px-6 pb-12 pt-32 sm:px-12 lg:min-h-[min(75svh,47rem)] lg:pb-16">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-[#090909] to-black" />
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="relative h-full w-full max-w-[1100px] overflow-hidden opacity-75 mix-blend-screen">
            <div className="absolute inset-0 z-10 bg-gradient-to-t from-black via-transparent to-black" /><div className="absolute inset-0 z-10 bg-gradient-to-r from-black via-transparent to-black" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/jesus-hero.jpg" alt="Ilustrasi Yesus Kristus" className="h-full w-full object-cover object-center grayscale contrast-125 brightness-90 animate-subtle-zoom" />
          </div>
        </div>

        <div className="relative z-20 mx-auto flex h-full w-full max-w-[1400px] flex-col justify-between gap-20">
          <div className="flex items-center justify-between animate-fade-in-up">
            <div><p className="editorial-meta">DIGITAL ARCHIVE</p><p className="mt-2 text-sm font-light uppercase tracking-[0.2em] text-white/80">GMAHK Galilea</p></div>
            <Link href="/archive?category=documentation" className="hidden items-center gap-3 text-xs uppercase tracking-widest text-white/70 transition hover:text-white md:flex">Jelajahi Arsip <ArrowRight className="h-4 w-4" /></Link>
          </div>

          <div className="mt-auto grid w-full items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)] lg:gap-12">
            <div className="pointer-events-none max-w-[55rem] mix-blend-difference">
              <h1 className="flex flex-col text-[clamp(3.4rem,8.5vw,7.5rem)] font-bold uppercase leading-[0.85] tracking-[-0.065em] lg:text-[clamp(4.5rem,6vw,7rem)]">
                <span>SETIAP SABAT</span><span className="italic text-white/85">MENYIMPAN</span><span className="text-white/65">CERITA.</span>
              </h1>
              <p className="mt-7 max-w-md text-sm leading-relaxed text-white/65 sm:text-base">Momen pelayanan dan kebersamaan jemaat, tersimpan untuk dikenang kembali.</p>
            </div>

            <div className="w-full rounded-[1.5rem] border border-white/25 bg-black/70 p-6 shadow-2xl backdrop-blur-2xl sm:p-7">
              <div className="mb-8 flex items-center justify-between"><span className="editorial-meta text-white/70">{hasArchivedSabbath ? 'ARSIP SABAT TERBARU' : 'SABAT BERIKUTNYA'}</span><span className={`h-2 w-2 rounded-full ${hasArchivedSabbath ? 'bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,.8)]' : 'bg-white/60'}`} /></div>
              {loading ? <div className="mb-8 h-10 w-4/5 rounded bg-white/10 animate-shimmer" /> : <h2 className="mb-8 text-3xl font-light tracking-tight sm:text-4xl">{featuredSabbath.formattedTitle}</h2>}
              <Link href={`/archive?category=documentation&sabbath=${featuredSabbath.date}`} className="group flex items-center justify-between border-t border-white/10 pt-5 text-xs font-mono uppercase tracking-widest">{hasArchivedSabbath ? 'Buka koleksi terbaru' : 'Lihat kalender'}<span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 transition group-hover:bg-white group-hover:text-black"><ArrowRight className="h-4 w-4" /></span></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-20 mx-auto w-full max-w-[1400px] px-6 pb-24 pt-16 sm:px-12 lg:pt-20">
        <div className="mb-10 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div><span className="editorial-eyebrow">KOLEKSI PILIHAN</span><h2 className="text-4xl font-light tracking-tight sm:text-6xl">Galilea dalam gambar.</h2></div>
          <div className="max-w-md md:text-right"><p className="mb-5 text-sm font-light leading-relaxed text-white/50">Lebih banyak momen pelayanan, doa, persahabatan, dan pujian—tersusun dari Sabat terbaru.</p>{visibleDates.length > 0 && <div className="flex flex-wrap gap-2 md:justify-end">{visibleDates.map(([date, title], index) => <Link key={date} href={`/archive?category=documentation&sabbath=${date}`} className={`rounded-full border px-3 py-2 text-[9px] font-mono uppercase tracking-wider transition hover:bg-white hover:text-black ${index === 0 ? 'border-white/50 bg-white/10' : 'border-white/10 text-white/50'}`}>{title}</Link>)}</div>}</div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3"><div className="h-[30rem] rounded-3xl bg-white/5 animate-shimmer md:col-span-2" /><div className="h-[30rem] rounded-3xl bg-white/5 animate-shimmer" /></div>
        ) : loadError ? (
          <div role="alert" className="rounded-[2rem] border border-amber-200/20 bg-amber-100/[0.04] px-6 py-16 text-center"><h3 className="mb-3 text-2xl font-light">Galeri belum dapat dimuat.</h3><p className="mx-auto max-w-md text-sm leading-relaxed text-white/55">Koneksi ke arsip sedang bermasalah. Koleksi yang sudah diunggah tetap tersimpan.</p><button type="button" onClick={() => { setLoading(true); setRetryCount((count) => count + 1); }} className="editorial-button-secondary mt-6">Coba lagi <ArrowRight className="h-4 w-4" /></button></div>
        ) : mediaFiles.length === 0 ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] px-6 py-24 text-center"><ImageIcon className="mx-auto mb-6 h-10 w-10 text-white/25" /><h3 className="mb-3 text-3xl font-light">Belum ada media yang dapat ditampilkan.</h3><p className="mx-auto max-w-md text-sm leading-relaxed text-white/45">Admin dapat mengunggah dokumentasi pertama melalui pusat unggahan.</p></div>
        ) : (
          <div className="grid auto-rows-[14rem] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{mediaFiles.map((file, index) => <MediaCard key={file.id} file={file} featured={index === 0} onOpen={() => setSelectedIndex(index)} />)}</div>
        )}

        <div className="mt-10 flex justify-center"><Link href={`/archive?category=documentation&sabbath=${featuredSabbath.date}`} className="editorial-button-secondary">Lihat semua dokumentasi <ArrowRight className="h-4 w-4" /></Link></div>
      </section>

      <section className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-12 border-t border-white/10 px-6 py-20 sm:px-12 md:grid-cols-2 md:gap-20">
        <Link href="/archive?category=documentation" className="group flex flex-col gap-6"><span className="editorial-meta">GALERI PUBLIK</span><h3 className="text-4xl font-light transition group-hover:text-white/60">Foto & Video</h3><div className="h-px w-12 bg-white/25 transition-all duration-700 group-hover:w-full" /></Link>
        <Link href="/archive?category=worship" className="group flex flex-col gap-6"><span className="editorial-meta">BERKAS PELAYANAN</span><h3 className="text-4xl font-light transition group-hover:text-white/60">Dokumen Ibadah</h3><div className="h-px w-12 bg-white/25 transition-all duration-700 group-hover:w-full" /></Link>
      </section>

      <section className="flex w-full flex-col items-center justify-center bg-black px-6 py-32 text-center"><div className="mb-16 h-24 w-px bg-white/20" /><h2 className="text-2xl font-light uppercase leading-tight tracking-wider text-white/90 sm:text-4xl lg:text-5xl">Sebuah museum digital<br /><span className="italic text-white/40">kehidupan jemaat.</span></h2></section>

      {selectedIndex !== null && mediaFiles[selectedIndex] && <MediaViewer files={mediaFiles} initialIndex={selectedIndex} onClose={() => setSelectedIndex(null)} onFileDeleted={(id) => setMediaFiles((current) => current.filter((file) => file.id !== id))} />}
    </div>
  );
}
