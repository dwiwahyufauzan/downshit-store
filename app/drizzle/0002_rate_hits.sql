CREATE TABLE `rate_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_key_at` ON `rate_hits` (`key`,`at`);