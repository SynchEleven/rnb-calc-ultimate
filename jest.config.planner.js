module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/js/__tests__/**/*.test.js'],
  coverageDirectory: 'coverage-planner',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/calc/'],
  collectCoverageFrom: [
    'src/js/battle_planner.js',
    'src/js/battle_planner_logic.js',
    'src/js/calc_integration.js',
  ],
};
