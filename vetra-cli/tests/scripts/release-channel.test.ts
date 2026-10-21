import { resolveReleaseChannel } from '../../scripts/publish/release-channel.mjs';

const BOTH = ['https://registry.dev.vetra.io', 'https://registry.vetra.io'];

describe('resolveReleaseChannel', () => {
  it('main → dev on both registries', () => {
    expect(
      resolveReleaseChannel({ branch: 'main', prereleaseTag: '', version: '0.0.8-dev.9' }),
    ).toEqual({ distTag: 'dev', registries: BOTH });
  });

  it('production → latest on both registries', () => {
    expect(
      resolveReleaseChannel({ branch: 'production', prereleaseTag: '', version: '0.0.8' }),
    ).toEqual({ distTag: 'latest', registries: BOTH });
  });

  it('p4 prerelease → p4 on registry.vetra.io only', () => {
    expect(
      resolveReleaseChannel({
        branch: 'feat/iterate-design',
        prereleaseTag: 'p4',
        version: '0.0.9-p4.1',
      }),
    ).toEqual({ distTag: 'p4', registries: ['https://registry.vetra.io'] });
  });

  it('p4 tag refuses a version without -p4.', () => {
    expect(() =>
      resolveReleaseChannel({
        branch: 'feat/iterate-design',
        prereleaseTag: 'p4',
        version: '0.0.9-dev.1',
      }),
    ).toThrow('version 0.0.9-dev.1 does not match the p4 channel (expected -p4.N)');
  });

  it('prerelease tag dev or latest is refused', () => {
    for (const prereleaseTag of ['dev', 'latest']) {
      expect(() =>
        resolveReleaseChannel({ branch: 'feat/x', prereleaseTag, version: '0.0.9-dev.1' }),
      ).toThrow(/not allowed/);
    }
  });

  it('other branch without prerelease tag is refused', () => {
    expect(() =>
      resolveReleaseChannel({ branch: 'feat/x', prereleaseTag: '', version: '0.0.9' }),
    ).toThrow('release runs from main or production only (got feat/x)');
  });

  it('prerelease tag refuses also-tag', () => {
    expect(() =>
      resolveReleaseChannel({
        branch: 'feat/iterate-design',
        prereleaseTag: 'p4',
        version: '0.0.9-p4.1',
        alsoTag: 'latest',
      }),
    ).toThrow('also-tag is not allowed with a prerelease tag');
  });
});
