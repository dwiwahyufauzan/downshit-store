import type { HandleClientError } from '@sveltejs/kit/hooks';

export const handleError: HandleClientError = (input) => {
	const { event } = input;
	if (input.kind === 'app') {
		return;
	}
	const err = input.error as Error | undefined;
	console.error('[Downshit Client Error]', input.error, event);
	return {
		message: err?.message || 'Terjadi kesalahan pada peramban.'
	};
};
