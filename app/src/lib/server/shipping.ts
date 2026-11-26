/**
 * Ongkos kirim: tarif kurir sungguhan (Biteship) per kode pos tujuan & berat, dengan cadangan ongkir flat.
 * Harga SELALU dihitung ulang di server saat checkout (pilihan dari klien hanya berupa id layanan).
 */
import { envVar } from './config';
import type { StoreSettings } from './settings';

export type ShippingOption = {
	/** "jne:reg" atau "flat" */
	id: string;
	label: string;
	price: number;
	etd: string | null;
};

export type ShippingQuote = {
	options: ShippingOption[];
	/** api = tarif kurir · flat = ongkir flat pengaturan toko (API nonaktif / gagal) */
	source: 'api' | 'flat';
};

const BASE_URL = 'https://api.biteship.com';

export const shippingApiConfigured = () => Boolean(envVar('BITESHIP_API_KEY'));

/** Tarif kurir aktif hanya bila API key terpasang DAN kode pos asal toko diisi. */
export const shippingApiEnabled = (cfg: Pick<StoreSettings, 'shippingOriginPostal'>) =>
	shippingApiConfigured() && /^[0-9]{5}$/.test(cfg.shippingOriginPostal);

export const flatOption = (cfg: Pick<StoreSettings, 'shippingCost'>): ShippingOption => ({
	id: 'flat',
	label: 'Ongkos kirim standar',
	price: cfg.shippingCost,
	etd: null
});

type BiteshipPricing = {
	courier_code?: string;
	company?: string;
	courier_name?: string;
	courier_service_code?: string;
	courier_service_name?: string;
	duration?: string;
	shipment_duration_range?: string;
	shipment_duration_unit?: string;
	price?: number;
};

/** "2 - 3" + "days" → "2-3 hari" */
function etdOf(p: BiteshipPricing): string | null {
	const range = p.shipment_duration_range?.replace(/\s+/g, '');
	if (range) {
		const unit = p.shipment_duration_unit === 'hours' ? 'jam' : 'hari';
		return `${range} ${unit}`;
	}
	return (
		p.duration
			?.replace(/days?/i, 'hari')
			.replace(/\s*-\s*/g, '-')
			.replace(/\s+/g, ' ')
			.trim() || null
	);
}

// Tarif yang sama diminta berulang saat pelanggan memilih/mengganti alamat: simpan singkat di memori.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; options: ShippingOption[] }>();

async function fetchRates(
	cfg: Pick<StoreSettings, 'shippingOriginPostal' | 'shippingCouriers'>,
	destPostal: string,
	weightGrams: number,
	value: number
): Promise<ShippingOption[]> {
	const key = `${cfg.shippingOriginPostal}|${destPostal}|${weightGrams}|${cfg.shippingCouriers}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.options;

	const res = await fetch(`${envVar('BITESHIP_BASE_URL') ?? BASE_URL}/v1/rates/couriers`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: envVar('BITESHIP_API_KEY') ?? ''
		},
		body: JSON.stringify({
			origin_postal_code: Number(cfg.shippingOriginPostal),
			destination_postal_code: Number(destPostal),
			couriers: cfg.shippingCouriers,
			items: [{ name: 'Pesanan', value, weight: weightGrams, quantity: 1 }]
		}),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Biteship ${res.status} ${(await res.text()).slice(0, 200)}`);

	const body = (await res.json()) as { pricing?: BiteshipPricing[] };
	const options = (body.pricing ?? [])
		.filter((p) => typeof p.price === 'number' && p.price >= 0)
		.map((p): ShippingOption => {
			const courier = (p.courier_code ?? p.company ?? '').toLowerCase();
			const service = (p.courier_service_code ?? '').toLowerCase();
			return {
				id: `${courier}:${service}`,
				label:
					`${p.courier_name ?? courier.toUpperCase()} ${p.courier_service_name ?? service}`.trim(),
				price: Math.round(p.price!),
				etd: etdOf(p)
			};
		})
		.filter((o) => o.id.length > 1)
		.sort((a, b) => a.price - b.price);

	cache.set(key, { at: Date.now(), options });
	return options;
}

/**
 * Pilihan layanan kirim untuk tujuan & berat tertentu. Tidak pernah melempar: bila API nonaktif,
 * gagal, atau tidak ada kurir yang melayani tujuan itu, hasilnya ongkir flat (checkout tidak buntu).
 */
export async function getShippingOptions(
	cfg: StoreSettings,
	input: { postalCode: string; weightGrams: number; value: number }
): Promise<ShippingQuote> {
	const flat = { options: [flatOption(cfg)], source: 'flat' as const };
	if (!shippingApiEnabled(cfg) || !/^[0-9]{5}$/.test(input.postalCode)) return flat;

	try {
		const options = await fetchRates(
			cfg,
			input.postalCode,
			Math.max(1, Math.round(input.weightGrams)),
			input.value
		);
		return options.length > 0 ? { options, source: 'api' } : flat;
	} catch (e) {
		console.error(
			'[shipping] gagal mengambil tarif, memakai ongkir flat:',
			e instanceof Error ? e.message : e
		);
		return flat;
	}
}

/** Hanya untuk tes. */
export function clearShippingCache() {
	cache.clear();
}
