import { fail } from '@sveltejs/kit';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { orders, products, reviews, users } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { escapeLike, idParam, pageParam } from '$lib/server/sql';
import { logActivity } from '$lib/server/activity';
import type { Actions, PageServerLoad } from './$types';

const PER_PAGE = 15;

export const load: PageServerLoad = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const ratingRaw = Number(url.searchParams.get('rating'));
	const rating = Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : 0;
	const tampil = url.searchParams.get('tampil');
	const visible = tampil === '1' ? true : tampil === '0' ? false : null;

	const where = and(
		rating ? eq(reviews.rating, rating) : undefined,
		visible === null ? undefined : eq(reviews.isVisible, visible),
		q
			? or(
					like(products.name, `%${escapeLike(q)}%`),
					like(reviews.comment, `%${escapeLike(q)}%`),
					like(users.name, `%${escapeLike(q)}%`)
				)
			: undefined
	);

	const base = db
		.select({ n: count() })
		.from(reviews)
		.innerJoin(products, eq(products.id, reviews.productId))
		.innerJoin(users, eq(users.id, reviews.userId))
		.where(where);
	const [{ n: totalItems }] = await base;
	const totalPages = Math.ceil(totalItems / PER_PAGE);
	const page = Math.min(pageParam(url), Math.max(1, totalPages));

	const rows = await db
		.select({
			id: reviews.id,
			rating: reviews.rating,
			comment: reviews.comment,
			isVisible: reviews.isVisible,
			createdAt: reviews.createdAt,
			productName: products.name,
			productSlug: products.slug,
			userName: users.name,
			orderCode: orders.code
		})
		.from(reviews)
		.innerJoin(products, eq(products.id, reviews.productId))
		.innerJoin(users, eq(users.id, reviews.userId))
		.innerJoin(orders, eq(orders.id, reviews.orderId))
		.where(where)
		.orderBy(desc(reviews.createdAt), desc(reviews.id))
		.limit(PER_PAGE)
		.offset((page - 1) * PER_PAGE);

	const [{ total }] = await db.select({ total: count() }).from(reviews);
	const [{ hidden }] = await db
		.select({ hidden: count() })
		.from(reviews)
		.where(eq(reviews.isVisible, false));

	return {
		reviews: rows,
		totalAll: total,
		hiddenCount: hidden,
		filters: { q, rating, tampil: visible === null ? '' : tampil },
		pagination: { page, perPage: PER_PAGE, totalItems, totalPages }
	};
};

export const actions: Actions = {
	// Sembunyikan / tampilkan ulasan (moderasi); ulasan tersembunyi tidak dihitung di rating produk
	toggle: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		const visible = fd.get('visible') === '1';
		if (!id) return fail(400, { message: 'ID ulasan tidak valid.' });

		const row = db
			.select({ id: reviews.id, productId: reviews.productId, productName: products.name })
			.from(reviews)
			.innerJoin(products, eq(products.id, reviews.productId))
			.where(eq(reviews.id, id))
			.get();
		if (!row) return fail(404, { message: 'Ulasan tidak ditemukan.' });

		db.update(reviews).set({ isVisible: visible }).where(eq(reviews.id, id)).run();
		logActivity(
			admin.id,
			'review.moderate',
			'product',
			row.productId,
			`Ulasan #${id} untuk ${row.productName} ${visible ? 'ditampilkan' : 'disembunyikan'}`
		);
		return { success: true, message: visible ? 'Ulasan ditampilkan.' : 'Ulasan disembunyikan.' };
	}
};
