import type { DocumentDriveDocument } from "@powerhousedao/shared/document-drive";
import { Breadcrumb, type Crumb } from "./Breadcrumb.js";
import { DocumentHost } from "./ideation/DocumentHost.js";
import { FeatureList } from "./ideation/FeatureList.js";
import { ProductIdentityCards } from "./ideation/ProductIdentityCards.js";
import type { OpenTarget } from "./ideation/types.js";

/**
 * Home > Ideate. Lists the product-identity sheets and features in the drive
 * and opens each document's editor inline. Owns the sub-navigation breadcrumb.
 *
 * Selection is **controlled** by `VetraStudio` (lifted so auto-nav can drive
 * it). `onOpen` here always means a user click — VetraStudio pins it so
 * auto-nav won't yank the user away.
 */
export function IdeationSection({
  drive,
  productName,
  open,
  onOpen,
  onClear,
  onExitToHome,
}: {
  drive: DocumentDriveDocument;
  productName: string;
  open: OpenTarget | null;
  onOpen: (target: OpenTarget) => void;
  onClear: () => void;
  onExitToHome: () => void;
}) {
  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    { label: "Ideate", onClick: open ? onClear : undefined },
    ...(open ? [{ label: open.name }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {open ? (
        <DocumentHost id={open.id} documentType={open.documentType} />
      ) : (
        <div className="flex flex-col gap-10">
          <ProductIdentityCards drive={drive} onOpen={onOpen} />
          <FeatureList drive={drive} onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}
