import { fail } from '@sveltejs/kit';
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db, transact } from '#lib/server/db';
import { dbErrno } from '#lib/server/db/retry';
import { orders, voucherRedemptions, vouchers } from '#lib/server/db/schema';
import { VOUCHER_STATUSES, voucherStatus, type VoucherStatus } from '#lib/server/vouchers';
import { requireRole } from '#lib/server/guards';
import { voucherSchema } from '#lib/schemas/voucher';
import { logActivity } from '#lib/server/activity';
import { idParam } from '#lib/server/sql';
import { wibEnd, wibStart } from '#lib/server/time';
import type { Actions, PageServerLoad } from './$types';

const FIELDS = [
	'code',
	'description',
	'type',
	'value',
	'minSubtotal',
	'maxDiscount',
	'startsOn',
	'endsOn',
	'usageLimit',
	'perUserLimit'
] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'admin');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const statusParam = url.searchParams.get('status') ?? '';
	const status = (VOUCHER_STATUSES as readonly string[]).includes(statusParam)
		? (statusParam as VoucherStatus)
		: '';

	const all = (
		await db.select().from(vouchers).orderBy(desc(vouchers.createdAt), desc(vouchers.id))
	).map((v) => ({ ...v, status: voucherStatus(v) }));

	// total potongan yang benar-benar diberikan per kode (pesanan batal tidak dihitung)
	const given = new Map(
		db
			.select({
				code: orders.voucherCode,
				total: sql<number>`COALESCE(SUM(${orders.discount}), 0)`
			})
			.from(orders)
			.where(and(isNotNull(orders.voucherCode), ne(orders.status, 'dibatalkan')))
			.groupBy(orders.voucherCode)
			.all()
			.map((r) => [r.code, Number(r.total)])
	);

	const counts = Object.fromEntries(VOUCHER_STATUSES.map((s) => [s, 0])) as Record<
		VoucherStatus,
		number
	>;
	for (const v of all) counts[v.status]++;

	const needle = q.toLowerCase();
	const list = all
		.filter((v) => !status || v.status === status)
		.filter(
			(v) =>
				!needle ||
				v.code.toLowerCase().includes(needle) ||
				(v.description ?? '').toLowerCase().includes(needle)
		)
		.map((v) => ({ ...v, discountGiven: given.get(v.code) ?? 0 }));

	return {
		vouchers: list,
		filters: { q, status },
		stats: {
			total: all.length,
			counts,
			redemptions: all.reduce((n, v) => n + v.usedCount, 0),
			discountGiven: [...given.values()].reduce((n, x) => n + x, 0)
		}
	};
};

const readForm = (fd: FormData) => {
	const raw: Record<string, FormDataEntryValue | boolean | undefined> = Object.fromEntries(
		FIELDS.map((f) => [f, fd.get(f) ?? undefined])
	);
	raw.isActive = fd.get('isActive') === 'on';
	raw.showOnHome = fd.get('showOnHome') === 'on';
	return raw;
};

const DUP = 'Kode voucher sudah dipakai. Gunakan kode lain.';

export const actions: Actions = {
	simpan: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString()); // kosong = voucher baru
		const raw = readForm(fd);

		const parsed = voucherSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				action: id ? 'update' : 'create',
				id,
				errors: parsed.error.flatten().fieldErrors,
				values: raw
			});
		}
		const d = parsed.data;
		const values = {
			code: d.code,
			description: d.description || null,
			type: d.type,
			value: d.value,
			minSubtotal: d.minSubtotal,
			maxDiscount: d.maxDiscount ?? null,
			startsAt: d.startsOn ? wibStart(d.startsOn).toISOString() : null,
			endsAt: d.endsOn ? wibEnd(d.endsOn).toISOString() : null,
			usageLimit: d.usageLimit ?? null,
			perUserLimit: d.perUserLimit,
			isActive: d.isActive,
			showOnHome: d.showOnHome
		};

		try {
			await transact((tx) => {
				if (id) {
					const cur = tx.select().from(vouchers).where(eq(vouchers.id, id)).get();
					if (!cur) throw new Error('NOT_FOUND');
					if (values.usageLimit !== null && values.usageLimit < cur.usedCount) {
						throw new Error('QUOTA_BELOW_USED');
					}
					tx.update(vouchers)
						.set({ ...values, updatedAt: new Date().toISOString() })
						.where(eq(vouchers.id, id))
						.run();
					logActivity(admin.id, 'voucher.update', 'voucher', id, `Voucher ${d.code} diubah`, tx);
				} else {
					const res = tx.insert(vouchers).values(values).returning({ id: vouchers.id }).get();
					logActivity(
						admin.id,
						'voucher.create',
						'voucher',
						res.id,
						`Voucher ${d.code} dibuat`,
						tx
					);
				}
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : '';
			if (dbErrno(e) === 1062)
				return fail(400, {
					action: id ? 'update' : 'create',
					id,
					errors: { code: [DUP] },
					values: raw
				});
			if (msg === 'NOT_FOUND') return fail(404, { message: 'Voucher tidak ditemukan.' });
			if (msg === 'QUOTA_BELOW_USED')
				return fail(400, {
					action: 'update',
					id,
					errors: { usageLimit: ['Kuota tidak boleh di bawah jumlah yang sudah terpakai'] },
					values: raw
				});
			throw e;
		}
		return { success: true, message: id ? 'Voucher diperbarui.' : 'Voucher dibuat.' };
	},

	toggle: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		if (!id) return fail(400, { message: 'ID voucher tidak valid.' });
		const active = fd.get('active') === '1';
		const row = db.select().from(vouchers).where(eq(vouchers.id, id)).get();
		if (!row) return fail(404, { message: 'Voucher tidak ditemukan.' });
		db.update(vouchers).set({ isActive: active }).where(eq(vouchers.id, id)).run();
		logActivity(
			admin.id,
			'voucher.update',
			'voucher',
			id,
			`Voucher ${row.code} ${active ? 'diaktifkan' : 'dinonaktifkan'}`
		);
		return { success: true, message: active ? 'Voucher diaktifkan.' : 'Voucher dinonaktifkan.' };
	},

	hapus: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();
		const id = idParam(fd.get('id')?.toString());
		if (!id) return fail(400, { message: 'ID voucher tidak valid.' });
		const row = db.select().from(vouchers).where(eq(vouchers.id, id)).get();
		if (!row) return fail(404, { message: 'Voucher tidak ditemukan.' });
		const used = db
			.select({ id: voucherRedemptions.id })
			.from(voucherRedemptions)
			.where(eq(voucherRedemptions.voucherId, id))
			.get();
		if (used) {
			return fail(400, {
				message: 'Voucher yang sudah pernah dipakai tidak bisa dihapus. Nonaktifkan saja.'
			});
		}
		db.delete(vouchers).where(eq(vouchers.id, id)).run();
		logActivity(admin.id, 'voucher.delete', 'voucher', id, `Voucher ${row.code} dihapus`);
		return { success: true, message: 'Voucher dihapus.' };
	}
};
