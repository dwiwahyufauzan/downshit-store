import { db, type Tx } from './db';
import { settings } from './db/schema';

export type StoreSettings = {
	storeName: string;
	whatsapp: string;
	shippingCost: number;
	bankName: string;
	bankNumber: string;
	bankHolder: string;
	lowStock: number;
	paymentDeadlineHours: number;
	maxUnpaidOrders: number;
	autoCompleteDays: number;
};

/** Peta field form → kunci tabel `settings` (plan/06 §1). */
export const SETTING_KEYS = {
	storeName: 'store_name',
	whatsapp: 'store_whatsapp',
	shippingCost: 'shipping_flat_cost',
	bankName: 'bank_name',
	bankNumber: 'bank_account_number',
	bankHolder: 'bank_account_holder',
	lowStock: 'low_stock_threshold',
	paymentDeadlineHours: 'payment_deadline_hours',
	maxUnpaidOrders: 'max_unpaid_orders',
	autoCompleteDays: 'auto_complete_days'
} as const satisfies Record<keyof StoreSettings, string>;

/** Angka dari kolom teks; nilai rusak/kosong jatuh ke default (bukan NaN yang merusak hitungan). */
const num = (v: string | undefined, fallback: number) => {
	const n = v === undefined || v.trim() === '' ? NaN : Number(v);
	return Number.isFinite(n) ? n : fallback;
};

export async function getSettings(): Promise<StoreSettings> {
	const rows = await db.select().from(settings);
	const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

	return {
		storeName: map.store_name ?? 'Downshit Store',
		whatsapp: map.store_whatsapp ?? '6281234567890',
		shippingCost: num(map.shipping_flat_cost, 15000),
		bankName: map.bank_name ?? 'BCA',
		bankNumber: map.bank_account_number ?? '1234567890',
		bankHolder: map.bank_account_holder ?? 'Store Downshit',
		lowStock: num(map.low_stock_threshold, 5),
		paymentDeadlineHours: num(map.payment_deadline_hours, 24),
		maxUnpaidOrders: num(map.max_unpaid_orders, 3),
		autoCompleteDays: num(map.auto_complete_days, 7)
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
