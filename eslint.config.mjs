// Same rules as Obsidian's community plugin scanner (eslint-plugin-obsidianmd recommended).
// Run from the repo root: npm run lint
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  globalIgnores(['node_modules', 'test-vaults', 'main.js', 'styles.css', 'docs', 'data', 'examples', 'scripts', '**/*.mjs']),
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
]);
