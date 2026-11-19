import { formatDate } from './format';

const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });

export function waktuRelatif(d: Date | string, now = Date.now()): string {
	const diff = Math.round((new Date(d).getTime() - now) / 1000); // detik (negatif = lampau)
	const abs = Math.abs(diff);
	if (abs < 60) return 'baru saja';
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
	if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
	if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
	return formatDate(d);
}
