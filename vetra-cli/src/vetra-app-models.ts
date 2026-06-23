// vetra-app's document models via the narrow `./document-models` export, so
// the editor graph (katex/mermaid) stays out of the bundle.
import {
  AudienceSheetV1,
  BrandSheetV1,
  FeatureV1,
  ProblemSheetV1,
  WorkBreakdownStructureV1,
} from 'vetra-app/document-models';

export const documentModels = [
  AudienceSheetV1,
  BrandSheetV1,
  FeatureV1,
  ProblemSheetV1,
  WorkBreakdownStructureV1,
];
