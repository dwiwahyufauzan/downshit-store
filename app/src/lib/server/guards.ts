import { error, redirect } from '@sveltejs/kit';
import type { SessionUser } from '../../app';

export function requireUser(
	locals: App.Locals,
	url?: URL,
	loginPath: '/login' | '/staff/login' = '/login'
): SessionUser {
	if (!locals.user) {
		const next = url ? `?next=${encodeURIComponent(url.pathname + url.search)}` : '';
		redirect(303, `${loginPath}${next}`);
	}
	return locals.user;
}

export function requireRole(
	locals: App.Locals,
	...roles: Array<'owner' | 'admin' | 'konsumen'>
): SessionUser {
	// Halaman khusus staf (tanpa konsumen) mengarah ke portal staf, bukan login pelanggan
	const user = requireUser(
		locals,
		undefined,
		roles.includes('konsumen') ? '/login' : '/staff/login'
	);
	if (!roles.includes(user.role)) {
		error(403, 'Akses ditolak: Anda tidak memiliki izin untuk membuka halaman ini.');
	}
	return user;
}
