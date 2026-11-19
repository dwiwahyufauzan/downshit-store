import { error, redirect } from '@sveltejs/kit';
import type { SessionUser } from '../../app';

export function requireUser(locals: App.Locals, url?: URL): SessionUser {
	if (!locals.user) {
		const next = url ? `?next=${encodeURIComponent(url.pathname + url.search)}` : '';
		redirect(303, `/login${next}`);
	}
	return locals.user;
}

export function requireRole(
	locals: App.Locals,
	...roles: Array<'owner' | 'admin' | 'konsumen'>
): SessionUser {
	const user = requireUser(locals);
	if (!roles.includes(user.role)) {
		error(403, 'Akses ditolak: Anda tidak memiliki izin untuk membuka halaman ini.');
	}
	return user;
}
