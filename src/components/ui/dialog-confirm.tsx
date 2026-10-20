"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function DialogConfirm({
  trigger,
  title = "Konfirmasi",
  description,
  confirmLabel = "Ya, lanjutkan",
  cancelLabel = "Batal",
  destructive,
  onConfirm,
}: {
  trigger: ReactNode;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
            {description && (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                variant={destructive ? "destructive" : "default"}
                size="sm"
                onClick={() => void handleConfirm()}
                loading={loading}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
