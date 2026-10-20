import { loadGrants, requireSession, type AuthContext } from "@/server/authz";

/**
 * Aktor lengkap untuk service: identitas dari sesi ditambah izin (grants) dari database.
 * requireSession() melempar UNAUTHENTICATED (401) bila tidak ada sesi yang valid.
 * Izin dibaca ulang pada setiap pemanggilan, sehingga perubahan role langsung berlaku.
 */
export async function requireActor(): Promise<AuthContext> {
  const session = await requireSession();
  const grants = await loadGrants(session.userId);

  return {
    userId: session.userId,
    name: session.name,
    email: session.email,
    grants,
  };
}