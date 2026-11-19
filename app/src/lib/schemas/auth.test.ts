import { describe, expect, it } from 'vitest';
import {
	changePasswordSchema,
	loginSchema,
	passwordSchema,
	profileSchema,
	registerSchema
} from './auth';

describe('Validasi Autentikasi Zod (SRS-F-001 & SRS-F-002)', () => {
	it('menerima pendaftaran yang valid dan menormalkan email', () => {
		const result = registerSchema.safeParse({
			name: 'Adrias Raihan',
			email: 'Adrias@Downshit.LOCAL',
			phone: '081234567890',
			password: 'password123',
			confirmPassword: 'password123'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.email).toBe('adrias@downshit.local');
		}
	});

	it('menolak password yang kurang dari 8 karakter', () => {
		const result = registerSchema.safeParse({
			name: 'Adrias',
			email: 'adrias@gmail.com',
			password: 'pass1',
			confirmPassword: 'pass1'
		});

		expect(result.success).toBe(false);
	});

	it('menolak jika konfirmasi password tidak sama', () => {
		const result = registerSchema.safeParse({
			name: 'Adrias',
			email: 'adrias@gmail.com',
			password: 'password123',
			confirmPassword: 'different123'
		});

		expect(result.success).toBe(false);
	});

	it('memvalidasi format login', () => {
		expect(loginSchema.safeParse({ email: 'invalid', password: '123' }).success).toBe(false);
		expect(loginSchema.safeParse({ email: 'user@downshit.local', password: '123' }).success).toBe(
			true
		);
	});
});

describe('passwordSchema (BR-01, TC-002-04, TC-015-05)', () => {
	it.each([
		['abc123', 'minimal 8'],
		['abcdefgh', 'angka'],
		['12345678', 'huruf'],
		['a'.repeat(129) + '1', 'maksimal 128']
	])('menolak %s', (pw, msg) => {
		const r = passwordSchema.safeParse(pw);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.issues.map((i) => i.message).join()).toContain(msg);
	});
	it('menerima huruf + angka >= 8 karakter', () => {
		expect(passwordSchema.safeParse('Abcdefg1').success).toBe(true);
		expect(passwordSchema.safeParse('Ganti-Password-123!').success).toBe(true);
	});
});

describe('registerSchema: field & role', () => {
	const base = {
		name: 'Budi Santoso',
		email: 'budi@x.id',
		password: 'Rahasia123',
		confirmPassword: 'Rahasia123'
	};
	it('mengabaikan field role dari klien (BR-02) dan field tak dikenal', () => {
		const r = registerSchema.safeParse({ ...base, role: 'admin', isActive: 'x' });
		expect(r.success).toBe(true);
		if (r.success) expect('role' in r.data).toBe(false);
	});
	it('nama < 3 karakter ditolak; HP kosong boleh; HP salah ditolak', () => {
		expect(registerSchema.safeParse({ ...base, name: 'Ab' }).success).toBe(false);
		expect(registerSchema.safeParse({ ...base, phone: '' }).success).toBe(true);
		expect(registerSchema.safeParse({ ...base, phone: '   ' }).success).toBe(true);
		expect(registerSchema.safeParse({ ...base, phone: '081234567890' }).success).toBe(true);
		expect(registerSchema.safeParse({ ...base, phone: '+628123456789' }).success).toBe(true);
		expect(registerSchema.safeParse({ ...base, phone: '123' }).success).toBe(false);
	});
	it('konfirmasi password beda → error di confirmPassword', () => {
		const r = registerSchema.safeParse({ ...base, confirmPassword: 'lain12345' });
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.flatten().fieldErrors.confirmPassword).toBeTruthy();
	});
});

describe('profileSchema (TC-015-02)', () => {
	it('menerima data valid dan HP/alamat kosong', () => {
		expect(profileSchema.safeParse({ name: 'Budi', phone: '', address: '' }).success).toBe(true);
		expect(
			profileSchema.safeParse({ name: 'Budi', phone: '081234567890', address: 'Jl. A No. 1' })
				.success
		).toBe(true);
	});
	it('menolak nama kosong/pendek, HP 123, alamat > 500 karakter', () => {
		expect(profileSchema.safeParse({ name: '' }).success).toBe(false);
		expect(profileSchema.safeParse({ name: 'Bu' }).success).toBe(false);
		expect(profileSchema.safeParse({ name: 'Budi', phone: '123' }).success).toBe(false);
		expect(profileSchema.safeParse({ name: 'Budi', address: 'x'.repeat(501) }).success).toBe(false);
	});
});

describe('changePasswordSchema (TC-015-03/05/06)', () => {
	const ok = {
		currentPassword: 'Lama12345',
		newPassword: 'Baru12345',
		confirmPassword: 'Baru12345'
	};
	it('menerima kombinasi valid', () =>
		expect(changePasswordSchema.safeParse(ok).success).toBe(true));
	it('menolak password baru lemah', () => {
		for (const w of ['abc', 'abcdefgh']) {
			expect(
				changePasswordSchema.safeParse({ ...ok, newPassword: w, confirmPassword: w }).success
			).toBe(false);
		}
	});
	it('menolak konfirmasi beda dan password baru sama dengan lama', () => {
		expect(changePasswordSchema.safeParse({ ...ok, confirmPassword: 'Lain12345' }).success).toBe(
			false
		);
		const same = changePasswordSchema.safeParse({
			currentPassword: 'Sama12345',
			newPassword: 'Sama12345',
			confirmPassword: 'Sama12345'
		});
		expect(same.success).toBe(false);
	});
	it('password lama wajib', () => {
		expect(changePasswordSchema.safeParse({ ...ok, currentPassword: '' }).success).toBe(false);
	});
});
