import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Selamat datang</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Gunakan menu di samping untuk menavigasi modul ERP. Halaman fungsional akan
            dikembangkan pada tahap U2–U6.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
