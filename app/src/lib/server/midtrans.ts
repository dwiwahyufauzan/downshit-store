/**
 * Klien Midtrans (Snap + Status API) tanpa SDK: cukup fetch + Basic auth.
 * Docs: https://docs.midtrans.com
 *
 * Tanpa MIDTRANS_SERVER_KEY, `isGatewayConfigured()` = false dan toko hanya menawarkan transfer manual,
 * kecuali PAYMENT_SIMULATOR="true": semua panggilan dialihkan ke simulator internal (payment-simulator.ts).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { MIDTRANS_IS_PRODUCTION, MIDTRANS_SERVER_KEY, ORIGIN } from '$app/env/private';
import { PAYMENT_METHODS, type GatewayMethod } from '#lib/constants';
import { createSimTransaction, getSimStatus, isSimulator, simCancel } from './payment-simulator';

export class GatewayError extends Error {
	/**
	 * true = tidak pasti apakah Midtrans sempat memproses permintaan (timeout/jaringan/balasan rusak).
	 * Pada pembuatan transaksi, order_id yang ambigu tidak boleh dipakai ulang.
	 */
	constructor(
		message: string,
		readonly ambiguous = false
	) {
		super(message);
		this.name = 'GatewayError';
	}
}

const isProd = () => MIDTRANS_IS_PRODUCTION === 'true';
const SNAP_URL = () =>
	isProd()
		? 'https://app.midtrans.com/snap/v1/transactions'
		: 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const API_URL = () =>
	isProd() ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';

export const isGatewayConfigured = () => !!MIDTRANS_SERVER_KEY || isSimulator();
export const gatewayMode = (): 'production' | 'sandbox' | 'simulator' =>
	isSimulator() ? 'simulator' : isProd() ? 'production' : 'sandbox';

const TIMEOUT_MS = 10_000;

async function call<T>(
	method: 'GET' | 'POST',
	url: string,
	body?: unknown,
	timeoutMs = TIMEOUT_MS
): Promise<T> {
	if (!MIDTRANS_SERVER_KEY) throw new GatewayError('Pembayaran online belum dikonfigurasi');
	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				Authorization: `Basic ${Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64')}`
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (e) {
		throw new GatewayError(`Tidak dapat menghubungi Midtrans: ${(e as Error).message}`, true);
	}
	const text = await res.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		throw new GatewayError(`Balasan Midtrans tidak valid (HTTP ${res.status})`, true);
	}
	if (!res.ok) {
		const j = json as { error_messages?: string[]; status_message?: string };
		throw new GatewayError(
			j.error_messages?.join('; ') ||
				j.status_message ||
				`Midtrans menolak permintaan (${res.status})`
		);
	}
	return json as T;
}

/* ---------- Snap: buat transaksi ---------- */
export type SnapInput = {
	/** order_id unik per percobaan bayar */
	gatewayOrderId: string;
	orderCode: string;
	amount: number;
	method: GatewayMethod;
	/** sisa waktu bayar dalam menit (minimal 1) */
	expiryMinutes: number;
	items: { name: string; price: number; quantity: number }[];
	customer: { name: string; email: string; phone: string };
};

export async function createSnapTransaction(
	i: SnapInput
): Promise<{ token: string; redirectUrl: string }> {
	if (isSimulator()) return createSimTransaction(i);
	const origin = ORIGIN?.replace(/\/+$/, '');
	const r = await call<{ token?: string; redirect_url?: string }>('POST', SNAP_URL(), {
		transaction_details: { order_id: i.gatewayOrderId, gross_amount: i.amount },
		item_details: i.items.map((it) => ({
			id: it.name.slice(0, 50),
			name: it.name.slice(0, 50),
			price: it.price,
			quantity: it.quantity
		})),
		customer_details: {
			first_name: i.customer.name.slice(0, 255),
			email: i.customer.email,
			phone: i.customer.phone
		},
		enabled_payments: [...PAYMENT_METHODS[i.method].channels],
		expiry: { unit: 'minutes', duration: Math.max(1, i.expiryMinutes) },
		...(origin ? { callbacks: { finish: `${origin}/pesanan/${i.orderCode}?bayar=kembali` } } : {})
	});
	if (!r.token || !r.redirect_url)
		throw new GatewayError('Midtrans tidak mengembalikan halaman bayar');
	return { token: r.token, redirectUrl: r.redirect_url };
}

/* ---------- Status ---------- */
export type MidtransStatus = {
	order_id: string;
	status_code: string;
	gross_amount: string;
	transaction_status: string;
	fraud_status?: string;
	payment_type?: string;
	transaction_id?: string;
	signature_key?: string;
	expiry_time?: string;
	va_numbers?: { bank: string; va_number: string }[];
	permata_va_number?: string;
	bill_key?: string;
	biller_code?: string;
	payment_code?: string;
	store?: string;
};

/** Status transaksi dari sumber resmi; `null` bila transaksi belum pernah dibuka/dipilih salurannya. */
export async function getTransactionStatus(
	gatewayOrderId: string,
	timeoutMs = TIMEOUT_MS
): Promise<MidtransStatus | null> {
	if (isSimulator()) return getSimStatus(gatewayOrderId);
	const r = await call<MidtransStatus>(
		'GET',
		`${API_URL()}/${encodeURIComponent(gatewayOrderId)}/status`,
		undefined,
		timeoutMs
	);
	// Midtrans membalas HTTP 200 dengan status_code "404" untuk transaksi yang tidak ada
	return r.status_code === '404' ? null : r;
}

/** Batalkan transaksi yang belum dibayar (VA/kode bayar langsung tidak berlaku). Gagal = diabaikan. */
export async function cancelTransaction(gatewayOrderId: string): Promise<void> {
	if (isSimulator()) return simCancel(gatewayOrderId);
	if (!isGatewayConfigured()) return;
	try {
		await call('POST', `${API_URL()}/${encodeURIComponent(gatewayOrderId)}/cancel`, {});
	} catch (e) {
		// transaksi belum dibuka / sudah berakhir: tidak ada yang perlu dibatalkan
		console.warn('[midtrans] cancel', gatewayOrderId, (e as Error).message);
	}
}

/* ---------- Notifikasi ---------- */
const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');

/** signature_key = SHA512(order_id + status_code + gross_amount + ServerKey) */
export function verifySignature(n: Partial<MidtransStatus>): boolean {
	if (!MIDTRANS_SERVER_KEY || typeof n.signature_key !== 'string' || !n.signature_key) return false;
	const expected = sha512(
		`${n.order_id ?? ''}${n.status_code ?? ''}${n.gross_amount ?? ''}${MIDTRANS_SERVER_KEY}`
	);
	const a = Buffer.from(expected);
	const b = Buffer.from(n.signature_key);
	return a.length === b.length && timingSafeEqual(a, b);
}

export type GatewayOutcome = 'paid' | 'pending' | 'failed' | 'refunded' | 'partial_refund';

/** Peta transaction_status Midtrans → hasil yang dipahami toko. */
export function classify(
	s: Pick<MidtransStatus, 'transaction_status' | 'fraud_status'>
): GatewayOutcome {
	switch (s.transaction_status) {
		case 'settlement':
			return 'paid';
		case 'capture':
			// kartu: hanya fraud_status "accept" (atau tidak ada) yang boleh dianggap lunas
			if (!s.fraud_status || s.fraud_status === 'accept') return 'paid';
			return s.fraud_status === 'deny' ? 'failed' : 'pending';
		case 'deny':
		case 'cancel':
		case 'expire':
		case 'failure':
			return 'failed';
		case 'refund':
		case 'chargeback':
			return 'refunded';
		case 'partial_refund':
		case 'partial_chargeback':
			return 'partial_refund'; // sebagian saja: pesanan jangan dianggap dikembalikan penuh
		default:
			return 'pending'; // pending, authorize, …
	}
}

/** Kunci saluran (lihat GATEWAY_TYPE_LABEL) + kode bayar yang harus ditunjukkan ke pelanggan. */
export function channelOf(s: MidtransStatus): { type: string | null; code: string | null } {
	switch (s.payment_type) {
		case 'bank_transfer': {
			const va = s.va_numbers?.[0];
			if (va) return { type: `${va.bank.toLowerCase()}_va`, code: va.va_number };
			if (s.permata_va_number) return { type: 'permata_va', code: s.permata_va_number };
			return { type: 'bank_transfer', code: null };
		}
		case 'echannel':
			return {
				type: 'echannel',
				code: [s.biller_code, s.bill_key].filter(Boolean).join(' / ') || null
			};
		case 'cstore':
			return { type: s.store ?? 'cstore', code: s.payment_code ?? null };
		default:
			return { type: s.payment_type ?? null, code: null };
	}
}

/** expiry_time Midtrans berformat "YYYY-MM-DD HH:mm:ss" dalam WIB (+07:00) → ISO UTC. */
export function parseExpiry(t: string | undefined): string | null {
	if (!t) return null;
	const d = new Date(`${t.replace(' ', 'T')}+07:00`);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** gross_amount Midtrans berupa string desimal ("115000.00") → rupiah bulat, NaN bila rusak. */
export const grossToRupiah = (g: string | undefined) => Math.round(Number(g));
