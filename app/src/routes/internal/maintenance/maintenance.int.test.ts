import { describe, expect, it } from 'vitest';
import { POST } from './+server';

// CRON_SECRET di-mock di tests/setup.ts: 'x' × 32. Semua penolakan harus 404 (endpoint "tak terlihat").
const SECRET = 'x'.repeat(32);
const call = async (headers: Record<string, string>) => {
	try {
		const res = await POST({
			request: new Request('http://localhost/internal/maintenance', { method: 'POST', headers })
		} as never);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		return { status: (e as { status: number }).status, body: null };
	}
};

describe('POST /internal/maintenance (TC-017-06)', () => {
	it('tanpa header Authorization → 404', async () => {
		expect((await call({})).status).toBe(404);
	});
	it('token salah → 404', async () => {
		expect((await call({ authorization: 'Bearer salah' })).status).toBe(404);
		expect((await call({ authorization: 'Bearer ' + 'y'.repeat(32) })).status).toBe(404);
	});
	it('bukan skema Bearer → 404', async () => {
		expect((await call({ authorization: SECRET })).status).toBe(404);
		expect((await call({ authorization: 'Basic ' + SECRET })).status).toBe(404);
	});
	it('token benar → 200 + ringkasan job', async () => {
		const r = await call({ authorization: `Bearer ${SECRET}` });
		expect(r.status).toBe(200);
		expect(Object.keys(r.body!).sort()).toEqual([
			'completedOrders',
			'expiredOrders',
			'purgedLoginAttempts',
			'purgedSessions'
		]);
		for (const v of Object.values(r.body as Record<string, number>))
			expect(v).toBeGreaterThanOrEqual(0);
	});
	it('hanya POST yang diekspor (GET → 405 dari SvelteKit)', async () => {
		const mod = await import('./+server');
		expect(Object.keys(mod)).toEqual(['POST']);
	});
});
