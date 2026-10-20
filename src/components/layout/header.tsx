"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Header({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
    });
    router.replace("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{email}</p>
        </div>
      </div>

      <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
        <LogOut className="h-4 w-4" aria-hidden />
        Keluar
      </Button>
    </header>
  );
}
