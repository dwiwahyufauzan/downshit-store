/**
 * Log terstruktur: satu baris JSON per kejadian (produksi) atau teks ringkas (pengembangan).
 * Nilai rahasia (password, token, cookie, API key) otomatis disamarkan, jadi aman dilampirkan sebagai konteks.
 *   LOG_LEVEL=debug|info|warn|error   LOG_FORMAT=json|pretty
 */
import { envVar } from './config';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|dsn|signature/i;

/** Salinan konteks dengan kunci rahasia disamarkan (kedalaman terbatas; Error → name/message/stack). */
export function scrub(value: unknown, depth = 0): unknown {
	if (value instanceof Error) return errorFields(value);
	if (value === null || typeof value !== 'object') return value;
	if (depth >= 4) return '[dalam]';
	if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		out[k] = SENSITIVE.test(k) ? '[disamarkan]' : scrub(v, depth + 1);
	}
	return out;
}

export function errorFields(err: unknown) {
	if (err instanceof Error) {
		return {
			name: err.name,
			message: err.message,
			stack: err.stack?.split('\n').slice(0, 12).join('\n')
		};
	}
	return { name: 'NonError', message: String(err) };
}

const minLevel = (): number => ORDER[envVar('LOG_LEVEL') as Level] ?? ORDER.info;
const asJson = () =>
	(envVar('LOG_FORMAT') ?? (process.env.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'json';

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
	if (ORDER[level] < minLevel()) return;
	const safe = ctx ? (scrub(ctx) as Record<string, unknown>) : undefined;
	const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	if (asJson()) {
		write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...safe }));
	} else {
		const extra = safe && Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : '';
		write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${extra}`);
	}
}

export const log = {
	debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
	info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
	warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
	error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx)
};
