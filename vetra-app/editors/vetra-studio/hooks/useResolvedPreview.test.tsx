// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import { useResolvedPreview } from "./useResolvedPreview.js";
import type { PreviewTarget } from "./useSessionPreviewTarget.js";

const hoisted = vi.hoisted(() => ({
  resolves: [] as Record<string, unknown>[],
  starts: [] as string[],
}));

vi.mock("./preview-server-client.js", () => ({
  fetchResolve: (args: Record<string, unknown>) => {
    hoisted.resolves.push(args);
    return Promise.resolve({
      kind: "project-stopped",
      project: args.project,
      projectPath: `/w/${String(args.project)}`,
    });
  },
  fetchStart: ({ project }: { project: string }) => {
    hoisted.starts.push(project);
    return Promise.resolve({ kind: "started" });
  },
  subscribePreviewEvents: () => () => {},
}));

function Probe({
  target,
  autoStart,
}: {
  target: PreviewTarget;
  autoStart?: boolean;
}) {
  const state = useResolvedPreview(target, { autoStart });
  return <span data-kind={state.kind} />;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  hoisted.resolves = [];
  hoisted.starts = [];
});

describe("useResolvedPreview", () => {
  it("asks for the home view and never starts a stopped project for it", async () => {
    const container = render(
      <Probe
        target={{ project: "todo", home: true, callId: "s1" }}
        autoStart={false}
      />,
    );
    await settle();
    expect(hoisted.resolves.at(-1)).toMatchObject({
      project: "todo",
      home: true,
    });
    expect(
      container.querySelector("[data-kind]")?.getAttribute("data-kind"),
    ).toBe("project-stopped");
    expect(hoisted.starts).toEqual([]);
  });

  it("starts a stopped project for a shared screen", async () => {
    render(<Probe target={{ project: "todo", doc: "d1", callId: "c1" }} />);
    await settle();
    expect(hoisted.starts).toEqual(["todo"]);
  });
});
