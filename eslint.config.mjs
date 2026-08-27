import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  {
    // ESLint 9 does not read .gitignore, so locally generated directories have
    // to be listed here even when git already ignores them. supabase/.temp/
    // holds the running local stack's state, including a minified Deno bundle
    // for the edge runtime — linting it produced 205 problems, all from that
    // one file, which is more than enough noise to hide a real one.
    //
    // CI never saw them because it lints a clean checkout where .temp/ does not
    // exist, so this only ever affected people running the local stack.
    //
    // Must stay a lone `ignores` key in its own object to apply globally; put
    // beside `rules` it would only scope to that config block.
    ignores: ['supabase/.temp/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]

export default eslintConfig
