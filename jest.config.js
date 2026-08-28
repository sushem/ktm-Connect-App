module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The default pattern only transpiles react-native itself; these ship
  // untranspiled ES modules too.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-ble-plx|react-native-svg|react-native-safe-area-context)/)',
  ],
};
