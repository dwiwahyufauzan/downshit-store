import { like, count } from 'drizzle-orm';
import { purchases } from './db/schema';
import type { Tx } from './db';
import { todayWib } from './time';
import { randomBytes } from 'node:crypto';

export function nextPurchaseCode(tx: Tx): string {
	const ymd = todayWib().replaceAll('-', '').slice(2);
	const r = tx
		.select({ n: count() })
		.from(purchases)
		.where(like(purchases.code, `PBL-${ymd}-%`))
		.get();

	return `PBL-${ymd}-${String((r?.n ?? 0) + 1).padStart(3, '0')}`;
}

export function generateOrderCode(): string {
	const ymd = todayWib().replaceAll('-', '').slice(2);
	const rand = randomBytes(3).toString('hex').toUpperCase();
	return `DWN-${ymd}-${rand}`;
}
