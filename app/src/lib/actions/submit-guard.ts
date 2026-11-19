/**
 * Umpan balik & pencegah klik ganda untuk form POST biasa (tanpa `use:enhance`).
 *
 * Setelah form dikirim, tombol dinonaktifkan dan tombol pengirim menampilkan "Memproses…" sampai halaman
 * berpindah. Form yang sudah ditangani `use:enhance` (event-nya di-`preventDefault`) dilewati: mereka punya
 * status memproses sendiri. Pengiriman kedua pada form yang masih diproses dibatalkan.
 *
 * Isi tombol TIDAK diubah lewat innerHTML: node aslinya disimpan lalu dipasang kembali, sehingga referensi
 * teks reaktif Svelte tetap utuh bila halaman ternyata tidak berpindah (jaringan putus, bfcache, dsb.).
 */
export const PENDING_LABEL = 'Memproses…';
/** Jaring pengaman: bila halaman tak kunjung berpindah, tombol dibuka lagi setelah selang ini */
export const RELEASE_AFTER_MS = 30_000;

type Locked = { release: () => void };
const locked = new Map<HTMLFormElement, Locked>();

/** Hanya form POST yang berpindah halaman di tab ini yang dijaga. */
export function shouldGuard(form: HTMLFormElement): boolean {
	if (form.method.toLowerCase() !== 'post') return false;
	if (form.dataset.noPending !== undefined) return false;
	const target = form.target;
	return !target || target === '_self';
}

function lock(form: HTMLFormElement, submitter: HTMLElement | null) {
	if (locked.has(form)) return;
	const restores: (() => void)[] = [];

	const buttons = Array.from(form.elements).filter(
		(el): el is HTMLButtonElement | HTMLInputElement =>
			(el instanceof HTMLButtonElement && el.type === 'submit') ||
			(el instanceof HTMLInputElement && el.type === 'submit')
	);
	// Tombol di luar <form> tetapi terhubung lewat atribut form="id" sudah ada di form.elements.
	if (submitter && !buttons.includes(submitter as HTMLButtonElement)) {
		if (submitter instanceof HTMLButtonElement) buttons.push(submitter);
	}

	for (const btn of buttons) {
		const wasDisabled = btn.disabled;
		btn.disabled = true;
		restores.push(() => {
			btn.disabled = wasDisabled;
		});

		if (btn === submitter && btn instanceof HTMLButtonElement) {
			const original = Array.from(btn.childNodes);
			// Tombol ikon saja (tanpa teks, mis. tempat sampah) hanya diberi spinner: label akan meluap dari tombolnya
			const iconOnly = (btn.textContent ?? '').trim() === '';
			const spinner = document.createElement('span');
			spinner.className = 'spinner';
			spinner.setAttribute('aria-hidden', 'true');

			// Kunci lebar agar tombol tidak "melompat" saat label berganti
			const prevMinWidth = btn.style.minWidth;
			if (btn.offsetWidth > 0) btn.style.minWidth = `${btn.offsetWidth}px`;

			btn.replaceChildren(
				...(iconOnly
					? [spinner]
					: [spinner, document.createTextNode(btn.dataset.pendingLabel || PENDING_LABEL)])
			);
			restores.push(() => {
				btn.replaceChildren(...original);
				btn.style.minWidth = prevMinWidth;
			});
		}
	}

	form.setAttribute('aria-busy', 'true');
	restores.push(() => form.removeAttribute('aria-busy'));

	const timer = setTimeout(() => entry.release(), RELEASE_AFTER_MS);
	const entry: Locked = {
		release() {
			clearTimeout(timer);
			for (const r of restores.reverse()) r();
			locked.delete(form);
		}
	};
	locked.set(form, entry);
}

/** Pasang di `<svelte:document onsubmit={onSubmit}>`. */
export function onSubmit(e: SubmitEvent) {
	// Sudah ditangani use:enhance / handler lain → bukan urusan kita
	if (e.defaultPrevented) return;
	const form = e.target;
	if (!(form instanceof HTMLFormElement) || !shouldGuard(form)) return;

	if (locked.has(form)) {
		e.preventDefault(); // klik ganda saat permintaan pertama masih berjalan
		return;
	}

	// Ditunda: data form dibentuk browser SETELAH event ini; menonaktifkan tombol pengirim sekarang
	// akan membuat name/value-nya tidak ikut terkirim.
	const submitter = e.submitter;
	setTimeout(() => lock(form, submitter), 0);
}

/** Buka semua tombol (mis. saat halaman dipulihkan dari bfcache lewat tombol Kembali). */
export function releaseAll() {
	for (const l of [...locked.values()]) l.release();
}

export function onPageShow(e: PageTransitionEvent) {
	if (e.persisted) releaseAll();
}
