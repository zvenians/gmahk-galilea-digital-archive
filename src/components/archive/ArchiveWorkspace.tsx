"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Info,
  List,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Video,
  X,
} from "lucide-react";
import type { ArchiveCategory, FileItem, SabbathInfo } from "@/lib/types";
import {
  getNearestSabbath,
  isValidSabbathDate,
  parseSabbathDetails,
} from "@/lib/sabbath";
import MediaViewer from "@/components/MediaViewer";
import { galleryRows } from "./gallery-layout";
import styles from "./workspace.module.css";

type Filter = "all" | "photo" | "video" | "document";
type Props = {
  mode: "selection" | "archive";
  initialCategory?: ArchiveCategory;
  initialSabbath?: string;
};
const filters = [
  { id: "all", label: "Semua media", icon: FolderOpen },
  { id: "photo", label: "Foto", icon: ImageIcon },
  { id: "video", label: "Video", icon: Video },
  { id: "document", label: "Dokumen", icon: FileText },
] as const;
const fileKind = (file: FileItem) =>
  file.fileType === "photo"
    ? "Foto"
    : file.fileType === "video"
      ? "Video"
      : file.fileType === "pdf"
        ? "PDF"
        : "Dokumen";
const isDocument = (file: FileItem) =>
  !["photo", "video"].includes(file.fileType);
const formatSize = (size: number) =>
  !size
    ? "Ukuran tidak tersedia"
    : size < 1048576
      ? `${(size / 1024).toFixed(0)} KB`
      : size < 1073741824
        ? `${(size / 1048576).toFixed(1)} MB`
        : `${(size / 1073741824).toFixed(1)} GB`;

function Thumbnail({
  file,
  onRatio,
}: {
  file: FileItem;
  onRatio?: (id: string, ratio: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const Icon =
    file.fileType === "video"
      ? Video
      : file.fileType === "photo"
        ? ImageIcon
        : FileText;
  const src =
    file.thumbnailUrl ||
    (file.fileType === "photo"
      ? `/api/archive/media?fileId=${encodeURIComponent(file.id)}`
      : "");
  return src && !failed ? (
    <Image
      src={src}
      alt={file.name}
      fill
      unoptimized
      sizes="(max-width: 640px) 80vw, 35vw"
      onError={() => setFailed(true)}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight)
          onRatio?.(file.id, naturalWidth / naturalHeight);
      }}
    />
  ) : (
    <div className={styles.filePlaceholder}>
      <Icon size={36} strokeWidth={1} />
      <span>{fileKind(file)}</span>
      <small>
        {failed
          ? "Akses pratinjau melalui Lihat"
          : file.name.split(".").pop()?.toUpperCase()}
      </small>
    </div>
  );
}

export default function ArchiveWorkspace({
  mode,
  initialCategory = "documentation",
  initialSabbath = "",
}: Props) {
  const initial = useMemo(
    () =>
      isValidSabbathDate(initialSabbath)
        ? parseSabbathDetails(initialSabbath)!
        : getNearestSabbath(),
    [initialSabbath],
  );
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [year, setYear] = useState(initial.year);
  const [quarter, setQuarter] = useState(initial.quarter);
  const [sabbath, setSabbath] = useState(initialSabbath);
  const [years, setYears] = useState([initial.year, initial.year - 1]);
  const [sabbaths, setSabbaths] = useState<SabbathInfo[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [width, setWidth] = useState(900);
  const galleryRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      year: String(year),
      quarter: String(quarter),
      category,
    });
    if (sabbath) params.set("sabbath", sabbath);
    const url =
      mode === "selection"
        ? "/api/archive/random?count=12"
        : `/api/archive/tree?${params}`;
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success)
          throw new Error("Archive unavailable");
        return json;
      })
      .then((json) => {
        setError(false);
        if (mode === "selection") setFiles(json.data || []);
        else {
          setFiles(json.data.files || []);
          setSabbaths(json.data.sabbaths || []);
          if (json.data.availableYears?.length)
            setYears(json.data.availableYears);
          if (json.data.selectedSabbath) setSabbath(json.data.selectedSabbath);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(true);
          setFiles([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mode, year, quarter, category, sabbath, retry]);

  useEffect(() => {
    const element = galleryRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    returnFocus.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !viewerId) closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDetail, viewerId]);

  const visibleFiles = useMemo(
    () =>
      files
        .filter((file) => {
          const matchesType =
            filter === "all" ||
            (filter === "document"
              ? isDocument(file)
              : file.fileType === filter);
          return (
            matchesType &&
            file.name
              .toLocaleLowerCase("id")
              .includes(search.toLocaleLowerCase("id").trim())
          );
        })
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "id")
            : sort === "oldest"
              ? a.sabbathDate.localeCompare(b.sabbathDate)
              : b.sabbathDate.localeCompare(a.sabbathDate),
        ),
    [files, filter, search, sort],
  );
  const selected = visibleFiles.find((file) => file.id === selectedId);
  const viewerIndex = visibleFiles.findIndex((file) => file.id === viewerId);
  const ratioFor = (file: FileItem) =>
    ratios[file.id] ||
    (isDocument(file) ? 0.707 : file.fileType === "video" ? 16 / 9 : 4 / 3);
  const rows = galleryRows(visibleFiles, Math.max(200, width), ratioFor);
  const onRatio = useCallback(
    (id: string, ratio: number) =>
      setRatios((current) =>
        current[id] === ratio ? current : { ...current, [id]: ratio },
      ),
    [],
  );
  const selectFile = (file: FileItem, element: HTMLElement) => {
    returnFocus.current = element;
    setSelectedId(file.id);
  };
  const resetSelection = () => {
    setSelectedId(null);
    setViewerId(null);
  };
  const changeFilter = (value: Filter) => {
    setFilter(value);
    resetSelection();
  };
  const changeArchive = (update: () => void) => {
    setLoading(true);
    setSabbath("");
    resetSelection();
    update();
  };

  function moveDepth(event: PointerEvent<HTMLElement>) {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--rx",
      `${(-(event.clientY - rect.top - rect.height / 2) / rect.height) * 3}deg`,
    );
    event.currentTarget.style.setProperty(
      "--ry",
      `${((event.clientX - rect.left - rect.width / 2) / rect.width) * 3}deg`,
    );
  }
  function resetDepth(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty("--rx", "0deg");
    event.currentTarget.style.setProperty("--ry", "0deg");
  }
  const renderTile = (file: FileItem, height: number) => (
    <button
      key={file.id}
      type="button"
      aria-label={`Detail ${file.name}`}
      aria-pressed={selectedId === file.id}
      className={`${styles.tile} ${selectedId === file.id ? styles.selectedTile : ""}`}
      style={
        {
          width: height * ratioFor(file),
          "--media-height": `${height}px`,
        } as CSSProperties
      }
      onPointerMove={moveDepth}
      onPointerLeave={resetDepth}
      onClick={(event) => selectFile(file, event.currentTarget)}
      onDoubleClick={() => setViewerId(file.id)}
    >
      <div className={styles.media}>
        <Thumbnail file={file} onRatio={onRatio} />
        {file.fileType === "video" && (
          <span className={styles.play}>
            <Play size={17} fill="currentColor" />
          </span>
        )}
        <span className={styles.tileAction}>
          <Info size={15} />
        </span>
      </div>
      <div className={styles.caption}>
        <span className={styles.filename}>{file.name}</span>
        <span className={styles.filemeta}>
          {fileKind(file)}
          <span aria-hidden="true"> / </span>
          {file.sabbathTitle}
        </span>
      </div>
      {selectedId === file.id && (
        <span className={styles.selectedMark}>
          <Check size={12} />
        </span>
      )}
    </button>
  );

  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="Navigasi koleksi">
        <div className={styles.sidebarLabel}>Perpustakaan</div>
        <nav className={styles.filterNav}>
          {filters.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={filter === id ? styles.activeNav : ""}
              onClick={() => changeFilter(id)}
              aria-pressed={filter === id}
            >
              <Icon size={18} strokeWidth={1.4} />
              <span>{label}</span>
              {filter === id && <span className={styles.navDot} />}
            </button>
          ))}
        </nav>
        <div className={styles.collections}>
          <div className={styles.sidebarLabel}>Koleksi Galilea</div>
          <Link href="/">
            <Grid2X2 size={16} />
            Koleksi pilihan
          </Link>
          <Link href="/archive?category=documentation">
            <CalendarDays size={16} />
            Arsip Sabat
          </Link>
          <Link href="/archive?category=worship">
            <FileText size={16} />
            Berkas ibadah
          </Link>
        </div>
        <div className={styles.sidebarFoot}>
          <Image
            src="/adventist-logo.svg"
            width={30}
            height={30}
            alt="Logo Gereja Advent"
          />
          <span>
            GMAHK Galilea<small>Arsip kehidupan jemaat.</small>
          </span>
        </div>
      </aside>

      <div className={styles.main}>
        <section
          className={styles.hero}
          onPointerMove={moveDepth}
          onPointerLeave={resetDepth}
        >
          <div className={styles.heroImage}>
            <Image
              src="/jesus-prayer.webp"
              alt="Ilustrasi Yesus berdoa menghadap ke kiri"
              fill
              sizes="(max-width: 640px) 100vw, 850px"
              priority
            />
          </div>
          <div className={styles.heroCopy}>
            <div className={styles.breadcrumb}>
              <Link href="/">Galilea</Link>
              <ChevronRight size={12} />
              <span>
                {mode === "selection" ? "Koleksi pilihan" : "Arsip Sabat"}
              </span>
            </div>
            <p className={styles.eyebrow}>ARSIP DIGITAL JEMAAT</p>
            <h1>
              Kenangan yang hidup.
              <br />
              <em>Iman yang menyatukan.</em>
            </h1>
            <p className={styles.heroDescription}>
              Galeri & dokumen GMAHK Galilea.
              <br />
              Setiap momen, tersimpan untuk dikenang.
            </p>
            <a className={styles.heroLink} href="#koleksi">
              Jelajahi koleksi <ArrowRight size={15} />
            </a>
          </div>
          <span className={styles.heroEdition}>
            GALILEA / DIGITAL COLLECTION
          </span>
        </section>

        <section id="koleksi" className={styles.collection}>
          <div className={styles.collectionHeading}>
            <div>
              <p className={styles.eyebrow}>
                {mode === "selection"
                  ? "PILIHAN DARI ARSIP"
                  : "MENELUSURI PERJALANAN JEMAAT"}
              </p>
              <h2>
                {mode === "selection"
                  ? "Galeri & Dokumen"
                  : category === "worship"
                    ? "Berkas Ibadah"
                    : "Arsip Sabat"}
                <span className={styles.count} aria-live="polite">
                  {loading ? "..." : visibleFiles.length}
                </span>
              </h2>
            </div>
            {mode === "selection" ? (
              <Link
                href="/archive?category=documentation"
                className={styles.textLink}
              >
                Semua arsip <ArrowRight size={16} />
              </Link>
            ) : (
              <button
                className={styles.filterButton}
                onClick={() => setFiltersOpen(!filtersOpen)}
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal size={16} />
                Periode
              </button>
            )}
          </div>

          {mode === "archive" && (
            <div
              className={`${styles.archiveFilters} ${filtersOpen ? styles.filtersExpanded : ""}`}
            >
              <label>
                Koleksi
                <select
                  aria-label="Koleksi"
                  value={category}
                  onChange={(event) =>
                    changeArchive(() =>
                      setCategory(event.target.value as ArchiveCategory),
                    )
                  }
                >
                  <option value="documentation">Foto & Video</option>
                  <option value="worship">Berkas Ibadah</option>
                </select>
              </label>
              <label>
                Tahun
                <select
                  aria-label="Tahun"
                  value={year}
                  onChange={(event) =>
                    changeArchive(() => setYear(Number(event.target.value)))
                  }
                >
                  {Array.from(new Set([...years, year]))
                    .sort((a, b) => b - a)
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </label>
              <label>
                Triwulan
                <select
                  aria-label="Triwulan"
                  value={quarter}
                  onChange={(event) =>
                    changeArchive(() => setQuarter(Number(event.target.value)))
                  }
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option value={value} key={value}>
                      Triwulan {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tanggal Sabat
                <select
                  aria-label="Tanggal Sabat"
                  value={sabbath}
                  onChange={(event) => {
                    setLoading(true);
                    resetSelection();
                    setSabbath(event.target.value);
                  }}
                >
                  <option value="">Sabat terbaru</option>
                  {sabbaths.map((item) => (
                    <option key={item.date} value={item.date}>
                      {item.formattedTitle}
                      {item.isUpcoming ? " (mendatang)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className={styles.toolbar}>
            <label className={styles.search}>
              <Search size={17} />
              <input
                aria-label="Cari dalam koleksi"
                placeholder="Cari media atau dokumen..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetSelection();
                }}
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    resetSelection();
                  }}
                  aria-label="Hapus pencarian"
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <div className={styles.toolbarActions}>
              <select
                aria-label="Urutkan berkas"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="newest">Terbaru</option>
                <option value="oldest">Terlama</option>
                <option value="name">Nama A-Z</option>
              </select>
              <span className={styles.divider} />
              <div className={styles.viewToggle}>
                <button
                  title="Tampilan galeri"
                  aria-label="Tampilan galeri"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <Grid2X2 size={17} />
                </button>
                <button
                  title="Tampilan daftar"
                  aria-label="Tampilan daftar"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List size={19} />
                </button>
              </div>
            </div>
          </div>

          <div
            className={`${styles.content} ${selected ? styles.withDetail : ""}`}
          >
            <div
              ref={galleryRef}
              className={styles.gallery}
              aria-busy={loading}
            >
              {loading ? (
                <div className={styles.skeletons}>
                  {[0, 1, 2, 3, 4, 5].map((item) => (
                    <div
                      key={item}
                      style={{ animationDelay: `${item * 90}ms` }}
                    />
                  ))}
                </div>
              ) : error ? (
                <div className={styles.empty} role="alert">
                  <RefreshCw size={30} strokeWidth={1} />
                  <h3>Koleksi belum dapat dimuat.</h3>
                  <p>Silakan coba lagi dalam beberapa saat.</p>
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      setLoading(true);
                      setRetry((value) => value + 1);
                    }}
                  >
                    <RefreshCw size={15} />
                    Coba lagi
                  </button>
                </div>
              ) : !visibleFiles.length ? (
                <div className={styles.empty}>
                  <FolderOpen size={36} strokeWidth={1} />
                  <h3>
                    {search || filter !== "all"
                      ? "Belum ada hasil yang cocok."
                      : "Koleksi menanti cerita pertama."}
                  </h3>
                  <p>
                    {search || filter !== "all"
                      ? "Coba kata kunci atau jenis berkas lainnya."
                      : "Media dan dokumen yang dibagikan akan tampil di sini."}
                  </p>
                  {(search || filter !== "all") && (
                    <button
                      className={styles.primaryButton}
                      onClick={() => {
                        setSearch("");
                        changeFilter("all");
                      }}
                    >
                      Tampilkan semua
                    </button>
                  )}
                </div>
              ) : view === "grid" ? (
                <div className={styles.rows}>
                  {rows.map((row, index) => (
                    <div className={styles.galleryRow} key={index}>
                      {row.items.map((file) => renderTile(file, row.height))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.list}>
                  {visibleFiles.map((file) => (
                    <button
                      key={file.id}
                      className={`${styles.listItem} ${selectedId === file.id ? styles.selectedList : ""}`}
                      onClick={(event) => selectFile(file, event.currentTarget)}
                      onDoubleClick={() => setViewerId(file.id)}
                    >
                      <span className={styles.listThumb}>
                        <Thumbnail file={file} />
                      </span>
                      <span className={styles.listName}>
                        {file.name}
                        <small>{file.sabbathTitle}</small>
                      </span>
                      <span className={styles.listKind}>{fileKind(file)}</span>
                      <span className={styles.listSize}>
                        {formatSize(file.size)}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.statusBar}>
                <span>
                  {mode === "selection"
                    ? "Koleksi pilihan"
                    : sabbaths.find((item) => item.date === sabbath)
                        ?.formattedTitle || `${year} / Triwulan ${quarter}`}
                </span>
                <span>
                  {loading
                    ? "Memuat koleksi"
                    : error
                      ? "Koneksi tidak tersedia"
                      : `${visibleFiles.length} berkas`}
                </span>
              </div>
            </div>
            {selected && (
              <aside className={styles.detail} aria-label="Detail berkas">
                <div className={styles.detailHeader}>
                  <span>Detail berkas</span>
                  <button
                    onClick={closeDetail}
                    aria-label="Tutup detail"
                    title="Tutup detail"
                  >
                    <X size={19} />
                  </button>
                </div>
                <button
                  className={styles.detailPreview}
                  onClick={() => setViewerId(selected.id)}
                  aria-label={`Lihat ${selected.name}`}
                >
                  <Thumbnail key={selected.id} file={selected} />
                  <span>
                    <Maximize2 size={18} />
                  </span>
                </button>
                <span className={styles.detailType}>{fileKind(selected)}</span>
                <h3>{selected.name}</h3>
                <dl>
                  <div>
                    <dt>Tanggal Sabat</dt>
                    <dd>{selected.sabbathTitle}</dd>
                  </div>
                  <div>
                    <dt>Ukuran</dt>
                    <dd>{formatSize(selected.size)}</dd>
                  </div>
                  <div>
                    <dt>Koleksi</dt>
                    <dd>
                      {selected.category === "worship"
                        ? "Berkas ibadah"
                        : "Dokumentasi"}
                    </dd>
                  </div>
                  <div>
                    <dt>Periode</dt>
                    <dd>
                      {selected.year} / Triwulan {selected.quarter}
                    </dd>
                  </div>
                </dl>
                <button
                  className={styles.primaryButton}
                  onClick={() => setViewerId(selected.id)}
                >
                  <Maximize2 size={15} />
                  Lihat berkas
                </button>
                <a
                  className={styles.secondaryButton}
                  href={`/api/archive/download?fileId=${encodeURIComponent(selected.id)}`}
                  download
                >
                  <ArrowDownToLine size={16} />
                  Unduh
                </a>
                <Link
                  className={styles.detailArchiveLink}
                  href={`/archive?category=${selected.category}&sabbath=${selected.sabbathDate}`}
                >
                  Buka koleksi Sabat ini <ArrowRight size={14} />
                </Link>
              </aside>
            )}
          </div>
        </section>
        <footer className={styles.workspaceFooter}>
          <span>GMAHK Galilea</span>
          <span>Iman. Pelayanan. Kenangan.</span>
          <a href="#koleksi">
            <ArrowUp size={14} />
            Kembali ke koleksi
          </a>
        </footer>
      </div>
      {viewerIndex >= 0 && (
        <MediaViewer
          files={visibleFiles}
          initialIndex={viewerIndex}
          onClose={() => {
            setViewerId(null);
            returnFocus.current?.focus();
          }}
          onFileDeleted={(id) => {
            setFiles((current) => current.filter((file) => file.id !== id));
            setViewerId(null);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
