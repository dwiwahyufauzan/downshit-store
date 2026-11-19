-- Mengubah timestamp format lama ('2026-11-14 04:16:11', bawaan CURRENT_TIMESTAMP) menjadi
-- ISO-8601 UTC ('2026-11-14T04:16:11.000Z'). Aman dijalankan berulang (hanya menyentuh format lama).
-- Pakai:  sqlite3 downshit.db < scripts/fix-timestamps.sql
BEGIN;
UPDATE users SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE users SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE sessions SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE categories SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE products SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE products SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE bundles SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE bundles SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE carts SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE orders SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE orders SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE payments SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE shipments SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE purchases SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE stock_movements SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE activity_logs SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
UPDATE settings SET updated_at = replace(updated_at,' ','T')||'.000Z' WHERE length(updated_at)=19 AND instr(updated_at,' ')=11;
UPDATE login_attempts SET created_at = replace(created_at,' ','T')||'.000Z' WHERE length(created_at)=19 AND instr(created_at,' ')=11;
COMMIT;
