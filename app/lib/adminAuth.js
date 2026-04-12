import { auth } from "@/app/auth";

export async function checkAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(session.user.email.toLowerCase())) return null;
  return session;
}
