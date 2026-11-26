import { fail } from '@sveltejs/kit';
import { requireRole } from '#lib/server/guards';
import { getSettings, setSettings } from '#lib/server/settings';
import { transact } from '#lib/server/db';
import { settingsSchema } from '#lib/schemas/settings';
import { logActivity } from '#lib/server/activity';
import { gatewayMode, isGatewayConfigured } from '#lib/server/midtrans';
import { shippingApiConfigured } from '#lib/server/shipping';

export const load = async ({ locals }) => {
	requireRole(locals, 'admin');
	const currentSettings = await getSettings();
	return {
		settings: currentSettings,
		gateway: { configured: isGatewayConfigured(), mode: gatewayMode() },
		shippingApi: shippingApiConfigured()
	};
};

export const actions = {
	default: async ({ request, locals }) => {
		const admin = requireRole(locals, 'admin');
		const fd = await request.formData();

		const raw = {
			storeName: fd.get('storeName'),
			whatsapp: fd.get('whatsapp'),
			shippingCost: fd.get('shippingCost'),
			shippingOriginPostal: fd.get('shippingOriginPostal') ?? '',
			shippingCouriers: fd.get('shippingCouriers') ?? 'jne,jnt,sicepat,anteraja',
			bankName: fd.get('bankName'),
			bankNumber: fd.get('bankNumber'),
			bankHolder: fd.get('bankHolder'),
			lowStock: fd.get('lowStock'),
			paymentDeadlineHours: fd.get('paymentDeadlineHours'),
			maxUnpaidOrders: fd.get('maxUnpaidOrders'),
			autoCompleteDays: fd.get('autoCompleteDays'),
			payTransfer: fd.get('payTransfer') === 'on',
			payEwallet: fd.get('payEwallet') === 'on',
			payQris: fd.get('payQris') === 'on',
			payVa: fd.get('payVa') === 'on',
			payMinimarket: fd.get('payMinimarket') === 'on'
		};

		const parsed = settingsSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors,
				values: raw
			});
		}

		const d = parsed.data;

		// Semua kunci disimpan atomik (semua atau tidak sama sekali) + dicatat di log
		await transact((tx) => {
			setSettings(tx, d);
			logActivity(admin.id, 'settings.update', 'settings', null, 'Pengaturan toko diubah', tx);
		});

		// Perubahan ongkir tidak mengubah pesanan lama (snapshot orders.shipping_cost)
		return { success: true, message: 'Pengaturan toko berhasil disimpan!' };
	}
};
