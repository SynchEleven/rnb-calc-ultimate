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

  test('Fake Out still works on first acting turn (turnsOnField=1)', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(100), makeAttacker({ turnsOnField: 1 }), makeDefender(), 'Fake Out');
    expect(result.flinches).toBe(true);
    expect(result.isGuaranteed).toBe(true);
  });

  test('Fake Out fails after first turn (turnsOnField=2)', () => {
    const result = Logic.checkFlinch(makeMoveWithFlinch(100), makeAttacker({ turnsOnField: 2 }), makeDefender(), 'Fake Out');
    expect(result.flinches).toBe(false);
    expect(result.reason).toContain('fails after first turn');
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
  test('performSwitch resets turnsOnField to 0', () => {
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
    expect(state.p1.active.turnsOnField).toBe(0);
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
