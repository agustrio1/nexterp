"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DialogConfirm } from "@/components/ui/dialog-confirm";

type JournalLine = {
  id: string; lineNo: number; accountId: string; accountCode: string;
  accountName: string; debit: string; credit: string; memo: string | null;
};

type JournalDetail = {
  id: string; docNo: string | null; entryDate: string; status: string;
  description: string; reference: string | null; totalDebit: string | null;
  totalCredit: string | null; postedAt: string | null; reason: string | null;
  lines?: JournalLine[];
};

export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/journals/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: JournalDetail }) => setJournal(json.data))
      .catch(() => toast.error("Gagal memuat jurnal."))
      .finally(() => setLoading(false));
  }, [id]);

  async function doAction(url: string, body?: unknown) {
    setActionLoading(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      });
      if (res.ok) {
        const json = (await res.json()) as { data: JournalDetail };
        setJournal(json.data);
        toast.success("Aksi berhasil.");
      } else {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(err?.error?.message ?? "Aksi gagal.");
      }
    } catch {
      toast.error("Koneksi terganggu.");
    } finally {
      setActionLoading(false);
      setReverseReason("");
      setCancelReason("");
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!journal) return <p className="text-red-600">Jurnal tidak ditemukan.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/journal-entries"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">
          {journal.docNo ?? "Draf Jurnal"}
        </h1>
        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{journal.status}</span>
      </div>

      {/* Header info */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div><span className="font-medium text-zinc-500">Tanggal:</span> {journal.entryDate}</div>
        <div><span className="font-medium text-zinc-500">Referensi:</span> {journal.reference ?? "—"}</div>
        <div className="col-span-2"><span className="font-medium text-zinc-500">Deskripsi:</span> {journal.description}</div>
        {journal.totalDebit && <div><span className="font-medium text-zinc-500">Total Debit:</span> {journal.totalDebit}</div>}
        {journal.totalCredit && <div><span className="font-medium text-zinc-500">Total Kredit:</span> {journal.totalCredit}</div>}
        {journal.postedAt && <div><span className="font-medium text-zinc-500">Diposting:</span> {new Date(journal.postedAt).toLocaleString("id-ID")}</div>}
        {journal.reason && <div className="col-span-2"><span className="font-medium text-zinc-500">Alasan:</span> {journal.reason}</div>}
      </div>

      {/* Lines */}
      {journal.lines && journal.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Akun</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Kredit</th>
                <th className="px-3 py-2 text-left">Memo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {journal.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-zinc-500">{l.lineNo}</td>
                  <td className="px-3 py-2"><code className="text-xs">{l.accountCode}</code> {l.accountName}</td>
                  <td className="px-3 py-2 text-right">{l.debit !== "0.00" ? l.debit : ""}</td>
                  <td className="px-3 py-2 text-right">{l.credit !== "0.00" ? l.credit : ""}</td>
                  <td className="px-3 py-2 text-zinc-500">{l.memo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {journal.status === "draft" && (
          <>
            <Link href={`/journal-entries/${journal.id}/edit`}>
              <Button variant="outline" size="sm">Edit Draf</Button>
            </Link>
            <DialogConfirm
              trigger={<Button size="sm" loading={actionLoading}>Posting</Button>}
              title="Posting jurnal?"
              description="Jurnal akan berubah menjadi posted dan tidak dapat diubah lagi."
              onConfirm={() => doAction(`/api/journals/${journal.id}/post`)}
            />
            <div className="space-y-2">
              <Input placeholder="Alasan pembatalan (min 5 karakter)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-64" />
              <DialogConfirm
                trigger={<Button variant="outline" size="sm" className="text-red-600">Batalkan</Button>}
                title="Batalkan jurnal draf?"
                description="Jurnal tidak dapat diubah atau diposting setelah dibatalkan."
                destructive
                onConfirm={() => doAction(`/api/journals/${journal.id}/cancel`, { reason: cancelReason })}
              />
            </div>
          </>
        )}
        {journal.status === "posted" && (
          <div className="space-y-2">
            <Input placeholder="Alasan reversal (min 5 karakter)" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className="w-64" />
            <DialogConfirm
              trigger={<Button variant="outline" size="sm" className="text-red-600">Reversal</Button>}
              title="Reversal jurnal?"
              description="Akan membuat jurnal pembalik dan status jurnal asal menjadi reversed."
              destructive
              onConfirm={() => doAction(`/api/journals/${journal.id}/reverse`, { reason: reverseReason })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
