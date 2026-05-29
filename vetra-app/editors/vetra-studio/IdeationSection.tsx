import type { DocumentDriveDocument } from "@powerhousedao/shared/document-drive";
import { useState } from "react";
import { Breadcrumb, type Crumb } from "./Breadcrumb.js";
import { DocumentHost } from "./ideation/DocumentHost.js";
import { FeatureList } from "./ideation/FeatureList.js";
import { ProductIdentityCards } from "./ideation/ProductIdentityCards.js";
import type { OpenTarget } from "./ideation/types.js";

/**
 * Home > Ideate. Lists the product-identity sheets and features in the drive
 * and opens each document's editor inline. Owns the sub-navigation breadcrumb.
 */
export function IdeationSection({
  drive,
  productName,
  onExitToHome,
}: {
  drive: DocumentDriveDocument;
  productName: string;
  onExitToHome: () => void;
}) {
  const [open, setOpen] = useState<OpenTarget | null>(null);

  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    { label: "Ideate", onClick: open ? () => setOpen(null) : undefined },
    ...(open ? [{ label: open.name }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {open ? (
        <DocumentHost id={open.id} documentType={open.documentType} />
      ) : (
        <div className="flex flex-col gap-10">
          <ProductIdentityCards drive={drive} onOpen={setOpen} />
          <FeatureList drive={drive} onOpen={setOpen} />
        </div>
      )}
    </div>
  );
}
