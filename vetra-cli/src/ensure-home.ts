// Side-effecting HOME guard. Imported first in main.ts so it runs before the
// rest of the import graph (Vite/chokidar) reads HOME. A container that starts
// vetra-cli with HOME unset or empty makes chokidar throw a spurious ENOSPC on
// the first watched file, since os.homedir() resolves to "". Resolve a usable
// home from the OS user table and export it back into the environment.
import { userInfo } from 'node:os';

function resolveHome(): string | undefined {
  try {
    const home = userInfo().homedir;
    if (home && home !== '/') return home;
  } catch {
    // userInfo() can throw on a uid missing from /etc/passwd.
  }
  return undefined;
}

if (!process.env.HOME) {
  const home = resolveHome();
  if (home) {
    process.env.HOME = home;
    console.log(`vetra-cli: HOME was unset; defaulted to ${home}`);
  } else {
    console.warn(
      'vetra-cli: HOME is unset and could not be resolved from the OS user; ' +
        'file watching may fail. Set HOME in the container environment.',
    );
  }
}
