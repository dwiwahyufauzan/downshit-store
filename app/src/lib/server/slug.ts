import { eq } from 'drizzle-orm';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from './db';

export async function uniqueSlug(
	table: SQLiteTable,
	col: SQLiteColumn,
	base: string
): Promise<string> {
	const root = base || 'item'; // nama tanpa huruf/angka (mis. "!!!") → 'item', 'item-2', …
	let slug = root;
	let i = 1;
	while (true) {
		const existing = await db.select({ val: col }).from(table).where(eq(col, slug)).limit(1);

		if (existing.length === 0) return slug;
		slug = `${root}-${++i}`;
	}
}
