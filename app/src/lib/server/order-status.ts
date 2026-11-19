import type { OrderStatus } from '../constants';

export type Status = OrderStatus;

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	menunggu_pembayaran: ['menunggu_konfirmasi', 'dibatalkan'],
	menunggu_konfirmasi: ['menunggu_pembayaran', 'diproses', 'dibatalkan'],
	diproses: ['dikirim', 'dibatalkan'],
	dikirim: ['selesai'],
	selesai: [],
	dibatalkan: []
};

export const CANCELLABLE_BY = {
	konsumen: ['menunggu_pembayaran', 'menunggu_konfirmasi'] as OrderStatus[],
	admin: ['menunggu_pembayaran', 'menunggu_konfirmasi', 'diproses'] as OrderStatus[],
	// Sistem hanya boleh membatalkan pesanan yang belum ada bukti bayarnya (kedaluwarsa)
	system: ['menunggu_pembayaran'] as OrderStatus[]
} as const;

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => {
	return TRANSITIONS[from]?.includes(to) ?? false;
};

export const allowedNext = (from: OrderStatus): OrderStatus[] => {
	return TRANSITIONS[from] ?? [];
};

export const canCancel = (role: 'admin' | 'konsumen' | 'system', status: OrderStatus): boolean => {
	return CANCELLABLE_BY[role].includes(status);
};
