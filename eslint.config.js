import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'release/**',
      'output/**',
      'src/lib/connect/countries.json',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      // Counts, budgets and timestamps are interpolated on purpose.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // KeyValueStore.get<T> / set<T> exist to name the stored value at the call site.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      // Optional chrome/DOM access is a real absence check; the type packages mark those values as always present.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-invalid-void-type': ['error', { allowInGenericTypeArguments: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'vue/multi-word-component-names': ['error', { ignores: ['Icon'] }],
    },
  },
  {
    files: ['**/*.{test,spec}.ts', '**/*.test.mjs'],
    extends: [vitest.configs.recommended],
    rules: {
      // Fakes implement Promise-shaped ports without an inner await.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'manifest.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/sidepanel/components/ContentPreferencesForm.vue'],
    rules: {
      // The prop is the settings controller; v-model writes its refs and never replaces the object.
      'vue/no-mutating-props': 'off',
    },
  },
  eslintConfigPrettier,
);
