import { uuid } from "drizzle-orm/pg-core";

import { users } from "./identity";

/** Kolom created_by / updated_by untuk tabel master dan dokumen. */
export const actorColumns = () => ({
  createdBy: uuid().references(() => users.id),
  updatedBy: uuid().references(() => users.id),
});