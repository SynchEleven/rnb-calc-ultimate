/**
 * Tests for battle planner improvements:
 * - Serialization/deserialization with teams and rootIds
 * - Focus Sash / mid-turn item effects via applyItemEffects
 * - Trainer map building
 */
const { setupBattlePlanner, setupCalcIntegration, setupLogic, makePokemon, makeState } = require('./setup');

let BP, CI, Logic;

beforeAll(() => {
  BP = setupBattlePlanner();
  CI = setupCalcIntegration();
  Logic = setupLogic();
});

// ---------------------------------------------------------------------------
// Serialization / Deserialization
// ---------------------------------------------------------------------------
describe('BattleTree serialize/deserialize', () => {
  test('serializes and deserializes with correct version', () => {
    const tree = new BP.BattleTree();
    const state = makeState();
    tree.initialize(state);

    const json = tree.serialize();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(parsed.rootId).toBe(tree.rootId);
    expect(parsed.rootIds).toEqual([tree.rootId]);
  });

  test('deserialized tree has functional PokemonSnapshot on active', () => {
    const tree = new BP.BattleTree();
    const state = makeState();
    tree.initialize(state);

    const json = tree.serialize();

    const tree2 = new BP.BattleTree();
    tree2.deserialize(json);

    const root = tree2.getRootNode();
    expect(root.state.p1.active.clone).toBeInstanceOf(Function);
    expect(root.state.p2.active.clone).toBeInstanceOf(Function);
  });

  test('deserialized tree has functional PokemonSnapshot on team members', () => {
    const tree = new BP.BattleTree();
    const state = makeState();
    const extra = makePokemon({ name: 'Salamence', types: ['Dragon', 'Flying'] });
    state.p1.team.push(extra);

    tree.initialize(state);
    const json = tree.serialize();

    const tree2 = new BP.BattleTree();
    tree2.deserialize(json);

    const root = tree2.getRootNode();
    expect(root.state.p1.team).toHaveLength(2);
    expect(root.state.p1.team[1].clone).toBeInstanceOf(Function);
    expect(root.state.p1.team[1].name).toBe('Salamence');
  });

  test('deserialized tree restores rootIds for multi-root trees', () => {
    const tree = new BP.BattleTree();
    const state1 = makeState();
    tree.initialize(state1);
    const firstRootId = tree.rootId;

    const state2 = makeState({ name: 'Gardevoir' });
    tree.addRoot(state2, 'Alt');

    expect(tree.rootIds).toHaveLength(2);

    const json = tree.serialize();
    const tree2 = new BP.BattleTree();
    tree2.deserialize(json);

    expect(tree2.rootIds).toHaveLength(2);
    expect(tree2.rootIds).toContain(firstRootId);
  });

  test('deserialized tree preserves node children and structure', () => {
    const tree = new BP.BattleTree();
    const state = makeState();
    tree.initialize(state);

    const rootId = tree.rootId;
    const childState = state.clone();
    childState.turnNumber = 1;
    const action = { p1: new BP.BattleAction('move', { moveName: 'Flare Blitz' }) };
    const outcome = new BP.BattleOutcome('Normal', 1, 100, {});
    tree.addBranch(rootId, childState, action, outcome);

    const json = tree.serialize();
    const tree2 = new BP.BattleTree();
    tree2.deserialize(json);

    const root = tree2.getRootNode();
    expect(root.children).toHaveLength(1);
    const child = tree2.getNode(root.children[0]);
    expect(child.state.turnNumber).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CalcIntegration.applyItemEffects
// ---------------------------------------------------------------------------
describe('applyItemEffects', () => {
  test('Focus Sash triggers at full HP on lethal damage', () => {
    const p = makePokemon({ currentHP: 300, maxHP: 300, item: 'Focus Sash' });
    const fx = CI.applyItemEffects(p, 500);

    expect(fx.healed).toBe(1);
    expect(fx.itemConsumed).toBe(true);
    expect(fx.itemEffect).toContain('Focus Sash');
  });

  test('Focus Sash does not trigger at non-full HP', () => {
    const p = makePokemon({ currentHP: 299, maxHP: 300, item: 'Focus Sash' });
    const fx = CI.applyItemEffects(p, 500);

    expect(fx.healed).toBe(0);
    expect(fx.itemConsumed).toBe(false);
  });

  test('Focus Sash does not trigger on non-lethal damage', () => {
    const p = makePokemon({ currentHP: 300, maxHP: 300, item: 'Focus Sash' });
    const fx = CI.applyItemEffects(p, 100);

    expect(fx.healed).toBe(0);
    expect(fx.itemConsumed).toBe(false);
  });

  test('Sitrus Berry triggers when crossing 50% threshold', () => {
    const p = makePokemon({ currentHP: 210, maxHP: 400, item: 'Sitrus Berry' });
    const fx = CI.applyItemEffects(p, 20);

    expect(fx.healed).toBe(100);
    expect(fx.itemConsumed).toBe(true);
  });

  test('Sitrus Berry does not trigger when already below 50%', () => {
    const p = makePokemon({ currentHP: 180, maxHP: 400, item: 'Sitrus Berry' });
    const fx = CI.applyItemEffects(p, 10);

    expect(fx.healed).toBe(0);
    expect(fx.itemConsumed).toBe(false);
  });

  test('Oran Berry triggers when crossing 50% threshold', () => {
    const p = makePokemon({ currentHP: 55, maxHP: 100, item: 'Oran Berry' });
    const fx = CI.applyItemEffects(p, 10);

    expect(fx.healed).toBe(10);
    expect(fx.itemConsumed).toBe(true);
  });

  test('No item returns zero effects', () => {
    const p = makePokemon({ currentHP: 300, maxHP: 300, item: '' });
    const fx = CI.applyItemEffects(p, 100);

    expect(fx.healed).toBe(0);
    expect(fx.itemConsumed).toBe(false);
  });

  test('Focus Band reports its 10% survival chance on lethal damage', () => {
    const p = makePokemon({ currentHP: 100, maxHP: 300, item: 'Focus Band' });
    const fx = CI.applyItemEffects(p, 200);

    // Now a probability rather than a bare flag, so the branching engine can
    // split the turn into "Focus Band held on" / "it did not".
    expect(fx.focusBandChance).toBe(0.1);
  });

  test('Sturdy survives a lethal hit from full HP without consuming an item', () => {
    const p = makePokemon({ currentHP: 300, maxHP: 300, item: 'Leftovers', ability: 'Sturdy' });
    const fx = CI.applyItemEffects(p, 500);

    expect(fx.survivesAtOneHP).toBe(true);
    expect(fx.healed).toBe(1);
    expect(fx.itemConsumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PokemonSnapshot.clone preserves all fields
// ---------------------------------------------------------------------------
describe('PokemonSnapshot clone fidelity', () => {
  test('clone preserves moves, types, stats, and boosts', () => {
    const p = makePokemon({
      name: 'Gardevoir',
      types: ['Psychic', 'Fairy'],
      moves: ['Moonblast', 'Psychic', 'Calm Mind', 'Shadow Ball'],
      boosts: { spa: 2, spd: 1 },
      stats: { hp: 340, atk: 150, def: 200, spa: 380, spd: 350, spe: 260 },
    });

    const clone = p.clone();

    expect(clone.name).toBe('Gardevoir');
    expect(clone.types).toEqual(['Psychic', 'Fairy']);
    expect(clone.moves).toEqual(['Moonblast', 'Psychic', 'Calm Mind', 'Shadow Ball']);
    expect(clone.boosts.spa).toBe(2);
    expect(clone.stats.spa).toBe(380);

    // Mutations to clone don't affect original
    clone.boosts.spa = 6;
    expect(p.boosts.spa).toBe(2);
  });

  test('clone preserves status and item', () => {
    const p = makePokemon({ status: 'Burned', item: 'Leftovers' });
    const clone = p.clone();

    expect(clone.status).toBe('Burned');
    expect(clone.item).toBe('Leftovers');

    clone.status = 'Healthy';
    expect(p.status).toBe('Burned');
  });
});

// ---------------------------------------------------------------------------
// BattleStateSnapshot.clone
// ---------------------------------------------------------------------------
describe('BattleStateSnapshot clone', () => {
  test('clone creates independent field copy', () => {
    const state = makeState(null, null, { weather: 'Rain', weatherTurns: 3 });
    const cloned = state.clone();

    cloned.field.weather = 'Sun';
    expect(state.field.weather).toBe('Rain');
  });

  test('clone creates independent sides copy', () => {
    const state = makeState(null, null, null, { p1: { stealthRock: true, spikes: 2 } });
    const cloned = state.clone();

    cloned.sides.p1.stealthRock = false;
    expect(state.sides.p1.stealthRock).toBe(true);
  });

  test('clone creates independent team arrays', () => {
    const state = makeState();
    const extra = makePokemon({ name: 'Metagross' });
    state.p1.team.push(extra);

    const cloned = state.clone();
    cloned.p1.team.push(makePokemon({ name: 'Flygon' }));

    expect(state.p1.team).toHaveLength(2);
    expect(cloned.p1.team).toHaveLength(3);
  });
});
