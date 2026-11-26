/**
 * Membuat src/lib/server/data/wilayah.json (provinsi → kota/kab → kecamatan → desa/kelurahan)
 * dari paket npm `idn-area-data` (ODbL, lihat src/lib/server/data/WILAYAH.md). Hanya dijalankan saat
 * data wilayah diperbarui, hasilnya di-commit:
 *   npm pack idn-area-data && mkdir /tmp/idn && tar xzf idn-area-data-*.tgz -C /tmp/idn
 *   npx tsx scripts/build-wilayah.ts /tmp/idn/package/data
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
	console.error(
		'Pakai: tsx scripts/build-wilayah.ts <folder berisi provinces.csv, regencies.csv, ...>'
	);
	process.exit(1);
}

/** Pecah satu baris CSV; mendukung nilai berkutip ("a, b" dan "" sebagai kutip). */
function cells(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cur += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

const rows = (file: string) =>
	readFileSync(join(dir, file), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(cells);

type Opt = [code: string, name: string];
const byParent = (file: string, parentCol: number) => {
	const map: Record<string, Opt[]> = {};
	for (const r of rows(file)) (map[r[parentCol]] ??= []).push([r[0], r[parentCol + 1]]);
	return map;
};

const data = {
	p: rows('provinces.csv').map((r): Opt => [r[0], r[1]]),
	r: byParent('regencies.csv', 1),
	d: byParent('districts.csv', 1),
	v: byParent('villages.csv', 1)
};

writeFileSync('src/lib/server/data/wilayah.json', JSON.stringify(data));
console.log(
	`✓ ${data.p.length} provinsi, ${Object.values(data.r).flat().length} kota/kab, ` +
		`${Object.values(data.d).flat().length} kecamatan, ${Object.values(data.v).flat().length} desa/kelurahan`
);
