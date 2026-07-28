/**
 * Guarantees the branching engine has to hold up, because the planner is only
 * useful if its numbers can be trusted:
 *
 *   - probabilities are exact and always partition the parent
 *   - every executed move re-derives the whole tree, parents and children
 *   - branches exist only where an outcome genuinely differs
 *   - tied AI moves fork with honest weights
 *   - team building is NOT stored in the branch tree
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

  executor = B.createTurnExecutor({
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, Logic: Logic, gen: 8
  });
});

const gen = () => realCalc.Generations.get(8);

function mon(species, over) {
  const p = new realCalc.Pokemon(gen(), species, { level: 100 });
  const snap = new BP.PokemonSnapshot(p);
  Object.assign(snap, over || {});
  snap.refreshPP();
  return snap;
}

function stateWithTeams(p1Team, p2Team) {
  const s = new BP.BattleStateSnapshot();
  s.p1.active = p1Team[0].clone();
  s.p1.team = p1Team.map(p => p.clone());
  s.p1.teamSlot = 0;
  s.p2.active = p2Team[0].clone();
  s.p2.team = p2Team.map(p => p.clone());
  s.p2.teamSlot = 0;
  return s;
}

function buildTree(depth, actions, p1Team, p2Team) {
  const tree = new BP.BattleTree();
  const root = tree.initialize(stateWithTeams(
    p1Team || [mon('Blaziken')],
    p2Team || [mon('Swampert')]
  ));
  let parent = root;
  for (let i = 0; i < depth; i++) {
    parent = tree.addBranch(parent.id, parent.state.clone(), actions,
      new BP.BattleOutcome('pending', 1, 0, {}));
  }
  return tree;
}

// ---------------------------------------------------------------------------
describe('probability invariants', () => {
  test('a freshly reconciled tree is valid', () => {
    const tree = buildTree(3, { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null });
    const report = B.reconcile(tree, executor);

    expect(report.validation.valid).toBe(true);
    expect(report.validation.violations).toEqual([]);
  });

  test("every node's children partition it exactly", () => {
    const tree = buildTree(3, {
      p1: { type: 'move', moveName: 'Thunder Punch' },
      p2: { type: 'move', moveName: 'Earthquake' }
    });
    B.reconcile(tree, executor);

    Object.keys(tree.nodes).forEach(id => {
      const node = tree.nodes[id];
      const children = (node.children || []).map(c => tree.getNode(c)).filter(Boolean);
      if (!children.length) return;
      const sum = children.reduce((a, c) => a + c.outcome.probability, 0);
      expect(sum).toBeCloseTo(1, 9);
    });
  });

  test('leaf probabilities across the whole tree sum to 1', () => {
    const tree = buildTree(3, {
      p1: { type: 'move', moveName: 'Thunder Punch' },
      p2: { type: 'move', moveName: 'Earthquake' }
    });
    B.reconcile(tree, executor);

    const leafMass = tree.getLeafNodes()
      .reduce((a, leaf) => a + tree.getCumulativeProbability(leaf.id), 0);
    expect(leafMass).toBeCloseTo(1, 6);
  });

  test('validateTree catches a hand-corrupted probability', () => {
    const tree = buildTree(2, { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null });
    B.reconcile(tree, executor);

    const root = tree.getRootNode();
    const child = tree.getNode(root.children[0]);
    child.outcome.probability = 0.42;          // deliberately wrong

    const result = B.validateTree(tree);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.kind === 'childrenDoNotSumToOne')).toBe(true);
  });

  test('branch weights match the underlying roll probabilities', () => {
    // Swampert at 110 HP vs a damage spread that straddles lethal: the KO branch
    // must weigh exactly the fraction of rolls that reach 110.
    const atk = new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } });
    const def = new realCalc.Pokemon(gen(), 'Swampert', { level: 100 });
    const result = realCalc.calculate(gen(), atk, def, new realCalc.Move(gen(), 'Close Combat'));
    const rolls = CI.getDamageRolls(result);

    const target = 200;
    const expectedKO = rolls.filter(r => r.damage >= target)
      .reduce((a, r) => a + r.probability, 0);

    const attackerSnap = new BP.PokemonSnapshot(
      new realCalc.Pokemon(gen(), 'Blaziken', { level: 100, evs: { atk: 252 } }));
    attackerSnap.refreshPP();
    const state = stateWithTeams([attackerSnap], [mon('Swampert', { currentHP: target })]);
    const produced = executor(state, { p1: { type: 'move', moveName: 'Close Combat' }, p2: null });
    const dist = new B.StateDist(produced).merge();

    const koMass = dist.entries
      .filter(e => e.state.p2.active.currentHP <= 0)
      .reduce((a, e) => a + e.probability, 0);

    // Accuracy is 100 for Close Combat, so the KO share is purely the roll share
    expect(koMass).toBeCloseTo(expectedKO, 6);
  });
});

// ---------------------------------------------------------------------------
describe('re-derivation on every move', () => {
  test('reconcile recomputes parents as well as children', () => {
    const tree = buildTree(2, { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null });
    B.reconcile(tree, executor);

    // Corrupt every DERIVED node. The root is the authoritative starting
    // position (changing it is an input change, covered by the next test);
    // everything downstream of it must be rebuilt from scratch.
    const rootId = tree.getRootNode().id;
    Object.keys(tree.nodes).forEach(id => {
      if (id === rootId) return;
      const s = tree.nodes[id].state;
      if (s && s.p2.active) s.p2.active.currentHP = 12345;
    });

    B.reconcile(tree, executor);

    Object.keys(tree.nodes).forEach(id => {
      if (id === rootId) return;
      const s = tree.nodes[id].state;
      if (s && s.p2.active) expect(s.p2.active.currentHP).not.toBe(12345);
    });
  });

  test('a change at the root propagates to every descendant', () => {
    const tree = buildTree(2, { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null });
    B.reconcile(tree, executor);
    const before = tree.getLeafNodes()[0].state.p2.active.currentHP;

    // The opponent turns out to be badly damaged already
    const root = tree.getRootNode();
    root.state.p2.active.currentHP = 60;
    root.dist = B.StateDist.of(root.state, 1);
    B.reconcile(tree, executor);

    const after = tree.getLeafNodes()[0].state.p2.active.currentHP;
    expect(after).not.toBe(before);
  });

  test('reconciling twice with nothing changed is stable', () => {
    const tree = buildTree(3, {
      p1: { type: 'move', moveName: 'Thunder Punch' },
      p2: { type: 'move', moveName: 'Earthquake' }
    });
    B.reconcile(tree, executor);
    const shape = Object.keys(tree.nodes).length;

    const second = B.reconcile(tree, executor);
    expect(Object.keys(tree.nodes).length).toBe(shape);
    expect(second.branchesAdded).toBe(0);
    expect(second.validation.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('no branches that change nothing', () => {
  test('a turn with a single possible story yields one child', () => {
    const tree = buildTree(1, { p1: { type: 'move', moveName: 'Earthquake' }, p2: null });
    B.reconcile(tree, executor);

    const root = tree.getRootNode();
    expect(root.children).toHaveLength(1);
    expect(tree.getNode(root.children[0]).isTrivialBranch).toBe(true);
    expect(tree.getNode(root.children[0]).outcome.probability).toBeCloseTo(1, 9);
  });

  test('branch count equals the number of genuinely distinct stories', () => {
    // Thunder Punch: 10% paralysis is the only qualitative fork against a
    // healthy target that cannot be KOd in one hit.
    const state = stateWithTeams([mon('Blaziken')], [mon('Blissey')]);
    const produced = executor(state, {
      p1: { type: 'move', moveName: 'Thunder Punch' }, p2: null
    });
    const branches = B.detectBranches(new B.StateDist(produced).merge());

    expect(branches).toHaveLength(2);
    expect(branches.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1, 9);
  });
});

// ---------------------------------------------------------------------------
describe('tied AI moves fork honestly', () => {
  test('two equally likely AI moves become two 50% branches', () => {
    const state = stateWithTeams([mon('Blissey')], [mon('Blissey')]);
    const produced = executor(state, {
      p1: null,
      p2: {
        type: 'move',
        candidates: [
          { moveName: 'Tackle', probability: 0.5 },
          { moveName: 'Ice Beam', probability: 0.5 }
        ]
      }
    });

    const dist = new B.StateDist(produced).merge();
    expect(dist.totalProbability()).toBeCloseTo(1, 6);

    const usedTackle = dist.entries
      .filter(e => (e.state.turnEvents || []).some(x => /used Tackle/.test(x)))
      .reduce((a, e) => a + e.probability, 0);
    expect(usedTackle).toBeCloseTo(0.5, 6);
  });

  test('unequal AI weights are respected exactly', () => {
    const state = stateWithTeams([mon('Blissey')], [mon('Blissey')]);
    const produced = executor(state, {
      p1: null,
      p2: {
        type: 'move',
        candidates: [
          { moveName: 'Tackle', probability: 0.7 },
          { moveName: 'Ice Beam', probability: 0.3 }
        ]
      }
    });

    const dist = new B.StateDist(produced).merge();
    const iceBeam = dist.entries
      .filter(e => (e.state.turnEvents || []).some(x => /used Ice Beam/.test(x)))
      .reduce((a, e) => a + e.probability, 0);

    expect(iceBeam).toBeCloseTo(0.3, 6);
    expect(dist.totalProbability()).toBeCloseTo(1, 6);
  });

  test('a single candidate does not fork', () => {
    const state = stateWithTeams([mon('Blissey')], [mon('Blissey')]);
    const produced = executor(state, {
      p1: null,
      p2: { type: 'move', moveName: 'Tackle', candidates: [{ moveName: 'Tackle', probability: 1 }] }
    });
    expect(new B.StateDist(produced).merge().entries
      .some(e => (e.state.turnEvents || []).some(x => /aiChoice/.test(x)))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('team building is independent of the branch tree', () => {
  function threeMonTeam() {
    return [mon('Blaziken'), mon('Swampert'), mon('Blissey')];
  }

  test('only the lead counts as used before any turn is planned', () => {
    const tree = new BP.BattleTree();
    tree.initialize(stateWithTeams(threeMonTeam(), [mon('Snorlax')]));

    // Nothing has happened yet: an untouched lead is not committed
    expect(B.getUsedPokemon(tree, 'p1')).toEqual([]);
    expect(B.canEditRosterSlot(tree, 'p1', 'Swampert')).toBe(true);
    expect(B.canEditRosterSlot(tree, 'p1', 'Blaziken')).toBe(true);
  });

  test('a Pokemon that has taken damage is committed', () => {
    const tree = buildTree(1, { p1: null, p2: { type: 'move', moveName: 'Earthquake' } },
      threeMonTeam(), [mon('Snorlax')]);
    B.reconcile(tree, executor);

    expect(B.getUsedPokemon(tree, 'p1')).toContain('Blaziken');
    expect(B.canEditRosterSlot(tree, 'p1', 'Blaziken')).toBe(false);
    // The bench is still free to change
    expect(B.canEditRosterSlot(tree, 'p1', 'Blissey')).toBe(true);
  });

  test('swapping an unused Pokemon keeps the tree and its probabilities intact', () => {
    const tree = buildTree(2, { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      threeMonTeam(), [mon('Snorlax')]);
    B.reconcile(tree, executor);

    const nodesBefore = Object.keys(tree.nodes).length;
    const leafMassBefore = tree.getLeafNodes()
      .reduce((a, l) => a + tree.getCumulativeProbability(l.id), 0);

    const newRoster = [mon('Blaziken'), mon('Swampert'), mon('Garchomp')];
    const result = B.updateRoster(tree, 'p1', newRoster, executor);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toContain('Garchomp');
    expect(Object.keys(tree.nodes).length).toBe(nodesBefore);
    expect(tree.getLeafNodes().reduce((a, l) => a + tree.getCumulativeProbability(l.id), 0))
      .toBeCloseTo(leafMassBefore, 6);
    expect(result.reconcile.validation.valid).toBe(true);
  });

  test('the swap actually lands in every node of the tree', () => {
    const tree = buildTree(2, { p1: { type: 'move', moveName: 'Flare Blitz' }, p2: null },
      threeMonTeam(), [mon('Snorlax')]);
    B.reconcile(tree, executor);
    B.updateRoster(tree, 'p1', [mon('Blaziken'), mon('Swampert'), mon('Garchomp')], executor);

    Object.keys(tree.nodes).forEach(id => {
      const team = tree.nodes[id].state.p1.team.map(p => p.name);
      expect(team).toContain('Garchomp');
      expect(team).not.toContain('Blissey');
    });
  });

  test('removing a Pokemon that is already in play is refused', () => {
    const tree = buildTree(1, { p1: null, p2: { type: 'move', moveName: 'Earthquake' } },
      threeMonTeam(), [mon('Snorlax')]);
    B.reconcile(tree, executor);

    const result = B.updateRoster(tree, 'p1', [mon('Blissey'), mon('Garchomp')], executor);

    expect(result.applied).toEqual([]);
    expect(result.rejected.some(r => r.name === 'Blaziken')).toBe(true);
    // The tree is untouched by a refused edit
    expect(tree.getRootNode().state.p1.team.map(p => p.name)).toContain('Blaziken');
  });

  test('a committed Pokemon keeps its battle state through a roster edit', () => {
    const tree = buildTree(1, { p1: null, p2: { type: 'move', moveName: 'Earthquake' } },
      threeMonTeam(), [mon('Snorlax')]);
    B.reconcile(tree, executor);

    const leaf = tree.getLeafNodes()[0];
    const damagedHP = leaf.state.p1.active.currentHP;
    expect(damagedHP).toBeLessThan(leaf.state.p1.active.maxHP);

    B.updateRoster(tree, 'p1', [mon('Blaziken'), mon('Swampert'), mon('Garchomp')], executor);

    expect(tree.getLeafNodes()[0].state.p1.active.name).toBe('Blaziken');
    expect(tree.getLeafNodes()[0].state.p1.active.currentHP).toBe(damagedHP);
  });
});

// ---------------------------------------------------------------------------
describe('switches replay faithfully', () => {
  test('a planned switch is deterministic and does not branch', () => {
    const tree = new BP.BattleTree();
    const root = tree.initialize(stateWithTeams(
      [mon('Blaziken'), mon('Swampert')], [mon('Snorlax')]));
    tree.addBranch(root.id, root.state.clone(),
      { p1: { type: 'switch', switchToIndex: 1 }, p2: null },
      new BP.BattleOutcome('pending', 1, 0, {}));

    B.reconcile(tree, executor);

    const child = tree.getNode(tree.getRootNode().children[0]);
    expect(tree.getRootNode().children).toHaveLength(1);
    expect(child.state.p1.active.name).toBe('Swampert');
    expect(child.outcome.probability).toBeCloseTo(1, 9);
  });
});
