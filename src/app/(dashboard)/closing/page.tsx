"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  readError, fetchFiscalYears,
  FY_STATUS_LABEL,
  type FiscalYear,
} from "@/app/(dashboard)/budget-tax/_shared";

export default function ClosingEntriesPage() {
  const router = useRouter();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fiscalYearId, setFiscalYearId] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  useEffect(() => {
    let ignore = false;
    fetchFiscalYears()
      .then((y) => { if (!ignore) setYears(y); })
      .catch(() => { if (!ignore) toast.error("Gagal memuat tahun fiskal."); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fiscalYearId) { toast.error("Pilih tahun fiskal."); return; }
    const body: Record<string, unknown> = { fiscalYearId };
    if (description.trim()) body.description = description.trim();
    if (reference.trim()) body.reference = reference.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/closing-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) {
        const j = (await res.json()) as { data?: { id?: string } };
        toast.success("Draf jurnal penutup dibuat. Buka untuk memeriksa lalu posting.");
        const id = j?.data?.id;
        if (id) router.push(`/journal-entries/${id}`);
      } else toast.error(await readError(res));
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Penutupan Tahun Fiskal</h1>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p>Menekan <strong>Buat Draf Jurnal Penutup</strong> menghitung otomatis baris penutupan (menolkan seluruh saldo pendapatan &amp; beban ke akun laba ditahan) dan membuat <strong>draf jurnal</strong> bertanggal akhir tahun fiskal.</p>
        <ul className="mt-2 list-inside list-disc">
          <li>Akun laba ditahan harus diatur lebih dulu di Pengaturan (<code>retained_earnings_account_id</code>).</li>
          <li>Periode akhir tahun belum boleh berstatus <code>closed</code>.</li>
          <li>Setelah draf dibuat, periksa lalu posting lewat halaman <Link href="/journal-entries" className="underline">Jurnal</Link>.</li>
          <li>Menutup tahun fiskal (status) dilakukan lewat halaman Tahun Fiskal setelah jurnal penutup terposting &amp; semua periode closed.</li>
        </ul>
      </div>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4">
        <div className="space-y-1"><label className="text-sm font-medium">Tahun fiskal *</label>
          <Select value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)}>
            <option value="">—</option>
            {years.filter((y) => y.status !== "closed").map((y) => <option key={y.id} value={y.id}>{y.code} ({FY_STATUS_LABEL[y.status] ?? y.status})</option>)}
          </Select></div>
        <div className="space-y-1"><label className="text-sm font-medium">Referensi</label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Deskripsi</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kosong = default" /></div>
        <div className="flex items-end gap-2 sm:col-span-4">
          <Button type="submit" loading={saving}>Buat Draf Jurnal Penutup</Button>
          <Link href="/fiscal-years"><Button type="button" variant="outline">Ke Tahun Fiskal</Button></Link>
        </div>
      </form>
    </div>
  );
}
