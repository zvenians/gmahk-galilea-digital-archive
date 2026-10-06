'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  AlertTriangle,
  Bell,
  CalendarPlus,
  CheckCircle2,
  Database,
  ExternalLink,
  FolderSync,
  HardDrive,
  LayoutDashboard,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { ActivityItem, AutomationStatus, SystemLog } from '@/lib/types';

type AdminTab = 'dashboard' | 'activities' | 'automation' | 'logs' | 'settings';

const ADMIN_TABS: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Ringkasan', icon: LayoutDashboard },
  { id: 'activities', label: 'Kegiatan', icon: CalendarPlus },
  { id: 'automation', label: 'Sinkronisasi', icon: FolderSync },
  { id: 'logs', label: 'Catatan Sistem', icon: ScrollText },
  { id: 'settings', label: 'Pengaturan', icon: Settings },
];

export default function AdminPage() {
  const { role, user, loading, roleLoading, isSigningIn, signInWithGoogle, signOut, getIdToken } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newCategory, setNewCategory] = useState<'documentation' | 'worship'>('documentation');
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [runningAutomation, setRunningAutomation] = useState(false);
  const [runningReconcile, setRunningReconcile] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);
  const [adminError, setAdminError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const hasUnsavedActivity = Boolean(newTitle.trim() || newDate);
  const isHealthy = ['READY', 'SUCCESS'].includes(automationStatus?.status || '');

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getIdToken();
    if (!token) throw new Error('Sesi admin telah berakhir. Silakan masuk kembali.');
    return { Authorization: `Bearer ${token}` };
  }, [getIdToken]);

  const refreshAdminData = useCallback(async () => {
    if (role !== 'admin') return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const headers = await getAuthHeaders();
      const [activitiesResponse, automationResponse, logsResponse] = await Promise.all([
        fetch('/api/admin/activities', { headers, cache: 'no-store' }),
        fetch('/api/admin/automation', { headers, cache: 'no-store' }),
        fetch('/api/admin/logs', { headers, cache: 'no-store' }),
      ]);
      const [activitiesJson, automationJson, logsJson] = await Promise.all([
        activitiesResponse.json(), automationResponse.json(), logsResponse.json(),
      ]);
      if (!activitiesResponse.ok || !automationResponse.ok || !logsResponse.ok || !activitiesJson.success || !automationJson.success || !logsJson.success) {
        throw new Error(activitiesJson.error || automationJson.error || logsJson.error || 'Sebagian data admin gagal dimuat.');
      }
      setActivities(activitiesJson.data || []);
      setAutomationStatus(automationJson.data || null);
      setLogs(logsJson.data || []);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to load admin data:', error);
      setAdminError(error instanceof Error ? error.message : 'Dashboard tidak dapat diperbarui.');
    } finally {
      setAdminLoading(false);
    }
  }, [getAuthHeaders, role]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshAdminData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshAdminData]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedActivity) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedActivity]);

  const selectTab = (tab: AdminTab) => {
    if (tab !== activeTab && activeTab === 'activities' && hasUnsavedActivity) {
      if (!window.confirm('Form kegiatan belum disimpan. Tinggalkan perubahan ini?')) return;
    }
    setActiveTab(tab);
  };

  const handleCreateActivity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim() || !newDate) return;
    setCreatingActivity(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/activities', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), date: newDate, category: newCategory }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Kegiatan gagal dibuat.');
      showToast({ type: 'success', message: 'Kegiatan Dibuat', description: `Folder “${newTitle.trim()}” berhasil disiapkan.` });
      setNewTitle('');
      setNewDate('');
      await refreshAdminData();
    } catch (error) {
      showToast({ type: 'error', message: 'Kegiatan Gagal Dibuat', description: error instanceof Error ? error.message : 'Terjadi kesalahan.' });
    } finally {
      setCreatingActivity(false);
    }
  };

  const handleTriggerAutomation = async () => {
    setRunningAutomation(true);
    showToast({ type: 'info', message: 'Sinkronisasi Dimulai', description: 'Struktur tahun dan Sabat sedang diperiksa di Google Drive.' });
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/automation', { method: 'POST', headers });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || json.data?.details || 'Otomasi gagal dijalankan.');
      showToast({ type: 'success', message: 'Struktur Tersinkron', description: json.data?.details || json.message || 'Folder Google Drive sudah diperiksa.' });
      await refreshAdminData();
    } catch (error) {
      showToast({ type: 'error', message: 'Sinkronisasi Gagal', description: error instanceof Error ? error.message : 'Terjadi kesalahan.' });
    } finally {
      setRunningAutomation(false);
    }
  };

  const handleReconcile = async () => {
    setRunningReconcile(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/reconcile', { method: 'POST', headers });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Sinkronisasi metadata gagal.');
      const result = json.data;
      showToast({
        type: result.errors > 0 ? 'warning' : 'success',
        message: result.errors > 0 ? 'Selesai Sebagian' : 'Metadata Tersinkron',
        description: `${result.refreshed || 0} diperbarui, ${result.invalidated || 0} dinonaktifkan, ${result.errors || 0} gagal.`,
      });
      await refreshAdminData();
    } catch (error) {
      showToast({ type: 'error', message: 'Metadata Gagal Disinkron', description: error instanceof Error ? error.message : 'Terjadi kesalahan.' });
    } finally {
      setRunningReconcile(false);
    }
  };

  if (loading || roleLoading) {
    return <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-center text-white"><div className="mb-6 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" /><p className="editorial-meta">MEMERIKSA HAK AKSES...</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-center text-white">
        <span className="editorial-eyebrow">PORTAL SISTEM</span>
        <h1 className="editorial-title mb-6 uppercase">PANEL ADMIN</h1>
        <p className="editorial-desc mb-10 max-w-md">Masuk dengan akun Google pengurus untuk mengelola arsip GMAHK Galilea.</p>
        <button type="button" onClick={signInWithGoogle} disabled={isSigningIn} className="editorial-button disabled:opacity-50">{isSigningIn ? 'MEMPROSES...' : 'MASUK DENGAN GOOGLE'}</button>
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-center text-white">
        <ShieldAlert className="mb-8 h-16 w-16 text-white/20" />
        <h1 className="editorial-title uppercase">AKSES DITOLAK</h1>
        <p className="editorial-desc mt-6 max-w-md">Akun <span className="text-white">{user.email}</span> belum memiliki peran administrator.</p>
        <div className="mt-10 flex gap-4"><Link href="/" className="editorial-button-secondary">BERANDA</Link><button onClick={signOut} className="editorial-button">GANTI AKUN</button></div>
      </div>
    );
  }

  const activeTabLabel = ADMIN_TABS.find((tab) => tab.id === activeTab)?.label || 'Ringkasan';

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-white/10 bg-[#080808] p-6 lg:flex">
        <Link href="/" className="mb-10 flex items-center justify-between"><div><p className="text-xs font-mono uppercase tracking-[0.24em]">GALILEA</p><p className="mt-1 text-[10px] uppercase tracking-widest text-white/35">Archive Control</p></div><ExternalLink className="h-4 w-4 text-white/35" /></Link>
        <nav className="space-y-2">
          {ADMIN_TABS.map((tab) => {
            const Icon = tab.icon;
            return <button key={tab.id} onClick={() => selectTab(tab.id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${activeTab === tab.id ? 'bg-white text-black' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}><Icon className="h-4 w-4" />{tab.label}{tab.id === 'logs' && logs.length > 0 ? <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] ${activeTab === tab.id ? 'bg-black/10' : 'bg-white/10'}`}>{logs.length}</span> : null}</button>;
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <Link href="/upload" className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-mono uppercase tracking-widest text-black"><Upload className="h-4 w-4" />Unggah Berkas</Link>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="truncate text-xs">{user.email}</p><p className="mt-1 text-[9px] font-mono uppercase tracking-widest text-emerald-300">ADMIN AKTIF</p></div>
        </div>
      </aside>

      <main className="lg:ml-72">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/75 px-6 py-5 backdrop-blur-xl sm:px-10">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
            <div><p className="editorial-meta">PANEL ADMIN</p><h1 className="mt-1 text-2xl font-light">{activeTabLabel}</h1></div>
            <div className="flex items-center gap-3">
              <span className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-[9px] font-mono uppercase tracking-wider sm:flex ${isHealthy ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-100'}`}>{isHealthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{isHealthy ? 'SISTEM SIAP' : 'PERLU DIPERIKSA'}</span>
              <button onClick={refreshAdminData} disabled={adminLoading} className="rounded-full border border-white/10 p-3 text-white/60 transition hover:bg-white/10 hover:text-white" title="Perbarui data"><RefreshCw className={`h-4 w-4 ${adminLoading ? 'animate-spin' : ''}`} /></button>
            </div>
          </div>
          <div className="scrollbar-none mt-5 flex gap-2 overflow-x-auto lg:hidden">{ADMIN_TABS.map((tab) => <button key={tab.id} onClick={() => selectTab(tab.id)} className={`whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-mono uppercase tracking-wider ${activeTab === tab.id ? 'bg-white text-black' : 'bg-white/5 text-white/50'}`}>{tab.label}</button>)}</div>
        </header>

        <div className="mx-auto max-w-[1200px] px-6 py-10 sm:px-10">
          {adminError ? <div className="mb-8 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-100"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-medium">Data admin belum lengkap</p><p className="mt-1 text-red-100/70">{adminError}</p></div></div> : null}

          {activeTab === 'dashboard' ? (
            <div className="space-y-8">
              <section className={`rounded-[2rem] border p-7 sm:p-9 ${isHealthy ? 'border-emerald-400/15 bg-gradient-to-br from-emerald-400/10 to-transparent' : 'border-amber-300/15 bg-gradient-to-br from-amber-300/10 to-transparent'}`}>
                <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center"><div><p className="editorial-meta">STATUS OPERASIONAL</p><h2 className="mt-3 text-3xl font-light">{isHealthy ? 'Arsip siap digunakan.' : 'Sistem memerlukan pemeriksaan.'}</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55">{automationStatus?.details || 'Jalankan sinkronisasi struktur untuk memeriksa koneksi Google Drive.'}</p></div><button onClick={() => selectTab('automation')} className="editorial-button-secondary shrink-0">Buka Sinkronisasi</button></div>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[{ label: 'Kegiatan', value: activities.length, icon: CalendarPlus }, { label: 'Catatan Terbaru', value: logs.length, icon: Bell }, { label: 'Penyimpanan', value: 'Drive', icon: HardDrive }, { label: 'Metadata', value: 'Firestore', icon: Database }].map((item) => { const Icon = item.icon; return <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"><div className="mb-8 flex items-center justify-between"><span className="editorial-meta">{item.label}</span><Icon className="h-4 w-4 text-white/35" /></div><p className="text-3xl font-light">{item.value}</p></div>; })}
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
                <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-7"><div className="mb-6 flex items-center justify-between"><div><p className="editorial-meta">AKTIVITAS TERBARU</p><h3 className="mt-2 text-2xl font-light">Aktivitas terbaru</h3></div><button onClick={() => selectTab('logs')} className="text-xs text-white/50 hover:text-white">Lihat semua</button></div><div className="divide-y divide-white/5">{logs.slice(0, 5).map((log) => <div key={log.id} className="flex items-start justify-between gap-5 py-4"><div><p className="text-sm text-white/80">{log.message}</p><p className="mt-2 text-[9px] font-mono uppercase tracking-wider text-white/35">{log.type}</p></div><span className="shrink-0 text-[10px] text-white/35">{new Date(log.timestamp).toLocaleDateString('id-ID')}</span></div>)}{logs.length === 0 ? <p className="py-10 text-sm text-white/35">Belum ada catatan sistem.</p> : null}</div></div>
                <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-7"><p className="editorial-meta">AKSI CEPAT</p><div className="mt-6 space-y-3"><Link href="/upload" className="flex items-center justify-between rounded-xl bg-white p-4 text-sm text-black"><span className="flex items-center gap-3"><Upload className="h-4 w-4" />Unggah dokumentasi</span><ExternalLink className="h-4 w-4" /></Link><button onClick={() => selectTab('activities')} className="flex w-full items-center justify-between rounded-xl border border-white/10 p-4 text-sm text-white/70 hover:bg-white/5"><span className="flex items-center gap-3"><CalendarPlus className="h-4 w-4" />Buat kegiatan</span></button><button onClick={handleReconcile} disabled={runningReconcile} className="flex w-full items-center justify-between rounded-xl border border-white/10 p-4 text-sm text-white/70 hover:bg-white/5 disabled:opacity-50"><span className="flex items-center gap-3"><RefreshCw className={`h-4 w-4 ${runningReconcile ? 'animate-spin' : ''}`} />{runningReconcile ? 'Menyinkronkan...' : 'Sinkronkan metadata'}</span></button></div></div>
              </section>
            </div>
          ) : null}

          {activeTab === 'activities' ? (
            <div className="grid gap-8 xl:grid-cols-[.85fr_1.15fr]">
              <form onSubmit={handleCreateActivity} className="rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-7 sm:p-8"><p className="editorial-meta">KEGIATAN BARU</p><h2 className="mt-3 text-3xl font-light">Siapkan folder kegiatan.</h2><p className="mt-3 text-sm leading-relaxed text-white/45">Folder dibuat langsung pada tahun, triwulan, dan kategori yang dipilih.</p><div className="mt-8 space-y-7"><label className="block"><span className="editorial-meta">NAMA KEGIATAN</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required maxLength={100} placeholder="Contoh: KKR Pemuda Galilea" className="mt-3 w-full border-b border-white/15 bg-transparent py-3 text-lg outline-none transition focus:border-white" /></label><label className="block"><span className="editorial-meta">TANGGAL</span><input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} required className="mt-3 w-full border-b border-white/15 bg-transparent py-3 text-lg outline-none [color-scheme:dark] focus:border-white" /></label><div><span className="editorial-meta">KATEGORI</span><div className="mt-3 grid grid-cols-2 gap-3">{(['documentation', 'worship'] as const).map((value) => <button key={value} type="button" onClick={() => setNewCategory(value)} className={`rounded-xl border p-3 text-xs font-mono uppercase tracking-wider ${newCategory === value ? 'border-white bg-white text-black' : 'border-white/10 text-white/50'}`}>{value === 'documentation' ? 'Dokumentasi' : 'Berkas Ibadah'}</button>)}</div></div>{hasUnsavedActivity ? <p className="flex items-center gap-2 text-xs text-amber-100/70"><AlertTriangle className="h-4 w-4" />Perubahan belum disimpan.</p> : null}<button type="submit" disabled={creatingActivity} className="editorial-button w-full disabled:opacity-50">{creatingActivity ? 'MEMBUAT FOLDER...' : 'BUAT KEGIATAN'}</button></div></form>
              <div><div className="mb-5 flex items-end justify-between"><div><p className="editorial-meta">KEGIATAN TERCATAT</p><h2 className="mt-2 text-3xl font-light">{activities.length} kegiatan</h2></div></div><div className="space-y-3">{activities.map((activity) => <div key={activity.id} className="flex items-center justify-between gap-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div><h3 className="text-lg font-light">{activity.title}</h3><p className="mt-2 text-[10px] font-mono uppercase tracking-wider text-white/40">{activity.date}</p></div><span className="rounded-full bg-white/5 px-3 py-2 text-[9px] font-mono uppercase tracking-wider text-white/50">{activity.category === 'documentation' ? 'Dokumentasi' : 'Ibadah'}</span></div>)}{activities.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 py-20 text-center text-sm text-white/35">Belum ada kegiatan khusus.</div> : null}</div></div>
            </div>
          ) : null}

          {activeTab === 'automation' ? (
            <div className="grid gap-8 xl:grid-cols-[1fr_.7fr]">
              <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-8"><div className="flex items-start justify-between gap-4"><div className={`rounded-2xl p-4 ${isHealthy ? 'bg-emerald-300 text-black' : 'bg-amber-200 text-black'}`}><FolderSync className="h-6 w-6" /></div><span className="editorial-meta">{automationStatus?.status || 'BELUM DIPERIKSA'}</span></div><h2 className="mt-8 text-3xl font-light">Struktur Google Drive</h2><p className="mt-4 text-sm leading-relaxed text-white/50">Periksa dan lengkapi folder tahun ini, dari triwulan sampai tanggal Sabat. Folder yang sudah ada tidak dibuat ulang.</p><div className="mt-8 rounded-xl border border-white/10 bg-black/30 p-5 text-xs leading-relaxed text-white/50">{automationStatus?.details || 'Belum ada hasil pemeriksaan.'}</div><button onClick={handleTriggerAutomation} disabled={runningAutomation} className="editorial-button mt-6 w-full disabled:opacity-50">{runningAutomation ? 'MEMERIKSA DRIVE...' : 'JALANKAN SINKRONISASI STRUKTUR'}</button></section>
              <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-8"><Database className="h-6 w-6 text-white/50" /><h2 className="mt-8 text-2xl font-light">Indeks & media</h2><p className="mt-4 text-sm leading-relaxed text-white/50">Perbarui daftar file dan pratinjau agar sesuai dengan isi Google Drive.</p><button onClick={handleReconcile} disabled={runningReconcile} className="editorial-button-secondary mt-8 w-full disabled:opacity-50">{runningReconcile ? 'MENYINKRONKAN...' : 'SINKRONKAN METADATA'}</button><p className="mt-5 text-[10px] leading-relaxed text-white/30">Berkas yang sudah tidak berada di area arsip akan dinonaktifkan dari galeri publik.</p></section>
            </div>
          ) : null}

          {activeTab === 'logs' ? (
            <section><div className="mb-8"><p className="editorial-meta">RIWAYAT AKTIVITAS</p><h2 className="mt-2 text-3xl font-light">Catatan sistem</h2></div><div className="overflow-hidden rounded-[1.5rem] border border-white/10"><div className="divide-y divide-white/5">{logs.map((log) => <div key={log.id} className="grid gap-3 bg-white/[0.02] p-5 transition hover:bg-white/[0.04] sm:grid-cols-[9rem_1fr_auto] sm:items-center"><span className={`w-fit rounded-full border px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider ${log.type === 'SECURITY_ALERT' ? 'border-red-300/30 text-red-200' : log.type === 'DELETE' ? 'border-amber-300/30 text-amber-100' : 'border-white/10 text-white/45'}`}>{log.type}</span><p className="text-sm text-white/75">{log.message}</p><time className="text-[10px] text-white/35">{new Date(log.timestamp).toLocaleString('id-ID')}</time></div>)}{logs.length === 0 ? <p className="py-20 text-center text-sm text-white/35">Belum ada catatan sistem.</p> : null}</div></div></section>
          ) : null}

          {activeTab === 'settings' ? (
            <section className="max-w-3xl"><p className="editorial-meta">KONFIGURASI AKTIF</p><h2 className="mt-2 text-3xl font-light">Pengaturan sistem</h2><div className="mt-8 space-y-4">{[{ label: 'Penyimpanan utama', value: 'Google Drive / GMAHK Galilea' }, { label: 'Indeks metadata', value: 'Cloud Firestore' }, { label: 'Zona waktu', value: 'Asia/Makassar (WITA, UTC+8)' }, { label: 'Akses unggah', value: 'Semua orang, tanpa perlu masuk' }].map((setting) => <div key={setting.label} className="flex flex-col justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:flex-row sm:items-center"><span className="text-sm text-white/45">{setting.label}</span><span className="text-sm text-white/80">{setting.value}</span></div>)}</div><div className="mt-8 flex flex-wrap gap-3"><Link href="/archive" className="editorial-button-secondary">Lihat arsip <ExternalLink className="h-4 w-4" /></Link><button onClick={signOut} className="editorial-button-secondary">Keluar</button></div></section>
          ) : null}

          <footer className="mt-16 flex flex-col justify-between gap-2 border-t border-white/10 pt-6 text-[10px] font-mono uppercase tracking-wider text-white/25 sm:flex-row"><span>GMAHK GALILEA DIGITAL ARCHIVE</span><span>{lastRefresh ? `Diperbarui ${lastRefresh.toLocaleTimeString('id-ID')}` : 'Belum diperbarui'}</span></footer>
        </div>
      </main>
    </div>
  );
}
