import { auth } from "@/app/auth"

export default auth

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
}
