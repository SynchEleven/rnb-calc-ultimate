import * as fs from 'fs';
import * as path from 'path';

import {calculate, Pokemon, Move} from '../adaptable';
import * as I from '../data/interface';

import * as calc from '../index';
import {Dex} from '@pkmn/dex';
import {Generations} from './gen';

const pkmn = {Generations: new Generations(Dex)};

const gens = [1, 2, 3, 4, 5, 6, 7, 8, 9] as I.GenerationNum[];

describe('Generations', () => {
  test('abilities', () => {
    for (const gen of gens) {
      const p = Array.from(pkmn.Generations.get(gen).abilities);
      const c = new Map<I.ID, I.Ability>();
      for (const ability of calc.Generations.get(gen).abilities) c.set(ability.id, ability);

      expect(Array.from(c.values()).map(s => s.name).sort()).toEqual(p.map(s => s.name).sort());
      for (const ability of p) {
        expect(c.get(ability.id)).toEqual(ability);
        c.delete(ability.id);
      }
      expect(c.size).toBe(0);
    }
  });

  test('items', () => {
    for (const gen of gens) {
      const p = Array.from(pkmn.Generations.get(gen).items);
      const c = new Map<I.ID, I.Item>();
      for (const item of calc.Generations.get(gen).items) c.set(item.id, item);

      expect(Array.from(c.values()).map(s => s.name).sort()).toEqual(p.map(s => s.name).sort());
      for (const item of p) {
        expect(c.get(item.id)).toEqual(item);
        c.delete(item.id);
      }
      expect(c.size).toBe(0);
    }
  });

  // Compares against Smogon standard @pkmn/dex, which RnB deliberately diverges
  // from (Super Fang Normal->Dark, Absorb BP 40->20, ...). The RnB-aware
  // replacement is the 'RnB data consistency' block at the bottom of this file,
  // which checks the two RnB data sources against EACH OTHER.
  // eslint-disable-next-line jest/no-disabled-tests
  test.skip('moves (vanilla Smogon baseline)', () => {
    for (const gen of gens) {
      const p = Array.from(pkmn.Generations.get(gen).moves);
      const c = new Map<I.ID, I.Move>();
      for (const move of calc.Generations.get(gen).moves) c.set(move.id, move);

      expect(Array.from(c.values()).map(s => s.name).sort()).toEqual(p.map(s => s.name).sort());
      for (const move of p) {
        // Formerly toEqual, relax a bit so the calc can have properties aren't in pkmn/dex.
        for (const [k, v] of Object.entries(move)) {
          if (v === undefined) {
            delete (move as any)[k];
          }
        }
        expect(c.get(move.id)).toMatchObject(move);
        c.delete(move.id);
      }
      expect(c.size).toBe(0);
    }
  });

  // See the note on 'moves' above.
  // eslint-disable-next-line jest/no-disabled-tests
  test.skip('species (vanilla Smogon baseline)', () => {
    for (const gen of gens) {
      const p = Array.from(pkmn.Generations.get(gen).species);
      const c = new Map<I.ID, I.Specie>();
      for (const specie of calc.Generations.get(gen).species) c.set(specie.id, specie);
      expect(Array.from(c.values()).map(s => s.name).sort()).toEqual(p.map(s => s.name).sort());
      for (const specie of p) {
        expect(c.get(specie.id)).toEqual(specie);
        c.delete(specie.id);
      }
      expect(c.size).toBe(0);
    }
  });

  test('types', () => {
    for (const gen of gens) {
      const p = Array.from(pkmn.Generations.get(gen).types);
      const c = new Map<I.ID, I.Type>();
      for (const type of calc.Generations.get(gen).types) c.set(type.id, type);

      expect(Array.from(c.values()).map(s => s.name).sort()).toEqual(p.map(s => s.name).sort());
      for (const type of p) {
        expect(c.get(type.id)).toEqual(type);
        c.delete(type.id);
      }
      expect(c.size).toBe(0);
    }
  });

  test('natures', () => {
    for (const gen of gens) {
      const p = Array.from(pkmn.Generations.get(gen).natures);
      const c = new Map<I.ID, I.Nature>();
      for (const nature of calc.Generations.get(gen).natures) c.set(nature.id, nature);

      expect(Array.from(c.values()).map(s => s.name).sort()).toEqual(p.map(s => s.name).sort());
      for (const nature of p) {
        expect(c.get(nature.id)).toEqual(nature);
        c.delete(nature.id);
      }
      expect(c.size).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// RnB data consistency
// ---------------------------------------------------------------------------
//
// This project carries TWO independent copies of the game data:
//
//   calc/src/data/{species,moves}.ts   -> drives damage calculation
//   src/js/data/rbdex/{pokedex,moves}.js -> drives the UI, MoveDB and the AI
//
// Nothing used to check that they agreed, and they did not: six species had
// different base stats and three moves used by real trainer sets had different
// base powers, so the numbers on screen contradicted the numbers being
// calculated. rbdex is a dump of the ROM's own data and is therefore the source
// of truth; these tests fail if the engine drifts away from it again.
describe('RnB data consistency (calc vs rbdex)', () => {
  const RBDEX_DIR = path.resolve(__dirname, '../../../src/js/data/rbdex');

  function loadRbdex<T>(file: string, key: string): T {
    const code = fs.readFileSync(path.join(RBDEX_DIR, file), 'utf8');
    const sandbox: any = {};
    // These data files are plain CommonJS assigned onto `exports`; evaluating
    // them in a sandbox object is the least intrusive way to read them from a
    // test without adding a build step.
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    new Function('exports', 'module', code)(sandbox, {exports: sandbox});
    return sandbox[key] as T;
  }

  const dex = loadRbdex<{[id: string]: any}>('pokedex.js', 'BattlePokedex');
  const movedex = loadRbdex<{[id: string]: any}>('moves.js', 'BattleMovedex');
  const gen = calc.Generations.get(8);
  const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '') as I.ID;

  // Cosmetic formes and Bond/Neutral formes the engine has no reason to model.
  const SPECIES_NOT_IN_ENGINE = new Set([
    'pikachucosplay', 'pikachurockstar', 'pikachubelle', 'pikachupopstar',
    'pikachuphd', 'pikachulibre', 'pikachustarter', 'eeveestarter',
    'pichuspikyeared', 'greninjabond', 'aegislash', 'xerneasneutral',
  ]);

  test('base stats agree for every species', () => {
    const mismatches: string[] = [];

    for (const key of Object.keys(dex)) {
      const raw = dex[key];
      if (!raw?.baseStats || !raw.name) continue;
      if (SPECIES_NOT_IN_ENGINE.has(id(raw.name))) continue;

      const specie = gen.species.get(id(raw.name));
      if (!specie) continue;

      for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
        if (specie.baseStats[stat] !== raw.baseStats[stat]) {
          mismatches.push(
            `${raw.name} ${stat}: calc=${specie.baseStats[stat]} rbdex=${raw.baseStats[stat]}`
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  test('types agree for every species', () => {
    const mismatches: string[] = [];

    for (const key of Object.keys(dex)) {
      const raw = dex[key];
      if (!raw?.types || !raw.name) continue;
      if (SPECIES_NOT_IN_ENGINE.has(id(raw.name))) continue;

      const specie = gen.species.get(id(raw.name));
      if (!specie) continue;

      const calcTypes = (specie.types || []).join('/');
      const rbdexTypes = raw.types.join('/');
      if (calcTypes !== rbdexTypes) {
        mismatches.push(`${raw.name}: calc=${calcTypes} rbdex=${rbdexTypes}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  test('default abilities agree for every species', () => {
    const mismatches: string[] = [];

    for (const key of Object.keys(dex)) {
      const raw = dex[key];
      if (!raw?.abilities || !raw.name) continue;
      if (SPECIES_NOT_IN_ENGINE.has(id(raw.name))) continue;

      const specie = gen.species.get(id(raw.name));
      if (!specie) continue;

      const calcAbility = specie.abilities ? specie.abilities[0] : undefined;
      const rbdexAbility = raw.abilities['0'];
      if (rbdexAbility && calcAbility !== rbdexAbility) {
        mismatches.push(`${raw.name}: calc=${calcAbility} rbdex=${rbdexAbility}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  test('base power, type and category agree for every move', () => {
    const bpMismatches: string[] = [];
    const typeMismatches: string[] = [];

    // Return/Frustration have variable BP: the table stores 0 and the Move
    // constructor resolves it at runtime.
    const VARIABLE_BP = new Set(['return', 'frustration']);

    for (const key of Object.keys(movedex)) {
      const raw = movedex[key];
      if (!raw?.name) continue;

      const move = gen.moves.get(id(raw.name));
      if (!move) continue;

      if (!VARIABLE_BP.has(id(raw.name)) &&
          typeof raw.basePower === 'number' && raw.basePower > 0 &&
          move.basePower !== raw.basePower) {
        bpMismatches.push(`${raw.name}: calc=${move.basePower} rbdex=${raw.basePower}`);
      }

      if (move.type !== raw.type) {
        typeMismatches.push(`${raw.name}: calc=${move.type} rbdex=${raw.type}`);
      }
      if (raw.category && move.category !== raw.category) {
        typeMismatches.push(`${raw.name}: calc=${move.category} rbdex=${raw.category}`);
      }
    }

    expect(bpMismatches).toEqual([]);
    expect(typeMismatches).toEqual([]);
  });

  test('every move a trainer set can use exists in the engine', () => {
    const setsFile = path.resolve(__dirname, '../../../src/js/data/sets/gen8.js');
    const code = fs.readFileSync(setsFile, 'utf8');
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    const SETDEX = new Function(`${code}; return SETDEX_SS;`)() as {[k: string]: any};

    const missingSpecies: string[] = [];
    const missingMoves = new Set<string>();

    for (const species of Object.keys(SETDEX)) {
      if (!gen.species.get(id(species))) {
        missingSpecies.push(species);
        continue;
      }
      for (const trainer of Object.keys(SETDEX[species])) {
        for (const moveName of (SETDEX[species][trainer].moves || [])) {
          if (!moveName) continue;
          if (!gen.moves.get(id(moveName))) missingMoves.add(moveName);
        }
      }
    }

    expect(missingSpecies).toEqual([]);
    expect(Array.from(missingMoves)).toEqual([]);
  });

  test('custom RnB moves exist in both sources', () => {
    for (const name of ['Paleo Wave', 'Shadow Strike']) {
      expect(gen.moves.get(id(name))).toBeDefined();
      expect(movedex[id(name)]).toBeDefined();
    }
  });
});

describe('Adaptable', () => {
  test('usage', () => {
    const gen = pkmn.Generations.get(5);
    const result = calculate(
      gen,
      new Pokemon(gen, 'Gengar', {
        item: 'Choice Specs' as I.ItemName,
        nature: 'Timid',
        evs: {spa: 252},
        boosts: {spa: 1},
      }),
      new Pokemon(gen, 'Chansey', {
        item: 'Eviolite' as I.ItemName,
        nature: 'Calm',
        evs: {hp: 252, spd: 252},
      }),
      new Move(gen, 'Focus Blast')
    );
    expect(result.range()).toEqual([274, 324]);
  });
});
