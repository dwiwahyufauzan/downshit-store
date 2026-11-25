import { performLogout } from '#lib/server/login';
import type { RequestHandler } from './$types';

// Logout PELANGGAN (cookie pelanggan saja). Staf keluar lewat /staff/logout.
// Hanya POST (bukan GET) agar logout tidak bisa dipicu lewat <img src="/logout">; CSRF dijaga cek Origin.
export const POST: RequestHandler = (event) => performLogout(event, 'customer');
