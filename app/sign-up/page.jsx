import SignUpClient from "./sign-up-client"

export default function SignUpPage() {
  const linuxDoEnabled = Boolean(process.env.AUTH_LINUXDO_ID && process.env.AUTH_LINUXDO_SECRET)
  return <SignUpClient linuxDoEnabled={linuxDoEnabled} />
}
