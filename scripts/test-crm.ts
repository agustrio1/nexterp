import { sql } from "drizzle-orm";

import { products, unitsOfMeasure, users } from "@/db/schema";
import { createAccount, getAccount, listAccounts, updateAccount } from "@/modules/crm/account-service";
import { createActivity, completeActivity, getActivity, listActivities } from "@/modules/crm/activity-service";
import { createContact, getContact, listContacts, updateContact } from "@/modules/crm/contact-service";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "@/modules/crm/customer-service";
import { convertLead, createLead, listLeads, updateLead } from "@/modules/crm/lead-service";
import { createNote, listNotes } from "@/modules/crm/note-service";
import { closeOpportunity, createOpportunity, getOpportunity, listOpportunities, moveStage, updateOpportunity } from "@/modules/crm/opportunity-service";
import { createPriceList, getPriceList, addPriceItem, listPriceLists, removePriceItem, updatePriceList } from "@/modules/crm/price-list-service";
import { createStage, listStages, updateStage } from "@/modules/crm/pipeline-service";
import { assignSegment, createSegment, listSegments, unassignSegment, updateSegment } from "@/modules/crm/segment-service";
import { createTask, getTask, listTasks, updateTask } from "@/modules/crm/task-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 6C: CRUD penuh modul CRM.
 * Seluruh operasi dalam SATU db.transaction dengan throw Rollback — TIDAK ADA data tersimpan.
 * BUTUH migrasi 0022 (tabel CRM).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectError(label: string, tx: Tx, expectedCode: string, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    assert(`${label} (seharusnya ${expectedCode})`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string };
    assert(`${label} = ${expectedCode}`, e.code === expectedCode);
  }
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const actor: AuthContext = { userId: u.id, name: "Uji", email: "uji@example.com", grants: await loadGrants(u.id) };
  const fake = "00000000-0000-4000-8000-000000000000";

  try {
    await db.transaction(async (tx) => {
      /* -------- Accounts -------- */
      const acct = await createAccount(actor, { code: "TST-ACC", name: "Akun Uji", type: "prospect" }, tx);
      assert("createAccount mengembalikan id", !!acct.id);
      assert("createAccount code benar", acct.code === "TST-ACC");

      await expectError("duplikat account", tx, "CONFLICT", () =>
        createAccount(actor, { code: "TST-ACC", name: "Lain", type: "prospect" }, tx),
      );

      const updated = await updateAccount(actor, acct.id, { name: "Akun Diubah", isActive: false }, tx);
      assert("updateAccount name", updated.name === "Akun Diubah");
      assert("updateAccount isActive", updated.isActive === false);

      const fetched = await getAccount(actor, acct.id, tx);
      assert("getAccount cocok", fetched.id === acct.id);

      await expectError("getAccount tidak ada", tx, "NOT_FOUND", () => getAccount(actor, fake, tx));
      await expectError("getAccount tanpa izin", tx, "FORBIDDEN", () =>
        getAccount({ ...actor, grants: [] }, acct.id, tx),
      );

      const list = await listAccounts(actor, { search: "TST" }, tx);
      assert("listAccounts menemukan data", list.some((r) => r.code === "TST-ACC"));

      /* -------- Contacts -------- */
      const contact = await createContact(actor, { accountId: acct.id, name: "Budi Kontak", isPrimary: true }, tx);
      assert("createContact id", !!contact.id);

      const contacts = await listContacts(actor, acct.id, tx);
      assert("listContacts >= 1", contacts.length >= 1);

      const cUpd = await updateContact(actor, contact.id, { title: "Manager" }, tx);
      assert("updateContact title", cUpd.title === "Manager");

      await expectError("getContact tidak ada", tx, "NOT_FOUND", () => getContact(actor, fake, tx));

      /* -------- Leads + Convert -------- */
      const lead = await createLead(actor, { name: "Lead Baru", source: "Web", company: "PT Test" }, tx);
      assert("createLead id", !!lead.id);

      const leadUpd = await updateLead(actor, lead.id, { status: "qualified" }, tx);
      assert("updateLead status", leadUpd.status === "qualified");

      const converted = await convertLead(actor, lead.id, {
        accountCode: "TST-CVT",
        accountName: "Hasil Konversi",
        contactName: "Kontur CVT",
      }, tx);
      assert("convertLead accountId", !!converted.accountId);
      assert("convertLead contactId", !!converted.contactId);

      const leads = await listLeads(actor, { search: "Lead" }, tx);
      assert("listLeads >= 1", leads.length >= 1);

      /* -------- Pipeline Stages -------- */
      const stage1 = await createStage(actor, { name: "Kualifikasi", position: 1, probability: "20" }, tx);
      assert("createStage id", !!stage1.id);

      await expectError("duplikat position", tx, "CONFLICT", () =>
        createStage(actor, { name: "Lain", position: 1, probability: "10" }, tx),
      );

      const stage2 = await createStage(actor, { name: "Negosiasi", position: 2, probability: "60" }, tx);
      const stUpd = await updateStage(actor, stage2.id, { probability: "70" }, tx);
      assert("updateStage probability", stUpd.probability === "70.00");

      const stages = await listStages(actor, tx);
      assert("listStages >= 2", stages.length >= 2);

      /* -------- Opportunities -------- */
      const opp = await createOpportunity(actor, {
        accountId: acct.id, stageId: stage1.id, title: "Deal Besar", amount: "150000000.00", currency: "IDR",
      }, tx);
      assert("createOpportunity id", !!opp.id);
      assert("createOpportunity amount", opp.amount === "150000000.00");

      const oppUpd = await updateOpportunity(actor, opp.id, { title: "Deal Diperbarui" }, tx);
      assert("updateOpportunity title", oppUpd.title === "Deal Diperbarui");

      const moved = await moveStage(actor, opp.id, { stageId: stage2.id }, tx);
      assert("moveStage stageId", moved.stageId === stage2.id);

      const closed = await closeOpportunity(actor, opp.id, { status: "won" }, tx);
      assert("closeOpportunity status", closed.status === "won");

      await expectError("moveStage setelah closed", tx, "BUSINESS_RULE", () =>
        moveStage(actor, opp.id, { stageId: stage1.id }, tx),
      );

      const opps = await listOpportunities(actor, { accountId: acct.id }, tx);
      assert("listOpportunities >= 1", opps.length >= 1);

      await expectError("getOpportunity tidak ada", tx, "NOT_FOUND", () => getOpportunity(actor, fake, tx));

      /* -------- Activities -------- */
      const act = await createActivity(actor, { accountId: acct.id, type: "call", subject: "Hubungi klien" }, tx);
      assert("createActivity id", !!act.id);

      const actDone = await completeActivity(actor, act.id, tx);
      assert("completeActivity isCompleted", actDone.isCompleted === true);

      const acts = await listActivities(actor, { accountId: acct.id }, tx);
      assert("listActivities >= 1", acts.length >= 1);

      await expectError("getActivity tidak ada", tx, "NOT_FOUND", () => getActivity(actor, fake, tx));

      /* -------- Tasks -------- */
      const task = await createTask(actor, { accountId: acct.id, title: "Kirim penawaran", dueDate: "2026-06-30" }, tx);
      assert("createTask id", !!task.id);

      const taskUpd = await updateTask(actor, task.id, { isCompleted: true }, tx);
      assert("updateTask isCompleted", taskUpd.isCompleted === true);

      const tasks = await listTasks(actor, { accountId: acct.id }, tx);
      assert("listTasks >= 1", tasks.length >= 1);

      await expectError("getTask tidak ada", tx, "NOT_FOUND", () => getTask(actor, fake, tx));

      /* -------- Notes -------- */
      const note = await createNote(actor, { accountId: acct.id, content: "Ini catatan penting" }, tx);
      assert("createNote id", !!note.id);

      const notes = await listNotes(actor, { accountId: acct.id }, tx);
      assert("listNotes >= 1", notes.length >= 1);

      /* -------- Segments -------- */
      const seg = await createSegment(actor, { name: "Enterprise", description: "Perusahaan besar" }, tx);
      assert("createSegment id", !!seg.id);

      const segUpd = await updateSegment(actor, seg.id, { description: "Korporat" }, tx);
      assert("updateSegment desc", segUpd.description === "Korporat");

      await assignSegment(actor, { accountId: acct.id, segmentId: seg.id }, tx);
      const segs = await listSegments(actor, tx);
      assert("listSegments >= 1", segs.length >= 1);

      await unassignSegment(actor, { accountId: acct.id, segmentId: seg.id }, tx);

      /* -------- Price Lists -------- */
      const pl = await createPriceList(actor, { code: "PL-TEST", name: "Harga Uji", validFrom: "2026-01-01" }, tx);
      assert("createPriceList id", !!pl.id);

      const plUpd = await updatePriceList(actor, pl.id, { name: "Harga Diubah" }, tx);
      assert("updatePriceList name", plUpd.name === "Harga Diubah");

      // Insert unit + product inline for price-list item test
      const [unit] = await tx.insert(unitsOfMeasure).values({ code: "UJ", name: "Unit Uji", createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: unitsOfMeasure.id });
      const [prod] = await tx.insert(products).values({ sku: "TST-CRM-01", name: "Produk CRM Uji", baseUnitId: unit!.id, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: products.id });

      const item = await addPriceItem(actor, pl.id, { productId: prod.id, unitPrice: "250000.00" }, tx);
      assert("addPriceItem id", !!item.id);

      await expectError("duplikat priceItem", tx, "CONFLICT", () =>
        addPriceItem(actor, pl.id, { productId: prod.id, unitPrice: "300000.00" }, tx),
      );

      const plDetail = await getPriceList(actor, pl.id, tx);
      assert("getPriceList items >= 1", plDetail.items.length >= 1);

      await removePriceItem(actor, pl.id, prod.id, tx);
      const plAfterRemove = await getPriceList(actor, pl.id, tx);
      assert("removePriceItem items kosong", plAfterRemove.items.length === 0);

      const pls = await listPriceLists(actor, {}, tx);
      assert("listPriceLists >= 1", pls.length >= 1);

      /* -------- Customers -------- */
      const cust = await createCustomer(actor, { crmAccountId: acct.id, code: "CUST-01", currency: "IDR", creditLimit: "500000000.00" }, tx);
      assert("createCustomer id", !!cust.id);
      assert("createCustomer code", cust.code === "CUST-01");

      await expectError("duplikat customer code", tx, "CONFLICT", () =>
        createCustomer(actor, { crmAccountId: converted.accountId, code: "CUST-01", currency: "IDR" }, tx),
      );

      const custUpd = await updateCustomer(actor, cust.id, { creditLimit: "1000000000.00" }, tx);
      assert("updateCustomer creditLimit", custUpd.creditLimit === "1000000000.00");

      const custDetail = await getCustomer(actor, cust.id, tx);
      assert("getCustomer accountName", custDetail.accountName === "Akun Diubah");

      const custList = await listCustomers(actor, { search: "CUST" }, tx);
      assert("listCustomers >= 1", custList.length >= 1);

      await expectError("getCustomer tidak ada", tx, "NOT_FOUND", () => getCustomer(actor, fake, tx));

      /* -------- Permission -------- */
      await expectError("createAccount tanpa izin", tx, "FORBIDDEN", () =>
        createAccount({ ...actor, grants: [] }, { code: "NOPE", name: "Nope", type: "prospect" }, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-crm] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-crm] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
