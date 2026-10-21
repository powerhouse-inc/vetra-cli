/**
 * The account menu, top right of the Studio page (spec §5.3, §5.6): who is
 * signed in, Settings, and sign in / sign out.
 */
import { useEffect, useRef, useState } from "react";

export function AccountMenu({
  name,
  hasUser,
  onSignIn,
  onSignOut,
  onOpenSettings,
}: {
  name: string | undefined;
  hasUser: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as globalThis.Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  const initial = (name ?? "").trim().charAt(0).toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-card px-1 pr-2.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        <span
          aria-hidden
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-vetra-primary text-[10px] font-semibold text-vetra-primary-fg"
        >
          {initial || "·"}
        </span>
        <span className="max-w-[10rem] truncate">
          {hasUser && name ? name : "Account"}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-40 mt-1 min-w-[10rem] rounded-lg border border-border bg-card py-1 text-sm shadow-lg"
        >
          <MenuItem onSelect={() => choose(onOpenSettings)}>Settings</MenuItem>
          {hasUser ? (
            <MenuItem onSelect={() => choose(onSignOut)}>Sign out</MenuItem>
          ) : (
            <MenuItem onSelect={() => choose(onSignIn)}>Sign in</MenuItem>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onSelect,
  children,
}: {
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="block w-full px-3 py-1.5 text-left text-foreground hover:bg-accent"
    >
      {children}
    </button>
  );
}
