export type SessionUser = {
	id: number;
	name: string;
	email: string;
	role: 'owner' | 'admin' | 'konsumen';
	mustChangePassword: boolean;
};

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			sessionId: string | null;
			/** ID permintaan (dari header x-request-id proxy atau acak) untuk melacak log */
			requestId: string;
		}
		interface Error {
			message: string;
			code?: string;
		}
	}
}

export {};
