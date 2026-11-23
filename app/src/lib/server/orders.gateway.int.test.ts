/**
 * Pembayaran online Midtrans: mulai bayar, notifikasi (webhook), sinkronisasi Status API, pembatalan,
 * kedaluwarsa, dan benturan dengan transfer manual. Midtrans dipalsukan lewat stub `fetch`.
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
	MIDTRANS_SERVER_KEY: 'SB-Mid-server-test',
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { orders, payments } from './db/schema';
import { setSetting } from './settings';
import { cancelOrder, expireUnpaidOrders } from './orders';
import { confirmPayment, submitPaymentProof } from './order-flow';
import {
	applyGatewayStatus,
	enabledMethods,
	startOnlinePayment,
	syncPendingForOrder
} from './gateway-payments';
import { getSettings } from './settings';
import type { MidtransStatus } from './midtrans';
import { POST as webhook } from '../../routes/api/midtrans/notification/+server';
import {
	PAYMENT_NOTE_GATEWAY_EXPIRED,
	PAYMENT_NOTE_GATEWAY_REPLACED,
	PAYMENT_NOTE_LATE_REFUND
} from '#lib/constants';
import {
	adminId,
	buyer2Id,
	buyerId,
	catchResult,
	expireNow,
	logsOf,
	newOrder,
	orderOf,
	paysOf,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

const KEY = 'SB-Mid-server-test';
const sign = (id: string, code: string, gross: string) =>
	createHash('sha512').update(`${id}${code}${gross}${KEY}`).digest('hex');

/* ---------- Midtrans palsu ---------- */
let calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
let remote = new Map<string, MidtransStatus | 'down'>();
let snapFails = false;

const fakeFetch = async (url: string | URL, init?: RequestInit) => {
	const u = String(url);
	const method = init?.method ?? 'GET';
	const body = init?.body ? JSON.parse(String(init.body)) : undefined;
	calls.push({ method, url: u, body });
	const reply = (status: number, json: unknown) =>
		new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

	if (u.includes('/snap/v1/transactions')) {
		if (snapFails) return reply(500, { error_messages: ['boom'] });
		const t = `tok-${calls.length}`;
		return reply(201, {
			token: t,
			redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/${t}`
		});
	}
	const m = u.match(/\/v2\/([^/]+)\/(status|cancel)$/);
	if (m) {
		const id = decodeURIComponent(m[1]);
		if (m[2] === 'cancel') return reply(200, { status_code: '200' });
		const r = remote.get(id);
		if (r === 'down') return reply(503, { status_message: 'down' });
		return reply(200, r ?? { status_code: '404', status_message: "Transaction doesn't exist." });
	}
	return reply(404, {});
};

beforeEach(() => {
	calls = [];
	remote = new Map();
	snapFails = false;
	vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterAll(() => vi.unstubAllGlobals());

const enable = async (...keys: string[]) => {
	for (const k of keys) await setSetting(`pay_${k}_enabled`, 'true');
};
const cancelsOf = () => calls.filter((c) => c.url.endsWith('/cancel')).map((c) => c.url);

/** Status transaksi seperti yang dikembalikan Midtrans untuk percobaan bayar `gid` */
const status = (gid: string, over: Partial<MidtransStatus> = {}): MidtransStatus => {
	const p = db.select().from(payments).where(eq(payments.gatewayOrderId, gid)).get()!;
	return {
		order_id: gid,
		status_code: '200',
		gross_amount: `${p.amount}.00`,
		transaction_status: 'settlement',
		payment_type: 'gopay',
		transaction_id: 'trx-1',
		...over
	};
};

/** Kirim notifikasi seperti Midtrans: status resmi di Status API, tanda tangan di body */
async function notify(
	n: MidtransStatus,
	official: MidtransStatus | 'down' = n,
	signature?: string
) {
	remote.set(n.order_id, official);
	try {
		const res = await webhook({
			request: new Request('http://localhost/api/midtrans/notification', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...n,
					signature_key: signature ?? sign(n.order_id, n.status_code, n.gross_amount)
				})
			})
		} as never);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		return { status: (e as { status: number }).status, body: null };
	}
}

/* ====================================================================== */
describe('metode yang ditawarkan', () => {
	it('bawaan: hanya transfer bank (metode online perlu diaktifkan admin)', async () => {
		expect(enabledMethods(await getSettings())).toEqual(['transfer_bank']);
	});

	it('metode online yang diaktifkan muncul (Midtrans terkonfigurasi)', async () => {
		await enable('ewallet', 'qris', 'va', 'minimarket');
		expect(enabledMethods(await getSettings())).toEqual([
			'transfer_bank',
			'ewallet',
			'qris',
			'va',
			'minimarket'
		]);
	});

	it('semua dimatikan → tetap transfer bank (tidak ada jalan buntu)', async () => {
		await setSetting('pay_transfer_enabled', 'false');
		expect(enabledMethods(await getSettings())).toEqual(['transfer_bank']);
	});

	it('metode online yang belum diaktifkan ditolak', async () => {
		const { code } = await newOrder();
		const r = await catchResult(() => startOnlinePayment(code, buyerId, 'ewallet'));
		expect(r.ok).toBe(false);
		expect(r.ok === false && r.error.message).toMatch(/tidak tersedia/);
		expect(calls).toHaveLength(0);
	});
});

describe('mulai pembayaran online', () => {
	it('membuat satu baris menunggu + transaksi Snap dengan nominal & saluran yang benar', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		const r = await startOnlinePayment(code, buyerId, 'ewallet');

		expect(r.redirectUrl).toMatch(
			/^https:\/\/app\.sandbox\.midtrans\.com\/snap\/v4\/redirection\//
		);
		const pays = paysOf(orderId);
		expect(pays).toHaveLength(1);
		expect(pays[0]).toMatchObject({
			method: 'ewallet',
			status: 'menunggu',
			amount: 115_000,
			gatewayOrderId: `${code}-1`,
			redirectUrl: r.redirectUrl,
			proofUrl: null
		});
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		const snap = calls.find((c) => c.url.includes('/snap/v1/transactions'))!;
		const body = snap.body as {
			transaction_details: { order_id: string; gross_amount: number };
			item_details: { price: number; quantity: number }[];
			enabled_payments: string[];
			expiry: { unit: string; duration: number };
		};
		expect(body.transaction_details).toEqual({ order_id: `${code}-1`, gross_amount: 115_000 });
		// jumlah item_details wajib = gross_amount (kalau tidak, Midtrans menolak)
		expect(body.item_details.reduce((s, i) => s + i.price * i.quantity, 0)).toBe(115_000);
		expect(body.enabled_payments).toEqual(['gopay', 'ovo', 'dana', 'shopeepay']);
		expect(body.expiry.unit).toBe('minutes');
		expect(body.expiry.duration).toBeGreaterThan(24 * 60 - 3);
		expect(body.expiry.duration).toBeLessThanOrEqual(24 * 60);
		expect(logsOf(orderId).map((l) => l.action)).toContain('payment.start');
	});

	it('memakai ulang halaman bayar untuk metode yang sama (tanpa transaksi baru)', async () => {
		await enable('qris');
		const { orderId, code } = await newOrder();
		const a = await startOnlinePayment(code, buyerId, 'qris');
		const b = await startOnlinePayment(code, buyerId, 'qris');
		expect(b.redirectUrl).toBe(a.redirectUrl);
		expect(paysOf(orderId)).toHaveLength(1);
		expect(calls.filter((c) => c.url.includes('/snap/')).length).toBe(1);
	});

	it('ganti metode: percobaan lama ditolak & dibatalkan di Midtrans, percobaan baru dibuat', async () => {
		await enable('ewallet', 'va');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		await startOnlinePayment(code, buyerId, 'va');

		const pays = paysOf(orderId);
		expect(pays.map((p) => [p.gatewayOrderId, p.status])).toEqual([
			[`${code}-1`, 'ditolak'],
			[`${code}-2`, 'menunggu']
		]);
		expect(pays[0].note).toBe(PAYMENT_NOTE_GATEWAY_REPLACED);
		expect(cancelsOf().some((u) => u.includes(`${code}-1`))).toBe(true);
	});

	it('Midtrans error → pesanan utuh, tidak ada baris sisa, pelanggan dapat pesan jelas', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		snapFails = true;
		const r = await catchResult(() => startOnlinePayment(code, buyerId, 'ewallet'));
		expect(r.ok).toBe(false);
		expect(r.ok === false && r.error.message).toMatch(/Pembayaran online sedang bermasalah/);
		expect(paysOf(orderId)).toHaveLength(0);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('pesanan orang lain → tidak ditemukan; status bukan menunggu_pembayaran → ditolak', async () => {
		await enable('ewallet');
		const { code } = await newOrder();
		const other = await catchResult(() => startOnlinePayment(code, buyer2Id, 'ewallet'));
		expect(other.ok === false && other.error.kind).toBe('not_found');

		await cancelOrder(
			orderOf((await newOrder()).orderId).id,
			{ id: adminId, role: 'admin' },
			'tes batal'
		);
		const o = db.select().from(orders).where(eq(orders.status, 'dibatalkan')).get()!;
		const r = await catchResult(() => startOnlinePayment(o.code, o.userId, 'ewallet'));
		expect(r.ok).toBe(false);
	});

	it('batas bayar hampir habis → ditolak (tidak membuat transaksi)', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		db.update(orders)
			.set({ expiresAt: new Date(Date.now() + 30_000).toISOString() })
			.where(eq(orders.id, orderId))
			.run();
		const r = await catchResult(() => startOnlinePayment(code, buyerId, 'ewallet'));
		expect(r.ok === false && r.error.message).toMatch(/batas waktu/i);
		expect(calls).toHaveLength(0);
	});
});

describe('notifikasi Midtrans (webhook)', () => {
	async function started(method: 'ewallet' | 'va' = 'ewallet') {
		await enable('ewallet', 'va', 'qris');
		const o = await newOrder();
		await startOnlinePayment(o.code, buyerId, method);
		return { ...o, gid: `${o.code}-1` };
	}

	it('settlement: pembayaran dikonfirmasi otomatis, pesanan langsung diproses', async () => {
		const { orderId, gid } = await started();
		const r = await notify(status(gid));
		expect(r.status).toBe(200);

		const [p] = paysOf(orderId);
		expect(p).toMatchObject({
			status: 'dikonfirmasi',
			gatewayType: 'gopay',
			gatewayTxId: 'trx-1',
			confirmedBy: null
		});
		expect(p.confirmedAt).toBeTruthy();
		expect(orderOf(orderId).status).toBe('diproses');
		const log = logsOf(orderId).find((l) => l.action === 'payment.confirm')!;
		expect(log.userId).toBeNull(); // sistem, bukan admin
		expect(log.description).toMatch(/GoPay/);
	});

	it('idempoten: notifikasi yang sama berulang tidak mengubah apa pun', async () => {
		const { orderId, gid } = await started();
		await notify(status(gid));
		const before = { p: paysOf(orderId), o: orderOf(orderId), logs: logsOf(orderId).length };
		for (let i = 0; i < 3; i++) expect((await notify(status(gid))).status).toBe(200);
		expect(paysOf(orderId)).toEqual(before.p);
		expect(orderOf(orderId)).toEqual(before.o);
		expect(logsOf(orderId)).toHaveLength(before.logs);
	});

	it('tanda tangan salah → 403 dan tidak ada perubahan', async () => {
		const { orderId, gid } = await started();
		const r = await notify(status(gid), status(gid), 'bukan-signature');
		expect(r.status).toBe(403);
		expect(paysOf(orderId)[0].status).toBe('menunggu');
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('notifikasi palsu "settlement" tapi Status API bilang pending → tidak dianggap lunas', async () => {
		const { orderId, gid } = await started();
		await notify(status(gid), status(gid, { transaction_status: 'pending' }));
		expect(paysOf(orderId)[0].status).toBe('menunggu');
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('nominal tidak cocok dengan tagihan → diabaikan', async () => {
		const { orderId, gid } = await started();
		await notify(status(gid, { gross_amount: '1000.00' }));
		expect(paysOf(orderId)[0].status).toBe('menunggu');
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('Status API tidak bisa dihubungi → 503 agar Midtrans mengirim ulang', async () => {
		const { gid } = await started();
		expect((await notify(status(gid), 'down')).status).toBe(503);
	});

	it('order_id tak dikenal / transaksi tak ada → 200 (tidak diulang terus), tanpa perubahan', async () => {
		await started();
		const ghost: MidtransStatus = {
			order_id: 'DWN-000000-ZZZZ-1',
			status_code: '200',
			gross_amount: '1.00',
			transaction_status: 'settlement'
		};
		const r = await notify(ghost);
		expect(r.status).toBe(200);
		expect(await applyGatewayStatus(ghost)).toBe('unknown');
	});

	it('pending VA: kode bayar & saluran tersimpan untuk ditampilkan ke pelanggan', async () => {
		const { orderId, gid } = await started('va');
		await notify(
			status(gid, {
				status_code: '201',
				transaction_status: 'pending',
				payment_type: 'bank_transfer',
				va_numbers: [{ bank: 'bca', va_number: '81234567890' }],
				expiry_time: '2030-01-01 10:00:00'
			})
		);
		expect(paysOf(orderId)[0]).toMatchObject({
			status: 'menunggu',
			gatewayType: 'bca_va',
			paymentCode: '81234567890',
			expiresAt: '2030-01-01T03:00:00.000Z'
		});
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('expire: baris ditolak, pesanan tetap menunggu_pembayaran dan bisa bayar ulang', async () => {
		const { orderId, code, gid } = await started();
		await notify(status(gid, { transaction_status: 'expire', status_code: '407' }));
		const [p] = paysOf(orderId);
		expect(p).toMatchObject({ status: 'ditolak', note: PAYMENT_NOTE_GATEWAY_EXPIRED });
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');

		await startOnlinePayment(code, buyerId, 'qris');
		expect(paysOf(orderId).map((x) => x.gatewayOrderId)).toEqual([gid, `${code}-2`]);
	});

	it('lunas setelah pesanan dibatalkan → dana ditandai dikembalikan (refund manual) + log', async () => {
		const { orderId, gid } = await started();
		await cancelOrder(orderId, { id: buyerId, role: 'konsumen' }, 'berubah pikiran');
		expect(cancelsOf().some((u) => u.includes(gid))).toBe(true); // transaksi ikut dibatalkan di Midtrans

		await notify(status(gid)); // pelanggan sempat membayar sebelum pembatalan berlaku
		const [p] = paysOf(orderId);
		expect(p).toMatchObject({ status: 'dikembalikan', note: PAYMENT_NOTE_LATE_REFUND });
		expect(orderOf(orderId).status).toBe('dibatalkan');
		expect(logsOf(orderId).map((l) => l.action)).toContain('payment.refund_needed');
	});

	it('refund lewat dashboard Midtrans → baris menjadi dikembalikan', async () => {
		const { orderId, gid } = await started();
		await notify(status(gid));
		await notify(status(gid, { transaction_status: 'refund' }));
		expect(paysOf(orderId)[0].status).toBe('dikembalikan');
		expect(logsOf(orderId).map((l) => l.action)).toContain('payment.refund');
	});
});

describe('benturan dengan transfer manual', () => {
	it('unggah bukti transfer membatalkan pembayaran online yang menunggu', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');

		const pays = paysOf(orderId);
		expect(pays.map((p) => [p.method, p.status])).toEqual([
			['ewallet', 'ditolak'],
			['transfer_bank', 'menunggu']
		]);
		expect(cancelsOf().some((u) => u.includes(`${code}-1`))).toBe(true);
		expect(orderOf(orderId).status).toBe('menunggu_konfirmasi');
	});

	it('transfer manual dimatikan → unggah bukti ditolak', async () => {
		await setSetting('pay_transfer_enabled', 'false');
		const { code } = await newOrder();
		const r = await catchResult(() => submitPaymentProof(code, buyerId, '/uploads/proofs/a.png'));
		expect(r.ok === false && r.error.message).toMatch(/Transfer bank manual/);
	});

	it('admin tidak bisa "mengonfirmasi" pembayaran online secara manual', async () => {
		await enable('ewallet');
		const { code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		const r = await catchResult(() => confirmPayment(code, adminId));
		expect(r.ok).toBe(false);
	});

	it('online lunas saat bukti transfer sudah diunggah → bukti ditolak otomatis, pesanan diproses', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png'); // gateway ditolak + dibatalkan

		// pelanggan terlanjur membayar di halaman lama
		await notify(status(`${code}-1`));
		const pays = paysOf(orderId);
		expect(pays[0].status).toBe('dikonfirmasi');
		expect(pays[1]).toMatchObject({ method: 'transfer_bank', status: 'ditolak' });
		expect(orderOf(orderId).status).toBe('diproses');
	});

	it('bayar dua kali (online lalu online lain) → yang kedua ditandai dikembalikan', async () => {
		await enable('ewallet', 'va');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		await startOnlinePayment(code, buyerId, 'va');
		await notify(status(`${code}-2`, { payment_type: 'bank_transfer' }));
		await notify(status(`${code}-1`)); // halaman lama juga dibayar
		const pays = paysOf(orderId);
		expect(pays[1].status).toBe('dikonfirmasi');
		expect(pays[0].status).toBe('dikembalikan');
		expect(orderOf(orderId).status).toBe('diproses');
	});
});

describe('sinkronisasi tanpa notifikasi', () => {
	it('syncPendingForOrder membaca Status API dan melunasi pesanan', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		remote.set(`${code}-1`, status(`${code}-1`));
		await syncPendingForOrder(orderId);
		expect(orderOf(orderId).status).toBe('diproses');
		expect(paysOf(orderId)[0].status).toBe('dikonfirmasi');
	});

	it('Status API error → diam-diam dilewati, data tidak berubah', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		remote.set(`${code}-1`, 'down');
		await syncPendingForOrder(orderId);
		expect(orderOf(orderId).status).toBe('menunggu_pembayaran');
	});

	it('kedaluwarsa otomatis: pembayaran online yang lunas di batas waktu tidak ikut dibatalkan', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		expireNow(orderId);
		remote.set(`${code}-1`, status(`${code}-1`)); // notifikasi telat, tapi sudah lunas di Midtrans

		expect(await expireUnpaidOrders()).toBe(0);
		expect(orderOf(orderId).status).toBe('diproses');
	});

	it('kedaluwarsa otomatis: yang benar-benar belum dibayar dibatalkan + transaksi Midtrans dibatalkan', async () => {
		await enable('ewallet');
		const { orderId, code } = await newOrder();
		await startOnlinePayment(code, buyerId, 'ewallet');
		expireNow(orderId);
		remote.set(
			`${code}-1`,
			status(`${code}-1`, { transaction_status: 'pending', status_code: '201' })
		);

		expect(await expireUnpaidOrders()).toBe(1);
		expect(orderOf(orderId).status).toBe('dibatalkan');
		expect(paysOf(orderId)[0].status).toBe('ditolak');
		expect(cancelsOf().some((u) => u.includes(`${code}-1`))).toBe(true);
	});
});
