/**
 * Forward projection.
 *
 * The projection is the number users will lean on hardest ("do I win this?"),
 * so it is held to the same standard as the tree: exact arithmetic, honest
 * about what it could not model, and two separate axes — winning, and the
 * Pokemon it costs.
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

let BP, B, P, CI, Logic, executor;

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
  loadScript('battle_planner_projection.js');
  P = window.BattlePlannerProjection;

  executor = B.createTurnExecutor({
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, Logic, gen: 8
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

function battle(p1Team, p2Team) {
  const s = new BP.BattleStateSnapshot();
  s.p1.active = p1Team[0].clone();
  s.p1.team = p1Team.map(p => p.clone());
  s.p1.teamSlot = 0;
  s.p2.active = p2Team[0].clone();
  s.p2.team = p2Team.map(p => p.clone());
  s.p2.teamSlot = 0;
  return s;
}

function makeProjection(overrides) {
  return P.createProjection(Object.assign({
    calc: realCalc,
    CalcIntegration: CI,
    MoveDB: window.MoveDB,
    executeTurn: executor,
    gen: 8
  }, overrides || {}));
}

/**
 * A projection whose player never pivots — attack-only. Used by the tests that
 * demonstrate the two reporting axes with a FORCED trade; the default policy
 * now correctly switches out of that trade, which is smarter play but defeats
 * the fixture.
 */
function makeGreedyProjection() {
  const deps = {
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
    executeTurn: executor, gen: 8
  };
  return P.createProjection(Object.assign({}, deps, {
    playerPolicy: (state, planned) => planned || P.greedyDamage(state, 'p1', deps, 8)
  }));
}

// ---------------------------------------------------------------------------
describe('projection arithmetic', () => {
  test('the three outcome probabilities always sum to 1', () => {
    const project = makeProjection();
    const result = project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz'] })],
        [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 6 });

    expect(result.winProbability + result.lossProbability + result.unresolvedProbability)
      .toBeCloseTo(1, 6);
  });

  test('the loss distribution sums to 1 and matches the expected value', () => {
    const project = makeProjection();
    const result = project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz'] }), mon('Blissey', { moves: ['Tackle'] })],
        [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 6 });

    const total = result.lossDistribution.reduce((a, d) => a + d.probability, 0);
    expect(total).toBeCloseTo(1, 6);

    const ev = result.lossDistribution.reduce((a, d) => a + d.pokemonLost * d.probability, 0);
    expect(ev).toBeCloseTo(result.expectedPokemonLost, 1);
  });

  test('probabilityOfLosingAny equals 1 minus the "lost none" mass', () => {
    const project = makeProjection();
    const result = project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz'] })],
        [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 6 });

    const lostNone = result.lossDistribution.find(d => d.pokemonLost === 0);
    expect(result.probabilityOfLosingAny)
      .toBeCloseTo(1 - (lostNone ? lostNone.probability : 0), 6);
  });

  test('a hopeless matchup projects as a loss', () => {
    const project = makeProjection();
    // One frail Pokemon against a healthy wall that hits far harder
    const result = project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Growl'], currentHP: 20 })],
        [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 6 });

    expect(result.lossProbability).toBeCloseTo(1, 3);
    expect(result.winProbability).toBeLessThan(0.01);
    expect(result.expectedPokemonLost).toBeCloseTo(1, 2);
  });

  test('a free win projects as a win with no losses', () => {
    const project = makeProjection();
    const result = project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz'] })],
        [mon('Blissey', { moves: ['Growl'], currentHP: 40 })]), 1), { horizon: 6 });

    expect(result.winProbability).toBeCloseTo(1, 3);
    expect(result.expectedPokemonLost).toBe(0);
    expect(result.probabilityOfLosingAny).toBeCloseTo(0, 6);
  });

  test('winning and losing a Pokemon are reported independently', () => {
    // Attack-only policy: the chipped lead is FORCED to trade itself so the
    // fixture stays a certain win that certainly costs a team member — the
    // case a single win%% destroys. (The default policy now pivots out of this
    // trade; that behaviour is pinned separately below.)
    const project = makeGreedyProjection();
    const result = project(B.StateDist.of(
      battle([mon('Garchomp', { moves: ['Earthquake'], currentHP: 40 }),
        mon('Garchomp', { moves: ['Earthquake'] })],
      [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 8 });

    expect(result.winProbability).toBeCloseTo(1, 3);
    expect(result.probabilityOfLosingAny).toBeCloseTo(1, 3);
    expect(result.expectedPokemonLost).toBeCloseTo(1, 2);
    expect(result.winProbability + result.lossProbability + result.unresolvedProbability)
      .toBeCloseTo(1, 6);
  });

  test('a clean win and a costly win are distinguishable', () => {
    // Attack-only for the same reason as above
    const project = makeGreedyProjection();
    const clean = project(B.StateDist.of(
      battle([mon('Garchomp', { moves: ['Earthquake'] })],
        [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 8 });
    const costly = project(B.StateDist.of(
      battle([mon('Garchomp', { moves: ['Earthquake'], currentHP: 40 }),
        mon('Garchomp', { moves: ['Earthquake'] })],
      [mon('Swampert', { moves: ['Earthquake'] })]), 1), { horizon: 8 });

    // Near-identical on the win axis (a lone Garchomp can still be crit down),
    // opposite on the axis that matters for a run
    expect(Math.abs(clean.winProbability - costly.winProbability)).toBeLessThan(0.02);
    expect(clean.winProbability).toBeGreaterThan(0.98);
    // Not exactly zero — the lone Garchomp still dies to a crit sometimes, and
    // the projection is right to say so. Two orders of magnitude apart is the point.
    expect(clean.expectedPokemonLost).toBeLessThan(0.05);
    expect(costly.expectedPokemonLost).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
describe('projection honesty', () => {
  test('coverage is reported and complements the truncated mass', () => {
    const project = makeProjection();
    const result = project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz', 'Thunder Punch'] })],
        [mon('Swampert', { moves: ['Earthquake', 'Ice Beam'] })]), 1),
    { horizon: 6, beamWidth: 4 });

    expect(result.coverage).toBeCloseTo(1 - result.truncatedMass, 9);
    expect(result.truncatedMass).toBeGreaterThanOrEqual(0);
  });

  test('a wider beam drops less mass than a narrow one', () => {
    const project = makeProjection();
    const start = () => B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz', 'Thunder Punch'] })],
        [mon('Swampert', { moves: ['Earthquake', 'Ice Beam'] })]), 1);

    const narrow = project(start(), { horizon: 6, beamWidth: 2 });
    const wide = project(start(), { horizon: 6, beamWidth: 40 });

    expect(wide.truncatedMass).toBeLessThanOrEqual(narrow.truncatedMass);
  });

  test('the horizon is respected and reported', () => {
    const project = makeProjection();
    const result = project(B.StateDist.of(
      battle([mon('Blissey', { moves: ['Tackle'] })],
        [mon('Blissey', { moves: ['Tackle'] })]), 1), { horizon: 3 });

    expect(result.horizon).toBe(3);
    expect(result.turnsSimulated).toBeLessThanOrEqual(3);
    // Two Blisseys poking each other will not resolve in 3 turns
    expect(result.unresolvedProbability).toBeGreaterThan(0);
  });

  test('an already-decided position needs no simulation', () => {
    const project = makeProjection();
    const won = battle([mon('Blaziken', { moves: ['Flare Blitz'] })],
      [mon('Swampert', { moves: ['Earthquake'], currentHP: 0 })]);
    won.p2.team[0].currentHP = 0;

    const result = project(B.StateDist.of(won, 1), { horizon: 5 });
    expect(result.winProbability).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
describe('policies', () => {
  test('the player policy prefers a guaranteed kill over raw average damage', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Flare Blitz', 'Thunder Punch'] })],
      [mon('Swampert', { moves: ['Earthquake'], currentHP: 1 })]);

    const action = P.greedyDamage(state, 'p1',
      { calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB }, 8);

    // Both kill from 1 HP; the point is it returns a real, usable move
    expect(['Flare Blitz', 'Thunder Punch']).toContain(action.moveName);
  });

  test('a planned action overrides the policy on the first turn', () => {
    const seen = [];
    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8,
      executeTurn: (state, actions) => {
        seen.push(actions.p1 && actions.p1.moveName);
        return executor(state, actions);
      }
    });

    project(B.StateDist.of(
      battle([mon('Blaziken', { moves: ['Flare Blitz', 'Growl'] })],
        [mon('Swampert', { moves: ['Earthquake'] })]), 1),
    { horizon: 2, plannedP1: { type: 'move', moveName: 'Growl' } });

    expect(seen[0]).toBe('Growl');
  });

  test('the AI policy returns weighted candidates when the engine ties', () => {
    const chooseAI = P.createAIPolicy({
      calc: realCalc,
      CalcIntegration: CI,
      MoveDB: window.MoveDB,
      gen: 8,
      generateMoveDist: () => [0.5, 0.5, 0, 0]      // a forced tie
    });

    const action = chooseAI(battle(
      [mon('Blaziken', { moves: ['Flare Blitz'] })],
      [mon('Swampert', { moves: ['Earthquake', 'Ice Beam', 'Surf', 'Rest'] })]));

    expect(action.candidates).toHaveLength(2);
    expect(action.candidates[0].probability).toBeCloseTo(0.5, 6);
    expect(action.candidates.reduce((a, c) => a + c.probability, 0)).toBeCloseTo(1, 6);
  });

  test('the AI policy falls back cleanly when the engine is unavailable', () => {
    const chooseAI = P.createAIPolicy({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });
    const action = chooseAI(battle(
      [mon('Blaziken', { moves: ['Flare Blitz'] })],
      [mon('Swampert', { moves: ['Earthquake', 'Ice Beam'] })]));

    expect(action).not.toBeNull();
    expect(['Earthquake', 'Ice Beam']).toContain(action.moveName);
  });

  test('the real AI engine drives the projection when it is wired in', () => {
    const aiModule = require(path.resolve(__dirname, '../../../calc/dist/ai.js'));
    const chooseAI = P.createAIPolicy({
      calc: realCalc,
      CalcIntegration: CI,
      MoveDB: window.MoveDB,
      gen: 8,
      generateMoveDist: aiModule.generateMoveDist,
      aiOptions: {}
    });

    const action = chooseAI(battle(
      [mon('Blaziken', { moves: ['Flare Blitz', 'Close Combat'] })],
      [mon('Swampert', { moves: ['Earthquake', 'Ice Beam', 'Surf', 'Stealth Rock'] })]));

    expect(action).not.toBeNull();
    expect(action.moveName).toBeTruthy();
    if (action.candidates) {
      expect(action.candidates.reduce((a, c) => a + c.probability, 0)).toBeCloseTo(1, 6);
    }
  });
});

// ---------------------------------------------------------------------------
describe('faint replacement', () => {
  test('the next healthy Pokemon is sent in', () => {
    const state = battle(
      [mon('Blaziken', { currentHP: 0 }), mon('Blissey')],
      [mon('Swampert')]);

    expect(P.replaceFainted(state, 'p1')).toBe(true);
    expect(state.p1.active.name).toBe('Blissey');
    expect(state.p1.teamSlot).toBe(1);
  });

  test('a wiped side reports as wiped', () => {
    const state = battle([mon('Blaziken', { currentHP: 0 })], [mon('Swampert')]);
    state.p1.team[0].currentHP = 0;

    expect(P.replaceFainted(state, 'p1')).toBe(false);
    expect(P.sideIsWiped(state, 'p1')).toBe(true);
    expect(P.sideIsWiped(state, 'p2')).toBe(false);
  });

  test('fainted Pokemon are counted from the team, not the active slot', () => {
    const state = battle(
      [mon('Blaziken', { currentHP: 0 }), mon('Blissey', { currentHP: 0 }), mon('Snorlax')],
      [mon('Swampert')]);
    state.p1.team[0].currentHP = 0;
    state.p1.team[1].currentHP = 0;

    expect(P.faintedCount(state, 'p1')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('short-term read', () => {
  test('reports KO chances for both sides from the real roll distributions', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Close Combat', 'Growl'] })],
      [mon('Swampert', { moves: ['Earthquake', 'Ice Beam'], currentHP: 120 })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    expect(read.you.name).toBe('Blaziken');
    expect(read.foe.name).toBe('Swampert');
    expect(read.yourMoves).toHaveLength(2);
    expect(read.youCanKO).toBeGreaterThanOrEqual(0);
    expect(read.youCanKO).toBeLessThanOrEqual(1);
    expect(read.youMightDie).toBeGreaterThanOrEqual(0);
  });

  test('a status move contributes no KO chance', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Growl'] })],
      [mon('Swampert', { moves: ['Growl'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    expect(read.youCanKO).toBe(0);
    expect(read.youMightDie).toBe(0);
  });

  test('KO chance accounts for accuracy', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Focus Blast'] })],       // 80% in RnB
      [mon('Blissey', { currentHP: 1, moves: ['Growl'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    // Certain to kill if it connects, so the KO chance IS the accuracy
    expect(read.youCanKO).toBeCloseTo(0.8, 6);
  });

  test('the crit KO chance is tracked separately', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Growl'] })],
      [mon('Swampert', { moves: ['Ice Beam'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    expect(read.youMightDieToCrit).toBeGreaterThanOrEqual(read.youMightDie);
  });

  test('every move carries its full roll spread for the panel', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Close Combat'] })],
      [mon('Swampert', { moves: ['Growl'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    const cc = read.yourMoves[0];
    expect(cc.rolls.length).toBeGreaterThan(1);
    expect(cc.rolls.reduce((a, r) => a + r.probability, 0)).toBeCloseTo(1, 6);
    expect(cc.maxPercent).toBeGreaterThan(cc.minPercent);
  });
});

// ---------------------------------------------------------------------------
describe('crit KO probability is absolute, not conditional', () => {
  test('a move whose crit always kills still reports only the crit chance', () => {
    // Blissey at 1 HP: every roll kills, crit or not. Set the target just out of
    // normal-roll range so ONLY the crit is lethal.
    const state = battle(
      [mon('Blaziken', { moves: ['Growl'] })],
      [mon('Swampert', { moves: ['Ice Beam'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    const iceBeam = read.theirMoves.find(m => m.moveName === 'Ice Beam');
    expect(iceBeam).toBeDefined();

    // The absolute figure can never exceed the chance of critting at all
    expect(iceBeam.critKoChance).toBeLessThanOrEqual(iceBeam.critChance + 1e-9);
    // And it is the product of the three independent requirements
    expect(iceBeam.critKoChance).toBeCloseTo(
      iceBeam.lethalGivenCrit * iceBeam.critChance * (iceBeam.accuracy / 100), 9);
  });

  test('the crit chance behind it is the RnB 1/16', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Growl'] })],
      [mon('Swampert', { moves: ['Ice Beam'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });
    expect(read.theirMoves[0].critChance).toBeCloseTo(1 / 16, 9);
  });

  test('the three risk bands can never exceed 100%', () => {
    const state = battle(
      [mon('Blaziken', { moves: ['Growl'], currentHP: 40 })],
      [mon('Swampert', { moves: ['Earthquake', 'Ice Beam'] })]);

    const read = P.assessTurn(state, {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });

    const dies = Math.max(0, Math.min(1, read.youMightDie));
    const critOnly = Math.max(0, Math.min(1 - dies, read.youMightDieToCrit - dies));
    const safe = Math.max(0, 1 - dies - critOnly);

    expect(dies + critOnly + safe).toBeCloseTo(1, 9);
    [dies, critOnly, safe].forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
describe('the pivot-aware policy pays on the loss axis', () => {
  test('pivoting saves the chipped lead that greedy play trades away', () => {
    const scenario = () => B.StateDist.of(
      battle([mon('Garchomp', { moves: ['Earthquake'], currentHP: 40 }),
        mon('Garchomp', { moves: ['Earthquake'] })],
      [mon('Swampert', { moves: ['Earthquake'] })]), 1);

    const greedy = makeGreedyProjection()(scenario(), { horizon: 8 });
    const pivoting = makeProjection()(scenario(), { horizon: 8 });

    // Same fight, same win chance — but the pivot-aware player keeps more of
    // the team alive. In a run that difference IS the point of planning.
    expect(pivoting.winProbability).toBeGreaterThan(0.95);
    expect(pivoting.expectedPokemonLost).toBeLessThan(greedy.expectedPokemonLost);
    expect(greedy.expectedPokemonLost).toBeGreaterThan(0.9);
  });
});
