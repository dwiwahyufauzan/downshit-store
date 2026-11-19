import type { SubmitFunction } from '$app/forms';
import { toast } from '#lib/stores/toast.svelte';

/**
 * `use:enhance` untuk form yang tetap di halaman yang sama (mis. tambah ke keranjang):
 * - `setBusy` dipanggil true selama permintaan berjalan (untuk menonaktifkan tombol / mengganti label)
 * - input TIDAK direset (jumlah & ukuran terpilih tetap, karena terikat ke state halaman)
 * - hasil gagal juga dimunculkan sebagai toast, sebab pesan inline di bagian atas halaman bisa
 *   berada di luar layar tanpa muat ulang halaman
 * Hasil sukses ditampilkan toast oleh +layout.svelte (dari `form.message`).
 */
export function enhanceInPlace(setBusy: (busy: boolean) => void): SubmitFunction {
	return () => {
		setBusy(true);
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
			} finally {
				setBusy(false);
			}
			if (result.type === 'failure') {
				const message = (result.data as { message?: unknown } | undefined)?.message;
				if (typeof message === 'string' && message) toast.error(message);
			}
		};
	};
}
