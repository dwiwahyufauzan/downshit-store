CREATE TABLE `voucher_redemptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`voucher_id`) REFERENCES `vouchers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_redemption_order` ON `voucher_redemptions` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_redemption_voucher_user` ON `voucher_redemptions` (`voucher_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`min_subtotal` integer DEFAULT 0 NOT NULL,
	`max_discount` integer,
	`starts_at` text,
	`ends_at` text,
	`usage_limit` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`per_user_limit` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vouchers_code` ON `vouchers` (`code`);--> statement-breakpoint
ALTER TABLE `orders` ADD `discount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `voucher_code` text;