import { describe, expect, it } from 'vitest';
import { effectiveBundleStock } from './bundle';

describe('effectiveBundleStock', () => {
	it('returns 0 if components list is empty', () => {
		expect(effectiveBundleStock(10, [])).toBe(0);
	});

	it('returns bundle quota if component stock is abundant', () => {
		const comps = [
			{ stock: 100, qty: 1 },
			{ stock: 50, qty: 1 }
		];
		expect(effectiveBundleStock(10, comps)).toBe(10);
	});

	it('limits effective stock when a component stock is the bottleneck', () => {
		const comps = [
			{ stock: 100, qty: 1 },
			{ stock: 3, qty: 1 } // only 3 available
		];
		expect(effectiveBundleStock(15, comps)).toBe(3);
	});

	it('accounts for multiple quantity requirements per component', () => {
		const comps = [
			{ stock: 9, qty: 2 }, // floor(9/2) = 4
			{ stock: 10, qty: 1 } // floor(10/1) = 10
		];
		expect(effectiveBundleStock(20, comps)).toBe(4);
	});

	it('returns 0 if any component has 0 stock', () => {
		const comps = [
			{ stock: 100, qty: 1 },
			{ stock: 0, qty: 1 }
		];
		expect(effectiveBundleStock(10, comps)).toBe(0);
	});

	it('returns 0 if bundle stock itself is 0', () => {
		const comps = [
			{ stock: 100, qty: 1 },
			{ stock: 100, qty: 1 }
		];
		expect(effectiveBundleStock(0, comps)).toBe(0);
	});

	it('never returns negative numbers even with negative inputs', () => {
		const comps = [{ stock: -5, qty: 1 }];
		expect(effectiveBundleStock(10, comps)).toBe(0);
	});
});
