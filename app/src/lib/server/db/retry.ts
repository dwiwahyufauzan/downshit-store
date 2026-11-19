export function dbErrno(e: unknown): number | undefined {
	const x = e as {
		errno?: number;
		code?: string;
		cause?: { errno?: number; code?: string };
	} | null;
	if (x?.errno !== undefined) return x.errno;
	if (x?.cause?.errno !== undefined) return x.cause.errno;

	// Fallback untuk SQLite constraint / busy
	const code = x?.code ?? x?.cause?.code;
	if (code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_UNIQUE') return 1062;
	if (code === 'SQLITE_BUSY') return 1205;

	return undefined;
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: { errnos?: number[]; tries?: number } = {}
): Promise<T> {
	const errnos = opts.errnos ?? [1213, 1205];
	const tries = opts.tries ?? 3;
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn();
		} catch (e) {
			const n = dbErrno(e);
			if (attempt >= tries || n === undefined || !errnos.includes(n)) throw e;
			await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
		}
	}
}
