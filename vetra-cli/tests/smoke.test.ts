import { describe, it, expect } from '@jest/globals';

describe('vetra', () => {
  it('loads without error', async () => {
    const { cli } = await import('../src/cli.js');
    expect(cli).toBeDefined();
  });
});
