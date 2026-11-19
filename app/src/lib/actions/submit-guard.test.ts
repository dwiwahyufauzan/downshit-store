// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PENDING_LABEL,
	RELEASE_AFTER_MS,
	onPageShow,
	onSubmit,
	releaseAll,
	shouldGuard
} from './submit-guard';

function setup(html: string) {
	document.body.innerHTML = html;
	return document.querySelector('form') as HTMLFormElement;
}

/** Kirim event submit seperti browser: bubbles + cancelable + submitter. */
function submit(
	form: HTMLFormElement,
	submitter?: HTMLElement | null,
	pre?: (e: SubmitEvent) => void
) {
	const e = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter });
	pre?.(e);
	form.dispatchEvent(e);
	onSubmit(e); // dipasang di document pada aplikasi; dipanggil langsung agar urutan deterministik
	return e;
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	releaseAll();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('shouldGuard', () => {
	it('hanya form POST di tab yang sama', () => {
		expect(shouldGuard(setup('<form method="POST"></form>'))).toBe(true);
		expect(shouldGuard(setup('<form method="post" target="_self"></form>'))).toBe(true);
		expect(shouldGuard(setup('<form method="GET"></form>'))).toBe(false);
		expect(shouldGuard(setup('<form></form>'))).toBe(false); // bawaan HTML = GET
		expect(shouldGuard(setup('<form method="POST" target="_blank"></form>'))).toBe(false);
		expect(shouldGuard(setup('<form method="POST" data-no-pending></form>'))).toBe(false);
	});
});

describe('onSubmit', () => {
	const FORM = `<form method="POST" action="?/tambah">
		<input name="qty" value="1" />
		<button type="button" id="plus">+</button>
		<button type="submit" id="go"><svg id="icon"></svg>Tambah ke keranjang</button>
		<button type="submit" id="other">Lainnya</button>
	</form>`;

	it('menonaktifkan tombol submit SETELAH data form terbentuk, bukan saat event berlangsung', () => {
		const form = setup(FORM);
		const go = document.getElementById('go') as HTMLButtonElement;
		submit(form, go);

		// belum: browser masih membentuk data form (tombol pengirim harus tetap aktif agar name/value ikut)
		expect(go.disabled).toBe(false);
		vi.advanceTimersByTime(0);
		expect(go.disabled).toBe(true);
		expect((document.getElementById('other') as HTMLButtonElement).disabled).toBe(true);
		expect((document.getElementById('plus') as HTMLButtonElement).disabled).toBe(false); // type=button
		expect(form.getAttribute('aria-busy')).toBe('true');
	});

	it('tombol pengirim berubah jadi "Memproses…" dengan spinner; tombol lain tetap', () => {
		const form = setup(FORM);
		const go = document.getElementById('go') as HTMLButtonElement;
		submit(form, go);
		vi.advanceTimersByTime(0);

		expect(go.textContent).toBe(PENDING_LABEL);
		expect(go.querySelector('.spinner')).not.toBeNull();
		expect(document.getElementById('other')!.textContent).toBe('Lainnya');
	});

	it('tombol ikon saja (tanpa teks) hanya diberi spinner, bukan label yang meluap', () => {
		const form = setup(
			'<form method="POST"><button type="submit" id="b" aria-label="Hapus item"><svg id="ico"></svg></button></form>'
		);
		const b = document.getElementById('b') as HTMLButtonElement;
		submit(form, b);
		vi.advanceTimersByTime(0);
		expect(b.textContent).toBe('');
		expect(b.querySelector('.spinner')).not.toBeNull();
		expect(b.getAttribute('aria-label')).toBe('Hapus item'); // nama aksesibel tetap ada
		releaseAll();
		expect(document.getElementById('ico')).not.toBeNull();
		expect(b.querySelector('.spinner')).toBeNull();
	});

	it('label kustom lewat data-pending-label', () => {
		const form = setup(
			'<form method="POST"><button type="submit" id="b" data-pending-label="Mengunggah…">Kirim</button></form>'
		);
		const b = document.getElementById('b')!;
		submit(form, b);
		vi.advanceTimersByTime(0);
		expect(b.textContent).toBe('Mengunggah…');
	});

	it('pengiriman kedua saat masih diproses dibatalkan (anti klik ganda)', () => {
		const form = setup(FORM);
		submit(form, document.getElementById('go'));
		vi.advanceTimersByTime(0);

		const second = submit(form, document.getElementById('go'));
		expect(second.defaultPrevented).toBe(true);
	});

	it('Enter di kolom teks (submitter = null) tetap mengunci form', () => {
		const form = setup(FORM);
		submit(form, null);
		vi.advanceTimersByTime(0);
		expect((document.getElementById('go') as HTMLButtonElement).disabled).toBe(true);
		// tanpa pengirim jelas, teks tombol tidak diganti
		expect(document.getElementById('go')!.textContent).toContain('Tambah ke keranjang');
	});

	it('melewati event yang sudah di-preventDefault (use:enhance)', () => {
		const form = setup(FORM);
		form.addEventListener('submit', (e) => e.preventDefault()); // seperti handler use:enhance
		const go = document.getElementById('go') as HTMLButtonElement;
		submit(form, go);
		vi.advanceTimersByTime(0);
		expect(go.disabled).toBe(false);
		expect(go.textContent).toContain('Tambah ke keranjang');
	});

	it('melewati form GET dan target lain', () => {
		const form = setup('<form method="GET"><button type="submit" id="b">Cari</button></form>');
		submit(form, document.getElementById('b'));
		vi.advanceTimersByTime(0);
		expect((document.getElementById('b') as HTMLButtonElement).disabled).toBe(false);
	});

	it('jaring pengaman: tombol dibuka lagi bila halaman tak berpindah', () => {
		const form = setup(FORM);
		const go = document.getElementById('go') as HTMLButtonElement;
		submit(form, go);
		vi.advanceTimersByTime(RELEASE_AFTER_MS);

		expect(go.disabled).toBe(false);
		expect(go.textContent).toContain('Tambah ke keranjang');
		expect(form.hasAttribute('aria-busy')).toBe(false);
	});

	it('pemulihan memakai node ASLI (referensi reaktif Svelte tidak putus) dan mengembalikan status disabled awal', () => {
		const form = setup(`<form method="POST">
			<button type="submit" id="go"><svg id="icon"></svg><span id="t">Bayar</span></button>
			<button type="submit" id="off" disabled>Nonaktif sejak awal</button>
		</form>`);
		const icon = document.getElementById('icon');
		const t = document.getElementById('t');
		const go = document.getElementById('go') as HTMLButtonElement;
		submit(form, go);
		vi.advanceTimersByTime(0);
		releaseAll();

		expect(document.getElementById('icon')).toBe(icon);
		expect(document.getElementById('t')).toBe(t);
		expect(go.disabled).toBe(false);
		expect((document.getElementById('off') as HTMLButtonElement).disabled).toBe(true);
		// setelah dibuka, form dapat dikirim lagi
		const again = submit(form, go);
		expect(again.defaultPrevented).toBe(false);
	});

	it('pageshow dari bfcache (Kembali) membuka semua tombol; pageshow biasa tidak', () => {
		const form = setup(FORM);
		const go = document.getElementById('go') as HTMLButtonElement;
		submit(form, go);
		vi.advanceTimersByTime(0);

		onPageShow({ persisted: false } as PageTransitionEvent);
		expect(go.disabled).toBe(true);
		onPageShow({ persisted: true } as PageTransitionEvent);
		expect(go.disabled).toBe(false);
	});
});
