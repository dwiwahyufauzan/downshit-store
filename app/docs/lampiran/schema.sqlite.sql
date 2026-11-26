CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` integer,
	`description` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_al_created` ON `activity_logs` (`created_at`);
CREATE INDEX `idx_al_action` ON `activity_logs` (`action`);
CREATE TABLE `bundle_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bundle_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE UNIQUE INDEX `uq_bundle_product` ON `bundle_items` (`bundle_id`,`product_id`);
CREATE TABLE `bundles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`image_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX `uq_bundles_slug` ON `bundles` (`slug`);
CREATE TABLE `cart_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cart_id` integer NOT NULL,
	`product_id` integer,
	`bundle_id` integer,
	`quantity` integer DEFAULT 1 NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`is_selected` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_ci_cart` ON `cart_items` (`cart_id`);
CREATE UNIQUE INDEX `uq_ci_product` ON `cart_items` (`cart_id`,`product_id`,`size`);
CREATE UNIQUE INDEX `uq_ci_bundle` ON `cart_items` (`cart_id`,`bundle_id`,`size`);
CREATE TABLE `carts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_carts_user` ON `carts` (`user_id`);
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX `uq_categories_slug` ON `categories` (`slug`);
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE INDEX `idx_la_ident` ON `login_attempts` (`identifier`,`created_at`);
CREATE TABLE `order_item_components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_item_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE INDEX `idx_oic_item` ON `order_item_components` (`order_item_id`);
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`item_type` text NOT NULL,
	`product_id` integer,
	`bundle_id` integer,
	`item_name` text NOT NULL,
	`unit_price` integer NOT NULL,
	`quantity` integer NOT NULL,
	`subtotal` integer NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_oi_order` ON `order_items` (`order_id`);
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'menunggu_pembayaran' NOT NULL,
	`subtotal` integer NOT NULL,
	`shipping_cost` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`voucher_code` text,
	`total` integer NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_phone` text NOT NULL,
	`shipping_address` text NOT NULL,
	`shipping_postal_code` text,
	`shipping_village_code` text,
	`shipping_service` text,
	`shipping_etd` text,
	`notes` text,
	`expires_at` text,
	`cancel_reason` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE UNIQUE INDEX `uq_orders_code` ON `orders` (`code`);
CREATE INDEX `idx_orders_user` ON `orders` (`user_id`);
CREATE INDEX `idx_orders_status` ON `orders` (`status`);
CREATE INDEX `idx_orders_created` ON `orders` (`created_at`);
CREATE TABLE `password_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_pwreset_token` ON `password_resets` (`token_hash`);
CREATE INDEX `idx_pwreset_user` ON `password_resets` (`user_id`);
CREATE TABLE `payment_simulations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gateway_order_id` text NOT NULL,
	`token` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`channel` text,
	`payment_code` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX `uq_sim_gateway_order` ON `payment_simulations` (`gateway_order_id`);
CREATE UNIQUE INDEX `uq_sim_token` ON `payment_simulations` (`token`);
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`method` text DEFAULT 'transfer_bank' NOT NULL,
	`amount` integer NOT NULL,
	`proof_url` text,
	`gateway_order_id` text,
	`gateway_type` text,
	`gateway_tx_id` text,
	`payment_code` text,
	`redirect_url` text,
	`expires_at` text,
	`status` text DEFAULT 'menunggu' NOT NULL,
	`note` text,
	`confirmed_by` integer,
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_pay_order` ON `payments` (`order_id`);
CREATE INDEX `idx_pay_status` ON `payments` (`status`);
CREATE UNIQUE INDEX `uq_pay_gateway_order` ON `payments` (`gateway_order_id`);
CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_product_images_product` ON `product_images` (`product_id`);
CREATE TABLE `product_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`label` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_product_size` ON `product_sizes` (`product_id`,`label`);
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`weight_grams` integer DEFAULT 300 NOT NULL,
	`image_url` text,
	`is_bundleable` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `uq_products_slug` ON `products` (`slug`);
CREATE INDEX `idx_products_category` ON `products` (`category_id`);
CREATE TABLE `purchase_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE INDEX `idx_pi_purchase` ON `purchase_items` (`purchase_id`);
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`supplier_name` text,
	`purchase_date` text NOT NULL,
	`total_cost` integer DEFAULT 0 NOT NULL,
	`note` text,
	`status` text DEFAULT 'diterima' NOT NULL,
	`received_at` text,
	`cancelled_at` text,
	`cancel_note` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `uq_purchases_code` ON `purchases` (`code`);
CREATE TABLE `rate_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL
);

CREATE INDEX `idx_rate_key_at` ON `rate_hits` (`key`,`at`);
CREATE TABLE `review_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`review_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_review_images_review` ON `review_images` (`review_id`);
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`is_visible` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_review_order_product` ON `reviews` (`order_id`,`product_id`);
CREATE INDEX `idx_reviews_product` ON `reviews` (`product_id`,`is_visible`);
CREATE INDEX `idx_reviews_user` ON `reviews` (`user_id`);
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE TABLE `shipments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`courier` text,
	`tracking_number` text,
	`status` text DEFAULT 'belum_dikirim' NOT NULL,
	`note` text,
	`shipped_at` text,
	`delivered_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_ship_order` ON `shipments` (`order_id`);
CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`bundle_id` integer,
	`type` text NOT NULL,
	`size` text,
	`quantity_change` integer NOT NULL,
	`stock_after` integer,
	`reference_type` text,
	`reference_id` integer,
	`note` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_sm_product` ON `stock_movements` (`product_id`);
CREATE INDEX `idx_sm_created` ON `stock_movements` (`created_at`);
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

CREATE UNIQUE INDEX `uq_stock_sub` ON `stock_subscriptions` (`user_id`,`product_id`,`size`);
CREATE INDEX `idx_stock_sub_pending` ON `stock_subscriptions` (`notified_at`,`product_id`);
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`address` text,
	`address_province` text,
	`address_city` text,
	`address_district` text,
	`address_village` text,
	`address_detail` text,
	`address_postal_code` text,
	`address_village_code` text,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'konsumen' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);
CREATE INDEX `idx_users_role` ON `users` (`role`);
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

CREATE UNIQUE INDEX `uq_redemption_order` ON `voucher_redemptions` (`order_id`);
CREATE INDEX `idx_redemption_voucher_user` ON `voucher_redemptions` (`voucher_id`,`user_id`);
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
	`show_on_home` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX `uq_vouchers_code` ON `vouchers` (`code`);
CREATE TABLE `wishlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_wishlist_user_product` ON `wishlists` (`user_id`,`product_id`);
CREATE INDEX `idx_wishlist_user` ON `wishlists` (`user_id`,`created_at`);
