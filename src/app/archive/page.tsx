"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import StudioWorkspace from "@/components/archive/StudioWorkspace";
function ArchiveContent() { const params = useSearchParams(); const category = params.get("category") === "worship" ? "worship" : "documentation"; return <StudioWorkspace key={category + ":" + (params.get("sabbath") || "")} mode="archive" initialCategory={category} initialSabbath={params.get("sabbath") || ""} />; }
export default function ArchivePage() { return <Suspense fallback={<div className="min-h-screen bg-black"/>}><ArchiveContent /></Suspense>; }
