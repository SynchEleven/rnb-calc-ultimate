/**
 * Mechanics that change WHICH branches exist:
 *   - abilities/items that suppress, add to or reweight secondary effects
 *   - status-curing berries (Lum is on 204 of the 1,626 trainer sets)
 *   - conditions that stop a Pokemon acting: paralysis, confusion, sleep,
 *     freeze, flinch
 *   - bulk-applying one pair of actions across every branch at a level
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

let BP, B, CI, Logic, executor;

beforeAll(() => {
  window.calc = realCalc;
  loadScript('battle_planner.js');
  BP = window.BattlePlanner;
  window.exports = window.exports || {};
  loadScript('data/rbdex/moves.js');
  window.BattleMovedex = window.exports.BattleMovedex;
  loadScript('data/move_db.js');
  window.MoveDB.init();
  loadScript('calc_integration.js');
  CI = window.BattlePlanner.CalcIntegration;
  loadScript('battle_planner_logic.js');
  Logic = window.BattlePlannerLogic;
  loadScript('battle_planner_branching.js');
  B = window.BattlePlannerBranching;

  executor = makeExecutor();
});

function makeExecutor() {
  return B.createTurnExecutor({
    calc: realCalc,
    CalcIntegration: CI,
    MoveDB: window.MoveDB,
    Logic: Logic,
    gen: 8
  });
}

const gen = () => realCalc.Generations.get(8);

function realState(p1Over, p2Over) {
  const mk = (species, over) => {
    const p = new realCalc.Pokemon(gen(), species, { level: 100 });
    const snap = new BP.PokemonSnapshot(p);
    Object.assign(snap, over || {});
    snap.refreshPP();   // production does this after assigning moves
    return snap;
  };
  const s = new BP.BattleStateSnapshot();
  s.p1.active = mk('Blaziken', p1Over);
  s.p1.team = [s.p1.active.clone()];
  s.p2.active = mk('Swampert', p2Over);
  s.p2.team = [s.p2.active.clone()];
  return s;
}

const massWhere = (produced, predicate) =>
  new B.StateDist(produced).merge().entries
    .filter(e => predicate(e.state))
    .reduce((a, e) => a + e.probability, 0);

const paralysedMass = produced =>
  massWhere(produced, s => s.p2.active.status === 'Paralyzed');

// ---------------------------------------------------------------------------
describe('secondary-effect modifiers', () => {
  const punch = { p1: { type: 'move', moveName: 'Thunder Punch' }, p2: null };

  // The default realState opponent is Swampert — Water/Ground, IMMUNE to
  // Electric. The original fixtures punched it and asserted 10% paralysis,
  // which the real game would never do. Electric-secondary tests target
  // Blissey; the Swampert case is pinned below as the immunity test.
  function punchState(p1Over, p2Over) {
    const state = realState(p1Over, {});
    const b = new realCalc.Pokemon(gen(), 'Blissey', { level: 100 });
    const snap = new BP.PokemonSnapshot(b);
    Object.assign(snap, p2Over || {});
    snap.refreshPP();
    state.p2.active = snap;
    state.p2.team = [snap.clone()];
    return state;
  }

  test('baseline Thunder Punch paralyses 10% of the time', () => {
    expect(paralysedMass(executor(punchState({}, {}), punch))).toBeCloseTo(0.1, 6);
  });

  test('an immune target takes no damage AND no secondary', () => {
    // Thunder Punch into Water/Ground Swampert: the move does nothing at all
    const produced = executor(realState({}, {}), punch);
    expect(paralysedMass(produced)).toBe(0);
    expect(massWhere(produced,
      s => s.p2.active.currentHP < s.p2.active.maxHP)).toBe(0);
  });

  test('Sheer Force removes the secondary entirely', () => {
    // The engine already pays +30% base power for having a secondary, so
    // applying the effect as well was double-dipping.
    expect(paralysedMass(executor(punchState({ ability: 'Sheer Force' }, {}), punch))).toBe(0);
  });

  test('Sheer Force still receives the base-power boost', () => {
    // NOT Swampert: it is Water/Ground and immune to Electric, so both
    // ranges would be 0 and the comparison would prove nothing.
    const def = new realCalc.Pokemon(gen(), 'Blissey', { level: 100 });
    const plain = realCalc.calculate(gen(),
      new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, ability: 'Blaze', evs: { atk: 252 } }),
      def, new realCalc.Move(gen(), 'Thunder Punch'));
    const sheer = realCalc.calculate(gen(),
      new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, ability: 'Sheer Force', evs: { atk: 252 } }),
      def, new realCalc.Move(gen(), 'Thunder Punch'));

    expect(sheer.range()[1]).toBeGreaterThan(plain.range()[1]);
    expect(sheer.range()[1] / plain.range()[1]).toBeCloseTo(1.3, 1);
  });

  test('Shield Dust blocks the secondary', () => {
    expect(paralysedMass(executor(punchState({}, { ability: 'Shield Dust' }), punch))).toBe(0);
  });

  test('Covert Cloak blocks the secondary', () => {
    expect(paralysedMass(executor(punchState({}, { item: 'Covert Cloak' }), punch))).toBe(0);
  });

  test('Mold Breaker ignores Shield Dust', () => {
    const produced = executor(
      punchState({ ability: 'Mold Breaker' }, { ability: 'Shield Dust' }), punch);
    expect(paralysedMass(produced)).toBeCloseTo(0.1, 6);
  });

  test('Serene Grace doubles the secondary chance', () => {
    expect(paralysedMass(executor(punchState({ ability: 'Serene Grace' }, {}), punch)))
      .toBeCloseTo(0.2, 6);
  });

  test("King's Rock adds a 10% flinch to a move that has none", () => {
    const produced = executor(realState({ item: "King's Rock" }, {}),
      { p1: { type: 'move', moveName: 'Earthquake' }, p2: null });
    expect(massWhere(produced, s => s.p2.active.hasVolatile('flinch'))).toBeCloseTo(0.1, 6);
  });

  test("King's Rock does not stack onto a move that already flinches", () => {
    const entry = window.MoveDB.get('Rock Slide');
    expect(entry.effects.secondaries.some(s => s.volatileStatus === 'flinch')).toBe(true);

    const produced = executor(realState({ item: "King's Rock" }, {}),
      { p1: { type: 'move', moveName: 'Rock Slide' }, p2: null });
    // 30% from the move itself, not 30% + 10%
    expect(massWhere(produced, s => s.p2.active.hasVolatile('flinch'))).toBeCloseTo(0.3, 6);
  });
});

// ---------------------------------------------------------------------------
describe('status-curing berries', () => {
  function mkMon(over) {
    const p = new BP.PokemonSnapshot(null);
    Object.assign(p, {
      name: 'Test', maxHP: 300, currentHP: 300, status: 'Healthy',
      boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
      volatiles: {}, types: ['Normal'], item: ''
    }, over || {});
    return p;
  }

  test('Cheri Berry cures paralysis the moment it lands', () => {
    const p = mkMon({ item: 'Cheri Berry' });
    expect(p.inflictStatus('par')).toBe(false);
    expect(p.status).toBe('Healthy');
    expect(p.item).toBe('');
  });

  test('Cheri Berry does not cure a burn', () => {
    const p = mkMon({ item: 'Cheri Berry' });
    expect(p.inflictStatus('brn')).toBe(true);
    expect(p.status).toBe('Burned');
    expect(p.item).toBe('Cheri Berry');
  });

  test('each berry cures exactly its own status', () => {
    const table = {
      'Cheri Berry': 'par',
      'Chesto Berry': 'slp',
      'Pecha Berry': 'psn',
      'Rawst Berry': 'brn',
      'Aspear Berry': 'frz'
    };
    Object.keys(table).forEach(berry => {
      const p = mkMon({ item: berry });
      expect(p.inflictStatus(table[berry])).toBe(false);
      expect(p.status).toBe('Healthy');
    });
  });

  test('Pecha Berry also cures Toxic', () => {
    const p = mkMon({ item: 'Pecha Berry' });
    expect(p.inflictStatus('tox')).toBe(false);
    expect(p.status).toBe('Healthy');
  });

  test('Lum Berry cures every non-volatile status', () => {
    ['par', 'slp', 'psn', 'tox', 'brn', 'frz'].forEach(code => {
      const p = mkMon({ item: 'Lum Berry' });
      expect(p.inflictStatus(code)).toBe(false);
      expect(p.status).toBe('Healthy');
      expect(p.item).toBe('');
    });
  });

  test('Lum and Persim cure confusion, Cheri does not', () => {
    expect(mkMon({ item: 'Lum Berry' }).inflictVolatile('confusion')).toBe(false);
    expect(mkMon({ item: 'Persim Berry' }).inflictVolatile('confusion')).toBe(false);

    const cheri = mkMon({ item: 'Cheri Berry' });
    expect(cheri.inflictVolatile('confusion')).toBe(true);
    expect(cheri.hasVolatile('confusion')).toBe(true);
  });

  test('an existing status blocks a second one', () => {
    const p = mkMon({ status: 'Burned' });
    expect(p.inflictStatus('par')).toBe(false);
    expect(p.status).toBe('Burned');
  });

  test('Klutz cannot eat the berry', () => {
    const p = mkMon({ item: 'Lum Berry', ability: 'Klutz' });
    expect(p.inflictStatus('par')).toBe(true);
    expect(p.status).toBe('Paralyzed');
  });

  test('a Lum Berry holder shrugs off a move secondary, so no status branch', () => {
    // Blissey target: Swampert is immune to the punch in the first place
    const state = realState({}, {});
    const b = new realCalc.Pokemon(gen(), 'Blissey', { level: 100 });
    const snap = new BP.PokemonSnapshot(b);
    snap.item = 'Lum Berry';
    snap.refreshPP();
    state.p2.active = snap;
    state.p2.team = [snap.clone()];
    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Thunder Punch' }, p2: null });
    expect(paralysedMass(produced)).toBe(0);

    // The berry is still consumed on the 10% of paths where it triggered
    const ateBerry = massWhere(produced, s => s.p2.active.item === '');
    expect(ateBerry).toBeCloseTo(0.1, 6);
  });

  test('a Flame Orb holder with a Lum Berry ends up healthy', () => {
    const p = realState({ item: 'Flame Orb' }, {}).p1.active;
    p.item = 'Flame Orb';
    const state = realState({}, {});
    state.p1.active.item = 'Flame Orb';
    state.p1.active.moves = [];

    // Give it a Lum Berry instead: the orb burns, the berry cures
    state.p1.active.item = 'Lum Berry';
    state.p1.active.types = ['Normal'];
    state.p1.active.inflictStatus('brn');
    expect(state.p1.active.status).toBe('Healthy');
    expect(state.p1.active.item).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('incapacitation branching', () => {
  const quake = { p1: { type: 'move', moveName: 'Earthquake' }, p2: null };
  const undamaged = s => s.p2.active.currentHP === s.p2.active.maxHP;

  test('paralysis creates a 25% "did not move" branch', () => {
    expect(massWhere(executor(realState({ status: 'Paralyzed' }, {}), quake), undamaged))
      .toBeCloseTo(0.25, 6);
  });

  test('confusion creates a 1/3 self-hit branch and ticks the counter', () => {
    const state = realState({}, {});
    state.p1.active.setVolatile('confusion', true);

    const produced = executor(state, quake);
    expect(massWhere(produced, s => s.p1.active.currentHP < s.p1.active.maxHP))
      .toBeCloseTo(1 / 3, 6);

    // The counter lives inside `volatiles` so it survives clone()
    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(Number(e.state.p1.active.volatiles.confusion)).toBeGreaterThan(1);
    });
  });

  test('confusion clears once its duration runs out', () => {
    const state = realState({}, {});
    state.p1.active.setVolatile('confusion', 4);   // final turn of confusion

    new B.StateDist(executor(state, quake)).merge().entries.forEach(e => {
      expect(e.state.p1.active.hasVolatile('confusion')).toBe(false);
    });
  });

  test('paralysis and confusion compose multiplicatively', () => {
    const state = realState({ status: 'Paralyzed' }, {});
    state.p1.active.setVolatile('confusion', true);

    const produced = executor(state, quake);
    const dist = new B.StateDist(produced).merge();

    expect(dist.totalProbability()).toBeCloseTo(1, 6);
    // Acts only if not fully paralysed (3/4) and not confused into itself (2/3)
    expect(massWhere(produced, s => s.p2.active.currentHP < s.p2.active.maxHP))
      .toBeCloseTo(0.75 * (2 / 3), 6);
  });

  test('freeze gives a 20% thaw branch', () => {
    expect(massWhere(executor(realState({ status: 'Frozen' }, {}), quake),
      s => s.p1.active.status === 'Healthy')).toBeCloseTo(0.2, 6);
  });

  test('a flinched Pokemon does not move and the flinch is consumed', () => {
    const state = realState({}, {});
    state.p1.active.setVolatile('flinch', true);

    new B.StateDist(executor(state, quake)).merge().entries.forEach(e => {
      expect(e.state.p2.active.currentHP).toBe(e.state.p2.active.maxHP);
      expect(e.state.p1.active.hasVolatile('flinch')).toBe(false);
    });
  });

  test('these produce real branches, not silent averaging', () => {
    const state = realState({ status: 'Paralyzed' }, {});
    const branches = B.detectBranches(new B.StateDist(executor(state, quake)).merge());
    expect(branches.length).toBeGreaterThan(1);
    expect(branches.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
describe('bulkApply across a level', () => {
  function rolls(min, max) {
    const out = [];
    const n = max - min + 1;
    for (let d = min; d <= max; d++) out.push({ damage: d, probability: 1 / n });
    return out;
  }

  function simpleExec(range) {
    return st => B.applyTurnToState(st, {
      steps: B.moveSteps(
        { side: 'p1', targetSide: 'p2', damageRolls: range, critChance: 0 },
        (state, spec, amount) => {
          const t = state.p2.active;
          t.applyDamage(amount);
        })
    });
  }

  function treeWithTwoBranches() {
    const tree = new BP.BattleTree();
    const root = tree.initialize(realState({ moves: ['Flare Blitz', 'Close Combat'] },
      { currentHP: 110, moves: ['Earthquake'] }));
    tree.addBranch(root.id, root.state.clone(),
      { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));
    const exec = simpleExec(rolls(100, 115));
    B.reconcile(tree, exec);
    return { tree, exec };
  }

  const deps = () => ({ MoveDB: window.MoveDB, CalcIntegration: CI });

  test('nodesAtDepth finds every sibling at a level', () => {
    const { tree } = treeWithTwoBranches();
    expect(B.nodesAtDepth(tree, 0)).toHaveLength(1);
    expect(B.nodesAtDepth(tree, 1)).toHaveLength(2);  // fainted / survived
  });

  test('warns that the opponent is fainted on one branch', () => {
    const { tree } = treeWithTwoBranches();
    const result = B.validateBulkApply(tree, 1, {
      p1: { type: 'move', moveName: 'Flare Blitz' },
      p2: { type: 'move', moveName: 'Earthquake' }
    }, deps());

    expect(result.nodeCount).toBe(2);
    expect(result.safe).toBe(false);
    expect(result.warnings.some(w => w.kind === 'fainted' && w.side === 'p2')).toBe(true);
  });

  test('warns when the chosen move is not on the active Pokemon', () => {
    const { tree } = treeWithTwoBranches();
    const result = B.validateBulkApply(tree, 1,
      { p1: { type: 'move', moveName: 'Hydro Pump' }, p2: null }, deps());
    expect(result.warnings.some(w => w.kind === 'notOnTeam')).toBe(true);
  });

  test('warns when a move would be redundant', () => {
    const { tree } = treeWithTwoBranches();
    B.nodesAtDepth(tree, 1).forEach(n => {
      n.state.p1.active.moves = ['Swords Dance'];
      n.state.p1.active.boosts.atk = 6;
    });
    const result = B.validateBulkApply(tree, 1,
      { p1: { type: 'move', moveName: 'Swords Dance' }, p2: null }, deps());
    expect(result.warnings.some(w => w.kind === 'alreadyApplied')).toBe(true);
  });

  test('applies to the safe branches and skips the flagged one', () => {
    const { tree, exec } = treeWithTwoBranches();
    const report = B.bulkApply(tree, 1, {
      p1: { type: 'move', moveName: 'Flare Blitz' },
      p2: { type: 'move', moveName: 'Earthquake' }
    }, exec, deps());

    expect(report.bulk.requestedNodes).toBe(2);
    expect(report.bulk.appliedNodes).toBe(1);
    expect(report.bulk.skippedNodes).toHaveLength(1);
    expect(report.bulk.warnings.length).toBeGreaterThan(0);
  });

  test('force applies everywhere regardless of warnings', () => {
    const { tree, exec } = treeWithTwoBranches();
    const report = B.bulkApply(tree, 1, {
      p1: { type: 'move', moveName: 'Flare Blitz' },
      p2: { type: 'move', moveName: 'Earthquake' }
    }, exec, deps(), { force: true });

    expect(report.bulk.appliedNodes).toBe(2);
  });

  test('a genuinely safe bulk apply reports safe with no warnings', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(realState({ moves: ['Flare Blitz'] }, { currentHP: 300 }));
    tree.addBranch(root.id, root.state.clone(),
      { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      new BP.BattleOutcome('placeholder', 1, 0, {}));
    B.reconcile(tree, simpleExec(rolls(10, 12)));

    const result = B.validateBulkApply(tree, 1,
      { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null }, deps());

    expect(result.safe).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('turn order and survival rolls', () => {
  test('move priority is read from RBDex when the caller omits it', () => {
    const state = realState({}, {});
    state.p1.active.stats.spe = 50;    // much slower
    state.p2.active.stats.spe = 300;

    // Quick Attack is +1, so p1 still moves first despite the Speed gap
    const order = B.turnOrder(state, {
      p1: Object.assign({}, { type: 'move', moveName: 'Quick Attack' },
        { priority: window.MoveDB.get('Quick Attack').priority }),
      p2: { type: 'move', moveName: 'Earthquake', priority: 0 }
    });
    expect(order[0]).toBe('p1');
    expect(window.MoveDB.get('Quick Attack').priority).toBe(1);
  });

  test('the executor derives priority itself, so Quick Attack goes first', () => {
    const state = realState({}, {});
    state.p1.active.stats.spe = 50;
    state.p2.active.stats.spe = 300;
    state.p2.active.currentHP = 1;     // p2 dies to anything if p1 moves first

    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Quick Attack' },
      p2: { type: 'move', moveName: 'Earthquake' }
    });

    // p1 moved first and KOd, so p2 never got its Earthquake off
    expect(massWhere(produced, s => s.p2.active.currentHP <= 0)).toBeCloseTo(1, 6);
    expect(massWhere(produced, s => s.p1.active.currentHP === s.p1.active.maxHP))
      .toBeCloseTo(1, 6);
  });

  test('a speed tie that changes nothing does NOT fork', () => {
    // Two bulky Pokemon trading a weak move: neither faints, no thresholds are
    // crossed, so whoever moves first the turn ends in the same distribution.
    // Forking here would add a branch that means nothing.
    const mk = species => {
      const p = new realCalc.Pokemon(gen(), species, { level: 100 });
      const snap = new BP.PokemonSnapshot(p);
      snap.stats.spe = 200;
      snap.refreshPP();
      return snap;
    };
    const state = new BP.BattleStateSnapshot();
    state.p1.active = mk('Blissey');
    state.p1.team = [state.p1.active.clone()];
    state.p2.active = mk('Blissey');
    state.p2.team = [state.p2.active.clone()];

    const actions = {
      p1: { type: 'move', moveName: 'Tackle', priority: 0 },
      p2: { type: 'move', moveName: 'Tackle', priority: 0 }
    };
    expect(B.isSpeedTie(state, actions)).toBe(true);

    const produced = executor(state, actions);
    const dist = new B.StateDist(produced).merge();
    expect(dist.totalProbability()).toBeCloseTo(1, 6);

    // No speed-tie commentary and no non-trivial branch
    expect(massWhere(produced,
      s => (s.turnEvents || []).some(e => /speed tie/.test(e)))).toBe(0);
    expect(B.detectBranches(dist).filter(b => !b.trivial)).toHaveLength(0);
  });

  test('a speed tie DOES fork when going second means dying first', () => {
    // Swampert's Earthquake KOs Blaziken, so who moves first decides whether
    // Blaziken ever gets its attack off — a real difference, so a real branch.
    const state = realState({}, {});
    state.p1.active.stats.spe = 200;
    state.p2.active.stats.spe = 200;

    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Earthquake', priority: 0 },
      p2: { type: 'move', moveName: 'Earthquake', priority: 0 }
    });

    expect(massWhere(produced,
      s => (s.turnEvents || []).some(e => /you won the speed tie/.test(e)))).toBeCloseTo(0.5, 6);
    expect(new B.StateDist(produced).merge().totalProbability()).toBeCloseTo(1, 6);
  });

  test('a speed tie that decides who faints DOES fork 50/50', () => {
    const state = realState({ currentHP: 1 }, { currentHP: 1 });
    state.p1.active.stats.spe = 200;
    state.p2.active.stats.spe = 200;

    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Earthquake', priority: 0 },
      p2: { type: 'move', moveName: 'Earthquake', priority: 0 }
    });

    const p1Won = massWhere(produced,
      s => (s.turnEvents || []).some(e => /you won the speed tie/.test(e)));
    expect(p1Won).toBeCloseTo(0.5, 6);
    expect(new B.StateDist(produced).merge().totalProbability()).toBeCloseTo(1, 6);
  });

  test('a speed tie that decides a KO produces two real branches', () => {
    const state = realState({ currentHP: 1 }, { currentHP: 1 });
    state.p1.active.stats.spe = 200;
    state.p2.active.stats.spe = 200;

    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Earthquake' },
      p2: { type: 'move', moveName: 'Earthquake' }
    });
    const branches = B.detectBranches(new B.StateDist(produced).merge());

    expect(branches.length).toBeGreaterThan(1);
    expect(branches.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1, 6);
  });

  test('no speed tie when Speeds differ', () => {
    const state = realState({}, {});
    state.p1.active.stats.spe = 201;
    state.p2.active.stats.spe = 200;
    expect(B.isSpeedTie(state, {
      p1: { type: 'move', priority: 0 }, p2: { type: 'move', priority: 0 }
    })).toBe(false);
  });

  test('Focus Band forks into a 10% survival branch', () => {
    const state = realState({}, { currentHP: 1, item: 'Focus Band' });
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Earthquake' }, p2: null
    });

    const survived = massWhere(produced, s => s.p2.active.currentHP > 0);
    expect(survived).toBeCloseTo(0.1, 6);

    const branches = B.detectBranches(new B.StateDist(produced).merge());
    expect(branches.some(b => b.answers.p2Fainted === false)).toBe(true);
    expect(branches.some(b => b.answers.p2Fainted === true)).toBe(true);
  });

  test('Focus Sash is certain, so it does NOT fork', () => {
    const state = realState({}, { item: 'Focus Sash' });
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Earthquake' }, p2: null
    });
    // Swampert at full HP with a Sash always survives Earthquake at 1 HP or more
    expect(massWhere(produced, s => s.p2.active.currentHP > 0)).toBeCloseTo(1, 6);
  });
});
