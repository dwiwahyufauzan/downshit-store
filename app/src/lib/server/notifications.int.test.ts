/**
 * Email transaksional: notifikasi status pesanan (setelah commit) dan lupa password pelanggan.
 * Pengiriman nyata diganti transport tes (setMailTransport); tidak ada jaringan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = await vi.hoisted(async () => {
	const { copyFileSync, rmSync } = await import('node:fs');
	const template = process.env.TEST_DB_TEMPLATE;
	if (!template) throw new Error('TEST_DB_TEMPLATE tidak ada (tests/global-setup.ts belum jalan)');
	const rand = Math.random().toString(36).slice(2);
	const file = template.replace('.tmp-template-', `.tmp-orders-${rand}-`);
	for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
	copyFileSync(template, file);
	return { file, uploads: `./tests/.tmp-uploads-orders-${rand}` };
});

vi.mock('$app/env/private', () => ({
	DATABASE_URL: env.file,
	ORIGIN: 'http://localhost:5173',
	CATALOG_REQUIRES_LOGIN: 'false',
	SESSION_DAYS: '30',
	UPLOAD_DIR: env.uploads,
	MAX_UPLOAD_MB: '2',
	CRON_SECRET: 'x'.repeat(32),
	MIDTRANS_SERVER_KEY: undefined,
	MIDTRANS_IS_PRODUCTION: undefined,
	PAYMENT_SIMULATOR: undefined
}));

import { eq } from 'drizzle-orm';
import { db } from './db';
import { passwordResets, sessions, users } from './db/schema';
import { setMailTransport, type Mail } from './mail';
import { setWaTransport } from './wa-gateway';
import { cancelOrder, createOrderFromCart } from './orders';
import {
	completeOrder,
	confirmPayment,
	rejectPayment,
	shipOrder,
	submitPaymentProof
} from './order-flow';
import { isResetTokenValid, requestPasswordReset, resetPasswordWithToken } from './password-reset';
import { hashPassword, verifyPassword } from './auth';
import {
	SHIP,
	adminId,
	buyerId,
	cartAdd,
	kaosId,
	newOrder,
	topiId,
	useOrdersFixture
} from './orders.fixture';

useOrdersFixture();

let outbox: Mail[] = [];
// pengiriman jalan setelah commit & tidak ditunggu pemanggil → beri giliran ke antrean mikrotask
const flush = () => new Promise((r) => setTimeout(r, 15));

beforeEach(() => {
	outbox = [];
	setMailTransport(async (m) => {
		outbox.push(m);
	});
});
afterEach(() => {
	setMailTransport(null);
	setWaTransport(null);
});

const tokenFrom = (m: Mail) => /\/reset-password\/([\w-]+)/.exec(m.text)![1];

describe('notifikasi email pesanan', () => {
	it('pesanan dibuat → email ke pemilik berisi kode, item, total, dan tautan', async () => {
		const { code } = await newOrder(buyerId, kaosId, 2);
		await flush();
		expect(outbox).toHaveLength(1);
		const m = outbox[0];
		expect(m.to).toBe('b@x.id');
		expect(m.subject).toContain(code);
		expect(m.text).toContain('Kaos Classic - L');
		expect(m.text).toContain(`/pesanan/${code}`);
		expect(m.html).toContain('<p>');
	});

	it('transaksi yang gagal (rollback) TIDAK mengirim email', async () => {
		await cartAdd(buyerId, 'product', kaosId, 1);
		await cartAdd(buyerId, 'product', topiId, 1);
		db.$client.prepare('update products set stock = 0 where id = ?').run(topiId);
		await expect(createOrderFromCart(buyerId, SHIP)).rejects.toThrow();
		await flush();
		expect(outbox).toHaveLength(0);
	});

	it('alur lengkap: dibuat → ditolak → dibayar → dikirim; batal → dibatalkan', async () => {
		const { code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await rejectPayment(code, adminId, 'Nominal tidak sesuai');
		await submitPaymentProof(code, buyerId, '/uploads/proofs/b.png');
		await confirmPayment(code, adminId);
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE123456' });
		await flush();
		expect(outbox.map((m) => m.subject.replace(/^\[[^\]]+\] /, ''))).toEqual([
			`Pesanan ${code} diterima, menunggu pembayaran`,
			`Bukti pembayaran pesanan ${code} ditolak`,
			`Pembayaran pesanan ${code} diterima`,
			`Pesanan ${code} sudah dikirim`
		]);
		expect(outbox[1].text).toContain('Nominal tidak sesuai');
		expect(outbox[3].text).toContain('JNE123456');

		outbox.length = 0;
		const second = await newOrder();
		await cancelOrder(
			(await db.query.orders.findFirst({ where: (o, { eq }) => eq(o.code, second.code) }))!.id,
			{ id: buyerId, role: 'konsumen' },
			'Salah pilih ukuran'
		);
		await flush();
		expect(outbox.map((m) => m.subject)).toEqual(
			expect.arrayContaining([expect.stringContaining('dibatalkan')])
		);
	});

	it('pesanan selesai mengirim ajakan memberi ulasan, baik oleh pelanggan maupun sistem', async () => {
		const { code } = await newOrder();
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await shipOrder(code, adminId, { courier: 'JNE', trackingNumber: 'JNE123456' });
		await flush();
		outbox.length = 0;

		await completeOrder(code, { id: buyerId, role: 'konsumen' });
		await flush();
		expect(outbox).toHaveLength(1);
		expect(outbox[0].subject).toContain(`Pesanan ${code} selesai`);
		expect(outbox[0].text).toContain(`/pesanan/${code}#ulasan`);
	});

	it('kegagalan kirim tidak menggagalkan pesanan', async () => {
		setMailTransport(async () => {
			throw new Error('SMTP mati');
		});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { code } = await newOrder();
		await flush();
		expect(code).toBeTruthy();
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
});

describe('notifikasi WhatsApp otomatis', () => {
	let wa: { to: string; text: string }[] = [];
	beforeEach(() => {
		wa = [];
		setWaTransport(async (to, text) => {
			wa.push({ to, text });
		});
	});

	it('pesanan baru → WhatsApp ke penerima DAN ke WhatsApp toko', async () => {
		const { code } = await newOrder();
		await flush();
		const tos = wa.map((m) => m.to).sort();
		expect(tos).toEqual(['6281234567890', '6283867358863'].sort()); // penerima (08.. → 62..) + toko
		const toStore = wa.find((m) => m.to === '6283867358863')!;
		expect(toStore.text).toContain(code);
		expect(toStore.text).toContain(`/admin/pesanan/${code}`);
		const toBuyer = wa.find((m) => m.to === '6281234567890')!;
		expect(toBuyer.text).toContain(`/pesanan/${code}`);
	});

	it('status berikutnya hanya ke pelanggan (tidak membanjiri WhatsApp toko)', async () => {
		const { code } = await newOrder();
		await flush();
		wa.length = 0;
		await submitPaymentProof(code, buyerId, '/uploads/proofs/a.png');
		await confirmPayment(code, adminId);
		await flush();
		expect(wa.map((m) => m.to)).toEqual(['6281234567890']);
		expect(wa[0].text).toContain('Pembayaranmu sudah kami konfirmasi');
	});

	it('WhatsApp gagal tidak mencegah email; email mati tidak mencegah WhatsApp', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		setWaTransport(async () => {
			throw new Error('gateway mati');
		});
		await newOrder();
		await flush();
		expect(outbox).toHaveLength(1);

		setWaTransport(async (to, text) => {
			wa.push({ to, text });
		});
		setMailTransport(null);
		outbox = [];
		await newOrder();
		await flush();
		expect(wa.length).toBeGreaterThan(0);
		expect(outbox).toHaveLength(0);
		err.mockRestore();
	});
});

describe('lupa password pelanggan', () => {
	it('email terdaftar → tautan terkirim; ganti password; sesi lama hilang; tautan sekali pakai', async () => {
		db.insert(sessions)
			.values({ id: 'sess1', userId: buyerId, expiresAt: new Date(Date.now() + 1e6).toISOString() })
			.run();

		expect(await requestPasswordReset(' B@X.id ')).toBe(true);
		await flush();
		expect(outbox).toHaveLength(1);
		const token = tokenFrom(outbox[0]);
		expect(isResetTokenValid(token)).toBe(true);
		// hanya hash yang tersimpan
		expect(db.select().from(passwordResets).get()!.tokenHash).not.toContain(token);

		expect(await resetPasswordWithToken(token, 'PasswordBaru123')).toBe(true);
		const u = db.select().from(users).where(eq(users.id, buyerId)).get()!;
		expect(await verifyPassword(u.passwordHash, 'PasswordBaru123')).toBe(true);
		expect(db.select().from(sessions).where(eq(sessions.userId, buyerId)).all()).toHaveLength(0);

		expect(isResetTokenValid(token)).toBe(false);
		expect(await resetPasswordWithToken(token, 'LainLagi12345')).toBe(false);
	});

	it('email tak dikenal / akun staf / akun nonaktif → tidak ada email', async () => {
		expect(await requestPasswordReset('tidak-ada@x.id')).toBe(false);
		expect(await requestPasswordReset('a@x.id')).toBe(false); // admin
		db.update(users).set({ isActive: false }).where(eq(users.id, buyerId)).run();
		expect(await requestPasswordReset('b@x.id')).toBe(false);
		await flush();
		expect(outbox).toHaveLength(0);
	});

	it('permintaan baru membatalkan tautan lama; tautan kedaluwarsa ditolak', async () => {
		await requestPasswordReset('b@x.id');
		await requestPasswordReset('b@x.id');
		await flush();
		const [first, second] = outbox.map(tokenFrom);
		expect(isResetTokenValid(first)).toBe(false);
		expect(isResetTokenValid(second)).toBe(true);

		db.update(passwordResets)
			.set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
			.run();
		expect(isResetTokenValid(second)).toBe(false);
		expect(await resetPasswordWithToken(second, 'PasswordBaru123')).toBe(false);
	});

	it('tanpa email terkonfigurasi → tidak membuat token', async () => {
		setMailTransport(null);
		expect(await requestPasswordReset('b@x.id')).toBe(false);
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('token acak ditolak dan hash password tidak berubah', async () => {
		const before = db.select().from(users).where(eq(users.id, buyerId)).get()!.passwordHash;
		expect(await resetPasswordWithToken('x'.repeat(43), 'PasswordBaru123')).toBe(false);
		expect(db.select().from(users).where(eq(users.id, buyerId)).get()!.passwordHash).toBe(before);
		expect(await hashPassword('a')).toBeTruthy();
	});
});
