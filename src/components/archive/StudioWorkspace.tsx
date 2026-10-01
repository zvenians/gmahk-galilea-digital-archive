"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ChevronLeft, ChevronRight, Search, Share2, X } from "lucide-react";
import type { ArchiveCategory, FileItem, SabbathInfo } from "@/lib/types";
import { getNearestSabbath, getSabbathsInQuarter, isValidSabbathDate, parseSabbathDetails } from "@/lib/sabbath";
import MediaViewer from "@/components/MediaViewer";
import styles from "./studio.module.css";

type Props = { mode: "selection" | "archive"; initialCategory?: ArchiveCategory; initialSabbath?: string };
const typeLabel = (file: FileItem) => file.fileType === "photo" ? "Foto" : file.fileType === "video" ? "Video" : "Dokumen";
function Preview({ file }: { file: FileItem }) {
  const source = file.thumbnailUrl || (file.fileType === "photo" ? "/api/archive/media?fileId=" + encodeURIComponent(file.id) : "");
  return source ? <Image src={source} alt={file.name} fill unoptimized sizes="(max-width: 700px) 90vw, 50vw" /> : <span className={styles.placeholder}>{typeLabel(file)}</span>;
}
export default function StudioWorkspace({ mode, initialCategory = "documentation", initialSabbath = "" }: Props) {
  const seed = useMemo(() => isValidSabbathDate(initialSabbath) ? parseSabbathDetails(initialSabbath)! : getNearestSabbath(), [initialSabbath]);
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [year, setYear] = useState(seed.year);
  const [quarter, setQuarter] = useState(seed.quarter);
  const [sabbath, setSabbath] = useState(initialSabbath);
  const [sabbaths, setSabbaths] = useState<SabbathInfo[]>(getSabbathsInQuarter(seed.year, seed.quarter));
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const params = new URLSearchParams({ year: String(year), quarter: String(quarter), category });
    if (sabbath) params.set("sabbath", sabbath);
    const url = mode === "selection" ? "/api/archive/random?count=12" : "/api/archive/tree?" + params;
    
    fetch(url).then(response => response.json()).then(json => {
      if (!json.success) throw new Error();
      setFiles(mode === "selection" ? json.data || [] : json.data.files || []);
      if (mode === "archive") { setSabbaths(json.data.sabbaths || []); if (json.data.selectedSabbath) setSabbath(json.data.selectedSabbath); }
    }).catch(() => setFiles([])).finally(() => setLoading(false));
  }, [mode, year, quarter, category, sabbath]);
  const visible = files.filter(file => (filter === "all" || file.fileType === filter) && file.name.toLowerCase().includes(search.toLowerCase()));
  const photos = files.filter(file => file.fileType === "photo" || file.fileType === "video");
  const hero = photos[index % Math.max(photos.length, 1)];
  const move = (step: number) => setIndex(value => (value + step + Math.max(photos.length, 1)) % Math.max(photos.length, 1));
  const open = (file: FileItem) => setSelected(file);
  const share = async (file: FileItem) => { const url = window.location.origin + "/archive?category=" + file.category + "&sabbath=" + file.sabbathDate; if (navigator.share) await navigator.share({ title: file.name, url }); else await navigator.clipboard.writeText(url); };
  if (mode === "selection") return <div className={styles.studio}>
    <section className={styles.hero}><div className={styles.copy}><p>GMAHK GALILEA / DIGITAL ARCHIVE</p><h1>Kenangan yang hidup.<br/><em>Iman yang menyatukan.</em></h1><span>Ruang untuk menyimpan perjalanan, pelayanan, dan momen kebersamaan jemaat Galilea.</span><Link href="/archive?category=documentation">Jelajahi Arsip <ArrowRight size={17}/></Link></div><div className={styles.stage}>{photos.slice(1,5).map((file, number) => <button className={styles["float" + number]} key={file.id} onClick={() => open(file)}><Preview file={file}/></button>)}{hero && <button className={styles.heroPhoto} onClick={() => open(hero)}><Preview file={hero}/><small>{hero.sabbathTitle}</small></button>}<div className={styles.arrows}><button onClick={() => move(-1)}><ChevronLeft/></button><button onClick={() => move(1)}><ChevronRight/></button></div></div></section>
    <section className={styles.section}><p>01 / POTONGAN CERITA</p><h2>Momen <em>Pilihan</em></h2><div className={styles.strip}>{files.slice(0,8).map(file => <button key={file.id} onClick={() => open(file)}><span><Preview file={file}/></span>{file.name}</button>)}</div></section>
    <section className={styles.section}><p>02 / TEMUKAN KOLEKSI</p><h2>Jelajahi <em>Arsip</em></h2><div className={styles.cards}><Link href="/archive?category=documentation">Dokumentasi <ArrowRight/></Link><Link href="/archive?category=worship">Berkas Ibadah <ArrowRight/></Link></div></section>{selected && <Detail file={selected} onClose={() => setSelected(null)} onOpen={() => setViewer(selected.id)} onShare={() => share(selected)}/>} {viewer && <MediaViewer files={files} initialIndex={Math.max(0, files.findIndex(file => file.id === viewer))} onClose={() => setViewer(null)}/>}</div>;
  return <main className={styles.studio}><section className={styles.archive}><Link className={styles.back} href="/">← Beranda</Link><p>GALILEA / KOLEKSI DIGITAL</p><h1>Jelajahi <em>cerita.</em></h1><div className={styles.controls}><button className={category === "documentation" ? styles.active : ""} onClick={() => {setCategory("documentation");setSabbath("")}}>Dokumentasi</button><button className={category === "worship" ? styles.active : ""} onClick={() => {setCategory("worship");setSabbath("")}}>Berkas Ibadah</button><select value={year} onChange={event => {setYear(Number(event.target.value));setSabbath("")}}>{[year,year-1,year-2].map(value => <option key={value}>{value}</option>)}</select><select value={quarter} onChange={event => {setQuarter(Number(event.target.value));setSabbath("")}}>{[1,2,3,4].map(value => <option key={value} value={value}>Triwulan {value}</option>)}</select></div><p className={styles.timelineTitle}>PILIH TANGGAL SABAT</p><div className={styles.timeline}>{sabbaths.map(info => <button key={info.date} className={sabbath === info.date ? styles.dateActive : ""} onClick={() => setSabbath(info.date)}><b>{info.date.slice(-2)}</b><small>{info.formattedTitle}</small></button>)}</div><div className={styles.toolbar}><h2>{sabbath ? "Koleksi Sabat" : "Pilih Sabat"}</h2><label><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari dalam koleksi"/></label><div>{["all","photo","video","document"].map(value => <button key={value} className={filter === value ? styles.active : ""} onClick={() => setFilter(value)}>{value === "all" ? "Semua" : value === "photo" ? "Foto" : value === "video" ? "Video" : "Dokumen"}</button>)}</div></div><div className={styles.grid}>{loading ? <p>Memuat koleksi…</p> : visible.map(file => <button key={file.id} onClick={() => open(file)}><span><Preview file={file}/></span><b>{file.name}</b><small>{typeLabel(file)} · {file.sabbathTitle}</small></button>)}</div></section>{selected && <Detail file={selected} onClose={() => setSelected(null)} onOpen={() => setViewer(selected.id)} onShare={() => share(selected)}/>} {viewer && <MediaViewer files={visible} initialIndex={Math.max(0, visible.findIndex(file => file.id === viewer))} onClose={() => setViewer(null)}/>}</main>;
}
function Detail({ file, onClose, onOpen, onShare }: { file: FileItem; onClose: () => void; onOpen: () => void; onShare: () => void }) { return <div className={styles.detailLayer}><button className={styles.backdrop} onClick={onClose}/><aside className={styles.detail}><button className={styles.close} onClick={onClose}><X/></button><div className={styles.detailPreview}><Preview file={file}/></div><p>OBJEK ARSIP / {typeLabel(file).toUpperCase()}</p><h2>{file.name}</h2><dl><div><dt>Tanggal Sabat</dt><dd>{file.sabbathTitle}</dd></div><div><dt>Kategori</dt><dd>{file.category === "documentation" ? "Dokumentasi" : "Berkas Ibadah"}</dd></div><div><dt>Periode</dt><dd>{file.year} / Triwulan {file.quarter}</dd></div></dl><button className={styles.open} onClick={onOpen}>Buka <ArrowRight/></button><a href={"/api/archive/download?fileId=" + encodeURIComponent(file.id)} download>Unduh <ArrowDownToLine/></a><button onClick={onShare}>Bagikan <Share2/></button></aside></div> }
