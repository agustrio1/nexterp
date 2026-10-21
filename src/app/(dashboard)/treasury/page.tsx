import { redirect } from "next/navigation";

export default function TreasuryIndexPage() {
  redirect("/treasury/bank-accounts");
}
