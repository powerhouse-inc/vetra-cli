export type Crumb = { label: string; onClick?: () => void };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      {items.map((item, i) => (
        <span key={`${i}-${item.label}`} className="flex items-center gap-2">
          {i > 0 ? <span className="text-vetra-border">›</span> : null}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className="text-vetra-muted-fg hover:text-vetra-fg hover:underline"
            >
              {item.label}
            </button>
          ) : (
            <span className="font-medium text-vetra-fg">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
