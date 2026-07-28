/**
 * Status moves through the branching executor, and the fixes from the second
 * review round.
 *
 * Until this round, the executor's effect step only knew about boosts, recoil
 * and drain — so Thunder Wave, Toxic, Growl, Stealth Rock, Rain Dance and
 * Recover all silently did NOTHING in a reconciled plan, and secondaries fired
 * against type-immune targets. Each case below pins the corrected behaviour.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const realCalc = require(path.resolve(__dirname, '../../../calc/dist/index.js'));

function loadScript(rel) {
  const indirectEval = eval;
  indirectEval(fs.readFileSync(path.join(SRC, rel), 'utf8'));
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

function battle(p1, p2) {
  const s = new BP.BattleStateSnapshot();
  s.p1.active = p1.clone();
  s.p1.team = [p1.clone()];
  s.p1.teamSlot = 0;
  s.p2.active = p2.clone();
  s.p2.team = [p2.clone()];
  s.p2.teamSlot = 0;
  return s;
}

const mass = (produced, predicate) =>
  new B.StateDist(produced).merge().entries
    .filter(e => predicate(e.state))
    .reduce((a, e) => a + e.probability, 0);

// ---------------------------------------------------------------------------
describe('status moves actually happen in the executor', () => {
  test('Thunder Wave paralyses, weighted by its accuracy', () => {
    const entry = window.MoveDB.get('Thunder Wave');
    const acc = entry.accuracy === true ? 1 : entry.accuracy / 100;

    const produced = executor(
      battle(mon('Blissey', { moves: ['Thunder Wave'] }), mon('Snorlax', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Thunder Wave' }, p2: null });

    expect(mass(produced, s => s.p2.active.status === 'Paralyzed')).toBeCloseTo(acc, 6);
  });

  test('Thunder Wave does nothing to a Ground type', () => {
    const produced = executor(
      battle(mon('Blissey', { moves: ['Thunder Wave'] }), mon('Swampert', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Thunder Wave' }, p2: null });

    expect(mass(produced, s => s.p2.active.status !== 'Healthy')).toBe(0);
  });

  test('Toxic fails against a Steel type', () => {
    const target = mon('Snorlax', { moves: ['Tackle'] });
    target.types = ['Steel'];
    const produced = executor(
      battle(mon('Blissey', { moves: ['Toxic'] }), target),
      { p1: { type: 'move', moveName: 'Toxic' }, p2: null });

    expect(mass(produced, s => s.p2.active.status !== 'Healthy')).toBe(0);
  });

  test('Growl drops the target Attack stage', () => {
    const produced = executor(
      battle(mon('Blissey', { moves: ['Growl'] }), mon('Snorlax', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Growl' }, p2: null });

    expect(mass(produced, s => s.p2.active.boosts.atk === -1)).toBeCloseTo(1, 6);
  });

  test('Stealth Rock lands on the opponent side of the field', () => {
    const produced = executor(
      battle(mon('Blissey', { moves: ['Stealth Rock'] }), mon('Snorlax', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Stealth Rock' }, p2: null });

    expect(mass(produced, s => s.sides.p2.stealthRock === true)).toBeCloseTo(1, 6);
    expect(mass(produced, s => s.sides.p1.stealthRock)).toBe(0);
  });

  test('Rain Dance sets the weather', () => {
    const produced = executor(
      battle(mon('Blissey', { moves: ['Rain Dance'] }), mon('Snorlax', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Rain Dance' }, p2: null });

    expect(mass(produced, s => s.field.weather === 'Rain')).toBeCloseTo(1, 6);
  });

  test('Recover heals half of max HP', () => {
    const me = mon('Blissey', { moves: ['Recover'] });
    const hurt = battle(me, mon('Snorlax', { moves: ['Tackle'] }));
    hurt.p1.active.currentHP = 100;

    const produced = executor(hurt,
      { p1: { type: 'move', moveName: 'Recover' }, p2: null });

    const expected = 100 + Math.floor(hurt.p1.active.maxHP / 2);
    expect(mass(produced, s => s.p1.active.currentHP === expected)).toBeCloseTo(1, 6);
  });

  test('Leech Seed sticks on a non-Grass target and fails on a Grass one', () => {
    const seeded = executor(
      battle(mon('Blissey', { moves: ['Leech Seed'] }), mon('Snorlax', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Leech Seed' }, p2: null });
    expect(mass(seeded, s => s.p2.active.hasVolatile('leechseed'))).toBeGreaterThan(0.9);

    const grassTarget = mon('Snorlax', { moves: ['Tackle'] });
    grassTarget.types = ['Grass'];
    const blocked = executor(
      battle(mon('Blissey', { moves: ['Leech Seed'] }), grassTarget),
      { p1: { type: 'move', moveName: 'Leech Seed' }, p2: null });
    expect(mass(blocked, s => s.p2.active.hasVolatile('leechseed'))).toBe(0);
  });

  test('Rest fully heals and overwrites the existing status', () => {
    const me = mon('Snorlax', { moves: ['Rest'] });
    const state = battle(me, mon('Blissey', { moves: ['Tackle'] }));
    state.p1.active.currentHP = 50;
    state.p1.active.setStatus('brn');

    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Rest' }, p2: null });

    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p1.active.currentHP).toBe(e.state.p1.active.maxHP);
      expect(e.state.p1.active.status).toBe('Asleep');
    });
  });

  test('Snorlax cannot be poisoned at all — its ability is Immunity', () => {
    const produced = executor(
      battle(mon('Blissey', { moves: ['Toxic'] }), mon('Snorlax', { moves: ['Tackle'] })),
      { p1: { type: 'move', moveName: 'Toxic' }, p2: null });
    expect(mass(produced, s => s.p2.active.status !== 'Healthy')).toBe(0);
  });

  test('a status move that misses does nothing', () => {
    // The landed share must be exactly the move's accuracy, and the miss share
    // its complement. The target needs no immunity in the way, so Snorlax's
    // Immunity is overridden.
    const entry = window.MoveDB.get('Toxic');
    const acc = entry.accuracy === true ? 1 : entry.accuracy / 100;

    const produced = executor(
      battle(mon('Blissey', { moves: ['Toxic'] }),
        mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' })),
      { p1: { type: 'move', moveName: 'Toxic' }, p2: null });

    expect(mass(produced, s => s.p2.active.status === 'Badly Poisoned'))
      .toBeCloseTo(acc, 6);
    expect(mass(produced, s => s.p2.active.status === 'Healthy'))
      .toBeCloseTo(1 - acc, 6);
  });

  test('Disguise is NOT broken by a status move', () => {
    const target = mon('Snorlax', { moves: ['Tackle'], ability: 'Disguise' });
    const produced = executor(
      battle(mon('Blissey', { moves: ['Growl'] }), target),
      { p1: { type: 'move', moveName: 'Growl' }, p2: null });

    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p2.active.hasVolatile('disguiseBroken')).toBe(false);
      expect(e.state.p2.active.boosts.atk).toBe(-1);
    });
  });
});

// ---------------------------------------------------------------------------
describe('turn-order-aware read-out', () => {
  const deps = () => ({
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
  });

  test('a certain first-strike kill means the opponent never acts', () => {
    // Blaziken (faster) with a guaranteed kill vs a 1 HP target
    const state = battle(
      mon('Blaziken', { moves: ['Close Combat'] }),
      mon('Snorlax', { moves: ['Body Slam'], currentHP: 1 }));

    const read = P.assessTurn(state, deps(), { selectedMove: 'Close Combat' });

    expect(read.youMoveFirst).toBe(true);
    expect(read.opponentActsChance).toBeCloseTo(0, 6);
    // ...so nothing they have can kill you this turn
    expect(read.youMightDie).toBeCloseTo(0, 6);
  });

  test('a slower opponent that survives your roll still gets its share', () => {
    const state = battle(
      mon('Blaziken', { moves: ['Close Combat'] }),
      mon('Snorlax', { moves: ['Body Slam'] }));

    const read = P.assessTurn(state, deps(), { selectedMove: 'Close Combat' });

    expect(read.youMoveFirst).toBe(true);
    // Full-HP Snorlax survives Close Combat, so it acts
    expect(read.opponentActsChance).toBeCloseTo(1 - read.youCanKO, 6);
    expect(read.youMightDie).toBeCloseTo(
      read.youMightDieUnconditional * read.opponentActsChance, 6);
  });

  test('a faster opponent always gets to act', () => {
    const slow = mon('Snorlax', { moves: ['Body Slam'] });
    const fast = mon('Blaziken', { moves: ['Close Combat'] });
    const state = battle(slow, fast);

    const read = P.assessTurn(state, deps());
    expect(read.youMoveFirst).toBe(false);
    expect(read.opponentActsChance).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('pivot-aware player policy', () => {
  test('switches out of a certain death it cannot answer', () => {
    // A 1 HP Blissey with only Growl, facing a Close Combat killer, with a
    // GHOST on the bench — immune to Fighting, the classic pivot target.
    // (An earlier version benched a Snorlax, but Close Combat OHKOs that too,
    // and the policy was right to refuse to donate it.)
    const doomed = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const wall = mon('Dusclops', { moves: ['Shadow Ball'] });
    const state = battle(doomed, mon('Blaziken', { moves: ['Close Combat'] }));
    state.p1.team = [doomed.clone(), wall.clone()];

    const choose = P.createPlayerPolicy({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });
    const action = choose(state, null);

    expect(action.type).toBe('switch');
    expect(action.switchToIndex).toBe(1);
  });

  test('does NOT switch when it can take the kill instead', () => {
    const killer = mon('Blaziken', { moves: ['Close Combat'], currentHP: 60 });
    const bench = mon('Snorlax', { moves: ['Body Slam'] });
    const state = battle(killer, mon('Blissey', { moves: ['Ice Beam'], currentHP: 1 }));
    state.p1.team = [killer.clone(), bench.clone()];

    const choose = P.createPlayerPolicy({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });
    const action = choose(state, null);

    expect(action.type).toBe('move');
    expect(action.moveName).toBe('Close Combat');
  });

  test('a planned action always wins over the policy', () => {
    const state = battle(
      mon('Blaziken', { moves: ['Close Combat', 'Growl'] }),
      mon('Blissey', { moves: ['Ice Beam'] }));

    const choose = P.createPlayerPolicy({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, gen: 8
    });
    expect(choose(state, { type: 'move', moveName: 'Growl' }).moveName).toBe('Growl');
  });
});

// ---------------------------------------------------------------------------
describe('projection coverage after coalescing', () => {
  test('nothing is truncated any more — the frontier folds instead', () => {
    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      executeTurn: executor, gen: 8
    });

    const result = project(B.StateDist.of(battle(
      mon('Blaziken', { moves: ['Flare Blitz', 'Thunder Punch'] }),
      mon('Blissey', { moves: ['Ice Beam', 'Thunder Wave'] })), 1),
    { horizon: 6, beamWidth: 8 });

    expect(result.truncatedMass).toBe(0);
    expect(result.coverage).toBe(1);
    // The folding is reported, not hidden
    expect(result.approximatedMass).toBeGreaterThanOrEqual(0);
    expect(result.winProbability + result.lossProbability + result.unresolvedProbability)
      .toBeCloseTo(1, 6);
  });

  test('the trace records the most likely line, turn by turn', () => {
    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      executeTurn: executor, gen: 8
    });

    const trace = [];
    project(B.StateDist.of(battle(
      mon('Blaziken', { moves: ['Flare Blitz'] }),
      mon('Blissey', { moves: ['Ice Beam'] })), 1),
    { horizon: 4, trace });

    expect(trace.length).toBeGreaterThan(0);
    trace.forEach(t => {
      expect(t.turn).toBeGreaterThan(0);
      expect(t.you).toBeTruthy();
      expect(t.yourMove).toBeTruthy();
      expect(t.foeMove).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
describe('per-turn bookkeeping is reset between turns', () => {
  test('a stale Missed tag from the previous turn cannot suppress effects', () => {
    // Turn N misses, tagging the state p1Missed. Before the fix that tag
    // survived into turn N+1 and silently skipped its guaranteed effects.
    const state = battle(mon('Blissey', { moves: ['Growl'] }),
      mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' }));
    state.__tags = { p1Missed: true };   // simulates the leak

    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Growl' }, p2: null });

    expect(mass(produced, s => s.p2.active.boosts.atk === -1)).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
describe('Protect', () => {
  test('self-targeted volatiles land on the USER in MoveDB', () => {
    // Protect/Aqua Ring carried volatileStatus with target self; storing them
    // as target volatiles made the executor protect the OPPONENT.
    expect(window.MoveDB.getEffects('Protect').selfVolatile).toBe('protect');
    expect(window.MoveDB.getEffects('Protect').volatileStatus).toBeNull();
    expect(window.MoveDB.getEffects('Aqua Ring').selfVolatile).toBe('aquaring');
    // Target-side volatiles are untouched
    expect(window.MoveDB.getEffects('Leech Seed').volatileStatus).toBe('leechseed');
  });

  test('a protected target takes no damage and no effects that turn', () => {
    const produced = executor(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Blissey', { moves: ['Protect'] })),
      { p1: { type: 'move', moveName: 'Close Combat' },
        p2: { type: 'move', moveName: 'Protect' } });

    new B.StateDist(produced).merge().entries.forEach(e => {
      // Blissey untouched...
      expect(e.state.p2.active.currentHP).toBe(e.state.p2.active.maxHP);
      // ...and the blocked Close Combat does not pay its self-drops
      expect(e.state.p1.active.boosts.def).toBe(0);
      // ...and the protection expires with the turn
      expect(e.state.p2.active.hasVolatile('protect')).toBe(false);
    });
  });

  test('the turn after a Protect, damage lands normally', () => {
    const first = executor(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Blissey', { moves: ['Protect'] })),
      { p1: { type: 'move', moveName: 'Close Combat' },
        p2: { type: 'move', moveName: 'Protect' } });

    const top = new B.StateDist(first).merge().entries
      .reduce((a, b) => (b.probability > a.probability ? b : a));

    const second = executor(top.state,
      { p1: { type: 'move', moveName: 'Close Combat' }, p2: null });
    expect(mass(second, s => s.p2.active.currentHP < s.p2.active.maxHP))
      .toBeCloseTo(1, 6);
  });

  test('RnB: Defend Order functions like Protect, with its priority', () => {
    const produced = executor(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Vespiquen', { moves: ['Defend Order'] })),
      { p1: { type: 'move', moveName: 'Close Combat' },
        p2: { type: 'move', moveName: 'Defend Order' } });

    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p2.active.currentHP).toBe(e.state.p2.active.maxHP);
    });
  });
});

// ---------------------------------------------------------------------------
describe('post-KO replacements are game-accurate', () => {
  function projectOnce(state, options) {
    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    return project(B.StateDist.of(state, 1), options);
  }

  test("the opponent's replacement is the switch AI's pick, not the next slot", () => {
    // p2 lead dies for certain; bench holds a bad and a good matchup in
    // NEXT-SLOT-FIRST order, so the old behaviour would send the bad one.
    const fodder = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const badMatchup = mon('Blissey', { moves: ['Growl'] });      // slot 1: next
    const goodMatchup = mon('Blaziken', { moves: ['Close Combat'] }); // slot 2

    const state = battle(mon('Blaziken', { moves: ['Close Combat'] }), fodder);
    state.p2.team = [fodder.clone(), badMatchup.clone(), goodMatchup.clone()];

    const calcBest = (atk, def) => {
      let best = 0;
      try {
        const a = CI.snapshotToPokemon(atk, 8);
        const d = CI.snapshotToPokemon(def, 8);
        (atk.moves || []).filter(Boolean).forEach(name => {
          try {
            const range = CI.getDamageRange(
              realCalc.calculate(realCalc.Generations.get(8), a, d,
                new realCalc.Move(realCalc.Generations.get(8), name)));
            if (range.max > best) best = range.max;
          } catch (e) { /* skip */ }
        });
      } catch (e) { /* skip */ }
      return best;
    };
    const predicted = Logic.predictAISwitchIn(
      state.p1.active, state.p2.team, 0, 8, calcBest);
    expect(predicted).toBeTruthy();

    const trace = [];
    projectOnce(state, { horizon: 1, trace });

    expect(trace[0].foeReplaced).toBeTruthy();
    expect(trace[0].foeReplaced.sentIn).toBe(predicted.pokemon.name);
  });

  test('a replacement pays its entry hazards', () => {
    const fodder = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const bench = mon('Snorlax', { moves: ['Body Slam'], ability: 'Gluttony' });
    const state = battle(mon('Blaziken', { moves: ['Close Combat'] }), fodder);
    state.p2.team = [fodder.clone(), bench.clone()];
    state.sides.p2.stealthRock = true;

    const trace = [];
    projectOnce(state, { horizon: 1, trace });

    // Snorlax came in over Stealth Rock: 1/8 neutral chip
    expect(trace[0].foeReplaced.sentIn).toBe('Snorlax');
    expect(trace[0].after.foeHP).toBeLessThan(bench.maxHP);
  });
});

// ---------------------------------------------------------------------------
describe('the trace tells the true story', () => {
  function projectTrace(state, options) {
    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const trace = [];
    project(B.StateDist.of(state, 1), Object.assign({ trace }, options));
    return trace;
  }

  test('turn numbers are absolute, continuing from the current node', () => {
    const state = battle(mon('Blissey', { moves: ['Tackle'] }),
      mon('Blissey', { moves: ['Tackle'] }));
    state.turnNumber = 3;   // projection launched mid-line

    const trace = projectTrace(state, { horizon: 2 });
    expect(trace[0].turn).toBe(4);
    expect(trace[1].turn).toBe(5);
  });

  test('the line is coherent: each turn continues from the previous outcome', () => {
    // Wide beam so no state is coalesced away — Blissey vs Blissey produces
    // ~121 distinct HP pairs per turn. (A fold marks lineageBroken instead of
    // silently jumping lines; that path is asserted separately below.)
    const trace = projectTrace(
      battle(mon('Blissey', { moves: ['Tackle'] }), mon('Blissey', { moves: ['Tackle'] })),
      { horizon: 3, beamWidth: 400 });

    for (let i = 1; i < trace.length; i++) {
      if (trace[i - 1].foeReplaced || trace[i - 1].youReplaced) continue;
      expect(trace[i - 1].lineageBroken).toBeUndefined();
      expect(trace[i].yourHP).toBe(trace[i - 1].after.yourHP);
      expect(trace[i].foeHP).toBe(trace[i - 1].after.foeHP);
    }
  });

  test('a coalesced-away line is marked, never silently swapped', () => {
    const trace = projectTrace(
      battle(mon('Blissey', { moves: ['Tackle'] }), mon('Blissey', { moves: ['Tackle'] })),
      { horizon: 3, beamWidth: 8 });   // aggressive folding

    for (let i = 1; i < trace.length; i++) {
      if (trace[i - 1].foeReplaced || trace[i - 1].youReplaced) continue;
      const coherent = trace[i].yourHP === trace[i - 1].after.yourHP &&
        trace[i].foeHP === trace[i - 1].after.foeHP;
      // Either the followed line was folded onto a neighbour (approximated —
      // the trace continues nearby) or it vanished (broken). Never unmarked.
      if (!coherent) {
        expect(trace[i - 1].lineageBroken === true ||
          trace[i - 1].lineageApproximated === true).toBe(true);
      }
    }
  });

  test('a turn that can split shows its split, with honest weights', () => {
    // Close Combat straddles lethal against a target inside its roll range
    const atk = new realCalc.Pokemon(realCalc.Generations.get(8), 'Blaziken',
      { level: 100, evs: { atk: 252 } });
    const atkSnap = new BP.PokemonSnapshot(atk);
    atkSnap.moves = ['Close Combat'];
    atkSnap.refreshPP();

    const target = mon('Snorlax', { moves: ['Body Slam'], ability: 'Gluttony' });
    const rolls = CI.getDamageRolls(realCalc.calculate(
      realCalc.Generations.get(8), atk,
      CI.snapshotToPokemon(target, 8),
      new realCalc.Move(realCalc.Generations.get(8), 'Close Combat')));
    const mid = Math.round((rolls[0].damage + rolls[rolls.length - 1].damage) / 2);
    target.currentHP = mid;

    const state = battle(atkSnap, target);
    state.p2.team = [target.clone(), mon('Blissey', { moves: ['Growl'] })];

    const trace = projectTrace(state, {
      horizon: 1, plannedP1: { type: 'move', moveName: 'Close Combat' }
    });

    expect(trace[0].branches.length).toBeGreaterThanOrEqual(2);
    const total = trace[0].branches.reduce((a, b) => a + b.probability, 0);
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
  });

  test('stat changes are visible — the Low Sweep case', () => {
    // The user and the assistant BOTH misread a correct simulation because the
    // Spe drop was invisible in the trace. Never again.
    const state = battle(mon('Blaziken', { moves: ['Low Sweep'] }),
      mon('Blissey', { moves: ['Tackle'] }));

    const trace = projectTrace(state, {
      horizon: 1, plannedP1: { type: 'move', moveName: 'Low Sweep' }
    });

    expect(trace[0].foeChanges).toContain('Spe -1');
    expect(trace[0].firstMover).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('lead comparison at turn 0', () => {
  test('ranks the opener that actually wins above the one that stalls', () => {
    // Blissey with only Growl cannot win; Blaziken sweeps. Both are healthy
    // openers, so the comparison must rank Blaziken first.
    const growler = mon('Blissey', { moves: ['Growl'] });
    const sweeper = mon('Blaziken', { moves: ['Close Combat'] });
    const state = battle(growler, mon('Blissey', { moves: ['Ice Beam'] }));
    state.p1.team = [growler.clone(), sweeper.clone()];

    const compare = P.createLeadComparison({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const results = compare(state, { horizon: 6, beamWidth: 16 });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Blaziken');
    expect(results[0].winProbability).toBeGreaterThan(results[1].winProbability);
    expect(results.filter(r => r.isCurrent)).toHaveLength(1);
    results.forEach(r => {
      expect(r.winProbability + r.lossProbability + r.unresolvedProbability)
        .toBeCloseTo(1, 6);
    });
  });

  test('fainted team members are not offered as openers', () => {
    const alive = mon('Blaziken', { moves: ['Close Combat'] });
    const dead = mon('Blissey', { moves: ['Growl'], currentHP: 0 });
    const state = battle(alive, mon('Blissey', { moves: ['Tackle'] }));
    state.p1.team = [alive.clone(), dead.clone()];

    const compare = P.createLeadComparison({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    expect(compare(state, { horizon: 3, beamWidth: 8 })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('type-changing moves (the Soak counter-strategy)', () => {
  test('Soak turns a Steel type into Water — and its immunities die with it', () => {
    // The AI genuinely uses this: Cufant is immune to poison until Soak makes
    // it Water, at which point Venoshock and Toxic work.
    const cufant = mon('Cufant', { moves: ['Bulldoze'] });
    expect(cufant.types).toContain('Steel');

    const state = battle(mon('Blissey', { moves: ['Soak'] }), cufant);
    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Soak' }, p2: null });

    new B.StateDist(produced).merge().entries.forEach(e => {
      expect(e.state.p2.active.types).toEqual(['Water']);
    });

    // Now poison sticks where it could not before
    const soaked = new B.StateDist(produced).merge().entries[0].state;
    expect(soaked.p2.active.inflictStatus('tox')).toBe(true);
  });

  test('the damage engine sees the new typing', () => {
    const cufant = mon('Cufant', { moves: ['Bulldoze'] });
    const before = CI.snapshotToPokemon(cufant, 8);
    const beforeDmg = CI.getDamageRange(realCalc.calculate(
      realCalc.Generations.get(8),
      CI.snapshotToPokemon(mon('Blissey', { moves: ['Venoshock'] }), 8),
      before, new realCalc.Move(realCalc.Generations.get(8), 'Venoshock')));
    expect(beforeDmg.max).toBe(0);   // Steel: immune to poison damage

    cufant.types = ['Water'];        // Soak'd
    const after = CI.snapshotToPokemon(cufant, 8);
    const afterDmg = CI.getDamageRange(realCalc.calculate(
      realCalc.Generations.get(8),
      CI.snapshotToPokemon(mon('Blissey', { moves: ['Venoshock'] }), 8),
      after, new realCalc.Move(realCalc.Generations.get(8), 'Venoshock')));
    expect(afterDmg.max).toBeGreaterThan(0);
  });

  test('a Soak-changed state never merges with an unchanged one', () => {
    const a = battle(mon('Blissey', { moves: ['Soak'] }), mon('Cufant', { moves: ['Bulldoze'] }));
    const b = battle(mon('Blissey', { moves: ['Soak'] }), mon('Cufant', { moves: ['Bulldoze'] }));
    b.p2.active.types = ['Water'];

    expect(B.stateKey(a)).not.toBe(B.stateKey(b));
  });

  test("Trick-or-Treat ADDS Ghost instead of replacing the typing", () => {
    const target = mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' });
    const state = battle(mon('Blissey', { moves: ['Trick-or-Treat'] }), target);
    const produced = executor(state,
      { p1: { type: 'move', moveName: 'Trick-or-Treat' }, p2: null });

    const landed = new B.StateDist(produced).merge().entries
      .filter(e => e.state.p2.active.types.indexOf('Ghost') !== -1);
    expect(landed.length).toBeGreaterThan(0);
    landed.forEach(e => {
      expect(e.state.p2.active.types).toContain('Normal');
    });
  });
});

// ---------------------------------------------------------------------------
describe('switches are legible in the trace', () => {
  test('a voluntary switch names who comes in and is not a death', () => {
    // Doomed Growl-Blissey with a Fighting-immune ghost benched: the policy
    // pivots, and the trace must say so by name.
    const doomed = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const wall = mon('Dusclops', { moves: ['Shadow Ball'] });
    const state = battle(doomed, mon('Blaziken', { moves: ['Close Combat'] }));
    state.p1.team = [doomed.clone(), wall.clone()];

    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const trace = [];
    project(B.StateDist.of(state, 1), { horizon: 1, trace });

    expect(trace[0].yourMove).toBe('switch → Dusclops');
    expect(trace[0].youReplaced).toBeTruthy();
    expect(trace[0].youReplaced.voluntary).toBe(true);
    expect(trace[0].youReplaced.sentIn).toBe('Dusclops');
  });

  test('a faint replacement is NOT marked voluntary', () => {
    const fodder = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const bench = mon('Snorlax', { moves: ['Body Slam'], ability: 'Gluttony' });
    const state = battle(mon('Blaziken', { moves: ['Close Combat'] }), fodder);
    state.p2.team = [fodder.clone(), bench.clone()];

    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const trace = [];
    project(B.StateDist.of(state, 1), { horizon: 1, trace });

    expect(trace[0].foeReplaced).toBeTruthy();
    expect(trace[0].foeReplaced.voluntary).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('the projection runs to the end of the battle', () => {
  function makeProj() {
    return P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
  }

  test('the default guard is 30 turns, not 8', () => {
    const result = makeProj()(B.StateDist.of(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Blissey', { moves: ['Growl'] })), 1), {});
    expect(result.horizon).toBe(30);
  });

  test('a decided battle stops early instead of burning the guard', () => {
    const result = makeProj()(B.StateDist.of(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Blissey', { moves: ['Growl'], currentHP: 30 })), 1), {});

    expect(result.unresolvedProbability).toBeLessThan(0.01);
    expect(result.turnsSimulated).toBeLessThan(10);
  });

  test('a fight that needs more than 8 turns now resolves', () => {
    // Snorlax needs ~13 Tackles to crack Registeel's Defense; Registeel chips
    // back far too slowly to matter. EVERY line of this fight runs past the
    // old 8-turn wall, which used to report it as "unresolved 100%".
    const result = makeProj()(B.StateDist.of(
      battle(mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' }),
        mon('Registeel', { moves: ['Tackle'] })), 1),
    { beamWidth: 48 });

    expect(result.turnsSimulated).toBeGreaterThan(8);
    expect(result.winProbability + result.lossProbability)
      .toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
describe('carrying a battered team into the next battle', () => {
  test('HP, status and used items carry — boosts and volatiles do not', () => {
    // The team as battle 1 ended
    const carried = [
      mon('Blaziken', { currentHP: 12, status: 'Burned', item: '' }),   // berry eaten
      mon('Blissey', { currentHP: 0 }),
      mon('Snorlax', { ability: 'Gluttony' })
    ];
    carried[0].boosts.atk = 2;                    // must NOT carry
    carried[0].setVolatile('leechseed', true);    // must NOT carry

    // Battle 2 starts with a freshly built team of the same Pokemon
    const fresh = battle(mon('Blaziken', { item: 'Oran Berry' }),
      mon('Murkrow', { moves: ['Wing Attack'] }));
    fresh.p1.team = [
      mon('Blaziken', { item: 'Oran Berry' }),
      mon('Blissey'),
      mon('Snorlax', { ability: 'Gluttony' })
    ];
    fresh.p1.teamSlot = 0;

    BP.applyCarriedTeam(fresh, carried);

    const lead = fresh.p1.team[0];
    expect(lead.currentHP).toBe(12);
    expect(lead.status).toBe('Burned');
    expect(lead.item).toBe('');                       // consumed items stay gone
    expect(lead.boosts.atk).toBe(0);                  // boosts reset
    expect(lead.hasVolatile('leechseed')).toBe(false);

    expect(fresh.p1.team[1].currentHP).toBe(0);       // the faint carries
    expect(fresh.p1.team[1].hasFainted).toBe(true);
    expect(fresh.p1.team[2].currentHP).toBe(fresh.p1.team[2].maxHP);

    // The active was the carried lead, so it reflects the damage too
    expect(fresh.p1.active.currentHP).toBe(12);
  });

  test('Pokemon not in the carried team are untouched', () => {
    const carried = [mon('Blaziken', { currentHP: 5 })];
    const fresh = battle(mon('Blissey'), mon('Murkrow', { moves: ['Wing Attack'] }));
    fresh.p1.team = [mon('Blissey'), mon('Garchomp')];

    BP.applyCarriedTeam(fresh, carried);
    fresh.p1.team.forEach(m => expect(m.currentHP).toBe(m.maxHP));
  });

  test('the projection then plans battle 2 with the carried damage', () => {
    // Snorlax survives Close Combat and chips back — enough to finish a
    // 10 HP Blaziken but never a healthy one. (Blissey gets one-shot before
    // punishing anything; Swampert beats even a healthy lone Blaziken.)
    const fresh = battle(mon('Blaziken', { moves: ['Close Combat'] }),
      mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' }));
    BP.applyCarriedTeam(fresh, [mon('Blaziken', { currentHP: 10 })]);

    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const damaged = project(B.StateDist.of(fresh, 1), { horizon: 8 });

    const healthy = project(B.StateDist.of(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' })), 1), { horizon: 8 });

    // Ten HP is not fifty-four: the carried damage must show in the odds
    expect(damaged.probabilityOfLosingAny)
      .toBeGreaterThan(healthy.probabilityOfLosingAny);
  });
});

// ---------------------------------------------------------------------------
describe('simplicity before cleverness (strategy escalation)', () => {
  const policyDeps = () => ({
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, Logic, gen: 8
  });

  test('even the simplest tier pivots when doomed — but never clicks status', () => {
    // "Especially pivoting is always needed": the emergency switch is part of
    // the SIMPLEST playable plan, not cleverness.
    const doomed = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const state = battle(doomed, mon('Blaziken', { moves: ['Close Combat'] }));
    state.p1.team = [doomed.clone(), mon('Dusclops', { moves: ['Shadow Ball'] })];

    const simple = P.createPlayerPolicy(policyDeps(), { complexity: 0 })(state, null);
    expect(simple.type).toBe('switch');
  });

  test('tier 0 ignores status moves, tier 1 uses them', () => {
    // Blissey's Tackle is pitiful against Snorlax; Toxic is the real answer.
    const state = battle(mon('Blissey', { moves: ['Tackle', 'Toxic'] }),
      mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' }));

    const simple = P.createPlayerPolicy(policyDeps(), { complexity: 0 })(state, null);
    expect(simple.moveName).toBe('Tackle');

    const withStatus = P.createPlayerPolicy(policyDeps(), { complexity: 1 })(state, null);
    expect(withStatus.moveName).toBe('Toxic');
  });

  test('a fight that pure offense wins cleanly is accepted without escalation', () => {
    const smart = P.createSmartProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const r = smart(B.StateDist.of(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Blissey', { moves: ['Growl'] })), 1), { horizon: 10 });

    expect(r.strategy).toBe('pure offense');
    expect(r.strategiesTried).toHaveLength(1);
    expect(r.winProbability).toBeGreaterThan(0.99);
    expect(r.probabilityOfLosingAny).toBeLessThan(0.01);
  });

  test('escalation kicks in when only status wins the fight', () => {
    // Blissey's Tackle can never out-race Snorlax's; Toxic kills it in ~7
    // turns while a Defense-invested Blissey tanks (paper Def loses even the
    // Toxic race — Snorlax 4HKOs it). Tier 0 loses this fight — the smart
    // projection must see that, escalate to the status tier, and stop there.
    const tank = new realCalc.Pokemon(gen(), 'Blissey',
      { level: 100, evs: { def: 252 }, nature: 'Bold' });
    const tankSnap = new BP.PokemonSnapshot(tank);
    tankSnap.moves = ['Tackle', 'Toxic'];
    tankSnap.refreshPP();
    const state = battle(tankSnap,
      mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' }));

    const smart = P.createSmartProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const r = smart(B.StateDist.of(state, 1), { horizon: 20, beamWidth: 48 });

    expect(r.strategiesTried.length).toBe(2);
    expect(r.strategy).toBe('offense + status moves');
    expect(r.winProbability).toBeGreaterThan(0.9);
    expect(r.probabilityOfLosingAny).toBeLessThan(0.05);
    // The winner was re-run at full quality: it must carry a usable trace
    expect(r.trace && r.trace.length).toBeTruthy();
  });

  test('tiers that cannot differ are skipped outright', () => {
    // No status moves anywhere and no bench: only tier 0 makes sense, and a
    // fight tier 0 cannot win must still return after ONE tier.
    const state = battle(mon('Blissey', { moves: ['Tackle'] }),
      mon('Registeel', { moves: ['Tackle'] }));

    const smart = P.createSmartProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const r = smart(B.StateDist.of(state, 1), { horizon: 6 });
    expect(r.strategiesTried).toHaveLength(1);
    expect(r.strategy).toBe('pure offense');
  });
});

// ---------------------------------------------------------------------------
describe('the chunked run (what keeps the browser alive)', () => {
  const projDeps = () => ({
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
    Logic, executeTurn: executor, gen: 8
  });

  test('the chunked run gives exactly the sync answer and reports progress', done => {
    const dist = () => B.StateDist.of(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' })), 1);

    const project = P.createProjection(projDeps());
    const sync = project(dist(), { horizon: 10 });

    let progressCalls = 0;
    project.start(dist(), {
      horizon: 10,
      onProgress: () => { progressCalls++; },
      onError: done,
      onDone: r => {
        try {
          expect(r.winProbability).toBeCloseTo(sync.winProbability, 9);
          expect(r.lossProbability).toBeCloseTo(sync.lossProbability, 9);
          expect(r.expectedPokemonLost).toBeCloseTo(sync.expectedPokemonLost, 9);
          expect(r.turnsSimulated).toBe(sync.turnsSimulated);
          expect(r.expectedTeamHPLeft).toBeGreaterThanOrEqual(0);
          expect(r.expectedTeamHPLeft).toBeLessThanOrEqual(1);
          expect(progressCalls).toBeGreaterThan(0);
          done();
        } catch (e) { done(e); }
      }
    });
  });

  test('cancel stops the run and delivers null', done => {
    const project = P.createProjection(projDeps());
    const handle = project.start(B.StateDist.of(
      battle(mon('Snorlax', { moves: ['Tackle'], ability: 'Gluttony' }),
        mon('Registeel', { moves: ['Tackle'] })), 1), {
      onDone: r => {
        try { expect(r).toBeNull(); done(); } catch (e) { done(e); }
      }
    });
    handle.cancel();   // before the first tick ever fires
  });

  test('a pure stall is cut short as unresolved instead of looping', () => {
    // Growl vs Growl: no HP ever changes. The stall detector must stop the
    // run after a few identical turns rather than simulating all 30.
    const project = P.createProjection(projDeps());
    const r = project(B.StateDist.of(
      battle(mon('Blissey', { moves: ['Growl'] }),
        mon('Blissey', { moves: ['Growl'] })), 1), {});

    expect(r.turnsSimulated).toBeLessThan(10);
    expect(r.unresolvedProbability).toBeCloseTo(1, 3);
  });
});

// ---------------------------------------------------------------------------
describe('no more eternal Protect loops', () => {
  test('a consecutive Protect fails in the executor', () => {
    const first = executor(
      battle(mon('Blaziken', { moves: ['Close Combat'] }),
        mon('Blissey', { moves: ['Protect'] })),
      { p1: { type: 'move', moveName: 'Close Combat' },
        p2: { type: 'move', moveName: 'Protect' } });

    const top = new B.StateDist(first).merge().entries
      .reduce((a, b) => (b.probability > a.probability ? b : a));
    // The memory of having protected survives the turn...
    expect(top.state.p2.active.hasVolatile('protectused')).toBe(true);

    // ...so protecting AGAIN does nothing and the damage lands everywhere
    const second = executor(top.state,
      { p1: { type: 'move', moveName: 'Close Combat' },
        p2: { type: 'move', moveName: 'Protect' } });
    expect(mass(second, s => s.p2.active.currentHP < s.p2.active.maxHP))
      .toBeCloseTo(1, 6);
  });

  test('the AI never offers Protect right after protecting', () => {
    const skrelp = mon('Blissey', { moves: ['Ice Beam', 'Protect'] });
    const state = battle(mon('Chewtle', { moves: ['Bite'] }), skrelp);

    const deps = {
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, gen: 8,
      // Force the engine to say "Protect is very likely"
      generateMoveDist: () => [0.4, 0.6]
    };

    const fresh = P.createAIPolicy(deps)(state);
    expect((fresh.candidates || [fresh]).some(c =>
      (c.moveName || fresh.moveName) === 'Protect')).toBe(true);

    state.p2.active.setVolatile('protectused', true);
    const after = P.createAIPolicy(deps)(state);
    expect(after.moveName).not.toBe('Protect');
    expect((after.candidates || []).some(c => c.moveName === 'Protect')).toBe(false);
  });

  test('a projected fight against a Protect user cannot stall forever on Protect', () => {
    // Chewtle vs a bulky Protect/Toxic/Acid mix — the exact shape that
    // trapped the trace in an impossible eternal Protect chain.
    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const trace = [];
    project(B.StateDist.of(
      battle(mon('Chewtle', { moves: ['Bite'] }),
        mon('Blissey', { moves: ['Ice Beam', 'Protect'] })), 1),
    { horizon: 12, trace });

    // Two Protects in a row in the traced line = the impossible loop is back
    for (let i = 1; i < trace.length; i++) {
      const prevProtected = (trace[i - 1].events || []).some(e => e.indexOf('protected itself') !== -1);
      const nowProtected = (trace[i].events || []).some(e => e.indexOf('protected itself') !== -1);
      expect(prevProtected && nowProtected).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the trace is replayable', () => {
  test('every traced turn carries the raw actions the UI needs to replay it', () => {
    const doomed = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const state = battle(doomed, mon('Blaziken', { moves: ['Close Combat'] }));
    state.p1.team = [doomed.clone(), mon('Dusclops', { moves: ['Shadow Ball'] })];

    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const trace = [];
    project(B.StateDist.of(state, 1), { horizon: 2, trace });

    expect(trace.length).toBeGreaterThan(0);
    trace.forEach(t => {
      expect(t.yourAction).toBeTruthy();
      expect(t.foeAction).toBeTruthy();
    });
    // The pivot turn is a real switch action with a target slot
    expect(trace[0].yourAction.type).toBe('switch');
    expect(trace[0].yourAction.targetSlot).toBe(1);
    expect(trace[0].foeAction.moveName).toBe('Close Combat');
  });
});

// ---------------------------------------------------------------------------
describe('the projected team plan', () => {
  test('reports who was used, in order, with how they left the field', () => {
    const doomed = mon('Blissey', { moves: ['Growl'], currentHP: 1 });
    const state = battle(doomed, mon('Blaziken', { moves: ['Close Combat'] }));
    state.p1.team = [doomed.clone(), mon('Dusclops', { moves: ['Shadow Ball'] })];

    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const trace = [];
    const report = project(B.StateDist.of(state, 1), { horizon: 4, trace });

    expect(report.teamPlan).toBeTruthy();
    expect(report.teamPlan[0].name).toBe('Blissey');
    expect(report.teamPlan[0].exit).toBe('switched out');
    expect(report.teamPlan[0].endHP).toBe(1);      // pivoted out alive
    expect(report.teamPlan[1].name).toBe('Dusclops');
    expect(report.teamPlan[1].foes).toContain('Blaziken');
  });
});

// ---------------------------------------------------------------------------
describe('recruiting from the box at turn 0', () => {
  test('fills empty team slots from the box, up to 6, skipping duplicates and fainted', () => {
    const state = battle(mon('Monferno', { moves: ['Mach Punch'] }),
      mon('Murkrow', { moves: ['Wing Attack'] }));

    const box = [
      mon('Monferno', { moves: ['Mach Punch'] }),      // duplicate: skipped
      mon('Chewtle', { moves: ['Bite'] }),
      mon('Blissey', { moves: ['Growl'], currentHP: 0 }), // fainted: skipped
      mon('Lombre', { moves: ['Mega Drain'] })
    ];

    const out = BP.recruitFromBox(state, box);
    expect(out.recruits).toEqual(['Chewtle', 'Lombre']);
    expect(state.p1.team.map(m => m.name)).toEqual(['Monferno', 'Chewtle', 'Lombre']);
  });

  test('never grows the team past 6', () => {
    const state = battle(mon('Monferno', { moves: ['Mach Punch'] }),
      mon('Murkrow', { moves: ['Wing Attack'] }));
    const box = ['Chewtle', 'Lombre', 'Nuzleaf', 'Bunnelby', 'Cufant', 'Snorlax', 'Blissey']
      .map(name => mon(name, { moves: ['Tackle'], ability: name === 'Snorlax' ? 'Gluttony' : undefined }));

    const out = BP.recruitFromBox(state, box);
    expect(state.p1.team).toHaveLength(6);
    expect(out.recruits).toHaveLength(5);
  });

  test('the projection then actually plans with the recruits', () => {
    // Lone doomed Growl-Blissey; the box holds the Blaziken that wins the
    // fight. Recruiting must turn a lost projection into a won one.
    const state = battle(mon('Blissey', { moves: ['Growl'], currentHP: 40 }),
      mon('Snorlax', { moves: ['Body Slam'], ability: 'Gluttony' }));

    const project = P.createProjection({
      calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB,
      Logic, executeTurn: executor, gen: 8
    });
    const before = project(B.StateDist.of(state.clone(), 1), { horizon: 10 });
    expect(before.winProbability).toBeLessThan(0.1);

    const out = BP.recruitFromBox(state, [mon('Blaziken', { moves: ['Close Combat'] })]);
    expect(out.recruits).toEqual(['Blaziken']);
    const after = project(B.StateDist.of(state, 1), { horizon: 12 });
    expect(after.winProbability).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
describe('smart roster selection (the projection decides the team)', () => {
  const rosterDeps = () => ({
    calc: realCalc, CalcIntegration: CI, MoveDB: window.MoveDB, Logic, gen: 8
  });

  test('ranks box candidates by matchup against the enemy team', () => {
    // Against Tirtouga (Water/Rock), Lombre resists Water and hits 4x with
    // Mega Drain; Venipede neither. Lombre must outrank it.
    const state = battle(mon('Bunnelby', { moves: ['Tackle'] }),
      mon('Tirtouga', { moves: ['Aqua Jet', 'Ancient Power'] }));
    const box = [mon('Venipede', { moves: ['Bug Bite'] }),
      mon('Lombre', { moves: ['Mega Drain'] })];

    const roster = P.selectBestRoster(state, box, rosterDeps(), 6);
    const names = roster.map(e => e.snap.name);
    expect(names[0]).toBe('Bunnelby');   // the active always stays aboard
    expect(names.indexOf('Lombre')).toBeLessThan(names.indexOf('Venipede'));
    expect(roster.filter(e => e.fromBox).map(e => e.snap.name).sort())
      .toEqual(['Lombre', 'Venipede']);
  });

  test('caps the roster at the limit, dropping the worst matchups', () => {
    const state = battle(mon('Bunnelby', { moves: ['Tackle'] }),
      mon('Tirtouga', { moves: ['Aqua Jet'] }));
    const box = ['Lombre', 'Chewtle', 'Monferno', 'Cufant', 'Nuzleaf', 'Venipede']
      .map(n => mon(n, { moves: ['Tackle'] }));

    const roster = P.selectBestRoster(state, box, rosterDeps(), 6);
    expect(roster).toHaveLength(6);
    // 1 team member + 6 box candidates -> exactly one candidate was benched
  });

  test('fainted candidates are never recruited', () => {
    const state = battle(mon('Bunnelby', { moves: ['Tackle'] }),
      mon('Tirtouga', { moves: ['Aqua Jet'] }));
    const box = [mon('Lombre', { moves: ['Mega Drain'], currentHP: 0 })];
    const roster = P.selectBestRoster(state, box, rosterDeps(), 6);
    expect(roster.map(e => e.snap.name)).toEqual(['Bunnelby']);
  });
});
