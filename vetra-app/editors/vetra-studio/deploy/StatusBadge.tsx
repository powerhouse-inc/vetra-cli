/** Status display config. Class strings are literal so Tailwind keeps them. */
type StatusConfig = { label: string; dot: string };

const STATUS: Record<string, StatusConfig> = {
  DRAFT: {
    label: "Draft",
    dot: "bg-muted-foreground",
  },
  CHANGES_PENDING: {
    label: "Changes pending",
    dot: "bg-warning",
  },
  CHANGES_APPROVED: {
    label: "Approved",
    dot: "bg-info",
  },
  CHANGES_PUSHED: {
    label: "Deploying",
    dot: "bg-warning",
  },
  DEPLOYING: {
    label: "Deploying",
    dot: "bg-warning",
  },
  // Note: the model enum spells this `DEPLOYMENt_FAILED`.
  DEPLOYMENt_FAILED: {
    label: "Failed",
    dot: "bg-destructive",
  },
  READY: {
    label: "Ready",
    dot: "bg-success",
  },
  TERMINATING: {
    label: "Terminating",
    dot: "bg-warning",
  },
  DESTROYED: {
    label: "Destroyed",
    dot: "bg-destructive",
  },
  ARCHIVED: {
    label: "Archived",
    dot: "bg-muted-foreground",
  },
  STOPPED: {
    label: "Stopped",
    dot: "bg-muted-foreground",
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
  const { label } = configFor(status);
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium`}>
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
