/**
 * Tests for battle_planner_logic.js - Extracted Pure Battle Logic
 *
 * Covers: speed resolution, end-of-turn effects, entry hazards,
 *         move effects, switch mechanics, weather/screen/status decay.
 */
const { setupBattlePlanner, setupCalcIntegration, setupLogic, makePokemon, makeState } = require('./setup');

let BP, CI, Logic;

beforeAll(() => {
  BP = setupBattlePlanner();
  CI = setupCalcIntegration();
  Logic = setupLogic();
});

// ---------------------------------------------------------------------------
// resolveSpeedOrder
// ---------------------------------------------------------------------------
describe('resolveSpeedOrder', () => {
  test('higher priority moves first regardless of speed', () => {
    const result = Logic.resolveSpeedOrder(1, 0, 100, 400, false);
    expect(result.firstMover).toBe('p1');
    expect(result.reason).toBe('priority');
  });

  test('switches (priority 6) go before regular moves', () => {
    const result = Logic.resolveSpeedOrder(6, 0, 50, 300, false);
    expect(result.firstMover).toBe('p1');
  });

  test('faster Pokemon moves first at equal priority', () => {
    const result = Logic.resolveSpeedOrder(0, 0, 300, 200, false);
    expect(result.firstMover).toBe('p1');
    expect(result.reason).toBe('speed');
  });

  test('slower Pokemon moves first at equal priority when opposite is faster', () => {
    const result = Logic.resolveSpeedOrder(0, 0, 100, 200, false);
    expect(result.firstMover).toBe('p2');
  });

  test('Trick Room reverses speed order', () => {
    const result = Logic.resolveSpeedOrder(0, 0, 300, 200, true);
    expect(result.firstMover).toBe('p2');
    expect(result.reason).toBe('trick_room');
  });

  test('Trick Room: slower Pokemon moves first', () => {
    const result = Logic.resolveSpeedOrder(0, 0, 100, 200, true);
    expect(result.firstMover).toBe('p1');
  });

  test('speed tie is resolved by random value', () => {
    const resultP1 = Logic.resolveSpeedOrder(0, 0, 200, 200, false, 0.3);
    expect(resultP1.firstMover).toBe('p1');
    expect(resultP1.reason).toBe('speed_tie');

    const resultP2 = Logic.resolveSpeedOrder(0, 0, 200, 200, false, 0.7);
    expect(resultP2.firstMover).toBe('p2');
  });

  test('priority trumps Trick Room', () => {
    const result = Logic.resolveSpeedOrder(1, 0, 100, 300, true);
    expect(result.firstMover).toBe('p1');
    expect(result.reason).toBe('priority');
  });

  test('negative priority moves go last', () => {
    const result = Logic.resolveSpeedOrder(-6, 0, 300, 100, false);
    expect(result.firstMover).toBe('p2');
  });

  test('secondMover is the opposite of firstMover', () => {
    const result = Logic.resolveSpeedOrder(0, 0, 300, 100, false);
    expect(result.secondMover).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// getMovePriority
// ---------------------------------------------------------------------------
describe('getMovePriority', () => {
  test('Quick Attack has +1 priority', () => {
    expect(Logic.getMovePriority('Quick Attack')).toBe(1);
  });

  test('Extreme Speed has +2 priority', () => {
    expect(Logic.getMovePriority('Extreme Speed')).toBe(2);
  });

  test('Fake Out has +3 priority', () => {
    expect(Logic.getMovePriority('Fake Out')).toBe(3);
  });

  test('Protect has +4 priority', () => {
    expect(Logic.getMovePriority('Protect')).toBe(4);
  });

  test('Roar has -6 priority', () => {
    expect(Logic.getMovePriority('Roar')).toBe(-6);
  });

  test('Trick Room has -7 priority', () => {
    expect(Logic.getMovePriority('Trick Room')).toBe(-7);
  });

  test('unknown move returns 0', () => {
    expect(Logic.getMovePriority('Tackle')).toBe(0);
  });

  test('null returns 0', () => {
    expect(Logic.getMovePriority(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Status damage
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - status damage', () => {
  test('Poison deals 1/8 max HP', () => {
    const state = makeState({ currentHP: 300, maxHP: 300, status: 'Poisoned' });
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300 - Math.floor(300 / 8));
    expect(effects).toContainEqual(expect.stringContaining('Poison'));
  });

  test('Toxic deals escalating damage', () => {
    const state = makeState({ currentHP: 300, maxHP: 300, status: 'Badly Poisoned', toxicCounter: 1 });
    Logic.applyEndOfTurnEffects(state, 3);
    // Turn 1: 1/16 * 300 = 18
    expect(state.p1.active.currentHP).toBe(300 - Math.floor(300 / 16));
    expect(state.p1.active.toxicCounter).toBe(2);

    Logic.applyEndOfTurnEffects(state, 3);
    // Turn 2: 2/16 * 300 = 37
    expect(state.p1.active.currentHP).toBe(300 - 18 - Math.floor(300 * 2 / 16));
    expect(state.p1.active.toxicCounter).toBe(3);
  });

  test('Toxic counter caps at 15', () => {
    const state = makeState({ currentHP: 9999, maxHP: 9999, status: 'Badly Poisoned', toxicCounter: 14 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.toxicCounter).toBe(15);
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.toxicCounter).toBe(15); // stays at 15
  });

  test('Burn deals 1/8 in gen 3', () => {
    const state = makeState({ currentHP: 320, maxHP: 320, status: 'Burned' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(320 - Math.floor(320 / 8));
  });

  test('Burn deals 1/16 in gen 7+', () => {
    const state = makeState({ currentHP: 320, maxHP: 320, status: 'Burned' });
    Logic.applyEndOfTurnEffects(state, 7);
    expect(state.p1.active.currentHP).toBe(320 - Math.floor(320 / 16));
  });

  test('fainted Pokemon skip status damage', () => {
    const state = makeState({ currentHP: 0, maxHP: 300, status: 'Poisoned' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(0);
  });

  test('Magic Guard blocks status damage', () => {
    const state = makeState({ currentHP: 300, maxHP: 300, status: 'Burned', ability: 'Magic Guard' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('status damage cannot drop below 0', () => {
    const state = makeState({ currentHP: 1, maxHP: 300, status: 'Poisoned' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(0);
    expect(state.p1.active.hasFainted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Weather damage
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - weather damage', () => {
  test('Sandstorm damages non-immune types', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Fire'] },
      null,
      { weather: 'Sand' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300 - Math.max(1, Math.floor(300 / 16)));
  });

  test('Ground types are immune to Sandstorm', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Ground'] },
      null,
      { weather: 'Sand' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('Rock types are immune to Sandstorm', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Rock'] },
      null,
      { weather: 'Sand' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('Steel types are immune to Sandstorm', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Steel'] },
      null,
      { weather: 'Sand' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('Hail damages non-Ice types', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Fire'] },
      null,
      { weather: 'Hail' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300 - Math.max(1, Math.floor(300 / 16)));
  });

  test('Ice types are immune to Hail', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Ice'] },
      null,
      { weather: 'Hail' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('Magic Guard blocks weather damage', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Fire'], ability: 'Magic Guard' },
      null,
      { weather: 'Sand' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('Sand Veil grants immunity to Sandstorm damage', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Normal'], ability: 'Sand Veil' },
      null,
      { weather: 'Sand' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('Overcoat grants immunity to weather damage', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Normal'], ability: 'Overcoat' },
      null,
      { weather: 'Hail' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(300);
  });

  test('both Pokemon take weather damage', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, types: ['Fire'] },
      { currentHP: 340, maxHP: 340, types: ['Normal'] },
      { weather: 'Hail' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBeLessThan(300);
    expect(state.p2.active.currentHP).toBeLessThan(340);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Items (Leftovers, Black Sludge, Berries)
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - item healing', () => {
  test('Leftovers heals 1/16 max HP', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, item: 'Leftovers' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 16)));
  });

  test('Leftovers does not over-heal', () => {
    const state = makeState({ currentHP: 320, maxHP: 320, item: 'Leftovers' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(320);
  });

  test('Black Sludge heals Poison types', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, item: 'Black Sludge', types: ['Poison'] });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 16)));
  });

  test('Black Sludge damages non-Poison types', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, item: 'Black Sludge', types: ['Water'] });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 - Math.max(1, Math.floor(320 / 8)));
  });

  test('Sitrus Berry heals at <=50% HP', () => {
    const state = makeState({ currentHP: 150, maxHP: 400, item: 'Sitrus Berry' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(150 + Math.floor(400 / 4));
    expect(state.p1.active.item).toBe('');
  });

  test('Sitrus Berry does not trigger above 50%', () => {
    const state = makeState({ currentHP: 250, maxHP: 400, item: 'Sitrus Berry' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(250);
    expect(state.p1.active.item).toBe('Sitrus Berry');
  });

  test('Oran Berry heals 10 HP at <=50%', () => {
    const state = makeState({ currentHP: 30, maxHP: 100, item: 'Oran Berry' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(40);
    expect(state.p1.active.item).toBe('');
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Weather/Screen/Trick Room decay
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - turn counter decay', () => {
  test('weather turns decrement and expire', () => {
    const state = makeState(null, null, { weather: 'Rain', weatherTurns: 1 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.field.weather).toBe('None');
    expect(state.field.weatherTurns).toBe(0);
  });

  test('weather persists when turns remain', () => {
    const state = makeState(null, null, { weather: 'Rain', weatherTurns: 3 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.field.weather).toBe('Rain');
    expect(state.field.weatherTurns).toBe(2);
  });

  test('Reflect expires after turns run out', () => {
    const state = makeState(null, null, null, { p1: { reflect: true, reflectTurns: 1 } });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.sides.p1.reflect).toBe(false);
  });

  test('Light Screen expires after turns run out', () => {
    const state = makeState(null, null, null, { p1: { lightScreen: true, lightScreenTurns: 1 } });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.sides.p1.lightScreen).toBe(false);
  });

  test('Tailwind expires after turns run out', () => {
    const state = makeState(null, null, null, { p1: { tailwind: true, tailwindTurns: 1 } });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.sides.p1.tailwind).toBe(false);
  });

  test('Trick Room expires after turns run out', () => {
    const state = makeState(null, null, { trickRoom: true, trickRoomTurns: 1 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.field.trickRoom).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyEntryHazards
// ---------------------------------------------------------------------------
describe('applyEntryHazards', () => {
  test('Stealth Rock deals type-based damage', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Fire'] });
    const side = { stealthRock: true, spikes: 0, toxicSpikes: 0, stickyWeb: false };
    const effects = Logic.applyEntryHazards(pokemon, side);

    // Fire is weak to Rock (2x), so SR deals 1/8 * 2 = 25% damage
    const expectedDamage = Math.floor(300 * 2 / 8);
    expect(pokemon.currentHP).toBe(300 - expectedDamage);
    expect(effects).toHaveLength(1);
  });

  test('Stealth Rock deals 4x to Fire/Flying', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Fire', 'Flying'] });
    const side = { stealthRock: true, spikes: 0, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);

    // Fire/Flying is 4x weak to Rock, so SR deals 1/8 * 4 = 50% damage
    const expectedDamage = Math.floor(300 * 4 / 8);
    expect(pokemon.currentHP).toBe(300 - expectedDamage);
  });

  test('Stealth Rock deals 1/32 to Fighting/Steel (resists Rock)', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Fighting', 'Steel'] });
    const side = { stealthRock: true, spikes: 0, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);

    // Fighting resists Rock (0.5), Steel resists Rock (0.5) => 0.25x => 0.25/8 of maxHP
    const expectedDamage = Math.max(1, Math.floor(300 * 0.25 / 8));
    expect(pokemon.currentHP).toBe(300 - expectedDamage);
  });

  test('1 layer of Spikes deals 1/8 HP', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'] });
    const side = { stealthRock: false, spikes: 1, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.currentHP).toBe(300 - Math.max(1, Math.floor(300 / 8)));
  });

  test('2 layers of Spikes deals 1/6 HP', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'] });
    const side = { stealthRock: false, spikes: 2, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.currentHP).toBe(300 - Math.max(1, Math.floor(300 / 6)));
  });

  test('3 layers of Spikes deals 1/4 HP', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'] });
    const side = { stealthRock: false, spikes: 3, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.currentHP).toBe(300 - Math.max(1, Math.floor(300 / 4)));
  });

  test('Flying types are immune to Spikes', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Flying'] });
    const side = { stealthRock: false, spikes: 3, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.currentHP).toBe(300);
  });

  test('Levitate grants immunity to Spikes', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Ghost'], ability: 'Levitate' });
    const side = { stealthRock: false, spikes: 3, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.currentHP).toBe(300);
  });

  test('1 layer Toxic Spikes inflicts Poison', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'] });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 1, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.status).toBe('Poisoned');
  });

  test('2 layers Toxic Spikes inflicts Badly Poisoned', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'] });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 2, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.status).toBe('Badly Poisoned');
    expect(pokemon.toxicCounter).toBe(1);
  });

  test('Poison type absorbs Toxic Spikes', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Poison'] });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 2, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(side.toxicSpikes).toBe(0);
    expect(pokemon.status).toBe('Healthy');
  });

  test('Steel type is immune to Toxic Spikes', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Steel'] });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 2, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.status).toBe('Healthy');
    expect(side.toxicSpikes).toBe(2); // not absorbed
  });

  test('Toxic Spikes do not overwrite existing status', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'], status: 'Burned' });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 2, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.status).toBe('Burned');
  });

  test('Sticky Web drops Speed by 1', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'], boosts: { spe: 0 } });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 0, stickyWeb: true };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.boosts.spe).toBe(-1);
  });

  test('Flying types are immune to Sticky Web', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Flying'], boosts: { spe: 0 } });
    const side = { stealthRock: false, spikes: 0, toxicSpikes: 0, stickyWeb: true };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.boosts.spe).toBe(0);
  });

  test('Magic Guard blocks all hazard damage but not status', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Fire'], ability: 'Magic Guard' });
    const side = { stealthRock: true, spikes: 3, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);
    expect(pokemon.currentHP).toBe(300);
  });

  test('combined Stealth Rock + Spikes damage stacks', () => {
    const pokemon = makePokemon({ currentHP: 300, maxHP: 300, types: ['Normal'] });
    const side = { stealthRock: true, spikes: 2, toxicSpikes: 0, stickyWeb: false };
    Logic.applyEntryHazards(pokemon, side);

    const srDamage = Math.max(1, Math.floor(300 * 1 / 8)); // Normal takes neutral SR
    const spikeDamage = Math.max(1, Math.floor(300 / 6));
    expect(pokemon.currentHP).toBe(300 - srDamage - spikeDamage);
  });
});

// ---------------------------------------------------------------------------
// applyMoveEffects
// ---------------------------------------------------------------------------
describe('applyMoveEffects', () => {
  test('applies status to defender', () => {
    const attacker = makePokemon();
    const defender = makePokemon();
    Logic.applyMoveEffects(attacker, defender, { status: 'par' });
    expect(defender.status).toBe('par');
  });

  test('does not overwrite existing status', () => {
    const attacker = makePokemon();
    const defender = makePokemon({ status: 'Burned' });
    Logic.applyMoveEffects(attacker, defender, { status: 'par' });
    expect(defender.status).toBe('Burned');
  });

  test('applies stat boosts to defender', () => {
    const attacker = makePokemon();
    const defender = makePokemon();
    Logic.applyMoveEffects(attacker, defender, { boosts: { atk: -1, def: -1 } });
    expect(defender.boosts.atk).toBe(-1);
    expect(defender.boosts.def).toBe(-1);
  });

  test('applies self boosts to attacker', () => {
    const attacker = makePokemon();
    const defender = makePokemon();
    Logic.applyMoveEffects(attacker, defender, { self: { boosts: { atk: -1, def: -1 } } });
    expect(attacker.boosts.atk).toBe(-1);
    expect(attacker.boosts.def).toBe(-1);
  });

  test('applies secondary status effect', () => {
    const attacker = makePokemon();
    const defender = makePokemon();
    Logic.applyMoveEffects(attacker, defender, { secondary: { status: 'brn' } });
    expect(defender.status).toBe('brn');
  });

  test('clamps stat boosts at +6/-6', () => {
    const attacker = makePokemon({ boosts: { atk: 5 } });
    const defender = makePokemon();
    Logic.applyMoveEffects(attacker, defender, { self: { boosts: { atk: 3 } } });
    expect(attacker.boosts.atk).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// performSwitch
// ---------------------------------------------------------------------------
describe('performSwitch', () => {
  test('switches in a new Pokemon and resets boosts', () => {
    const state = makeState();
    const secondPokemon = makePokemon({ name: 'Salamence', types: ['Dragon', 'Flying'], boosts: { atk: 2 } });
    state.p1.team.push(secondPokemon);

    Logic.performSwitch(state, 'p1', 1);

    expect(state.p1.active.name).toBe('Salamence');
    expect(state.p1.active.boosts.atk).toBe(0); // boosts reset
    expect(state.p1.teamSlot).toBe(1);
  });

  test('syncs previous active HP back to team', () => {
    const state = makeState({ currentHP: 150, maxHP: 300 });
    const secondPokemon = makePokemon({ name: 'Salamence' });
    state.p1.team.push(secondPokemon);

    Logic.performSwitch(state, 'p1', 1);

    expect(state.p1.team[0].currentHP).toBe(150);
  });

  test('applies entry hazards on switch-in', () => {
    const state = makeState();
    state.sides.p1.stealthRock = true;
    const secondPokemon = makePokemon({ name: 'Charizard', types: ['Fire', 'Flying'], currentHP: 300, maxHP: 300 });
    state.p1.team.push(secondPokemon);

    const effects = Logic.performSwitch(state, 'p1', 1);

    // Charizard is 4x weak to Rock, SR deals 50% = 150 damage
    expect(state.p1.active.currentHP).toBe(300 - Math.floor(300 * 4 / 8));
    expect(effects.length).toBeGreaterThan(0);
  });

  test('switch-in with Spikes', () => {
    const state = makeState();
    state.sides.p1.spikes = 2;
    const secondPokemon = makePokemon({ name: 'Metagross', types: ['Steel', 'Psychic'], currentHP: 300, maxHP: 300 });
    state.p1.team.push(secondPokemon);

    Logic.performSwitch(state, 'p1', 1);

    expect(state.p1.active.currentHP).toBe(300 - Math.max(1, Math.floor(300 / 6)));
  });
});

// ---------------------------------------------------------------------------
// Integration: Status + Weather + Items in single end-of-turn
// ---------------------------------------------------------------------------
describe('end-of-turn integration', () => {
  test('Toxic + Sandstorm + Leftovers all apply', () => {
    const state = makeState(
      {
        currentHP: 300, maxHP: 300,
        status: 'Badly Poisoned', toxicCounter: 1,
        types: ['Fire'],
        item: 'Leftovers'
      },
      null,
      { weather: 'Sand' }
    );

    Logic.applyEndOfTurnEffects(state, 3);

    const toxDamage = Math.max(1, Math.floor(300 / 16));
    const sandDamage = Math.max(1, Math.floor(300 / 16));
    const leftoverHeal = Math.max(1, Math.floor(300 / 16));
    const expected = 300 - toxDamage - sandDamage + leftoverHeal;
    expect(state.p1.active.currentHP).toBe(expected);
  });

  test('Poison + Black Sludge on non-Poison type both damage', () => {
    const state = makeState({
      currentHP: 300, maxHP: 300,
      status: 'Poisoned', types: ['Water'],
      item: 'Black Sludge'
    });

    Logic.applyEndOfTurnEffects(state, 3);

    const poisonDamage = Math.max(1, Math.floor(300 / 8));
    const sludgeDamage = Math.max(1, Math.floor(300 / 8));
    expect(state.p1.active.currentHP).toBe(300 - poisonDamage - sludgeDamage);
  });
});

// ---------------------------------------------------------------------------
// scoreAISwitchIn
// ---------------------------------------------------------------------------
describe('scoreAISwitchIn', () => {
  function makeParams(overrides) {
    return Object.assign({
      candidateName: 'Gardevoir',
      candidateSpeed: 80,
      candidateHP: 150,
      playerSpeed: 100,
      playerHP: 120,
      bestAIMoveDamage: 60,
      bestAIMovePct: 50,
      bestPlayerMoveDamage: 40,
      bestPlayerMovePct: 26
    }, overrides);
  }

  test('Ditto always scores 2 regardless of stats', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateName: 'Ditto',
      candidateSpeed: 1,
      candidateHP: 1,
      bestAIMoveDamage: 0,
      bestAIMovePct: 0
    }));
    expect(result.score).toBe(2);
    expect(result.reason).toContain('Ditto');
  });

  test('Wynaut scores 2 when faster or equal', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateName: 'Wynaut',
      candidateSpeed: 100,
      candidateHP: 200
    }));
    expect(result.score).toBe(2);
    expect(result.reason).toContain('trapper');
  });

  test('Wobbuffet scores 0 when slower and OHKO\'d', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateName: 'Wobbuffet',
      candidateSpeed: 50,
      candidateHP: 100,
      playerSpeed: 100,
      bestPlayerMoveDamage: 150
    }));
    expect(result.score).toBe(0);
    expect(result.reason).toContain('slower');
  });

  test('Wobbuffet scores 2 when slower but not OHKO\'d', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateName: 'Wobbuffet',
      candidateSpeed: 50,
      candidateHP: 200,
      playerSpeed: 100,
      bestPlayerMoveDamage: 50
    }));
    expect(result.score).toBe(2);
  });

  test('Score 5: faster + OHKOs player', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 120,
      playerSpeed: 100,
      playerHP: 100,
      bestAIMoveDamage: 100
    }));
    expect(result.score).toBe(5);
    expect(result.reason).toContain('faster');
    expect(result.reason).toContain('OHKO');
  });

  test('Score 4: slower but OHKOs player, not OHKO\'d itself', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 80,
      candidateHP: 200,
      playerSpeed: 100,
      playerHP: 100,
      bestAIMoveDamage: 100,
      bestPlayerMoveDamage: 50
    }));
    expect(result.score).toBe(4);
    expect(result.reason).toContain('slower');
  });

  test('Score 3: faster + deals better damage%', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 120,
      playerSpeed: 100,
      playerHP: 200,
      bestAIMoveDamage: 80,
      bestAIMovePct: 40,
      bestPlayerMoveDamage: 30,
      bestPlayerMovePct: 20
    }));
    expect(result.score).toBe(3);
    expect(result.reason).toContain('faster');
    expect(result.reason).toContain('better damage');
  });

  test('Score 2: slower but deals better damage%', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 80,
      playerSpeed: 100,
      playerHP: 200,
      bestAIMoveDamage: 80,
      bestAIMovePct: 40,
      bestPlayerMoveDamage: 30,
      bestPlayerMovePct: 20
    }));
    expect(result.score).toBe(2);
    expect(result.reason).toContain('slower');
    expect(result.reason).toContain('better damage');
  });

  test('Score 1: faster but worse damage%', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 120,
      playerSpeed: 100,
      bestAIMovePct: 15,
      bestPlayerMovePct: 40,
      bestAIMoveDamage: 20,
      bestPlayerMoveDamage: 30,
      playerHP: 200,
      candidateHP: 200
    }));
    expect(result.score).toBe(1);
    expect(result.reason).toContain('faster');
    expect(result.reason).toContain('worse damage');
  });

  test('Score -1: slower and OHKO\'d by player', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 50,
      candidateHP: 100,
      playerSpeed: 120,
      bestAIMoveDamage: 20,
      bestAIMovePct: 10,
      bestPlayerMoveDamage: 100,
      bestPlayerMovePct: 100
    }));
    expect(result.score).toBe(-1);
    expect(result.reason).toContain('slower');
    expect(result.reason).toContain('OHKO');
  });

  test('Score 0: slower, worse damage%, not OHKO\'d', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 50,
      candidateHP: 200,
      playerSpeed: 120,
      bestAIMoveDamage: 20,
      bestAIMovePct: 10,
      bestPlayerMoveDamage: 50,
      bestPlayerMovePct: 25
    }));
    expect(result.score).toBe(0);
    expect(result.reason).toBe('default');
  });

  test('edge: equal speed is not "faster" for general scoring', () => {
    const result = Logic.scoreAISwitchIn(makeParams({
      candidateSpeed: 100,
      playerSpeed: 100,
      bestAIMovePct: 80,
      bestPlayerMovePct: 20,
      bestAIMoveDamage: 50,
      bestPlayerMoveDamage: 20,
      playerHP: 100,
      candidateHP: 200
    }));
    // Equal speed: aiIsFaster is false, but aiDealsBetterPct is true => score 2
    expect(result.score).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// predictAISwitchIn
// ---------------------------------------------------------------------------
describe('predictAISwitchIn', () => {
  function makeTeamMember(name, hp, speed, maxHP) {
    return makePokemon({
      name: name,
      currentHP: hp,
      maxHP: maxHP || hp,
      stats: { atk: 100, def: 80, spa: 100, spd: 80, spe: speed },
      moves: ['Tackle']
    });
  }

  test('returns null when no team provided', () => {
    const result = Logic.predictAISwitchIn(makeTeamMember('Pikachu', 100, 90), null, 0, 3, null);
    expect(result).toBeNull();
  });

  test('returns null when no alive candidates remain', () => {
    const fainted1 = makeTeamMember('Pikachu', 0, 90);
    const fainted2 = makeTeamMember('Raichu', 0, 100);
    const result = Logic.predictAISwitchIn(
      makeTeamMember('Gardevoir', 100, 80),
      [fainted1, fainted2],
      0,
      3,
      () => 0
    );
    expect(result).toBeNull();
  });

  test('returns only option when single candidate alive', () => {
    const active = makeTeamMember('Fainted', 0, 50);
    const alive = makeTeamMember('Pikachu', 100, 90);
    const result = Logic.predictAISwitchIn(
      makeTeamMember('Gardevoir', 100, 80),
      [active, alive],
      0,
      3,
      () => 0
    );
    expect(result).not.toBeNull();
    expect(result.slot).toBe(1);
    expect(result.pokemon.name).toBe('Pikachu');
    expect(result.reason).toBe('only option');
  });

  test('picks highest score candidate', () => {
    const fainted = makeTeamMember('Fainted', 0, 50);
    const slow = makeTeamMember('Slowpoke', 200, 15, 200);
    const fast = makeTeamMember('Jolteon', 200, 130, 200);

    const playerActive = makeTeamMember('Gardevoir', 100, 80, 100);

    const mockCalc = (attacker, defender) => {
      if (attacker.name === 'Jolteon') return 120; // OHKOs player
      if (attacker.name === 'Slowpoke') return 30;
      if (attacker.name === 'Gardevoir') return 40;
      return 0;
    };

    const result = Logic.predictAISwitchIn(
      playerActive,
      [fainted, slow, fast],
      0,
      3,
      mockCalc
    );

    expect(result).not.toBeNull();
    expect(result.pokemon.name).toBe('Jolteon');
    expect(result.score).toBe(5); // faster + OHKO
  });

  test('skips the fainted slot', () => {
    const mon0 = makeTeamMember('Pikachu', 100, 90);
    const mon1 = makeTeamMember('Raichu', 100, 100);
    const mon2 = makeTeamMember('Jolteon', 100, 130);

    const result = Logic.predictAISwitchIn(
      makeTeamMember('Gardevoir', 100, 80, 100),
      [mon0, mon1, mon2],
      1, // slot 1 fainted
      3,
      () => 50
    );

    expect(result).not.toBeNull();
    expect(result.slot).not.toBe(1);
  });

  test('Ditto in team always gets score 2', () => {
    const fainted = makeTeamMember('Fainted', 0, 50);
    const ditto = makeTeamMember('Ditto', 100, 48, 100);
    const weak = makeTeamMember('Magikarp', 100, 80, 100);

    const mockCalc = (attacker, defender) => {
      if (attacker.name === 'Magikarp') return 5;
      return 0;
    };

    const result = Logic.predictAISwitchIn(
      makeTeamMember('Gardevoir', 100, 80, 100),
      [fainted, ditto, weak],
      0,
      3,
      mockCalc
    );

    expect(result).not.toBeNull();
    // Ditto gets 2, Magikarp likely gets 0 or -1
    expect(result.pokemon.name).toBe('Ditto');
    expect(result.score).toBe(2);
  });

  test('tie-breaking: first in team order wins', () => {
    const fainted = makeTeamMember('Fainted', 0, 50);
    const mon1 = makeTeamMember('Pikachu', 100, 90, 100);
    const mon2 = makeTeamMember('Raichu', 100, 90, 100);

    const result = Logic.predictAISwitchIn(
      makeTeamMember('Gardevoir', 100, 80, 100),
      [fainted, mon1, mon2],
      0,
      3,
      () => 50
    );

    expect(result).not.toBeNull();
    // Both should have the same score; first in order (index 1) wins
    expect(result.slot).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkFlinch
// ---------------------------------------------------------------------------
describe('checkFlinch', () => {
  function makeMoveWithFlinch(chance) {
    return {
      secondary: { volatileStatus: 'flinch', chance: chance }
    };
  }

  function makeAttacker(overrides) {
    return Object.assign({ ability: '', turnsOnField: 0 }, overrides);
  }

  function makeDefender(overrides) {
    return Object.assign({ ability: '' }, overrides);
  }

  test('returns no flinch for moves without flinch effect', () => {
    const result = Logic.checkFlinch({ secondary: null }, makeAttacker(), makeDefender(), 'Tackle');
    expect(result.flinches).toBe(false);
    expect(result.chance).toBe(0);
  });

  test('Fake Out causes guaranteed flinch on first turn', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(100), makeAttacker({ turnsOnField: 0 }), makeDefender(), 'Fake Out');
    expect(result.flinches).toBe(true);
    expect(result.isGuaranteed).toBe(true);
    expect(result.chance).toBe(1);
  });

  test('Fake Out fails on second turn (turnsOnField=1)', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(100), makeAttacker({ turnsOnField: 1 }), makeDefender(), 'Fake Out');
    expect(result.flinches).toBe(false);
    expect(result.reason).toContain('fails after first turn');
  });

  test('Fake Out works for just-switched-in Pokemon (turnsOnField=-1)', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(100), makeAttacker({ turnsOnField: -1 }), makeDefender(), 'Fake Out');
    expect(result.flinches).toBe(true);
    expect(result.isGuaranteed).toBe(true);
  });

  test('Rock Slide has 30% flinch chance', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(30), makeAttacker(), makeDefender(), 'Rock Slide');
    expect(result.flinches).toBe(true);
    expect(result.chance).toBe(0.3);
    expect(result.isGuaranteed).toBe(false);
  });

  test('Inner Focus blocks flinch', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(100), makeAttacker(), makeDefender({ ability: 'Inner Focus' }), 'Fake Out');
    expect(result.flinches).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('Inner Focus');
  });

  test('Serene Grace doubles flinch chance', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(30), makeAttacker({ ability: 'Serene Grace' }), makeDefender(), 'Iron Head');
    expect(result.flinches).toBe(true);
    expect(result.chance).toBe(0.6);
  });

  test('Serene Grace makes 60% flinch guaranteed at 100%+ cap', () => {
    // Use a fictitious move name so MoveDB falls back to raw moveData
    const result = Logic.checkFlinch(makeMoveWithFlinch(50), makeAttacker({ ability: 'Serene Grace' }), makeDefender(), 'FlinchTestMove');
    expect(result.flinches).toBe(true);
    expect(result.chance).toBe(1);
    expect(result.isGuaranteed).toBe(true);
  });

  test('no flinch data returns default result', () => {
    const result = Logic.checkFlinch({}, makeAttacker(), makeDefender(), 'Thunderbolt');
    expect(result.flinches).toBe(false);
  });

  test('null moveData returns default result', () => {
    const result = Logic.checkFlinch(null, makeAttacker(), makeDefender(), 'Splash');
    expect(result.flinches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// simulateHPAfterDamage
// ---------------------------------------------------------------------------
describe('simulateHPAfterDamage', () => {
  test('normal damage reduces HP', () => {
    const result = Logic.simulateHPAfterDamage(100, 100, 30, '');
    expect(result.hp).toBe(70);
    expect(result.fainted).toBe(false);
  });

  test('lethal damage causes faint', () => {
    const result = Logic.simulateHPAfterDamage(50, 100, 60, '');
    expect(result.hp).toBe(0);
    expect(result.fainted).toBe(true);
  });

  test('Focus Sash saves at full HP', () => {
    const result = Logic.simulateHPAfterDamage(100, 100, 200, 'Focus Sash');
    expect(result.hp).toBe(1);
    expect(result.fainted).toBe(false);
    expect(result.itemConsumed).toBe(true);
  });

  test('Focus Sash does not activate at non-full HP', () => {
    const result = Logic.simulateHPAfterDamage(99, 100, 200, 'Focus Sash');
    expect(result.hp).toBe(0);
    expect(result.fainted).toBe(true);
    expect(result.itemConsumed).toBe(false);
  });

  test('Sitrus Berry triggers at 50% or below', () => {
    const result = Logic.simulateHPAfterDamage(80, 100, 40, 'Sitrus Berry');
    expect(result.hp).toBe(65); // 80 - 40 = 40, then +25
    expect(result.itemConsumed).toBe(true);
  });

  test('Sitrus Berry does not trigger above 50%', () => {
    const result = Logic.simulateHPAfterDamage(80, 100, 20, 'Sitrus Berry');
    expect(result.hp).toBe(60); // 80 - 20 = 60, which is >50%
    expect(result.itemConsumed).toBe(false);
  });

  test('Oran Berry triggers at 50% or below', () => {
    const result = Logic.simulateHPAfterDamage(40, 80, 10, 'Oran Berry');
    expect(result.hp).toBe(40); // 40 - 10 = 30, then +10 = 40
    expect(result.itemConsumed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectMeaningfulVariance
// ---------------------------------------------------------------------------
describe('detectMeaningfulVariance', () => {
  test('returns null when min === max', () => {
    const result = Logic.detectMeaningfulVariance({ currentHP: 100, maxHP: 100, item: '' }, 50, 50);
    expect(result).toBeNull();
  });

  test('detects KO difference', () => {
    const result = Logic.detectMeaningfulVariance(
      { currentHP: 55, maxHP: 100, item: '' },
      50, 60
    );
    expect(result).not.toBeNull();
    expect(result.reason).toContain('KO');
    expect(result.minResult.fainted).toBe(false);
    expect(result.maxResult.fainted).toBe(true);
  });

  test('detects berry trigger difference', () => {
    const result = Logic.detectMeaningfulVariance(
      { currentHP: 60, maxHP: 100, item: 'Sitrus Berry' },
      8, 12
    );
    // 60-8=52 (>50%, no berry), 60-12=48 (<=50%, berry triggers +25=73)
    expect(result).not.toBeNull();
    expect(result.reason).toContain('Sitrus Berry');
    expect(result.minResult.itemConsumed).toBe(false);
    expect(result.maxResult.itemConsumed).toBe(true);
  });

  test('returns null for insignificant variance', () => {
    const result = Logic.detectMeaningfulVariance(
      { currentHP: 200, maxHP: 200, item: '' },
      50, 55
    );
    // 5 HP difference out of 200 = 2.5%, below 15% threshold
    expect(result).toBeNull();
  });

  test('detects large HP variance (>15%)', () => {
    const result = Logic.detectMeaningfulVariance(
      { currentHP: 100, maxHP: 100, item: '' },
      10, 30
    );
    // 20 HP difference = 20%
    expect(result).not.toBeNull();
    expect(result.reason).toContain('20%');
  });

  test('Focus Sash difference between min and max roll', () => {
    const result = Logic.detectMeaningfulVariance(
      { currentHP: 100, maxHP: 100, item: 'Focus Sash' },
      90, 110
    );
    // min: 100-90=10 (survives normally), max: Focus Sash saves to 1
    expect(result).not.toBeNull();
    expect(result.maxResult.itemConsumed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// turnsOnField tracking
// ---------------------------------------------------------------------------
describe('turnsOnField tracking', () => {
  test('performSwitch resets turnsOnField to -1', () => {
    const state = makeState(
      { name: 'Pikachu', turnsOnField: 3 },
      { name: 'Raichu' }
    );
    state.p1.team = [
      makePokemon({ name: 'Pikachu', currentHP: 100, maxHP: 100 }),
      makePokemon({ name: 'Charizard', currentHP: 100, maxHP: 100, turnsOnField: 5 })
    ];
    state.p1.teamSlot = 0;

    Logic.performSwitch(state, 'p1', 1);
    expect(state.p1.active.turnsOnField).toBe(-1);
  });

  test('applyEndOfTurnEffects increments turnsOnField', () => {
    const state = makeState(
      { name: 'Pikachu', turnsOnField: 0 },
      { name: 'Raichu', turnsOnField: 2 }
    );

    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.turnsOnField).toBe(1);
    expect(state.p2.active.turnsOnField).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AI Move Scoring Engine
// ---------------------------------------------------------------------------
describe('scoreAIMoves', () => {
  // Mock RBDex for AI scoring tests
  const moveDB = {
    flamethrower: { name: 'Flamethrower', basePower: 90, type: 'Fire', category: 'Special', accuracy: 100, pp: 15 },
    thunderbolt: { name: 'Thunderbolt', basePower: 90, type: 'Electric', category: 'Special', accuracy: 100, pp: 15 },
    icebeam: { name: 'Ice Beam', basePower: 90, type: 'Ice', category: 'Special', accuracy: 100, pp: 10 },
    tackle: { name: 'Tackle', basePower: 40, type: 'Normal', category: 'Physical', accuracy: 100, pp: 35 },
    fakeout: { name: 'Fake Out', basePower: 40, type: 'Normal', category: 'Physical', accuracy: 100, pp: 10, priority: 3,
      secondary: { chance: 100, volatileStatus: 'flinch' } },
    stealthrock: { name: 'Stealth Rock', basePower: 0, type: 'Rock', category: 'Status', pp: 20 },
    swordsdance: { name: 'Swords Dance', basePower: 0, type: 'Normal', category: 'Status', pp: 20 },
    protect: { name: 'Protect', basePower: 0, type: 'Normal', category: 'Status', pp: 10 },
    recover: { name: 'Recover', basePower: 0, type: 'Normal', category: 'Status', pp: 10 },
    dragondance: { name: 'Dragon Dance', basePower: 0, type: 'Dragon', category: 'Status', pp: 20 },
    thunderwave: { name: 'Thunder Wave', basePower: 0, type: 'Electric', category: 'Status', pp: 20 },
    willowisp: { name: 'Will-O-Wisp', basePower: 0, type: 'Fire', category: 'Status', pp: 15 },
    tailwind: { name: 'Tailwind', basePower: 0, type: 'Flying', category: 'Status', pp: 15 },
    explosion: { name: 'Explosion', basePower: 250, type: 'Normal', category: 'Physical', accuracy: 100, pp: 5 },
    agility: { name: 'Agility', basePower: 0, type: 'Psychic', category: 'Status', pp: 30 },
    spore: { name: 'Spore', basePower: 0, type: 'Grass', category: 'Status', accuracy: 100, pp: 15 },
    toxic: { name: 'Toxic', basePower: 0, type: 'Poison', category: 'Status', accuracy: 90, pp: 10 },
    aquajet: { name: 'Aqua Jet', basePower: 40, type: 'Water', category: 'Physical', accuracy: 100, pp: 20, priority: 1 },
    lowsweep: { name: 'Low Sweep', basePower: 65, type: 'Fighting', category: 'Physical', accuracy: 100, pp: 20 },
  };

  let origRBDex;
  beforeAll(() => {
    origRBDex = global.window ? global.window.RBDex : undefined;
    if (!global.window) global.window = {};
    global.window.RBDex = {
      getMove: (name) => {
        if (!name) return null;
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return moveDB[id] || null;
      },
      getMoveDesc: () => '',
      getItemDesc: () => '',
      getAbilityDesc: () => '',
    };
  });
  afterAll(() => {
    if (origRBDex !== undefined) global.window.RBDex = origRBDex;
    else if (global.window) delete global.window.RBDex;
  });

  function makeAIMon(overrides) {
    return makePokemon({
      name: 'AIMon', currentHP: 100, maxHP: 100,
      moves: ['Flamethrower', 'Thunderbolt', 'Ice Beam', 'Tackle'],
      stats: { hp: 100, atk: 80, def: 80, spa: 120, spd: 80, spe: 100 },
      turnsOnField: 0, ability: '', item: '', boosts: {},
      ...overrides,
    });
  }

  function makePlayerMon(overrides) {
    return makePokemon({
      name: 'PlayerMon', currentHP: 100, maxHP: 100,
      moves: ['Tackle'],
      stats: { hp: 100, atk: 80, def: 80, spa: 80, spd: 80, spe: 90 },
      turnsOnField: 0, ability: '', item: '', boosts: {},
      ...overrides,
    });
  }

  function makeScoreState(overrides) {
    const s = makeState(makeAIMon(), makePlayerMon());
    s.sides = { p1: {}, p2: {} };
    if (overrides) Object.assign(s, overrides);
    return s;
  }

  // Simple damage calc mock: returns fixed values based on move name
  function mockCalc(attacker, defender, moveName) {
    const md = moveDB[(moveName || '').toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (!md || md.category === 'Status') return null;
    const bp = md.basePower || 0;
    return { min: Math.floor(bp * 0.8), max: bp };
  }

  test('highest damage move gets +6', () => {
    const ai = makeAIMon();
    const player = makePlayerMon({ currentHP: 200, maxHP: 200 });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    // Flamethrower/Tbolt/IceBeam all do 90 max, Tackle does 40
    const tbolt = scores.find(s => s.moveName === 'Thunderbolt');
    const tackle = scores.find(s => s.moveName === 'Tackle');
    expect(tbolt.score).toBe(6);
    expect(tackle.score).toBe(0);
  });

  test('kill bonus: +6 for faster kill', () => {
    const ai = makeAIMon({ stats: { hp:100,atk:80,def:80,spa:120,spd:80,spe:100 } });
    const player = makePlayerMon({ currentHP: 50, maxHP: 100, stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:80 } });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    // Flamethrower max=90 >= 50 HP → kills. AI spe=100 > player spe=80 → faster → +6+6=12
    const ft = scores.find(s => s.moveName === 'Flamethrower');
    expect(ft.score).toBe(12);
  });

  test('kill bonus: +3 for slower kill', () => {
    const ai = makeAIMon({ stats: { hp:100,atk:80,def:80,spa:120,spd:80,spe:50 } });
    const player = makePlayerMon({ currentHP: 50, maxHP: 100 });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    // AI spe=50 < player spe=90 → slower → +6+3=9
    const ft = scores.find(s => s.moveName === 'Flamethrower');
    expect(ft.score).toBe(9);
  });

  test('Fake Out gets +9 on first turn', () => {
    const ai = makeAIMon({ moves: ['Fake Out', 'Tackle'], turnsOnField: 0 });
    const player = makePlayerMon();
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const fo = scores.find(s => s.moveName === 'Fake Out');
    expect(fo.score).toBe(9);
  });

  test('Fake Out gets -20 after first turn', () => {
    const ai = makeAIMon({ moves: ['Fake Out', 'Tackle'], turnsOnField: 1 });
    const player = makePlayerMon();
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const fo = scores.find(s => s.moveName === 'Fake Out');
    expect(fo.score).toBe(-20);
  });

  test('Fake Out blocked by Inner Focus → -20', () => {
    const ai = makeAIMon({ moves: ['Fake Out', 'Tackle'], turnsOnField: 0 });
    const player = makePlayerMon({ ability: 'Inner Focus' });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const fo = scores.find(s => s.moveName === 'Fake Out');
    expect(fo.score).toBe(-20);
  });

  test('Stealth Rock scores +9 on first turn', () => {
    const ai = makeAIMon({ moves: ['Stealth Rock', 'Flamethrower'], turnsOnField: 0 });
    const player = makePlayerMon({ currentHP: 200, maxHP: 200 });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const sr = scores.find(s => s.moveName === 'Stealth Rock');
    expect(sr.score).toBe(9);
  });

  test('Stealth Rock scores -20 when already set', () => {
    const ai = makeAIMon({ moves: ['Stealth Rock', 'Flamethrower'] });
    const player = makePlayerMon({ currentHP: 200, maxHP: 200 });
    const state = makeScoreState();
    state.sides = { p1: { stealthRock: true }, p2: {} };
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const sr = scores.find(s => s.moveName === 'Stealth Rock');
    expect(sr.score).toBe(-20);
  });

  test('setup move gets -20 when player can KO (no Sturdy/Sash)', () => {
    const ai = makeAIMon({ moves: ['Swords Dance', 'Tackle'], stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:50 } });
    const player = makePlayerMon({ moves: ['Flamethrower'] });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    // Player Flamethrower: max=90 >= AI HP 100? No. Let's make AI HP lower.
    ai.currentHP = 80;
    const scores = Logic.scoreAIMoves(ai, player, state, (atk, def, mn) => {
      const md2 = moveDB[(mn||'').toLowerCase().replace(/[^a-z0-9]/g,'')];
      if (!md2 || md2.category === 'Status') return null;
      return { min: 70, max: 90 };
    });
    const sd = scores.find(s => s.moveName === 'Swords Dance');
    expect(sd.score).toBe(-20);
  });

  test('Dragon Dance base +6 when safe', () => {
    const ai = makeAIMon({ moves: ['Dragon Dance', 'Flamethrower'], turnsOnField: 1 });
    const player = makePlayerMon({ currentHP: 200, maxHP: 200, moves: ['Tackle'] });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, (a,d,mn) => {
      const md3 = moveDB[(mn||'').toLowerCase().replace(/[^a-z0-9]/g,'')];
      if (!md3 || md3.category === 'Status') return null;
      return { min: 10, max: 20 };
    });
    const dd = scores.find(s => s.moveName === 'Dragon Dance');
    expect(dd.score).toBe(6);
  });

  test('priority move gets +11 when AI dying and slower', () => {
    const ai = makeAIMon({
      moves: ['Aqua Jet', 'Tackle'],
      currentHP: 50, maxHP: 100,
      stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:50 },
    });
    const player = makePlayerMon({
      moves: ['Flamethrower'],
      stats: { hp:100,atk:80,def:80,spa:120,spd:80,spe:100 },
    });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, (atk, def, mn) => {
      const md4 = moveDB[(mn||'').toLowerCase().replace(/[^a-z0-9]/g,'')];
      if (!md4 || md4.category === 'Status') return null;
      if (mn === 'Flamethrower') return { min: 60, max: 80 };
      return { min: 20, max: 30 };
    });
    const aj = scores.find(s => s.moveName === 'Aqua Jet');
    // Player Flamethrower max=80 >= AI HP=50 → player can KO
    // Aqua Jet: priority, AI slower. +11 for priority dying+slow
    expect(aj.score).toBeGreaterThanOrEqual(11);
  });

  test('Protect base +6, -1 on first turn', () => {
    const ai = makeAIMon({ moves: ['Protect', 'Tackle'], turnsOnField: 0 });
    const player = makePlayerMon();
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const prot = scores.find(s => s.moveName === 'Protect');
    expect(prot.score).toBe(5); // 6 - 1 for first turn
  });

  test('Tailwind +9 when AI is slower', () => {
    const ai = makeAIMon({ moves: ['Tailwind', 'Tackle'], stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:50 } });
    const player = makePlayerMon();
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const tw = scores.find(s => s.moveName === 'Tailwind');
    expect(tw.score).toBe(9);
  });

  test('Agility -20 when already faster', () => {
    const ai = makeAIMon({ moves: ['Agility', 'Tackle'] });
    const player = makePlayerMon({ stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:50 } });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const agi = scores.find(s => s.moveName === 'Agility');
    expect(agi.score).toBe(-20);
  });

  test('Thunder Wave +8 when it causes speed flip', () => {
    const ai = makeAIMon({
      moves: ['Thunder Wave', 'Flamethrower'],
      stats: { hp:100,atk:80,def:80,spa:120,spd:80,spe:60 },
    });
    const player = makePlayerMon({
      stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:80 },
      types: ['Normal'],
    });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    // AI spe=60 < player spe=80 → AI slower
    // After para: player spe = 80/4 = 20 < 60 → speed flip!
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const tw = scores.find(s => s.moveName === 'Thunder Wave');
    expect(tw.score).toBe(8);
  });

  test('Explosion +10 when AI at <10% HP', () => {
    const ai = makeAIMon({ moves: ['Explosion', 'Tackle'], currentHP: 5, maxHP: 100 });
    const player = makePlayerMon({ types: ['Normal'] });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    state.p2.team = [ai, makePokemon({ name: 'Backup', currentHP: 100, maxHP: 100 })];
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const boom = scores.find(s => s.moveName === 'Explosion');
    expect(boom.score).toBe(10);
  });

  test('Recovery +7 when AI is low HP and should recover', () => {
    const ai = makeAIMon({ moves: ['Recover', 'Tackle'], currentHP: 30, maxHP: 100 });
    const player = makePlayerMon({ moves: ['Tackle'] });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, (a,d,mn) => {
      const md5 = moveDB[(mn||'').toLowerCase().replace(/[^a-z0-9]/g,'')];
      if (!md5 || md5.category === 'Status') return null;
      return { min: 15, max: 25 };
    });
    const rec = scores.find(s => s.moveName === 'Recover');
    expect(rec.score).toBe(7);
  });

  test('Recovery -20 when at full HP', () => {
    const ai = makeAIMon({ moves: ['Recover', 'Tackle'], currentHP: 100, maxHP: 100 });
    const player = makePlayerMon();
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, mockCalc);
    const rec = scores.find(s => s.moveName === 'Recover');
    expect(rec.score).toBe(-20);
  });

  test('Speed reduction move +6 when AI is slower', () => {
    const ai = makeAIMon({ moves: ['Low Sweep', 'Flamethrower'], stats: { hp:100,atk:80,def:80,spa:120,spd:80,spe:50 } });
    const player = makePlayerMon({ currentHP: 200, maxHP: 200 });
    const state = makeScoreState();
    state.p2.active = ai; state.p1.active = player;
    const scores = Logic.scoreAIMoves(ai, player, state, (a,d,mn) => {
      const mid2 = (mn||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      if (mid2 === 'flamethrower') return { min: 72, max: 90 };
      if (mid2 === 'lowsweep') return { min: 30, max: 50 };
      return null;
    });
    const ls = scores.find(s => s.moveName === 'Low Sweep');
    expect(ls.score).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// predictAISwitchIn — allScores
// ---------------------------------------------------------------------------
describe('predictAISwitchIn allScores', () => {
  test('returns allScores array with scores for every candidate', () => {
    const player = makePokemon({ name: 'Pikachu', stats: { hp:100,atk:55,def:40,spa:50,spd:50,spe:90 }, currentHP:100, maxHP:100 });
    const team = [
      makePokemon({ name: 'Fainted', currentHP:0, maxHP:100 }),
      makePokemon({ name: 'Mon1', stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:100 }, currentHP:100, maxHP:100 }),
      makePokemon({ name: 'Mon2', stats: { hp:120,atk:90,def:70,spa:70,spd:70,spe:50 }, currentHP:120, maxHP:120 })
    ];
    const result = Logic.predictAISwitchIn(player, team, 0, null, () => 40);
    expect(result).not.toBeNull();
    expect(result.allScores).toBeDefined();
    expect(result.allScores.length).toBe(2);
    expect(result.allScores[0].name).toBeDefined();
    expect(result.allScores[0].score).toBeGreaterThanOrEqual(result.allScores[1].score);
  });

  test('single candidate returns allScores with one entry', () => {
    const player = makePokemon({ name: 'Pikachu', stats: { hp:100,atk:55,def:40,spa:50,spd:50,spe:90 }, currentHP:100, maxHP:100 });
    const team = [
      makePokemon({ name: 'Fainted', currentHP:0, maxHP:100 }),
      makePokemon({ name: 'OnlyOption', stats: { hp:100,atk:80,def:80,spa:80,spd:80,spe:100 }, currentHP:100, maxHP:100 })
    ];
    const result = Logic.predictAISwitchIn(player, team, 0, null, () => 40);
    expect(result).not.toBeNull();
    expect(result.allScores.length).toBe(1);
    expect(result.allScores[0].reason).toBe('only option');
  });
});

// ---------------------------------------------------------------------------
// Fake Out turnsOnField tracking across turns
// ---------------------------------------------------------------------------
describe('Fake Out multi-turn enforcement', () => {
  test('turnsOnField increments in endOfTurnEffects', () => {
    const state = makeState();
    state.p1.active.turnsOnField = 0;
    state.p2.active.turnsOnField = 0;
    Logic.applyEndOfTurnEffects(state, null);
    expect(state.p1.active.turnsOnField).toBe(1);
    expect(state.p2.active.turnsOnField).toBe(1);
  });

  test('performSwitch sets turnsOnField to -1', () => {
    const state = makeState();
    state.p1.team.push(makePokemon({ name: 'Backup', currentHP: 100, maxHP: 100 }));
    Logic.performSwitch(state, 'p1', 1);
    expect(state.p1.active.turnsOnField).toBe(-1);
  });

  test('Fake Out flinches when turnsOnField is 0 (first turn)', () => {
    const moveData = { secondary: { chance: 100, volatileStatus: 'flinch' } };
    const attacker = makePokemon({ name: 'Ambipom', turnsOnField: 0 });
    const defender = makePokemon({ name: 'Target' });
    const result = Logic.checkFlinch(moveData, attacker, defender, 'Fake Out');
    expect(result.flinches).toBe(true);
    expect(result.isGuaranteed).toBe(true);
  });

  test('Fake Out fails when turnsOnField is 1 (second turn)', () => {
    const moveData = { secondary: { chance: 100, volatileStatus: 'flinch' } };
    const attacker = makePokemon({ name: 'Ambipom', turnsOnField: 1 });
    const defender = makePokemon({ name: 'Target' });
    const result = Logic.checkFlinch(moveData, attacker, defender, 'Fake Out');
    expect(result.flinches).toBe(false);
  });

  test('Fake Out works after switch-in (-1 → EOT → 0)', () => {
    const state = makeState();
    state.p1.team.push(makePokemon({ name: 'Switchee', currentHP: 100, maxHP: 100 }));
    Logic.performSwitch(state, 'p1', 1);
    expect(state.p1.active.turnsOnField).toBe(-1);
    Logic.applyEndOfTurnEffects(state, null);
    expect(state.p1.active.turnsOnField).toBe(0);
    // Now on the next turn, turnsOnField is 0 → Fake Out should work
    const moveData = { secondary: { chance: 100, volatileStatus: 'flinch' } };
    const result = Logic.checkFlinch(moveData, state.p1.active, state.p2.active, 'Fake Out');
    expect(result.flinches).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Poison Heal
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - Poison Heal', () => {
  test('Poison Heal recovers 1/8 HP when poisoned', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, status: 'Poisoned', ability: 'Poison Heal' });
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 8)));
    expect(effects).toContainEqual(expect.stringContaining('Poison Heal'));
  });

  test('Poison Heal recovers 1/8 HP when badly poisoned', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, status: 'Badly Poisoned', ability: 'Poison Heal', toxicCounter: 1 });
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 8)));
    expect(effects).toContainEqual(expect.stringContaining('Poison Heal'));
  });

  test('Poison Heal does not over-heal', () => {
    const state = makeState({ currentHP: 320, maxHP: 320, status: 'Poisoned', ability: 'Poison Heal' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(320);
  });

  test('Poison Heal still increments toxic counter', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, status: 'Badly Poisoned', ability: 'Poison Heal', toxicCounter: 3 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.toxicCounter).toBe(4);
  });

  test('burn still damages with Poison Heal (only affects poison)', () => {
    const state = makeState({ currentHP: 320, maxHP: 320, status: 'Burned', ability: 'Poison Heal' });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBeLessThan(320);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Weather ability healing
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - weather ability healing', () => {
  test('Rain Dish heals 1/16 in Rain', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Rain Dish' },
      null,
      { weather: 'Rain' }
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 16)));
    expect(effects).toContainEqual(expect.stringContaining('Rain Dish'));
  });

  test('Rain Dish does not heal in Sun', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Rain Dish' },
      null,
      { weather: 'Sun' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });

  test('Dry Skin heals 1/8 in Rain', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Dry Skin' },
      null,
      { weather: 'Rain' }
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 8)));
    expect(effects).toContainEqual(expect.stringContaining('Dry Skin'));
  });

  test('Dry Skin takes 1/8 damage in Sun', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Dry Skin' },
      null,
      { weather: 'Sun' }
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 - Math.max(1, Math.floor(320 / 8)));
    expect(effects).toContainEqual(expect.stringContaining('Dry Skin'));
  });

  test('Dry Skin sun damage can faint', () => {
    const state = makeState(
      { currentHP: 1, maxHP: 320, ability: 'Dry Skin' },
      null,
      { weather: 'Sun' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(0);
    expect(state.p1.active.hasFainted).toBe(true);
  });

  test('Ice Body heals 1/16 in Hail', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Ice Body', types: ['Ice'] },
      null,
      { weather: 'Hail' }
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + Math.max(1, Math.floor(320 / 16)));
    expect(effects).toContainEqual(expect.stringContaining('Ice Body'));
  });

  test('Ice Body does not heal in other weather', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Ice Body', types: ['Ice'] },
      null,
      { weather: 'Rain' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Volatile status effects
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - volatile status effects', () => {
  test('Leech Seed drains 1/8 from target and heals user', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { leechseed: true } },
      { currentHP: 200, maxHP: 340 }
    );
    const drain = Math.max(1, Math.floor(320 / 8));
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 - drain);
    expect(state.p2.active.currentHP).toBe(200 + drain);
    expect(effects).toContainEqual(expect.stringContaining('Leech Seed'));
  });

  test('Leech Seed does not over-heal the draining side', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { leechseed: true } },
      { currentHP: 340, maxHP: 340 }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p2.active.currentHP).toBe(340); // already full
  });

  test('Magic Guard blocks Leech Seed damage', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { leechseed: true }, ability: 'Magic Guard' },
      { currentHP: 200, maxHP: 340 }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });

  test('Curse deals 1/4 maxHP damage', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { curse: true } }
    );
    const curseDamage = Math.max(1, Math.floor(320 / 4));
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 - curseDamage);
    expect(effects).toContainEqual(expect.stringContaining('Curse'));
  });

  test('Curse can faint a Pokemon', () => {
    const state = makeState(
      { currentHP: 10, maxHP: 320, volatiles: { curse: true } }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(0);
    expect(state.p1.active.hasFainted).toBe(true);
  });

  test('Magic Guard blocks Curse damage', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { curse: true }, ability: 'Magic Guard' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });

  test('Aqua Ring heals 1/16 maxHP', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { aquaring: true } }
    );
    const heal = Math.max(1, Math.floor(320 / 16));
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + heal);
    expect(effects).toContainEqual(expect.stringContaining('Aqua Ring'));
  });

  test('Ingrain heals 1/16 maxHP', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, volatiles: { ingrain: true } }
    );
    const heal = Math.max(1, Math.floor(320 / 16));
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + heal);
    expect(effects).toContainEqual(expect.stringContaining('Ingrain'));
  });

  test('Aqua Ring and Ingrain do not over-heal', () => {
    const state = makeState(
      { currentHP: 320, maxHP: 320, volatiles: { aquaring: true, ingrain: true } }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(320);
  });

  test('no volatile effects when volatiles is empty', () => {
    const state = makeState({ currentHP: 200, maxHP: 320, volatiles: {} });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Grassy Terrain healing
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - Grassy Terrain healing', () => {
  test('grounded Pokemon heals 1/16 from Grassy Terrain', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320 },
      null,
      { terrain: 'Grassy' }
    );
    const heal = Math.max(1, Math.floor(320 / 16));
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200 + heal);
    expect(effects).toContainEqual(expect.stringContaining('Grassy Terrain'));
  });

  test('Flying types do not get Grassy Terrain healing', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, types: ['Flying'] },
      null,
      { terrain: 'Grassy' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });

  test('Levitate users do not get Grassy Terrain healing', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320, ability: 'Levitate' },
      null,
      { terrain: 'Grassy' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });

  test('does not heal at full HP', () => {
    const state = makeState(
      { currentHP: 320, maxHP: 320 },
      null,
      { terrain: 'Grassy' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(320);
  });

  test('no healing when terrain is not Grassy', () => {
    const state = makeState(
      { currentHP: 200, maxHP: 320 },
      null,
      { terrain: 'Electric' }
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Terrain turn decay
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - terrain turn decay', () => {
  test('terrain turns decrement and expire', () => {
    const state = makeState(null, null, { terrain: 'Grassy', terrainTurns: 1 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.field.terrain).toBe('None');
    expect(state.field.terrainTurns).toBe(0);
  });

  test('terrain persists when turns remain', () => {
    const state = makeState(null, null, { terrain: 'Electric', terrainTurns: 3 });
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.field.terrain).toBe('Electric');
    expect(state.field.terrainTurns).toBe(2);
  });

  test('terrain fading generates effect message', () => {
    const state = makeState(null, null, { terrain: 'Psychic', terrainTurns: 1 });
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(effects).toContainEqual(expect.stringContaining('terrain faded'));
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Flame Orb / Toxic Orb activation
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - Flame Orb / Toxic Orb', () => {
  test('Flame Orb burns a Pokemon with no status', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, item: 'Flame Orb', status: '' },
      null
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.status).toBe('brn');
    expect(effects).toContainEqual(expect.stringContaining('burned by its Flame Orb'));
  });

  test('Flame Orb does not burn if already statused', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, item: 'Flame Orb', status: 'psn' },
      null
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.status).toBe('psn');
  });

  test('Toxic Orb badly poisons a Pokemon with no status', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, item: 'Toxic Orb', status: '' },
      null
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.status).toBe('tox');
    expect(state.p1.active.toxicCounter).toBe(1);
    expect(effects).toContainEqual(expect.stringContaining('badly poisoned by its Toxic Orb'));
  });

  test('Toxic Orb does not poison if already statused', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300, item: 'Toxic Orb', status: 'brn' },
      null
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.status).toBe('brn');
  });

  test('Flame Orb does not activate on fainted Pokemon', () => {
    const state = makeState(
      { currentHP: 0, maxHP: 300, item: 'Flame Orb', status: '' },
      null
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.status).toBe('');
  });

  test('p2 Toxic Orb activates correctly', () => {
    const state = makeState(
      null,
      { currentHP: 340, maxHP: 340, item: 'Toxic Orb', status: '' }
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p2.active.status).toBe('tox');
    expect(effects).toContainEqual(expect.stringContaining('Toxic Orb'));
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnEffects - Pinch berry healing
// ---------------------------------------------------------------------------
describe('applyEndOfTurnEffects - Pinch berries', () => {
  const pinchBerries = ['Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry'];

  pinchBerries.forEach(berry => {
    test(`${berry} heals at ≤25% HP`, () => {
      // 300 maxHP, 25% = 75, set currentHP to 74 (below threshold)
      const state = makeState(
        { currentHP: 74, maxHP: 300, item: berry },
        null
      );
      const effects = Logic.applyEndOfTurnEffects(state, 3);
      const expectedHeal = Math.floor(300 / 3); // 100
      expect(state.p1.active.currentHP).toBe(74 + expectedHeal);
      expect(state.p1.active.item).toBe('');
      expect(effects).toContainEqual(expect.stringContaining(berry));
    });
  });

  test('Figy Berry does NOT heal above 25% HP', () => {
    // 25% of 300 = 75, set to 76 (above threshold)
    const state = makeState(
      { currentHP: 76, maxHP: 300, item: 'Figy Berry' },
      null
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(76);
    expect(state.p1.active.item).toBe('Figy Berry');
  });

  test('Figy Berry heals exactly at 25% HP', () => {
    // 25% of 300 = 75
    const state = makeState(
      { currentHP: 75, maxHP: 300, item: 'Figy Berry' },
      null
    );
    const effects = Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(75 + Math.floor(300 / 3));
    expect(state.p1.active.item).toBe('');
    expect(effects).toContainEqual(expect.stringContaining('Figy Berry'));
  });

  test('Pinch berry does not overheal past maxHP', () => {
    // maxHP 120, 25% = 30, heal = floor(120/3) = 40
    // currentHP 30, should cap at min(120, 30+40) = 70
    const state = makeState(
      { currentHP: 30, maxHP: 120, item: 'Aguav Berry' },
      null
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.currentHP).toBe(70);
  });

  test('Pinch berry consumed on fainted Pokemon does not trigger', () => {
    const state = makeState(
      { currentHP: 0, maxHP: 300, item: 'Figy Berry' },
      null
    );
    Logic.applyEndOfTurnEffects(state, 3);
    expect(state.p1.active.item).toBe('Figy Berry');
  });
});

// ---------------------------------------------------------------------------
// simulateHPAfterDamage - Focus Band
// ---------------------------------------------------------------------------
describe('simulateHPAfterDamage - Focus Band', () => {
  test('Focus Band survives lethal damage with 1 HP', () => {
    const result = Logic.simulateHPAfterDamage(100, 100, 200, 'Focus Band');
    expect(result.hp).toBe(1);
    expect(result.fainted).toBe(false);
    expect(result.itemConsumed).toBe(false); // Focus Band is not consumed
  });

  test('Focus Band survives exact lethal damage', () => {
    const result = Logic.simulateHPAfterDamage(50, 100, 50, 'Focus Band');
    expect(result.hp).toBe(1);
    expect(result.fainted).toBe(false);
  });

  test('Focus Band does not trigger on non-lethal damage', () => {
    const result = Logic.simulateHPAfterDamage(100, 100, 30, 'Focus Band');
    expect(result.hp).toBe(70);
    expect(result.fainted).toBe(false);
  });

  test('Focus Band works when not at full HP', () => {
    const result = Logic.simulateHPAfterDamage(50, 100, 80, 'Focus Band');
    expect(result.hp).toBe(1);
    expect(result.fainted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// simulateHPAfterDamage - Pinch berries
// ---------------------------------------------------------------------------
describe('simulateHPAfterDamage - Pinch berries', () => {
  test('Figy Berry triggers at ≤25% HP after damage', () => {
    // 400 maxHP, take 350 damage: 50 HP left = 12.5%, trigger berry
    // heal = floor(400/3) = 133
    const result = Logic.simulateHPAfterDamage(400, 400, 350, 'Figy Berry');
    expect(result.hp).toBe(50 + 133);
    expect(result.itemConsumed).toBe(true);
  });

  test('Wiki Berry does not trigger above 25% HP', () => {
    // 400 maxHP, take 200 damage: 200 HP left = 50%, no trigger
    const result = Logic.simulateHPAfterDamage(400, 400, 200, 'Wiki Berry');
    expect(result.hp).toBe(200);
    expect(result.itemConsumed).toBe(false);
  });

  test('Mago Berry triggers at exactly 25% HP', () => {
    // 400 maxHP, take 300 damage: 100 HP left = 25%, trigger
    const result = Logic.simulateHPAfterDamage(400, 400, 300, 'Mago Berry');
    expect(result.hp).toBe(100 + Math.floor(400 / 3));
    expect(result.itemConsumed).toBe(true);
  });

  test('Pinch berry does not trigger if KOd', () => {
    const result = Logic.simulateHPAfterDamage(100, 400, 100, 'Iapapa Berry');
    expect(result.hp).toBe(0);
    expect(result.fainted).toBe(true);
    expect(result.itemConsumed).toBe(false);
  });

  test('Aguav Berry does not overheal', () => {
    // 120 maxHP, currently at 120, take 100: 20 HP = 16.7%, trigger
    // heal = floor(120/3) = 40, result = min(120, 20+40) = 60
    const result = Logic.simulateHPAfterDamage(120, 120, 100, 'Aguav Berry');
    expect(result.hp).toBe(60);
    expect(result.itemConsumed).toBe(true);
  });
});
