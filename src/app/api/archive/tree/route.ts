import { NextRequest, NextResponse } from 'next/server';
import { classifyDriveError, discoverArchiveTree } from '@/lib/drive';
import { ArchiveCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get('year');
    const quarterParam = searchParams.get('quarter');
    const sabbathDate = searchParams.get('sabbath') || undefined;
    const category = (searchParams.get('category') as ArchiveCategory) || 'documentation';

    const year = yearParam ? parseInt(yearParam, 10) : undefined;
    const quarter = quarterParam ? parseInt(quarterParam, 10) : undefined;

    const treeData = await discoverArchiveTree({
      category,
      year: year && !isNaN(year) ? year : undefined,
      quarter: quarter && !isNaN(quarter) ? quarter : undefined,
      sabbath: sabbathDate,
    });

    return NextResponse.json({
      success: true,
      data: treeData,
    });
  } catch (error) {
    console.error('API Archive tree error:', error);
    if (classifyDriveError(error).kind === 'AUTH_ERROR') {
      return NextResponse.json({ success: false, code: 'DRIVE_AUTH_ERROR', error: 'Koneksi Google Drive sedang tidak tersedia.' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: 'Failed to fetch archive tree' }, { status: 500 });
  }
}
