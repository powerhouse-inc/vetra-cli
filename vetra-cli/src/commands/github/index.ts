import { githubPush } from './push.js';
import { githubPull } from './pull.js';
import { githubClone } from './clone.js';

export const githubCommands = [githubPush, githubPull, githubClone];
