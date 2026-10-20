import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/session";
import { loadGrants } from "@/server/authz";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export const instant = false;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  const grants = await loadGrants(session.user.id);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Sidebar grants={grants} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header name={session.user.name} email={session.user.email} />
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
