'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export default function Footer() {
  const pathname = usePathname();
  const currentYear = new Date().getFullYear();
  if (pathname === '/' || pathname === '/archive') return null;

  return (
    <footer className="w-full border-t border-white/10 bg-black text-white/50">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-12 py-16">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-xs">
          <p className="font-mono tracking-widest text-[10px] uppercase">
            &copy; {currentYear} KEVIN SIMATUPANG
          </p>
          <p className="font-mono tracking-widest text-white/40 uppercase text-[10px]">
            DOKUMENTASI DIGITAL GMAHK GALILEA
          </p>
        </div>
      </div>
    </footer>
  );
}
