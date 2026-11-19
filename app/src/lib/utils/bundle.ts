/** min(kuota paket, min_i(floor(stok_komponen_i / qty_i))) — tidak pernah negatif */
export const effectiveBundleStock = (
	bundleStock: number,
	comps: { stock: number; qty: number }[]
): number => {
	if (comps.length === 0) return 0;
	return Math.max(0, Math.min(bundleStock, ...comps.map((c) => Math.floor(c.stock / c.qty))));
};
