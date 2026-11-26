import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireRole } from '#lib/server/guards';
import { db } from '#lib/server/db';
import { users } from '#lib/server/db/schema';
import { getCartDetails } from '#lib/server/cart';
import { getSettings } from '#lib/server/settings';
import { getShippingOptions, shippingApiEnabled } from '#lib/server/shipping';
import { userAddressColumns } from '#lib/server/user-address';
import { resolveVillageCode } from '#lib/server/wilayah';
import { createOrderFromCart, OrderError } from '#lib/server/orders';
import {
	enabledMethods,
	getPaymentOptions,
	startOnlinePayment
} from '#lib/server/gateway-payments';
import { gatewayMode } from '#lib/server/midtrans';
import { isGatewayMethod, type PaymentMethod } from '#lib/constants';
import { checkoutSchema } from '#lib/schemas/checkout';
import { ADDRESS_FIELDS, partsOf } from '#lib/schemas/address';
import { addressOf, formatAddress } from '#lib/utils/address';
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
				...userAddressColumns
			})
			.from(users)
			.where(eq(users.id, locals.user.id))
			.limit(1)
	]);

	// hanya item yang dicentang di keranjang yang di-checkout
	const items = cart.items.filter((item) => item.isSelected);
	if (items.length === 0) {
		throw redirect(303, '/keranjang');
	}

	if (items.some((item) => !item.isAvailable)) {
		throw redirect(303, '/keranjang');
	}

	const shippingCost = settings.shippingCost ?? 0;
	const subtotal = cart.subtotal;
	const defaultAddress = userProfile ? addressOf(userProfile) : null;
	const paymentOptions = await getPaymentOptions(settings);

	return {
		items,
		totalItems: cart.selectedUnits,
		settings,
		paymentOptions,
		simulator: gatewayMode() === 'simulator',
		userProfile: {
			recipientName: userProfile?.name ?? '',
			recipientPhone: userProfile?.phone ?? '',
			notes: ''
		},
		// alamat default akun (null = belum diatur / belum lengkap) untuk opsi "pakai alamat profil"
		defaultAddress: defaultAddress && { ...defaultAddress, text: formatAddress(defaultAddress) },
		// isian awal formulir alamat baru; alamat lama (teks bebas) ditaruh di kolom detail
		newAddress: {
			province: userProfile?.addressProvince ?? '',
			city: userProfile?.addressCity ?? '',
			district: userProfile?.addressDistrict ?? '',
			village: userProfile?.addressVillage ?? '',
			addressDetail: userProfile?.addressDetail ?? userProfile?.address ?? '',
			postalCode: userProfile?.addressPostalCode ?? ''
		},
		// ongkir: tarif kurir per tujuan (dimuat klien lewat /api/ongkir) atau flat bila API nonaktif
		shippingApi: shippingApiEnabled(settings),
		weightGrams: cart.selectedWeight,
		shippingCost,
		subtotal
	};
};

export type CheckoutFormErrors = Partial<
	Record<
		| 'recipientName'
		| 'recipientPhone'
		| 'notes'
		| 'paymentMethod'
		| 'addressMode'
		| 'shippingOption'
		| 'voucherCode'
		| (typeof ADDRESS_FIELDS)[number],
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
			addressMode: formData.get('addressMode')?.toString() || undefined,
			province: formData.get('province')?.toString() ?? '',
			city: formData.get('city')?.toString() ?? '',
			district: formData.get('district')?.toString() ?? '',
			village: formData.get('village')?.toString() ?? '',
			addressDetail: formData.get('addressDetail')?.toString() ?? '',
			postalCode: formData.get('postalCode')?.toString() ?? '',
			shippingOption: formData.get('shippingOption')?.toString() || undefined,
			voucherCode: formData.get('voucherCode')?.toString() || undefined,
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

		// Alamat: default akun dibaca dari DB (bukan dari formulir), atau isian baru yang sudah divalidasi
		let address = partsOf(parse.data);
		if (parse.data.addressMode === 'profil') {
			const [u] = await db
				.select(userAddressColumns)
				.from(users)
				.where(eq(users.id, locals.user!.id))
				.limit(1);
			address = u ? addressOf(u) : null;
			if (!address) {
				return fail(400, {
					errors: {
						addressMode: ['Alamat default di profil belum lengkap']
					} as CheckoutFormErrors,
					values: raw,
					message: 'Lengkapi alamat default di profil, atau masukkan alamat baru.'
				});
			}
		}

		// Ongkir: dihitung ulang di server dari tujuan & berat (klien hanya mengirim id layanan terpilih)
		const cfg = await getSettings();
		const cart = await getCartDetails(locals.user!.id);
		const quote = await getShippingOptions(cfg, {
			postalCode: address!.postalCode,
			weightGrams: cart.selectedWeight,
			value: cart.subtotal
		});
		// ongkir flat tidak perlu dipilih; tarif kurir wajib dipilih salah satu
		const chosen =
			quote.source === 'flat'
				? quote.options[0]
				: quote.options.find((o) => o.id === parse.data.shippingOption);
		if (!chosen) {
			return fail(400, {
				errors: { shippingOption: ['Pilih layanan pengiriman'] } as CheckoutFormErrors,
				values: raw,
				message: 'Pilih layanan pengiriman terlebih dahulu.'
			});
		}
		const villageCode = await resolveVillageCode(address!);

		// hanya alamat baru yang bisa disimpan sebagai default (alamat profil sudah tersimpan)
		const saveToProfile =
			parse.data.addressMode === 'baru' && formData.get('saveToProfile') === 'on';
		let createdOrder: { orderId: number; code: string };

		try {
			createdOrder = await createOrderFromCart(locals.user!.id, {
				recipientName: parse.data.recipientName,
				recipientPhone: parse.data.recipientPhone,
				shippingAddress: formatAddress(address!),
				notes: parse.data.notes,
				saveToProfile,
				addressParts: address!,
				villageCode,
				voucherCode: parse.data.voucherCode,
				shipping: {
					cost: chosen.price,
					service: quote.source === 'api' ? chosen.label : null,
					etd: chosen.etd
				}
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
