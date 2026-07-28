/**
 * Production-path regression tests.
 *
 * Unlike the other planner suites, these load the REAL @smogon/calc engine
 * instead of the mock in setup.js, and build fixtures with the production
 * constructors rather than hand-written literals. Every case here corresponds
 * to a defect where the previous tests passed while the shipping code was
 * broken, because the fixtures did not match the shapes the app actually
 * produces.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const realCalc = require(path.resolve(__dirname, '../../../calc/dist/index.js'));

function loadScript(rel) {
  const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const indirectEval = eval;
  indirectEval(code);
}

let BP, CI, Logic;

beforeAll(() => {
  window.calc = realCalc;
  loadScript('battle_planner.js');
  BP = window.BattlePlanner;
  window.exports = window.exports || {};
  loadScript('data/rbdex/moves.js');
  loadScript('data/rbdex/pokedex.js');
  window.BattleMovedex = window.exports.BattleMovedex;
  window.BattlePokedex = window.exports.BattlePokedex;
  loadScript('data/rbdex/rbdex_adapter.js');
  loadScript('data/move_db.js');
  window.MoveDB.init();
  loadScript('calc_integration.js');
  CI = window.BattlePlanner.CalcIntegration;
  loadScript('battle_planner_logic.js');
  Logic = window.BattlePlannerLogic;
  window.GENERATION = realCalc.Generations.get(8);
});

const gen = () => realCalc.Generations.get(8);

function realSnapshot(species, overrides) {
  const p = new realCalc.Pokemon(gen(), species || 'Blaziken', { level: 100 });
  const snap = new BP.PokemonSnapshot(p);
  Object.assign(snap, overrides || {});
  return snap;
}

function stateOf(p1, p2) {
  const state = new BP.BattleStateSnapshot();
  state.p1.active = p1;
  state.p1.team = [p1.clone()];
  state.p1.teamSlot = 0;
  state.p2.active = p2;
  state.p2.team = [p2.clone()];
  state.p2.teamSlot = 0;
  return state;
}

// ---------------------------------------------------------------------------
// Multi-hit damage is a TOTAL, not a single hit
// ---------------------------------------------------------------------------
describe('multi-hit damage totals', () => {
  test('getDamageRange multiplies per-hit rolls by the hit count', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100, evs: { hp: 252 } });
    const move = new realCalc.Move(gen(), 'Pin Missile', { hits: 5 });
    const result = realCalc.calculate(gen(), atk, def, move, new realCalc.Field());

    const range = CI.getDamageRange(result);
    const perHit = result.damage;

    expect(range.hits).toBe(5);
    expect(range.min).toBe(Math.min(...perHit) * 5);
    expect(range.max).toBe(Math.max(...perHit) * 5);
    expect(range.perHitMin).toBe(Math.min(...perHit));
    expect(range.perHitMax).toBe(Math.max(...perHit));

    // The engine's own description is the source of truth for the total
    const descTotal = result.desc().match(/:\s(\d+)-(\d+)\s/);
    expect(Number(descTotal[1])).toBe(range.min);
    expect(Number(descTotal[2])).toBe(range.max);
  });

  test('single-hit moves are unaffected', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100, evs: { hp: 252 } });
    const result = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Close Combat'));
    const range = CI.getDamageRange(result);

    expect(range.hits).toBe(1);
    expect([range.min, range.max]).toEqual(result.range());
  });

  test('getDamageRolls returns merged total-damage probabilities summing to 1', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100, evs: { hp: 252 } });
    const result = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Pin Missile', { hits: 5 }));

    const rolls = CI.getDamageRolls(result);
    const total = rolls.reduce((a, r) => a + r.probability, 0);

    expect(total).toBeCloseTo(1, 8);
    expect(rolls[0].damage).toBe(CI.getDamageRange(result).min);
    expect(rolls[rolls.length - 1].damage).toBe(CI.getDamageRange(result).max);
  });
});

// ---------------------------------------------------------------------------
// Current HP crosses the snapshot <-> engine boundary in both directions
// ---------------------------------------------------------------------------
describe('current HP plumbing', () => {
  test('extractCurHP reads a damaged calc.Pokemon', () => {
    const p = new realCalc.Pokemon(gen(), 'Swampert', { level: 100, curHP: 100 });
    const snap = new BP.PokemonSnapshot(p);

    expect(snap.currentHP).toBe(100);
    expect(snap.currentHP).toBeLessThan(snap.maxHP);
  });

  test('snapshotToPokemon writes originalCurHP and leaves curHP() callable', () => {
    const p = new realCalc.Pokemon(gen(), 'Swampert', { level: 100 });
    const snap = new BP.PokemonSnapshot(p);
    snap.currentHP = 50;

    const rebuilt = CI.snapshotToPokemon(snap, gen());

    expect(typeof rebuilt.curHP).toBe('function');
    expect(rebuilt.curHP()).toBe(50);
    expect(rebuilt.originalCurHP).toBe(50);
  });

  test('HP-dependent moves see the real current HP', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const base = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100 });
    const snap = new BP.PokemonSnapshot(base);
    snap.currentHP = Math.floor(snap.maxHP / 2);

    const rebuilt = CI.snapshotToPokemon(snap, gen());
    const superFang = realCalc.calculate(gen(), atk, rebuilt, new realCalc.Move(gen(), 'Super Fang'));

    // Super Fang deals half the defender's CURRENT HP
    expect(superFang.range()[0]).toBe(Math.floor(snap.currentHP / 2));
  });

  test('KO descriptions reflect the damaged defender', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const base = new realCalc.Pokemon(gen(), 'Swampert', { level: 100, evs: { hp: 252 } });
    const snap = new BP.PokemonSnapshot(base);
    snap.currentHP = 30;

    const rebuilt = CI.snapshotToPokemon(snap, gen());
    const result = realCalc.calculate(gen(), atk, rebuilt, new realCalc.Move(gen(), 'Close Combat'));

    expect(result.desc()).toContain('OHKO');
  });
});

// ---------------------------------------------------------------------------
// Team slot synchronisation
// ---------------------------------------------------------------------------
describe('applyOutcomeToState team slots', () => {
  test('p1 attacking updates p2 team slot with the damaged defender', () => {
    const state = stateOf(realSnapshot('Blaziken'), realSnapshot('Swampert'));
    const before = state.p2.active.currentHP;
    const next = CI.applyOutcomeToState(state, { damage: 120, effects: {} }, 'p1', null);

    expect(next.p2.team[0].name).toBe(next.p2.active.name);
    expect(next.p2.team[0].currentHP).toBe(before - 120);
  });

  test('p2 attacking does NOT inject the attacker into p1 team slot', () => {
    const state = stateOf(realSnapshot('Blaziken'), realSnapshot('Swampert'));
    const before = state.p1.active.currentHP;
    const next = CI.applyOutcomeToState(state, { damage: 120, effects: {} }, 'p2', null);

    expect(next.p1.active.name).toBe('Blaziken');
    expect(next.p1.team[0].name).toBe('Blaziken');
    expect(next.p1.team[0].currentHP).toBe(before - 120);
    expect(next.p2.team[0].name).toBe('Swampert');
  });
});

// ---------------------------------------------------------------------------
// Accuracy actually resolves
// ---------------------------------------------------------------------------
describe('accuracy resolution from RBDex', () => {
  test('calc move data alone has no accuracy, MoveDB supplies it', () => {
    const calcMove = gen().moves.get('focusblast');
    expect(calcMove.accuracy).toBeUndefined();
    // 80, not the vanilla 70 — RnB buffs Focus Blast, and RBDex is the source
    // of RnB move data. This is exactly why accuracy must not come from the
    // Smogon engine's tables.
    expect(CI.resolveBaseAccuracy(calcMove)).toBe(80);
    expect(CI.resolveBaseAccuracy(gen().moves.get('stoneedge'))).toBe(85);
    expect(CI.resolveBaseAccuracy(gen().moves.get('dynamicpunch'))).toBe(50);
    // `true` means "never misses"
    expect(CI.resolveBaseAccuracy(gen().moves.get('aerialace'))).toBe(true);
  });

  test('a shaky move produces a real miss chance, undistorted by folding', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { spa: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100, evs: { hp: 252 } });
    const outcomes = CI.calculateAllOutcomes(
      atk, def, new realCalc.Move(gen(), 'Focus Blast'), new realCalc.Field(), gen()
    );

    const miss = outcomes.find(o => o.isMiss);
    expect(miss).toBeDefined();
    // Focus Blast is 80% in RnB, so exactly 20% miss — dropping negligible crit
    // sub-rolls must not inflate this.
    expect(miss.probability).toBeCloseTo(0.20, 6);
  });

  test('never-miss moves produce no miss branch', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100 });
    const outcomes = CI.calculateAllOutcomes(
      atk, def, new realCalc.Move(gen(), 'Aerial Ace'), new realCalc.Field(), gen()
    );

    expect(outcomes.find(o => o.isMiss)).toBeUndefined();
  });

  test('evasion and accuracy stages are honoured', () => {
    const move = { name: 'Thunderbolt', accuracy: 100, category: 'Special' };
    const plain = CI.getAccuracy(move, {}, {}, {}, gen());
    const vsEvasive = CI.getAccuracy(move, {}, { boosts: { evasion: 2 } }, {}, gen());
    const withAccBoost = CI.getAccuracy(move, { boosts: { accuracy: 2 } }, { boosts: { evasion: 2 } }, {}, gen());

    expect(plain).toBe(100);
    expect(vsEvasive).toBe(60);      // 100 * 3/5
    expect(withAccBoost).toBe(100);  // stages cancel out
  });

  test('probabilities across all outcomes still sum to 1', () => {
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { spa: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Snorlax', { level: 100, evs: { hp: 252 } });
    const outcomes = CI.calculateAllOutcomes(
      atk, def, new realCalc.Move(gen(), 'Focus Blast'), new realCalc.Field(), gen()
    );

    const total = outcomes.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// KO chance measures against current HP
// ---------------------------------------------------------------------------
describe('calculateKOChance', () => {
  test('uses current HP for every branch', () => {
    const ko = CI.calculateKOChance(100, 200, 300);
    expect(ko.hitsToKO).toBe(2);
    expect(ko.twoHKO).toBe(true);
    expect(ko.threeHKO).toBeUndefined();
  });

  test('reports hits from full separately', () => {
    const ko = CI.calculateKOChance(100, 200, 300);
    expect(ko.hitsToKOFromFull).toBe(3);
  });

  test('no fabricated probability constants', () => {
    expect(CI.calculateKOChance(160, 300, 300).chance).toBeUndefined();
    expect(CI.calculateKOChance(400, 300, 300).chance).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// End-of-turn effects reachable from production state
// ---------------------------------------------------------------------------
describe('end-of-turn effects on production snapshots', () => {
  test('volatiles survive snapshot clone and state clone', () => {
    const p = realSnapshot('Blaziken', { currentHP: 200 });
    p.setVolatile('leechseed', true);

    expect(p.clone().volatiles.leechseed).toBe(true);

    const state = stateOf(p, realSnapshot('Swampert'));
    const cloned = state.clone();
    expect(cloned.p1.active.volatiles.leechseed).toBe(true);

    const fx = Logic.applyEndOfTurnEffects(cloned, 8);
    expect(fx.join('|')).toContain('Leech Seed');
  });

  test('Flame Orb fires on a healthy production snapshot', () => {
    const p = realSnapshot('Blaziken', { item: 'Flame Orb' });
    expect(p.status).toBe('Healthy');

    Logic.applyEndOfTurnEffects(stateOf(p, realSnapshot('Swampert')), 8);
    expect(p.status).toBe('Burned');
  });

  test('healing resolves before poison damage', () => {
    // 40/320 with Leftovers + poison: heal 20 -> 60, poison 40 -> 20. Survives.
    const p = realSnapshot('Blaziken', {
      maxHP: 320, currentHP: 40, status: 'Poisoned', item: 'Leftovers'
    });
    Logic.applyEndOfTurnEffects(stateOf(p, realSnapshot('Swampert')), 8);

    expect(p.currentHP).toBe(20);
    expect(p.hasFainted).toBe(false);
  });

  test('burn tick uses the generation actually in play', () => {
    const g8 = realSnapshot('Blaziken', { maxHP: 320, currentHP: 320, status: 'Burned' });
    Logic.applyEndOfTurnEffects(stateOf(g8, realSnapshot('Swampert')), 8);
    expect(320 - g8.currentHP).toBe(20);

    const g3 = realSnapshot('Blaziken', { maxHP: 320, currentHP: 320, status: 'Burned' });
    Logic.applyEndOfTurnEffects(stateOf(g3, realSnapshot('Swampert')), 3);
    expect(320 - g3.currentHP).toBe(40);
  });

  test('a Generation object is accepted as well as a number', () => {
    const p = realSnapshot('Blaziken', { maxHP: 320, currentHP: 320, status: 'Burned' });
    Logic.applyEndOfTurnEffects(stateOf(p, realSnapshot('Swampert')), gen());
    expect(320 - p.currentHP).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Serialisation round-trip
// ---------------------------------------------------------------------------
describe('tree serialisation', () => {
  test('outcome and action prototypes survive a save/load cycle', () => {
    const tree = new BP.BattleTree();
    const state = stateOf(realSnapshot('Blaziken'), realSnapshot('Swampert'));
    tree.initialize(state);
    tree.addBranch(
      tree.rootId,
      state.clone(),
      { p1: new BP.BattleAction('move', { moveName: 'Flare Blitz' }), p2: null },
      new BP.BattleOutcome('Crit', 0.5, 100, { crit: true })
    );

    const revived = new BP.BattleTree();
    revived.deserialize(tree.serialize());
    const child = revived.getNode(revived.getNode(revived.rootId).children[0]);

    expect(typeof child.outcome.getLabel).toBe('function');
    expect(child.outcome.getLabel()).toBe('Crit');
    expect(typeof child.actions.p1.describe).toBe('function');
    expect(child.actions.p1.describe()).toBe('Flare Blitz');
    expect(() => child.getFullLabel()).not.toThrow();
  });

  test('a zero-probability outcome stays impossible', () => {
    expect(new BP.BattleOutcome('impossible', 0, 0, {}).probability).toBe(0);
  });

  test('rootIds is per-instance', () => {
    const a = new BP.BattleTree();
    const b = new BP.BattleTree();
    a.addRoot(new BP.BattleStateSnapshot(), 'A');

    expect(b.rootIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Type effectiveness agrees with the engine
// ---------------------------------------------------------------------------
describe('type effectiveness', () => {
  test('ability immunities are honoured', () => {
    expect(CI.getTypeEffectiveness('Ground', ['Steel', 'Psychic'], { ability: 'Levitate' })).toBe(0);
    expect(CI.getTypeEffectiveness('Fire', ['Grass'], { ability: 'Flash Fire' })).toBe(0);
    expect(CI.getTypeEffectiveness('Water', ['Fire'], { ability: 'Water Absorb' })).toBe(0);
  });

  test('agrees with the engine on Levitate', () => {
    const engineRange = realCalc.calculate(
      gen(),
      new realCalc.Pokemon(gen(), 'Blaziken', { level: 100 }),
      new realCalc.Pokemon(gen(), 'Bronzong', { level: 100, ability: 'Levitate' }),
      new realCalc.Move(gen(), 'Earthquake')
    ).range();

    expect(engineRange[1]).toBe(0);
    expect(CI.getTypeEffectiveness('Ground', ['Steel', 'Psychic'], { ability: 'Levitate' })).toBe(0);
  });

  test('no defender still returns the plain type chart result', () => {
    expect(CI.getTypeEffectiveness('Ground', ['Steel', 'Psychic'])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Misc production-shape fixes
// ---------------------------------------------------------------------------
describe('miscellaneous', () => {
  test('PP comes from move data rather than a flat 35', () => {
    const p = new realCalc.Pokemon(gen(), 'Blaziken', {
      level: 100,
      moves: [new realCalc.Move(gen(), 'Flare Blitz'), new realCalc.Move(gen(), 'Swords Dance')]
    });
    const snap = new BP.PokemonSnapshot(p);

    expect(snap.pp[0]).toBe(15); // Flare Blitz
    expect(snap.pp[1]).toBe(20); // Swords Dance
  });

  test('pokedex numbers resolve for arbitrary species', () => {
    expect(CI.getSpriteUrl('Swampert')).toContain('/260.png');
    expect(CI.getSpriteUrl('Blaziken')).toContain('/257.png');
    expect(CI.getSpriteUrl('Charizard-Mega-X')).toContain('/6.png');
  });

  test('simplifyOutcomes folds dropped mass into same-kind outcomes, not into Miss', () => {
    const outcomes = [
      { description: 'Miss', probability: 0.3, isMiss: true },
      { description: 'Hit', probability: 0.695 },
      { description: 'Crit sliver', probability: 0.005, isCrit: true }
    ];
    const kept = CI.simplifyOutcomes(outcomes, 0.01);

    expect(kept).toHaveLength(2);
    expect(kept.reduce((a, o) => a + o.probability, 0)).toBeCloseTo(1, 8);
    // Miss must be untouched; the crit sliver has no surviving crit kin, so the
    // orphan mass is spread proportionally rather than piled onto Miss.
    expect(kept[0].probability).toBeLessThan(0.302);
    expect(kept[0].description).toBe('Miss');
  });

  test('a negligible crit sub-roll folds into the main crit branch', () => {
    const outcomes = [
      { description: 'Miss', probability: 0.2, isMiss: true },
      { description: 'Normal', probability: 0.75 },
      { description: 'Crit', probability: 0.045, isCrit: true },
      { description: 'Crit (High)', probability: 0.005, isCrit: true }
    ];
    const kept = CI.simplifyOutcomes(outcomes, 0.01);

    expect(kept.find(o => o.isMiss).probability).toBe(0.2);
    expect(kept.find(o => o.description === 'Crit').probability).toBeCloseTo(0.05, 8);
    expect(kept.reduce((a, o) => a + o.probability, 0)).toBeCloseTo(1, 8);
  });
});
