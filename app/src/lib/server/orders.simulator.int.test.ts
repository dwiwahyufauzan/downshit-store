/**
 * Payment gateway SIMULASI (PAYMENT_SIMULATOR="true", tanpa akun Midtrans): halaman bayar tiruan,
 * pemilihan saluran, hasil berhasil/gagal/kedaluwarsa, dan integrasinya dengan pesanan toko.
 * Tidak boleh ada panggilan jaringan sama sekali.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-orders-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploads: `./tests/.tmp-uploads-orders-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploads,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: 'true'
}));

import { eq } from 'drizzle-orm';
import { db } from './db';
import { paymentSimulations, payments } from './db/schema';
import { getSettings, setSetting } from './settings';
import { cancelOrder } from './orders';
import { enabledMethods, startOnlinePayment, syncPendingForOrder } from './gateway-payments';
import { gatewayMode, getTransactionStatus, isGatewayConfigured } from './midtrans';
import { PAYMENT_NOTE_GATEWAY_EXPIRED } from '#lib/constants';
import * as page from '../../routes/simulasi-bayar/[token]/+page.server';
import {
	U,
	adminId,
	buyer2Id,
	buyerId,
	newOrder,
	orderOf,
	paysOf,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

const fetchSpy = vi.fn(() => {
	throw new Error('Mode simulasi tidak boleh memanggil jaringan');
});
beforeEach(() => vi.stubGlobal('fetch', fetchSpy));
afterAll(() => {
	vi.unstubAllGlobals();
	expect(fetchSpy).not.toHaveBeenCalled();
});

const enableAll = async () => {
	for (const k of ['ewallet', 'qris', 'va', 'minimarket'])
		await setSetting(`pay_${k}_enabled`, 'true');
};

/** Pesanan + percobaan bayar online → token halaman simulasi */
async function started(method: 'ewallet' | 'qris' | 'va' | 'minimarket' = 'ewallet') {
	await enableAll();
	const o = await newOrder();
	const { redirectUrl } = await startOnlinePayment(o.code, buyerId, method);
	return { ...o, redirectUrl, token: redirectUrl.split('/').pop()!, gid: `${o.code}-1` };
}

const ev = (token: string, userId: number, form?: Record<string, string>) =>
	({
		params: { token },
		locals: U(userId),
		request: new Request('http://localhost/simulasi-bayar/x', {
			method: 'POST',
			body: new URLSearchParams(form ?? {})
		})
	}) as never;

const load = (token: string, userId = buyerId) =>
	page.load(ev(token, userId)) as Promise<{
		tx: { status: string; channel: string | null; paymentCode: string | null };
		channels: { key: string; label: string }[];
		returnUrl: string;
	}>;
type ActResult = {
	status?: number;
	location?: string;
	data?: { message?: string };
	success?: boolean;
};
const act = async (
	name: 'pilih' | 'hasil',
	token: string,
	form: Record<string, string>,
	userId = buyerId
): Promise<ActResult> => {
	try {
		return (await (page.actions[name] as (e: never) => Promise<unknown>)(
			ev(token, userId, form)
		)) as ActResult;
	} catch (e) {
		return e as ActResult; // redirect()/error() SvelteKit dilempar
	}
};

describe('mode simulasi aktif', () => {
	it('dianggap gateway terkonfigurasi (tanpa Server Key) dan metode online tampil', async () => {
		expect(isGatewayConfigured()).toBe(true);
		expect(gatewayMode()).toBe('simulator');
		await enableAll();
		expect(enabledMethods(await getSettings())).toEqual([
			'transfer_bank',
			'ewallet',
			'qris',
			'va',
			'minimarket'
		]);
	});
});

describe('mulai bayar → halaman simulasi', () => {
	it('mengarahkan ke /simulasi-bayar/<token> tanpa jaringan; transaksi belum ada sebelum saluran dipilih', async () => {
		const { orderId, redirectUrl, token, gid } = await started();
		expect(redirectUrl).toMatch(/^\/simulasi-bayar\/[\w-]{20,}$/);
		expect(paysOf(orderId)[0]).toMatchObject({
			method: 'ewallet',
			status: 'menunggu',
			gatewayOrderId: gid,
			redirectUrl
		});
		expect(db.select().from(paymentSimulations).get()).toMatchObject({
			token,
			status: 'pending',
			channel: null
		});
		// seperti Midtrans asli: belum memilih saluran = transaksi belum ada
		expect(await getTransactionStatus(gid)).toBeNull();
		await syncPendingForOrder(orderId);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('halaman memuat saluran sesuai metode (e-wallet: GoPay, OVO, DANA, ShopeePay)', async () => {
		const { token } = await started('ewallet');
		const d = await load(token);
		expect(d.channels.map((c) => c.label)).toEqual(['GoPay', 'OVO', 'DANA', 'ShopeePay']);
		expect(d.tx.channel).toBeNull();
		expect(d.returnUrl).toMatch(/^\/pesanan\/DWN-.+\?bayar=kembali$/);
	});

	it('hanya pemilik pesanan yang bisa membuka/memakai halaman (orang lain → 404)', async () => {
		const { token } = await started();
		await expect(load(token, buyer2Id)).rejects.toMatchObject({ status: 404 });
		expect(await act('pilih', token, { channel: 'gopay' }, buyer2Id)).toMatchObject({
			status: 404
		});
		await expect(load('token-ngawur')).rejects.toMatchObject({ status: 404 });
	});
});

describe('memilih saluran', () => {
	it('e-wallet: pending, saluran tersimpan di pembayaran toko', async () => {
		const { orderId, token } = await started('ewallet');
		const r = await act('pilih', token, { channel: 'gopay' });
		expect(r.success).toBe(true);
		expect(paysOf(orderId)[0]).toMatchObject({
			status: 'menunggu',
			gatewayType: 'gopay',
			paymentCode: null
		});
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('VA BCA: nomor VA dibangkitkan dan tersimpan; kode sama saat halaman dibuka lagi', async () => {
		const { orderId, token } = await started('va');
		await act('pilih', token, { channel: 'bca_va' });
		const [p] = paysOf(orderId);
		expect(p.gatewayType).toBe('bca_va');
		expect(p.paymentCode).toMatch(/^39\d{11}$/);
		expect((await load(token)).tx.paymentCode).toBe(p.paymentCode);
	});

	it('minimarket: kode bayar Indomaret', async () => {
		const { orderId, token } = await started('minimarket');
		await act('pilih', token, { channel: 'indomaret' });
		expect(paysOf(orderId)[0]).toMatchObject({ gatewayType: 'indomaret' });
		expect(paysOf(orderId)[0].paymentCode).toMatch(/^IDM\d{10}$/);
	});

	it('saluran di luar metode yang dipilih ditolak (VA tidak boleh dipakai di e-wallet)', async () => {
		const { token } = await started('ewallet');
		const r = await act('pilih', token, { channel: 'bca_va' });
		expect(r.status).toBe(400);
		expect((await load(token)).tx.channel).toBeNull();
	});
});

describe('hasil pembayaran', () => {
	it('BERHASIL → kembali ke toko, pembayaran terkonfirmasi, pesanan diproses', async () => {
		const { orderId, code, token } = await started('qris');
		await act('pilih', token, { channel: 'other_qris' });
		const r = await act('hasil', token, { outcome: 'settlement' });
		expect(r).toMatchObject({ status: 303, location: `/pesanan/${code}?bayar=kembali` });
		expect(paysOf(orderId)[0]).toMatchObject({
			status: 'dikonfirmasi',
			gatewayType: 'qris',
			confirmedBy: null
		});
		expect(orderOf(orderId).status).toBe('diproses');
		expect((await load(token)).tx.status).toBe('settlement');
	});

	it('GAGAL → pembayaran ditolak, pesanan tetap menunggu, bisa coba lagi dengan transaksi baru', async () => {
		const { orderId, code, token } = await started('ewallet');
		await act('pilih', token, { channel: 'gopay' });
		await act('hasil', token, { outcome: 'deny' });
		expect(paysOf(orderId)[0].status).toBe('ditolak');
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		await startOnlinePayment(code, buyerId, 'ewallet');
		expect(paysOf(orderId).map((p) => p.gatewayOrderId)).toEqual([`${code}-1`, `${code}-2`]);
		expect(paysOf(orderId)[1].status).toBe('menunggu');
	});

	it('KEDALUWARSA → ditolak dengan catatan habis waktu', async () => {
		const { orderId, token } = await started();
		await act('pilih', token, { channel: 'dana' });
		await act('hasil', token, { outcome: 'expire' });
		expect(paysOf(orderId)[0]).toMatchObject({
			status: 'ditolak',
			note: PAYMENT_NOTE_GATEWAY_EXPIRED
		});
	});

	it('habis waktu terdeteksi sendiri saat halaman dibuka (tanpa menekan tombol)', async () => {
		const { orderId, token } = await started();
		await act('pilih', token, { channel: 'gopay' });
		db.update(paymentSimulations)
			.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
			.run();
		expect((await load(token)).tx.status).toBe('expire');
		expect(paysOf(orderId)[0].status).toBe('ditolak');
	});

	it('hasil sebelum memilih saluran ditolak; hasil tak dikenal ditolak; tidak bisa diulang', async () => {
		const { orderId, token } = await started();
		expect((await act('hasil', token, { outcome: 'settlement' })).status).toBe(400);
		await act('pilih', token, { channel: 'gopay' });
		expect((await act('hasil', token, { outcome: 'ngawur' })).status).toBe(400);
		await act('hasil', token, { outcome: 'deny' });
		expect((await act('hasil', token, { outcome: 'settlement' })).status).toBe(400); // sudah berakhir
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
		expect(paysOf(orderId)[0].status).toBe('ditolak');
	});
});

describe('integrasi dengan pesanan', () => {
	it('pesanan dibatalkan → transaksi simulasi ikut dibatalkan, tidak bisa dibayar lagi', async () => {
		const { orderId, token } = await started();
		await act('pilih', token, { channel: 'gopay' });
		await cancelOrder(orderId, { id: adminId, role: 'admin' }, 'tes pembatalan');
		expect(db.select().from(paymentSimulations).get()!.status).toBe('cancel');
		expect((await act('hasil', token, { outcome: 'settlement' })).status).toBe(400);
		expect(orderOf(orderId).status).toBe('dibatalkan');
		expect(paysOf(orderId)[0].status).toBe('ditolak');
	});

	it('ganti ke metode lain → transaksi simulasi lama dibatalkan', async () => {
		const { code, token } = await started('ewallet');
		await startOnlinePayment(code, buyerId, 'qris');
		expect(
			db.select().from(paymentSimulations).where(eq(paymentSimulations.token, token)).get()!.status
		).toBe('cancel');
		expect(
			db
				.select()
				.from(payments)
				.where(eq(payments.gatewayOrderId, `${code}-2`))
				.get()!.method
		).toBe('qris');
	});
});
