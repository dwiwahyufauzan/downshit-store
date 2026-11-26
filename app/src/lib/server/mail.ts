import { envVar } from './config';

export type Mail = { to: string; subject: string; text: string; html?: string };
type Transport = (mail: Mail) => Promise<void>;

/** Hook tes: gantikan pengiriman nyata (null = kembali ke konfigurasi env). */
let override: Transport | null = null;
export function setMailTransport(t: Transport | null) {
	override = t;
}

const provider = () => envVar('MAIL_PROVIDER');

/** Email aktif bila ada penyedia terkonfigurasi (atau transport tes). */
export function mailEnabled(): boolean {
	return override !== null || Boolean(provider());
}

/** "Nama <a@b.id>" → { name, email } */
function parseFrom(from: string) {
	const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
	return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2] } : { name: '', email: from.trim() };
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const providers: Record<string, Transport> = {
	log: async (m) => {
		console.log(`[mail:log] to=${m.to} subject="${m.subject}"\n${m.text}`);
	},
	resend: async (m) => {
		await post(
			'https://api.resend.com/emails',
			{ authorization: `Bearer ${envVar('MAIL_API_KEY') ?? ''}` },
			{
				from: envVar('MAIL_FROM'),
				to: [m.to],
				subject: m.subject,
				text: m.text,
				...(m.html ? { html: m.html } : {})
			}
		);
	},
	brevo: async (m) => {
		const from = parseFrom(envVar('MAIL_FROM') ?? '');
		await post(
			'https://api.brevo.com/v3/smtp/email',
			{ 'api-key': envVar('MAIL_API_KEY') ?? '' },
			{
				sender: from.name ? from : { email: from.email },
				to: [{ email: m.to }],
				subject: m.subject,
				textContent: m.text,
				...(m.html ? { htmlContent: m.html } : {})
			}
		);
	}
};

/**
 * Kirim email. TIDAK pernah melempar: kegagalan hanya dicatat (notifikasi tidak boleh menggagalkan
 * transaksi bisnis). Mengembalikan true bila diserahkan ke penyedia.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
	const name = provider();
	const transport = override ?? (name ? providers[name] : undefined);
	if (!transport) return false;
	try {
		await transport(mail);
		return true;
	} catch (e) {
		console.error('[mail] gagal mengirim ke', mail.to, e instanceof Error ? e.message : e);
		return false;
	}
}

/** Ubah teks polos menjadi HTML sederhana yang aman (escape + paragraf + tautan). */
export function textToHtml(text: string): string {
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const body = esc(text)
		.split(/\n{2,}/)
		.map(
			(p) =>
				`<p>${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`
		)
		.join('');
	return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${body}</div>`;
}
