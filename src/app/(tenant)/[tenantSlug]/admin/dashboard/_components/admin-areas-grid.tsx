import { NavTile } from './nav-tile'

interface AdminAreasGridProps {
  title: string
  tiles: { href: string; title: string }[]
}

export function AdminAreasGrid({ title, tiles }: AdminAreasGridProps) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h2>
      <div className="grid grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <NavTile key={tile.href} href={tile.href} title={tile.title} />
        ))}
      </div>
    </div>
  )
}
