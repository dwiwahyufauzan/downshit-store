import { error, json } from '@sveltejs/kit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '$app/env/private';
import { purgeExpiredSessions } from '#lib/server/auth';
import { purgeOld, purgeRateHits } from '#lib/server/rate-limit';
import { purgePasswordResets } from '#lib/server/password-reset';
import { notifyRestocked } from '#lib/server/stock-alerts';
import { expireUnpaidOrders } from '#lib/server/orders';
import { autoCompleteShippedOrders } from '#lib/server/order-flow';
import { reconcileGatewayPayments } from '#lib/server/gateway-payments';
import { setSetting } from '#lib/server/settings';
import type { RequestHandler } from './$types';

const digest = (s: string) => createHash('sha256').update(s).digest();

function authorized(header: string | null): boolean {
	const secret = CRON_SECRET;
	if (!secret || secret.length < 32) return false;
	const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
	return timingSafeEqual(digest(token), digest(secret));
}

export const POST: RequestHandler = async ({ request }) => {
	if (!authorized(request.headers.get('authorization'))) {
		throw error(404, 'Not found');
	}

	const run = async (name: string, fn: () => Promise<number>) => {
		try {
			return await fn();
		} catch (e) {
			console.error(`[maintenance] ${name} gagal`, e);
			return -1;
		}
	};

	const result = {
		expiredOrders: await run('expireUnpaidOrders', expireUnpaidOrders),
		completedOrders: await run('autoCompleteShippedOrders', autoCompleteShippedOrders),
		reconciledGatewayPayments: await run('reconcileGatewayPayments', reconcileGatewayPayments),
		purgedSessions: await run('purgeExpiredSessions', purgeExpiredSessions),
		purgedLoginAttempts: await run('purgeOld', purgeOld),
		restockEmails: await run('notifyRestocked', notifyRestocked),
		purgedRateHits: await run('purgeRateHits', async () => purgeRateHits()),
		purgedPasswordResets: await run('purgePasswordResets', purgePasswordResets)
	};
	// jejak terakhir cron berjalan, dibaca /api/health agar cron yang macet terdeteksi
	await setSetting('maintenance_last_run', new Date().toISOString());
	// Ada job yang gagal (-1) → 500 agar cron/healthcheck/monitor bisa mendeteksinya
	return json(result, { status: Object.values(result).includes(-1) ? 500 : 200 });
};
