/**
 * Test setup: loads the battle planner IIFE scripts into the jsdom window
 * and provides mock factories for building test fixtures.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');

function loadScript(filename) {
  const code = fs.readFileSync(path.join(SRC, filename), 'utf8');
  // Use indirect eval so the script can access jsdom's `window` global
  const indirectEval = eval;
  indirectEval(code);
}

function setupBattlePlanner() {
  loadScript('battle_planner.js');
  return window.BattlePlanner;
}

function setupCalcIntegration(calcMock) {
  window.calc = calcMock || createDefaultCalcMock();
  loadScript('calc_integration.js');
  return window.BattlePlanner.CalcIntegration;
}

function setupLogic() {
  loadScript('battle_planner_logic.js');
  return window.BattlePlannerLogic;
}

function createDefaultCalcMock() {
  return {
    calculate: jest.fn(() => ({ damage: [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175] })),
    Move: jest.fn(function (gen, name, options) {
      this.name = name;
      this.isCrit = (options && options.isCrit) || false;
      this.clone = () => Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    }),
    Pokemon: jest.fn(function (gen, name, options) {
      this.name = name;
      Object.assign(this, options);
      this.clone = () => Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    }),
    Field: jest.fn(function (options) {
      Object.assign(this, options);
    }),
    Generations: { get: jest.fn(() => ({ num: 3, moves: { get: jest.fn(() => null) } })) },
    toID: jest.fn(s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')),
  };
}

/**
 * Build a PokemonSnapshot with sensible defaults for testing.
 */
function makePokemon(overrides) {
  const BP = window.BattlePlanner;
  const p = new BP.PokemonSnapshot(null);
  const defaults = {
    name: 'Blaziken',
    species: 'Blaziken',
    level: 100,
    maxHP: 300,
    currentHP: 300,
    percentHP: 100,
    status: 'Healthy',
    toxicCounter: 0,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    ability: 'Blaze',
    item: '',
    nature: 'Adamant',
    moves: ['Flare Blitz', 'Close Combat', 'Thunder Punch', 'Swords Dance'],
    pp: [15, 5, 15, 20],
    types: ['Fire', 'Fighting'],
    stats: { hp: 300, atk: 350, def: 200, spa: 250, spd: 200, spe: 260 },
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    isActive: true,
    hasFainted: false,
  };
  Object.assign(p, defaults, overrides);
  return p;
}

/**
 * Build a BattleStateSnapshot with two Pokemon and default field/sides.
 */
function makeState(p1Overrides, p2Overrides, fieldOverrides, sidesOverrides) {
  const BP = window.BattlePlanner;
  const state = new BP.BattleStateSnapshot();

  const p1 = makePokemon(Object.assign({ name: 'Blaziken', types: ['Fire', 'Fighting'] }, p1Overrides));
  const p2 = makePokemon(Object.assign({
    name: 'Swampert', types: ['Water', 'Ground'],
    ability: 'Torrent', stats: { hp: 340, atk: 300, def: 260, spa: 230, spd: 260, spe: 200 },
    maxHP: 340, currentHP: 340,
    moves: ['Earthquake', 'Ice Beam', 'Surf', 'Stealth Rock'],
  }, p2Overrides));

  state.p1.active = p1;
  state.p1.team = [p1.clone()];
  state.p1.teamSlot = 0;

  state.p2.active = p2;
  state.p2.team = [p2.clone()];
  state.p2.teamSlot = 0;

  if (fieldOverrides) Object.assign(state.field, fieldOverrides);
  if (sidesOverrides) {
    if (sidesOverrides.p1) Object.assign(state.sides.p1, sidesOverrides.p1);
    if (sidesOverrides.p2) Object.assign(state.sides.p2, sidesOverrides.p2);
  }

  return state;
}

module.exports = {
  loadScript,
  setupBattlePlanner,
  setupCalcIntegration,
  setupLogic,
  createDefaultCalcMock,
  makePokemon,
  makeState,
  SRC,
};
