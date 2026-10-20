import { timestamp, uuid } from "drizzle-orm/pg-core";

/** PK uuid v4 yang dibuat oleh database. */
export const primaryId = () => uuid().primaryKey().defaultRandom();

/** timestamptz (disimpan UTC). Tampilan zona waktu diatur di lapisan aplikasi. */
export const timestamptz = () => timestamp({ withTimezone: true, mode: "date" });

/** created_at / updated_at standar. updated_at diperbarui otomatis oleh Drizzle pada UPDATE. */
export const timestamps = () => ({
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});