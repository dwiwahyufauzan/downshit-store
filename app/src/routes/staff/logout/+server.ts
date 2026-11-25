import { performLogout } from '#lib/server/login';
import type { RequestHandler } from './$types';

// Logout STAF (cookie staf saja): sesi pelanggan di peramban yang sama tidak ikut terhapus.
export const POST: RequestHandler = (event) => performLogout(event, 'staff');
