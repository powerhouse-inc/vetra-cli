import { BotIcon, LockKeyholeIcon } from "lucide-react";
import type { ComponentType } from "react";

type RenownLoginMessageProps = {
  onLogin?: () => void;
  agentIcon?: ComponentType<{ active: boolean }>;
};

/**
 * Inline agent message prompting the user to authenticate with Renown.
 * Rendered in-conversation when the agent hits an auth-gated drive/instance.
 */
export function RenownLoginMessage({
  onLogin,
  agentIcon: AgentIcon,
}: RenownLoginMessageProps) {
  return (
    <div className="group flex w-full max-w-[95%] flex-col gap-2">
      <div className="flex items-start gap-2">
        {/* Agent avatar — matches AssistantMessage in MessageBubble */}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          {AgentIcon ? (
            <AgentIcon active={false} />
          ) : (
            <BotIcon className="size-3.5" />
          )}
        </div>

        {/* Card */}
        <div className="flex w-fit min-w-0 max-w-sm flex-col text-sm text-foreground">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LockKeyholeIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  Login with Renown
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Authorization is required for the specific drive or instance
                  you are trying to access.
                </p>
                <button
                  type="button"
                  onClick={onLogin}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <LockKeyholeIcon className="size-3" />
                  Login with Renown
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
