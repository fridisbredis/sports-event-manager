import { Card, CardBody, type CardProps } from '@heroui/react'

// A thin wrapper around HeroUI's Card/CardBody so every "white panel on the
// gray admin background" in the app shares one shadow/radius/padding
// definition. Before this existed, panels were hand-built as
// `<div className="rounded-xl border border-gray-200 bg-white shadow-md">`,
// which drifted from HeroUI's own Card (shadow-medium/rounded-large) because
// Tailwind's shadow-md/rounded-xl are different values than HeroUI's design
// tokens of the same name. Always reach for this instead of a raw div.
export function AppCard({
  children,
  className,
  bodyClassName,
  ...props
}: CardProps & { bodyClassName?: string }) {
  return (
    <Card className={className} {...props}>
      <CardBody className={bodyClassName ?? 'p-6'}>{children}</CardBody>
    </Card>
  )
}
