/**
 * Pembayaran online (Midtrans): membuat transaksi, menerapkan status dari notifikasi/Status API,
 * dan menyinkronkan transaksi yang menggantung.
 *
 * Aturan inti:
 * - Satu baris `payments` per percobaan bayar (`gatewayOrderId` unik); pesanan tetap `menunggu_pembayaran`
 *   selama transaksi belum lunas, jadi batas bayar & pembatalan otomatis tetap berlaku.
 * - Lunas → baris `dikonfirmasi` dan pesanan langsung `diproses` (tanpa verifikasi admin). Idempoten:
 *   notifikasi yang sama boleh datang berulang kali.
 * - Pesanan sudah dibatalkan / sudah dibayar lewat jalur lain → dana ditandai `dikembalikan`
 *   (refund manual lewat dashboard Midtrans) dan dicatat di log aktivitas.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, transact } from './db';
import { orderItems, orders, payments, users } from './db/schema';
import { logActivity } from './activity';
import { OrderError } from './order-error';
import { getSettings, PAY_FIELD, type StoreSettings } from './settings';
import {
	GatewayError,
	cancelTransaction,
	channelOf,
	classify,
	createSnapTransaction,
	getTransactionStatus,
	grossToRupiah,
	isGatewayConfigured,
	parseExpiry,
	type MidtransStatus
} from './midtrans';
import {
	GATEWAY_TYPE_LABEL,
	PAYMENT_METHODS,
	PAYMENT_METHOD_KEYS,
	PAYMENT_NOTE_DOUBLE_REFUND,
	PAYMENT_NOTE_GATEWAY_EXPIRED,
	PAYMENT_NOTE_GATEWAY_FAILED,
	PAYMENT_NOTE_GATEWAY_REPLACED,
	PAYMENT_NOTE_LATE_REFUND,
	PAYMENT_NOTE_PARTIAL_REFUND,
	type GatewayMethod,
	type PaymentMethod
} from '#lib/constants';

export type PaymentRow = typeof payments.$inferSelect;

/** Sisa waktu bayar minimum agar transaksi online masih layak dibuat. */
const MIN_REMAINING_MS = 2 * 60_000;
/** Batas waktu sebuah percobaan bayar dianggap masih "sedang dibuat" (belum punya halaman bayar). */
const IN_FLIGHT_MS = 30_000;

/* ---------- Metode yang ditawarkan ---------- */
export type PaymentOption = { method: PaymentMethod; label: string; hint: string };

/** Metode aktif menurut pengaturan toko; metode online hanya bila Midtrans terkonfigurasi. */
export function enabledMethods(cfg: StoreSettings): PaymentMethod[] {
	const online = isGatewayConfigured();
	const list = PAYMENT_METHOD_KEYS.filter(
		(m) => cfg[PAY_FIELD[m]] && (m === 'transfer_bank' || online)
	);
	// jangan sampai pelanggan tak punya cara bayar sama sekali
	return list.length > 0 ? list : ['transfer_bank'];
}

export async function getPaymentOptions(cfg?: StoreSettings): Promise<PaymentOption[]> {
	return enabledMethods(cfg ?? (await getSettings())).map((method) => ({
		method,
		label: PAYMENT_METHODS[method].label,
		hint: PAYMENT_METHODS[method].hint
	}));
}

/* ---------- Mulai pembayaran online ---------- */
type Prepared =
	| { kind: 'reuse'; redirectUrl: string }
	| {
			kind: 'new';
			paymentId: number;
			gatewayOrderId: string;
			orderId: number;
			orderCode: string;
			amount: number;
			expiresAt: string | null;
			expiryMinutes: number;
			items: { name: string; price: number; quantity: number }[];
			customer: { name: string; email: string; phone: string };
			replaced: string[];
	  };

export async function startOnlinePayment(
	code: string,
	userId: number,
	method: GatewayMethod
): Promise<{ redirectUrl: string }> {
	if (!isGatewayConfigured()) throw new OrderError('Pembayaran online belum tersedia');
	const cfg = await getSettings();
	if (!enabledMethods(cfg).includes(method)) {
		throw new OrderError('Metode pembayaran ini sedang tidak tersedia');
	}

	// 1) Validasi + cadangkan baris pembayaran (atomik). Panggilan jaringan sengaja di luar transaksi.
	const prep = await transact((tx): Prepared => {
		const o = tx.select().from(orders).where(eq(orders.code, code)).get();
		if (!o || o.userId !== userId) throw new OrderError('Pesanan tidak ditemukan', 'not_found');
		if (o.status !== 'menunggu_pembayaran') {
			throw new OrderError('Pesanan tidak dalam status menunggu pembayaran');
		}
		const remaining = o.expiresAt ? new Date(o.expiresAt).getTime() - Date.now() : Infinity;
		if (remaining < MIN_REMAINING_MS) {
			throw new OrderError('Batas waktu pembayaran pesanan ini sudah (hampir) habis');
		}

		const rows = tx.select().from(payments).where(eq(payments.orderId, o.id)).all();
		const pending = rows.filter((p) => p.gatewayOrderId && p.status === 'menunggu');

		// Halaman bayar yang masih berlaku untuk metode yang sama dipakai ulang (tidak membuat transaksi baru)
		const same = pending.find((p) => p.method === method && p.redirectUrl);
		if (same?.redirectUrl) return { kind: 'reuse', redirectUrl: same.redirectUrl };

		// Percobaan lain baru saja dibuat dan halaman bayarnya belum jadi (klik ganda / dua tab):
		// jangan ditimpa, sebab transaksinya mungkin sedang dibuat di Midtrans dan jadi yatim.
		const inFlight = pending.find(
			(p) => !p.redirectUrl && Date.now() - new Date(p.createdAt).getTime() < IN_FLIGHT_MS
		);
		if (inFlight) {
			throw new OrderError(
				'Pembayaran online sedang disiapkan. Tunggu beberapa detik lalu muat ulang halaman ini.'
			);
		}

		const replaced: string[] = [];
		for (const p of pending) {
			tx.update(payments)
				.set({ status: 'ditolak', note: PAYMENT_NOTE_GATEWAY_REPLACED })
				.where(eq(payments.id, p.id))
				.run();
			if (p.gatewayOrderId) replaced.push(p.gatewayOrderId);
		}

		const n = rows.filter((p) => p.gatewayOrderId).length + 1;
		const gatewayOrderId = `${o.code}-${n}`;
		const pay = tx
			.insert(payments)
			.values({ orderId: o.id, method, amount: o.total, status: 'menunggu', gatewayOrderId })
			.returning()
			.get();

		const lines = tx.select().from(orderItems).where(eq(orderItems.orderId, o.id)).all();
		const items = lines.map((l) => ({
			name: l.itemName + (l.itemType === 'product' && l.size ? ` (${l.size})` : ''),
			price: l.unitPrice,
			quantity: l.quantity
		}));
		if (o.shippingCost > 0)
			items.push({ name: 'Ongkos kirim', price: o.shippingCost, quantity: 1 });

		const u = tx.select().from(users).where(eq(users.id, userId)).get();
		return {
			kind: 'new',
			paymentId: pay.id,
			gatewayOrderId,
			orderId: o.id,
			orderCode: o.code,
			amount: o.total,
			expiresAt: o.expiresAt,
			expiryMinutes: Number.isFinite(remaining) ? Math.ceil(remaining / 60_000) : 24 * 60,
			items,
			customer: { name: o.recipientName, email: u?.email ?? '', phone: o.recipientPhone },
			replaced
		};
	});

	if (prep.kind === 'reuse') return { redirectUrl: prep.redirectUrl };

	// Percobaan sebelumnya (metode lain) tak boleh tetap bisa dibayar
	await Promise.all(prep.replaced.map(cancelTransaction));

	// 2) Buat transaksi Snap
	let snap: { token: string; redirectUrl: string };
	try {
		snap = await createSnapTransaction({
			gatewayOrderId: prep.gatewayOrderId,
			orderCode: prep.orderCode,
			amount: prep.amount,
			method,
			expiryMinutes: prep.expiryMinutes,
			items: prep.items,
			customer: prep.customer
		});
	} catch (e) {
		console.error('[gateway] gagal membuat transaksi', prep.gatewayOrderId, e);
		if (e instanceof GatewayError && e.ambiguous) {
			// Timeout/jaringan: Midtrans mungkin SUDAH membuat transaksi. Baris dipertahankan (ditolak) supaya
			// nomor order_id tidak dipakai ulang (Midtrans menolak order_id kembar), dan transaksinya dibatalkan.
			await db
				.update(payments)
				.set({ status: 'ditolak', note: PAYMENT_NOTE_GATEWAY_FAILED })
				.where(eq(payments.id, prep.paymentId));
			await cancelTransaction(prep.gatewayOrderId);
		} else {
			// Ditolak jelas oleh Midtrans: tidak ada transaksi, buang baris cadangan agar riwayat tidak berisi percobaan kosong
			await db.delete(payments).where(eq(payments.id, prep.paymentId));
		}
		throw new OrderError(
			e instanceof GatewayError
				? 'Pembayaran online sedang bermasalah. Coba lagi sebentar atau pilih transfer bank.'
				: 'Gagal memulai pembayaran online'
		);
	}

	// 3) Simpan halaman bayar
	await transact((tx) => {
		tx.update(payments)
			.set({ redirectUrl: snap.redirectUrl, expiresAt: prep.expiresAt })
			.where(eq(payments.id, prep.paymentId))
			.run();
		logActivity(
			userId,
			'payment.start',
			'order',
			prep.orderId,
			`Pembayaran online (${PAYMENT_METHODS[method].label}) dimulai untuk pesanan ${prep.orderCode}`,
			tx
		);
	});

	return { redirectUrl: snap.redirectUrl };
}

/* ---------- Terapkan status dari Midtrans ---------- */
export type ApplyResult = 'applied' | 'ignored' | 'unknown';

const channelLabel = (type: string | null | undefined) =>
	(type && GATEWAY_TYPE_LABEL[type]) || type || 'pembayaran online';

/**
 * Menerapkan status transaksi (dari notifikasi yang sudah diverifikasi atau dari Status API).
 * Aman dipanggil berulang dengan status yang sama.
 */
export async function applyGatewayStatus(s: MidtransStatus): Promise<ApplyResult> {
	const toCancel: string[] = [];

	const result = await transact((tx): ApplyResult => {
		const pay = tx.select().from(payments).where(eq(payments.gatewayOrderId, s.order_id)).get();
		if (!pay) return 'unknown';

		// nominal harus persis sama dengan tagihan; selisih = notifikasi janggal, jangan dipercaya
		if (grossToRupiah(s.gross_amount) !== pay.amount) {
			console.error('[gateway] nominal tidak cocok', s.order_id, s.gross_amount, pay.amount);
			return 'ignored';
		}

		const o = tx.select().from(orders).where(eq(orders.id, pay.orderId)).get();
		if (!o) return 'ignored';

		const ch = channelOf(s);
		const detail = {
			gatewayType: ch.type ?? pay.gatewayType,
			paymentCode: ch.code ?? pay.paymentCode,
			gatewayTxId: s.transaction_id ?? pay.gatewayTxId,
			expiresAt: parseExpiry(s.expiry_time) ?? pay.expiresAt
		};
		const now = new Date().toISOString();
		const label = channelLabel(detail.gatewayType);

		switch (classify(s)) {
			case 'paid': {
				if (pay.status === 'dikonfirmasi' || pay.status === 'dikembalikan') {
					tx.update(payments).set(detail).where(eq(payments.id, pay.id)).run();
					return 'ignored';
				}
				const others = tx.select().from(payments).where(eq(payments.orderId, o.id)).all();
				const alreadyPaid = others.some((p) => p.id !== pay.id && p.status === 'dikonfirmasi');

				// Hanya pesanan yang masih menunggu bayar yang boleh dimajukan; selain itu (dibatalkan, atau sudah
				// diproses/dikirim/selesai lewat pembayaran lain) status TIDAK boleh ditimpa → tandai refund.
				const payable = o.status === 'menunggu_pembayaran' || o.status === 'menunggu_konfirmasi';
				if (!payable || alreadyPaid) {
					tx.update(payments)
						.set({
							...detail,
							status: 'dikembalikan',
							note:
								o.status === 'dibatalkan' ? PAYMENT_NOTE_LATE_REFUND : PAYMENT_NOTE_DOUBLE_REFUND
						})
						.where(eq(payments.id, pay.id))
						.run();
					logActivity(
						null,
						'payment.refund_needed',
						'order',
						o.id,
						`Pesanan ${o.code} dibayar lewat ${label} tetapi ${
							o.status === 'dibatalkan' ? 'sudah dibatalkan' : 'sudah lunas lewat jalur lain'
						}: kembalikan dana Rp ${pay.amount.toLocaleString('id-ID')} lewat dashboard Midtrans`,
						tx
					);
					return 'applied';
				}

				tx.update(payments)
					.set({
						...detail,
						status: 'dikonfirmasi',
						confirmedBy: null,
						confirmedAt: now,
						note: null
					})
					.where(eq(payments.id, pay.id))
					.run();
				// bukti transfer / percobaan online lain yang masih menunggu tidak lagi relevan
				for (const p of others) {
					if (p.id === pay.id || p.status !== 'menunggu') continue;
					tx.update(payments)
						.set({ status: 'ditolak', note: `Pesanan sudah dibayar lewat ${label}` })
						.where(eq(payments.id, p.id))
						.run();
					if (p.gatewayOrderId) toCancel.push(p.gatewayOrderId);
				}
				// Lunas otomatis: langsung diproses (melewati menunggu_konfirmasi yang khusus transfer manual)
				tx.update(orders)
					.set({ status: 'diproses', updatedAt: now })
					.where(eq(orders.id, o.id))
					.run();
				logActivity(
					null,
					'payment.confirm',
					'order',
					o.id,
					`Pembayaran pesanan ${o.code} lunas otomatis lewat ${label}`,
					tx
				);
				return 'applied';
			}

			case 'failed': {
				tx.update(payments)
					.set({
						...detail,
						...(pay.status === 'menunggu'
							? {
									status: 'ditolak' as const,
									note:
										s.transaction_status === 'expire'
											? PAYMENT_NOTE_GATEWAY_EXPIRED
											: PAYMENT_NOTE_GATEWAY_FAILED
								}
							: {})
					})
					.where(eq(payments.id, pay.id))
					.run();
				return pay.status === 'menunggu' ? 'applied' : 'ignored';
			}

			case 'refunded': {
				if (pay.status !== 'dikonfirmasi') {
					tx.update(payments).set(detail).where(eq(payments.id, pay.id)).run();
					return 'ignored';
				}
				tx.update(payments)
					.set({ ...detail, status: 'dikembalikan', note: 'Dana dikembalikan lewat Midtrans' })
					.where(eq(payments.id, pay.id))
					.run();
				logActivity(
					null,
					'payment.refund',
					'order',
					o.id,
					`Pembayaran pesanan ${o.code} dikembalikan lewat Midtrans`,
					tx
				);
				return 'applied';
			}

			case 'partial_refund': {
				// Refund/chargeback sebagian: status pembayaran & pesanan tidak diubah, cukup tandai agar admin meninjau
				if (pay.status !== 'dikonfirmasi' || pay.note === PAYMENT_NOTE_PARTIAL_REFUND) {
					tx.update(payments).set(detail).where(eq(payments.id, pay.id)).run();
					return 'ignored';
				}
				tx.update(payments)
					.set({ ...detail, note: PAYMENT_NOTE_PARTIAL_REFUND })
					.where(eq(payments.id, pay.id))
					.run();
				logActivity(
					null,
					'payment.partial_refund',
					'order',
					o.id,
					`Pesanan ${o.code}: Midtrans mencatat refund/chargeback SEBAGIAN. Tinjau di dashboard Midtrans dan sesuaikan pesanan bila perlu`,
					tx
				);
				return 'applied';
			}

			default: {
				// pending: simpan nomor VA / kode bayar agar bisa ditampilkan ke pelanggan
				tx.update(payments).set(detail).where(eq(payments.id, pay.id)).run();
				return 'applied';
			}
		}
	});

	await Promise.all(toCancel.map(cancelTransaction));
	return result;
}

/* ---------- Sinkronisasi (cadangan bila notifikasi terlambat/tidak sampai) ---------- */
/** synced = status diterapkan · missing = Midtrans tidak mengenal transaksi (tak ada yang disinkronkan) · error = gagal dicek */
async function syncOne(
	gatewayOrderId: string,
	timeoutMs?: number
): Promise<'synced' | 'missing' | 'error'> {
	try {
		const st = await getTransactionStatus(gatewayOrderId, timeoutMs);
		if (!st) return 'missing';
		await applyGatewayStatus(st);
		return 'synced';
	} catch (e) {
		console.warn('[gateway] sinkron gagal', gatewayOrderId, (e as Error).message);
		return 'error';
	}
}

const pendingGateway = (orderId: number) =>
	db
		.select()
		.from(payments)
		.where(
			and(
				eq(payments.orderId, orderId),
				eq(payments.status, 'menunggu'),
				isNotNull(payments.gatewayOrderId)
			)
		);

/** Waktu sinkron terakhir per pesanan (untuk throttle halaman yang sering di-refresh). */
const lastSync = new Map<number, number>();

/**
 * Cek ke Midtrans semua transaksi online yang masih menunggu untuk satu pesanan.
 * Mengembalikan false bila ada transaksi yang statusnya GAGAL dipastikan (timeout/5xx):
 * pemanggil yang hendak membatalkan pesanan harus menunda, sebab transaksi itu mungkin sudah lunas.
 */
export async function syncPendingForOrder(
	orderId: number,
	timeoutMs = 4_000,
	/** >0: lewati bila pesanan ini sudah dicek dalam rentang tersebut (mis. halaman yang sering di-refresh) */
	throttleMs = 0
): Promise<boolean> {
	if (!isGatewayConfigured()) return true;
	if (throttleMs > 0) {
		const last = lastSync.get(orderId) ?? 0;
		if (Date.now() - last < throttleMs) return true;
		lastSync.set(orderId, Date.now());
		if (lastSync.size > 5_000) lastSync.clear(); // jaga memori tetap kecil
	}
	let allKnown = true;
	for (const p of await pendingGateway(orderId)) {
		if (p.gatewayOrderId && (await syncOne(p.gatewayOrderId, timeoutMs)) === 'error')
			allKnown = false;
	}
	return allKnown;
}

/** Untuk cron: periksa transaksi online yang masih menunggu pada pesanan yang belum dibayar. */
export async function reconcileGatewayPayments(limit = 50): Promise<number> {
	if (!isGatewayConfigured()) return 0;
	const rows = await db
		.select({ gatewayOrderId: payments.gatewayOrderId })
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.where(
			and(
				eq(payments.status, 'menunggu'),
				isNotNull(payments.gatewayOrderId),
				eq(orders.status, 'menunggu_pembayaran')
			)
		)
		.limit(limit);
	let n = 0;
	for (const r of rows) if (r.gatewayOrderId && (await syncOne(r.gatewayOrderId)) === 'synced') n++;
	return n;
}
