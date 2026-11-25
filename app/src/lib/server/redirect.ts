/**
 * Validasi tujuan redirect setelah login (?next=). Hanya path internal yang diterima.
 * Menolak: `//host`, `/\host` (browser menganggap `\` = `/`), skema asing (`javascript:`, `https:`),
 * karakter kontrol/tab (dibuang parser URL sehingga `/\t/evil.com` menjadi `//evil.com`),
 * loop ke halaman autentikasi, dan hasil normalisasi yang berubah menjadi `//host`
 * (mis. `/.//evil.com` → pathname `//evil.com`).
 */
const AUTH_PAGE = /^\/(login|register|logout|staff\/(?:login|logout))(\/|\?|#|$)/;

export function safeNext(next: string | null | undefined, fallback: string): string {
	if (!next) return fallback;
	if (!next.startsWith('/') || next.startsWith('//')) return fallback;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
	if (AUTH_PAGE.test(next)) return fallback;
	try {
		const u = new URL(next, 'http://internal.invalid');
		if (u.origin !== 'http://internal.invalid') return fallback;
		const out = u.pathname + u.search + u.hash;
		// Cek ULANG setelah normalisasi
		if (!out.startsWith('/') || out.startsWith('//') || AUTH_PAGE.test(out)) return fallback;
		return out;
	} catch {
		return fallback;
	}
}
