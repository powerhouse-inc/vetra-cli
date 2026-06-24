/** Status display config. Class strings are literal so Tailwind keeps them. */
type StatusConfig = { label: string; dot: string };

const STATUS: Record<string, StatusConfig> = {
  DRAFT: { label: "Draft", dot: "bg-vetra-muted-fg" },
  CHANGES_PENDING: { label: "Changes pending", dot: "bg-vetra-warning" },
  CHANGES_APPROVED: { label: "Approved", dot: "bg-vetra-info" },
  CHANGES_PUSHED: { label: "Deploying", dot: "bg-vetra-warning" },
  DEPLOYING: { label: "Deploying", dot: "bg-vetra-warning" },
  // Note: the model enum spells this `DEPLOYMENt_FAILED`.
  DEPLOYMENt_FAILED: { label: "Failed", dot: "bg-vetra-destructive" },
  READY: { label: "Ready", dot: "bg-vetra-success" },
  TERMINATING: { label: "Terminating", dot: "bg-vetra-warning" },
  DESTROYED: { label: "Destroyed", dot: "bg-vetra-destructive" },
  ARCHIVED: { label: "Archived", dot: "bg-vetra-muted-fg" },
  STOPPED: { label: "Stopped", dot: "bg-vetra-muted-fg" },
};

function configFor(status: string): StatusConfig {
  return (
    STATUS[status] ?? {
      label: status.replace(/_/g, " "),
      dot: "bg-vetra-muted-fg",
    }
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
