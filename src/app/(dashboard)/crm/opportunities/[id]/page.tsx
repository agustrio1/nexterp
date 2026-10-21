"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DialogConfirm } from "@/components/ui/dialog-confirm";

type Opportunity = { id: string; accountId: string; accountName: string; title: string; stageId: string; stageName: string; status: string; amount: string | null; currency: string | null; expectedCloseDate: string | null; assignedTo: string | null; assignedToName: string | null; probability: string | null; isActive: boolean };
type Stage = { id: string; name: string };
type User = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  open: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  won: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  lost: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);

  const [moveStageId, setMoveStageId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [probability, setProbability] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/crm/opportunities/${id}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j: { data: Opportunity }) => {
        setOpp(j.data);
        setTitle(j.data.title);
        setAmount(j.data.amount ?? "");
        setCurrency(j.data.currency ?? "");
        setExpectedCloseDate(j.data.expectedCloseDate ? j.data.expectedCloseDate.slice(0, 10) : "");
        setAssignedTo(j.data.assignedTo ?? "");
        setProbability(j.data.probability ?? "");
        setMoveStageId(j.data.stageId);
      })
      .catch(() => toast.error("Gagal memuat peluang."))
      .finally(() => setLoading(false));
    Promise.all([
      fetch("/api/crm/pipeline-stages", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/users?status=active&limit=100", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([s, u]: [{ data: Stage[] }, { data: User[] }]) => { setStages(s.data); setUsers(u.data); })
      .catch(() => {});
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!opp) return;
    if (title.trim().length < 2) { toast.error("Judul peluang minimal 2 karakter."); return; }
    if (amount && !/^\d{1,14}(\.\d{1,2})?$/.test(amount.trim())) { toast.error("Nominal maksimal 14 digit + 2 desimal."); return; }
    if (currency && !/^[A-Za-z]{3}$/.test(currency.trim())) { toast.error("Kode mata uang harus 3 huruf."); return; }
    if (probability && !/^\d{1,3}(\.\d{1,2})?$/.test(probability.trim())) { toast.error("Probabilitas 0-100."); return; }
    const body: Record<string, unknown> = { title: title.trim() };
    if (amount) body.amount = amount.trim();
    if (currency) body.currency = currency.trim().toUpperCase();
    if (expectedCloseDate) body.expectedCloseDate = expectedCloseDate;
    if (assignedTo) body.assignedTo = assignedTo;
    if (probability) body.probability = probability.trim();
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${opp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Opportunity }; setOpp(j.data); toast.success("Peluang diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setSaving(false); }
  }

  async function onMove() {
    if (!opp || !moveStageId || moveStageId === opp.stageId) return;
    setMoving(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${opp.id}/move-stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageId: moveStageId }), credentials: "same-origin" });
      if (res.ok) { const j = (await res.json()) as { data: Opportunity }; setOpp(j.data); toast.success("Tahap diperbarui."); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
    } catch { toast.error("Koneksi terganggu."); } finally { setMoving(false); }
  }

  async function onClose(status: "won" | "lost") {
    if (!opp) return;
    const res = await fetch(`/api/crm/opportunities/${opp.id}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }), credentials: "same-origin" });
    if (res.ok) { const j = (await res.json()) as { data: Opportunity }; setOpp(j.data); toast.success(status === "won" ? "Peluang dimenangkan." : "Peluang dikalahkan."); }
    else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal."); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!opp) return <p className="text-red-600">Peluang tidak ditemukan.</p>;

  const isOpen = opp.status === "open";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/opportunities"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">{opp.title}</h1>
        <span className={STATUS_STYLE[opp.status] ?? "rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"}>{opp.status}</span>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div><p className="text-zinc-500">Akun</p><Link className="text-blue-600 hover:underline" href={`/crm/accounts/${opp.accountId}`}>{opp.accountName}</Link></div>
          <div><p className="text-zinc-500">Tahap</p><p className="font-medium">{opp.stageName}</p></div>
          <div><p className="text-zinc-500">Nominal</p><p className="font-medium">{opp.amount ? `${opp.currency ?? "IDR"} ${Number(opp.amount).toLocaleString("id-ID")}` : "—"}</p></div>
          <div><p className="text-zinc-500">Est. Close</p><p className="font-medium">{opp.expectedCloseDate ? opp.expectedCloseDate.slice(0, 10) : "—"}</p></div>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Pindahkan Tahap</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Tahap</label>
              <Select value={moveStageId} onChange={(e) => setMoveStageId(e.target.value)}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <Button size="sm" onClick={() => void onMove()} loading={moving} disabled={!moveStageId || moveStageId === opp.stageId}>Pindahkan</Button>
          </div>
        </div>
      )}

      {isOpen && (
        <form onSubmit={onSave} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Ubah Peluang</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3"><label className="text-sm font-medium">Judul *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Nominal</label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Mata Uang</label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Probabilitas %</label><Input value={probability} onChange={(e) => setProbability(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Est. Close</label><Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><label className="text-sm font-medium">Ditagihkan</label>
              <Select className="w-full" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">— Tidak ditagihkan —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
          </div>
          <div><Button type="submit" loading={saving}>Simpan Perubahan</Button></div>
        </form>
      )}

      {isOpen && (
        <div className="flex gap-3">
          <DialogConfirm trigger={<Button variant="outline" size="sm">Tandai Menangkan</Button>} title="Tutup peluang sebagai Menang?" confirmLabel="Menang" onConfirm={async () => { await onClose("won"); }} />
          <DialogConfirm trigger={<Button variant="destructive" size="sm">Tutup Kalahkan</Button>} title="Tutup peluang sebagai Kalah?" confirmLabel="Kalah" destructive onConfirm={async () => { await onClose("lost"); }} />
        </div>
      )}
    </div>
  );
}
