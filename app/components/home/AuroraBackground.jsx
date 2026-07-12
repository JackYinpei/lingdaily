// Fixed rainbow-aurora background with film grain, driven entirely by the brand
// CSS variables in globals.css so it follows the active theme automatically.
export default function AuroraBackground() {
  return (
    <div
      aria-hidden
      className="bg-aurora grain-overlay pointer-events-none fixed inset-0 -z-10"
    />
  )
}
