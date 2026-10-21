"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Stage = { id: string; name: string; position: number; probability: string; isActive: boolean };
type Opportunity = { id: string; title: string; accountName: string; stageId: string; amount: string | null; currency: string | null; expectedCloseDate: string | null; assignedToName: string | null; probability: string | null; status: string };

function money(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${currency ?? "IDR"} ${n.toLocaleString("id-ID")}`;
}

export default function CrmPipelinePage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [sRes, oRes] = await Promise.all([
        fetch("/api/crm/pipeline-stages", { credentials: "same-origin" }),
        fetch("/api/crm/opportunities?status=open", { credentials: "same-origin" }),
      ]);
      const sJson = sRes.ok ? ((await sRes.json()) as { data: Stage[] }) : { data: [] };
      const oJson = oRes.ok ? ((await oRes.json()) as { data: Opportunity[] }) : { data: [] };
      setStages(sJson.data);
      setOpps(oJson.data);
    } catch {
      toast.error("Gagal memuat pipeline.");
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/pipeline-stages", { credentials: "same-origin" }),
      fetch("/api/crm/opportunities?status=open", { credentials: "same-origin" }),
    ])
      .then(async ([sRes, oRes]) => {
        const sJson = sRes.ok ? ((await sRes.json()) as { data: Stage[] }) : { data: [] };
        const oJson = oRes.ok ? ((await oRes.json()) as { data: Opportunity[] }) : { data: [] };
        setStages(sJson.data);
        setOpps(oJson.data);
      })
      .catch(() => toast.error("Gagal memuat pipeline."))
      .finally(() => setLoading(false));
  }, []);

  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const s of stages) map.set(s.id, []);
    for (const o of opps) {
      const list = map.get(o.stageId);
      if (list) list.push(o);
      else map.set(o.stageId, [o]);
    }
    return map;
  }, [stages, opps]);

  async function onDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    setDragOverStage(null);
    const oppId = e.dataTransfer.getData("text/plain");
    if (!oppId) return;
    const opp = opps.find((o) => o.id === oppId);
    if (opp && opp.stageId === stageId) return;
    try {
      const res = await fetch(`/api/crm/opportunities/${oppId}/move-stage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageId }), credentials: "same-origin",
      });
      if (res.ok) { toast.success("Peluang dipindahkan."); await load(); }
      else { const e2 = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; toast.error(e2?.error?.message ?? "Gagal memindahkan."); }
    } catch { toast.error("Koneksi terganggu."); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pipeline Penjualan</h1>
        <Link href="/crm/opportunities/new"><Button size="sm"><Plus className="h-4 w-4" /> Peluang Baru</Button></Link>
      </div>
      <p className="text-sm text-zinc-500">Seret kartu peluang antar kolom untuk memindahkan tahap.</p>

      {stages.length === 0 && <p className="text-zinc-500">Belum ada tahap pipeline.</p>}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const cards = byStage.get(stage.id) ?? [];
          const total = cards.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.id); }}
              onDragLeave={() => setDragOverStage((cur) => (cur === stage.id ? null : cur))}
              onDrop={(e) => void onDrop(e, stage.id)}
              className={`flex w-72 shrink-0 flex-col rounded-lg border p-3 transition-colors ${dragOverStage === stage.id ? "border-blue-400 bg-blue-50/60 dark:bg-blue-950/30" : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-medium text-zinc-900 dark:text-zinc-100">{stage.name}</h2>
                  <p className="text-xs text-zinc-500">Probabilitas {stage.probability}%</p>
                </div>
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((o) => (
                  <div
                    key={o.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
                    className="cursor-grab rounded-md border border-zinc-200 bg-white p-3 shadow-sm active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    <Link href={`/crm/opportunities/${o.id}`} className="block">
                      <p className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">{o.title}</p>
                      <p className="text-xs text-zinc-500">{o.accountName}</p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{money(o.amount, o.currency)}</span>
                        {o.expectedCloseDate && <span className="text-zinc-400">{o.expectedCloseDate.slice(0, 10)}</span>}
                      </div>
                      {o.assignedToName && <p className="mt-1 text-xs text-zinc-400">👤 {o.assignedToName}</p>}
                    </Link>
                  </div>
                ))}
                {cards.length === 0 && <p className="py-4 text-center text-xs text-zinc-400">Letakkan peluang di sini.</p>}
              </div>
              {cards.length > 0 && (
                <p className="mt-2 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-700">Total: {total.toLocaleString("id-ID")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
