import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { orderItems, orders, payments, shipments, users } from './db/schema';
import { getSettings } from './settings';
import { mailEnabled, sendMail, textToHtml } from './mail';
import { sendWhatsApp, waEnabled } from './wa-gateway';
import { envVar } from './config';
import { rupiah, tanggal } from '#lib/utils/format';

/** Kejadian pesanan yang memicu email ke pelanggan. */
export type OrderEvent = 'dibuat' | 'dibayar' | 'ditolak' | 'dikirim' | 'dibatalkan';

const orderUrl = (code: string) => `${(envVar('ORIGIN') ?? '').replace(/\/$/, '')}/pesanan/${code}`;

/**
 * Kirim email status pesanan ke pemiliknya. Dipanggil lewat `afterCommit` (setelah transaksi sukses);
 * tidak melempar, dan tidak melakukan apa-apa bila email belum dikonfigurasi.
 */
export async function notifyOrder(orderId: number, event: OrderEvent): Promise<void> {
	if (!mailEnabled() && !waEnabled()) return;

	const row = db
		.select({ o: orders, email: users.email, userName: users.name })
		.from(orders)
		.innerJoin(users, eq(users.id, orders.userId))
		.where(eq(orders.id, orderId))
		.get();
	if (!row) return;
	const { o, email } = row;

	const [cfg, items] = await Promise.all([
		getSettings(),
		db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
	]);
	const lines = items.map(
		(i) => `- ${i.itemName}${i.size ? ` (${i.size})` : ''} × ${i.quantity}: ${rupiah(i.subtotal)}`
	);
	const summary = [
		`Pesanan ${o.code}`,
		...lines,
		...(o.discount > 0 ? [`Voucher ${o.voucherCode}: -${rupiah(o.discount)}`] : []),
		`Ongkos kirim${o.shippingService ? ` (${o.shippingService})` : ''}: ${rupiah(o.shippingCost)}`,
		`Total: ${rupiah(o.total)}`
	].join('\n');
	const link = `Lihat pesanan: ${orderUrl(o.code)}`;
	const hi = `Halo ${o.recipientName},`;
	const bye = `Terima kasih sudah berbelanja di ${cfg.storeName}.`;

	let subject: string;
	let intro: string;
	switch (event) {
		case 'dibuat': {
			subject = `Pesanan ${o.code} diterima, menunggu pembayaran`;
			const deadline = o.expiresAt ? ` sebelum ${tanggal(o.expiresAt)}` : '';
			const bank = cfg.payTransfer
				? `\n\nTransfer bank: ${cfg.bankName} ${cfg.bankNumber} a.n. ${cfg.bankHolder}. Setelah transfer, unggah bukti pembayaran di halaman pesanan.`
				: '';
			intro = `Pesananmu sudah kami terima. Selesaikan pembayaran${deadline}, jika tidak pesanan dibatalkan otomatis.${bank}`;
			break;
		}
		case 'dibayar':
			subject = `Pembayaran pesanan ${o.code} diterima`;
			intro = 'Pembayaranmu sudah kami konfirmasi. Pesanan sedang kami siapkan.';
			break;
		case 'ditolak': {
			const pay = db
				.select()
				.from(payments)
				.where(eq(payments.orderId, orderId))
				.orderBy(desc(payments.id))
				.get();
			subject = `Bukti pembayaran pesanan ${o.code} ditolak`;
			intro = `Bukti pembayaranmu belum bisa kami terima${pay?.note ? `: ${pay.note}` : ''}. Silakan unggah ulang bukti yang benar${o.expiresAt ? ` sebelum ${tanggal(o.expiresAt)}` : ''}.`;
			break;
		}
		case 'dikirim': {
			const s = db.select().from(shipments).where(eq(shipments.orderId, orderId)).get();
			subject = `Pesanan ${o.code} sudah dikirim`;
			intro = `Pesananmu sudah dikirim${s?.courier ? ` via ${s.courier}` : ''}${s?.trackingNumber ? `, nomor resi ${s.trackingNumber}` : ''}.`;
			break;
		}
		case 'dibatalkan':
			subject = `Pesanan ${o.code} dibatalkan`;
			intro = `Pesananmu dibatalkan${o.cancelReason ? `: ${o.cancelReason}` : ''}.`;
			break;
	}

	const text = [hi, intro, summary, link, bye].join('\n\n');
	// email & WhatsApp berjalan sendiri-sendiri: salah satu gagal tidak memengaruhi yang lain
	await Promise.all([
		mailEnabled()
			? sendMail({
					to: email,
					subject: `[${cfg.storeName}] ${subject}`,
					text,
					html: textToHtml(text)
				})
			: undefined,
		waEnabled() ? sendWhatsApp(o.recipientPhone, `*${cfg.storeName}*\n\n${text}`) : undefined,
		// pesanan baru juga dikabarkan ke WhatsApp toko agar admin tidak perlu membuka dashboard
		event === 'dibuat' && waEnabled()
			? sendWhatsApp(
					cfg.whatsapp,
					`Pesanan baru ${o.code} dari ${o.recipientName}: ${rupiah(o.total)}. Buka: ${(envVar('ORIGIN') ?? '').replace(/\/$/, '')}/admin/pesanan/${o.code}`
				)
			: undefined
	]);
}
