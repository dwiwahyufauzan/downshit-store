import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { error, redirect } from '@sveltejs/kit';
import { CATALOG_REQUIRES_LOGIN, ORIGIN } from '$app/env/private';
import {
	STAFF_SESSION_COOKIE,
	cookieNameOf,
	portalOf,
	portalOfPath,
	validateSession
} from '#lib/server/auth';
import { profilePathFor } from '#lib/server/login';
import { reportError } from '#lib/server/error-report';
import { log } from '#lib/server/logger';

const ADMIN_AREA = /^\/admin(\/|$)/;
const OWNER_AREA = /^\/owner(\/|$)/;
const NEEDS_LOGIN = [
	/^\/keranjang(\/|$)/,
	/^\/checkout(\/|$)/,
	/^\/pesanan(\/|$)/,
	/^\/simulasi-bayar(\/|$)/,
	/^\/profil(\/|$)/,
	/^\/favorit(\/|$)/
];
const CATALOG = [/^\/produk(\/|$)/, /^\/bundling(\/|$)/];
// Path yang tidak butuh sesi → hemat satu query DB per gambar/permintaan (bukti bayar tetap butuh sesi)
const NO_SESSION = [
	/^\/uploads\/(products|bundles)\//,
	/^\/internal\//,
	/^\/api\/midtrans\//,
	/^\/api\/wilayah$/,
	/^\/api\/health$/,
	/^\/api\/client-error$/
];
// Akun yang wajib ganti password (BR-24) hanya boleh membuka halaman ini
const FORCED_CHANGE_ALLOWED = [
	/^\/profil(\/|$)/,
	/^\/logout(\/|$)/,
	/^\/(admin|owner)\/profil(\/|$)/,
	/^\/staff\/logout(\/|$)/,
	/^\/uploads\//,
	/^\/_app\//,
	/^\/favicon/
];

const isHttps = ORIGIN?.startsWith('https') ?? false;

// Tanpa ADDRESS_HEADER, getClientAddress() = IP proxy: SEMUA pengunjung berbagi satu kunci rate limit login/registrasi
if (isHttps && !process.env.ADDRESS_HEADER) {
	console.warn(
		'[config] ORIGIN https tetapi ADDRESS_HEADER kosong: rate limit login memakai IP proxy yang sama untuk semua pengunjung. ' +
			'Isi ADDRESS_HEADER (mis. X-Forwarded-For atau CF-Connecting-IP) dan XFF_DEPTH sesuai proxy Anda.'
	);
}

// Permintaan lebih lambat dari ini dicatat sebagai peringatan
const SLOW_MS = 3000;

export const handle: Handle = async ({ event, resolve }) => {
	// ID permintaan: dari proxy (x-request-id) bila wajar, selain itu acak; ikut ke log & header respons
	const inbound = event.request.headers.get('x-request-id');
	event.locals.requestId =
		inbound && /^[\w.-]{6,64}$/.test(inbound) ? inbound : crypto.randomUUID().slice(0, 12);
	// Cocokkan pada path ter-decode agar `/%61dmin` tidak lolos dari gerbang
	// (SvelteKit mencocokkan route dengan path yang sudah di-decode, event.url.pathname masih mentah).
	let path: string;
	try {
		path = decodeURIComponent(event.url.pathname);
	} catch {
		error(400, 'URL tidak valid');
	}
	path = path.replace(/\/{2,}/g, '/');

	// Pelanggan & staf memakai cookie berbeda → login di satu window tidak menimpa sesi window lain
	const portal = portalOfPath(path);
	const token = event.cookies.get(cookieNameOf(portal));
	const skipSession = NO_SESSION.some((r) => r.test(path));
	let sessionUser = token && !skipSession ? await validateSession(token) : null;
	// Cookie portal ini hanya sah untuk role portalnya (mencegah cookie tertukar)
	if (sessionUser && portalOf(sessionUser.role) !== portal) sessionUser = null;
	event.locals.user = sessionUser;
	event.locals.sessionId = sessionUser ? (token ?? null) : null;

	const user = event.locals.user;
	const isStaffArea = portal === 'staff';
	// Portal terpisah: area staf → /staff/login, halaman pelanggan → /login
	const toLogin = () =>
		redirect(
			303,
			`${isStaffArea ? '/staff/login' : '/login'}?next=${encodeURIComponent(event.url.pathname + event.url.search)}`
		);

	const needsLogin =
		ADMIN_AREA.test(path) || OWNER_AREA.test(path) || NEEDS_LOGIN.some((r) => r.test(path));
	if (!user && needsLogin) toLogin();
	if (!user && CATALOG_REQUIRES_LOGIN === 'true' && CATALOG.some((r) => r.test(path))) {
		// Staf (cookie terpisah) tetap boleh melihat katalog, mis. membuka produk dari halaman admin
		const staffToken = event.cookies.get(STAFF_SESSION_COOKIE);
		const staff = staffToken ? await validateSession(staffToken) : null;
		if (!staff || portalOf(staff.role) !== 'staff') toLogin();
	}

	// Gerbang role (lapis pertama; setiap load/action tetap memanggil requireRole)
	if (user && ADMIN_AREA.test(path) && user.role !== 'admin') {
		error(403, 'Akses ditolak: halaman ini khusus Admin.');
	}
	if (user && OWNER_AREA.test(path) && user.role !== 'owner') {
		error(403, 'Akses ditolak: halaman ini khusus Owner.');
	}

	// BR-24: password sementara/default harus diganti sebelum memakai fitur lain
	if (user?.mustChangePassword && !FORCED_CHANGE_ALLOWED.some((r) => r.test(path))) {
		redirect(303, `${profilePathFor(user.role)}?wajib=1`);
	}

	const started = Date.now();
	const response = await resolve(event);
	response.headers.set('x-request-id', event.locals.requestId);
	const ms = Date.now() - started;
	if (response.status >= 500 || ms > SLOW_MS) {
		// galat tak terduga sudah dilaporkan handleError; ini mencatat respons 5xx lain dan permintaan lambat
		log[response.status >= 500 ? 'error' : 'warn'](
			response.status >= 500 ? 'respons 5xx' : 'permintaan lambat',
			{
				requestId: event.locals.requestId,
				method: event.request.method,
				path,
				status: response.status,
				ms
			}
		);
	}

	// Header keamanan dasar (CSP diatur di vite.config.ts → sveltekit({ csp }))
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	// Halaman untuk pengguna login jangan di-cache: tombol Back setelah logout tidak boleh
	// menampilkan halaman terproteksi (TC-001-09)
	if ((token || user) && response.headers.get('content-type')?.includes('text/html')) {
		response.headers.set('Cache-Control', 'private, no-store');
	}
	if (isHttps) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return response;
};

// Pesan bawaan framework (Inggris, mis. 404 "Not Found") diganti ke bahasa Indonesia
const GENERIC: Record<number, string> = {
	400: 'Permintaan tidak valid.',
	401: 'Silakan masuk terlebih dahulu.',
	403: 'Akses ditolak.',
	404: 'Halaman yang kamu cari tidak ditemukan.',
	405: 'Metode permintaan tidak diizinkan.',
	413: 'Berkas atau data yang dikirim terlalu besar.',
	429: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.'
};

/**
 * Di SvelteKit 3 hook ini dipanggil untuk SEMUA error (kecuali redirect):
 * - `app`       : dilempar lewat error(status, ...) → pesan sudah ramah, dibiarkan apa adanya
 * - `framework` : dibuat SvelteKit (404 route tak ada, 403 CSRF, 413, ...) → pesan dilokalkan
 * - `unknown`   : bug/kegagalan tak terduga → pesan generik + ID, detail HANYA di log server
 */
export const handleError: HandleServerError = (input) => {
	const { event } = input;
	if (input.kind === 'app') {
		return;
	}
	if (input.kind === 'framework' || input.kind === 'validation') {
		const status = input.error.status;
		if (status < 500) return { message: GENERIC[status] ?? 'Permintaan tidak dapat diproses.' };
	}

	// ID permintaan dicatat di log & Sentry dan ditampilkan ke pengguna agar laporan mudah dilacak
	const code = event.locals.requestId ?? crypto.randomUUID().slice(0, 12);
	const status =
		input.kind === 'framework' || input.kind === 'validation' ? input.error.status : 500;
	void reportError(input.error, {
		requestId: code,
		method: event.request.method,
		path: event.url.pathname,
		status,
		userId: event.locals.user?.id
	});
	return { message: 'Terjadi kendala pada server. Silakan coba lagi nanti.', code };
};
