// @clint:begin eslint
import tseslint from 'typescript-eslint';

export default tseslint.config(
  tseslint.configs.recommended,
  { ignores: ['dist/', 'gen/', 'coverage/'] },
);
// @clint:end eslint
