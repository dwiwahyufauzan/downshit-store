import { db, type Tx } from './db';
import { settings } from './db/schema';
import type { PaymentMethod } from '#lib/constants';

export type StoreSettings = {
	storeName: string;
	whatsapp: string;
	shippingCost: number;
	/** Kode pos gudang/toko asal pengiriman (kosong = ongkir flat saja) */
	shippingOriginPostal: string;
	/** Kode kurir yang ditawarkan, dipisah koma (mis. "jne,jnt,sicepat") */
	shippingCouriers: string;
	bankName: string;
	bankNumber: string;
	bankHolder: string;
	lowStock: number;
	paymentDeadlineHours: number;
	maxUnpaidOrders: number;
	autoCompleteDays: number;
	/** Metode pembayaran yang ditawarkan ke pelanggan (online hanya tampil bila Midtrans terkonfigurasi) */
	payTransfer: boolean;
	payEwallet: boolean;
	payQris: boolean;
	payVa: boolean;
	payMinimarket: boolean;
};

/** Metode pembayaran → field toggle di StoreSettings */
export const PAY_FIELD = {
	transfer_bank: 'payTransfer',
	ewallet: 'payEwallet',
	qris: 'payQris',
	va: 'payVa',
	minimarket: 'payMinimarket'
} as const satisfies Record<PaymentMethod, keyof StoreSettings>;

/** Peta field form → kunci tabel `settings` (plan/06 §1). */
export const SETTING_KEYS = {
	storeName: 'store_name',
	whatsapp: 'store_whatsapp',
	shippingCost: 'shipping_flat_cost',
	shippingOriginPostal: 'shipping_origin_postal',
	shippingCouriers: 'shipping_couriers',
	bankName: 'bank_name',
	bankNumber: 'bank_account_number',
	bankHolder: 'bank_account_holder',
	lowStock: 'low_stock_threshold',
	paymentDeadlineHours: 'payment_deadline_hours',
	maxUnpaidOrders: 'max_unpaid_orders',
	autoCompleteDays: 'auto_complete_days',
	payTransfer: 'pay_transfer_enabled',
	payEwallet: 'pay_ewallet_enabled',
	payQris: 'pay_qris_enabled',
	payVa: 'pay_va_enabled',
	payMinimarket: 'pay_minimarket_enabled'
} as const satisfies Record<keyof StoreSettings, string>;

/** Angka dari kolom teks; nilai rusak/kosong jatuh ke default (bukan NaN yang merusak hitungan). */
const num = (v: string | undefined, fallback: number) => {
	const n = v === undefined || v.trim() === '' ? NaN : Number(v);
	return Number.isFinite(n) ? n : fallback;
};

/** Saklar "true"/"false"; nilai kosong/rusak jatuh ke default. */
const flag = (v: string | undefined, fallback: boolean) =>
	v === 'true' ? true : v === 'false' ? false : fallback;

export async function getSettings(): Promise<StoreSettings> {
	const rows = await db.select().from(settings);
	const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

	return {
		storeName: map.store_name ?? 'Downshit Store',
		whatsapp: map.store_whatsapp ?? '6283867358863',
		shippingCost: num(map.shipping_flat_cost, 15000),
		shippingOriginPostal: map.shipping_origin_postal ?? '',
		shippingCouriers: map.shipping_couriers ?? 'jne,jnt,sicepat,anteraja',
		bankName: map.bank_name ?? 'BCA',
		bankNumber: map.bank_account_number ?? '1234567890',
		bankHolder: map.bank_account_holder ?? 'Store Downshit',
		lowStock: num(map.low_stock_threshold, 5),
		paymentDeadlineHours: num(map.payment_deadline_hours, 24),
		maxUnpaidOrders: num(map.max_unpaid_orders, 3),
		autoCompleteDays: num(map.auto_complete_days, 7),
		// transfer manual menyala sejak awal; metode online baru muncul setelah admin mengaktifkannya
		payTransfer: flag(map.pay_transfer_enabled, true),
		payEwallet: flag(map.pay_ewallet_enabled, false),
		payQris: flag(map.pay_qris_enabled, false),
		payVa: flag(map.pay_va_enabled, false),
		payMinimarket: flag(map.pay_minimarket_enabled, false)
	};
}

export async function setSetting(key: string, value: string) {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, updatedAt: new Date().toISOString() }
		});
}

/** Simpan SEMUA pengaturan sekaligus dalam satu transaksi (semua atau tidak sama sekali). */
export function setSettings(tx: Tx, v: StoreSettings): void {
	for (const [field, key] of Object.entries(SETTING_KEYS)) {
		const value = String(v[field as keyof StoreSettings]);
		tx.insert(settings)
			.values({ key, value })
			.onConflictDoUpdate({
				target: settings.key,
				set: { value, updatedAt: new Date().toISOString() }
			})
			.run();
	}
}
