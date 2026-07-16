// Publish config — loaded by ph-clint's publish pipeline.
// definePublishConfig is an identity function; a plain export is equivalent.
export default {
  groups: {
    'vetra': {
      version: '0.0.6',
      packages: [
        { path: 'vetra-app', category: 'app' },
        { path: 'vetra-cli', category: 'cli' },
      ],
    },
  },
};
