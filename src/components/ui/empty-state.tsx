import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title = "Tidak ada data",
  description,
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" aria-hidden />
      <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{description}</p>
      )}
    </div>
  );
}
