import { ReactorBuilder, ReactorClientBuilder, type ReactorClientModule } from "@powerhousedao/reactor";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import { withSignaturePolicy } from "document-model";
import { StudioProductV1, StudioTeamV1 } from "vetra-app/document-models";
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import type { ProductContext } from "../../src/product/product-doc.js";

const a = StudioProductV1.actions;

export interface ProductHarness {
  module: ReactorClientModule;
  ctx: ProductContext;
  driveId: string;
  productId?: string;
  state(): Promise<StudioProductState>;
  kill(): Promise<void>;
}

/** An in-memory reactor with a Studio drive; optionally a product + first change. */
export async function productHarness(
  opts: { product?: boolean; name?: string; changeId?: string; kind?: "FIRST_BUILD" | "CHANGE" | "UNDO" } = {},
): Promise<ProductHarness> {
  const builder = new ReactorBuilder().withDocumentModelSources([
    driveDocumentModelModule as never,
    StudioProductV1 as never,
    StudioTeamV1 as never,
  ]);
  const module = await new ReactorClientBuilder()
    .withReactorBuilder(builder)
    .withCreateSignaturePolicy("legacy")
    .buildModule();
  const drive = await module.client.createEmpty("powerhouse/document-drive");
  const driveId = drive.header.id;
  const ctx: ProductContext = {
    folders: {},
    reactor: async () => ({ client: module.client, personalDriveId: driveId, driveId }),
  };
  let productId: string | undefined;
  if (opts.product !== false) {
    const doc = withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy");
    const created = await module.client.createDocumentInDrive(driveId, doc);
    productId = created.header.id;
    const at = "2026-10-20T10:00:00.000Z";
    await module.client.execute(productId, "main", [
      a.initProduct({ name: opts.name ?? "Create a todo app", idea: "create a todo app for my team", createdAt: at }),
      a.startChange({ id: opts.changeId ?? "change-1", kind: opts.kind ?? "FIRST_BUILD", request: "create a todo app", startedAt: at }),
    ]);
  }
  return {
    module,
    ctx,
    driveId,
    productId,
    async state() {
      const d = (await module.client.get(productId!)) as { state: { global: StudioProductState } };
      return d.state.global;
    },
    async kill() {
      await module.reactor.kill().completed;
    },
  };
}
