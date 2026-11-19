import type { Action } from 'svelte/action';

/**
 * Elemen naik & muncul pelan saat pertama kali masuk layar.
 * Tanpa JS, atau saat pengguna memilih reduce-motion, elemen tampil biasa.
 * Elemen yang sudah terlihat waktu halaman dimuat tidak dianimasikan (hindari kedip).
 */
export const reveal: Action<HTMLElement, { delay?: number } | undefined> = (node, opts) => {
	if (typeof IntersectionObserver === 'undefined') return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	if (node.getBoundingClientRect().top < window.innerHeight * 0.9) return;

	node.dataset.reveal = 'pending';
	if (opts?.delay) node.style.setProperty('--reveal-delay', `${opts.delay}ms`);

	const io = new IntersectionObserver(
		([entry]) => {
			if (!entry.isIntersecting) return;
			node.dataset.reveal = 'in';
			io.disconnect();
		},
		{ threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
	);
	io.observe(node);

	return { destroy: () => io.disconnect() };
};
