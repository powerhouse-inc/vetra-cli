import { describe, expect, it } from "vitest";
import type { Node } from "@powerhousedao/shared/document-drive";
import { de } from "../i18n/messages.de.js";
import { en } from "../i18n/messages.en.js";
import { translate } from "../i18n/language.js";
import { forbiddenWordsIn } from "../test-utils/forbiddenWords.js";
import {
  memberName,
  shortAddress,
  teamDocumentId,
  STUDIO_TEAM_TYPE,
} from "./teamClient.js";

function node(id: string, documentType: string): Node {
  return { id, name: id, kind: "file", documentType, parentFolder: null };
}

describe("team client", () => {
  it("finds the Studio's team document in the drive", () => {
    const nodes = [
      node("product-1", "vetra/studio-product"),
      node("team-1", STUDIO_TEAM_TYPE),
    ];
    expect(teamDocumentId(nodes)).toBe("team-1");
    // Before the team document exists (C16: waiting for a delegation).
    expect(
      teamDocumentId([node("product-1", "vetra/studio-product")]),
    ).toBeNull();
  });

  it("names a member by name, else by a short address", () => {
    expect(memberName({ name: "Ada", address: "0x1234" })).toBe("Ada");
    expect(
      memberName({
        name: null,
        address: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe("0x1111…1111");
    expect(shortAddress("0x1234")).toBe("0x1234");
    expect(memberName({ name: "Ada", address: "0x1234" }, true)).toBe(
      "Ada (you)",
    );
  });
});

describe("team copy", () => {
  const teamKeys = Object.keys(en).filter((key) =>
    key.startsWith("team."),
  ) as Array<keyof typeof en>;

  it("every team string is written in English and German", () => {
    expect(teamKeys.length).toBeGreaterThan(20);
    for (const key of teamKeys) {
      expect(en[key].length, `en ${key}`).toBeGreaterThan(0);
      expect(de[key].length, `de ${key}`).toBeGreaterThan(0);
    }
  });

  it("keeps the {org} placeholder in both languages", () => {
    for (const key of teamKeys) {
      const placeholders = (text: string) =>
        (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(de[key]), `de ${key}`).toEqual(placeholders(en[key]));
    }
  });

  it("translates the viewer's notice, and no forbidden word reaches it", () => {
    expect(translate("en", "team.viewerSteer")).toBe(
      "You can watch and comment. Ask an Owner if you want to make changes.",
    );
    expect(translate("de", "team.viewerSteer")).toContain("Inhaber");
    for (const key of teamKeys) {
      expect(forbiddenWordsIn(translate("en", key)), `en ${key}`).toEqual([]);
      expect(forbiddenWordsIn(translate("de", key)), `de ${key}`).toEqual([]);
    }
  });
});
