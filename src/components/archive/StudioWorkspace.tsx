"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, FileText, Play, Search, Share2, Upload, X } from "lucide-react";
import type { ArchiveCategory, FileItem, SabbathInfo } from "@/lib/types";
import { getNearestSabbath, getSabbathsInQuarter, isValidSabbathDate, parseSabbathDetails } from "@/lib/sabbath";
import MediaViewer from "@/components/MediaViewer";
import StudioAccount from "./StudioAccount";
import HeroDeck from "./HeroDeck";
import { galleryRows } from "./gallery-layout";
import styles from "./studio.module.css";

type Filter = "all" | "photo" | "video" | "document";
type Props = { mode: "selection" | "archive"; initialCategory?: ArchiveCategory; initialSabbath?: string };
const displayTitle = (file: FileItem) => /^(IMG|DSC|VID|PXL)[_\d-]/i.test(file.name) ? `${file.fileType === "video" ? "Video" : "Momen"} · ${file.sabbathTitle}` : file.name;
const kind = (file: FileItem) => file.fileType === "photo" ? "Foto" : file.fileType === "video" ? "Video" : file.fileType === "pdf" ? "PDF" : "Dokumen";
const sizeLabel = (size: number) => !size ? "Ukuran tidak tersedia" : size < 1048576 ? `${Math.round(size / 1024)} KB` : `${(size / 1048576).toFixed(1)} MB`;

function Thumb({ file, onRatio }: { file: FileItem; onRatio?: (id: string, ratio: number) => void }) {
  const [failed, setFailed] = useState(false);
  const src = file.thumbnailUrl || (file.fileType === "photo" ? `/api/archive/media?fileId=${encodeURIComponent(file.id)}` : "");
  if (!src || failed) return <span className={styles.placeholder}><FileText size={32} strokeWidth={1} /><small>{kind(file)}</small></span>;
  return <Image src={src} alt={file.name} fill unoptimized sizes="(max-width: 700px) 90vw, 45vw" onError={() => setFailed(true)} onLoad={(event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth && naturalHeight) onRatio?.(file.id, naturalWidth / naturalHeight);
  }} />;
}

export default function StudioWorkspace({ mode, initialCategory = "documentation", initialSabbath = "" }: Props) {
  const initial = useMemo(() => isValidSabbathDate(initialSabbath) ? parseSabbathDetails(initialSabbath)! : getNearestSabbath(), [initialSabbath]);
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [year, setYear] = useState(initial.year);
  const [quarter, setQuarter] = useState(initial.quarter);
  const [sabbath, setSabbath] = useState(initialSabbath);
  const [years, setYears] = useState([initial.year, initial.year - 1]);
  const [sabbaths, setSabbaths] = useState<SabbathInfo[]>(getSabbathsInQuarter(initial.year, initial.quarter));
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [deckIndex, setDeckIndex] = useState(0);
  const [shareStatus, setShareStatus] = useState("");
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [width, setWidth] = useState(900);
  const galleryRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ year: String(year), quarter: String(quarter), category });
    if (sabbath) params.set("sabbath", sabbath);
    const url = mode === "selection" ? "/api/archive/random?count=12" : `/api/archive/tree?${params}`;
    fetch(url, { signal: controller.signal }).then(async response => {
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error("Archive unavailable");
      return json;
    }).then(json => {
      setError(false);
      if (mode === "selection") {
        setFiles(json.data || []);
        setDeckIndex(0);
      } else {
        setFiles(json.data.files || []);
        setSabbaths(json.data.sabbaths || []);
        if (json.data.availableYears?.length) setYears(json.data.availableYears);
        if (json.data.selectedSabbath) setSabbath(json.data.selectedSabbath);
      }
    }).catch(err => { if (err.name !== "AbortError") { setError(true); setFiles([]); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, year, quarter, category, sabbath, retry]);

  useEffect(() => {
    if (mode !== "archive" || !galleryRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(galleryRef.current);
    return () => observer.disconnect();
  }, [mode]);

  const closeDetail = useCallback(() => setSelectedId(null), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !viewerId) closeDetail(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDetail, viewerId]);

  useEffect(() => {
    if (!selectedId || viewerId) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = detailRef.current;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel?.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = bodyOverflow; panel?.removeEventListener("keydown", trap); previous?.focus(); };
  }, [selectedId, viewerId]);

  const visibleFiles = useMemo(() => files.filter(file => (filter === "all" || (filter === "document" ? !["photo", "video"].includes(file.fileType) : file.fileType === filter)) && file.name.toLocaleLowerCase("id").includes(search.toLocaleLowerCase("id").trim())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "id") : sort === "oldest" ? a.sabbathDate.localeCompare(b.sabbathDate) : b.sabbathDate.localeCompare(a.sabbathDate)), [files, filter, search, sort]);
  const deckFiles = files.filter(file => file.fileType === "photo" || file.fileType === "video").slice(0, 9);
  const activeIndex = Math.min(deckIndex, Math.max(0, deckFiles.length - 1));
  const selected = files.find(file => file.id === selectedId);
  const detailFiles = visibleFiles.some(file => file.id === selectedId) ? visibleFiles : files;
  const detailIndex = detailFiles.findIndex(file => file.id === selectedId);
  const viewerIndex = visibleFiles.findIndex(file => file.id === viewerId);
  const ratioFor = (file: FileItem) => ratios[file.id] || (!["photo", "video"].includes(file.fileType) ? .707 : file.fileType === "video" ? 16 / 9 : 4 / 3);
  const rows = galleryRows(visibleFiles, Math.max(200, width), ratioFor);
  const uploadHref = `/upload?category=${category}${isValidSabbathDate(sabbath) ? `&sabbath=${encodeURIComponent(sabbath)}&step=files` : ''}`;
  const onRatio = useCallback((id: string, ratio: number) => setRatios(current => current[id] === ratio ? current : { ...current, [id]: ratio }), []);

  function moveDepth(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--ry", `${((event.clientX - rect.left) / rect.width - .5) * 5}deg`);
    event.currentTarget.style.setProperty("--rx", `${(.5 - (event.clientY - rect.top) / rect.height) * 4}deg`);
  }
  function resetDepth(event: PointerEvent<HTMLElement>) { event.currentTarget.style.setProperty("--rx", "0deg"); event.currentTarget.style.setProperty("--ry", "0deg"); }
  function choose(file: FileItem) {
    if (file.fileType === 'photo' || file.fileType === 'video') {
      setSelectedId(null);
      setViewerId(file.id);
    } else setSelectedId(file.id);
  }
  function changeArchive(update: () => void) { setSelectedId(null); setSabbath(""); setLoading(true); update(); setRetry(current => current + 1); }
  async function shareFile(file: FileItem) {
    const url = new URL(`/archive?category=${file.category}&sabbath=${file.sabbathDate}`, window.location.origin).toString();
    try {
      const nativeShare = typeof navigator.share === "function";
      if (nativeShare) await navigator.share({ title: file.name, url });
      else await navigator.clipboard.writeText(url);
      setShareStatus(nativeShare ? "Siap dibagikan" : "Tautan disalin");
      window.setTimeout(() => setShareStatus(""), 1800);
    } catch (err) { if ((err as Error).name !== "AbortError") { setShareStatus("Bagikan dari tampilan berkas"); setViewerId(file.id); } }
  }
  function tile(file: FileItem, height: number) {
    return <button key={file.id} type="button" aria-label={`${file.fileType === "photo" || file.fileType === "video" ? "Lihat" : "Detail"} ${file.name}`} aria-pressed={selectedId === file.id} className={`${styles.tile} ${selectedId === file.id ? styles.tileSelected : ""}`} style={{ width: height * ratioFor(file), "--tile-height": `${height}px` } as CSSProperties} onPointerMove={moveDepth} onPointerLeave={resetDepth} onClick={() => choose(file)}>
      <span className={styles.tileMedia}><Thumb file={file} onRatio={onRatio} />{file.fileType === "video" && <Play className={styles.play} size={22} fill="currentColor" />}</span>
      <span className={styles.tileCaption}><span>{displayTitle(file)}</span><small>{kind(file)} <span aria-hidden="true">·</span> {file.sabbathTitle}</small></span>
    </button>;
  }

  return <div className={styles.studio}>
    <div className={styles.prayerBackdrop} aria-hidden="true" />
    {mode === "selection" ? <>
      <section className={`${styles.hero} ${styles.deckHero}`} aria-labelledby="hero-heading">
        <Link href="/" className={styles.canvasLogo} aria-label="Galilea Digital Archive, beranda"><Image src="/adventist-logo.svg" alt="Logo Adventist" width={40} height={48} /></Link>
        <div className={styles.canvasAccount}><StudioAccount /></div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>ARSIP JEMAAT GALILEA</p>
          <h1 id="hero-heading">GALILEA<span>DIGITAL ARCHIVE</span></h1>
          <p className={styles.intro}>Kenangan yang hidup. Iman yang menyatukan.</p>
          <Link className={styles.primaryLink} href="/archive?category=documentation">Jelajahi Arsip <ArrowRight size={17} /></Link>
        </div>
        <div className={styles.deckStage}>
          {deckFiles.length ? <HeroDeck files={deckFiles} activeIndex={activeIndex} onChange={setDeckIndex} onOpen={choose} renderMedia={file => <Thumb file={file} onRatio={onRatio} />} /> : <div className={styles.deckEmpty}>{loading ? "Memuat foto…" : error ? <span>Koleksi belum bisa dimuat. <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Coba lagi</button></span> : "Foto arsip akan tampil di sini."}</div>}
        </div>
        <div className={styles.heroActions}><Link href="/archive"><FileText size={16} /> Arsip</Link><Link href="/upload"><Upload size={16} /> Unggah</Link></div>
      </section>
      <section className={styles.categories} aria-labelledby="categories-heading"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>KOLEKSI ARSIP</p><h2 id="categories-heading">Jelajahi <em>Arsip</em></h2></div></div><div className={styles.categoryGrid}><Link href="/archive?category=documentation" className={styles.categoryCard}><span className={styles.categoryVisual}>{deckFiles[0] && <Thumb file={deckFiles[0]} />}</span><span className={styles.categoryContent}><small>FOTO & VIDEO</small><strong>Dokumentasi</strong><span>Foto dan video kegiatan jemaat.</span><ArrowRight size={22} /></span></Link><Link href="/archive?category=worship" className={`${styles.categoryCard} ${styles.categoryWorship}`}><span className={styles.categoryVisual}><FileText size={92} strokeWidth={.5} /></span><span className={styles.categoryContent}><small>DOKUMEN</small><strong>Berkas Ibadah</strong><span>Materi ibadah, presentasi, dan dokumen jemaat.</span><ArrowRight size={22} /></span></Link></div><div className={styles.endLink}><Link href="/archive">Lihat seluruh arsip <ArrowRight size={17} /></Link><Link href="/upload">Punya dokumentasi? Unggah di sini <Upload size={16} /></Link></div></section>
      <section className={styles.featured} aria-labelledby="featured-heading"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>DARI GALERI JEMAAT</p><h2 id="featured-heading">Momen <em>Pilihan</em></h2></div><span className={styles.sectionNote}>Foto dan video dari arsip jemaat</span></div><div className={styles.featuredStrip}>{files.slice(0, 8).map((file, index) => <button type="button" key={file.id} className={styles.featuredItem} onClick={() => choose(file)}><span className={styles.featuredImage}><Thumb file={file} /></span><span className={styles.featuredIndex}>{String(index + 1).padStart(2, "0")}</span><span className={styles.featuredName}>{displayTitle(file)}</span></button>)}</div></section>
    </> : <main className={styles.archive}>
      <div className={styles.archiveTop}><Link href="/" className={styles.back} aria-label="Kembali ke beranda"><ArrowLeft size={17} /></Link><div className={styles.archiveActions}><Link href={`/upload?category=${category}${sabbath ? `&sabbath=${encodeURIComponent(sabbath)}` : ""}`} className={styles.uploadLink} aria-label="Unggah berkas"><Upload size={17} /></Link><StudioAccount /></div></div>
      <div className={styles.archiveTitle}><div><h1>{year}</h1><p>Triwulan {quarter} / Arsip jemaat</p></div><span className={styles.archiveCount}>{visibleFiles.length.toString().padStart(2, "0")} <small>FILE</small></span></div>
      <div className={styles.context}><div className={styles.categoryTabs} aria-label="Kategori">{(["documentation", "worship"] as ArchiveCategory[]).map(value => <button type="button" key={value} className={category === value ? styles.active : ""} aria-pressed={category === value} onClick={() => { if (category !== value) changeArchive(() => setCategory(value)); }}>{value === "documentation" ? "Dokumentasi" : "Berkas Ibadah"}</button>)}</div><div className={styles.period}><label>Tahun <select aria-label="Tahun" value={year} onChange={event => changeArchive(() => setYear(Number(event.target.value)))}>{[...new Set([year, ...years])].sort((a, b) => b - a).map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Triwulan <select aria-label="Triwulan" value={quarter} onChange={event => changeArchive(() => setQuarter(Number(event.target.value)))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>0{value}</option>)}</select></label></div></div>
      <div className={styles.timelineHead}><span className={styles.eyebrow}>TANGGAL SABAT</span><span>Geser untuk memilih tanggal <ArrowRight size={13} /></span></div>
      <div className={styles.timeline} role="group" aria-label="Pilih Sabat">{sabbaths.map(info => <button type="button" key={info.date} className={`${styles.date} ${sabbath === info.date ? styles.dateActive : ""}`} onClick={() => { if (sabbath !== info.date) { setSabbath(info.date); setLoading(true); setSelectedId(null); } }}><small>{info.date.slice(0, 7).replace("-", " / ")}</small><strong>{info.date.slice(8)}</strong><span>{info.formattedTitle}</span></button>)}</div>
      <div className={styles.galleryTop}><div><p className={styles.eyebrow}>KOLEKSI / {category === "documentation" ? "DOKUMENTASI" : "BERKAS IBADAH"}</p><h2>{sabbath ? sabbaths.find(info => info.date === sabbath)?.formattedTitle || "Sabat Pilihan" : "Pilih Sabat"}</h2></div><div className={styles.galleryControls}><div className={styles.typeTabs} aria-label="Jenis berkas">{([ ["all", "Semua"], ["photo", "Foto"], ["video", "Video"], ["document", "Dokumen"] ] as [Filter, string][]).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? styles.typeActive : ""} onClick={() => { setFilter(value); setSelectedId(null); }}>{label}</button>)}</div><label className={styles.search}><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari dalam koleksi ini" aria-label="Cari dalam koleksi ini" /></label><select className={styles.sort} aria-label="Urutkan koleksi" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Terbaru</option><option value="oldest">Terlama</option><option value="name">Nama</option></select></div></div>
<div ref={galleryRef} className={styles.gallery}>{loading ? <div className={styles.empty}>Memuat koleksi…</div> : error ? <div className={styles.empty}>Koleksi belum bisa dimuat. <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Coba lagi</button></div> : !visibleFiles.length ? <div className={styles.empty}>Belum ada berkas di pilihan ini. <Link href={`/upload?category=${category}${sabbath ? `&sabbath=${encodeURIComponent(sabbath)}` : ""}`}>Unggah dokumentasi <ArrowRight size={14} /></Link></div> : rows.map((row, index) => <div key={index} className={styles.galleryRow}>{row.items.map(file => tile(file, row.height))}</div>)}</div>
      <section className={styles.galleryUpload} aria-labelledby="gallery-upload-heading">
        <div>
          <p className={styles.eyebrow}>{category === 'documentation' ? 'DOKUMENTASI' : 'BERKAS IBADAH'}{isValidSabbathDate(sabbath) ? ` · ${parseSabbathDetails(sabbath).formattedTitle}` : ''}</p>
          <h2 id="gallery-upload-heading">{category === 'documentation' ? 'Punya foto atau video lainnya?' : 'Ada berkas yang ingin ditambahkan?'}</h2>
          <p>Unggah di sini. Tidak perlu masuk akun.</p>
        </div>
        <Link href={uploadHref} className={styles.galleryUploadButton}><Upload size={18} />{category === 'documentation' ? 'Unggah foto / video' : 'Unggah berkas'}<ArrowRight size={17} /></Link>
      </section>
    </main>}
    {selected && <div className={styles.detailLayer}>
      <button type="button" className={styles.detailBackdrop} aria-label="Tutup detail" onClick={closeDetail} />
      <aside ref={detailRef} tabIndex={-1} role="dialog" aria-modal="true" className={styles.detail} aria-label={`Detail ${selected.name}`}>
        <div className={styles.detailTop}><button type="button" onClick={closeDetail} aria-label="Tutup detail"><X size={20} /></button></div>
        <div className={styles.detailImage}>
          <div key={selected.id} className={styles.detailObject} style={{ '--object-ratio': ratioFor(selected) } as CSSProperties}><Thumb file={selected} onRatio={onRatio} /></div>
          <span className={styles.objectShadow} aria-hidden="true" />
        </div>
        <div className={styles.detailBody}>
          <p className={styles.eyebrow}>GALILEA / {selected.year}</p>
          <h2>{selected.sabbathTitle || selected.name}</h2>
          <p className={styles.detailContext}>{selected.category === 'documentation' ? 'Dokumentasi' : 'Berkas Ibadah'}<span>Triwulan {['I', 'II', 'III', 'IV'][selected.quarter - 1]}</span></p>
          <dl className={styles.objectMetadata}>
            <div><dt>Nama file</dt><dd>{selected.name}</dd></div>
            <div><dt>Format / ukuran</dt><dd>{selected.mimeType.split('/').pop()?.toUpperCase()} <span>·</span> {sizeLabel(selected.size)}</dd></div>
          </dl>
          <div className={styles.detailActions}>
            <a href={`/api/archive/download?fileId=${encodeURIComponent(selected.id)}`} download><ArrowDownToLine size={16} /> Unduh</a>
            <button type="button" onClick={() => shareFile(selected)}><Share2 size={16} /> Bagikan</button>
            <button type="button" className={styles.detailOpen} onClick={() => setViewerId(selected.id)}><ArrowRight size={17} /> Buka</button>
          </div>
          {shareStatus && <p className={styles.shareStatus} role="status">{shareStatus}</p>}
        </div>
        {detailFiles.length > 1 && <div className={styles.detailNavigation} aria-label="Navigasi detail foto">
          <button type="button" aria-label="Detail sebelumnya" disabled={detailIndex <= 0} onClick={() => choose(detailFiles[detailIndex - 1])}><ChevronLeft size={20} /></button>
          <span>{String(detailIndex + 1).padStart(2, '0')} / {String(detailFiles.length).padStart(2, '0')}<i aria-hidden="true" /></span>
          <button type="button" aria-label="Detail berikutnya" disabled={detailIndex >= detailFiles.length - 1} onClick={() => choose(detailFiles[detailIndex + 1])}><ChevronRight size={20} /></button>
        </div>}
      </aside>
    </div>}
    {viewerId && <MediaViewer files={visibleFiles.length ? visibleFiles : files} initialIndex={viewerIndex < 0 ? Math.max(0, files.findIndex(file => file.id === viewerId)) : viewerIndex} onClose={() => setViewerId(null)} onFileDeleted={id => { setFiles(current => current.filter(file => file.id !== id)); setViewerId(null); setSelectedId(null); }} />}
  </div>;
}
