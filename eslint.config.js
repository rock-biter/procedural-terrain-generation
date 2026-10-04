import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Correctness rules only: formatting belongs to Prettier (.prettierrc.json),
// and eslint-config-prettier turns off every rule that would fight it.
export default [
	{ ignores: ['dist/', 'public/', 'assets-src/', 'node_modules/'] },
	js.configs.recommended,
	{
		files: ['main.js', 'src/**/*.js'],
		languageOptions: { globals: globals.browser },
	},
	{
		files: ['src/**/*.worker.js'],
		languageOptions: { globals: globals.worker },
	},
	{
		files: ['scripts/**/*.mjs', 'test/**/*.{js,mjs}', '*.config.js'],
		languageOptions: { globals: globals.node },
	},
	{
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
		},
	},
	prettier,
]
