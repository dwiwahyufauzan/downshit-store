/**
 * Navigasi yang "lambat": tujuan halaman yang belum selesai dimuat setelah SLOW_NAV_MS.
 * Diisi oleh +layout.svelte (hanya di browser), dibaca halaman untuk menampilkan kerangka (skeleton).
 * Navigasi cepat tidak memicu apa pun, jadi tidak ada kedipan.
 */
export const SLOW_NAV_MS = 200;

export const nav: { slowTo: string | null } = $state({ slowTo: null });

/** Route id halaman detail yang diganti kerangka penuh selama dimuat. */
export const DETAIL_ROUTES = ['/produk/[slug]', '/bundling/[slug]'] as const;
