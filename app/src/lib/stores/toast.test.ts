// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_TOASTS,
	dismiss,
	pause,
	push,
	resetToasts,
	resume,
	toast,
	toastFromForm,
	toasts
} from './toast.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	resetToasts();
});
afterEach(() => {
	resetToasts();
	vi.useRealTimers();
});

describe('toast store', () => {
	it('menambah toast dan menghilangkannya setelah durasi (sukses 5 dtk, error 8 dtk)', () => {
		toast.success('Tersimpan');
		toast.error('Gagal');
		expect(toasts.map((t) => t.kind)).toEqual(['success', 'error']);

		vi.advanceTimersByTime(4999);
		expect(toasts).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(toasts.map((t) => t.kind)).toEqual(['error']);
		vi.advanceTimersByTime(3000);
		expect(toasts).toHaveLength(0);
	});

	it('pesan sama tidak menumpuk, tetapi memperpanjang waktu tampil', () => {
		toast.success('Ditambahkan');
		vi.advanceTimersByTime(4000);
		toast.success('Ditambahkan');
		expect(toasts).toHaveLength(1);
		vi.advanceTimersByTime(4000); // total 8 dtk sejak toast pertama, tetapi baru 4 dtk sejak diperpanjang
		expect(toasts).toHaveLength(1);
		vi.advanceTimersByTime(1000);
		expect(toasts).toHaveLength(0);
	});

	it('maksimal MAX_TOASTS tampil bersamaan: yang terlama dibuang', () => {
		for (let i = 0; i < MAX_TOASTS + 2; i++) toast.info(`pesan ${i}`);
		expect(toasts).toHaveLength(MAX_TOASTS);
		expect(toasts[0].message).toBe('pesan 2');
	});

	it('dismiss manual membatalkan timer-nya', () => {
		const id = push('success', 'A')!;
		dismiss(id);
		expect(toasts).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('pause menahan hitung mundur dan resume melanjutkan sisa waktunya', () => {
		const id = push('success', 'Baca dulu')!;
		vi.advanceTimersByTime(3000);
		pause(id);
		vi.advanceTimersByTime(60_000);
		expect(toasts).toHaveLength(1);
		resume(id);
		vi.advanceTimersByTime(1999);
		expect(toasts).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(toasts).toHaveLength(0);
	});

	it('pause tidak membuat sisa waktu kurang dari 1 dtk', () => {
		const id = push('success', 'Hampir habis')!;
		vi.advanceTimersByTime(4900);
		pause(id);
		resume(id);
		vi.advanceTimersByTime(999);
		expect(toasts).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(toasts).toHaveLength(0);
	});

	it('pesan kosong diabaikan', () => {
		expect(push('success', '')).toBeNull();
		expect(toasts).toHaveLength(0);
	});

	it('tidak melakukan apa pun di server (tanpa window)', () => {
		vi.stubGlobal('window', undefined);
		expect(push('success', 'rahasia pengguna A')).toBeNull();
		vi.unstubAllGlobals();
		expect(toasts).toHaveLength(0);
	});
});

describe('toastFromForm', () => {
	it('sukses dengan pesan → toast sukses', () => {
		expect(toastFromForm({ success: true, message: 'Tersimpan' })).toEqual({
			kind: 'success',
			message: 'Tersimpan',
			action: undefined
		});
	});

	it('sukses tanpa pesan / pesan kosong → pesan umum', () => {
		expect(toastFromForm({ success: true })?.message).toBe('Perubahan berhasil disimpan.');
		expect(toastFromForm({ success: true, message: '   ' })?.message).toBe(
			'Perubahan berhasil disimpan.'
		);
	});

	it('bukan sukses (gagal / null / bukan objek) → null; gagal tetap tampil inline', () => {
		expect(toastFromForm({ message: 'Stok kurang' })).toBeNull();
		expect(toastFromForm({ success: false, message: 'x' })).toBeNull();
		expect(toastFromForm({ success: 'true' })).toBeNull();
		expect(toastFromForm(null)).toBeNull();
		expect(toastFromForm(undefined)).toBeNull();
		expect(toastFromForm('success')).toBeNull();
	});

	it('menerima toastAction hanya untuk path internal', () => {
		const ok = toastFromForm({
			success: true,
			message: 'm',
			toastAction: { href: '/keranjang', label: 'Lihat keranjang' }
		});
		expect(ok?.action).toEqual({ href: '/keranjang', label: 'Lihat keranjang' });

		for (const href of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '']) {
			expect(
				toastFromForm({ success: true, message: 'm', toastAction: { href, label: 'Klik' } })?.action
			).toBeUndefined();
		}
		expect(
			toastFromForm({ success: true, message: 'm', toastAction: { href: '/x', label: ' ' } })
				?.action
		).toBeUndefined();
		expect(
			toastFromForm({ success: true, message: 'm', toastAction: { href: 5, label: 'x' } })?.action
		).toBeUndefined();
	});
});
