/**
 * Notifikasi singkat (toast) yang hilang sendiri.
 *
 * Hanya berjalan di browser: modul ini dipakai bersama oleh semua permintaan di server (SSR), jadi
 * `push` sengaja tidak melakukan apa pun di sana agar toast satu pengguna tidak bocor ke pengguna lain.
 */
export type ToastKind = 'success' | 'error' | 'info';
export type ToastAction = { href: string; label: string };
export type Toast = {
	id: number;
	kind: ToastKind;
	message: string;
	action?: ToastAction;
	duration: number;
};

/** Toast terlama dibuang bila lebih dari ini tampil bersamaan */
export const MAX_TOASTS = 3;
const DURATION: Record<ToastKind, number> = { success: 5000, info: 5000, error: 8000 };

export const toasts: Toast[] = $state([]);

type Timer = { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number };
// Pencatat timer murni (tidak dibaca oleh template), jadi sengaja bukan SvelteMap
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const timers = new Map<number, Timer>();
let seq = 0;

const inBrowser = () => typeof window !== 'undefined';

function start(id: number, ms: number) {
	const handle = setTimeout(() => dismiss(id), ms);
	timers.set(id, { handle, remaining: ms, startedAt: Date.now() });
}

export function dismiss(id: number) {
	const t = timers.get(id);
	if (t?.handle) clearTimeout(t.handle);
	timers.delete(id);
	const i = toasts.findIndex((x) => x.id === id);
	if (i >= 0) toasts.splice(i, 1);
}

/** Tahan hitung mundur selama kursor/fokus berada di toast (WCAG 2.2.1: waktu baca cukup). */
export function pause(id: number) {
	const t = timers.get(id);
	if (!t?.handle) return;
	clearTimeout(t.handle);
	t.handle = null;
	t.remaining = Math.max(1000, t.remaining - (Date.now() - t.startedAt));
}

export function resume(id: number) {
	const t = timers.get(id);
	if (!t || t.handle) return;
	start(id, t.remaining);
}

export function push(
	kind: ToastKind,
	message: string,
	opts: { action?: ToastAction; duration?: number } = {}
): number | null {
	if (!inBrowser() || !message) return null;

	// Pesan yang sama masih tampil → perpanjang saja, jangan menumpuk
	const dup = toasts.find((x) => x.kind === kind && x.message === message);
	if (dup) {
		const t = timers.get(dup.id);
		if (t?.handle) clearTimeout(t.handle);
		start(dup.id, dup.duration);
		return dup.id;
	}

	const id = ++seq;
	const duration = opts.duration ?? DURATION[kind];
	toasts.push({ id, kind, message, action: opts.action, duration });
	while (toasts.length > MAX_TOASTS) dismiss(toasts[0].id);
	start(id, duration);
	return id;
}

export const toast = {
	success: (message: string, opts?: { action?: ToastAction; duration?: number }) =>
		push('success', message, opts),
	error: (message: string, opts?: { action?: ToastAction; duration?: number }) =>
		push('error', message, opts),
	info: (message: string, opts?: { action?: ToastAction; duration?: number }) =>
		push('info', message, opts)
};

/** Hanya untuk tes: kosongkan semua toast & timer. */
export function resetToasts() {
	for (const t of timers.values()) if (t.handle) clearTimeout(t.handle);
	timers.clear();
	toasts.splice(0, toasts.length);
}

/* ---------- Dari hasil form action ---------- */

const GENERIC_SUCCESS = 'Perubahan berhasil disimpan.';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Ubah hasil `form` SvelteKit menjadi toast sukses. Mengembalikan null bila bukan sukses.
 * Server boleh menyertakan `toastAction: { href, label }` (mis. tautan "Lihat keranjang");
 * hanya path internal (diawali "/", bukan "//") yang diterima.
 * Pesan GAGAL sengaja tidak dijadikan toast: tetap tampil di halaman agar bisa dibaca sambil memperbaiki isian.
 */
export function toastFromForm(
	form: unknown
): { kind: 'success'; message: string; action?: ToastAction } | null {
	if (!isRecord(form) || form.success !== true) return null;

	const message =
		typeof form.message === 'string' && form.message.trim() ? form.message : GENERIC_SUCCESS;

	let action: ToastAction | undefined;
	const a = form.toastAction;
	if (
		isRecord(a) &&
		typeof a.href === 'string' &&
		typeof a.label === 'string' &&
		a.href.startsWith('/') &&
		!a.href.startsWith('//') &&
		a.label.trim()
	) {
		action = { href: a.href, label: a.label };
	}
	return { kind: 'success', message, action };
}
