"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import StudioWorkspace from "@/components/archive/StudioWorkspace";

function ArchiveContent() {
  const params = useSearchParams();
  const category =
    params.get("category") === "worship" ? "worship" : "documentation";
  const sabbath = params.get("sabbath") || "";
  return (
    <StudioWorkspace
      key={`${category}:${sabbath}`}
      mode="archive"
      initialCategory={category}
      initialSabbath={sabbath}
    />
  );
}

export default function ArchivePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black" aria-label="Memuat arsip" />
      }
    >
      <ArchiveContent />
    </Suspense>
  );
}
