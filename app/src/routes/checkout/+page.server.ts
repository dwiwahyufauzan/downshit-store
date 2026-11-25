import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireRole } from '#lib/server/guards';
import { db } from '#lib/server/db';
import { users } from '#lib/server/db/schema';
import { getCartDetails } from '#lib/server/cart';
import { getSettings } from '#lib/server/settings';
import { createOrderFromCart, OrderError } from '#lib/server/orders';
import {
	enabledMethods,
	getPaymentOptions,
	startOnlinePayment
} from '#lib/server/gateway-payments';
import { gatewayMode } from '#lib/server/midtrans';
import { isGatewayMethod, type PaymentMethod } from '#lib/constants';
import { checkoutSchema } from '#lib/schemas/checkout';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}

	requireRole(locals, 'konsumen');

	const [cart, settings, [userProfile]] = await Promise.all([
		getCartDetails(locals.user.id),
		getSettings(),
		db
			.select({
				name: users.name,
				phone: users.phone,
				address: users.address
			})
			.from(users)
			.where(eq(users.id, locals.user.id))
			.limit(1)
	]);

	if (cart.items.length === 0) {
		throw redirect(303, '/keranjang');
	}

	const hasProblem = cart.items.some((item) => !item.isAvailable);
	if (hasProblem) {
		throw redirect(303, '/keranjang');
	}

	const shippingCost = settings.shippingCost ?? 0;
	const total = cart.subtotal + shippingCost;
	const paymentOptions = await getPaymentOptions(settings);

	return {
		cart,
		settings,
		paymentOptions,
		simulator: gatewayMode() === 'simulator',
		userProfile: {
			recipientName: userProfile?.name ?? '',
			recipientPhone: userProfile?.phone ?? '',
			shippingAddress: userProfile?.address ?? '',
			notes: ''
		},
		shippingCost,
		total
	};
};

export type CheckoutFormErrors = Partial<
	Record<
		'recipientName' | 'recipientPhone' | 'shippingAddress' | 'notes' | 'paymentMethod',
		string[]
	>
>;

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireRole(locals, 'konsumen');

		const formData = await request.formData();
		const raw = {
			recipientName: formData.get('recipientName')?.toString() ?? '',
			recipientPhone: formData.get('recipientPhone')?.toString() ?? '',
			shippingAddress: formData.get('shippingAddress')?.toString() ?? '',
			notes: formData.get('notes')?.toString() || undefined,
			paymentMethod: formData.get('paymentMethod')?.toString() || undefined
		};

		const parse = checkoutSchema.safeParse(raw);

		if (!parse.success) {
			const errors: CheckoutFormErrors = parse.error.flatten().fieldErrors;
			return fail(400, {
				errors,
				values: raw,
				message: 'Mohon periksa kembali formulir pengiriman Anda.'
			});
		}

		const method = parse.data.paymentMethod as PaymentMethod;
		// metode harus yang sedang aktif di toko (formulir bisa dipalsukan)
		if (!enabledMethods(await getSettings()).includes(method)) {
			return fail(400, {
				errors: {
					paymentMethod: ['Metode pembayaran ini sedang tidak tersedia']
				} as CheckoutFormErrors,
				values: raw,
				message: 'Pilih metode pembayaran yang tersedia.'
			});
		}

		const saveToProfile = formData.get('saveToProfile') === 'on';
		let createdOrder: { orderId: number; code: string };

		try {
			createdOrder = await createOrderFromCart(locals.user!.id, {
				recipientName: parse.data.recipientName,
				recipientPhone: parse.data.recipientPhone,
				shippingAddress: parse.data.shippingAddress,
				notes: parse.data.notes,
				saveToProfile
			});
		} catch (err) {
			if (err instanceof OrderError) {
				return fail(400, {
					errors: {} as CheckoutFormErrors,
					message: err.message,
					values: raw
				});
			}
			console.error('Checkout error:', err);
			return fail(500, {
				errors: {} as CheckoutFormErrors,
				message:
					'Terjadi kesalahan sistem saat memproses pesanan. Silakan coba beberapa saat lagi.',
				values: raw
			});
		}

		// Pembayaran online: langsung ke halaman bayar Midtrans. Bila gagal, pesanan tetap dibuat dan
		// pelanggan memilih ulang metode di halaman pesanan (tidak perlu mengulang checkout).
		if (isGatewayMethod(method)) {
			try {
				const { redirectUrl } = await startOnlinePayment(
					createdOrder.code,
					locals.user!.id,
					method
				);
				throw redirect(303, redirectUrl);
			} catch (err) {
				if (isRedirect(err)) throw err;
				// Pesanan SUDAH dibuat & stok terpotong: error apa pun (OrderError maupun gangguan tak terduga)
				// jangan berujung halaman 500, arahkan ke pesanan agar pelanggan bisa memilih ulang metode bayar.
				console.error(
					'Checkout: gagal memulai pembayaran online',
					err instanceof OrderError ? err.message : err
				);
				throw redirect(303, `/pesanan/${createdOrder.code}?baru=1&bayar=gagal`);
			}
		}

		throw redirect(303, `/pesanan/${createdOrder.code}?baru=1`);
	}
};
