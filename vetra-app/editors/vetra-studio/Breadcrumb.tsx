export type Crumb = { label: string; onClick?: () => void };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      {items.map((item, i) => (
        <span key={`${i}-${item.label}`} className="flex items-center gap-2">
          {i > 0 ? <span className="text-gray-300">›</span> : null}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className="text-gray-500 hover:text-gray-800 hover:underline"
            >
              {item.label}
            </button>
          ) : (
            <span className="font-medium text-gray-800">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
