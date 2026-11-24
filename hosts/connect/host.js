// @ts-check
// Vetra Studio: the built Studio SPA, a remote client of the Studio
// switchboard (no reactor in the tab).
import switchboard from "../switchboard/host.js";

// The tag sits on the expression: TypeScript ignores `@satisfies` in front of
// `export default`.
export default /** @satisfies {PHHost} */ ({
  name: "connect",

  runner: {
    module: "@powerhousedao/ph-cli/runners/connect",
    // Not strict: taken (a Studio of another project), the next free port;
    // the run record names the real one.
    port: 8090,
    // `build` writes the Studio SPA here; `serve` serves it. This package's
    // build, also when another project runs the package's Studio (the
    // package builds it; `ph run <package>/connect build` is refused there).
    outDir: "${package}/dist/connect",
    // Read per request (no-store, 404 while missing): the Cli writes it once
    // its local API listens and removes it at its end. It names the local
    // API's address and the Studio's origin to the tab. The Vetra Labs
    // screenshots are the Build and Deploy placeholder pages of Specs.
    serveFiles: {
      "/studio.config.json": "${userData}/.ph/vetra/studio.config.json",
      "/vetra-labs/versions.jpg": "${package}/hosts/connect/labs/versions.jpg",
      "/vetra-labs/packages.jpg": "${package}/hosts/connect/labs/packages.jpg",
      "/vetra-labs/images.jpg": "${package}/hosts/connect/labs/images.jpg",
      "/vetra-labs/installers.jpg":
        "${package}/hosts/connect/labs/installers.jpg",
      "/vetra-labs/environments.jpg":
        "${package}/hosts/connect/labs/environments.jpg",
      "/vetra-labs/environment.jpg":
        "${package}/hosts/connect/labs/environment.jpg",
    },
    // The browser talks to this origin only: Connect's server proxies the
    // switchboard's paths (/graphql, /d/*, /attachments, /mcp, /api/*).
    proxy: {
      target: { $output: { host: "switchboard", path: ["origin"] } },
    },
    // Sign-in by link: the tab signs as the person who started the Studio,
    // through a one-time code the Cli prints. A pseudonym locked with a
    // password is unlocked from the tab, for the agent too: its session
    // cannot ask for one.
    localSignIn: { sessions: ["vetra agent vetra-agent"] },
  },

  config: {
    branding: { appName: "Vetra Studio", favicon: "./branding/vetra.ico" },
    renown: { namespace: "vetra-studio" },
  },

  reactor: {
    protocol: switchboard.reactor.protocol,
    backends: {
      studio: {
        kind: "remote",
        remote: {
          url: {
            $output: { host: "switchboard", path: ["drives", "studio", "url"] },
          },
        },
      },
    },
    drives: [
      {
        slug: "studio",
        remote: {
          url: {
            $output: { host: "switchboard", path: ["drives", "studio", "url"] },
          },
        },
      },
    ],
  },
});
