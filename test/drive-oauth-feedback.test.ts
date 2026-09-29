import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/drive-oauth/route';

function callbackRequest(value: string): NextRequest {
  return new NextRequest('https://drive-galilea.vercel.app/api/drive-oauth', {
    method: 'POST',
    body: new URLSearchParams({ callbackUrl: value }),
  });
}

describe('Drive OAuth callback feedback', () => {
  it('menjelaskan ketika input bukan URL lengkap tanpa mencetak isinya', async () => {
    const response = await POST(callbackRequest('1//contoh-token-rahasia'));
    const html = await response.text();
    assert.equal(response.status, 400);
    assert.match(html, /Alamat belum lengkap/);
    assert.doesNotMatch(html, /contoh-token-rahasia/);
  });

  it('menolak origin yang bukan localhost yang dikonfigurasi', async () => {
    const response = await POST(callbackRequest('https://example.com/oauth2callback?code=abc'));
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Alamat callback tidak sesuai/);
  });

  it('menjelaskan bila URL localhost tidak membawa kode', async () => {
    const response = await POST(callbackRequest('http://localhost:3456/oauth2callback'));
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Kode tidak ditemukan/);
  });
});
