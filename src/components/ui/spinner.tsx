import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <Loader2
      className={cn("animate-spin text-zinc-400", className)}
      style={{ width: size, height: size }}
      aria-label="Memuat..."
    />
  );
}
