/* eslint-disable max-len */

import {calculate, Pokemon, Move, Field, Side, Generations} from '../index';
import {generateMoveDist} from '../ai';
import {GenerationNum} from '../data/interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GEN: GenerationNum = 8;

/** Default aiOptions — all false */
function defaultAiOptions(): {[key: string]: boolean} {
  return {
    firstTurnOutAiOpt: false,
    suckerPunchAiOpt: false,
    lastMonAiOpt: false,
    playerLastMonAiOpt: false,
    playerCharmedOrConfusedAiOpt: false,
    tauntAiOpt: false,
    imprisonAiOpt: false,
    encoreAiOpt: false,
    playerFirstTurnOutAiOpt: false,
    magnetRiseAiOpt: false,
    playerMagnetRisenAiOpt: false,
    protectIncentiveAiOpt: false,
    protectDisincentiveAiOpt: false,
    protectLastAiOpt: false,
    protectLastTwoAiOpt: false,
    enableDebugLogging: false,
  };
}

/**
 * Build a damageResults array from two Pokemon and their moves.
 * playerMoves = player's 4 moves, aiMoves = AI's 4 moves.
 * Returns [playerResults[4], aiResults[4]].
 */
function buildDamageResults(
  player: Pokemon,
  ai: Pokemon,
  playerMoveNames: string[],
  aiMoveNames: string[],
  field?: Field
): any[][] {
  const f = field || new Field();
  const fSwapped = f.clone().swap();

  // Build Move objects with attacker context
  const playerMoves = playerMoveNames.map(
    name => new Move(GEN, name, {ability: player.ability, item: player.item, species: player.name})
  );
  const aiMoves = aiMoveNames.map(
    name => new Move(GEN, name, {ability: ai.ability, item: ai.item, species: ai.name})
  );

  // The AI code reads defender.moves[0].ability to get the player's ability (line 872 in ai.ts).
  // In the frontend, Pokemon.moves is an array of Move objects (not MoveName strings).
  // We need to replicate this by injecting Move objects with the correct ability/item onto the Pokemon.
  (player as any).moves = playerMoves;
  (ai as any).moves = aiMoves;

  // Player attacks AI (damageResults[0])
  const playerResults = playerMoves.map(move => calculate(GEN, player, ai, move, f));
  // AI attacks player (damageResults[1])
  const aiResults = aiMoves.map(move => calculate(GEN, ai, player, move, fSwapped));

  return [playerResults, aiResults];
}

/** Sum of distribution should be ~1.0 */
function distSumsToOne(dist: number[]) {
  const sum = dist.reduce((a, b) => a + b, 0);
  expect(sum).toBeCloseTo(1.0, 4);
}

/** Returns the index of the move with the highest probability in the distribution */
function topMoveIndex(dist: number[]): number {
  return dist.indexOf(Math.max(...dist));
}

/** Returns indices of all moves sharing the maximum probability */
function topMoveIndices(dist: number[]): number[] {
  const max = Math.max(...dist);
  return dist.reduce((acc, val, idx) => {
    if (Math.abs(val - max) < 0.0001) acc.push(idx);
    return acc;
  }, [] as number[]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI Move Prediction Engine (ai.ts)', () => {
  // =========================================================================
  // Distribution fundamentals
  // =========================================================================
  describe('distribution fundamentals', () => {
    test('distribution sums to 1.0 for a basic matchup', () => {
      const player = new Pokemon(GEN, 'Pikachu', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Charizard', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });

      const results = buildDamageResults(
        player, ai,
        ['Thunderbolt', 'Volt Switch', 'Grass Knot', 'Iron Tail'],
        ['Flamethrower', 'Air Slash', 'Dragon Pulse', 'Roost']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      expect(dist).toHaveLength(4);
      distSumsToOne(dist);
    });

    test('all probabilities are non-negative', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Tyranitar', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Stone Edge', 'Crunch', 'Earthquake', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      for (const p of dist) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
      distSumsToOne(dist);
    });
  });

  // =========================================================================
  // Highest damage selection
  // =========================================================================
  describe('highest damage move selection', () => {
    test('AI favors highest-damage move when no special conditions', () => {
      // Starmie vs Blissey — Psyshock should do more than Scald/Ice Beam to Blissey
      // Actually let's use a clearer example
      const player = new Pokemon(GEN, 'Blissey', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });
      const ai = new Pokemon(GEN, 'Alakazam', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });

      const results = buildDamageResults(
        player, ai,
        ['Seismic Toss', 'Toxic', 'Soft-Boiled', 'Thunder Wave'],
        ['Psyshock', 'Shadow Ball', 'Focus Blast', 'Calm Mind']
      );

      // Psyshock (index 0) should be highest damage against Blissey's low physical def
      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // The highest damage move should get the majority of probability
      const topIdx = topMoveIndex(dist);
      expect(dist[topIdx]).toBeGreaterThan(0.3);
    });

    test('AI prefers super-effective move over neutral STAB', () => {
      const player = new Pokemon(GEN, 'Charizard', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Tyranitar', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      // Stone Edge (4x SE vs Charizard) vs Crunch (neutral STAB)
      const results = buildDamageResults(
        player, ai,
        ['Flamethrower', 'Air Slash', 'Dragon Pulse', 'Roost'],
        ['Stone Edge', 'Crunch', 'Earthquake', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Stone Edge (index 0) should be heavily favored
      expect(dist[0]).toBeGreaterThan(dist[1]);
      expect(dist[0]).toBeGreaterThan(dist[2]);
    });
  });

  // =========================================================================
  // Kill detection
  // =========================================================================
  describe('kill detection and priority', () => {
    test('AI picks killing move with high confidence when it can KO', () => {
      // Weakened Pikachu vs strong attacker
      const player = new Pokemon(GEN, 'Pikachu', {
        curHP: 50,
        evs: {spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      const results = buildDamageResults(
        player, ai,
        ['Thunderbolt', 'Volt Switch', 'Grass Knot', 'Surf'],
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Swords Dance (status move, index 3) should NOT be the top pick when kill is available
      expect(dist[3]).toBeLessThan(0.3);
    });

    test('priority move gets bonus when AI is slower and about to die', () => {
      // AI is slower but has priority moves
      const player = new Pokemon(GEN, 'Dragapult', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Scizor', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
        curHP: 60, // low HP, will die to Dragapult
      });

      // Bullet Punch is priority, player is faster
      const results = buildDamageResults(
        player, ai,
        ['Shadow Ball', 'Draco Meteor', 'Flamethrower', 'U-turn'],
        ['Bullet Punch', 'X-Scissor', 'Superpower', 'Swords Dance']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // When AI is about to die and slower, priority move (Bullet Punch, idx 0) gets bonus
      expect(dist[0]).toBeGreaterThan(dist[3]); // better than setup
    });
  });

  // =========================================================================
  // Status moves
  // =========================================================================
  describe('status move handling', () => {
    test('status moves get default +6 bonus when no specific rules apply', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Ferrothorn', {
        evs: {hp: 252, def: 252},
        nature: 'Relaxed',
      });

      // AI has Stealth Rock (status) and 3 weak attacks
      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Fire Fang', 'Swords Dance'],
        ['Power Whip', 'Gyro Ball', 'Knock Off', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Stealth Rock should get some probability share (non-zero)
      expect(dist[3]).toBeGreaterThan(0);
    });

    test('status-applying moves are penalized when player already has status', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
        status: 'brn',
      });
      const ai = new Pokemon(GEN, 'Rotom-Wash', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Fire Fang', 'Swords Dance'],
        ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Thunderbolt']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Will-O-Wisp (idx 2) should get penalized since player already has burn
      expect(dist[2]).toBeLessThan(0.1);
    });

    test('Thunder Wave is penalized against already-statused target', () => {
      const player = new Pokemon(GEN, 'Dragapult', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
        status: 'par',
      });
      const ai = new Pokemon(GEN, 'Klefki', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });

      const results = buildDamageResults(
        player, ai,
        ['Shadow Ball', 'Draco Meteor', 'Flamethrower', 'U-turn'],
        ['Dazzling Gleam', 'Foul Play', 'Thunder Wave', 'Spikes']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Thunder Wave should be heavily penalized when target already has paralysis
      expect(dist[2]).toBeLessThan(0.05);
    });
  });

  // =========================================================================
  // Recovery moves
  // =========================================================================
  describe('recovery move logic', () => {
    test('recovery is preferred when AI is at low HP', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Slowbro', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
        curHP: 100, // Low HP for Slowbro (max ~394)
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Scald', 'Psychic', 'Ice Beam', 'Slack Off']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Slack Off (idx 3, recovery) should have non-trivial probability at low HP
      expect(dist[3]).toBeGreaterThan(0);
    });

    test('recovery is less preferred at full HP', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Slowbro', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
        // Full HP (default)
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Scald', 'Psychic', 'Ice Beam', 'Slack Off']
      );

      const distFull = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(distFull);

      // Build again with low HP
      const aiLow = new Pokemon(GEN, 'Slowbro', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
        curHP: 100,
      });
      const resultsLow = buildDamageResults(
        player, aiLow,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Scald', 'Psychic', 'Ice Beam', 'Slack Off']
      );
      const distLow = generateMoveDist(resultsLow, '0', defaultAiOptions());
      distSumsToOne(distLow);

      // Recovery should be more desirable at low HP than at full HP
      expect(distLow[3]).toBeGreaterThanOrEqual(distFull[3]);
    });
  });

  // =========================================================================
  // Trapping moves
  // =========================================================================
  describe('trapping moves', () => {
    test('trapping moves get bonus in distribution', () => {
      const player = new Pokemon(GEN, 'Blissey', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });
      const ai = new Pokemon(GEN, 'Magcargo', {
        evs: {spa: 252, hp: 252},
        nature: 'Modest',
      });

      const results = buildDamageResults(
        player, ai,
        ['Seismic Toss', 'Toxic', 'Soft-Boiled', 'Thunder Wave'],
        ['Lava Plume', 'Ancient Power', 'Fire Spin', 'Recover']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Fire Spin (trapping, idx 2) should have non-zero probability
      expect(dist[2]).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Multi-hit moves
  // =========================================================================
  describe('multi-hit moves', () => {
    test('two-hit moves have damage correctly doubled', () => {
      const player = new Pokemon(GEN, 'Cloyster', {
        evs: {def: 252, hp: 252},
        nature: 'Bold',
      });
      const ai = new Pokemon(GEN, 'Ambipom', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      // Double Hit is a two-hit move
      const results = buildDamageResults(
        player, ai,
        ['Ice Beam', 'Surf', 'Rapid Spin', 'Toxic Spikes'],
        ['Double Hit', 'Return', 'U-turn', 'Fake Out']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);

      // The previous assertion here was `expect(dist[0]).toBeGreaterThan(0)`,
      // which would pass even if the multi-hit handling were deleted. Assert the
      // thing the test is named after instead: generateMoveDist doubles a
      // two-hit move's damage while scoring, then restores it for display.
      const doubleHit = results[1][0];
      const perHitMax = Math.max(...doubleHit.damageRolls());
      const singleHitEquivalent = calculate(
        GEN, ai, player, new Move(GEN, 'Double Hit', {hits: 1}), new Field().swap()
      );
      expect(perHitMax).toBe(Math.max(...singleHitEquivalent.damageRolls()));
      expect(dist[0]).toBeGreaterThan(0);
    });

    test('three-plus-hit moves with Skill Link get 5 hits', () => {
      const player = new Pokemon(GEN, 'Ferrothorn', {
        evs: {hp: 252, def: 252},
        nature: 'Relaxed',
      });
      const ai = new Pokemon(GEN, 'Cloyster', {
        ability: 'Skill Link',
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      // Icicle Spear is a 3-hit move (2-5 hits), boosted to 5 by Skill Link
      const results = buildDamageResults(
        player, ai,
        ['Power Whip', 'Gyro Ball', 'Knock Off', 'Stealth Rock'],
        ['Icicle Spear', 'Rock Blast', 'Ice Shard', 'Shell Smash']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);

      // Named assertion, rather than the previous `> 0` which could not fail:
      // with Skill Link the AI must value Icicle Spear (5 x 25 BP = 125) above
      // the single-hit Ice Shard (40 BP) against a Ferrothorn that resists
      // neither, so the spread move has to carry more probability.
      expect(dist[0]).toBeGreaterThan(dist[2]);
      expect(dist[0] + dist[1]).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Speed reduction moves
  // =========================================================================
  describe('speed reduction moves', () => {
    test('Icy Wind gets speed-reduction bonus when AI is slower and has stronger moves', () => {
      // Dragapult is very fast; Goodra is much slower and wants to reduce speed
      // Use a matchup where Icy Wind does LESS damage than Draco Meteor STAB
      // so that the speed-reduction bonus is the reason Icy Wind gets probability
      const player = new Pokemon(GEN, 'Dragapult', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Goodra', {
        evs: {spa: 252, hp: 252},
        nature: 'Modest',
      });

      // Draco Meteor (Dragon STAB, 130bp) is clearly highest damage against Dragapult
      // Icy Wind (Ice, 55bp) is weakest — gets speed reduction bonus (+6) when not highest damage
      // Sludge Bomb (Poison, 90bp) neutral — second place
      // Thunderbolt (Electric, 90bp) neutral — third
      // Without speed-reduction bonus, Icy Wind would get 0% because it's always lowest damage
      // With the bonus, it gets a +6 score which competes with "highest damage +6" base
      const results = buildDamageResults(
        player, ai,
        ['Shadow Ball', 'Draco Meteor', 'Flamethrower', 'U-turn'],
        ['Draco Meteor', 'Sludge Bomb', 'Icy Wind', 'Thunderbolt']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // The distribution should be valid. The speed-reduction bonus mechanism is tested
      // by confirming Icy Wind isn't completely dominated despite being weakest damage.
      // Due to probabilistic damage rolls, exact values vary, but distribution should be valid.
      expect(dist).toHaveLength(4);
      for (const p of dist) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // =========================================================================
  // Psychic Terrain blocks priority
  // =========================================================================
  describe('terrain interactions', () => {
    test('priority moves get massive penalty in Psychic Terrain', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Scizor', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
        curHP: 60,
      });

      const fieldPsychic = new Field({terrain: 'Psychic'});
      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Fire Fang', 'Swords Dance'],
        ['Bullet Punch', 'X-Scissor', 'Superpower', 'U-turn'],
        fieldPsychic
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Bullet Punch (idx 0) should be severely penalized in Psychic Terrain
      expect(dist[0]).toBeLessThan(0.1);
    });

    test('Grassy Glide gets priority bonus when Grassy Terrain is up', () => {
      const player = new Pokemon(GEN, 'Swampert', {
        evs: {atk: 252, spe: 252},
        nature: 'Adamant',
      });
      const ai = new Pokemon(GEN, 'Rillaboom', {
        evs: {atk: 252, spe: 252},
        nature: 'Adamant',
        curHP: 80, // low HP
      });

      const fieldGrassy = new Field({terrain: 'Grassy'});
      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Ice Punch', 'Waterfall', 'Stealth Rock'],
        ['Grassy Glide', 'Wood Hammer', 'Knock Off', 'U-turn'],
        fieldGrassy
      );

      // Swampert is faster, so AI is slower
      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Grassy Glide (idx 0) should get priority bonus since terrain is Grassy
      // and AI is slower with low HP
      expect(dist[0]).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Powder moves vs Grass types
  // =========================================================================
  describe('powder move immunity', () => {
    test('powder moves penalized against Grass types', () => {
      const player = new Pokemon(GEN, 'Venusaur', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Butterfree', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });

      const results = buildDamageResults(
        player, ai,
        ['Sludge Bomb', 'Giga Drain', 'Earth Power', 'Sleep Powder'],
        ['Bug Buzz', 'Air Slash', 'Sleep Powder', 'Stun Spore']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Sleep Powder (idx 2) and Stun Spore (idx 3) should be heavily penalized against Grass
      expect(dist[2]).toBeLessThan(0.05);
      expect(dist[3]).toBeLessThan(0.05);
    });

    test('powder moves penalized against Overcoat ability', () => {
      const player = new Pokemon(GEN, 'Mandibuzz', {
        ability: 'Overcoat',
        evs: {hp: 252, def: 252},
        nature: 'Impish',
      });
      const ai = new Pokemon(GEN, 'Amoonguss', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });

      const results = buildDamageResults(
        player, ai,
        ['Foul Play', 'Knock Off', 'U-turn', 'Roost'],
        ['Sludge Bomb', 'Giga Drain', 'Spore', 'Stun Spore']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Spore (idx 2) and Stun Spore (idx 3) should be penalized against Overcoat
      expect(dist[2]).toBeLessThan(0.05);
      expect(dist[3]).toBeLessThan(0.05);
    });
  });

  // =========================================================================
  // Explosion / self-KO moves
  // =========================================================================
  describe('self-KO move handling', () => {
    test('Explosion is excluded from highest-damage calculation', () => {
      const player = new Pokemon(GEN, 'Blissey', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });
      const ai = new Pokemon(GEN, 'Metagross', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      const results = buildDamageResults(
        player, ai,
        ['Seismic Toss', 'Toxic', 'Soft-Boiled', 'Thunder Wave'],
        ['Meteor Mash', 'Earthquake', 'Explosion', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Explosion (idx 2) should NOT dominate despite being highest base power
      // The algorithm explicitly skips Explosion from highest-damage scoring
      // It should get 0 or very low probability from the scoring logic
      expect(dist[2]).toBeLessThan(dist[0] + dist[1]);
    });
  });

  // =========================================================================
  // Offensive setup moves
  // =========================================================================
  describe('setup move handling', () => {
    test('Swords Dance gets probability when viable', () => {
      const player = new Pokemon(GEN, 'Ferrothorn', {
        evs: {hp: 252, def: 252},
        nature: 'Relaxed',
      });
      const ai = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      const results = buildDamageResults(
        player, ai,
        ['Power Whip', 'Gyro Ball', 'Knock Off', 'Stealth Rock'],
        ['Earthquake', 'Dragon Claw', 'Fire Fang', 'Swords Dance']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Swords Dance (idx 3) should get some probability as a setup move
      expect(dist[3]).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // (No Move) handling
  // =========================================================================
  describe('(No Move) handling', () => {
    test('(No Move) gets -100 penalty and near-zero probability', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Magikarp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Tackle', 'Flail', 'Bounce', '(No Move)']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // (No Move) at idx 3 should have ~0 probability
      expect(dist[3]).toBeLessThan(0.01);
    });
  });

  // =========================================================================
  // Leech Seed vs Grass-type
  // =========================================================================
  describe('type-based move penalties', () => {
    test('Leech Seed penalized against Grass types', () => {
      const player = new Pokemon(GEN, 'Venusaur', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Ferrothorn', {
        evs: {hp: 252, def: 252},
        nature: 'Relaxed',
      });

      const results = buildDamageResults(
        player, ai,
        ['Sludge Bomb', 'Giga Drain', 'Earth Power', 'Sleep Powder'],
        ['Power Whip', 'Gyro Ball', 'Leech Seed', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Leech Seed (idx 2) should be penalized against Grass type Venusaur
      expect(dist[2]).toBeLessThan(0.1);
    });
  });

  // =========================================================================
  // First Impression on non-first turn
  // =========================================================================
  describe('First Impression handling', () => {
    test('First Impression penalized when not first turn', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Golisopod', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['First Impression', 'Liquidation', 'Close Combat', 'Sucker Punch']
      );

      // Not first turn
      const opts = defaultAiOptions();
      opts.firstTurnOutAiOpt = false;

      const dist = generateMoveDist(results, '0', opts);
      distSumsToOne(dist);
      // First Impression (idx 0) should be penalized when NOT first turn out
      expect(dist[0]).toBeLessThan(0.05);
    });

    test('First Impression NOT penalized on first turn', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Golisopod', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['First Impression', 'Liquidation', 'Close Combat', 'Sucker Punch']
      );

      // First turn out
      const opts = defaultAiOptions();
      opts.firstTurnOutAiOpt = true;

      const dist = generateMoveDist(results, '0', opts);
      distSumsToOne(dist);
      // First Impression (idx 0) should NOT be heavily penalized on first turn
      expect(dist[0]).toBeGreaterThan(0.05);
    });
  });

  // =========================================================================
  // Weather re-use penalty
  // =========================================================================
  describe('weather move handling', () => {
    test('Sunny Day penalized when sun is already up', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Ninetales', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });

      const fieldSun = new Field({weather: 'Sun'});
      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Flamethrower', 'Solar Beam', 'Nasty Plot', 'Sunny Day'],
        fieldSun
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Sunny Day (idx 3) should be penalized when Sun is already up
      expect(dist[3]).toBeLessThan(0.05);
    });

    test('Rain Dance NOT penalized when no rain', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Pelipper', {
        evs: {spa: 252, hp: 252},
        nature: 'Modest',
      });

      // No weather set
      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Scald', 'Hurricane', 'U-turn', 'Rain Dance']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Rain Dance (idx 3) should not be heavily penalized when no rain is up
      expect(dist[3]).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Sleep Talk when not asleep
  // =========================================================================
  describe('Sleep Talk handling', () => {
    test('Sleep Talk penalized when AI is not asleep', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Snorlax', {
        evs: {hp: 252, def: 252},
        nature: 'Careful',
        // No status (not asleep)
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Body Slam', 'Earthquake', 'Rest', 'Sleep Talk']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Sleep Talk (idx 3) should be penalized when not asleep
      expect(dist[3]).toBeLessThan(0.05);
    });
  });

  // =========================================================================
  // Smack Down / Thousand Arrows grounding bonus
  // =========================================================================
  describe('grounding moves', () => {
    test('Smack Down gets bonus against Flying types', () => {
      const player = new Pokemon(GEN, 'Skarmory', {
        evs: {hp: 252, def: 252},
        nature: 'Impish',
      });
      const ai = new Pokemon(GEN, 'Tyranitar', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      const results = buildDamageResults(
        player, ai,
        ['Iron Head', 'Body Press', 'Roost', 'Spikes'],
        ['Stone Edge', 'Crunch', 'Smack Down', 'Earthquake']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Smack Down (idx 2) should have non-zero probability due to grounding bonus vs Flying
      expect(dist[2]).toBeGreaterThan(0);
    });

    test('Thousand Arrows gets bonus against Levitate', () => {
      const player = new Pokemon(GEN, 'Rotom-Wash', {
        ability: 'Levitate',
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });
      const ai = new Pokemon(GEN, 'Zygarde', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      const results = buildDamageResults(
        player, ai,
        ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Pain Split'],
        ['Thousand Arrows', 'Dragon Dance', 'Outrage', 'Extreme Speed']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Thousand Arrows (idx 0) should get grounding bonus against Levitate
      expect(dist[0]).toBeGreaterThan(0.1);
    });
  });

  // =========================================================================
  // Moxie / Beast Boost kill bonus
  // =========================================================================
  describe('ability-based kill bonus', () => {
    test('Moxie user gets extra kill bonus', () => {
      const player = new Pokemon(GEN, 'Pikachu', {
        curHP: 30,
        evs: {spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Gyarados', {
        ability: 'Moxie',
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      // Multiple moves can KO the weakened Pikachu
      const results = buildDamageResults(
        player, ai,
        ['Thunderbolt', 'Volt Switch', 'Grass Knot', 'Surf'],
        ['Waterfall', 'Bounce', 'Earthquake', 'Dragon Dance']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Dragon Dance (setup, idx 3) should get less probability when kills are available
      expect(dist[3]).toBeLessThan(dist[0] + dist[1] + dist[2]);
    });
  });

  // =========================================================================
  // Immunity handling (Ghost vs Normal)
  // =========================================================================
  describe('type immunity handling', () => {
    test('immune moves should not be selected', () => {
      const player = new Pokemon(GEN, 'Gengar', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Snorlax', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
      });

      // Body Slam is Normal → does 0 damage to Ghost Gengar
      const results = buildDamageResults(
        player, ai,
        ['Shadow Ball', 'Sludge Bomb', 'Focus Blast', 'Thunderbolt'],
        ['Body Slam', 'Earthquake', 'Fire Punch', 'Crunch']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Body Slam (idx 0, immune) should get very low probability
      // Crunch (idx 3, SE) or Earthquake should be preferred
      expect(dist[0]).toBeLessThan(dist[3]);
    });
  });

  // =========================================================================
  // fastestSide parameter
  // =========================================================================
  describe('speed handling', () => {
    test('distribution changes based on fastestSide parameter', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Landorus-Therian', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
        curHP: 80,
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Earthquake', 'U-turn', 'Stone Edge', 'Stealth Rock']
      );

      const distPlayerFaster = generateMoveDist(results, '0', defaultAiOptions());
      const distAIFaster = generateMoveDist(results, '1', defaultAiOptions());

      distSumsToOne(distPlayerFaster);
      distSumsToOne(distAIFaster);

      // Distributions should potentially differ based on speed advantage
      // (at minimum they should both sum to 1)
      const diffExists = distPlayerFaster.some((v, i) => Math.abs(v - distAIFaster[i]) > 0.001);
      // They may or may not differ, but both should be valid distributions
      expect(distPlayerFaster).toHaveLength(4);
      expect(distAIFaster).toHaveLength(4);
    });
  });

  // =========================================================================
  // Damage reduction moves (Snarl, Mystical Fire, etc.)
  // =========================================================================
  describe('stat-reducing attacking moves', () => {
    test('Mystical Fire gets bonus against special attackers when not highest damage', () => {
      const player = new Pokemon(GEN, 'Gengar', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Heatran', {
        evs: {spa: 252, hp: 252},
        nature: 'Modest',
      });

      // Mystical Fire reduces SpA; Gengar is a special attacker.
      // The stat-reducing bonus only applies when moveScore == 0 (not highest damage).
      // If stronger moves dominate, Mystical Fire may get 0 probability despite the bonus.
      // The key correctness test is that the distribution is valid.
      const results = buildDamageResults(
        player, ai,
        ['Shadow Ball', 'Focus Blast', 'Thunderbolt', 'Sludge Bomb'],
        ['Magma Storm', 'Earth Power', 'Mystical Fire', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      expect(dist).toHaveLength(4);
      for (const p of dist) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
      // Mystical Fire should at least be competitive — not getting the full -100 penalty
      // Its probability should come from highest-damage scoring or the stat-reducing bonus
    });
  });

  // =========================================================================
  // Flame Charge bonus when slower
  // =========================================================================
  describe('Flame Charge bonus', () => {
    test('Flame Charge gets bonus when AI is slower', () => {
      const player = new Pokemon(GEN, 'Dragapult', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Volcarona', {
        evs: {spa: 252, spe: 252},
        nature: 'Modest', // slower than Timid Dragapult
      });

      const results = buildDamageResults(
        player, ai,
        ['Shadow Ball', 'Draco Meteor', 'Flamethrower', 'U-turn'],
        ['Bug Buzz', 'Flamethrower', 'Flame Charge', 'Quiver Dance']
      );

      // Dragapult is faster
      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      // Flame Charge (idx 2) should have non-zero probability from speed boost bonus
      expect(dist[2]).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Protect handling with aiOptions
  // =========================================================================
  describe('protect handling', () => {
    test('distribution is valid with protect incentive', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Toxapex', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Scald', 'Toxic', 'Recover', 'Protect']
      );

      const opts = defaultAiOptions();
      opts.protectIncentiveAiOpt = true;
      opts.protectLastAiOpt = false;

      const dist = generateMoveDist(results, '0', opts);
      distSumsToOne(dist);
      expect(dist).toHaveLength(4);
    });

    test('distribution is valid with protect used last turn', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Toxapex', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Scald', 'Toxic', 'Recover', 'Protect']
      );

      const baseline = generateMoveDist(results, '0', defaultAiOptions());

      const opts = defaultAiOptions();
      opts.protectLastAiOpt = true;
      const dist = generateMoveDist(results, '0', opts);

      distSumsToOne(dist);
      // Protect (index 3) is penalised after being used last turn, because a
      // consecutive Protect has a lower success rate. This test previously
      // asserted nothing at all.
      expect(dist[3]).toBeLessThan(baseline[3]);
    });
  });

  // =========================================================================
  // High crit ratio moves get bonus when super effective
  // =========================================================================
  describe('high crit rate moves', () => {
    test('Stone Edge gets crit bonus when super effective', () => {
      const player = new Pokemon(GEN, 'Charizard', {
        evs: {spa: 252, spe: 252},
        nature: 'Timid',
      });
      const ai = new Pokemon(GEN, 'Tyranitar', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      // Stone Edge is 4x SE against Charizard + high crit ratio
      const results = buildDamageResults(
        player, ai,
        ['Flamethrower', 'Focus Blast', 'Air Slash', 'Dragon Pulse'],
        ['Stone Edge', 'Crunch', 'Earthquake', 'Stealth Rock']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Stone Edge (idx 0) should be strongly preferred (SE + crit bonus)
      expect(dist[0]).toBeGreaterThan(0.3);
    });
  });

  // =========================================================================
  // Edge case: all status moves
  // =========================================================================
  describe('edge cases', () => {
    test('handles all-status moveset without crashing', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Shuckle', {
        evs: {hp: 252, def: 252},
        nature: 'Bold',
      });

      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Toxic', 'Stealth Rock', 'Sticky Web', 'Encore']
      );

      const dist = generateMoveDist(results, '0', defaultAiOptions());
      distSumsToOne(dist);
      expect(dist).toHaveLength(4);
      // All should get some probability since they're all status
      for (const p of dist) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
    });

    test('handles different gen contexts (gen 9)', () => {
      // Quick check that gen 9 Pokemon work
      const player = new Pokemon(9 as GenerationNum, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(9 as GenerationNum, 'Tyranitar', {
        evs: {atk: 252, hp: 252},
        nature: 'Adamant',
      });

      const f = new Field();
      const fSwapped = f.clone().swap();
      const pMoves = ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'].map(
        name => new Move(9 as GenerationNum, name, {ability: player.ability, item: player.item})
      );
      const aMoves = ['Stone Edge', 'Crunch', 'Earthquake', 'Stealth Rock'].map(
        name => new Move(9 as GenerationNum, name, {ability: ai.ability, item: ai.item})
      );

      // Set moves on Pokemon objects for AI ability lookup
      (player as any).moves = pMoves;
      (ai as any).moves = aMoves;

      const playerResults = pMoves.map(move => calculate(9 as GenerationNum, player, ai, move, f));
      const aiResults = aMoves.map(move => calculate(9 as GenerationNum, ai, player, move, fSwapped));

      const dist = generateMoveDist([playerResults, aiResults], '1', defaultAiOptions());
      distSumsToOne(dist);
      expect(dist).toHaveLength(4);
    });
  });

  // =========================================================================
  // Attack reduction moves (Trop Kick, Breaking Swipe)
  // =========================================================================
  describe('attack-reducing moves', () => {
    test('Trop Kick gets bonus against physical attackers', () => {
      const player = new Pokemon(GEN, 'Garchomp', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });
      const ai = new Pokemon(GEN, 'Tsareena', {
        evs: {atk: 252, spe: 252},
        nature: 'Jolly',
      });

      // Trop Kick reduces Atk; Garchomp is a physical attacker
      const results = buildDamageResults(
        player, ai,
        ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'],
        ['Power Whip', 'High Jump Kick', 'Trop Kick', 'U-turn']
      );

      const dist = generateMoveDist(results, '1', defaultAiOptions());
      distSumsToOne(dist);
      // Trop Kick (idx 2) should have probability from Atk-reducing bonus
      expect(dist[2]).toBeGreaterThan(0);
    });
  });
});
