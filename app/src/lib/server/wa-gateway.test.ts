import { beforeEach, describe, expect, it, vi } from 'vitest';

const vars = vi.hoisted(
	() => ({ WA_PROVIDER: 'fonnte', WA_API_TOKEN: 'tok' }) as Record<string, string>
);
vi.mock('./config', () => ({ envVar: (n: string) => vars[n] }));

import { sendWhatsApp, waEnabled } from './wa-gateway';

beforeEach(() => {
	vars.WA_PROVIDER = 'fonnte';
	vi.unstubAllGlobals();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('WhatsApp gateway (Fonnte)', () => {
	it('mengirim ke nomor yang dinormalkan dengan token di header', async () => {
		const f = vi.fn(async (_u: string, _i?: RequestInit) => ({
			ok: true,
			status: 200,
			json: async () => ({ status: true })
		}));
		vi.stubGlobal('fetch', f);
		expect(await sendWhatsApp('0812-3456-7890', 'Halo')).toBe(true);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://api.fonnte.com/send');
		expect((init!.headers as Record<string, string>).authorization).toBe('tok');
		const body = init!.body as URLSearchParams;
		expect(body.get('target')).toBe('6281234567890');
		expect(body.get('message')).toBe('Halo');
	});

	it('nomor tidak valid / provider mati → false tanpa memanggil jaringan', async () => {
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		expect(await sendWhatsApp('12345', 'x')).toBe(false);
		expect(await sendWhatsApp(null, 'x')).toBe(false);
		vars.WA_PROVIDER = '';
		expect(waEnabled()).toBe(false);
		expect(await sendWhatsApp('081234567890', 'x')).toBe(false);
		expect(f).not.toHaveBeenCalled();
	});

	it('penyedia menolak (status:false) atau jaringan error → false, tidak melempar', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({ status: false, reason: 'token invalid' })
			}))
		);
		expect(await sendWhatsApp('081234567890', 'x')).toBe(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('timeout')))
		);
		expect(await sendWhatsApp('081234567890', 'x')).toBe(false);
	});
});
