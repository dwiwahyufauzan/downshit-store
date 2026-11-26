import * as env from '$app/env/private';

/**
 * Variabel lingkungan opsional dibaca lewat nama. Berkas tes yang me-mock `$app/env/private` dengan daftar
 * tetap tidak perlu tahu variabel baru: yang tidak ada di mock dianggap tidak diisi (undefined).
 */
export function envVar(name: string): string | undefined {
	const all = env as unknown as Record<string, string | undefined>;
	return name in all ? all[name] : undefined;
}
