import { db, type Tx } from './db';
import { activityLogs } from './db/schema';

/** Sinkron (aman dipanggil di dalam `transact`). `userId` null = aksi sistem. */
export function logActivity(
	userId: number | null,
	action: string,
	entity: string | null,
	entityId: number | null,
	description: string,
	executor: typeof db | Tx = db
): void {
	executor
		.insert(activityLogs)
		.values({
			userId,
			action,
			entity,
			entityId,
			description: description.slice(0, 255)
		})
		.run();
}
