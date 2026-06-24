import { useRenown } from "@powerhousedao/reactor-browser";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { Breadcrumb, type Crumb } from "./Breadcrumb.js";
import { useCloudAuth } from "./deploy/cloudAuth.js";
import { getAuthToken, setAuthTokenProvider } from "./deploy/cloudClient.js";
import { resolveCloudDriveId } from "./deploy/config.js";
import { CreateEnvironmentForm } from "./deploy/CreateEnvironmentForm.js";
import { EnvironmentDetail } from "./deploy/EnvironmentDetail.js";
import { EnvironmentList } from "./deploy/EnvironmentList.js";
import { useCloudEnvironments } from "./deploy/useCloudEnvironments.js";

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "detail"; id: string; name: string };

/** Home > Deploy. Lists the user's vetra.io environments from the cloud
 * switchboard and lets them create/edit. Requires a Renown sign-in; signed
 * actions push directly to the remote (no local mirror). */
export function DeploySection({
  productName,
  onExitToHome,
}: {
  productName: string;
  onExitToHome: () => void;
}) {
  const renown = useRenown();
  const auth = useCloudAuth();
  const driveId = resolveCloudDriveId(auth.address);
  const { state: envs, refresh } = useCloudEnvironments(
    auth.authorized,
    auth.address,
  );
  const [view, setView] = useState<View>({ kind: "list" });

  // Attach the no-aud Renown token to every cloud client request.
  useEffect(() => {
    setAuthTokenProvider(() => getAuthToken(renown));
    return () => setAuthTokenProvider(null);
  }, [renown]);

  // Returning to the list re-fetches so edits/creates show immediately rather
  // than waiting for the next poll.
  function goToList() {
    refresh();
    setView({ kind: "list" });
  }

  const atRoot = view.kind === "list";
  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    {
      label: "Deploy",
      onClick: atRoot ? undefined : goToList,
    },
    ...(view.kind === "create" ? [{ label: "New" }] : []),
    ...(view.kind === "detail" ? [{ label: view.name }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {!auth.authorized ? (
        <AuthGate loading={auth.loading} onLogin={auth.login} />
      ) : view.kind === "create" ? (
        <CreateEnvironmentForm
          driveId={driveId}
          signer={auth.signer}
          onCreated={(id, name) => {
            refresh();
            setView({ kind: "detail", id, name });
          }}
          onCancel={goToList}
        />
      ) : view.kind === "detail" ? (
        <EnvironmentDetail
          documentId={view.id}
          driveId={driveId}
          signer={auth.signer}
        />
      ) : (
        <EnvironmentList
          state={envs}
          signer={auth.signer}
          driveId={driveId}
          onOpen={(id, name) => setView({ kind: "detail", id, name })}
          onCreate={() => setView({ kind: "create" })}
          onRetry={refresh}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}

function AuthGate({
  loading,
  onLogin,
}: {
  loading: boolean;
  onLogin: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-24 text-center">
      <Rocket size={28} className="text-vetra-primary" />
      <h2 className="text-lg font-semibold text-foreground">
        Deploy to vetra.io
      </h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Checking sign-in…</p>
      ) : (
        <>
          <p className="max-w-md text-sm text-muted-foreground">
            Sign in with Renown to see and manage your cloud environments.
          </p>
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
          >
            Connect with Renown
          </button>
        </>
      )}
    </div>
  );
}
