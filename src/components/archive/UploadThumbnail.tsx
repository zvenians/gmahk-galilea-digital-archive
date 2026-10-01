"use client";

import { useEffect, useRef } from "react";
import { FileText, Video } from "lucide-react";

// Local visual preview only. Object URLs never leave the device.
export default function UploadThumbnail({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  const isPhoto = file.type.startsWith("image/");
  useEffect(() => {
    if (!isPhoto || !image.current) return;
    const url = URL.createObjectURL(file);
    image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isPhoto]);
  if (!isPhoto) return file.type.startsWith("video/") ? <Video size={22} /> : <FileText size={22} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt="" />;
}
