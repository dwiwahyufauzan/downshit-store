import { describe, expect, it } from 'vitest';
import { bundleCreateSchema } from './bundle';

describe('bundleCreateSchema', () => {
	it('validates a valid bundle package', () => {
		const validData = {
			name: 'Paket Streetwear Combo',
			description: 'Hoodie dan Kaos Oversize',
			price: 250000,
			stock: 15,
			isActive: true,
			items: [
				{ productId: 1, quantity: 1 },
				{ productId: 2, quantity: 1 }
			]
		};

		const result = bundleCreateSchema.safeParse(validData);
		expect(result.success).toBe(true);
	});

	it('rejects a bundle with only 1 component', () => {
		const invalidData = {
			name: 'Paket Single',
			price: 150000,
			stock: 10,
			items: [{ productId: 1, quantity: 1 }]
		};

		const result = bundleCreateSchema.safeParse(invalidData);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.message.includes('minimal'))).toBe(true);
		}
	});

	it('rejects duplicate components in the same bundle', () => {
		const duplicateData = {
			name: 'Paket Duplikat',
			price: 200000,
			stock: 10,
			items: [
				{ productId: 1, quantity: 1 },
				{ productId: 1, quantity: 2 }
			]
		};

		const result = bundleCreateSchema.safeParse(duplicateData);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.message.includes('duplikat'))).toBe(true);
		}
	});

	it('rejects price below 1000', () => {
		const invalidPrice = {
			name: 'Paket Murah',
			price: 500,
			stock: 10,
			items: [
				{ productId: 1, quantity: 1 },
				{ productId: 2, quantity: 1 }
			]
		};

		const result = bundleCreateSchema.safeParse(invalidPrice);
		expect(result.success).toBe(false);
	});
});
