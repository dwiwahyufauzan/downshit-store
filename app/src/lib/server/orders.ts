import { and, asc, count, eq, lt } from 'drizzle-orm';
import { db, transact } from './db';
import {
	NOW_ISO,
	bundleItems,
	bundles,
	cartItems,
	carts,
	orderItemComponents,
	orderItems,
	orders,
	payments,
	products,
	shipments,
	users
} from './db/schema';
import {
	decreaseBundleStock,
	decreaseProductStock,
	increaseBundleStock,
	increaseProductStock
} from './stock';
import { getSettings } from './settings';
import { checkSize } from './cart';
import { decodeSelection } from '$lib/utils/sizes';
import { logActivity } from './activity';
import { generateOrderCode } from './codes';
import { canCancel, type Status } from './order-status';

export class OrderError extends Error {
	kind: string;
	constructor(message: string, kind = 'bad_request') {
		super(message);
		this.name = 'OrderError';
		this.kind = kind;
	}
}

type ShippingInfo = {
	recipientName: string;
	recipientPhone: string;
	shippingAddress: string;
	notes?: string;
	/** Simpan HP & alamat penerima sebagai default profil konsumen */
	saveToProfile?: boolean;
};

/** Kode pesanan acak bentrok dengan yang sudah ada (indeks unik uq_orders_code) — sangat jarang. */
const isCodeCollision = (e: unknown) =>
	/UNIQUE constraint failed: orders\.code/.test(String((e as Error)?.message ?? ''));

export async function createOrderFromCart(userId: number, ship: ShippingInfo) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await createOrderOnce(userId, ship);
		} catch (e) {
			if (attempt < 2 && isCodeCollision(e)) continue;
			throw e;
		}
	}
}

async function createOrderOnce(userId: number, ship: ShippingInfo) {
	const cfg = await getSettings();

	return transact((tx) => {
		// BR-18: batasi pesanan yang BELUM dibayar (anti-penimbunan stok)
		const unpaid = tx
			.select({ n: count() })
			.from(orders)
			.where(and(eq(orders.userId, userId), eq(orders.status, 'menunggu_pembayaran')))
			.get();

		if ((unpaid?.n ?? 0) >= cfg.maxUnpaidOrders) {
			throw new OrderError(
				`Anda sudah memiliki ${cfg.maxUnpaidOrders} pesanan yang belum dibayar. Bayar atau batalkan salah satunya sebelum membuat pesanan baru.`
			);
		}

		const cart = tx.select().from(carts).where(eq(carts.userId, userId)).get();
		if (!cart) throw new OrderError('Keranjang belanja kosong');

		const lines = tx.select().from(cartItems).where(eq(cartItems.cartId, cart.id)).all();
		if (lines.length === 0) throw new OrderError('Keranjang belanja kosong');

		const code = generateOrderCode();
		// BR-17: batas bayar dari pengaturan toko
		const expiresAt = new Date(Date.now() + cfg.paymentDeadlineHours * 3_600_000).toISOString();

		const createdOrder = tx
			.insert(orders)
			.values({
				code,
				userId,
				status: 'menunggu_pembayaran',
				subtotal: 0,
				shippingCost: cfg.shippingCost,
				total: 0,
				recipientName: ship.recipientName,
				recipientPhone: ship.recipientPhone,
				shippingAddress: ship.shippingAddress,
				notes: ship.notes ?? null,
				expiresAt
			})
			.returning()
			.get();

		const orderId = createdOrder.id;
		const meta = { type: 'penjualan', refType: 'order', refId: orderId, by: userId } as const;
		let subtotal = 0;

		for (const ln of lines) {
			if (ln.productId) {
				const p = tx.select().from(products).where(eq(products.id, ln.productId)).get();
				if (!p || !p.isActive || p.deletedAt) {
					throw new OrderError(`Produk "${p?.name ?? 'item'}" sudah tidak tersedia`);
				}
				const chk = checkSize(tx, 'product', p.id, ln.size);
				if (!chk.ok) throw new OrderError(`${p.name}: ${chk.message}`);
				if (!decreaseProductStock(tx, p.id, ln.quantity, meta, ln.size)) {
					throw new OrderError(
						`Stok produk "${p.name}"${ln.size ? ` ukuran ${ln.size}` : ''} tidak mencukupi`
					);
				}

				const lineSubtotal = p.price * ln.quantity;
				subtotal += lineSubtotal;
				tx.insert(orderItems)
					.values({
						orderId,
						itemType: 'product',
						productId: p.id,
						itemName: p.name,
						unitPrice: p.price,
						quantity: ln.quantity,
						subtotal: lineSubtotal,
						size: ln.size
					})
					.run();
			} else if (ln.bundleId) {
				const b = tx.select().from(bundles).where(eq(bundles.id, ln.bundleId)).get();
				if (!b || !b.isActive || b.deletedAt) {
					throw new OrderError(`Paket bundling "${b?.name ?? 'paket'}" sudah tidak tersedia`);
				}
				const chk = checkSize(tx, 'bundle', b.id, ln.size);
				if (!chk.ok) throw new OrderError(`Paket "${b.name}": ${chk.message}`);
				const picked = decodeSelection(ln.size);
				if (!decreaseBundleStock(tx, b.id, ln.quantity, meta)) {
					throw new OrderError(`Stok paket bundling "${b.name}" tidak mencukupi`);
				}

				const lineSubtotal = b.price * ln.quantity;
				subtotal += lineSubtotal;
				const oi = tx
					.insert(orderItems)
					.values({
						orderId,
						itemType: 'bundle',
						bundleId: b.id,
						itemName: b.name,
						unitPrice: b.price,
						quantity: ln.quantity,
						subtotal: lineSubtotal,
						size: ln.size
					})
					.returning()
					.get();

				// BR-06: stok tiap produk komponen ikut berkurang; simpan snapshot untuk pembatalan
				const comps = tx.select().from(bundleItems).where(eq(bundleItems.bundleId, b.id)).all();
				if (comps.length === 0) throw new OrderError(`Paket "${b.name}" tidak valid (tanpa isi)`);
				for (const c of comps) {
					const requiredQty = c.quantity * ln.quantity;
					const cp = tx.select().from(products).where(eq(products.id, c.productId)).get();
					if (!cp || !cp.isActive || cp.deletedAt) {
						throw new OrderError(`Komponen paket "${b.name}" sudah tidak tersedia`);
					}
					const compSize = picked[c.productId] ?? '';
					const ok = decreaseProductStock(
						tx,
						c.productId,
						requiredQty,
						{ ...meta, note: `Komponen paket "${b.name}"` },
						compSize
					);
					if (!ok) {
						throw new OrderError(
							`Stok "${cp.name}"${compSize ? ` ukuran ${compSize}` : ''} untuk paket "${b.name}" tidak mencukupi`
						);
					}

					tx.insert(orderItemComponents)
						.values({
							orderItemId: oi.id,
							productId: c.productId,
							quantity: requiredQty,
							size: compSize
						})
						.run();
				}
			}
		}

		const total = subtotal + cfg.shippingCost;
		tx.update(orders).set({ subtotal, total }).where(eq(orders.id, orderId)).run();
		// BR-20: TIDAK ada baris payments di sini; satu baris dibuat per unggahan bukti (order-flow)
		tx.insert(shipments).values({ orderId, status: 'belum_dikirim' }).run();
		tx.delete(cartItems).where(eq(cartItems.cartId, cart.id)).run();

		if (ship.saveToProfile) {
			tx.update(users)
				.set({ phone: ship.recipientPhone, address: ship.shippingAddress })
				.where(eq(users.id, userId))
				.run();
		}

		logActivity(
			userId,
			'order.create',
			'order',
			orderId,
			`Pesanan ${code} berhasil dibuat senilai Rp ${total.toLocaleString('id-ID')}`,
			tx
		);

		return { orderId, code };
	});
}

const CANT_CANCEL_MSG = {
	konsumen: 'Pesanan sudah diproses dan tidak dapat dibatalkan',
	admin: 'Pesanan dengan status ini tidak dapat dibatalkan',
	system: 'Pesanan tidak dapat dibatalkan otomatis'
} as const;

/** `actor.id` null = sistem (kedaluwarsa). Aturan siapa-boleh-batal-apa ada di `CANCELLABLE_BY`. */
export async function cancelOrder(
	orderId: number,
	actor: { id: number | null; role: 'konsumen' | 'admin' | 'system' },
	reason: string
) {
	return transact((tx) => {
		const o = tx.select().from(orders).where(eq(orders.id, orderId)).get();
		if (!o) throw new OrderError('Pesanan tidak ditemukan', 'not_found');

		if (actor.role === 'konsumen' && o.userId !== actor.id) {
			throw new OrderError('Pesanan tidak ditemukan', 'not_found');
		}
		if (!canCancel(actor.role, o.status as Status)) {
			throw new OrderError(CANT_CANCEL_MSG[actor.role]);
		}
		if (actor.role === 'admin' && reason.trim().length < 5) {
			throw new OrderError('Alasan pembatalan wajib diisi (min. 5 karakter)');
		}
		// pengaman: job otomatis tidak boleh membatalkan pesanan yang batas bayarnya belum lewat
		if (actor.role === 'system' && o.expiresAt && new Date(o.expiresAt).getTime() > Date.now()) {
			throw new OrderError('Belum melewati batas waktu pembayaran');
		}

		const meta = { type: 'pembatalan', refType: 'order', refId: orderId, by: actor.id } as const;
		const items = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();

		for (const it of items) {
			if (it.itemType === 'product' && it.productId) {
				increaseProductStock(tx, it.productId, it.quantity, meta, it.size);
			} else if (it.itemType === 'bundle' && it.bundleId) {
				increaseBundleStock(tx, it.bundleId, it.quantity, meta);
				const comps = tx
					.select()
					.from(orderItemComponents)
					.where(eq(orderItemComponents.orderItemId, it.id))
					.all();
				for (const c of comps) increaseProductStock(tx, c.productId, c.quantity, meta, c.size);
			}
		}

		// BR-20: pembayaran sudah dikonfirmasi → refund manual dicatat; bukti yang menunggu → ditolak
		const pays = tx.select().from(payments).where(eq(payments.orderId, orderId)).all();
		for (const p of pays) {
			if (p.status === 'dikonfirmasi') {
				tx.update(payments)
					.set({ status: 'dikembalikan', note: `Pesanan dibatalkan: ${reason}`.slice(0, 255) })
					.where(eq(payments.id, p.id))
					.run();
			} else if (p.status === 'menunggu') {
				tx.update(payments)
					.set({ status: 'ditolak', note: 'Pesanan dibatalkan' })
					.where(eq(payments.id, p.id))
					.run();
			}
		}

		tx.update(orders)
			.set({
				status: 'dibatalkan',
				cancelReason: reason.slice(0, 255),
				cancelledAt: new Date().toISOString(),
				updatedAt: NOW_ISO
			})
			.where(eq(orders.id, orderId))
			.run();

		logActivity(
			actor.id,
			'order.cancel',
			'order',
			orderId,
			`Pesanan ${o.code} dibatalkan (${reason})`,
			tx
		);
	});
}

/** Batalkan semua pesanan menunggu_pembayaran yang melewati batas bayar. */
export async function expireUnpaidOrders(limit = 200): Promise<number> {
	const now = new Date().toISOString();
	const due = await db
		.select({ id: orders.id })
		.from(orders)
		.where(and(eq(orders.status, 'menunggu_pembayaran'), lt(orders.expiresAt, now)))
		.orderBy(asc(orders.expiresAt))
		.limit(limit);

	let done = 0;
	for (const { id } of due) {
		try {
			await cancelOrder(id, { id: null, role: 'system' }, 'Melewati batas waktu pembayaran');
			done++;
		} catch (e) {
			// OrderError = status sudah berubah (mis. bukti baru diunggah): wajar dilewati
			if (!(e instanceof OrderError)) console.error('[expire] gagal membatalkan pesanan', id, e);
		}
	}
	return done;
}
