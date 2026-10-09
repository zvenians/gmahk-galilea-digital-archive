import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi | Galilea Digital Archive',
  description: 'Kebijakan privasi Galilea Digital Archive.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Kebijakan Privasi"
      title="Privasi Anda tetap dihormati."
      intro="Halaman ini menjelaskan data apa yang diproses saat Anda melihat arsip, mengunggah berkas, atau masuk sebagai pengelola Galilea Digital Archive."
      updated="9 Oktober 2026"
      sections={[
        {
          title: 'Data yang diproses',
          content: (
            <>
              <p>Saat berkas diunggah, kami memproses nama berkas, jenis, ukuran, kategori, periode Sabat yang dipilih, dan waktu unggah. Sistem juga membuat penanda sesi untuk menjaga antrean unggahan publik tetap aman.</p>
              <p>Jika pengelola masuk menggunakan Google, nama, alamat email, dan identitas akun digunakan untuk memeriksa hak akses admin.</p>
            </>
          ),
        },
        {
          title: 'Cara data digunakan',
          content: <p>Data digunakan untuk menyimpan, menata, menampilkan, mengunduh, dan mengelola dokumentasi jemaat. Berkas disimpan di Google Drive dan informasi arsip terkait dapat dicatat di Firebase agar koleksi dapat ditemukan kembali.</p>,
        },
        {
          title: 'Akses dan pembagian',
          content: <p>Isi arsip yang ditampilkan di situs dapat dilihat atau diunduh oleh pengunjung. Kami tidak menjual data pribadi. Data hanya diproses oleh layanan yang diperlukan untuk menjalankan arsip, termasuk Google Drive, Firebase, dan Vercel.</p>,
        },
        {
          title: 'Pilihan Anda',
          content: <p>Jangan unggah informasi pribadi atau sensitif tanpa izin. Untuk meminta koreksi atau penghapusan berkas, hubungi pengelola melalui <a className="text-[#e9ddc7] underline decoration-white/25 underline-offset-4 hover:decoration-white/70" href="mailto:simatupangkevin9@gmail.com">simatupangkevin9@gmail.com</a>.</p>,
        },
        {
          title: 'Keamanan dan perubahan',
          content: <p>Kami memakai kontrol akses dan koneksi terenkripsi yang tersedia pada layanan terkait. Kebijakan ini dapat diperbarui ketika cara kerja arsip berubah; tanggal pembaruan terbaru selalu ditampilkan di halaman ini.</p>,
        },
      ]}
    />
  );
}
