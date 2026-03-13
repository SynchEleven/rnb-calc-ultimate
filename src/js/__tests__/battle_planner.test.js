/**
 * Tests for battle_planner.js - Core Data Model
 *
 * Covers: PokemonSnapshot, BattleStateSnapshot, BattleTree, BattleNode,
 *         BattleAction, BattleOutcome, getEffectiveSpeed, speed comparison.
 */
const { setupBattlePlanner, makePokemon, makeState } = require('./setup');

let BP;

beforeAll(() => {
  BP = setupBattlePlanner();
});

// ---------------------------------------------------------------------------
// PokemonSnapshot
// ---------------------------------------------------------------------------
describe('PokemonSnapshot', () => {
  describe('construction', () => {
    test('creates an empty snapshot when passed null', () => {
      const p = new BP.PokemonSnapshot(null);
      expect(p.name).toBe('');
      expect(p.maxHP).toBe(0);
      expect(p.currentHP).toBe(0);
      expect(p.status).toBe('Healthy');
      expect(p.boosts.atk).toBe(0);
      expect(p.moves).toEqual([]);
      expect(p.types).toEqual([]);
      expect(p.hasFainted).toBe(false);
    });

    test('creates a snapshot from a calc-like pokemon object', () => {
      const calcPokemon = {
        name: 'Sceptile',
        species: { name: 'Sceptile', types: ['Grass'], baseStats: { hp: 70 } },
        level: 50,
        rawStats: { hp: 145, atk: 105, def: 85, spa: 125, spd: 105, spe: 140 },
        status: 'par',
        boosts: { spe: -1 },
        ability: 'Overgrow',
        item: 'Life Orb',
        nature: 'Timid',
        moves: ['Leaf Storm', 'Dragon Pulse', 'Focus Blast', 'Hidden Power'],
        evs: { spa: 252, spe: 252 },
        ivs: { hp: 31, atk: 30, def: 30 },
      };
      const p = new BP.PokemonSnapshot(calcPokemon);
      expect(p.name).toBe('Sceptile');
      expect(p.level).toBe(50);
      expect(p.maxHP).toBe(145);
      expect(p.status).toBe('Paralyzed');
      expect(p.ability).toBe('Overgrow');
      expect(p.item).toBe('Life Orb');
      expect(p.types).toEqual(['Grass']);
      expect(p.boosts.spe).toBe(-1);
      expect(p.moves).toContain('Leaf Storm');
      expect(p.evs.spa).toBe(252);
    });
  });

  describe('clone', () => {
    test('produces a deep copy', () => {
      const original = makePokemon({ name: 'Gardevoir', currentHP: 200, maxHP: 300 });
      const clone = original.clone();

      expect(clone.name).toBe('Gardevoir');
      expect(clone.currentHP).toBe(200);

      clone.currentHP = 0;
      clone.boosts.spa = 2;
      clone.moves.push('Moonblast');

      expect(original.currentHP).toBe(200);
      expect(original.boosts.spa).toBe(0);
      expect(original.moves).not.toContain('Moonblast');
    });
  });

  describe('applyDamage', () => {
    test('reduces HP and updates percent and faint flag', () => {
      const p = makePokemon({ currentHP: 300, maxHP: 300 });
      p.applyDamage(120);
      expect(p.currentHP).toBe(180);
      expect(p.percentHP).toBe(60);
      expect(p.hasFainted).toBe(false);
    });

    test('clamps HP at 0 and marks fainted', () => {
      const p = makePokemon({ currentHP: 50, maxHP: 300 });
      p.applyDamage(100);
      expect(p.currentHP).toBe(0);
      expect(p.hasFainted).toBe(true);
    });

    test('floors damage before subtracting', () => {
      const p = makePokemon({ currentHP: 100, maxHP: 300 });
      p.applyDamage(33.7);
      expect(p.currentHP).toBe(67);
    });
  });

  describe('applyHealing', () => {
    test('increases HP up to maxHP', () => {
      const p = makePokemon({ currentHP: 100, maxHP: 300 });
      p.applyHealing(50);
      expect(p.currentHP).toBe(150);
    });

    test('does not exceed maxHP', () => {
      const p = makePokemon({ currentHP: 280, maxHP: 300 });
      p.applyHealing(100);
      expect(p.currentHP).toBe(300);
      expect(p.percentHP).toBe(100);
    });
  });

  describe('applyBoost', () => {
    test('applies positive boosts', () => {
      const p = makePokemon();
      p.applyBoost('atk', 2);
      expect(p.boosts.atk).toBe(2);
    });

    test('stacks boosts', () => {
      const p = makePokemon();
      p.applyBoost('spe', 1);
      p.applyBoost('spe', 2);
      expect(p.boosts.spe).toBe(3);
    });

    test('clamps at +6', () => {
      const p = makePokemon();
      p.applyBoost('spa', 4);
      p.applyBoost('spa', 4);
      expect(p.boosts.spa).toBe(6);
    });

    test('clamps at -6', () => {
      const p = makePokemon();
      p.applyBoost('def', -4);
      p.applyBoost('def', -4);
      expect(p.boosts.def).toBe(-6);
    });

    test('ignores unknown stats gracefully', () => {
      const p = makePokemon();
      p.applyBoost('magic', 3);
      expect(p.boosts.magic).toBeUndefined();
    });
  });

  describe('setStatus', () => {
    test('sets a status condition', () => {
      const p = makePokemon();
      p.setStatus('Paralyzed');
      expect(p.status).toBe('Paralyzed');
      expect(p.toxicCounter).toBe(0);
    });

    test('initialises toxic counter for Badly Poisoned', () => {
      const p = makePokemon();
      p.setStatus('Badly Poisoned');
      expect(p.status).toBe('Badly Poisoned');
      expect(p.toxicCounter).toBe(1);
    });

    test('resets toxic counter when cured', () => {
      const p = makePokemon();
      p.setStatus('Badly Poisoned', 5);
      expect(p.toxicCounter).toBe(5);
      p.setStatus('Healthy');
      expect(p.toxicCounter).toBe(0);
    });
  });

  describe('usePP', () => {
    test('decrements PP for a move slot', () => {
      const p = makePokemon({ pp: [15, 10, 5, 20] });
      p.usePP(1);
      expect(p.pp[1]).toBe(9);
    });

    test('does not go below 0', () => {
      const p = makePokemon({ pp: [0, 10, 5, 20] });
      p.usePP(0);
      expect(p.pp[0]).toBe(0);
    });
  });

  describe('status code/name conversion', () => {
    test('converts all status codes to names', () => {
      const p = new BP.PokemonSnapshot(null);
      expect(p._statusCodeToName('par')).toBe('Paralyzed');
      expect(p._statusCodeToName('psn')).toBe('Poisoned');
      expect(p._statusCodeToName('tox')).toBe('Badly Poisoned');
      expect(p._statusCodeToName('brn')).toBe('Burned');
      expect(p._statusCodeToName('slp')).toBe('Asleep');
      expect(p._statusCodeToName('frz')).toBe('Frozen');
      expect(p._statusCodeToName('')).toBe('Healthy');
    });

    test('converts all status names to codes', () => {
      const p = new BP.PokemonSnapshot(null);
      expect(p._statusNameToCode('Paralyzed')).toBe('par');
      expect(p._statusNameToCode('Poisoned')).toBe('psn');
      expect(p._statusNameToCode('Badly Poisoned')).toBe('tox');
      expect(p._statusNameToCode('Burned')).toBe('brn');
      expect(p._statusNameToCode('Asleep')).toBe('slp');
      expect(p._statusNameToCode('Frozen')).toBe('frz');
      expect(p._statusNameToCode('Healthy')).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// getEffectiveSpeed
// ---------------------------------------------------------------------------
describe('getEffectiveSpeed', () => {
  test('returns base speed with no modifiers', () => {
    const p = makePokemon({ stats: { spe: 200 } });
    expect(p.getEffectiveSpeed({})).toBe(200);
  });

  test('+1 speed boost = 1.5x', () => {
    const p = makePokemon({ stats: { spe: 200 }, boosts: { spe: 1 } });
    expect(p.getEffectiveSpeed({})).toBe(300);
  });

  test('+2 speed boost = 2x', () => {
    const p = makePokemon({ stats: { spe: 200 }, boosts: { spe: 2 } });
    expect(p.getEffectiveSpeed({})).toBe(400);
  });

  test('-1 speed = 2/3x (floored)', () => {
    const p = makePokemon({ stats: { spe: 200 }, boosts: { spe: -1 } });
    expect(p.getEffectiveSpeed({})).toBe(Math.floor(200 * 2 / 3));
  });

  test('-2 speed = 1/2x', () => {
    const p = makePokemon({ stats: { spe: 200 }, boosts: { spe: -2 } });
    expect(p.getEffectiveSpeed({})).toBe(100);
  });

  test('paralysis halves speed (after boosts)', () => {
    const p = makePokemon({ stats: { spe: 200 }, status: 'Paralyzed' });
    expect(p.getEffectiveSpeed({})).toBe(100);
  });

  test('Choice Scarf gives 1.5x', () => {
    const p = makePokemon({ stats: { spe: 200 }, item: 'Choice Scarf' });
    expect(p.getEffectiveSpeed({})).toBe(300);
  });

  test('Tailwind doubles speed', () => {
    const p = makePokemon({ stats: { spe: 200 } });
    expect(p.getEffectiveSpeed({ tailwind: true })).toBe(400);
  });

  test('paralysis + Choice Scarf stacks correctly', () => {
    const p = makePokemon({ stats: { spe: 200 }, status: 'Paralyzed', item: 'Choice Scarf' });
    // 200 base -> 100 (par) -> 150 (scarf)
    expect(p.getEffectiveSpeed({})).toBe(150);
  });

  test('+1 boost + paralysis + Choice Scarf', () => {
    const p = makePokemon({ stats: { spe: 200 }, boosts: { spe: 1 }, status: 'Paralyzed', item: 'Choice Scarf' });
    // 200 * 1.5 = 300 -> floor(300*0.5) = 150 -> floor(150*1.5) = 225
    expect(p.getEffectiveSpeed({})).toBe(225);
  });
});

// ---------------------------------------------------------------------------
// BattleStateSnapshot
// ---------------------------------------------------------------------------
describe('BattleStateSnapshot', () => {
  test('initialises with default values', () => {
    const s = new BP.BattleStateSnapshot();
    expect(s.turnNumber).toBe(0);
    expect(s.field.weather).toBe('None');
    expect(s.field.trickRoom).toBe(false);
    expect(s.sides.p1.spikes).toBe(0);
    expect(s.sides.p1.stealthRock).toBe(false);
  });

  test('clone produces independent copy', () => {
    const state = makeState();
    const clone = state.clone();

    clone.p1.active.currentHP = 0;
    clone.field.weather = 'Rain';
    clone.sides.p2.stealthRock = true;

    expect(state.p1.active.currentHP).toBe(300);
    expect(state.field.weather).toBe('None');
    expect(state.sides.p2.stealthRock).toBe(false);
  });

  describe('getSpeedComparison', () => {
    test('faster P1 is reported correctly', () => {
      const state = makeState(
        { stats: { spe: 300 } },
        { stats: { spe: 200 } }
      );
      const cmp = state.getSpeedComparison();
      expect(cmp.p1First).toBe(true);
      expect(cmp.p2First).toBe(false);
      expect(cmp.speedTie).toBe(false);
    });

    test('speed tie is reported', () => {
      const state = makeState(
        { stats: { spe: 200 } },
        { stats: { spe: 200 } }
      );
      const cmp = state.getSpeedComparison();
      expect(cmp.speedTie).toBe(true);
    });

    test('Trick Room reverses the order', () => {
      const state = makeState(
        { stats: { spe: 300 } },
        { stats: { spe: 200 } },
        { trickRoom: true }
      );
      const cmp = state.getSpeedComparison();
      expect(cmp.p1First).toBe(false);
      expect(cmp.p2First).toBe(true);
      expect(cmp.trickRoom).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// BattleAction & BattleOutcome
// ---------------------------------------------------------------------------
describe('BattleAction', () => {
  test('describes a move action', () => {
    const a = new BP.BattleAction('move', { moveName: 'Earthquake', moveIndex: 0 });
    expect(a.describe()).toBe('Earthquake');
  });

  test('describes a switch action', () => {
    const a = new BP.BattleAction('switch', { switchTo: 'Salamence' });
    expect(a.describe()).toBe('Switch → Salamence');
  });

  test('describes a skip action', () => {
    const a = new BP.BattleAction('skip', {});
    expect(a.describe()).toBe('Skip');
  });
});

describe('BattleOutcome', () => {
  test('labels a normal outcome', () => {
    const o = new BP.BattleOutcome('Normal', 0.875, 120, {});
    expect(o.getLabel()).toBe('Normal');
    expect(o.isCrit).toBe(false);
    expect(o.isMiss).toBe(false);
  });

  test('labels a critical hit', () => {
    const o = new BP.BattleOutcome('Crit', 0.0625, 180, { crit: true });
    expect(o.getLabel()).toBe('Crit');
    expect(o.isCrit).toBe(true);
  });

  test('labels a miss', () => {
    const o = new BP.BattleOutcome('Miss', 0.15, 0, { miss: true });
    expect(o.getLabel()).toBe('Miss');
  });

  test('combines labels for crit + high roll', () => {
    const o = new BP.BattleOutcome('Crit High', 0.01, 200, { crit: true, highRoll: true });
    expect(o.getLabel()).toBe('Crit, Max');
  });
});

// ---------------------------------------------------------------------------
// BattleTree
// ---------------------------------------------------------------------------
describe('BattleTree', () => {
  let tree;

  beforeEach(() => {
    tree = new BP.BattleTree();
    tree.initialize(makeState());
  });

  test('initialises with a root node', () => {
    expect(tree.rootId).toBeTruthy();
    expect(tree.getCurrentNode()).toBeTruthy();
    expect(tree.getCurrentNode().label).toBe('Battle Start');
  });

  test('addBranch creates a child node', () => {
    const root = tree.getCurrentNode();
    const newState = root.state.clone();
    newState.turnNumber = 1;
    const child = tree.addBranch(root.id, newState, {}, new BP.BattleOutcome());

    expect(child).toBeTruthy();
    expect(root.children).toContain(child.id);
    expect(child.parentId).toBe(root.id);
  });

  test('navigate changes current node', () => {
    const root = tree.getCurrentNode();
    const child = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());
    tree.navigate(child.id);
    expect(tree.currentNodeId).toBe(child.id);
  });

  test('navigate returns false for unknown ID', () => {
    expect(tree.navigate('nonexistent')).toBe(false);
  });

  test('removeNode removes node and its descendants', () => {
    const root = tree.getCurrentNode();
    const child = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());
    const grandchild = tree.addBranch(child.id, root.state.clone(), {}, new BP.BattleOutcome());

    tree.removeNode(child.id);

    expect(tree.getNode(child.id)).toBeNull();
    expect(tree.getNode(grandchild.id)).toBeNull();
    expect(root.children).not.toContain(child.id);
  });

  test('cannot remove root node', () => {
    expect(tree.removeNode(tree.rootId)).toBe(false);
  });

  test('removeNode moves current to parent if current was removed', () => {
    const root = tree.getCurrentNode();
    const child = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());
    tree.navigate(child.id);
    tree.removeNode(child.id);
    expect(tree.currentNodeId).toBe(root.id);
  });

  test('getPathToNode returns ancestor chain', () => {
    const root = tree.getCurrentNode();
    const c1 = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());
    const c2 = tree.addBranch(c1.id, root.state.clone(), {}, new BP.BattleOutcome());

    const path = tree.getPathToNode(c2.id);
    expect(path).toEqual([root.id, c1.id, c2.id]);
  });

  test('getLeafNodes returns terminal nodes', () => {
    const root = tree.getCurrentNode();
    const c1 = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());
    const c2 = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());

    const leaves = tree.getLeafNodes();
    const leafIds = leaves.map(n => n.id);
    expect(leafIds).toContain(c1.id);
    expect(leafIds).toContain(c2.id);
    expect(leafIds).not.toContain(root.id);
  });

  test('getNodeDepth returns correct depth', () => {
    const root = tree.getCurrentNode();
    const c1 = tree.addBranch(root.id, root.state.clone(), {}, new BP.BattleOutcome());
    const c2 = tree.addBranch(c1.id, root.state.clone(), {}, new BP.BattleOutcome());

    expect(tree.getNodeDepth(root.id)).toBe(0);
    expect(tree.getNodeDepth(c1.id)).toBe(1);
    expect(tree.getNodeDepth(c2.id)).toBe(2);
  });

  test('getCumulativeProbability multiplies along path', () => {
    const root = tree.getCurrentNode();
    const c1 = tree.addBranch(root.id, root.state.clone(), {},
      new BP.BattleOutcome('Hit', 0.85, 100, {}));
    const c2 = tree.addBranch(c1.id, root.state.clone(), {},
      new BP.BattleOutcome('Crit', 0.0625, 150, { crit: true }));

    const prob = tree.getCumulativeProbability(c2.id);
    expect(prob).toBeCloseTo(0.85 * 0.0625, 6);
  });

  test('serialize and deserialize round-trip', () => {
    const root = tree.getCurrentNode();
    const child = tree.addBranch(root.id, root.state.clone(), {},
      new BP.BattleOutcome('Hit', 0.9, 100, {}));
    tree.navigate(child.id);

    const json = tree.serialize();
    const tree2 = new BP.BattleTree();
    expect(tree2.deserialize(json)).toBe(true);

    expect(tree2.rootId).toBe(tree.rootId);
    expect(tree2.currentNodeId).toBe(child.id);
    expect(tree2.getNode(child.id).outcome.probability).toBe(0.9);
  });

  test('analyzeOutcomes identifies best and worst cases', () => {
    const root = tree.getCurrentNode();

    const goodState = root.state.clone();
    goodState.p1.active.currentHP = 300;
    goodState.p2.active.currentHP = 0;
    const good = tree.addBranch(root.id, goodState, {}, new BP.BattleOutcome('OHKO', 0.5, 300, {}));

    const badState = root.state.clone();
    badState.p1.active.currentHP = 50;
    badState.p2.active.currentHP = 300;
    const bad = tree.addBranch(root.id, badState, {}, new BP.BattleOutcome('Miss', 0.5, 0, { miss: true }));

    const analysis = tree.analyzeOutcomes();
    expect(analysis.best.nodeId).toBe(good.id);
    expect(analysis.worst.nodeId).toBe(bad.id);
    expect(analysis.all).toHaveLength(2);
  });

  describe('multiple roots', () => {
    test('addRoot creates a new root and tracks both', () => {
      const firstRootId = tree.rootId;
      const newRoot = tree.addRoot(makeState(), 'Alt Lead');

      expect(newRoot.label).toBe('Alt Lead');
      expect(tree.rootId).toBe(newRoot.id);
      expect(tree.getAllRoots()).toHaveLength(2);
      expect(tree.getAllRoots().map(r => r.id)).toContain(firstRootId);
    });
  });
});

// ---------------------------------------------------------------------------
// extractMaxHP / extractCurHP
// ---------------------------------------------------------------------------
describe('extractMaxHP', () => {
  test('uses rawStats.hp when available', () => {
    expect(BP.extractMaxHP({ rawStats: { hp: 350 } })).toBe(350);
  });

  test('Shedinja always has 1 HP', () => {
    expect(BP.extractMaxHP({
      species: { name: 'Shedinja', baseStats: { hp: 1 } },
      level: 100, ivs: { hp: 31 }, evs: { hp: 0 }
    })).toBe(1);
  });

  test('Dynamax doubles max HP', () => {
    expect(BP.extractMaxHP({ rawStats: { hp: 300 }, isDynamaxed: true })).toBe(600);
  });

  test('returns at least 1 for null input', () => {
    expect(BP.extractMaxHP(null)).toBe(1);
  });
});
