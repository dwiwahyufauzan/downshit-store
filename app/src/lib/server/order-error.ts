/** Dipisah dari orders.ts agar modul pembayaran online bisa memakainya tanpa impor melingkar. */
export class OrderError extends Error {
	kind: string;
	constructor(message: string, kind = 'bad_request') {
		super(message);
		this.name = 'OrderError';
		this.kind = kind;
	}
}
