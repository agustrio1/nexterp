"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Settings = {
  timezone: string;
  allow_negative_stock: boolean;
  retained_earnings_account_id: string | null;
  base_currency: string;
  costing_method: string;
};

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Settings | null>(null);

  useEffect(() => {
    fetch("/api/settings", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json: { data: Settings }) => setData(json.data))
      .catch(() => toast.error("Gagal memuat pengaturan."))
      .finally(() => setLoading(false));
  }, []);

  async function onSave() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: data.timezone,
          allow_negative_stock: data.allow_negative_stock,
          retained_earnings_account_id: data.retained_earnings_account_id || undefined,
        }),
        credentials: "same-origin",
      });
      if (res.ok) toast.success("Pengaturan disimpan.");
      else toast.error("Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  if (!data) return <p className="text-sm text-zinc-500">Belum ada pengaturan.</p>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Pengaturan Aplikasi</h1>
      <Card>
        <CardHeader><CardTitle>Dapat Diubah</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tz">Timezone</Label>
            <Input id="tz" value={data.timezone} onChange={(e) => setData({ ...data, timezone: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="negStock"
              type="checkbox"
              checked={data.allow_negative_stock}
              onChange={(e) => setData({ ...data, allow_negative_stock: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-300"
            />
            <Label htmlFor="negStock">Izinkan stok negatif</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reAcc">Retained Earnings Account ID</Label>
            <Input
              id="reAcc"
              value={data.retained_earnings_account_id ?? ""}
              onChange={(e) => setData({ ...data, retained_earnings_account_id: e.target.value || null })}
              placeholder="UUID akun ekuitas"
            />
          </div>
          <Button onClick={() => void onSave()} loading={saving}>Simpan</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Hanya Baca</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <p><strong>Base Currency:</strong> {data.base_currency}</p>
          <p><strong>Costing Method:</strong> {data.costing_method}</p>
          <p className="text-xs text-zinc-400 mt-2">Mengubah nilai ini setelah ada transaksi akan merusak konsistensi.</p>
        </CardContent>
      </Card>
    </div>
  );
}
