import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', '**/dist/**', 'node_modules/**', 'artifacts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    // React Compiler is not enabled; retain the hook checks used by this app.
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly', crypto: 'readonly', document: 'readonly', getComputedStyle: 'readonly', innerWidth: 'readonly' } } },
);
