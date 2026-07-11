import { auth } from "@/app/auth"
import { redirect } from "next/navigation"

export default async function TalkLayout({ children }) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in?callbackUrl=/talk")
  }
  return children
}
