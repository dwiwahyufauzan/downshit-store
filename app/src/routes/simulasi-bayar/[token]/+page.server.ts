import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { GATEWAY_TYPE_LABEL } from '#lib/constants';
import { db } from '#lib/server/db';
import { orders, payments } from '#lib/server/db/schema';
import { applyGatewayStatus } from '#lib/server/gateway-payments';
import { requireRole } from '#lib/server/guards';
import {
	getSimByToken,
	getSimStatus,
	isSimulator,
	simChannels,
	simChooseChannel,
	simSetOutcome,
	type SimOutcome
} from '#lib/server/payment-simulator';
import type { Actions, PageServerLoad } from './$types';

/** Transaksi simulasi milik pelanggan yang sedang login; selain itu 404 (tidak membocorkan keberadaan). */
async function ownTransaction(token: string, userId: number) {
	if (!isSimulator()) throw error(404, 'Not found');
	const sim = getSimByToken(token);
	if (!sim) throw error(404, 'Transaksi tidak ditemukan');
	const [row] = await db
		.select({
			code: orders.code,
			userId: orders.userId,
			status: orders.status,
			total: orders.total
		})
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.where(eq(payments.gatewayOrderId, sim.gatewayOrderId))
		.limit(1);
	if (!row || row.userId !== userId) throw error(404, 'Transaksi tidak ditemukan');
	return { sim, order: row };
}

/** Meneruskan status simulator ke toko, seperti notifikasi Midtrans yang sampai ke webhook. */
async function pushToShop(gatewayOrderId: string) {
	const st = getSimStatus(gatewayOrderId);
	if (st) await applyGatewayStatus(st);
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireRole(locals, 'konsumen');
	const first = await ownTransaction(params.token, user.id);
	// kedaluwarsa dihitung saat halaman dibuka; toko ikut diberi tahu
	await pushToShop(first.sim.gatewayOrderId);
	const { sim, order } = await ownTransaction(params.token, user.id);

	return {
		tx: {
			gatewayOrderId: sim.gatewayOrderId,
			amount: sim.amount,
			status: sim.status,
			channel: sim.channel,
			channelLabel: sim.channel ? (GATEWAY_TYPE_LABEL[sim.channel] ?? sim.channel) : null,
			paymentCode: sim.paymentCode,
			expiresAt: sim.expiresAt,
			token: sim.token
		},
		channels: simChannels(sim).map((key) => ({ key, label: GATEWAY_TYPE_LABEL[key] ?? key })),
		order: { code: order.code, status: order.status, total: order.total },
		returnUrl: `/pesanan/${order.code}?bayar=kembali`
	};
};

export const actions: Actions = {
	pilih: async ({ request, params, locals }) => {
		const user = requireRole(locals, 'konsumen');
		const { sim } = await ownTransaction(params.token, user.id);
		const channel = String((await request.formData()).get('channel') ?? '');
		if (simChooseChannel(params.token, channel) === 'invalid') {
			return fail(400, { message: 'Saluran tidak valid atau transaksi sudah berakhir' });
		}
		await pushToShop(sim.gatewayOrderId);
		return { success: true, message: 'Saluran dipilih. Menunggu pembayaran.' };
	},

	hasil: async ({ request, params, locals }) => {
		const user = requireRole(locals, 'konsumen');
		const { sim, order } = await ownTransaction(params.token, user.id);
		const outcome = String((await request.formData()).get('outcome') ?? '');
		if (!['settlement', 'deny', 'expire'].includes(outcome)) {
			return fail(400, { message: 'Hasil simulasi tidak dikenal' });
		}
		if (simSetOutcome(params.token, outcome as SimOutcome) === 'invalid') {
			return fail(400, { message: 'Pilih saluran dulu, atau transaksi sudah berakhir' });
		}
		await pushToShop(sim.gatewayOrderId);
		// seperti callback "finish" Midtrans: setelah berhasil bayar, kembali ke toko
		if (outcome === 'settlement') throw redirect(303, `/pesanan/${order.code}?bayar=kembali`);
		return {
			success: true,
			message:
				outcome === 'deny'
					? 'Pembayaran disimulasikan GAGAL.'
					: 'Transaksi disimulasikan KEDALUWARSA.'
		};
	}
};
