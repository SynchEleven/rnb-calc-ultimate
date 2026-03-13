/**
 * Tests for calc_integration.js - Calculator Bridge
 *
 * Covers: type effectiveness, accuracy, crit chance, status move effects,
 *         secondary effects, item effects, damage ranges, outcome calculation,
 *         state application, KO chance, format helpers.
 */
const { setupBattlePlanner, setupCalcIntegration, createDefaultCalcMock, makePokemon, makeState } = require('./setup');

let BP, CI, calcMock;

beforeAll(() => {
  BP = setupBattlePlanner();
  calcMock = createDefaultCalcMock();
  CI = setupCalcIntegration(calcMock);
});

// ---------------------------------------------------------------------------
// Type Effectiveness
// ---------------------------------------------------------------------------
describe('getTypeEffectiveness', () => {
  test('Fire is super effective against Grass', () => {
    expect(CI.getTypeEffectiveness('Fire', ['Grass'])).toBe(2);
  });

  test('Water is not very effective against Water', () => {
    expect(CI.getTypeEffectiveness('Water', ['Water'])).toBe(0.5);
  });

  test('Ground is immune to Electric', () => {
    expect(CI.getTypeEffectiveness('Electric', ['Ground'])).toBe(0);
  });

  test('Normal is immune to Ghost', () => {
    expect(CI.getTypeEffectiveness('Fighting', ['Ghost'])).toBe(0);
  });

  test('dual-type multiplier multiplies both', () => {
    // Fire vs Grass/Steel = 2 * 2 = 4x
    expect(CI.getTypeEffectiveness('Fire', ['Grass', 'Steel'])).toBe(4);
  });

  test('dual-type neutralisation', () => {
    // Fire vs Water/Grass = 0.5 * 2 = 1x
    expect(CI.getTypeEffectiveness('Fire', ['Water', 'Grass'])).toBe(1);
  });

  test('dual-type immunity overrides', () => {
    // Electric vs Ground/Flying = 0 (Ground immune)
    expect(CI.getTypeEffectiveness('Electric', ['Ground', 'Flying'])).toBe(0);
  });

  test('returns 1 for unknown types', () => {
    expect(CI.getTypeEffectiveness('Fire', ['???'])).toBe(1);
  });

  test('returns 1 for null/empty inputs', () => {
    expect(CI.getTypeEffectiveness(null, ['Water'])).toBe(1);
    expect(CI.getTypeEffectiveness('Fire', [])).toBe(1);
    expect(CI.getTypeEffectiveness('Fire', null)).toBe(1);
  });

  test('Dragon is immune to Fairy', () => {
    expect(CI.getTypeEffectiveness('Dragon', ['Fairy'])).toBe(0);
  });

  test('Fairy is super effective against Dragon', () => {
    expect(CI.getTypeEffectiveness('Fairy', ['Dragon'])).toBe(2);
  });

  test('Poison is super effective against Fairy', () => {
    expect(CI.getTypeEffectiveness('Poison', ['Fairy'])).toBe(2);
  });

  test('Steel is immune to Poison', () => {
    expect(CI.getTypeEffectiveness('Poison', ['Steel'])).toBe(0);
  });
});

describe('getEffectivenessLabel', () => {
  test('labels immune correctly', () => {
    expect(CI.getEffectivenessLabel(0).label).toBe('Immune');
  });

  test('labels super effective correctly', () => {
    expect(CI.getEffectivenessLabel(2).label).toBe('Super Effective');
    expect(CI.getEffectivenessLabel(4).label).toBe('Super Effective');
  });

  test('labels not very effective correctly', () => {
    expect(CI.getEffectivenessLabel(0.5).label).toBe('Not Very Effective');
    expect(CI.getEffectivenessLabel(0.25).label).toBe('Not Very Effective');
  });

  test('labels neutral correctly', () => {
    expect(CI.getEffectivenessLabel(1).label).toBe('Neutral');
  });
});

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------
describe('getAccuracy', () => {
  test('returns 100 for accuracy === true (never-miss moves)', () => {
    expect(CI.getAccuracy({ accuracy: true }, {}, {}, {}, 3)).toBe(100);
  });

  test('returns base accuracy unchanged when no modifiers', () => {
    expect(CI.getAccuracy({ accuracy: 85 }, {}, {}, {}, 3)).toBe(85);
  });

  test('No Guard makes everything 100%', () => {
    expect(CI.getAccuracy({ accuracy: 50 }, { ability: 'No Guard' }, {}, {}, 3)).toBe(100);
    expect(CI.getAccuracy({ accuracy: 50 }, {}, { ability: 'No Guard' }, {}, 3)).toBe(100);
  });

  test('Compound Eyes boosts by 1.3x', () => {
    expect(CI.getAccuracy({ accuracy: 70 }, { ability: 'Compound Eyes' }, {}, {}, 3)).toBe(91);
  });

  test('Hustle reduces physical accuracy by 0.8x', () => {
    expect(CI.getAccuracy({ accuracy: 100, category: 'Physical' }, { ability: 'Hustle' }, {}, {}, 3)).toBe(80);
  });

  test('Hustle does not affect special moves', () => {
    expect(CI.getAccuracy({ accuracy: 100, category: 'Special' }, { ability: 'Hustle' }, {}, {}, 3)).toBe(100);
  });

  test('Wide Lens boosts by 1.1x', () => {
    expect(CI.getAccuracy({ accuracy: 80 }, { item: 'Wide Lens' }, {}, {}, 3)).toBe(88);
  });

  test('Thunder is 100% in Rain', () => {
    expect(CI.getAccuracy({ accuracy: 70, name: 'Thunder' }, {}, {}, { weather: 'Rain' }, 3)).toBe(100);
  });

  test('Thunder is 50% in Sun', () => {
    expect(CI.getAccuracy({ accuracy: 70, name: 'Thunder' }, {}, {}, { weather: 'Sun' }, 3)).toBe(50);
  });

  test('Hurricane is 100% in Rain', () => {
    expect(CI.getAccuracy({ accuracy: 70, name: 'Hurricane' }, {}, {}, { weather: 'Rain' }, 3)).toBe(100);
  });

  test('Blizzard is 100% in Hail', () => {
    expect(CI.getAccuracy({ accuracy: 70, name: 'Blizzard' }, {}, {}, { weather: 'Hail' }, 3)).toBe(100);
  });

  test('Blizzard is 100% in Snow', () => {
    expect(CI.getAccuracy({ accuracy: 70, name: 'Blizzard' }, {}, {}, { weather: 'Snow' }, 3)).toBe(100);
  });

  test('Gravity boosts accuracy (5/3x)', () => {
    expect(CI.getAccuracy({ accuracy: 60 }, {}, {}, { isGravity: true }, 3)).toBe(100);
  });

  test('accuracy is capped at 100', () => {
    expect(CI.getAccuracy({ accuracy: 90 }, { ability: 'Compound Eyes', item: 'Wide Lens' }, {}, {}, 3)).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Crit Chance
// ---------------------------------------------------------------------------
describe('getCritChance', () => {
  test('always-crit moves return 1', () => {
    expect(CI.getCritChance({ name: 'Storm Throw' }, {}, {}, {}, 3)).toBe(1);
    expect(CI.getCritChance({ name: 'Frost Breath' }, {}, {}, {}, 3)).toBe(1);
  });

  test('Battle Armor blocks crits', () => {
    expect(CI.getCritChance({ name: 'Slash' }, {}, { ability: 'Battle Armor' }, {}, 3)).toBe(0);
  });

  test('Shell Armor blocks crits', () => {
    expect(CI.getCritChance({ name: 'Slash' }, {}, { ability: 'Shell Armor' }, {}, 3)).toBe(0);
  });

  test('high-crit moves increase crit stage', () => {
    const normalCrit = CI.getCritChance({ name: 'Tackle' }, {}, {}, {}, { num: 3 });
    const highCrit = CI.getCritChance({ name: 'Slash' }, {}, {}, {}, { num: 3 });
    expect(highCrit).toBeGreaterThan(normalCrit);
  });

  test('Scope Lens increases crit stage', () => {
    const withoutLens = CI.getCritChance({ name: 'Tackle' }, {}, {}, {}, { num: 3 });
    const withLens = CI.getCritChance({ name: 'Tackle' }, { item: 'Scope Lens' }, {}, {}, { num: 3 });
    expect(withLens).toBeGreaterThan(withoutLens);
  });

  test('Super Luck increases crit stage', () => {
    const withoutLuck = CI.getCritChance({ name: 'Tackle' }, {}, {}, {}, { num: 3 });
    const withLuck = CI.getCritChance({ name: 'Tackle' }, { ability: 'Super Luck' }, {}, {}, { num: 3 });
    expect(withLuck).toBeGreaterThan(withoutLuck);
  });

  test('gen 3 base crit rate is 1/16', () => {
    expect(CI.getCritChance({ name: 'Tackle' }, {}, {}, {}, { num: 3 })).toBeCloseTo(1 / 16);
  });

  test('gen 7+ base crit rate is 1/24', () => {
    expect(CI.getCritChance({ name: 'Tackle' }, {}, {}, {}, { num: 7 })).toBeCloseTo(1 / 24);
  });

  test('returns 0 for null move', () => {
    expect(CI.getCritChance(null, {}, {}, {}, 3)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Status Move Effects
// ---------------------------------------------------------------------------
describe('getStatusMoveEffects', () => {
  test('Thunder Wave inflicts paralysis', () => {
    const fx = CI.getStatusMoveEffects('Thunder Wave', {});
    expect(fx.targetStatus).toBe('par');
  });

  test('Toxic inflicts bad poison', () => {
    const fx = CI.getStatusMoveEffects('Toxic', {});
    expect(fx.targetStatus).toBe('tox');
  });

  test('Swords Dance gives +2 Atk', () => {
    const fx = CI.getStatusMoveEffects('Swords Dance', {});
    expect(fx.selfBoosts.atk).toBe(2);
  });

  test('Dragon Dance gives +1 Atk and +1 Spe', () => {
    const fx = CI.getStatusMoveEffects('Dragon Dance', {});
    expect(fx.selfBoosts.atk).toBe(1);
    expect(fx.selfBoosts.spe).toBe(1);
  });

  test('Shell Smash boosts and lowers correctly', () => {
    const fx = CI.getStatusMoveEffects('Shell Smash', {});
    expect(fx.selfBoosts.atk).toBe(2);
    expect(fx.selfBoosts.spa).toBe(2);
    expect(fx.selfBoosts.spe).toBe(2);
    expect(fx.selfBoosts.def).toBe(-1);
    expect(fx.selfBoosts.spd).toBe(-1);
  });

  test('Screech lowers defense by 2', () => {
    const fx = CI.getStatusMoveEffects('Screech', {});
    expect(fx.targetBoosts.def).toBe(-2);
  });

  test('Stealth Rock sets hazard', () => {
    const fx = CI.getStatusMoveEffects('Stealth Rock', {});
    expect(fx.hazards).toBeTruthy();
    expect(fx.hazards.hazard).toBe('stealthRock');
  });

  test('Reflect sets a screen', () => {
    const fx = CI.getStatusMoveEffects('Reflect', {});
    expect(fx.screens).toBeTruthy();
    expect(fx.screens.screen).toBe('reflect');
    expect(fx.screens.turns).toBe(5);
  });

  test('Rain Dance sets weather', () => {
    const fx = CI.getStatusMoveEffects('Rain Dance', {});
    expect(fx.weather.weather).toBe('Rain');
    expect(fx.weather.turns).toBe(5);
  });

  test('Recover heals 50%', () => {
    const fx = CI.getStatusMoveEffects('Recover', {});
    expect(fx.heal).toBe(0.5);
  });

  test('Rest heals 100% and sets sleep', () => {
    const fx = CI.getStatusMoveEffects('Rest', {});
    expect(fx.heal).toBe(1);
    expect(fx.selfStatus).toBe('slp');
  });

  test('unknown move returns empty effects', () => {
    const fx = CI.getStatusMoveEffects('MadeUpMove', {});
    expect(fx.targetStatus).toBeNull();
    expect(fx.heal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Secondary Effects
// ---------------------------------------------------------------------------
describe('getSecondaryEffects', () => {
  test('Thunderbolt has 10% paralysis chance', () => {
    const effects = CI.getSecondaryEffects({ name: 'Thunderbolt' });
    expect(effects).toHaveLength(1);
    expect(effects[0].status).toBe('par');
    expect(effects[0].chance).toBe(0.1);
  });

  test('Scald has 30% burn chance', () => {
    const effects = CI.getSecondaryEffects({ name: 'Scald' });
    expect(effects[0].status).toBe('brn');
    expect(effects[0].chance).toBe(0.3);
  });

  test('Rock Slide has 30% flinch', () => {
    const effects = CI.getSecondaryEffects({ name: 'Rock Slide' });
    expect(effects[0].flinch).toBe(true);
    expect(effects[0].chance).toBe(0.3);
  });

  test('Close Combat has self stat drops', () => {
    const effects = CI.getSecondaryEffects({ name: 'Close Combat' });
    expect(effects[0].selfBoost.def).toBe(-1);
    expect(effects[0].selfBoost.spd).toBe(-1);
  });

  test('Shadow Ball has 20% SpD drop on target', () => {
    const effects = CI.getSecondaryEffects({ name: 'Shadow Ball' });
    expect(effects[0].targetBoost.spd).toBe(-1);
    expect(effects[0].chance).toBe(0.2);
  });

  test('unknown move has no secondary effects', () => {
    expect(CI.getSecondaryEffects({ name: 'Tackle' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Item Effects
// ---------------------------------------------------------------------------
describe('applyItemEffects', () => {
  test('Focus Sash saves from OHKO at full HP', () => {
    const p = makePokemon({ currentHP: 300, maxHP: 300, item: 'Focus Sash' });
    const fx = CI.applyItemEffects(p, 400);
    expect(fx.itemConsumed).toBe(true);
    expect(fx.healed).toBe(1); // applyDamage clamps to 0, then heal 1 → 1 HP
  });

  test('Focus Sash does not trigger if not at full HP', () => {
    const p = makePokemon({ currentHP: 299, maxHP: 300, item: 'Focus Sash' });
    const fx = CI.applyItemEffects(p, 400);
    expect(fx.itemConsumed).toBe(false);
  });

  test('Oran Berry heals 10 HP when crossing 50%', () => {
    const p = makePokemon({ currentHP: 200, maxHP: 300, item: 'Oran Berry' });
    const fx = CI.applyItemEffects(p, 60); // drops to 140/300 = 46.6%
    expect(fx.healed).toBe(10);
    expect(fx.itemConsumed).toBe(true);
  });

  test('Oran Berry does not trigger if already below 50%', () => {
    const p = makePokemon({ currentHP: 100, maxHP: 300, item: 'Oran Berry' });
    const fx = CI.applyItemEffects(p, 10);
    expect(fx.itemConsumed).toBe(false);
  });

  test('Sitrus Berry heals 25% when HP crosses below 50%', () => {
    // currentHP must be strictly above 50% before damage for the crossing check
    const p = makePokemon({ currentHP: 210, maxHP: 400, item: 'Sitrus Berry' });
    const fx = CI.applyItemEffects(p, 20); // 210 → 190, crosses from 52.5% to 47.5%
    expect(fx.healed).toBe(100);
    expect(fx.itemConsumed).toBe(true);
  });

  test('Leftovers sets endOfTurnHeal', () => {
    const p = makePokemon({ currentHP: 200, maxHP: 320, item: 'Leftovers' });
    const fx = CI.applyItemEffects(p, 0);
    expect(fx.endOfTurnHeal).toBe(Math.floor(320 / 16));
  });

  test('Black Sludge heals Poison types', () => {
    const p = makePokemon({ currentHP: 200, maxHP: 320, item: 'Black Sludge', types: ['Poison'] });
    const fx = CI.applyItemEffects(p, 0);
    expect(fx.endOfTurnHeal).toBe(Math.floor(320 / 16));
  });

  test('Black Sludge does not heal non-Poison types', () => {
    const p = makePokemon({ currentHP: 200, maxHP: 320, item: 'Black Sludge', types: ['Water'] });
    const fx = CI.applyItemEffects(p, 0);
    expect(fx.endOfTurnHeal).toBeUndefined();
  });

  test('no item returns empty effects', () => {
    const p = makePokemon({ item: '' });
    const fx = CI.applyItemEffects(p, 100);
    expect(fx.healed).toBe(0);
    expect(fx.itemConsumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Damage Range
// ---------------------------------------------------------------------------
describe('getDamageRange', () => {
  test('handles a single number', () => {
    const r = CI.getDamageRange({ damage: 150 });
    expect(r.min).toBe(150);
    expect(r.max).toBe(150);
    expect(r.avg).toBe(150);
  });

  test('handles a regular damage array (16 rolls)', () => {
    const rolls = [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175];
    const r = CI.getDamageRange({ damage: rolls });
    expect(r.min).toBe(100);
    expect(r.max).toBe(175);
    expect(r.avg).toBe(Math.floor(rolls.reduce((a, b) => a + b, 0) / 16));
  });

  test('handles Parental Bond nested arrays', () => {
    const r = CI.getDamageRange({ damage: [[50, 55, 60], [20, 25, 30]] });
    expect(r.min).toBe(70);  // 50 + 20
    expect(r.max).toBe(90);  // 60 + 30
  });

  test('returns zeros for null result', () => {
    const r = CI.getDamageRange(null);
    expect(r.min).toBe(0);
    expect(r.max).toBe(0);
    expect(r.avg).toBe(0);
  });

  test('returns zeros for empty array', () => {
    const r = CI.getDamageRange({ damage: [] });
    expect(r.min).toBe(0);
    expect(r.max).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// KO Chance
// ---------------------------------------------------------------------------
describe('calculateKOChance', () => {
  test('OHKO when damage >= HP', () => {
    const ko = CI.calculateKOChance(300, 250, 300);
    expect(ko.ohko).toBe(true);
  });

  test('2HKO when 2 hits would KO from full', () => {
    const ko = CI.calculateKOChance(160, 300, 300);
    expect(ko.twoHKO).toBe(true);
  });

  test('3HKO when 3 hits would KO from full', () => {
    const ko = CI.calculateKOChance(110, 300, 300);
    expect(ko.threeHKO).toBe(true);
  });

  test('reports correct hitsToKO for high-HP targets', () => {
    const ko = CI.calculateKOChance(50, 400, 400);
    expect(ko.hitsToKO).toBe(8);
  });

  test('reports Infinity for zero damage', () => {
    const ko = CI.calculateKOChance(0, 300, 300);
    expect(ko.hitsToKO).toBe(Infinity);
  });

  test('reports Already KO for 0 HP', () => {
    const ko = CI.calculateKOChance(100, 0, 300);
    expect(ko.ohko).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyOutcomeToState
// ---------------------------------------------------------------------------
describe('applyOutcomeToState', () => {
  test('applies damage to defender and increments turn', () => {
    const state = makeState(
      { currentHP: 300, maxHP: 300 },
      { currentHP: 300, maxHP: 300 }
    );
    const outcome = { damage: 120, damageDealt: 120, effects: {} };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);

    expect(newState.p2.active.currentHP).toBe(180);
    expect(newState.turnNumber).toBe(1);
    expect(state.p2.active.currentHP).toBe(300); // original unchanged
  });

  test('applies status move effects (paralysis)', () => {
    const state = makeState();
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: { targetStatus: 'par', selfBoosts: {}, targetBoosts: {} }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p2.active.status).toBe('Paralyzed');
  });

  test('applies self-boosts from status move', () => {
    const state = makeState();
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null,
          selfBoosts: { atk: 2 },
          targetBoosts: {}
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p1.active.boosts.atk).toBe(2);
  });

  test('applies target debuffs from status move', () => {
    const state = makeState();
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null,
          selfBoosts: {},
          targetBoosts: { def: -2 }
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p2.active.boosts.def).toBe(-2);
  });

  test('sets Stealth Rock on defender side', () => {
    const state = makeState();
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null, selfBoosts: {}, targetBoosts: {},
          hazards: { hazard: 'stealthRock', side: 'defender' }
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.sides.p2.stealthRock).toBe(true);
  });

  test('stacks Spikes up to 3 layers', () => {
    const state = makeState(null, null, null, { p2: { spikes: 2 } });
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null, selfBoosts: {}, targetBoosts: {},
          hazards: { hazard: 'spikes', side: 'defender' }
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.sides.p2.spikes).toBe(3);

    // Should not exceed 3
    const newState2 = CI.applyOutcomeToState(newState, outcome, 'p1', null);
    expect(newState2.sides.p2.spikes).toBe(3);
  });

  test('sets Reflect on attacker side with turn count', () => {
    const state = makeState();
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null, selfBoosts: {}, targetBoosts: {},
          screens: { screen: 'reflect', turns: 5 }
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.sides.p1.reflect).toBe(true);
    expect(newState.sides.p1.reflectTurns).toBe(5);
  });

  test('sets weather', () => {
    const state = makeState();
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null, selfBoosts: {}, targetBoosts: {},
          weather: { weather: 'Rain', turns: 5 }
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.field.weather).toBe('Rain');
    expect(newState.field.weatherTurns).toBe(5);
  });

  test('applies healing from heal move', () => {
    const state = makeState({ currentHP: 100, maxHP: 300 });
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: {
          targetStatus: null, selfBoosts: {}, targetBoosts: {},
          heal: 0.5
        }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p1.active.currentHP).toBe(250);
  });

  test('does not overwrite existing status', () => {
    const state = makeState(null, { status: 'Burned' });
    const outcome = {
      isStatusMove: true,
      effects: {
        statusEffects: { targetStatus: 'par', selfBoosts: {}, targetBoosts: {} }
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p2.active.status).toBe('Burned');
  });

  test('Focus Sash triggers on lethal damage from full HP', () => {
    const state = makeState(null, { currentHP: 300, maxHP: 300, item: 'Focus Sash' });
    const outcome = { damage: 500, damageDealt: 500, effects: {} };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p2.active.currentHP).toBe(1);
    expect(newState.p2.active.item).toBe('');
  });

  test('applies secondary effects (status on target)', () => {
    const state = makeState();
    const outcome = {
      damage: 100, damageDealt: 100,
      effects: {
        secondaryEffects: [{ status: 'brn' }]
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p2.active.status).toBe('Burned');
  });

  test('applies secondary self-boost effects', () => {
    const state = makeState();
    const outcome = {
      damage: 100, damageDealt: 100,
      effects: {
        secondaryEffects: [{ selfBoost: { spe: 1 } }]
      }
    };
    const newState = CI.applyOutcomeToState(state, outcome, 'p1', null);
    expect(newState.p1.active.boosts.spe).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isStatusMove
// ---------------------------------------------------------------------------
describe('isStatusMove', () => {
  test('returns true for Status category', () => {
    expect(CI.isStatusMove({ category: 'Status' })).toBe(true);
  });

  test('returns false for Physical category', () => {
    expect(CI.isStatusMove({ category: 'Physical' })).toBe(false);
  });

  test('returns false for null', () => {
    expect(CI.isStatusMove(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Format Helpers
// ---------------------------------------------------------------------------
describe('formatProbability', () => {
  test('formats 100% correctly', () => {
    expect(CI.formatProbability(1)).toBe('100%');
  });

  test('formats near-zero correctly', () => {
    expect(CI.formatProbability(0.0001)).toBe('<0.1%');
  });

  test('formats normal percentages', () => {
    expect(CI.formatProbability(0.875)).toBe('87.5%');
  });
});

describe('formatDamagePercent', () => {
  test('formats damage as percent of max HP', () => {
    expect(CI.formatDamagePercent(150, 300)).toBe('50.0%');
  });

  test('returns 0% for zero maxHP', () => {
    expect(CI.formatDamagePercent(100, 0)).toBe('0%');
  });
});
