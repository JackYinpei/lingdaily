// Server startup hook (Next.js instrumentation). See instrumentation-node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node.js')
}
