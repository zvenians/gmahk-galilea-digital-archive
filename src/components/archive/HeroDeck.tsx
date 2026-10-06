"use client";

import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { FileItem } from "@/lib/types";
import { deckOffset, deckPosition } from "./deck-layout";
import styles from "./hero-deck.module.css";

type Props = {
  files: FileItem[];
  activeIndex: number;
  onChange: (index: number) => void;
  onOpen: (file: FileItem) => void;
  renderMedia: (file: FileItem) => ReactNode;
};

export default function HeroDeck({ files, activeIndex, onChange, onOpen, renderMedia }: Props) {
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const move = (direction: number) => onChange((activeIndex + direction + files.length) % files.length);
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    gesture.current = { x: event.clientX, y: event.clientY, moved: false };
    suppressClick.current = false;
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const origin = gesture.current;
    gesture.current = null;
    if (!origin) return;
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    suppressClick.current = origin.moved;
    if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy)) {
      suppressClick.current = true;
      move(dx > 0 ? -1 : 1);
    }
  }
  return <div className={styles.deck} role="region" aria-label="Galeri kenangan 3D" aria-roledescription="carousel">
    <div className={styles.scene} onPointerDown={start} onPointerMove={event => {
      if (gesture.current && Math.abs(event.clientX - gesture.current.x) > 8) gesture.current.moved = true;
    }} onPointerUp={end} onPointerLeave={event => { if (gesture.current) end(event); }} onPointerCancel={() => { gesture.current = null; suppressClick.current = true; }} onKeyDown={event => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
    }}>
      {files.map((file, index) => {
        const offset = deckOffset(index, activeIndex, files.length);
        const position = deckPosition(offset);
        const active = offset === 0;
        return <button type="button" key={file.id} className={styles.card} data-active={active} aria-label={active ? `Lihat ${file.name}` : `Tampilkan ${file.name}`} aria-current={active ? "true" : undefined} aria-hidden={Math.abs(offset) > 4 ? true : undefined} tabIndex={active ? 0 : -1} style={{
          "--card-x": `${position.x}px`, "--card-z": `${position.z}px`, "--card-angle": `${position.angle}deg`, "--card-scale": position.scale,
          opacity: position.opacity, zIndex: 10 - Math.abs(offset), pointerEvents: Math.abs(offset) > 4 ? "none" : "auto",
        } as CSSProperties} onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (!active) onChange(index);
          onOpen(file);
        }}>
          <span className={styles.media}>{renderMedia(file)}</span>
          {file.fileType === "video" && <Play className={styles.play} size={19} aria-hidden="true" />}
          <span className={styles.caption}>{file.sabbathTitle || "Arsip Galilea"}<span>Lihat ↗</span></span>
        </button>;
      })}
    </div>
    <div className={styles.controls}>
      <button type="button" aria-label="Foto sebelumnya" disabled={files.length < 2} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
      <div><span className={styles.counter} aria-live="polite">{String(activeIndex + 1).padStart(2, "0")} <i>/</i> {String(files.length).padStart(2, "0")}</span><small>Geser untuk memilih · ketuk untuk melihat</small></div>
      <button type="button" aria-label="Foto berikutnya" disabled={files.length < 2} onClick={() => move(1)}><ChevronRight size={18} /></button>
    </div>
  </div>;
}
