import reactHooks from 'eslint-plugin-react-hooks'

// Escopo deliberado (B36): so as regras de hooks + no-unused-vars.
// Sem eslint-plugin-react (quase tudo estilo) e sem Prettier — formatacao
// em massa normaliza o EOL e derruba a paridade das releases (ver B42).
export default [
  {
    files: ['src/**/*.{js,jsx}', 'test/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
]
