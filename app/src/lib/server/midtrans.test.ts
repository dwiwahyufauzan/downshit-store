import { describe, expect, it } from 'vitest';
import { channelOf, classify, grossToRupiah, parseExpiry, verifySignature } from './midtrans';

describe('classify: transaction_status Midtrans → hasil', () => {
	it.each([
		['settlement', undefined, 'paid'],
		['capture', 'accept', 'paid'],
		['capture', undefined, 'paid'],
		['capture', 'challenge', 'pending'],
		['capture', 'deny', 'failed'],
		['pending', undefined, 'pending'],
		['authorize', undefined, 'pending'],
		['deny', undefined, 'failed'],
		['cancel', undefined, 'failed'],
		['expire', undefined, 'failed'],
		['failure', undefined, 'failed'],
		['refund', undefined, 'refunded'],
		['partial_refund', undefined, 'refunded'],
		['chargeback', undefined, 'refunded'],
		['status-aneh', undefined, 'pending']
	])('%s (fraud: %s) → %s', (transaction_status, fraud_status, want) => {
		expect(classify({ transaction_status, fraud_status })).toBe(want);
	});
});

describe('channelOf: saluran & kode bayar untuk pelanggan', () => {
	const base = {
		order_id: 'X',
		status_code: '201',
		gross_amount: '1.00',
		transaction_status: 'pending'
	};
	it('VA bank', () => {
		expect(
			channelOf({
				...base,
				payment_type: 'bank_transfer',
				va_numbers: [{ bank: 'BCA', va_number: '123' }]
			})
		).toEqual({ type: 'bca_va', code: '123' });
	});
	it('VA Permata', () => {
		expect(
			channelOf({ ...base, payment_type: 'bank_transfer', permata_va_number: '9988' })
		).toEqual({ type: 'permata_va', code: '9988' });
	});
	it('Mandiri Bill Payment', () => {
		expect(
			channelOf({ ...base, payment_type: 'echannel', biller_code: '70012', bill_key: '555' })
		).toEqual({ type: 'echannel', code: '70012 / 555' });
	});
	it('minimarket memakai nama toko', () => {
		expect(
			channelOf({ ...base, payment_type: 'cstore', store: 'indomaret', payment_code: 'ABC123' })
		).toEqual({ type: 'indomaret', code: 'ABC123' });
	});
	it('e-wallet & QRIS tanpa kode', () => {
		expect(channelOf({ ...base, payment_type: 'gopay' })).toEqual({ type: 'gopay', code: null });
		expect(channelOf({ ...base, payment_type: 'qris' })).toEqual({ type: 'qris', code: null });
	});
});

describe('parseExpiry & grossToRupiah', () => {
	it('expiry_time WIB → ISO UTC', () => {
		expect(parseExpiry('2026-11-14 10:30:00')).toBe('2026-11-14T03:30:00.000Z');
		expect(parseExpiry(undefined)).toBeNull();
		expect(parseExpiry('bukan tanggal')).toBeNull();
	});
	it('gross_amount desimal → rupiah bulat', () => {
		expect(grossToRupiah('115000.00')).toBe(115000);
		expect(grossToRupiah('abc')).toBeNaN();
		expect(grossToRupiah(undefined)).toBeNaN();
	});
});

describe('verifySignature tanpa Server Key', () => {
	it('selalu menolak (gateway belum dikonfigurasi)', () => {
		expect(
			verifySignature({
				order_id: 'A',
				status_code: '200',
				gross_amount: '1.00',
				signature_key: 'x'
			})
		).toBe(false);
	});
});
