import { fail } from '@sveltejs/kit';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, transact } from '$lib/server/db';
import { dbErrno } from '$lib/server/db/retry';
import { categories, products } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/guards';
import { categorySchema } from '$lib/schemas/category';
import { slugify } from '$lib/utils/slug';
import { uniqueSlug } from '$lib/server/slug';
import { logActivity } from '$lib/server/activity';
import { idParam } from '$lib/server/sql';

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');

	// Jumlah produk = produk aktif + nonaktif yang belum dihapus (yang terlihat di daftar produk)
	const rows = await db
		.select({
			id: categories.id,
			name: categories.name,
			slug: categories.slug,
			description: categories.description,
			productCount: count(products.id)
		})
		.from(categories)
		.leftJoin(products, and(eq(products.categoryId, categories.id), isNull(products.deletedAt)))
		.groupBy(categories.id)
		.orderBy(categories.name);

	return { categories: rows };
};

const NAME_TAKEN = 'Nama kategori sudah dipakai. Gunakan nama lain.';
type CategoryErrors = { name?: string[]; description?: string[] };

export const actions = {
	create: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const raw = { name: fd.get('name'), description: fd.get('description') || undefined };

		const parsed = categorySchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				action: 'create',
				errors: parsed.error.flatten().fieldErrors as CategoryErrors,
				values: raw
			});
		}
		const d = parsed.data;

		// Nama kategori unik (tanpa membedakan huruf besar/kecil)
		const dup = db
			.select({ id: categories.id })
			.from(categories)
			.where(sql`lower(${categories.name}) = lower(${d.name})`)
			.get();
		if (dup)
			return fail(400, {
				action: 'create',
				errors: { name: [NAME_TAKEN] } as CategoryErrors,
				values: raw
			});

		for (let attempt = 0; ; attempt++) {
			const slug = await uniqueSlug(categories, categories.slug, slugify(d.name));
			try {
				await transact((tx) => {
					const res = tx
						.insert(categories)
						.values({ name: d.name, slug, description: d.description ?? null })
						.returning({ id: categories.id })
						.get();
					logActivity(
						admin.id,
						'category.create',
						'category',
						res.id,
						`Kategori dibuat: ${d.name}`,
						tx
					);
				});
				break;
			} catch (e) {
				// slug bentrok karena dua admin menyimpan bersamaan → coba slug berikutnya
				if (dbErrno(e) === 1062 && attempt < 2) continue;
				if (dbErrno(e) === 1062)
					return fail(400, {
						action: 'create',
						errors: { name: [NAME_TAKEN] } as CategoryErrors,
						values: raw
					});
				throw e;
			}
		}

		return { success: true, message: `Kategori "${d.name}" ditambahkan.` };
	},

	update: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		if (!id) return fail(400, { message: 'ID kategori tidak valid' });

		const raw = { name: fd.get('name'), description: fd.get('description') || undefined };
		const parsed = categorySchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				action: 'update',
				id,
				errors: parsed.error.flatten().fieldErrors as CategoryErrors,
				values: raw
			});
		}
		const d = parsed.data;

		const cur = db
			.select({ id: categories.id })
			.from(categories)
			.where(eq(categories.id, id))
			.get();
		if (!cur) return fail(404, { message: 'Kategori tidak ditemukan (mungkin sudah dihapus).' });

		const dup = db
			.select({ id: categories.id })
			.from(categories)
			.where(and(sql`lower(${categories.name}) = lower(${d.name})`, ne(categories.id, id)))
			.get();
		if (dup) {
			return fail(400, {
				action: 'update',
				id,
				errors: { name: [NAME_TAKEN] } as CategoryErrors,
				values: raw
			});
		}

		// Slug tidak berubah saat nama diganti (URL/filter stabil)
		await transact((tx) => {
			tx.update(categories)
				.set({ name: d.name, description: d.description ?? null })
				.where(eq(categories.id, id))
				.run();
			logActivity(admin.id, 'category.update', 'category', id, `Kategori diubah: ${d.name}`, tx);
		});

		return { success: true, message: `Kategori "${d.name}" diperbarui.` };
	},

	delete: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		if (!id) return fail(400, { message: 'ID kategori tidak valid' });

		const result = await transact((tx) => {
			const cat = tx.select().from(categories).where(eq(categories.id, id)).get();
			if (!cat)
				return {
					ok: false as const,
					error: 'Kategori tidak ditemukan (mungkin sudah dihapus).',
					status: 404
				};

			const usage = tx
				.select({ n: count() })
				.from(products)
				.where(and(eq(products.categoryId, id), isNull(products.deletedAt)))
				.get();
			const n = usage?.n ?? 0;
			if (n > 0) {
				return {
					ok: false as const,
					error: `Kategori "${cat.name}" masih dipakai ${n} produk. Pindahkan produknya dulu.`,
					status: 400
				};
			}

			tx.delete(categories).where(eq(categories.id, id)).run();
			logActivity(admin.id, 'category.delete', 'category', id, `Kategori dihapus: ${cat.name}`, tx);
			return { ok: true as const, name: cat.name };
		});

		if (!result.ok) return fail(result.status, { message: result.error });
		return { success: true, message: `Kategori "${result.name}" dihapus.` };
	}
};
