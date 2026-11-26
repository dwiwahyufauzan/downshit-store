/**
 * Pelaporan galat ke Sentry / GlitchTip (protokol envelope lewat fetch, tanpa SDK) + log terstruktur.
 * Tanpa SENTRY_DSN hanya mencatat log. Tidak pernah melempar dan tidak memperlambat request.
 */
import { randomUUID } from 'node:crypto';
import { envVar } from './config';
import { errorFields, log, scrub } from './logger';

type Ctx = {
	requestId?: string;
	method?: string;
	/** Path saja (tanpa query string yang bisa memuat data pribadi) */
	path?: string;
	status?: number;
	userId?: number | null;
	source?: 'server' | 'client';
	extra?: Record<string, unknown>;
};

type Dsn = { endpoint: string; key: string; raw: string };

function parseDsn(raw: string | undefined): Dsn | null {
	if (!raw) return null;
	try {
		const u = new URL(raw);
		const project = u.pathname.replace(/^\//, '');
		if (!u.username || !project) return null;
		return { endpoint: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username, raw };
	} catch {
		return null;
	}
}

// Galat yang sama beruntun (mis. loop) tidak boleh membanjiri Sentry & kuota: 1x per menit per sidik jari.
const DEDUPE_MS = 60_000;
const MAX_PER_MINUTE = 30;
const seen = new Map<string, number>();
let windowStart = 0;
let sentInWindow = 0;

function allowed(fingerprint: string, now = Date.now()): boolean {
	if (now - windowStart > 60_000) {
		windowStart = now;
		sentInWindow = 0;
	}
	if (sentInWindow >= MAX_PER_MINUTE) return false;
	const last = seen.get(fingerprint);
	if (last !== undefined && now - last < DEDUPE_MS) return false;
	seen.set(fingerprint, now);
	if (seen.size > 500) for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
	sentInWindow++;
	return true;
}

/** "at fn (file:line:col)" → frame Sentry (urut terlama → terbaru). */
function frames(stack: string | undefined) {
	const out: { function?: string; filename: string; lineno?: number; colno?: number }[] = [];
	for (const line of (stack ?? '').split('\n').slice(1)) {
		const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
		if (m) out.push({ function: m[1], filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
	}
	return out.reverse();
}

export function buildEvent(err: unknown, ctx: Ctx) {
	const f = errorFields(err);
	return {
		event_id: randomUUID().replaceAll('-', ''),
		timestamp: Date.now() / 1000,
		platform: ctx.source === 'client' ? 'javascript' : 'node',
		level: 'error',
		environment:
			envVar('SENTRY_ENVIRONMENT') ??
			(process.env.NODE_ENV === 'production' ? 'production' : 'development'),
		server_name: 'downshit-store',
		exception: {
			values: [{ type: f.name, value: f.message, stacktrace: { frames: frames(f.stack) } }]
		},
		request: ctx.path ? { method: ctx.method, url: ctx.path } : undefined,
		user: ctx.userId ? { id: String(ctx.userId) } : undefined,
		tags: { source: ctx.source ?? 'server', ...(ctx.status ? { status: String(ctx.status) } : {}) },
		extra: { requestId: ctx.requestId, ...(scrub(ctx.extra ?? {}) as object) }
	};
}

/** Hanya untuk tes. */
export function resetErrorReporting() {
	seen.clear();
	windowStart = 0;
	sentInWindow = 0;
}

/** Catat galat dan (bila SENTRY_DSN terpasang) laporkan. Mengembalikan true bila dikirim ke Sentry. */
export async function reportError(err: unknown, ctx: Ctx = {}): Promise<boolean> {
	log.error(err instanceof Error ? err.message : String(err), {
		requestId: ctx.requestId,
		method: ctx.method,
		path: ctx.path,
		status: ctx.status,
		userId: ctx.userId ?? undefined,
		source: ctx.source ?? 'server',
		error: errorFields(err)
	});

	const dsn = parseDsn(envVar('SENTRY_DSN'));
	if (!dsn) return false;
	const f = errorFields(err);
	if (!allowed(`${f.name}|${f.message}|${f.stack?.split('\n')[1] ?? ''}`)) return false;

	try {
		const event = buildEvent(err, ctx);
		const body = [
			JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: dsn.raw }),
			JSON.stringify({ type: 'event' }),
			JSON.stringify(event)
		].join('\n');
		const res = await fetch(dsn.endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-sentry-envelope',
				'x-sentry-auth': `Sentry sentry_version=7, sentry_client=downshit/1.0, sentry_key=${dsn.key}`
			},
			body,
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) throw new Error(`Sentry ${res.status}`);
		return true;
	} catch (e) {
		// pelaporan yang gagal tidak boleh memunculkan galat baru
		console.warn('[error-report] gagal mengirim ke Sentry:', e instanceof Error ? e.message : e);
		return false;
	}
}
