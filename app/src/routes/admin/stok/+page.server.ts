import { fail } from '@sveltejs/kit';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db, transact } from '#lib/server/db';
import { bundles, products, stockMovements, users } from '#lib/server/db/schema';
import { requireRole } from '#lib/server/guards';
import { getStockOverview } from '#lib/server/stock-overview';
import { adjustSchema } from '#lib/schemas/stock';
import { setBundleStock, setProductStock } from '#lib/server/stock';
import { getSizes } from '#lib/server/sizes';
import { logActivity } from '#lib/server/activity';
import { pageParam } from '#lib/server/sql';

const MOVEMENTS_PER_PAGE = 20;

/** Pilihan ukuran tidak valid (kosong/tak dikenal) → pesan aman ke admin. */
class SizeInputError extends Error {}

const MOVEMENT_TYPES = ['pembelian', 'penjualan', 'pembatalan', 'penyesuaian'] as const;

export const load = async ({ url, locals }) => {
	requireRole(locals, 'admin');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const lowOnly = url.searchParams.get('low') === 'true';

	// Filter riwayat mutasi: item (p:ID produk / b:ID bundling) dan tipe
	const itemRaw = url.searchParams.get('item') ?? '';
	const itemMatch = /^([pb]):(\d{1,9})$/.exec(itemRaw);
	const typeRaw = url.searchParams.get('type') ?? '';
	const type = (MOVEMENT_TYPES as readonly string[]).includes(typeRaw)
		? (typeRaw as (typeof MOVEMENT_TYPES)[number])
		: null;

	const overview = await getStockOverview({ q: q || undefined, lowOnly });

	const where = and(
		itemMatch
			? itemMatch[1] === 'p'
				? eq(stockMovements.productId, Number(itemMatch[2]))
				: eq(stockMovements.bundleId, Number(itemMatch[2]))
			: undefined,
		type ? eq(stockMovements.type, type) : undefined
	);

	const [totalRow] = await db.select({ n: count() }).from(stockMovements).where(where);
	const totalMovements = totalRow?.n ?? 0;
	const totalPages = Math.ceil(totalMovements / MOVEMENTS_PER_PAGE);
	const page = Math.min(pageParam(url), Math.max(1, totalPages));

	const movements = await db
		.select({
			id: stockMovements.id,
			productId: stockMovements.productId,
			bundleId: stockMovements.bundleId,
			type: stockMovements.type,
			size: stockMovements.size,
			quantityChange: stockMovements.quantityChange,
			stockAfter: stockMovements.stockAfter,
			referenceType: stockMovements.referenceType,
			referenceId: stockMovements.referenceId,
			note: stockMovements.note,
			createdAt: stockMovements.createdAt,
			adminName: users.name,
			productName: products.name,
			bundleName: bundles.name
		})
		.from(stockMovements)
		.leftJoin(users, eq(users.id, stockMovements.createdBy))
		.leftJoin(products, eq(products.id, stockMovements.productId))
		.leftJoin(bundles, eq(bundles.id, stockMovements.bundleId))
		.where(where)
		.orderBy(desc(stockMovements.id))
		.limit(MOVEMENTS_PER_PAGE)
		.offset((page - 1) * MOVEMENTS_PER_PAGE);

	// Pilihan untuk filter item (produk + bundling yang belum dihapus)
	const itemOptions = [
		...(
			await db
				.select({ id: products.id, name: products.name })
				.from(products)
				.where(isNull(products.deletedAt))
				.orderBy(products.name)
		).map((p) => ({ value: `p:${p.id}`, label: p.name })),
		...(
			await db
				.select({ id: bundles.id, name: bundles.name })
				.from(bundles)
				.where(isNull(bundles.deletedAt))
				.orderBy(bundles.name)
		).map((b) => ({ value: `b:${b.id}`, label: `Paket: ${b.name}` }))
	];

	return {
		overview,
		movements,
		itemOptions,
		movementTypes: MOVEMENT_TYPES,
		filters: { q, lowOnly, item: itemMatch ? itemRaw : '', type: type ?? '' },
		pagination: {
			page,
			perPage: MOVEMENTS_PER_PAGE,
			totalItems: totalMovements,
			totalPages
		}
	};
};

export const actions = {
	adjust: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();

		const raw = {
			kind: fd.get('kind'),
			id: fd.get('id'),
			size: fd.get('size'),
			newStock: fd.get('newStock'),
			note: fd.get('note')
		};

		const parsed = adjustSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors,
				values: raw
			});
		}

		const { kind, id, size, newStock, note } = parsed.data;

		try {
			const r = await transact((tx) => {
				// Item sudah dihapus (soft delete) tidak boleh disesuaikan
				const row =
					kind === 'product'
						? tx
								.select({
									name: products.name,
									deletedAt: products.deletedAt,
									stock: products.stock
								})
								.from(products)
								.where(eq(products.id, id))
								.get()
						: tx
								.select({ name: bundles.name, deletedAt: bundles.deletedAt, stock: bundles.stock })
								.from(bundles)
								.where(eq(bundles.id, id))
								.get();
				if (!row || row.deletedAt) {
					throw new Error(
						kind === 'product' ? 'Produk tidak ditemukan' : 'Bundling tidak ditemukan'
					);
				}

				// Produk ber-ukuran: stok yang disesuaikan = stok SATU ukuran (wajib dipilih)
				let before = row.stock;
				let label = row.name;
				if (kind === 'product') {
					const sizes = getSizes(tx, id);
					if (sizes.length > 0) {
						if (!size) throw new SizeInputError('Pilih ukuran yang stoknya disesuaikan.');
						const target = sizes.find((s) => s.label === size);
						if (!target) throw new SizeInputError(`Ukuran ${size} tidak ada pada produk ini.`);
						before = target.stock;
						label = `${row.name} (${size})`;
					} else if (size) {
						throw new SizeInputError('Produk ini tidak memiliki pilihan ukuran.');
					}
				} else if (size) {
					throw new SizeInputError('Paket bundling tidak memiliki ukuran.');
				}

				const diff =
					kind === 'product'
						? setProductStock(tx, id, newStock, admin.id, note, size)
						: setBundleStock(tx, id, newStock, admin.id, note);

				if (diff !== 0) {
					logActivity(
						admin.id,
						'stock.adjust',
						kind,
						id,
						`Stok ${label} disesuaikan ${before} → ${newStock} (selisih ${diff > 0 ? '+' + diff : diff}): ${note}`,
						tx
					);
				}
				return { name: label, before, diff };
			});

			return {
				success: true,
				message:
					r.diff === 0
						? `Stok "${r.name}" sudah ${newStock}, tidak ada perubahan yang dicatat.`
						: `Stok "${r.name}" disesuaikan ${r.before} → ${newStock} (selisih ${r.diff > 0 ? '+' + r.diff : r.diff}) dan tercatat di riwayat mutasi.`
			};
		} catch (e) {
			if (e instanceof SizeInputError) return fail(400, { message: e.message, values: raw });
			// setProductStock/setBundleStock melempar bila item tidak ditemukan
			if (e instanceof Error && e.message.endsWith('tidak ditemukan')) {
				return fail(404, { message: e.message, values: raw });
			}
			throw e;
		}
	}
};
