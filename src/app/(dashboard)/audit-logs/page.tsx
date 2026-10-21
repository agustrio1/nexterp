"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";

type Log = { id: string; at: string; action: string; entityType: string; entityId: string | null; actorId: string | null; actorName?: string | null };

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("");
  const [actionPrefix, setActionPrefix] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = new URLSearchParams();
  if (entityType) params.set("entityType", entityType);
  if (actionPrefix) params.set("actionPrefix", actionPrefix);
  params.set("limit", "50");
  const qs = params.toString();
  const url = `/api/audit-logs?${qs}`;

  const columns: Column<Log>[] = [
    { header: "Waktu", cell: (r) => <span className="whitespace-nowrap text-xs">{new Date(r.at).toLocaleString("id-ID")}</span> },
    { header: "Aksi", cell: (r) => <code className="text-xs">{r.action}</code> },
    { header: "Entitas", cell: (r) => <span className="text-xs">{r.entityType}{r.entityId ? ` (${r.entityId.slice(0, 8)}…)` : ""}</span> },
    { header: "Pelaku", cell: (r) => r.actorName ?? r.actorId?.slice(0, 8) ?? "sistem" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit Log</h1>
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Filter entityType…"
          className="w-44"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setRefreshKey((k) => k + 1); }}
          onBlur={() => setRefreshKey((k) => k + 1)}
        />
        <Input
          placeholder="Prefix aksi (mis. user.)…"
          className="w-52"
          value={actionPrefix}
          onChange={(e) => setActionPrefix(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setRefreshKey((k) => k + 1); }}
          onBlur={() => setRefreshKey((k) => k + 1)}
        />
      </div>
      <DataTable<Log> key={refreshKey} url={url} columns={columns} rowKey={(r) => r.id} emptyMessage="Tidak ada log." />
    </div>
  );
}
