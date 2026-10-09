import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

type LegalSection = {
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
};

export default function LegalPage({ eyebrow, title, intro, updated, sections }: LegalPageProps) {
  return (
    <article className="relative isolate min-h-screen overflow-hidden bg-[#050606] text-[#eee7dc]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[url('/jesus-prayer.webp')] bg-[length:auto_100%] bg-right-top bg-no-repeat opacity-[0.06]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,#050606_30%,rgba(5,6,6,0.94)_62%,rgba(5,6,6,0.72))]" />

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-7 sm:px-10 sm:py-9">
        <Link
          href="/"
          aria-label="Kembali ke beranda"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-white/70 transition hover:-translate-y-0.5 hover:border-white/40 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Link href="/" className="flex items-center gap-3 text-right">
          <Image src="/adventist-logo.svg" alt="Logo Adventist" width={30} height={30} className="invert" />
          <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-white/65">
            Galilea<br />Digital Archive
          </span>
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-14 px-6 pb-24 pt-12 sm:px-10 sm:pt-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-24">
        <div className="lg:sticky lg:top-16 lg:self-start">
          <p className="mb-5 font-mono text-[9px] uppercase tracking-[0.3em] text-white/40">{eyebrow}</p>
          <h1 className="max-w-md font-serif text-5xl font-normal leading-[0.95] tracking-[-0.04em] text-[#f0e8dc] sm:text-7xl">
            {title}
          </h1>
          <p className="mt-7 max-w-md text-sm font-light leading-7 text-white/55">{intro}</p>
          <p className="mt-7 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">Diperbarui {updated}</p>
        </div>

        <div className="space-y-12 border-t border-white/15 pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-2">
          {sections.map((section, index) => (
            <section key={section.title} className="grid grid-cols-[28px_1fr] gap-4">
              <span className="pt-1 font-mono text-[9px] text-white/25">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2 className="font-serif text-2xl font-normal tracking-[-0.02em] text-white/90">{section.title}</h2>
                <div className="mt-4 space-y-4 text-sm font-light leading-7 text-white/55">{section.content}</div>
              </div>
            </section>
          ))}
        </div>
      </main>
    </article>
  );
}
