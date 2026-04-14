import { redirect } from "next/navigation";
import { checkAdmin } from "@/app/lib/adminAuth";

export default async function AdminLayout({ children }) {
  const session = await checkAdmin();
  if (!session) redirect("/");
  return <>{children}</>;
}
