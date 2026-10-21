import { redirect } from "next/navigation";

/** Halaman utama Payroll dialihkan ke daftar run payroll. */
export default function PayrollIndexPage() {
  redirect("/payroll/runs");
}
