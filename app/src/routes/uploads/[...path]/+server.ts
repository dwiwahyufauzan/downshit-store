import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR } from '$app/env/private';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { payments, orders } from '#lib/server/db/schema';
import { STAFF_SESSION_COOKIE, validateSession } from '#lib/server/auth';
import type { RequestHandler } from './$types';

const ROOT = path.resolve(UPLOAD_DIR ?? './uploads');

// Allow-list nama berkas: hanya folder dikenal + nama UUID/slug + ekstensi gambar.
// Hasil upload baru selalu .webp; ekstensi jpg/png hanya untuk berkas lama sebelum re-encode WebP.
const ALLOWED = /^(products|bundles|reviews|proofs)\/[\w-]+\.(webp|jpe?g|png)$/;
const MIME: Record<string, string> = {
	webp: 'image/webp',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png'
};

export const GET: RequestHandler = async ({ params, locals, cookies }) => {
	const rel = params.path ?? '';
	if (!ALLOWED.test(rel)) error(404, 'File tidak ditemukan'); // menolak "..", subfolder lain, ekstensi lain

	const full = path.resolve(ROOT, rel);
	if (!full.startsWith(ROOT + path.sep)) error(400, 'Path tidak valid'); // lapisan kedua anti path traversal

	const isProof = rel.startsWith('proofs/');
	if (isProof) {
		// Bukti pembayaran: hanya pemilik pesanan, admin, atau owner
		// Staf (cookie staf) dicek lebih dulu: window admin & pelanggan bisa hidup berdampingan di satu peramban
		const staffToken = cookies.get(STAFF_SESSION_COOKIE);
		const staff = staffToken ? await validateSession(staffToken) : null;
		const viewer = staff && staff.role !== 'konsumen' ? staff : locals.user;
		if (!viewer) error(401, 'Silakan masuk terlebih dahulu');

		if (viewer.role === 'konsumen') {
			const [row] = await db
				.select({ orderUserId: orders.userId })
				.from(payments)
				.innerJoin(orders, eq(orders.id, payments.orderId))
				.where(eq(payments.proofUrl, `/uploads/${rel}`))
				.limit(1);

			// 404 (bukan 403) agar keberadaan file tidak bocor ke konsumen lain
			if (!row || row.orderUserId !== viewer.id) error(404, 'File tidak ditemukan');
		}
	}

	let file: Buffer;
	try {
		file = await readFile(full);
	} catch {
		// Thumbnail belum ada (berkas lama): sajikan gambar utama sebagai cadangan
		const fallback = rel.replace(/_t\.webp$/, '.webp');
		if (fallback === rel) error(404, 'File tidak ditemukan');
		try {
			file = await readFile(path.resolve(ROOT, fallback));
		} catch {
			error(404, 'File tidak ditemukan');
		}
	}

	const ext = rel.split('.').pop() ?? '';
	return new Response(new Uint8Array(file), {
		headers: {
			'Content-Type': MIME[ext] ?? 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			// Nama berupa UUID → isi tidak pernah berubah. Bukti bayar tidak boleh di-cache.
			'Cache-Control': isProof ? 'private, no-store' : 'public, max-age=31536000, immutable'
		}
	});
};
