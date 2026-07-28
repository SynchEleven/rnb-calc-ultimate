/**
 * Conformance to the official Run and Bun documentation.
 *
 * Every expectation here is transcribed from the game's own docs rather than
 * inferred from Smogon behaviour or from the ROM dump. This file exists because
 * several of these were wrong in ways nothing else could catch: the data sources
 * agreed with each other while both disagreed with the game.
 *
 * The docs open with "For any mechanic that's not described in here, assume
 * Generation 8 mechanics", so anything absent below is deliberately left to the
 * gen 8 defaults.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const realCalc = require(path.resolve(__dirname, '../../../calc/dist/index.js'));

function loadScript(rel) {
  const indirectEval = eval;
  indirectEval(fs.readFileSync(path.join(SRC, rel), 'utf8'));
}

let BP, CI, Logic, movedex;

beforeAll(() => {
  window.calc = realCalc;
  loadScript('battle_planner.js');
  BP = window.BattlePlanner;
  window.exports = window.exports || {};
  loadScript('data/rbdex/moves.js');
  window.BattleMovedex = window.exports.BattleMovedex;
  movedex = window.BattleMovedex;
  loadScript('data/move_db.js');
  window.MoveDB.init();
  loadScript('calc_integration.js');
  CI = window.BattlePlanner.CalcIntegration;
  loadScript('battle_planner_logic.js');
  Logic = window.BattlePlannerLogic;
});

const gen = () => realCalc.Generations.get(8);
const id = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function mon(species, over) {
  const p = new realCalc.Pokemon(gen(), species, { level: 100 });
  const snap = new BP.PokemonSnapshot(p);
  Object.assign(snap, over || {});
  snap.refreshPP();
  return snap;
}

function makeState(p1Over, p2Over) {
  const s = new BP.BattleStateSnapshot();
  s.p1.active = mon('Blaziken', p1Over);
  s.p1.team = [s.p1.active.clone()];
  s.p2.active = mon('Swampert', p2Over);
  s.p2.team = [s.p2.active.clone()];
  return s;
}

// ---------------------------------------------------------------------------
describe('docs: critical hits', () => {
  // "Critical hit chance: 1/16."
  test('base critical hit chance is 1/16', () => {
    expect(CI.getCritChance({ name: 'Tackle' }, {}, {}, {}, { num: 8 })).toBeCloseTo(1 / 16, 9);
  });

  test('high-crit moves and boosters climb from that base', () => {
    const g = { num: 8 };
    expect(CI.getCritChance({ name: 'Slash' }, {}, {}, {}, g)).toBeCloseTo(1 / 8, 9);
    expect(CI.getCritChance({ name: 'Slash' }, { item: 'Scope Lens' }, {}, {}, g))
      .toBeCloseTo(1 / 2, 9);
  });

  // "Critical hit damage multiplier: 1.5."
  test('critical hits multiply damage by 1.5, not 2', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100 });
    const normal = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Close Combat'));
    const crit = realCalc.calculate(gen(), atk, def,
      new realCalc.Move(gen(), 'Close Combat', { isCrit: true }));

    expect(crit.range()[1] / normal.range()[1]).toBeCloseTo(1.5, 1);
  });

  // "Magma Armor: Prevents critical-hits on top of it's existing effects."
  test('Magma Armor prevents critical hits', () => {
    expect(CI.getCritChance({ name: 'Slash' }, {}, { ability: 'Magma Armor' }, {}, { num: 8 }))
      .toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('docs: status conditions', () => {
  // "Paralysis: Speed decreases by 75%."
  test('paralysis leaves a quarter of Speed', () => {
    const healthy = mon('Blaziken');
    const paralysed = mon('Blaziken', { status: 'Paralyzed' });
    expect(paralysed.getEffectiveSpeed()).toBe(Math.floor(healthy.getEffectiveSpeed() * 0.25));
  });

  // "Sleep: If a Pokemon enters a battle asleep it's sleeping turns count is reset."
  test('switching in resets the sleep counter', () => {
    const state = new BP.BattleStateSnapshot();
    const sleeper = mon('Blaziken', { status: 'Asleep' });
    sleeper.sleepCounter = 2;
    const bench = mon('Blissey');

    state.p1.active = mon('Swampert');
    state.p1.team = [state.p1.active.clone(), sleeper, bench];
    state.p1.teamSlot = 0;
    state.p2.active = mon('Snorlax');
    state.p2.team = [state.p2.active.clone()];
    state.sides = state.sides || { p1: {}, p2: {} };

    Logic.performSwitch(state, 'p1', 1);
    expect(state.p1.active.name).toBe('Blaziken');
    expect(state.p1.active.sleepCounter).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('docs: items', () => {
  // "Confuse inducing berries: Restore half HP, triggering at 1/4 HP."
  test('confuse-inducing berries restore half max HP at a quarter', () => {
    ['Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry']
      .forEach(berry => {
        const state = makeState({ maxHP: 400, currentHP: 100, item: berry });
        Logic.applyEndOfTurnEffects(state, 8);
        expect(state.p1.active.currentHP).toBe(100 + 200);
        expect(state.p1.active.item).toBe('');
      });
  });

  test('they do not fire above a quarter', () => {
    const state = makeState({ maxHP: 400, currentHP: 101, item: 'Figy Berry' });
    Logic.applyEndOfTurnEffects(state, 8);
    expect(state.p1.active.item).toBe('Figy Berry');
  });

  test('the damage-triggered path heals half as well', () => {
    const p = mon('Blaziken', { maxHP: 400, currentHP: 400, item: 'Figy Berry' });
    const fx = CI.applyItemEffects(p, 320);   // down to 80 = 20%
    expect(fx.healed).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('docs: field effects', () => {
  // "Terrain damage boost: ... boost damage of moves of the matching type by 50%."
  test('matching terrain boosts damage by 50%, not 30%', () => {
    const atk = new realCalc.Pokemon(gen(), 'Pikachu', { level: 100, evs: { spa: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100 });
    const plain = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Thunderbolt'));
    const boosted = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Thunderbolt'),
      new realCalc.Field({ terrain: 'Electric' }));

    expect(boosted.range()[1] / plain.range()[1]).toBeCloseTo(1.5, 1);
  });

  // "Weather abilities: Will set Weather permanently."
  test('weather set by an ability never times out', () => {
    const state = makeState({ ability: 'Drought' }, {});
    state.field.weather = 'Sun';
    state.field.weatherTurns = 1;

    Logic.applyEndOfTurnEffects(state, 8);
    expect(state.field.weather).toBe('Sun');
  });

  test('weather from a move still expires', () => {
    const state = makeState({ ability: 'Blaze' }, { ability: 'Torrent' });
    state.field.weather = 'Rain';
    state.field.weatherTurns = 1;

    Logic.applyEndOfTurnEffects(state, 8);
    expect(state.field.weather).toBe('None');
  });

  test('terrain set by an ability never times out', () => {
    const state = makeState({ ability: 'Electric Surge' }, {});
    state.field.terrain = 'Electric';
    state.field.terrainTurns = 1;

    Logic.applyEndOfTurnEffects(state, 8);
    expect(state.field.terrain).toBe('Electric');
  });
});

// ---------------------------------------------------------------------------
describe('docs: move changes', () => {
  // "Explosion / Self-Destruct / Misty Explosion: Halves target's defense."
  test('the Explosion family halves the target defence', () => {
    const atk = new realCalc.Pokemon(gen(), 'Mew', { level: 100 });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100 });
    const boom = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Explosion'));
    const g5 = realCalc.Generations.get(5);
    const boom5 = realCalc.calculate(g5,
      new realCalc.Pokemon(g5, 'Mew', { level: 100 }),
      new realCalc.Pokemon(g5, 'Snorlax', { level: 100 }),
      new realCalc.Move(g5, 'Explosion'));

    // Same base power in both gens, so roughly double from halving defence
    expect(boom.range()[1] / boom5.range()[1]).toBeGreaterThan(1.8);
  });

  // "Misty Explosion: 100 > 200" base power
  test('Misty Explosion has 200 base power', () => {
    expect(movedex[id('Misty Explosion')].basePower).toBe(200);
  });

  // "Super Fang: Normal > Dark", "Covet: Normal > Fairy"
  test('retyped moves match the docs in both data sources', () => {
    expect(movedex[id('Super Fang')].type).toBe('Dark');
    expect(gen().moves.get(id('Super Fang')).type).toBe('Dark');
    expect(movedex[id('Covet')].type).toBe('Fairy');
    expect(gen().moves.get(id('Covet')).type).toBe('Fairy');
  });

  // "Hidden Power: always has 60 BP"
  test('Hidden Power is always 60 base power', () => {
    expect(movedex[id('Hidden Power')].basePower).toBe(60);
  });

  // Base-power buffs from the docs table
  test('buffed base powers match the docs', () => {
    const expected = {
      'Absorb': 40, 'Mega Drain': 60, 'Astonish': 40, 'Lick': 40,
      'Charge Beam': 40, 'Octazooka': 80, 'Return': 102, 'Frustration': 102
    };
    Object.keys(expected).forEach(name => {
      expect(movedex[id(name)].basePower).toBe(expected[name]);
    });
  });

  // Accuracy changes from the docs table, including the two that were wrong
  test('accuracy matches the docs, including Head Smash and Hydro Pump at 85', () => {
    const expected = {
      'Head Smash': 85, 'Hydro Pump': 85, 'Focus Blast': 80, 'Thunder': 80,
      'Blizzard': 80, 'Hurricane': 80, 'Stone Edge': 85, 'Gunk Shot': 85,
      'Iron Tail': 85, 'Cross Chop': 90, 'Megahorn': 90, 'Power Whip': 90,
      'Sing': 70, 'Grass Whistle': 70, 'Hypnosis': 70, 'Supersonic': 70,
      'Sleep Powder': 80, 'Stun Spore': 90, 'Poison Powder': 90,
      'Rock Slide': 100, 'Pin Missile': 100, 'Icy Wind': 100, 'Flash': 70
    };
    const wrong = Object.keys(expected)
      .filter(name => movedex[id(name)].accuracy !== expected[name])
      .map(name => name + ': docs=' + expected[name] + ' data=' + movedex[id(name)].accuracy);
    expect(wrong).toEqual([]);
  });

  // "Rock Smash: 50% > 100%" effect chance, "Smog: 40% > 100%"
  test('guaranteed secondary effects are guaranteed', () => {
    expect(movedex[id('Rock Smash')].secondary.chance).toBe(100);
    expect(movedex[id('Smog')].secondary.chance).toBe(100);
    expect(movedex[id('Charge Beam')].secondary.chance).toBe(100);
  });

  // "Thunder Wave: Electric-types cannot miss when using it."
  test('an Electric type never misses Thunder Wave', () => {
    const electric = mon('Pikachu');
    const nonElectric = mon('Blaziken');
    const entry = window.MoveDB.get('Thunder Wave');

    expect(CI.getAccuracy(entry, electric, mon('Snorlax'), {}, 8)).toBe(100);
    expect(CI.getAccuracy(entry, nonElectric, mon('Snorlax'), {}, 8))
      .toBe(entry.accuracy === true ? 100 : entry.accuracy);
  });
});

// ---------------------------------------------------------------------------
describe('docs: abilities', () => {
  // "Gale Wings: Will always boost the priority of Flying-type moves,
  //  regardless of HP."
  test('Gale Wings has no HP requirement', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../calc/src/mechanics/gen789.ts'), 'utf8');
    const idx = src.indexOf('Gale Wings');
    expect(idx).toBeGreaterThan(-1);
    // The vanilla implementation gates on full HP; RnB removes that
    const nearby = src.slice(Math.max(0, idx - 200), idx + 200);
    expect(/curHP\(\)\s*===\s*\w+\.maxHP\(\)/.test(nearby)).toBe(false);
  });

  // "Terrain abilities: Will set Terrain permanently."
  test('the permanent-field ability lists cover the surge abilities', () => {
    const logic = fs.readFileSync(path.join(SRC, 'battle_planner_logic.js'), 'utf8');
    ['electricsurge', 'grassysurge', 'mistysurge', 'psychicsurge']
      .forEach(a => expect(logic).toContain(a));
    ['drought', 'drizzle', 'sandstream', 'snowwarning']
      .forEach(a => expect(logic).toContain(a));
  });
});

// ---------------------------------------------------------------------------
describe('docs: Disguise', () => {
  // "Disguise: No damage taken as the Disguise is broken."
  let B, executor;

  beforeAll(() => {
    loadScript('battle_planner_branching.js');
    B = window.BattlePlannerBranching;
    executor = B.createTurnExecutor({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, Logic, gen: 8
    });
  });

  test('the first hit against Disguise deals no damage at all', () => {
    const state = makeState({}, { ability: 'Disguise' });
    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Close Combat' }, p2: null });

    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p2.active.currentHP).toBe(e.state.p2.active.maxHP);
      expect(e.state.p2.active.hasVolatile('disguiseBroken')).toBe(true);
    });
  });

  test('once broken, damage lands normally', () => {
    const state = makeState({}, { ability: 'Disguise' });
    state.p2.active.setVolatile('disguiseBroken', true);

    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Close Combat' }, p2: null });

    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p2.active.currentHP).toBeLessThan(e.state.p2.active.maxHP);
    });
  });

  test('breaking the Disguise costs no HP of its own', () => {
    const state = makeState({}, { ability: 'Disguise', currentHP: 200, maxHP: 200 });
    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Close Combat' }, p2: null });

    // Vanilla gen 8 would chip 1/8 here; the docs remove that
    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p2.active.currentHP).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
describe('type immunity to status', () => {
  function plain(types, over) {
    const m = new BP.PokemonSnapshot(null);
    Object.assign(m, {
      name: 'T', maxHP: 300, currentHP: 300, status: 'Healthy', types: types,
      boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
      volatiles: {}, item: '', ability: ''
    }, over || {});
    return m;
  }

  test('Steel and Poison types cannot be poisoned', () => {
    expect(plain(['Steel']).inflictStatus('psn')).toBe(false);
    expect(plain(['Steel']).inflictStatus('tox')).toBe(false);
    expect(plain(['Poison']).inflictStatus('psn')).toBe(false);
    expect(plain(['Steel', 'Flying']).inflictStatus('tox')).toBe(false);
  });

  test('Electric cannot be paralysed, Fire cannot be burned, Ice cannot be frozen', () => {
    expect(plain(['Electric']).inflictStatus('par')).toBe(false);
    expect(plain(['Fire']).inflictStatus('brn')).toBe(false);
    expect(plain(['Ice']).inflictStatus('frz')).toBe(false);
  });

  test('those same types take other statuses normally', () => {
    expect(plain(['Steel']).inflictStatus('par')).toBe(true);
    expect(plain(['Electric']).inflictStatus('brn')).toBe(true);
    expect(plain(['Fire']).inflictStatus('par')).toBe(true);
  });

  test('Corrosion poisons Steel and Poison types anyway', () => {
    expect(plain(['Steel']).inflictStatus('psn', undefined,
      { attackerAbility: 'Corrosion' })).toBe(true);
    expect(plain(['Poison']).inflictStatus('tox', undefined,
      { attackerAbility: 'Corrosion' })).toBe(true);
  });

  test('Corrosion does not bypass anything else', () => {
    expect(plain(['Electric']).inflictStatus('par', undefined,
      { attackerAbility: 'Corrosion' })).toBe(false);
  });

  test('abilities grant immunity', () => {
    expect(plain(['Normal'], { ability: 'Limber' }).inflictStatus('par')).toBe(false);
    expect(plain(['Normal'], { ability: 'Immunity' }).inflictStatus('psn')).toBe(false);
    expect(plain(['Normal'], { ability: 'Water Veil' }).inflictStatus('brn')).toBe(false);
    expect(plain(['Normal'], { ability: 'Insomnia' }).inflictStatus('slp')).toBe(false);
    expect(plain(['Normal'], { ability: 'Vital Spirit' }).inflictStatus('slp')).toBe(false);
  });

  test('Mold Breaker ignores the ability but not the typing', () => {
    expect(plain(['Normal'], { ability: 'Limber' }).inflictStatus('par', undefined,
      { attackerAbility: 'Mold Breaker' })).toBe(true);
    expect(plain(['Electric'], { ability: 'Limber' }).inflictStatus('par', undefined,
      { attackerAbility: 'Mold Breaker' })).toBe(false);
  });

  test('Misty Terrain protects anything grounded, Electric Terrain blocks sleep', () => {
    expect(plain(['Normal']).inflictStatus('brn', undefined,
      { field: { terrain: 'Misty' } })).toBe(false);
    expect(plain(['Normal']).inflictStatus('slp', undefined,
      { field: { terrain: 'Electric' } })).toBe(false);
    // Electric Terrain does not stop a burn
    expect(plain(['Normal']).inflictStatus('brn', undefined,
      { field: { terrain: 'Electric' } })).toBe(true);
  });

  test('a Flying type is not grounded, so terrain does not shield it', () => {
    expect(plain(['Flying']).inflictStatus('brn', undefined,
      { field: { terrain: 'Misty' } })).toBe(true);
    expect(plain(['Normal'], { ability: 'Levitate' }).inflictStatus('brn', undefined,
      { field: { terrain: 'Misty' } })).toBe(true);
  });

  test('Safeguard blocks status on that side', () => {
    expect(plain(['Normal']).inflictStatus('par', undefined,
      { sideState: { safeguard: true } })).toBe(false);
  });

  test('a Steel type never gets a poison branch from a move secondary', () => {
    loadScript('battle_planner_branching.js');
    const B = window.BattlePlannerBranching;
    const executor = B.createTurnExecutor({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, Logic, gen: 8
    });

    // Poison Fang against a Steel type: the poison can never land
    const state = makeState({ moves: ['Poison Fang'] }, {});
    state.p2.active.types = ['Steel'];

    const produced = executor(state, { p1: { type: 'move', moveName: 'Poison Fang' }, p2: null });
    const poisoned = new B.StateDist(produced).merge().entries
      .filter(e => e.state.p2.active.status !== 'Healthy')
      .reduce((a, e) => a + e.probability, 0);

    expect(poisoned).toBe(0);
  });
});
