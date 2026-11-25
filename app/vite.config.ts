import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ mode }) => {
	// ORIGIN https → produksi di belakang TLS: paksa sub-resource ikut https
	const origin = process.env.ORIGIN ?? loadEnv(mode, process.cwd(), '').ORIGIN ?? '';
	const https = origin.startsWith('https');
	// Wildcard tunnel Cloudflare hanya untuk dev/demo: bila ORIGIN adalah domain asli (https bukan trycloudflare),
	// jangan percayai form lintas-origin dari tunnel milik siapa pun. Tambahan lewat CSRF_TRUSTED_ORIGINS (koma).
	const tunnelDemo = !https || /\.trycloudflare\.com/.test(origin);
	const extraOrigins = (
		process.env.CSRF_TRUSTED_ORIGINS ??
		loadEnv(mode, process.cwd(), '').CSRF_TRUSTED_ORIGINS ??
		''
	)
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);

	return {
		server: {
			allowedHosts: true
		},
		preview: {
			allowedHosts: true
		},
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				// SvelteKit 3 tidak lagi menyediakan alias $lib: pakai subpath imports `#lib/*` (lihat "imports" di package.json)
				// CSRF: izinkan form submission via Quick Tunnel Cloudflare (trycloudflare.com) hanya untuk dev/demo
				csrf: {
					trustedOrigins: [...(tunnelDemo ? ['https://*.trycloudflare.com'] : []), ...extraOrigins]
				},
				// CSP (SRS-NF-004): SvelteKit menambahkan nonce/hash otomatis untuk skrip & gaya bawaannya.
				// JANGAN pakai `reportOnly` tanpa `report-uri` — SvelteKit melempar error dan semua halaman jadi 500.
				csp: {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'], // Svelte memakai atribut style inline
						'img-src': ['self', 'data:', 'blob:', 'https:'], // blob: untuk pratinjau unggahan, https: untuk dummy link / CDN
						'media-src': ['self', 'data:', 'blob:', 'https:'], // video latar belakang & konten media eksternal
						'font-src': ['self'],
						'frame-src': ['https://www.google.com'], // embed Google Maps di beranda
						'connect-src': ['self', 'https:'], // izin connect untuk HLS video chunks streaming
						// Midtrans: setelah form checkout, server mengalihkan (303) ke halaman bayar Snap
						'form-action': ['self', 'https://app.midtrans.com', 'https://app.sandbox.midtrans.com'],
						'base-uri': ['self'],
						'frame-ancestors': ['none'],
						'object-src': ['none'],
						...(https ? { 'upgrade-insecure-requests': true } : {})
					}
				}
			})
		],
		test: {
			expect: { requireAssertions: true },
			// unit = logika murni; integration = tes yang memakai DB SQLite sementara (nama *.int.test.ts atau
			// integration*.test.ts). `npm test` / `npm run test:all` menjalankan keduanya.
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'unit',
						environment: 'node',
						globalSetup: ['tests/global-setup.ts'],
						setupFiles: ['tests/setup.ts'],
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: [
							'src/**/*.svelte.{test,spec}.{js,ts}',
							'src/**/*.int.test.ts',
							'src/**/integration*.test.ts'
						]
					}
				},
				{
					extends: './vite.config.ts',
					test: {
						name: 'integration',
						environment: 'node',
						globalSetup: ['tests/global-setup.ts'],
						setupFiles: ['tests/setup.ts'],
						include: ['src/**/*.int.test.ts', 'src/**/integration*.test.ts'],
						fileParallelism: false,
						testTimeout: 30_000
					}
				}
			]
		}
	};
});
