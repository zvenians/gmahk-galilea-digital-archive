"use client";

import { useState } from "react";
import Link from "next/link";
import { UserRound, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function StudioAccount({ disabled = false }: { disabled?: boolean }) {
  const { user, role, loading, roleLoading, isSigningIn, signInWithGoogle, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return <div className="canvas-account">
    <button type="button" className="canvas-control" aria-label="Akun" aria-expanded={open} aria-controls="canvas-account-panel" disabled={disabled || loading || roleLoading} onClick={() => setOpen(value => !value)}>
      {open ? <X size={17} /> : <UserRound size={17} />}
    </button>
    {open && <div id="canvas-account-panel" className="canvas-account-panel" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      <p>{user ? user.displayName || user.email : "Pengurus Galilea"}</p>
      {user ? <>
        {role === "admin" && <Link href="/admin">Panel admin ↗</Link>}
        <button type="button" onClick={() => { setOpen(false); signOut(); }}>Keluar</button>
      </> : <button type="button" disabled={isSigningIn} onClick={() => signInWithGoogle()}>{isSigningIn ? "Memproses…" : "Masuk sebagai admin"}</button>}
    </div>}
  </div>;
}
