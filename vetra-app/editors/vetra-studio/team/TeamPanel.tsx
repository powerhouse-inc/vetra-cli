/**
 * The Team panel (P6 task 1.12): who is in this Studio, in which role, and
 * what this Studio has seen of their agent access.
 *
 * Rows are the members the daemon admitted plus the accepted reviewers. An
 * organisation's full member list is not readable from the Studio (the 1.10
 * gap: Renown's organizationMembers needs a wallet-signed OrgAuthInput), so an
 * org Studio states that instead of inventing members.
 *
 * Owners control two things per member, both written as signed `studio-team`
 * operations from this browser (the trust ledger judges them by the signer):
 * the Reviewer toggle and "Can only watch here" (a VIEWER role override).
 */
import { dispatchActions } from "@powerhousedao/reactor-browser";
import { actions as teamActions } from "document-models/studio-team";
import type { Action } from "document-model";
import { useState, type ReactNode } from "react";
import { AgentAuthButton } from "../AgentAuthButton.js";
import { useT } from "../i18n/useT.js";
import type { Member } from "./capabilities.js";
import { canManageTeam } from "./roleGate.js";
import { memberName, type TeamMember } from "./teamClient.js";

export type TeamPanelProps = {
  /** The caller's own member record (null: no team information). */
  me: Member | null;
  members: TeamMember[];
  /** The roster is the seen members, not the org's full list. */
  limited: boolean;
  /** The team routes could not answer. */
  unavailable: boolean;
  /** The caller may use the Studio but has not allowed its agent yet. */
  needsAllow: boolean;
  /** The `vetra/studio-team` document (null while the Studio has none, C16). */
  teamDocumentId: string | null;
  /** Re-read the roster after an accepted change. */
  onChanged?: () => void;
  onClose: () => void;
  /** Fixed clock for tests. */
  now?: () => Date;
};

export function TeamPanel({
  me,
  members,
  limited,
  unavailable,
  needsAllow,
  teamDocumentId,
  onChanged,
  onClose,
  now = () => new Date(),
}: TeamPanelProps) {
  const { t } = useT();
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const owner = canManageTeam(me);
  const canEdit = owner && teamDocumentId !== null;

  async function write(action: Action, key: string): Promise<void> {
    if (!teamDocumentId) return;
    setPending(key);
    setFailed(false);
    try {
      await dispatchActions(action, teamDocumentId);
      onChanged?.();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  function toggleReviewer(member: TeamMember): void {
    const on = !member.reviewer;
    void write(
      on
        ? teamActions.addReviewer({
            address: member.address,
            name: member.name ?? undefined,
            at: now().toISOString(),
          })
        : teamActions.removeReviewer({ address: member.address }),
      `reviewer:${member.address}`,
    );
  }

  function toggleOverride(member: TeamMember): void {
    const limitedHere = !member.overridden;
    void write(
      limitedHere
        ? teamActions.setRoleOverride({
            address: member.address,
            role: "VIEWER",
            at: now().toISOString(),
          })
        : teamActions.clearRoleOverride({ address: member.address }),
      `override:${member.address}`,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("team.heading")}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <header className="flex items-center border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-foreground">
            {t("team.heading")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            {t("team.close")}
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">
          {unavailable ? (
            <p role="status" className="text-muted-foreground">
              {t("team.unavailable")}
            </p>
          ) : (
            <>
              <ul
                aria-label={t("team.heading")}
                className="flex flex-col divide-y divide-border"
              >
                {members.map((member) => {
                  const you = member.address === me?.address;
                  return (
                    <li
                      key={member.address}
                      data-member={member.address}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2"
                    >
                      <span className="font-medium text-foreground">
                        {memberName(member)}
                      </span>
                      {you ? (
                        <span className="text-xs text-muted-foreground">
                          {t("team.you")}
                        </span>
                      ) : null}
                      <span aria-hidden className="text-muted-foreground">
                        ·
                      </span>
                      <span className="text-muted-foreground">
                        {t(`team.role.${member.role}`)}
                      </span>
                      {member.reviewer ? (
                        <Badge>{t("team.reviewer")}</Badge>
                      ) : null}
                      {member.allowedAgent ? (
                        <Badge>{t("team.agentAllowed")}</Badge>
                      ) : null}
                      {member.overridden ? (
                        <Badge>{t("team.onlyWatch")}</Badge>
                      ) : null}
                      {canEdit && !you ? (
                        <span className="ml-auto flex flex-wrap items-center gap-3">
                          <Switch
                            label={t("team.reviewer")}
                            member={memberName(member)}
                            checked={member.reviewer}
                            disabled={pending !== null}
                            onChange={() => toggleReviewer(member)}
                          />
                          {member.role === "maker" || member.overridden ? (
                            <Switch
                              label={t("team.onlyWatch")}
                              member={memberName(member)}
                              checked={member.overridden}
                              disabled={pending !== null}
                              onChange={() => toggleOverride(member)}
                            />
                          ) : null}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {limited ? (
                <p className="text-xs text-muted-foreground">
                  {t("team.limited")}
                </p>
              ) : null}
              {owner && teamDocumentId === null ? (
                <p className="text-xs text-muted-foreground">
                  {t("team.pending")}
                </p>
              ) : null}
              {failed ? (
                <p role="alert" className="text-xs text-destructive">
                  {t("team.actionFailed")}
                </p>
              ) : null}
              {needsAllow && (me?.role === "owner" || me?.role === "maker") ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">
                    {t("team.needsAllow")}
                  </span>
                  <AgentAuthButton />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

function Switch({
  label,
  member,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  member: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label} ${member}`}
      disabled={disabled}
      onClick={onChange}
      className={
        "rounded-full border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50 " +
        (checked
          ? "border-vetra-primary bg-vetra-primary text-vetra-primary-fg"
          : "border-border text-foreground")
      }
    >
      {label}
    </button>
  );
}
