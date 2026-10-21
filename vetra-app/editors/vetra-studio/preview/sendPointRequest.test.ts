import type { UserContentPartInput } from "@powerhousedao/clint-common/document-models/chat-session";
import type { Change } from "document-models/studio-product";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartChangeInput } from "../change/startChange.js";
import type { StartProductDrive } from "../idea/startProduct.js";

const hoisted = vi.hoisted(() => ({
  startChange: vi.fn(),
  sendSteer: vi.fn(),
  reserve: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../change/startChange.js", () => ({
  startChange: hoisted.startChange,
}));
vi.mock("../story/SteerBox.js", () => ({ sendSteer: hoisted.sendSteer }));
vi.mock("../hooks/useDriveAttachments.js", () => ({
  driveAttachments: () => ({ reserve: hoisted.reserve }),
}));

import { pointedText, sendPointRequest } from "./sendPointRequest.js";
import type { PointTarget } from "./pointTarget.js";

const drive = {
  header: { id: "drive-1" },
  state: { local: {}, global: { nodes: [] } },
} as unknown as StartProductDrive;

const target: PointTarget = {
  text: "Save",
  tag: "button",
  role: null,
  label: null,
  path: ["button#save"],
  rect: { x: 10, y: 20, width: 30, height: 40 },
  component: "Card",
  field: "notes.title",
  module: "notes-editor",
  document: { type: "powerhouse/notes", id: "doc-1" },
};

const openChange = {
  id: "change-1",
  chatSessionId: "session-1",
} as unknown as Change;

const shot = new Blob(["png"], { type: "image/png" });

const startedInput = (): StartChangeInput =>
  hoisted.startChange.mock.calls[0][0] as StartChangeInput;

const steered = (): [
  string,
  string,
  string | undefined,
  UserContentPartInput[],
] =>
  hoisted.sendSteer.mock.calls[0] as [
    string,
    string,
    string | undefined,
    UserContentPartInput[],
  ];

beforeEach(() => {
  hoisted.startChange.mockReset().mockResolvedValue({
    changeId: "change-1",
    sessionId: "session-1",
    joined: false,
  });
  hoisted.sendSteer.mockReset().mockResolvedValue("message-1");
  hoisted.reserve.mockReset().mockResolvedValue({ send: hoisted.send });
  hoisted.send.mockReset().mockResolvedValue({
    hash: "hash",
    ref: "attachment://v1:abc",
    header: {},
  });
});

describe("sendPointRequest", () => {
  it("starts a change with the request and the pointed context", async () => {
    await sendPointRequest({
      request: "Make this bold",
      target,
      shot: null,
      drive,
      productId: "product-1",
      openChange: null,
    });

    expect(hoisted.startChange).toHaveBeenCalledTimes(1);
    const input = startedInput();
    expect(input).toMatchObject({
      drive,
      productId: "product-1",
      kind: "CHANGE",
      contentParts: [],
    });
    expect(input.request).toBe(pointedText("Make this bold", target));
    expect(input.request).toContain(
      'Make this bold\n\n[Pointed at] button "Save"',
    );
    expect(input.request).toContain("Component: Card · Field: notes.title");
    expect(hoisted.sendSteer).not.toHaveBeenCalled();
  });

  it("steers into the open change", async () => {
    await sendPointRequest({
      request: "Make this bold",
      target,
      shot: null,
      drive,
      productId: "product-1",
      openChange,
    });

    expect(hoisted.sendSteer).toHaveBeenCalledTimes(1);
    const [sessionId, text, id, parts] = steered();
    expect(sessionId).toBe("session-1");
    expect(text).toBe(pointedText("Make this bold", target));
    expect(id).toBeUndefined();
    expect(parts).toEqual([]);
    expect(hoisted.startChange).not.toHaveBeenCalled();
  });

  it("attaches the screenshot to the first message", async () => {
    await sendPointRequest({
      request: "Make this bold",
      target,
      shot,
      drive,
      productId: "product-1",
      openChange,
    });

    expect(hoisted.reserve).toHaveBeenCalledWith({
      mimeType: "image/png",
      fileName: "pointed.png",
    });
    const parts = steered()[3];
    expect(parts).toEqual([
      expect.objectContaining({
        type: "IMAGE",
        filename: "pointed.png",
        mediaType: "image/png",
        attachment: "attachment://v1:abc",
      }),
    ]);
  });

  it("a failed screenshot still sends", async () => {
    hoisted.reserve.mockRejectedValueOnce(new Error("upload down"));

    await expect(
      sendPointRequest({
        request: "Make this bold",
        target,
        shot,
        drive,
        productId: "product-1",
        openChange: null,
      }),
    ).resolves.toBeUndefined();

    expect(hoisted.startChange).toHaveBeenCalledTimes(1);
    expect(startedInput().contentParts).toEqual([]);
  });
});
