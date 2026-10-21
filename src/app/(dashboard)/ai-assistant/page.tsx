"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Meta = { model: string; inputTokens: number; outputTokens: number; durationMs: number };
type ReportResult = {
  answer: string;
  report: { key: string; label: string; filter: unknown; source: string };
  data: unknown;
  meta: Meta;
  disclaimer: string;
};
type AnalysisResult = {
  answer: string;
  analysis: { key: string; label: string; params: unknown; source: string };
  metrics: Record<string, string | number>;
  series: Array<Record<string, string | number>>;
  flags: Array<Record<string, string | number>>;
  meta: Meta;
  disclaimer: string;
};

type Mode = "report" | "analysis";

const ENDPOINTS: Record<Mode, string> = {
  report: "/api/ai/assistant/report-query",
  analysis: "/api/ai/assistant/analyze",
};

const EXAMPLES: Record<Mode, string[]> = {
  report: [
    "Berapa total penjualan bulanan per pelanggan?",
    "Tampilkan umur piutang saat ini",
    "How much did we pay suppliers this year?",
  ],
  analysis: [
    "Tren penjualan beberapa bulan terakhir",
    "Produk mana yang mendekati titik pesan ulang?",
    "Analisis anomali piutang jatuh tempo",
  ],
};

async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (j?.error?.message) return j.error.message;
  if (res.status === 403) return "Anda tidak punya izin untuk asisten AI (ai.assistant.use) atau laporan sumbernya.";
  if (res.status === 429) return "Kuota AI terlampaui. Coba lagi nanti.";
  return `Permintaan gagal (${res.status}).`;
}

/** Tabel generik: kolom diturunkan dari kunci baris pertama. */
function DynTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows || rows.length === 0) return <p className="py-2 text-sm text-zinc-400">Tidak ada baris data.</p>;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
            {cols.map((c) => <th key={c} className="py-2 pr-4 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
              {cols.map((c) => {
                const v = r[c];
                return <td key={c} className="py-2 pr-4 font-mono">{v === null || v === undefined ? "—" : String(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function MetaLine({ meta }: { meta: Meta }) {
  return (
    <p className="text-xs text-zinc-400">
      Model: <span className="font-mono">{meta.model || "—"}</span> · Token ↑{meta.inputTokens}/↓{meta.outputTokens} · {meta.durationMs} ms
    </p>
  );
}

export default function AiAssistantPage() {
  const [mode, setMode] = useState<Mode>("report");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null); setReport(null); setAnalysis(null);
  }

  async function ask() {
    const q = question.trim();
    if (q.length < 3) { setError("Pertanyaan terlalu pendek (minimal 3 karakter)."); return; }
    setLoading(true); setError(null); setReport(null); setAnalysis(null);
    try {
      const res = await fetch(ENDPOINTS[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        credentials: "same-origin",
      });
      if (!res.ok) { setError(await readError(res)); return; }
      const json = (await res.json()) as { data: ReportResult | AnalysisResult };
      if (mode === "report") setReport(json.data as ReportResult);
      else setAnalysis(json.data as AnalysisResult);
    } catch {
      setError("Koneksi terganggu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Asisten AI</h1>
      <p className="text-sm text-zinc-500">
        Tanyakan laporan atau analisis dengan bahasa alami. <b>Angka selalu dihitung oleh service laporan</b> — AI hanya meringkas dan menjelaskan, bukan sumber kebenaran.
      </p>

      {/* Mode */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button onClick={() => switchMode("report")} className={`-mb-px border-b-2 px-3 py-2 text-sm ${mode === "report" ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>Tanya Laporan</button>
        <button onClick={() => switchMode("analysis")} className={`-mb-px border-b-2 px-3 py-2 text-sm ${mode === "analysis" ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>Analisis</button>
      </div>

      {/* Input */}
      <Card>
        <CardContent className="space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={8000}
            placeholder={mode === "report" ? "Contoh: Berapa total penjualan bulanan per pelanggan?" : "Contoh: Tren penjualan beberapa bulan terakhir"}
            className="w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={ask} loading={loading}>{mode === "report" ? "Tanyakan Laporan" : "Jalankan Analisis"}</Button>
            <div className="flex flex-wrap gap-1">
              {EXAMPLES[mode].map((ex) => (
                <button key={ex} onClick={() => setQuestion(ex)} className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">{ex}</button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={28} /></div>
      ) : error ? (
        <Card><CardContent className="py-5 text-sm text-red-600">{error}</CardContent></Card>
      ) : report ? (
        <Card>
          <CardHeader><CardTitle>Jawaban · {report.report.label}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{report.answer}</p>
            <p className="text-xs text-zinc-400">Laporan sumber: <span className="font-mono">{report.report.key}</span> · Filter: <span className="font-mono">{JSON.stringify(report.report.filter)}</span></p>
            <DynTable rows={toRows(report.data)} />
            <MetaLine meta={report.meta} />
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{report.disclaimer}</p>
          </CardContent>
        </Card>
      ) : analysis ? (
        <Card>
          <CardHeader><CardTitle>Jawaban · {analysis.analysis.label}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{analysis.answer}</p>
            <p className="text-xs text-zinc-400">Analisis sumber: <span className="font-mono">{analysis.analysis.key}</span> · Parameter: <span className="font-mono">{JSON.stringify(analysis.analysis.params)}</span></p>
            {Object.keys(analysis.metrics).length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(analysis.metrics).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                    <p className="text-xs text-zinc-500">{k}</p>
                    <p className="font-mono text-sm font-semibold">{String(v)}</p>
                  </div>
                ))}
              </div>
            )}
            {analysis.series.length > 0 && (
              <div><p className="mb-1 text-xs font-medium uppercase text-zinc-500">Seri</p><DynTable rows={analysis.series} /></div>
            )}
            {analysis.flags.length > 0 && (
              <div><p className="mb-1 text-xs font-medium uppercase text-zinc-500">Tanda / Anomali</p><DynTable rows={analysis.flags} /></div>
            )}
            <MetaLine meta={analysis.meta} />
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{analysis.disclaimer}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
