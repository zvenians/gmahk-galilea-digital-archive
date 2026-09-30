import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndonesianDateStringToIso,
  parseQuarterFromFolderName,
  determineFileType,
  discoverArchiveTree,
} from '../src/lib/drive';
import { getNearestSabbath } from '../src/lib/sabbath';

describe('GMAHK Galilea - Dynamic Archive Tree Discovery & Parsers', () => {
  it('harus mem-parsing berbagai format nama folder tanggal Indonesia menjadi ISO YYYY-MM-DD', () => {
    assert.equal(parseIndonesianDateStringToIso('12 September 2026'), '2026-09-12');
    assert.equal(parseIndonesianDateStringToIso('Sabat, 12 September 2026'), '2026-09-12');
    assert.equal(parseIndonesianDateStringToIso('Sabat 5 Juli 2026'), '2026-07-05');
    assert.equal(parseIndonesianDateStringToIso('2026-09-12'), '2026-09-12');
    assert.equal(parseIndonesianDateStringToIso('12/09/2026'), '2026-09-12');
    assert.equal(parseIndonesianDateStringToIso('12-09-2026'), '2026-09-12');
    assert.equal(parseIndonesianDateStringToIso('1 Januari 2027'), '2027-01-01');
    assert.equal(parseIndonesianDateStringToIso('28 Februari 2026'), '2026-02-28');
  });

  it('harus mengembalikan null untuk folder non-tanggal (kegiatan khusus)', () => {
    assert.equal(parseIndonesianDateStringToIso('Kegiatan Khusus'), null);
    assert.equal(parseIndonesianDateStringToIso('KKR Pemuda Galilea'), null);
    assert.equal(parseIndonesianDateStringToIso('Bakti Sosial'), null);
    assert.equal(parseIndonesianDateStringToIso(''), null);
  });

  it('harus mem-parsing nomor Triwulan secara akurat dari berbagai format nama folder', () => {
    assert.equal(parseQuarterFromFolderName('Triwulan I'), 1);
    assert.equal(parseQuarterFromFolderName('Triwulan II'), 2);
    assert.equal(parseQuarterFromFolderName('Triwulan III'), 3);
    assert.equal(parseQuarterFromFolderName('Triwulan IV'), 4);
    assert.equal(parseQuarterFromFolderName('Triwulan 1'), 1);
    assert.equal(parseQuarterFromFolderName('Triwulan 3'), 3);
    assert.equal(parseQuarterFromFolderName('Q2'), 2);
    assert.equal(parseQuarterFromFolderName('T4'), 4);
    assert.equal(parseQuarterFromFolderName('Random Folder'), null);
  });

  it('harus menentukan kategori tipe berkas secara presisi', () => {
    assert.equal(determineFileType('image/jpeg', 'foto.jpg'), 'photo');
    assert.equal(determineFileType('image/png', 'warta.png'), 'photo');
    assert.equal(determineFileType('video/mp4', 'khotbah.mp4'), 'video');
    assert.equal(determineFileType('application/pdf', 'tata_ibadah.pdf'), 'pdf');
    assert.equal(determineFileType('application/vnd.ms-powerpoint', 'slide.pptx'), 'presentation');
    assert.equal(determineFileType('application/vnd.ms-excel', 'data.xlsx'), 'spreadsheet');
    assert.equal(determineFileType('application/msword', 'dokumen.docx'), 'document');
    assert.equal(determineFileType('application/octet-stream', 'unknown.bin'), 'other');
  });

  it('harus menghasilkan struktur archive tree dinamis dengan Sabat terdekat WITA sebagai default aktif', async () => {
    const nearest = getNearestSabbath();
    const tree = await discoverArchiveTree();

    assert.ok(tree.availableYears.length > 0);
    assert.equal(tree.selectedYear, nearest.year);
    assert.equal(tree.selectedQuarter, nearest.quarter);
    assert.equal(tree.selectedSabbath, nearest.date);
    assert.ok(tree.sabbaths.length > 0);
    assert.ok(tree.quarters.length === 4);
  });

  it('harus merespons pergantian triwulan dengan benar tanpa tanggal Sabat basi', async () => {
    const treeQ2 = await discoverArchiveTree({ quarter: 2, year: 2026 });
    assert.equal(treeQ2.selectedQuarter, 2);
    assert.equal(treeQ2.selectedYear, 2026);
    assert.ok(treeQ2.selectedSabbath.startsWith('2026-04-') || treeQ2.selectedSabbath.startsWith('2026-05-') || treeQ2.selectedSabbath.startsWith('2026-06-'));
  });

  it('harus mengikuti tahun dan triwulan dari tautan Sabat yang eksplisit', async () => {
    const tree = await discoverArchiveTree({
      year: 2026,
      quarter: 4,
      sabbath: '2026-09-26',
    });

    assert.equal(tree.selectedYear, 2026);
    assert.equal(tree.selectedQuarter, 3);
    assert.equal(tree.selectedSabbath, '2026-09-26');
  });
});
