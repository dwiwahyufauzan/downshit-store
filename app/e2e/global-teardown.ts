import { existsSync, readFileSync, rmSync } from 'node:fs';
import { PID_FILE } from './env';

export default function globalTeardown() {
	if (!existsSync(PID_FILE)) return;
	const pid = Number(readFileSync(PID_FILE, 'utf8'));
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		/* sudah berhenti */
	}
	rmSync(PID_FILE, { force: true });
	// data & log dibiarkan agar kegagalan bisa diperiksa; global-setup berikutnya membersihkannya
}
