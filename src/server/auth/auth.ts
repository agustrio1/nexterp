import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { env } from "@/config/env";
import * as schema from "@/db/schema";
import { db } from "@/server/db";

import { checkLoginGate, recordLoginFailure, recordLoginSuccess } from "./lockout";
import { hashPassword, verifyPassword } from "./password";

const SIGN_IN_PATH = "/sign-in/email";
const INVALID_CREDENTIALS_MESSAGE = "Email atau kata sandi salah.";

function emailFromBody(body: unknown): string {
  if (typeof body === "object" && body !== null && "email" in body && typeof body.email === "string") {
    return body.email;
  }
  return "";
}

export const auth = betterAuth({
  appName: "ERP",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],

  database: drizzleAdapter(db, {
    provider: "pg",
    // Pemetaan eksplisit nama model Better Auth ke tabel Drizzle milik kita.
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      rateLimit: schema.rateLimits,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // ERP tertutup: pengguna dibuat oleh admin, bukan mendaftar sendiri.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
    password: {
      hash: (password) => hashPassword(password),
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },

  user: {
    additionalFields: {
      // Dibaca saat memvalidasi sesi (akun suspended). Tidak boleh diisi dari klien.
      status: { type: "string", required: false, defaultValue: "active", input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 8, // 8 jam
    updateAge: 60 * 60, // perpanjang tiap 1 jam aktivitas
    // cookieCache sengaja tidak diaktifkan: penonaktifan user/pencabutan sesi harus langsung berlaku.
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
    },
  },

  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "erp",
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;

      const gate = await checkLoginGate(emailFromBody(ctx.body));

      if (gate === "locked") {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.",
        });
      }
      if (gate === "blocked") {
        // Pesan sama dengan password salah agar status akun tidak bocor.
        throw new APIError("UNAUTHORIZED", { message: INVALID_CREDENTIALS_MESSAGE });
      }
    }),

    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;

      const newSession = ctx.context.newSession;
      if (newSession) {
        await recordLoginSuccess(newSession.user.id);
        return;
      }

      if (ctx.context.returned instanceof APIError) {
        await recordLoginFailure(emailFromBody(ctx.body));
      }
    }),
  },

  // nextCookies harus menjadi plugin terakhir.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;