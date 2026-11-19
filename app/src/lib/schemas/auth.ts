import { z } from 'zod';

/** Dipakai ulang di registrasi & ganti password (BR-01: minimal 8 karakter, huruf + angka). */
export const passwordSchema = z
	.string()
	.min(8, 'Password minimal 8 karakter')
	.max(128, 'Password maksimal 128 karakter')
	.regex(/[A-Za-z]/, 'Password harus mengandung huruf')
	.regex(/[0-9]/, 'Password harus mengandung angka');

// Kosong/spasi saja = tidak diisi (boleh); selain itu harus nomor Indonesia
const phoneField = z
	.string()
	.trim()
	.refine(
		(v) => v === '' || /^(\+62|62|0)8[0-9]{8,12}$/.test(v),
		'Nomor HP tidak valid (contoh: 081234567890)'
	)
	.optional();

export const registerSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(3, 'Nama minimal 3 karakter')
			.max(100, 'Nama maksimal 100 karakter'),
		email: z
			.string()
			.trim()
			.toLowerCase()
			.email('Format email tidak valid')
			.max(150, 'Email maksimal 150 karakter'),
		phone: phoneField,
		password: passwordSchema,
		confirmPassword: z.string()
	})
	.refine((d) => d.password === d.confirmPassword, {
		message: 'Konfirmasi password tidak cocok',
		path: ['confirmPassword']
	});

export const loginSchema = z.object({
	email: z.string().trim().toLowerCase().email('Format email tidak valid'),
	password: z.string().min(1, 'Password wajib diisi')
});

export const profileSchema = z.object({
	name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(100, 'Nama maksimal 100 karakter'),
	phone: phoneField,
	address: z.string().trim().max(500, 'Alamat maksimal 500 karakter').optional()
});

export const changePasswordSchema = z
	.object({
		currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
		newPassword: passwordSchema,
		confirmPassword: z.string()
	})
	.refine((d) => d.newPassword === d.confirmPassword, {
		message: 'Konfirmasi password baru tidak cocok',
		path: ['confirmPassword']
	})
	.refine((d) => d.newPassword !== d.currentPassword, {
		message: 'Password baru harus berbeda dari password saat ini',
		path: ['newPassword']
	});
