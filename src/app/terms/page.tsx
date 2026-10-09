import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Ketentuan Layanan | Galilea Digital Archive',
  description: 'Ketentuan penggunaan Galilea Digital Archive.',
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Ketentuan Layanan"
      title="Arsip bersama, tanggung jawab bersama."
      intro="Dengan memakai Galilea Digital Archive, Anda membantu menjaga dokumentasi jemaat tetap tertata, pantas, dan dapat dinikmati bersama."
      updated="9 Oktober 2026"
      sections={[
        {
          title: 'Tujuan layanan',
          content: <p>Galilea Digital Archive digunakan untuk menyimpan dan membagikan foto, video, serta berkas pelayanan dan kegiatan GMAHK Galilea.</p>,
        },
        {
          title: 'Saat mengunggah',
          content: <p>Pastikan Anda memiliki hak atau izin untuk mengunggah berkas tersebut. Jangan mengunggah materi melanggar hukum, merugikan orang lain, memuat data sensitif tanpa izin, atau tidak berkaitan dengan arsip jemaat.</p>,
        },
        {
          title: 'Pengelolaan arsip',
          content: <p>Pengelola dapat menata ulang, memperbaiki keterangan, menyembunyikan, atau menghapus berkas untuk menjaga keamanan, ketertiban, dan relevansi koleksi.</p>,
        },
        {
          title: 'Ketersediaan layanan',
          content: <p>Kami berusaha menjaga arsip tetap tersedia, tetapi akses dapat terganggu karena pemeliharaan atau layanan pihak ketiga. Simpan salinan pribadi untuk berkas yang penting.</p>,
        },
        {
          title: 'Pertanyaan',
          content: <p>Jika ada berkas yang perlu ditinjau atau Anda memiliki pertanyaan tentang ketentuan ini, hubungi <a className="text-[#e9ddc7] underline decoration-white/25 underline-offset-4 hover:decoration-white/70" href="mailto:simatupangkevin9@gmail.com">simatupangkevin9@gmail.com</a>.</p>,
        },
      ]}
    />
  );
}
