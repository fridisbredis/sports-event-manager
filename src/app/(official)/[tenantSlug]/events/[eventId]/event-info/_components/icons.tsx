// Stands in for a tenant that has not uploaded a logo. A filled theme-gradient
// plate rather than the old grey "missing image" cross: on a screen whose whole
// job is to introduce the event, a broken-image mark is a poor first
// impression, while the plate reads as the event's mark either way.
//
// The 135deg primary-to-secondary gradient is the same one the admin
// dashboard's logo tile uses (dashboard-header.tsx), so a tenant with no logo
// is marked identically on both sides of the app.
export function LogoPlaceholder({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage:
          'linear-gradient(135deg, hsl(var(--tenant-primary)), hsl(var(--tenant-secondary)))',
      }}
      aria-hidden="true"
      className="shrink-0 rounded-xl"
    />
  )
}
