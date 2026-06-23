/** Status display config. Class strings are literal so Tailwind keeps them. */
type StatusConfig = { label: string; dot: string; badge: string };

const STATUS: Record<string, StatusConfig> = {
  DRAFT: {
    label: "Draft",
    dot: "bg-vetra-muted-fg",
    badge: "bg-vetra-muted text-vetra-muted-fg",
  },
  CHANGES_PENDING: {
    label: "Changes pending",
    dot: "bg-vetra-warning",
    badge: "bg-vetra-warning/15 text-vetra-warning",
  },
  CHANGES_APPROVED: {
    label: "Approved",
    dot: "bg-vetra-info",
    badge: "bg-vetra-info/15 text-vetra-info",
  },
  CHANGES_PUSHED: {
    label: "Deploying",
    dot: "bg-vetra-warning",
    badge: "bg-vetra-warning/15 text-vetra-warning",
  },
  DEPLOYING: {
    label: "Deploying",
    dot: "bg-vetra-warning",
    badge: "bg-vetra-warning/15 text-vetra-warning",
  },
  // Note: the model enum spells this `DEPLOYMENt_FAILED`.
  DEPLOYMENt_FAILED: {
    label: "Failed",
    dot: "bg-vetra-destructive",
    badge: "bg-vetra-destructive/15 text-vetra-destructive",
  },
  READY: {
    label: "Ready",
    dot: "bg-vetra-success",
    badge: "bg-vetra-success/15 text-vetra-success",
  },
  TERMINATING: {
    label: "Terminating",
    dot: "bg-vetra-warning",
    badge: "bg-vetra-warning/15 text-vetra-warning",
  },
  DESTROYED: {
    label: "Destroyed",
    dot: "bg-vetra-destructive",
    badge: "bg-vetra-destructive/15 text-vetra-destructive",
  },
  ARCHIVED: {
    label: "Archived",
    dot: "bg-vetra-muted-fg",
    badge: "bg-vetra-muted text-vetra-muted-fg",
  },
  STOPPED: {
    label: "Stopped",
    dot: "bg-vetra-muted-fg",
    badge: "bg-vetra-muted text-vetra-muted-fg",
  },
};

function configFor(status: string): StatusConfig {
  return (
    STATUS[status] ?? {
      label: status.replace(/_/g, " "),
      dot: "bg-vetra-muted-fg",
      badge: "bg-vetra-muted text-vetra-muted-fg",
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
    <span className="flex items-center gap-1.5 text-xs font-medium text-vetra-muted-fg">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
