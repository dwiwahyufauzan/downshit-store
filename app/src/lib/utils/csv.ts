const FORMULA = /^[=+\-@\t\r]/;

/** Satu sel CSV: angka apa adanya, teks dikutip + dinetralkan dari formula injection. */
export function csvCell(v: unknown): string {
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '""';
	let s = v === null || v === undefined ? '' : String(v);
	if (FORMULA.test(s)) s = `'${s}`;
	return `"${s.replace(/"/g, '""')}"`;
}

export const toCsv = (rows: unknown[][], sep = ',') =>
	rows.map((r) => r.map(csvCell).join(sep)).join('\r\n');
