import { describe, expect, it } from "vitest";
import { resolveDeployProject } from "./resolveDeployProject.js";
import type { Project } from "../specify/projects.js";
import type { ProjectPackageInfo } from "./useProjectPackages.js";

function project(name: string): Project {
  return { id: `folder-${name}`, name, documents: [] };
}

const projects = [project("todo-app"), project("blog")];

const byProject = new Map<string, ProjectPackageInfo | null>([
  ["todo-app", { name: "@acme/todo", version: "1.2.0" }],
  ["blog", null], // no readable package.json
]);

describe("resolveDeployProject", () => {
  it("resolves a directly-named project by folder name", () => {
    expect(
      resolveDeployProject(
        { project: "blog", callId: "c1" },
        projects,
        byProject,
      ),
    ).toBe(projects[1]);
  });

  it("resolves a package name to the project that produces it", () => {
    expect(
      resolveDeployProject(
        { packageName: "@acme/todo", callId: "c1" },
        projects,
        byProject,
      ),
    ).toBe(projects[0]);
  });

  it("returns null for a package that isn't one of this drive's projects", () => {
    expect(
      resolveDeployProject(
        { packageName: "@other/pkg", callId: "c1" },
        projects,
        byProject,
      ),
    ).toBeNull();
  });

  it("returns null for a package target while package data is still loading", () => {
    expect(
      resolveDeployProject(
        { packageName: "@acme/todo", callId: "c1" },
        projects,
        undefined,
      ),
    ).toBeNull();
  });

  it("returns null when a named project isn't in the drive yet", () => {
    expect(
      resolveDeployProject(
        { project: "not-here", callId: "c1" },
        projects,
        byProject,
      ),
    ).toBeNull();
  });

  it("prefers a project-name match, falling back to package name", () => {
    // Both fields present: the direct name resolves even without package data.
    expect(
      resolveDeployProject(
        { project: "todo-app", packageName: "@acme/todo", callId: "c1" },
        projects,
        undefined,
      ),
    ).toBe(projects[0]);
  });
});
