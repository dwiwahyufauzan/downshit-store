import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { settings } from '#lib/server/db/schema';
import { log } from '#lib/server/logger';
import pkg from '../../../../package.json';
import type { RequestHandler } from './$types';

/** Pemeliharaan (cron tiap 15 menit) dianggap macet bila belum jalan selama ini. */
const MAINTENANCE_STALE_MS = 2 * 3600_000;
const startedAt = Date.now();

/**
 * Pemeriksaan untuk pemantau uptime (UptimeRobot, Better Stack, healthcheck.sh):
 *   200 {"status":"ok"}        aplikasi & database sehat
 *   200 {"status":"degraded"}  aplikasi hidup tetapi cron pemeliharaan tidak berjalan (lihat `maintenance`)
 *   503 {"status":"down"}      database tidak bisa dibaca
 * Publik dan ringan; tidak membuka data pengguna.
 */
export const GET: RequestHandler = async () => {
	const headers = { 'cache-control': 'no-store' };
	try {
		db.$client.prepare('select 1').get();
		const row = db
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, 'maintenance_last_run'))
			.get();
		const last = row ? Date.parse(row.value) : NaN;
		const age = Number.isFinite(last) ? Date.now() - last : null;
		// belum pernah ada catatan (instal baru) tidak dianggap macet
		const stale = age !== null && age > MAINTENANCE_STALE_MS;

		return json(
			{
				status: stale ? 'degraded' : 'ok',
				version: pkg.version,
				uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
				maintenance: { lastRunAt: row?.value ?? null, stale }
			},
			{ headers }
		);
	} catch (e) {
		log.error('health check: database gagal', {
			error: e instanceof Error ? e.message : String(e)
		});
		return json({ status: 'down' }, { status: 503, headers });
	}
};
