// Resolves the npm dist-tag and target registries for a release run.
//   main                     -> dev     (registry.vetra.io)
//   production               -> latest  (registry.vetra.io)
//   <any branch> + prerelease-tag <t>   -> <t> (registry.vetra.io only),
//                               version must be x.y.z-<t>.N
// CLI: reads GITHUB_REF_NAME, INPUT_PRERELEASE_TAG, VERSION and prints
// `dist_tag=` and `registries=` lines for $GITHUB_OUTPUT.
import { pathToFileURL } from 'node:url';

const MAIN_REGISTRY = 'https://registry.vetra.io';

export function resolveReleaseChannel({ branch, prereleaseTag, version, alsoTag = '' }) {
  if (prereleaseTag) {
    if (alsoTag) throw new Error('also-tag is not allowed with a prerelease tag');
    if (prereleaseTag === 'dev' || prereleaseTag === 'latest' || !/^[a-z][a-z0-9]*$/.test(prereleaseTag)) {
      throw new Error(`prerelease tag ${prereleaseTag} is not allowed`);
    }
    if (!new RegExp(`^\\d+\\.\\d+\\.\\d+-${prereleaseTag}\\.\\d+$`).test(version)) {
      throw new Error(
        `version ${version} does not match the ${prereleaseTag} channel (expected -${prereleaseTag}.N)`,
      );
    }
    return { distTag: prereleaseTag, registries: [MAIN_REGISTRY] };
  }
  if (branch === 'main') return { distTag: 'dev', registries: [MAIN_REGISTRY] };
  if (branch === 'production') return { distTag: 'latest', registries: [MAIN_REGISTRY] };
  throw new Error(`release runs from main or production only (got ${branch})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { distTag, registries } = resolveReleaseChannel({
      branch: process.env.GITHUB_REF_NAME ?? '',
      prereleaseTag: process.env.INPUT_PRERELEASE_TAG ?? '',
      version: process.env.VERSION ?? '',
      alsoTag: process.env.INPUT_ALSO_TAG ?? '',
    });
    console.log(`dist_tag=${distTag}`);
    console.log(`registries=${registries.join(' ')}`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
