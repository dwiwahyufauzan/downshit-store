import { error, json } from '@sveltejs/kit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '$app/env/private';
import { purgeExpiredSessions } from '#lib/server/auth';
import { purgeOld } from '#lib/server/rate-limit';
import { expireUnpaidOrders } from '#lib/server/orders';
import { autoCompleteShippedOrders } from '#lib/server/order-flow';
import { reconcileGatewayPayments } from '#lib/server/gateway-payments';
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

	return json({
		expiredOrders: await run('expireUnpaidOrders', expireUnpaidOrders),
		completedOrders: await run('autoCompleteShippedOrders', autoCompleteShippedOrders),
		reconciledGatewayPayments: await run('reconcileGatewayPayments', reconcileGatewayPayments),
		purgedSessions: await run('purgeExpiredSessions', purgeExpiredSessions),
		purgedLoginAttempts: await run('purgeOld', purgeOld)
	});
};
