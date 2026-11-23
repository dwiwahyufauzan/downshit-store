/**
 * Payment gateway SIMULASI untuk demo/pengujian tanpa akun Midtrans (PAYMENT_SIMULATOR="true").
 * Meniru perilaku Midtrans Snap yang dipakai aplikasi: membuat transaksi → pelanggan memilih saluran →
 * status pending (dengan nomor VA / kode bayar) → lunas / gagal / kedaluwarsa. Mengembalikan objek
 * berbentuk `MidtransStatus` sehingga seluruh logika toko (gateway-payments.ts) berjalan SAMA seperti
 * dengan Midtrans asli. Tidak ada uang atau jaringan yang terlibat.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { MIDTRANS_IS_PRODUCTION, MIDTRANS_SERVER_KEY, PAYMENT_SIMULATOR } from '$app/env/private';
import { NOW_ISO, paymentSimulations } from './db/schema';
import { db } from './db';
import { PAYMENT_METHODS, type GatewayMethod } from '#lib/constants';
import type { MidtransStatus, SnapInput } from './midtrans';

/** Aktif hanya bila diminta eksplisit, Midtrans asli tidak terpasang, dan bukan mode produksi Midtrans. */
export const isSimulator = () =>
	PAYMENT_SIMULATOR === 'true' && !MIDTRANS_SERVER_KEY && MIDTRANS_IS_PRODUCTION !== 'true';

export type SimRow = typeof paymentSimulations.$inferSelect;
export type SimOutcome = 'settlement' | 'deny' | 'expire';

const byOrder = (gid: string) =>
	db.select().from(paymentSimulations).where(eq(paymentSimulations.gatewayOrderId, gid)).get();

export const getSimByToken = (token: string) =>
	db.select().from(paymentSimulations).where(eq(paymentSimulations.token, token)).get();

/** Mirip Snap: membuat transaksi dan mengembalikan halaman bayar (di aplikasi ini sendiri). */
export function createSimTransaction(i: SnapInput): { token: string; redirectUrl: string } {
	const token = randomBytes(18).toString('base64url');
	db.insert(paymentSimulations)
		.values({
			gatewayOrderId: i.gatewayOrderId,
			token,
			amount: i.amount,
			method: i.method,
			expiresAt: new Date(Date.now() + Math.max(1, i.expiryMinutes) * 60_000).toISOString()
		})
		.run();
	return { token, redirectUrl: `/simulasi-bayar/${token}` };
}

/* ---------- Saluran & kode bayar buatan ---------- */
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('');
const VA_PREFIX: Record<string, string> = {
	bca_va: '39',
	bni_va: '8800',
	bri_va: '26',
	permata_va: '8528',
	cimb_va: '5000'
};

function makeCode(channel: string): string | null {
	if (channel in VA_PREFIX) return VA_PREFIX[channel] + digits(11);
	if (channel === 'echannel') return digits(9); // bill key (biller code tetap 70012)
	if (channel === 'indomaret') return `IDM${digits(10)}`;
	if (channel === 'alfamart') return `ALF${digits(10)}`;
	return null; // e-wallet & QRIS tidak punya kode
}

/** Saluran yang boleh dipilih untuk transaksi ini (sama dengan `enabled_payments` Snap). */
export const simChannels = (r: Pick<SimRow, 'method'>): string[] => [
	...PAYMENT_METHODS[r.method as GatewayMethod].channels
];

const expireIfDue = (r: SimRow): SimRow => {
	if (r.status === 'pending' && new Date(r.expiresAt).getTime() <= Date.now()) {
		db.update(paymentSimulations)
			.set({ status: 'expire' })
			.where(eq(paymentSimulations.id, r.id))
			.run();
		return { ...r, status: 'expire' };
	}
	return r;
};

/** Pelanggan memilih saluran di halaman bayar → transaksi menjadi `pending` dengan kode bayar. */
export function simChooseChannel(token: string, channel: string): SimRow | 'invalid' {
	const r = getSimByToken(token);
	if (!r) return 'invalid';
	const cur = expireIfDue(r);
	if (cur.status !== 'pending' || !simChannels(cur).includes(channel)) return 'invalid';
	db.update(paymentSimulations)
		.set({ channel, paymentCode: makeCode(channel), updatedAt: NOW_ISO })
		.where(eq(paymentSimulations.id, cur.id))
		.run();
	return getSimByToken(token)!;
}

/** Tombol simulasi: lunas / gagal / kedaluwarsa. Hanya dari `pending` dan setelah saluran dipilih. */
export function simSetOutcome(token: string, outcome: SimOutcome): SimRow | 'invalid' {
	const r = getSimByToken(token);
	if (!r) return 'invalid';
	const cur = expireIfDue(r);
	if (cur.status !== 'pending' || !cur.channel) return 'invalid';
	db.update(paymentSimulations)
		.set({ status: outcome, updatedAt: NOW_ISO })
		.where(eq(paymentSimulations.id, cur.id))
		.run();
	return getSimByToken(token)!;
}

/** Setara POST /v2/{id}/cancel: transaksi yang belum dibayar dibatalkan. */
export function simCancel(gatewayOrderId: string): void {
	const r = byOrder(gatewayOrderId);
	if (r?.status === 'pending') {
		db.update(paymentSimulations)
			.set({ status: 'cancel', updatedAt: NOW_ISO })
			.where(eq(paymentSimulations.id, r.id))
			.run();
	}
}

/* ---------- Status API tiruan ---------- */
const STATUS_CODE = {
	pending: '201',
	settlement: '200',
	deny: '202',
	expire: '407',
	cancel: '200'
};

/** expiry_time Midtrans: "YYYY-MM-DD HH:mm:ss" waktu WIB */
const wib = (iso: string) =>
	new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

/** Setara GET /v2/{id}/status. `null` = belum ada transaksi (saluran belum dipilih), seperti Midtrans asli. */
export function getSimStatus(gatewayOrderId: string): MidtransStatus | null {
	const found = byOrder(gatewayOrderId);
	if (!found) return null;
	const r = expireIfDue(found);
	if (!r.channel) return null;

	const base: MidtransStatus = {
		order_id: r.gatewayOrderId,
		status_code: STATUS_CODE[r.status],
		gross_amount: `${r.amount}.00`,
		transaction_status: r.status,
		transaction_id: `sim-${r.id}`,
		expiry_time: wib(r.expiresAt)
	};
	const c = r.channel;
	if (c in VA_PREFIX) {
		return c === 'permata_va'
			? { ...base, payment_type: 'bank_transfer', permata_va_number: r.paymentCode ?? undefined }
			: {
					...base,
					payment_type: 'bank_transfer',
					va_numbers: [{ bank: c.replace('_va', ''), va_number: r.paymentCode ?? '' }]
				};
	}
	if (c === 'echannel') {
		return {
			...base,
			payment_type: 'echannel',
			biller_code: '70012',
			bill_key: r.paymentCode ?? undefined
		};
	}
	if (c === 'indomaret' || c === 'alfamart') {
		return { ...base, payment_type: 'cstore', store: c, payment_code: r.paymentCode ?? undefined };
	}
	return { ...base, payment_type: c === 'other_qris' ? 'qris' : c };
}
