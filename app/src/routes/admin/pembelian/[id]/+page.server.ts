import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { products, purchaseItems, purchases, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { idParam } from '#lib/server/sql';
import { PurchaseRuleError, cancelPurchase, receivePurchase } from '#lib/server/purchase';

export const load = async ({ params, locals }) => {
	requireRole(locals, 'admin');
	const id = idParam(params.id);
	if (!id) throw error(404, 'Pembelian tidak ditemukan');

	const [p] = await db
		.select({
			id: purchases.id,
			code: purchases.code,
			supplierName: purchases.supplierName,
			purchaseDate: purchases.purchaseDate,
			totalCost: purchases.totalCost,
			note: purchases.note,
			status: purchases.status,
			receivedAt: purchases.receivedAt,
			cancelledAt: purchases.cancelledAt,
			cancelNote: purchases.cancelNote,
			createdAt: purchases.createdAt,
			adminName: users.name
		})
		.from(purchases)
		.leftJoin(users, eq(users.id, purchases.createdBy))
		.where(eq(purchases.id, id))
		.limit(1);

	if (!p) throw error(404, 'Data pembelian tidak ditemukan');

	const items = await db
		.select({
			id: purchaseItems.id,
			productId: purchaseItems.productId,
			productName: products.name,
			size: purchaseItems.size,
			quantity: purchaseItems.quantity,
			unitCost: purchaseItems.unitCost
		})
		.from(purchaseItems)
		.innerJoin(products, eq(products.id, purchaseItems.productId))
		.where(eq(purchaseItems.purchaseId, id));

	return {
		purchase: p,
		items
	};
};

export const actions = {
	receive: async ({ params, locals }) => {
		const admin = requireRole(locals, 'admin');
		const id = idParam(params.id);
		if (!id) throw error(404, 'Pembelian tidak ditemukan');
		try {
			await receivePurchase(admin.id, id);
		} catch (e) {
			if (e instanceof PurchaseRuleError) return fail(400, { message: e.message });
			throw e;
		}
		throw redirect(303, `/admin/pembelian/${id}?diterima=1`);
	},

	cancel: async ({ params, request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const id = idParam(params.id);
		if (!id) throw error(404, 'Pembelian tidak ditemukan');
		const reason = (await request.formData()).get('reason')?.toString().trim().slice(0, 255);
		try {
			await cancelPurchase(admin.id, id, reason);
		} catch (e) {
			if (e instanceof PurchaseRuleError) return fail(400, { message: e.message });
			throw e;
		}
		throw redirect(303, `/admin/pembelian/${id}?dibatalkan=1`);
	}
};
