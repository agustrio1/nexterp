"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

type ApiFieldError = { path: string; message: string };

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: ApiFieldError[];
  };
};

/**
 * Helper submit form ke API endpoint.
 * - Menangani error validasi server → set per-field error di RHF.
 * - Toast error generik bila bukan validation error.
 * - Redirect ke `redirectTo` setelah sukses.
 */
export function useFormSubmit<T extends FieldValues>(options: {
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  redirectTo?: string;
  successMessage?: string;
  setError: UseFormSetError<T>;
}) {
  const router = useRouter();
  const { url, method = "POST", redirectTo, successMessage, setError } = options;

  async function submit(values: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "same-origin",
      });

      if (res.ok) {
        if (successMessage) toast.success(successMessage);
        if (redirectTo) router.push(redirectTo);
        return true;
      }

      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      const err = body?.error;

      if (err?.code === "VALIDATION_FAILED" && err.details) {
        for (const d of err.details) {
          if (d.path) {
            setError(d.path as Path<T>, { message: d.message }, { shouldFocus: true });
          }
        }
        toast.error(err.message ?? "Data tidak valid.");
      } else {
        const msg = err?.message ?? `Request gagal (${res.status}).`;
        toast.error(msg);
      }
      return false;
    } catch {
      toast.error("Koneksi terganggu. Coba lagi.");
      return false;
    }
  }

  return submit;
}
