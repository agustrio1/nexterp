"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

type Meta = { limit: number; cursor: string | null; nextCursor: string | null; hasMore: boolean };

async function fetchPageData<T>(
  url: string,
  cursor: string | null,
): Promise<{ data: T[]; meta: Meta | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const sep = url.includes("?") ? "&" : "?";
  const qs = params.toString();
  const fullUrl = qs ? `${url}${sep}${qs}` : url;
  const res = await fetch(fullUrl, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data: T[]; meta?: Meta; items?: T[] };
  // Normalize: support both { data, meta } and { data } (non-paginated).
  return { data: json.data ?? json.items ?? [], meta: json.meta ?? null };
}

export function DataTable<T>({
  url,
  columns,
  rowKey,
  emptyMessage,
}: {
  url: string;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [retryKey, setRetryKey] = useState(0);

  const activeCursor = cursorHistory[cursorHistory.length - 1];

  // All setState calls are in async callbacks — not synchronous in effect body.
  useEffect(() => {
    let cancelled = false;
    fetchPageData<T>(url, activeCursor)
      .then((result) => {
        if (cancelled) return;
        setRows(result.data);
        setMeta(result.meta);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Gagal memuat data.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, activeCursor, retryKey]);

  function handleRetry() {
    setLoading(true);
    setRetryKey((k) => k + 1);
  }

  function nextPage() {
    if (!meta?.hasMore) return;
    const next = meta.nextCursor;
    if (!next) return;
    setLoading(true);
    setCursorHistory((prev) => [...prev, next]);
  }

  function prevPage() {
    if (cursorHistory.length <= 1) return;
    setLoading(true);
    setCursorHistory((prev) => prev.slice(0, -1));
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={handleRetry} />;
  }

  if (!loading && rows.length === 0) {
    return <EmptyState description={emptyMessage ?? "Belum ada data untuk ditampilkan."} />;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                {columns.map((col, i) => (
                  <td key={i} className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination controls — only shown for paginated responses */}
      {meta && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {rows.length} baris{meta.hasMore ? " + berikutnya" : ""}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={prevPage}
              disabled={cursorHistory.length <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={nextPage}
              disabled={!meta.hasMore || loading}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {loading && rows.length > 0 && (
        <div className="flex justify-center py-2">
          <Spinner size={18} />
        </div>
      )}
    </div>
  );
}
