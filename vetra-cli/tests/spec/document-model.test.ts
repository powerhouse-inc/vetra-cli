import { describe, expect, it } from "@jest/globals";

import {
  batchTouchesTypeDefinitions,
  declaredTypeNames,
  parseSdl,
  referencedTypeNames,
} from "../../src/commands/spec/document-model.js";
import {
  findDuplicateTypeDefinitions,
  newDuplicateTypeDefinitions,
} from "../../src/commands/spec/registry.js";

/** A document-model `state` carrying just the per-scope state SDL and operation
 * SDL the duplicate guard reads. */
function dmState(opts: {
  global?: string;
  local?: string;
  operations?: Array<{ name: string; schema: string }>;
}): unknown {
  return {
    global: {
      specifications: [
        {
          state: {
            global: opts.global != null ? { schema: opts.global } : undefined,
            local: opts.local != null ? { schema: opts.local } : undefined,
          },
          modules: [{ operations: opts.operations ?? [] }],
        },
      ],
    },
  };
}

const decl = (sdl: string) => declaredTypeNames(parseSdl(sdl)!);
const declExt = (sdl: string) =>
  declaredTypeNames(parseSdl(sdl)!, { includeExtensions: true });
const refs = (sdl: string) => referencedTypeNames(parseSdl(sdl)!);

describe("declaredTypeNames / referencedTypeNames (parse-based)", () => {
  it("treats `extend type X` as a definition only when includeExtensions is set", () => {
    // The duplicate check (default) must NOT count an extension as a definition,
    // or `extend` would falsely read as a redefinition.
    expect(decl("extend type Foo { y: Int }").has("Foo")).toBe(false);
    // Reference resolution opts in, so referencing an extended type is allowed.
    expect(declExt("extend type Foo { y: Int }").has("Foo")).toBe(true);
  });

  it("captures union members and `implements` interfaces as references", () => {
    // The previous `:`-anchored regex missed both of these.
    expect([...refs("union Pet = Cat | Dog")]).toEqual(
      expect.arrayContaining(["Cat", "Dog"]),
    );
    expect([...refs("type User implements Node { id: ID }")]).toContain("Node");
  });

  it("returns null for empty or non-SDL fragments", () => {
    expect(parseSdl("")).toBeNull();
    expect(parseSdl("   ")).toBeNull();
    // TS pseudo-SDL is not valid GraphQL — skipped, not mis-reported.
    expect(parseSdl("type X = { a: number }")).toBeNull();
  });
});

describe("findDuplicateTypeDefinitions", () => {
  const ENUM = "enum ContractType { FULL_TIME PART_TIME }";

  it("flags an enum defined in both global state and an operation", () => {
    const dups = findDuplicateTypeDefinitions(
      dmState({
        global: `type S { c: ContractType } ${ENUM}`,
        operations: [{ name: "OP", schema: `input I { c: ContractType } ${ENUM}` }],
      }),
    );
    expect(dups.map((d) => d.name)).toContain("ContractType");
  });

  it("does not flag a type that is merely referenced, not redefined", () => {
    const dups = findDuplicateTypeDefinitions(
      dmState({
        global: `type S { c: ContractType } ${ENUM}`,
        operations: [{ name: "OP", schema: "input I { c: ContractType }" }],
      }),
    );
    expect(dups).toHaveLength(0);
  });
});

describe("newDuplicateTypeDefinitions (delta)", () => {
  const ENUM = "enum Priority { LOW HIGH }";

  it("flags a duplicate the batch introduces", () => {
    const before = dmState({ global: `type S { p: Priority } ${ENUM}` });
    const after = dmState({
      global: `type S { p: Priority } ${ENUM}`,
      local: ENUM,
    });
    expect(newDuplicateTypeDefinitions(before, after).map((d) => d.name)).toEqual(
      ["Priority"],
    );
  });

  it("ignores a pre-existing duplicate an unrelated edit leaves in place", () => {
    // Priority is already duplicated in both states before and after — the edit
    // only renames the model, so it must not be blocked.
    const dup = { global: `type S { p: Priority } ${ENUM}`, local: ENUM };
    expect(newDuplicateTypeDefinitions(dmState(dup), dmState(dup))).toHaveLength(0);
  });
});

describe("batchTouchesTypeDefinitions", () => {
  it("is true when the batch carries an SDL schema", () => {
    expect(batchTouchesTypeDefinitions([{ type: "SET_STATE_SCHEMA" }])).toBe(true);
    expect(batchTouchesTypeDefinitions([{ type: "ADD_OPERATION" }])).toBe(true);
    expect(batchTouchesTypeDefinitions([{ type: "SET_OPERATION_SCHEMA" }])).toBe(
      true,
    );
  });

  it("is false for metadata-only batches", () => {
    expect(
      batchTouchesTypeDefinitions([
        { type: "SET_MODEL_NAME" },
        { type: "ADD_MODULE" },
      ]),
    ).toBe(false);
  });
});
