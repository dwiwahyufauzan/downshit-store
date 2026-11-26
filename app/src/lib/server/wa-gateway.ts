import { envVar } from './config';
import { waDigits } from '#lib/utils/whatsapp';

type Transport = (to: string, text: string) => Promise<void>;

/** Hook tes: gantikan pengiriman nyata (null = kembali ke konfigurasi env). */
let override: Transport | null = null;
export function setWaTransport(t: Transport | null) {
	override = t;
}

const provider = () => envVar('WA_PROVIDER');

/** WhatsApp otomatis aktif bila ada penyedia terkonfigurasi (atau transport tes). */
export function waEnabled(): boolean {
	return override !== null || Boolean(provider());
}

const providers: Record<string, Transport> = {
	log: async (to, text) => {
		console.log(`[wa:log] to=${to}\n${text}`);
	},
	// Fonnte (https://fonnte.com): perangkat WhatsApp toko disambungkan via QR, token per perangkat
	fonnte: async (to, text) => {
		const res = await fetch('https://api.fonnte.com/send', {
			method: 'POST',
			headers: { authorization: envVar('WA_API_TOKEN') ?? '' },
			body: new URLSearchParams({ target: to, message: text, countryCode: '62' }),
			signal: AbortSignal.timeout(10_000)
		});
		const body = (await res.json().catch(() => ({}))) as { status?: boolean; reason?: string };
		if (!res.ok || body.status === false) {
			throw new Error(`fonnte ${res.status} ${body.reason ?? ''}`.trim());
		}
	}
};

/**
 * Kirim pesan WhatsApp ke nomor Indonesia (08xx / +62xx / 62xx). TIDAK pernah melempar: kegagalan hanya
 * dicatat (notifikasi tidak boleh menggagalkan transaksi). true bila diserahkan ke penyedia.
 */
export async function sendWhatsApp(
	rawTo: string | null | undefined,
	text: string
): Promise<boolean> {
	const to = waDigits(rawTo);
	if (!to) return false;
	const name = provider();
	const transport = override ?? (name ? providers[name] : undefined);
	if (!transport) return false;
	try {
		await transport(to, text);
		return true;
	} catch (e) {
		console.error('[wa] gagal mengirim ke', to, e instanceof Error ? e.message : e);
		return false;
	}
}
