/**
 * Tests for the outcome-relevant branching engine.
 *
 * The contract under test:
 *   - damage rolls that change nothing produce ONE branch
 *   - rolls that cross a meaningful threshold produce exactly the branches
 *     that differ, and no more
 *   - probabilistic effects (secondary status, flinch, crit, miss) always
 *     branch, because the two worlds genuinely diverge
 *   - a distinction that only becomes relevant on a LATER turn is still
 *     recoverable, because distributions are carried rather than collapsed
 *   - reconcile() re-derives the whole tree, so a change anywhere updates past,
 *     present and future
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');

function loadScript(rel) {
  const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const indirectEval = eval;
  indirectEval(code);
}

let BP, B;

beforeAll(() => {
  loadScript('battle_planner.js');
  BP = window.BattlePlanner;
  loadScript('battle_planner_branching.js');
  B = window.BattlePlannerBranching;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mon(overrides) {
  const p = new BP.PokemonSnapshot(null);
  Object.assign(p, {
    name: 'Blaziken',
    species: 'Blaziken',
    level: 100,
    maxHP: 300,
    currentHP: 300,
    percentHP: 100,
    status: 'Healthy',
    toxicCounter: 0,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    volatiles: {},
    ability: 'Blaze',
    item: '',
    nature: 'Adamant',
    moves: ['Flare Blitz'],
    pp: [15],
    types: ['Fire', 'Fighting'],
    stats: { hp: 300, atk: 350, def: 200, spa: 250, spd: 200, spe: 260 },
    isActive: true,
    hasFainted: false
  }, overrides || {});
  return p;
}

function state(p1Over, p2Over) {
  const s = new BP.BattleStateSnapshot();
  const p1 = mon(Object.assign({ name: 'Blaziken' }, p1Over));
  const p2 = mon(Object.assign({ name: 'Swampert', types: ['Water', 'Ground'] }, p2Over));
  s.p1.active = p1;
  s.p1.team = [p1.clone()];
  s.p2.active = p2;
  s.p2.team = [p2.clone()];
  return s;
}

/** Uniform rolls over an inclusive integer range. */
function rolls(min, max) {
  const out = [];
  const n = max - min + 1;
  for (let d = min; d <= max; d++) out.push({ damage: d, probability: 1 / n });
  return out;
}

/** Apply damage to the defender, honouring Sitrus so thresholds matter. */
function damageTo(side) {
  return function (st, _spec, amount) {
    const target = st[side].active;
    target.currentHP = Math.max(0, target.currentHP - amount);
    if (target.item === 'Sitrus Berry' && target.currentHP > 0 &&
        target.currentHP <= target.maxHP / 2) {
      target.currentHP = Math.min(target.maxHP, target.currentHP + Math.floor(target.maxHP / 4));
      target.item = '';
    }
    target.hasFainted = target.currentHP <= 0;
  };
}

function runMove(startState, spec) {
  const steps = B.moveSteps(spec, damageTo(spec.targetSide));
  const produced = B.applyTurnToState(startState, { steps });
  return new B.StateDist(produced).merge();
}

// ---------------------------------------------------------------------------
// Rolls that change nothing must not branch
// ---------------------------------------------------------------------------
describe('damage rolls only branch when they matter', () => {
  test('16 harmless rolls collapse to a single branch', () => {
    const dist = runMove(state(), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 115),
      critChance: 0
    });

    const branches = B.detectBranches(dist);
    expect(branches).toHaveLength(1);
    expect(branches[0].trivial).toBe(true);
    // ...but the full HP spread is retained for later turns
    expect(branches[0].dist.entries.length).toBe(16);
    expect(branches[0].probability).toBeCloseTo(1, 9);
  });

  test('rolls that straddle lethal produce exactly two branches', () => {
    const dist = runMove(state(null, { currentHP: 110 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 115),
      critChance: 0
    });

    const branches = B.detectBranches(dist);
    expect(branches).toHaveLength(2);

    const faint = branches.find(b => b.answers.p2Fainted === true);
    const survive = branches.find(b => b.answers.p2Fainted === false);
    expect(faint).toBeDefined();
    expect(survive).toBeDefined();
    // rolls 110..115 kill (6 of 16), 100..109 do not (10 of 16)
    expect(faint.probability).toBeCloseTo(6 / 16, 9);
    expect(survive.probability).toBeCloseTo(10 / 16, 9);
  });

  test('rolls that straddle a Sitrus Berry threshold branch on the item', () => {
    // 300 max HP; Sitrus fires at <=150. Damage 145-160 straddles it.
    const dist = runMove(state(null, { currentHP: 300, item: 'Sitrus Berry' }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(145, 160),
      critChance: 0
    });

    const branches = B.detectBranches(dist);
    const ate = branches.find(b => b.answers.p2Item === '');
    const kept = branches.find(b => b.answers.p2Item === 'Sitrus Berry');

    expect(ate).toBeDefined();
    expect(kept).toBeDefined();
    // 150..160 leaves HP <= 150 and triggers the berry: 11 of 16 rolls
    expect(ate.probability).toBeCloseTo(11 / 16, 9);
  });

  test('probabilities always sum to 1 across branches', () => {
    const dist = runMove(state(null, { currentHP: 110, item: 'Sitrus Berry' }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(50, 120),
      critChance: 1 / 24,
      critDamageRolls: rolls(75, 180)
    });

    const total = B.detectBranches(dist).reduce((a, b) => a + b.probability, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});

// ---------------------------------------------------------------------------
// Probabilistic effects always branch
// ---------------------------------------------------------------------------
describe('chance-based effects branch unconditionally', () => {
  test('a 10% burn produces a burned branch and a clean branch', () => {
    const dist = runMove(state(), {
      side: 'p1', targetSide: 'p2',
      damageRolls: [{ damage: 50, probability: 1 }],
      critChance: 0,
      secondaries: [{
        chance: 0.1,
        apply: st => st.p2.active.setStatus('brn')
      }]
    });

    const branches = B.detectBranches(dist);
    expect(branches).toHaveLength(2);

    const burned = branches.find(b => b.answers.p2Status === 'Burned');
    const clean = branches.find(b => b.answers.p2Status === 'Healthy');
    expect(burned.probability).toBeCloseTo(0.1, 9);
    expect(clean.probability).toBeCloseTo(0.9, 9);
  });

  test('a miss chance produces a miss branch', () => {
    const dist = runMove(state(), {
      side: 'p1', targetSide: 'p2',
      accuracy: 80,
      damageRolls: [{ damage: 100, probability: 1 }],
      critChance: 0
    });

    const spread = dist.spread(s => s.p2.active.currentHP);
    const missed = spread.find(e => e.value === 300);
    const hit = spread.find(e => e.value === 200);
    expect(missed.probability).toBeCloseTo(0.2, 9);
    expect(hit.probability).toBeCloseTo(0.8, 9);
  });

  test('a guaranteed secondary does not create a branch', () => {
    const dist = runMove(state(), {
      side: 'p1', targetSide: 'p2',
      damageRolls: [{ damage: 50, probability: 1 }],
      critChance: 0,
      secondaries: [{ chance: 1, apply: st => st.p2.active.applyBoost('def', -1) }]
    });

    expect(B.detectBranches(dist)).toHaveLength(1);
  });

  test('secondaries cannot trigger on a miss', () => {
    const dist = runMove(state(), {
      side: 'p1', targetSide: 'p2',
      accuracy: 50,
      damageRolls: [{ damage: 50, probability: 1 }],
      critChance: 0,
      secondaries: [{ chance: 1, apply: st => st.p2.active.setStatus('brn') }]
    });

    const burnedMass = dist.entries
      .filter(e => e.state.p2.active.status === 'Burned')
      .reduce((a, e) => a + e.probability, 0);
    expect(burnedMass).toBeCloseTo(0.5, 9);
  });

  test('a crit that changes nothing does not branch; one that kills does', () => {
    const harmless = runMove(state(null, { currentHP: 300 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(60, 70),
      critChance: 1 / 24,
      critDamageRolls: rolls(90, 105)
    });
    expect(B.detectBranches(harmless)).toHaveLength(1);

    const lethal = runMove(state(null, { currentHP: 95 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(60, 70),
      critChance: 1 / 24,
      critDamageRolls: rolls(90, 105)
    });
    const branches = B.detectBranches(lethal);
    expect(branches).toHaveLength(2);
    // only crit rolls >= 95 kill: 11 of 16 crit rolls, times the crit chance
    const faint = branches.find(b => b.answers.p2Fainted === true);
    expect(faint.probability).toBeCloseTo((1 / 24) * (11 / 16), 9);
  });
});

// ---------------------------------------------------------------------------
// Retroactive relevance: the case from the brief
// ---------------------------------------------------------------------------
describe('retroactive relevance of earlier rolls', () => {
  test('a turn-2 roll spread that looks irrelevant is still carried', () => {
    // Turn 2: opponent takes 100-115. Nothing happens either way.
    const afterT2 = runMove(state(null, { currentHP: 300 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 115),
      critChance: 0
    });
    expect(B.detectBranches(afterT2)).toHaveLength(1);

    // Turn 3: another 90 damage. Now the turn-2 roll decides the KO, because
    // 300-115-90 = 95 survives but 300-100-90 = 110 also survives... while
    // 300 - roll - 190 splits. Use 190 to straddle.
    const afterT3 = afterT2.flatMap((s, _p) => {
      const next = s.clone();
      next.p2.active.currentHP = Math.max(0, next.p2.active.currentHP - 190);
      next.p2.active.hasFainted = next.p2.active.currentHP <= 0;
      return [{ state: next, probability: 1 }];
    });

    const branches = B.detectBranches(afterT3);
    expect(branches).toHaveLength(2);

    // 300 - roll - 190 <= 0  =>  roll >= 110  => rolls 110..115 = 6 of 16
    const faint = branches.find(b => b.answers.p2Fainted === true);
    expect(faint.probability).toBeCloseTo(6 / 16, 9);
  });

  test('analyzeRollRelevance flags a node whose spread straddles a later threshold', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 300 }));

    root.dist = runMove(state(null, { currentHP: 300 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 115),
      critChance: 0
    });

    // A descendant where the opponent is low enough that survival is in question
    const child = tree.addBranch(
      root.id,
      state(null, { currentHP: 8 }),
      { p1: null, p2: null },
      new BP.BattleOutcome('next turn', 1, 0, {})
    );
    child.state.p2.active.currentHP = 8;

    const relevance = B.analyzeRollRelevance(tree, root.id);
    expect(relevance).not.toBeNull();
    expect(relevance.thresholds.length).toBeGreaterThan(0);
    // The root spread is 185..200 HP, which does not straddle "survives" (1),
    // so this particular node is genuinely settled.
    expect(relevance.stillRelevant).toBe(false);
  });

  test('a node straddling the survival threshold is reported as still relevant', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 110 }));

    root.dist = runMove(state(null, { currentHP: 110 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 115),
      critChance: 0
    });

    const relevance = B.analyzeRollRelevance(tree, root.id);
    expect(relevance.stillRelevant).toBe(true);
    expect(relevance.straddled.some(s => s.side === 'p2')).toBe(true);
  });

  test('threshold collection finds berry, ability and survival points', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(
      { item: 'Sitrus Berry', maxHP: 300 },
      { ability: 'Torrent', maxHP: 300 }
    ));

    const thresholds = B.collectDownstreamThresholds(tree, root);
    const reasons = thresholds.map(t => t.reason);

    expect(reasons).toContain('survives the hit');
    expect(reasons.some(r => /Sitrus Berry activation/.test(r))).toBe(true);
    expect(reasons.some(r => /Torrent activation/.test(r))).toBe(true);

    const sitrus = thresholds.find(t => /Sitrus/.test(t.reason));
    expect(sitrus.value).toBe(151); // must stay above 150 to keep the berry unused
  });
});

// ---------------------------------------------------------------------------
// Whole-tree reconciliation
// ---------------------------------------------------------------------------
describe('reconcile', () => {
  function simpleExecutor(damageRolls) {
    return function (st, _actions) {
      const steps = B.moveSteps(
        { side: 'p1', targetSide: 'p2', damageRolls, critChance: 0 },
        damageTo('p2')
      );
      return B.applyTurnToState(st, { steps });
    };
  }

  test('creates branches where they are warranted', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 110 }));
    tree.addBranch(root.id, state(), { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));

    const report = B.reconcile(tree, simpleExecutor(rolls(100, 115)));

    const children = tree.getNode(root.id).children.map(id => tree.getNode(id));
    expect(children).toHaveLength(2);
    expect(report.branchesAdded).toBe(1);
    expect(children.map(c => c.outcome.probability).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  test('does not create branches when the turn is deterministic in outcome', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 300 }));
    tree.addBranch(root.id, state(), { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));

    B.reconcile(tree, simpleExecutor(rolls(100, 115)));

    const children = tree.getNode(root.id).children.map(id => tree.getNode(id));
    expect(children).toHaveLength(1);
    expect(children[0].isTrivialBranch).toBe(true);
    expect(children[0].outcome.probability).toBeCloseTo(1, 9);
  });

  test('re-running after the situation changes updates the branch set', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 300 }));
    tree.addBranch(root.id, state(), { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));

    // First pass: nothing interesting
    B.reconcile(tree, simpleExecutor(rolls(100, 115)));
    expect(tree.getNode(root.id).children).toHaveLength(1);

    // The opponent turns out to be damaged; the same rolls now decide a KO.
    root.state.p2.active.currentHP = 110;
    root.dist = B.StateDist.of(root.state, 1);

    const report = B.reconcile(tree, simpleExecutor(rolls(100, 115)));
    expect(tree.getNode(root.id).children.length).toBe(2);
    expect(report.branchesAdded).toBe(1);
  });

  test('branches that become impossible are marked rather than silently kept', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 110 }));
    tree.addBranch(root.id, state(), { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));

    B.reconcile(tree, simpleExecutor(rolls(100, 115)));
    expect(tree.getNode(root.id).children).toHaveLength(2);

    // Opponent heals up; the KO branch can no longer occur.
    root.state.p2.active.currentHP = 300;
    root.dist = B.StateDist.of(root.state, 1);
    const report = B.reconcile(tree, simpleExecutor(rolls(100, 115)));

    const children = tree.getNode(root.id).children.map(id => tree.getNode(id));
    const dead = children.filter(c => c.isImpossible);
    expect(dead).toHaveLength(1);
    expect(dead[0].outcome.probability).toBe(0);
    expect(report.deadPaths).toHaveLength(1);
  });

  test('pruneImpossible removes dead branches outright', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state(null, { currentHP: 110 }));
    tree.addBranch(root.id, state(), { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));

    B.reconcile(tree, simpleExecutor(rolls(100, 115)));
    root.state.p2.active.currentHP = 300;
    root.dist = B.StateDist.of(root.state, 1);
    B.reconcile(tree, simpleExecutor(rolls(100, 115)), { pruneImpossible: true });

    expect(tree.getNode(root.id).children).toHaveLength(1);
  });

  test('deep chains stay bounded because states merge', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(state({ maxHP: 400, currentHP: 400 }, { maxHP: 400, currentHP: 400 }));

    let parent = root;
    for (let turn = 0; turn < 5; turn++) {
      parent = tree.addBranch(parent.id, state(), { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
        new BP.BattleOutcome('t' + turn, 1, 0, {}));
    }

    B.reconcile(tree, simpleExecutor(rolls(20, 35)));

    // Five chained 16-roll turns would be 16^5 = 1,048,576 raw paths.
    // Merging by structural key keeps it to the number of reachable HP values.
    const leaves = tree.getLeafNodes();
    leaves.forEach(leaf => {
      expect(leaf.dist.entries.length).toBeLessThanOrEqual(401);
    });
    expect(Object.keys(tree.nodes).length).toBeLessThan(40);
  });
});

// ---------------------------------------------------------------------------
// StateDist mechanics
// ---------------------------------------------------------------------------
describe('StateDist', () => {
  test('identical states merge and keep total probability', () => {
    const s = state();
    const dist = new B.StateDist([
      { state: s.clone(), probability: 0.5 },
      { state: s.clone(), probability: 0.5 }
    ]).merge();

    expect(dist.entries).toHaveLength(1);
    expect(dist.totalProbability()).toBeCloseTo(1, 9);
  });

  test('states differing only in an unobservable field still merge', () => {
    const a = state();
    const b = state();
    b.turnNumber = 7; // not part of the structural key
    const dist = new B.StateDist([
      { state: a, probability: 0.5 },
      { state: b, probability: 0.5 }
    ]).merge();

    expect(dist.entries).toHaveLength(1);
  });

  test('states differing in HP do not merge', () => {
    const a = state();
    const b = state(null, { currentHP: 299 });
    const dist = new B.StateDist([
      { state: a, probability: 0.5 },
      { state: b, probability: 0.5 }
    ]).merge();

    expect(dist.entries).toHaveLength(2);
  });

  test('spread reports distinct values with probabilities', () => {
    const dist = runMove(state(), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 103),
      critChance: 0
    });
    const spread = dist.spread(s => s.p2.active.currentHP);

    expect(spread).toHaveLength(4);
    expect(spread.reduce((a, e) => a + e.probability, 0)).toBeCloseTo(1, 9);
  });

  test('summarizeDist reports faint chance and expected HP', () => {
    const dist = runMove(state(null, { currentHP: 110 }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(100, 115),
      critChance: 0
    });
    const summary = B.summarizeDist(dist);

    expect(summary.p2FaintChance).toBeCloseTo(6 / 16, 9);
    expect(summary.expectedP2HP).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Branch budget
// ---------------------------------------------------------------------------
describe('branch budget', () => {
  test('coalesceBranches keeps the total probability and merges the tail', () => {
    const dist = runMove(state(null, { currentHP: 110, item: 'Sitrus Berry' }), {
      side: 'p1', targetSide: 'p2',
      damageRolls: rolls(40, 120),
      critChance: 1 / 24,
      critDamageRolls: rolls(60, 180)
    });

    const all = B.detectBranches(dist);
    const limited = B.coalesceBranches(all, 3);

    expect(limited.length).toBeLessThanOrEqual(3);
    expect(limited.reduce((a, b) => a + b.probability, 0))
      .toBeCloseTo(all.reduce((a, b) => a + b.probability, 0), 9);

    const merged = limited.find(b => b.coalesced);
    if (merged) {
      // A coalesced branch still carries every underlying state, so a later
      // turn can split it again.
      expect(merged.dist.entries.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real calc engine driving the branching engine
// ---------------------------------------------------------------------------
describe('createTurnExecutor with the real engine', () => {
  const fsx = require('fs');
  const pathx = require('path');
  const realCalc = require(pathx.resolve(__dirname, '../../../calc/dist/index.js'));

  let CI, Logic, executor;

  beforeAll(() => {
    window.calc = realCalc;
    const load = rel => {
      const code = fsx.readFileSync(pathx.join(SRC, rel), 'utf8');
      const indirectEval = eval;
      indirectEval(code);
    };
    window.exports = window.exports || {};
    load('data/rbdex/moves.js');
    window.BattleMovedex = window.exports.BattleMovedex;
    load('data/move_db.js');
    window.MoveDB.init();
    load('calc_integration.js');
    CI = window.BattlePlanner.CalcIntegration;
    load('battle_planner_logic.js');
    Logic = window.BattlePlannerLogic;

    executor = B.createTurnExecutor({
      calc: realCalc,
      CalcIntegration: CI,
      MoveDB: window.MoveDB,
      Logic: Logic,
      gen: 8
    });
  });

  function realState(p1Over, p2Over) {
    const g = realCalc.Generations.get(8);
    const mk = (species, over) => {
      const p = new realCalc.Pokemon(g, species, { level: 100 });
      const snap = new BP.PokemonSnapshot(p);
      Object.assign(snap, over || {});
      return snap;
    };
    const s = new BP.BattleStateSnapshot();
    s.p1.active = mk('Blaziken', p1Over);
    s.p1.team = [s.p1.active.clone()];
    s.p2.active = mk('Swampert', p2Over);
    s.p2.team = [s.p2.active.clone()];
    return s;
  }

  test('a certain-outcome turn yields a single branch', () => {
    // Earthquake: 100% accurate, no secondary, no self-effect, and it neither
    // KOs a healthy Swampert nor crosses any threshold, so all 16 rolls and the
    // crit rolls collapse into one branch.
    const state = realState({}, {});
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Earthquake' },
      p2: null
    });

    const dist = new B.StateDist(produced).merge();
    expect(dist.totalProbability()).toBeCloseTo(1, 6);
    expect(B.detectBranches(dist)).toHaveLength(1);
    // The rolls are still all there, just not split into separate branches
    expect(dist.entries.length).toBeGreaterThan(1);
  });

  test('guaranteed self-drops are applied without branching', () => {
    // Close Combat always lowers the user's Def and SpD: deterministic, so it
    // must change the state but must NOT create a branch.
    const state = realState({}, {});
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Close Combat' },
      p2: null
    });

    const dist = new B.StateDist(produced).merge();
    dist.entries.forEach(e => {
      expect(e.state.p1.active.boosts.def).toBe(-1);
      expect(e.state.p1.active.boosts.spd).toBe(-1);
    });
    expect(B.detectBranches(dist)).toHaveLength(1);
  });

  test('a move with a secondary effect branches on that effect', () => {
    // Thunder Punch has a 10% paralysis chance in RnB. The target must not be
    // the default Swampert — Water/Ground is immune to Electric, and an immune
    // move now correctly does nothing at all.
    const state = realState({}, {});
    const g = realCalc.Generations.get(8);
    const blissey = new BP.PokemonSnapshot(new realCalc.Pokemon(g, 'Blissey', { level: 100 }));
    blissey.refreshPP();
    state.p2.active = blissey;
    state.p2.team = [blissey.clone()];
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Thunder Punch' },
      p2: null
    });

    const dist = new B.StateDist(produced).merge();
    const paralysed = dist.entries
      .filter(e => e.state.p2.active.status === 'Paralyzed')
      .reduce((a, e) => a + e.probability, 0);

    expect(paralysed).toBeGreaterThan(0.05);
    expect(paralysed).toBeLessThan(0.15);
  });

  test('an inaccurate move produces a miss branch with the right weight', () => {
    const state = realState({}, {});
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Focus Blast' },  // 80% in RnB
      p2: null
    });

    const dist = new B.StateDist(produced).merge();
    const undamaged = dist.entries
      .filter(e => e.state.p2.active.currentHP === e.state.p2.active.maxHP)
      .reduce((a, e) => a + e.probability, 0);

    expect(undamaged).toBeCloseTo(0.2, 2);
  });

  test('multi-hit damage is applied as a total', () => {
    const state = realState({}, {});
    const single = executor(state, { p1: { type: 'move', moveName: 'Ice Punch' }, p2: null });
    const multi = executor(state, { p1: { type: 'move', moveName: 'Icicle Spear' }, p2: null });

    const hpOf = produced => {
      const d = new B.StateDist(produced).merge();
      return d.expected(s => s.p2.active.currentHP);
    };

    // 5 x 25 BP Ice beats a single 75 BP Ice punch against the same target
    expect(hpOf(multi)).toBeLessThan(hpOf(single));
  });

  test('reconcile drives a real multi-turn tree and keeps probabilities sane', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(realState({}, {}));

    let parent = root;
    for (let i = 0; i < 3; i++) {
      parent = tree.addBranch(
        parent.id, realState({}, {}),
        { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
        new BP.BattleOutcome('turn ' + i, 1, 0, {})
      );
    }

    const report = B.reconcile(tree, executor, { maxBranchesPerNode: 4 });

    expect(report.nodesVisited).toBeGreaterThan(0);
    tree.getAllRoots().forEach(r => {
      const children = (r.children || []).map(id => tree.getNode(id));
      if (children.length) {
        const total = children.reduce((a, c) => a + c.outcome.probability, 0);
        expect(total).toBeCloseTo(1, 6);
      }
    });
  });

  test('turnOrder respects priority then speed then Trick Room', () => {
    const fast = realState({}, {});
    fast.p1.active.stats.spe = 300;
    fast.p2.active.stats.spe = 100;

    expect(B.turnOrder(fast, { p1: { type: 'move' }, p2: { type: 'move' } })[0]).toBe('p1');

    fast.field.trickRoom = true;
    expect(B.turnOrder(fast, { p1: { type: 'move' }, p2: { type: 'move' } })[0]).toBe('p2');

    fast.field.trickRoom = false;
    expect(B.turnOrder(fast, {
      p1: { type: 'move', priority: 0 },
      p2: { type: 'move', priority: 1 }
    })[0]).toBe('p2');
  });
});
