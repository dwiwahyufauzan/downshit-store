/**
 * Status banner promo di atas navbar beranda. Penutupan hanya diingat di memori selama pengguna masih
 * berada di aplikasi (berpindah halaman tidak memunculkannya lagi); memuat ulang halaman menampilkannya
 * kembali. Yang disimpan adalah "tanda tangan" daftar kode voucher, jadi promo baru selalu tampil.
 */
export const promoBar: { closedSig: string | null } = $state({ closedSig: null });

export const promoSignature = (codes: string[]) => codes.join('|');

export const closePromoBar = (sig: string) => {
	promoBar.closedSig = sig;
};
