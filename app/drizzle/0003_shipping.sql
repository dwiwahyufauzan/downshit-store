ALTER TABLE `orders` ADD `shipping_postal_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_village_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_service` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_etd` text;--> statement-breakpoint
ALTER TABLE `products` ADD `weight_grams` integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `address_postal_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `address_village_code` text;