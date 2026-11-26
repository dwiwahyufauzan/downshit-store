import type { HandleClientError } from '@sveltejs/kit/hooks';

export const handleError: HandleClientError = (input) => {
	if (input.kind === 'app') {
		return;
	}
	const err = input.error as Error | undefined;
	console.error('[Downshit Client Error]', input.error, input.event);

	// Teruskan ke server (log/Sentry). sendBeacon tidak menghalangi navigasi dan gagalnya diabaikan.
	try {
		const payload = JSON.stringify({
			message: err?.message ?? String(input.error),
			stack: err?.stack,
			path: location.pathname
		});
		navigator.sendBeacon?.('/api/client-error', new Blob([payload], { type: 'application/json' }));
	} catch {
		/* pelaporan galat tidak boleh menimbulkan galat baru */
	}
	return {
		message: err?.message || 'Terjadi kesalahan pada peramban.'
	};
};
