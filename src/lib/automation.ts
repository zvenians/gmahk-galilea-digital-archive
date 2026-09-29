import { bootstrapDriveArchive } from './drive-bootstrap';
import { logSystemEvent } from './firestore';
import { AutomationStatus } from './types';
import { getWitaDateParts } from './sabbath';

/**
 * Runs idempotent archive folder structure automation:
 * - Bootstraps root folder 'GMAHK Galilea' in Google Drive if missing
 * - Bootstraps 'Dokumentasi' and 'File Ibadah' branches
 * - Bootstraps Year, Quarter, and all Sabbath folders ('DD Month YYYY')
 * - Skips already existing folders without duplicates
 * - Logs results to system audit logs
 */
export async function runArchiveAutomation(): Promise<AutomationStatus> {
  try {
    const result = await bootstrapDriveArchive({
      year: getWitaDateParts().year,
      quarters: [1, 2, 3, 4],
    });

    if (!result.success) {
      const errDetails = result.error
        ? `Otomasi gagal pada tahap Google Drive: ${result.error}`
        : 'Otomasi gagal pada tahap Google Drive: Terjadi kesalahan tanpa pesan error spesifik.';

      await logSystemEvent({
        type: 'AUTOMATION',
        message: errDetails,
        metadata: {
          logs: result.logs,
          error: result.error,
        },
      });

      return {
        lastRun: new Date().toISOString(),
        status: 'FAILED',
        details: errDetails,
        createdFoldersCount: result.createdFolders.length,
        logs: result.logs,
        error: result.error || errDetails,
      };
    }

    const summaryDetails = `Otomasi Sabat selesai. Total ${result.createdFolders.length} folder baru dibuat. ${result.existingFoldersCount} folder sudah ada diverifikasi.`;

    return {
      lastRun: new Date().toISOString(),
      status: 'SUCCESS',
      details: summaryDetails,
      createdFoldersCount: result.createdFolders.length,
      logs: result.logs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failDetails = `Otomasi gagal pada tahap Google Drive: ${errMsg}`;

    await logSystemEvent({
      type: 'AUTOMATION',
      message: failDetails,
    });

    return {
      lastRun: new Date().toISOString(),
      status: 'FAILED',
      details: failDetails,
      createdFoldersCount: 0,
      logs: [`[FATAL_EXCEPTION] ${failDetails}`],
      error: errMsg,
    };
  }
}
