import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="relative z-10 flex w-full flex-col items-center justify-center gap-3 bg-black px-6 py-7 text-center text-[11px] leading-relaxed text-white/50 sm:flex-row sm:gap-5">
      <small className="text-inherit">&copy; Simatupang, Kevin Oloan 2026</small>
      <span aria-hidden="true" className="hidden text-white/20 sm:inline">/</span>
      <nav aria-label="Informasi situs" className="flex items-center gap-4">
        <Link href="/privacy" className="transition-colors hover:text-white/80">
          Privasi
        </Link>
        <Link href="/terms" className="transition-colors hover:text-white/80">
          Ketentuan
        </Link>
      </nav>
    </footer>
  );
}
