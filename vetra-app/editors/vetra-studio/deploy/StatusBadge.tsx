/** Status display config. Class strings are literal so Tailwind keeps them. */
type StatusConfig = { label: string; dot: string };

const STATUS: Record<string, StatusConfig> = {
  DRAFT: {
    label: "Draft",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  CHANGES_PENDING: {
    label: "Changes pending",
    dot: "bg-warning",
    badge: "bg-warning/15 text-warning",
  },
  CHANGES_APPROVED: {
    label: "Approved",
    dot: "bg-info",
    badge: "bg-info/15 text-info",
  },
  CHANGES_PUSHED: {
    label: "Deploying",
    dot: "bg-warning",
    badge: "bg-warning/15 text-warning",
  },
  DEPLOYING: {
    label: "Deploying",
    dot: "bg-warning",
    badge: "bg-warning/15 text-warning",
  },
  // Note: the model enum spells this `DEPLOYMENt_FAILED`.
  DEPLOYMENt_FAILED: {
    label: "Failed",
    dot: "bg-destructive",
    badge: "bg-destructive/15 text-destructive",
  },
  READY: {
    label: "Ready",
    dot: "bg-success",
    badge: "bg-success/15 text-success",
  },
  TERMINATING: {
    label: "Terminating",
    dot: "bg-warning",
    badge: "bg-warning/15 text-warning",
  },
  DESTROYED: {
    label: "Destroyed",
    dot: "bg-destructive",
    badge: "bg-destructive/15 text-destructive",
  },
  ARCHIVED: {
    label: "Archived",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  STOPPED: {
    label: "Stopped",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
};

function configFor(status: string): StatusConfig {
  return (
    STATUS[status] ?? {
      label: status.replace(/_/g, " "),
      dot: "bg-muted-foreground",
    }
  );
}

/** Soft pill — used in the detail header. */
export function StatusBadge({ status }: { status: string }) {
  const { label, badge } = configFor(status);
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}
    >
      {label}
    </span>
  );
}

/** Colored dot + label — used in the environment cards. */
export function StatusDot({ status }: { status: string }) {
  const { label, dot } = configFor(status);
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
