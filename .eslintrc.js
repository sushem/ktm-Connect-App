module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Protocol code lives and dies by bit twiddling.
    'no-bitwise': 'off',
    // `void promise` is how we say "deliberately not awaited" in event handlers.
    'no-void': 'off',
  },
  overrides: [
    {
      files: ['jest.setup.js', '**/__tests__/**'],
      env: {jest: true},
    },
  ],
};
