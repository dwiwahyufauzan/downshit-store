CREATE TABLE `stock_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`notified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_sub` ON `stock_subscriptions` (`user_id`,`product_id`,`size`);--> statement-breakpoint
CREATE INDEX `idx_stock_sub_pending` ON `stock_subscriptions` (`notified_at`,`product_id`);