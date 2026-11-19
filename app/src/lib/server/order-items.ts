import { eq } from 'drizzle-orm';
import { db } from './db';
import { orderItemComponents, orderItems, products } from './db/schema';

export type OrderItemComponent = {
	id: number;
	orderItemId: number;
	productId: number;
	quantity: number;
	size: string;
	productName: string;
};

/** Baris pesanan; untuk paket bundling disertai isi paket (komponen yang stoknya dipotong). */
export function getOrderItemsWithComponents(orderId: number) {
	const items = db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();

	return items.map((it) => {
		const components: OrderItemComponent[] =
			it.itemType === 'bundle'
				? db
						.select({
							id: orderItemComponents.id,
							orderItemId: orderItemComponents.orderItemId,
							productId: orderItemComponents.productId,
							quantity: orderItemComponents.quantity,
							size: orderItemComponents.size,
							productName: products.name
						})
						.from(orderItemComponents)
						.innerJoin(products, eq(products.id, orderItemComponents.productId))
						.where(eq(orderItemComponents.orderItemId, it.id))
						.all()
				: [];
		return { ...it, components };
	});
}
