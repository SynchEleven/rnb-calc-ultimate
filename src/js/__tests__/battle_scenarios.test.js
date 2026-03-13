/**
 * Battle Scenario Integration Tests
 *
 * Multi-turn battle simulations that exercise the full planner stack:
 * data model + calc integration + logic layer.
 *
 * These mirror real Run and Bun situations to catch regressions.
 */
const { setupBattlePlanner, setupCalcIntegration, setupLogic, makePokemon, makeState } = require('./setup');

let BP, CI, Logic;

beforeAll(() => {
  BP = setupBattlePlanner();
  CI = setupCalcIntegration();
  Logic = setupLogic();
});

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/** Simulate one end-of-turn cycle and return the effects list. */
function endOfTurn(state, gen) {
  return Logic.applyEndOfTurnEffects(state, gen || 3);
}

/** Apply raw damage to a side's active Pokemon. */
function dealDamage(state, side, amount) {
  state[side].active.currentHP = Math.max(0, state[side].active.currentHP - amount);
  state[side].active.hasFainted = state[side].active.currentHP <= 0;
  state[side].active.percentHP = state[side].active.maxHP > 0
    ? Math.round((state[side].active.currentHP / state[side].active.maxHP) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Scenario 1: Toxic Stall
// ---------------------------------------------------------------------------
describe('Scenario: Toxic stall with Leftovers', () => {
  test('Toxic damage escalates while Leftovers partially offsets', () => {
    const state = makeState({
      name: 'Blissey', currentHP: 620, maxHP: 620,
      types: ['Normal'], status: 'Badly Poisoned', toxicCounter: 1,
      item: 'Leftovers'
    });

    const hpHistory = [620];

    for (let turn = 0; turn < 16; turn++) {
      if (state.p1.active.currentHP <= 0) break;
      endOfTurn(state, 3);
      hpHistory.push(state.p1.active.currentHP);
    }

    // On turn 1, toxic (1/16 = 38) and Leftovers (1/16 = 38) may cancel out.
    // After that, toxic escalates and net HP should decrease every turn.
    // Verify overall HP loss trend: last recorded HP < first
    expect(hpHistory[hpHistory.length - 1]).toBeLessThan(hpHistory[0]);

    // Should eventually faint from toxic
    while (state.p1.active.currentHP > 0) {
      endOfTurn(state, 3);
    }
    expect(state.p1.active.currentHP).toBe(0);
    expect(state.p1.active.hasFainted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Focus Sash + Entry Hazards
// ---------------------------------------------------------------------------
describe('Scenario: Focus Sash interaction with entry hazards', () => {
  test('Focus Sash is useless when Stealth Rock breaks it before the hit', () => {
    const state = makeState();
    state.sides.p1.stealthRock = true;

    // Sash user switches in
    const sashUser = makePokemon({
      name: 'Alakazam', types: ['Psychic'],
      currentHP: 250, maxHP: 250, item: 'Focus Sash'
    });
    state.p1.team.push(sashUser);

    Logic.performSwitch(state, 'p1', 1);

    // Psychic takes neutral SR (1/8 = 31 damage)
    expect(state.p1.active.currentHP).toBeLessThan(250);
    expect(state.p1.active.currentHP).toBeGreaterThan(0);

    // Now Focus Sash should NOT trigger since HP isn't full
    const fxBefore = CI.applyItemEffects(state.p1.active, 999);
    expect(fxBefore.itemConsumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Setup Sweeper
// ---------------------------------------------------------------------------
describe('Scenario: Dragon Dance setup and sweep', () => {
  test('+1 Atk/Spe boosts from Dragon Dance are tracked', () => {
    const state = makeState({
      name: 'Salamence', types: ['Dragon', 'Flying'],
      currentHP: 350, maxHP: 350,
      stats: { hp: 350, atk: 310, def: 200, spa: 250, spd: 200, spe: 280 }
    });

    // Apply Dragon Dance boost
    const ddEffects = CI.getStatusMoveEffects('Dragon Dance', {});
    for (const stat in ddEffects.selfBoosts) {
      state.p1.active.applyBoost(stat, ddEffects.selfBoosts[stat]);
    }

    expect(state.p1.active.boosts.atk).toBe(1);
    expect(state.p1.active.boosts.spe).toBe(1);

    // Effective speed should be 1.5x
    const speed = state.p1.active.getEffectiveSpeed({});
    expect(speed).toBe(Math.floor(280 * 1.5));
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Weather battle
// ---------------------------------------------------------------------------
describe('Scenario: Rain Dance + Thunder accuracy', () => {
  test('Thunder is 100% accurate in Rain', () => {
    const acc = CI.getAccuracy({ accuracy: 70, name: 'Thunder' }, {}, {}, { weather: 'Rain' }, 3);
    expect(acc).toBe(100);
  });

  test('Thunder drops to 50% in Sun', () => {
    const acc = CI.getAccuracy({ accuracy: 70, name: 'Thunder' }, {}, {}, { weather: 'Sun' }, 3);
    expect(acc).toBe(50);
  });

  test('Rain weather expires after set number of turns', () => {
    const state = makeState(null, null, { weather: 'Rain', weatherTurns: 5 });

    for (let i = 0; i < 5; i++) {
      endOfTurn(state, 3);
    }

    expect(state.field.weather).toBe('None');
    expect(state.field.weatherTurns).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Entry hazard stacking
// ---------------------------------------------------------------------------
describe('Scenario: Full hazard stack on switch', () => {
  test('Stealth Rock + 3 Spikes + Toxic Spikes deals massive damage', () => {
    const state = makeState();
    state.sides.p1.stealthRock = true;
    state.sides.p1.spikes = 3;
    state.sides.p1.toxicSpikes = 2;

    const switchIn = makePokemon({
      name: 'Tyranitar', types: ['Rock', 'Dark'],
      currentHP: 400, maxHP: 400
    });
    state.p1.team.push(switchIn);

    Logic.performSwitch(state, 'p1', 1);

    // SR: Rock/Dark - Rock resists Rock (0.5), Dark neutral (1) = 0.5x => floor(400*0.5/8) = 25
    // Spikes: 3 layers = 1/4 => floor(400/4) = 100
    // Toxic Spikes: absorbed? No, Rock/Dark is not Poison/Flying/Steel
    // Steel check: not Steel. So Badly Poisoned
    expect(state.p1.active.currentHP).toBeLessThan(400);
    expect(state.p1.active.status).toBe('Badly Poisoned');
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Screen support
// ---------------------------------------------------------------------------
describe('Scenario: Screen turns decrement and expire', () => {
  test('Reflect lasts exactly 5 turns then expires', () => {
    const state = makeState(null, null, null, {
      p1: { reflect: true, reflectTurns: 5 }
    });

    for (let i = 0; i < 4; i++) {
      endOfTurn(state, 3);
      expect(state.sides.p1.reflect).toBe(true);
    }

    endOfTurn(state, 3);
    expect(state.sides.p1.reflect).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Speed control with Trick Room
// ---------------------------------------------------------------------------
describe('Scenario: Trick Room speed control', () => {
  test('slower Pokemon moves first in Trick Room', () => {
    const result = Logic.resolveSpeedOrder(0, 0, 100, 300, true);
    expect(result.firstMover).toBe('p1'); // p1 is slower
    expect(result.reason).toBe('trick_room');
  });

  test('Trick Room + negative priority: priority still wins', () => {
    const result = Logic.resolveSpeedOrder(0, -6, 100, 300, true);
    expect(result.firstMover).toBe('p1'); // p1 has higher priority (0 > -6)
  });

  test('Trick Room expires and speed order reverses', () => {
    const state = makeState(
      { stats: { spe: 100 } },
      { stats: { spe: 300 } },
      { trickRoom: true, trickRoomTurns: 1 }
    );

    // Before expiry: slower moves first
    let cmp = state.getSpeedComparison();
    expect(cmp.p1First).toBe(true);

    // Expire Trick Room
    endOfTurn(state, 3);

    // After expiry: faster moves first
    cmp = state.getSpeedComparison();
    expect(cmp.p1First).toBe(false);
    expect(cmp.p2First).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: U-turn pivot
// ---------------------------------------------------------------------------
describe('Scenario: U-turn pivot into resistant Pokemon', () => {
  test('performSwitch works for U-turn-like situations', () => {
    const state = makeState();

    // Add a resistant Pokemon to switch into
    const resistor = makePokemon({
      name: 'Skarmory', types: ['Steel', 'Flying'],
      currentHP: 330, maxHP: 330
    });
    state.p1.team.push(resistor);

    // Simulate U-turn: first deal damage, then switch
    dealDamage(state, 'p2', 80);
    expect(state.p2.active.currentHP).toBe(260);

    Logic.performSwitch(state, 'p1', 1);
    expect(state.p1.active.name).toBe('Skarmory');
    expect(state.p1.active.boosts.atk).toBe(0); // boosts reset
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: Battle tree branching with outcomes
// ---------------------------------------------------------------------------
describe('Scenario: Battle tree probability tracking', () => {
  test('branching on hit vs miss tracks correct cumulative probability', () => {
    const tree = new BP.BattleTree();
    const initialState = makeState();
    tree.initialize(initialState);

    const root = tree.getCurrentNode();

    // Branch 1: Hit (85%)
    const hitState = root.state.clone();
    hitState.p2.active.currentHP -= 150;
    const hitNode = tree.addBranch(root.id, hitState, {},
      new BP.BattleOutcome('Hit', 0.85, 150, {}));

    // Branch 2: Miss (15%)
    const missState = root.state.clone();
    const missNode = tree.addBranch(root.id, missState, {},
      new BP.BattleOutcome('Miss', 0.15, 0, { miss: true }));

    // Sub-branch from hit: Crit next turn (6.25%)
    const critState = hitState.clone();
    critState.p2.active.currentHP -= 200;
    const critNode = tree.addBranch(hitNode.id, critState, {},
      new BP.BattleOutcome('Crit', 0.0625, 200, { crit: true }));

    // Cumulative probability for crit path: 0.85 * 0.0625 ≈ 5.3%
    const critProb = tree.getCumulativeProbability(critNode.id);
    expect(critProb).toBeCloseTo(0.85 * 0.0625, 6);

    // Analysis should identify best/worst -- hitNode has a child so it's not a leaf
    const analysis = tree.analyzeOutcomes();
    expect(analysis.all).toHaveLength(2); // missNode and critNode are the leaves
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: Shedinja edge case
// ---------------------------------------------------------------------------
describe('Scenario: Shedinja mechanics', () => {
  test('Shedinja always has 1 HP max', () => {
    const maxHP = BP.extractMaxHP({
      species: { name: 'Shedinja', baseStats: { hp: 1 } },
      level: 100, ivs: { hp: 31 }, evs: { hp: 252 }
    });
    expect(maxHP).toBe(1);
  });

  test('any damage kills Shedinja', () => {
    const shedinja = makePokemon({
      name: 'Shedinja', currentHP: 1, maxHP: 1, types: ['Bug', 'Ghost']
    });
    shedinja.applyDamage(1);
    expect(shedinja.hasFainted).toBe(true);
  });

  test('Stealth Rock kills Shedinja (Bug/Ghost is 2x weak)', () => {
    const shedinja = makePokemon({
      name: 'Shedinja', currentHP: 1, maxHP: 1, types: ['Bug', 'Ghost']
    });
    const side = { stealthRock: true, spikes: 0, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(shedinja, side);
    expect(shedinja.hasFainted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 11: Serialisation round-trip preserves full battle state
// ---------------------------------------------------------------------------
describe('Scenario: Serialisation integrity', () => {
  test('full battle state survives serialize -> deserialize', () => {
    const tree = new BP.BattleTree();
    const initialState = makeState(
      { name: 'Blaziken', currentHP: 250, maxHP: 300, status: 'Burned', boosts: { atk: 2 } },
      { name: 'Swampert', currentHP: 200, maxHP: 340, status: 'Healthy' },
      { weather: 'Sun', weatherTurns: 3, trickRoom: true, trickRoomTurns: 2 },
      { p1: { stealthRock: true, spikes: 2 }, p2: { reflect: true, reflectTurns: 4 } }
    );
    tree.initialize(initialState);

    const json = tree.serialize();
    const tree2 = new BP.BattleTree();
    tree2.deserialize(json);

    const root2 = tree2.getCurrentNode();
    expect(root2.state.p1.active.name).toBe('Blaziken');
    expect(root2.state.p1.active.currentHP).toBe(250);
    expect(root2.state.p1.active.status).toBe('Burned');
    expect(root2.state.p1.active.boosts.atk).toBe(2);
    expect(root2.state.field.weather).toBe('Sun');
    expect(root2.state.field.trickRoom).toBe(true);
    expect(root2.state.sides.p1.stealthRock).toBe(true);
    expect(root2.state.sides.p1.spikes).toBe(2);
    expect(root2.state.sides.p2.reflect).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 12: Multi-turn burn damage (Gen 3 vs Gen 7)
// ---------------------------------------------------------------------------
describe('Scenario: Gen-specific burn damage', () => {
  test('Gen 3 burn does twice as much as Gen 7 burn', () => {
    const state3 = makeState({ currentHP: 320, maxHP: 320, status: 'Burned' });
    const state7 = makeState({ currentHP: 320, maxHP: 320, status: 'Burned' });

    endOfTurn(state3, 3);
    endOfTurn(state7, 7);

    const gen3Damage = 320 - state3.p1.active.currentHP;
    const gen7Damage = 320 - state7.p1.active.currentHP;

    expect(gen3Damage).toBe(Math.max(1, Math.floor(320 / 8)));
    expect(gen7Damage).toBe(Math.max(1, Math.floor(320 / 16)));
    expect(gen3Damage).toBe(gen7Damage * 2);
  });
});
