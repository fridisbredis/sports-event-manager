import { NavTile } from './nav-tile'

interface AdminAreasGridProps {
  title: string
  tiles: { href: string; title: string }[]
}

export function AdminAreasGrid({ title, tiles }: AdminAreasGridProps) {
  return (
    <div>
      <h2 className="section-label mb-4">{title}</h2>
      {/* auto-fill rather than a fixed 3 columns, per the handoff — the tiles
          reflow instead of being squeezed on a narrow window. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {tiles.map((tile) => (
          <NavTile key={tile.href} href={tile.href} title={tile.title} />
        ))}
      </div>
    </div>
  )
}
