import { fail, redirect } from '@sveltejs/kit';
import { isNull } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { products } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { purchaseSchema } from '#lib/schemas/purchase';
import { PurchaseRuleError, createPurchase } from '#lib/server/purchase';
import { todayWib } from '#lib/server/time';
import { getSizesFor } from '#lib/server/sizes';

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');

	// Semua produk yang belum dihapus dapat di-restock
	const allProducts = await db
		.select({
			id: products.id,
			name: products.name,
			price: products.price,
			stock: products.stock
		})
		.from(products)
		.where(isNull(products.deletedAt))
		.orderBy(products.name);

	// Produk ber-ukuran: baris pembelian wajib memilih ukuran (stok ditambahkan per ukuran)
	const sizesOf = getSizesFor(
		db,
		allProducts.map((p) => p.id)
	);

	return {
		products: allProducts.map((p) => ({ ...p, sizes: sizesOf.get(p.id) ?? [] })),
		today: todayWib()
	};
};

export const actions = {
	default: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();

		let rawItems: unknown = [];
		try {
			const itemsJson = fd.get('items')?.toString();
			if (itemsJson) rawItems = JSON.parse(itemsJson);
		} catch {
			return fail(400, { message: 'Format data item pembelian tidak valid' });
		}

		const raw = {
			supplierName: fd.get('supplierName') || undefined,
			purchaseDate: fd.get('purchaseDate'),
			note: fd.get('note') || undefined,
			status: fd.get('status') || undefined,
			items: rawItems
		};

		const parsed = purchaseSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors,
				values: raw
			});
		}

		let created: { id: number; code: string };
		try {
			created = await createPurchase(admin.id, parsed.data);
		} catch (e) {
			if (e instanceof PurchaseRuleError) return fail(400, { message: e.message, values: raw });
			throw e;
		}

		throw redirect(303, `/admin/pembelian/${created.id}?baru=1`);
	}
};
