/**
 * Tests for the MoveDB module.
 *
 * We load the raw BattleMovedex into the jsdom window, then
 * load move_db.js which reads it and builds the cache.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');

function loadScript(filename) {
    const code = fs.readFileSync(path.join(SRC, filename), 'utf8');
    const indirectEval = eval;
    indirectEval(code);
}

beforeAll(() => {
    // BattleMovedex is a CommonJS export; stub the exports object
    window.exports = {};
    loadScript('data/rbdex/moves.js');
    window.BattleMovedex = window.exports.BattleMovedex;
    loadScript('data/move_db.js');
    window.MoveDB.init();
});

describe('MoveDB.get', () => {
    test('returns null for unknown move', () => {
        expect(window.MoveDB.get('NotARealMove')).toBeNull();
        expect(window.MoveDB.get('')).toBeNull();
        expect(window.MoveDB.get(null)).toBeNull();
    });

    test('finds moves by display name', () => {
        const tb = window.MoveDB.get('Thunderbolt');
        expect(tb).not.toBeNull();
        expect(tb.name).toBe('Thunderbolt');
        expect(tb.type).toBe('Electric');
        expect(tb.category).toBe('Special');
        expect(tb.basePower).toBe(90);
    });

    test('finds moves case-insensitively', () => {
        expect(window.MoveDB.get('swords dance')).not.toBeNull();
        expect(window.MoveDB.get('SWORDS DANCE')).not.toBeNull();
    });

    test('strips non-alphanumeric characters', () => {
        expect(window.MoveDB.get("Will-O-Wisp")).not.toBeNull();
        expect(window.MoveDB.get("King's Shield")).not.toBeNull();
    });
});

describe('MoveDB.isStatus', () => {
    test('identifies status moves', () => {
        expect(window.MoveDB.isStatus('Swords Dance')).toBe(true);
        expect(window.MoveDB.isStatus('Thunder Wave')).toBe(true);
        expect(window.MoveDB.isStatus('Stealth Rock')).toBe(true);
    });

    test('identifies non-status moves', () => {
        expect(window.MoveDB.isStatus('Thunderbolt')).toBe(false);
        expect(window.MoveDB.isStatus('Close Combat')).toBe(false);
    });
});

describe('Drain moves', () => {
    test('Absorb has drain effect', () => {
        const fx = window.MoveDB.getEffects('Absorb');
        expect(fx.drain).toEqual({ numerator: 1, denominator: 2 });
        expect(window.MoveDB.hasEffect('Absorb', 'drain')).toBe(true);
    });

    test('Giga Drain has drain effect', () => {
        expect(window.MoveDB.hasEffect('Giga Drain', 'drain')).toBe(true);
    });

    test('Thunderbolt has no drain', () => {
        expect(window.MoveDB.hasEffect('Thunderbolt', 'drain')).toBe(false);
    });
});

describe('Recoil moves', () => {
    test('Brave Bird has recoil', () => {
        const fx = window.MoveDB.getEffects('Brave Bird');
        expect(fx.recoil).toEqual({ numerator: 33, denominator: 100 });
        expect(window.MoveDB.hasEffect('Brave Bird', 'recoil')).toBe(true);
    });

    test('Flare Blitz has both recoil and secondary burn', () => {
        const fx = window.MoveDB.getEffects('Flare Blitz');
        expect(fx.recoil).not.toBeNull();
        expect(fx.secondaries.length).toBeGreaterThan(0);
        expect(fx.secondaries[0].status).toBe('brn');
        expect(fx.secondaries[0].chance).toBe(10);
    });
});

describe('Heal moves', () => {
    test('Recover has heal', () => {
        const fx = window.MoveDB.getEffects('Recover');
        expect(fx.heal).toEqual({ numerator: 1, denominator: 2 });
        expect(window.MoveDB.hasEffect('Recover', 'heal')).toBe(true);
    });
});

describe('Status-inflicting moves', () => {
    test('Thunder Wave sets paralysis', () => {
        const fx = window.MoveDB.getEffects('Thunder Wave');
        expect(fx.status).toBe('par');
    });

    test('Toxic sets toxic', () => {
        const fx = window.MoveDB.getEffects('Toxic');
        expect(fx.status).toBe('tox');
    });

    test('Will-O-Wisp sets burn', () => {
        const fx = window.MoveDB.getEffects('Will-O-Wisp');
        expect(fx.status).toBe('brn');
    });

    test('Spore sets sleep', () => {
        const fx = window.MoveDB.getEffects('Spore');
        expect(fx.status).toBe('slp');
    });
});

describe('Self-boost moves', () => {
    test('Swords Dance: +2 atk', () => {
        const fx = window.MoveDB.getEffects('Swords Dance');
        expect(fx.selfBoosts).toEqual({ atk: 2 });
    });

    test('Dragon Dance: +1 atk, +1 spe', () => {
        const fx = window.MoveDB.getEffects('Dragon Dance');
        expect(fx.selfBoosts).toEqual({ atk: 1, spe: 1 });
    });

    test('Shell Smash: mixed boosts and drops', () => {
        const fx = window.MoveDB.getEffects('Shell Smash');
        expect(fx.selfBoosts.atk).toBe(2);
        expect(fx.selfBoosts.spa).toBe(2);
        expect(fx.selfBoosts.spe).toBe(2);
        expect(fx.selfBoosts.def).toBe(-1);
        expect(fx.selfBoosts.spd).toBe(-1);
    });

    test('Acid Armor: +2 def (target=self)', () => {
        const fx = window.MoveDB.getEffects('Acid Armor');
        expect(fx.selfBoosts).toEqual({ def: 2 });
        expect(fx.targetBoosts).toBeNull();
    });
});

describe('Target-lowering moves', () => {
    test('Growl: -1 atk on target', () => {
        const fx = window.MoveDB.getEffects('Growl');
        expect(fx.targetBoosts).toEqual({ atk: -1 });
    });

    test('Screech: -2 def on target', () => {
        const fx = window.MoveDB.getEffects('Screech');
        expect(fx.targetBoosts).toEqual({ def: -2 });
    });
});

describe('Self stat drops on damaging moves', () => {
    test('Close Combat: self drops via self.boosts', () => {
        const entry = window.MoveDB.get('Close Combat');
        expect(entry.effects.selfBoosts).toEqual({ def: -1, spd: -1 });
        expect(entry.category).toBe('Physical');
    });

    test('Overheat: self spa-2 via self.boosts', () => {
        const fx = window.MoveDB.getEffects('Overheat');
        expect(fx.selfBoosts).toEqual({ spa: -2 });
    });
});

describe('Secondary effects', () => {
    test('Thunderbolt: 10% paralysis', () => {
        const secs = window.MoveDB.getSecondaries('Thunderbolt');
        expect(secs.length).toBe(1);
        expect(secs[0].status).toBe('par');
        expect(secs[0].chance).toBe(10);
    });

    test('Scald: 30% burn', () => {
        const secs = window.MoveDB.getSecondaries('Scald');
        expect(secs.length).toBe(1);
        expect(secs[0].status).toBe('brn');
        expect(secs[0].chance).toBe(30);
    });

    test('Acid: 10% spd-1 on target', () => {
        const secs = window.MoveDB.getSecondaries('Acid');
        expect(secs.length).toBe(1);
        expect(secs[0].targetBoosts).toEqual({ spd: -1 });
        expect(secs[0].chance).toBe(10);
    });
});

describe('Multiple secondaries (secondaries array)', () => {
    test('Fire Fang: 10% burn + 10% flinch', () => {
        const secs = window.MoveDB.getSecondaries('Fire Fang');
        expect(secs.length).toBe(2);
        var burn = secs.find(function (s) { return s.status === 'brn'; });
        var flinch = secs.find(function (s) { return s.volatileStatus === 'flinch'; });
        expect(burn).toBeTruthy();
        expect(burn.chance).toBe(10);
        expect(flinch).toBeTruthy();
        expect(flinch.chance).toBe(10);
    });

    test('Thunder Fang: 10% par + 10% flinch', () => {
        const secs = window.MoveDB.getSecondaries('Thunder Fang');
        expect(secs.length).toBe(2);
    });

    test('Ice Fang: 10% freeze + 10% flinch', () => {
        const secs = window.MoveDB.getSecondaries('Ice Fang');
        expect(secs.length).toBe(2);
    });
});

describe('Flinch detection', () => {
    test('Air Slash has flinch', () => {
        expect(window.MoveDB.hasEffect('Air Slash', 'flinch')).toBe(true);
    });

    test('Iron Head has flinch', () => {
        expect(window.MoveDB.hasEffect('Iron Head', 'flinch')).toBe(true);
    });

    test('Fake Out has flinch', () => {
        expect(window.MoveDB.hasEffect('Fake Out', 'flinch')).toBe(true);
    });

    test('Fire Fang has flinch via secondaries array', () => {
        expect(window.MoveDB.hasEffect('Fire Fang', 'flinch')).toBe(true);
    });

    test('Thunderbolt does NOT have flinch', () => {
        expect(window.MoveDB.hasEffect('Thunderbolt', 'flinch')).toBe(false);
    });
});

describe('Confusion detection', () => {
    test('Confuse Ray has confusion as primary volatile', () => {
        const fx = window.MoveDB.getEffects('Confuse Ray');
        expect(fx.volatileStatus).toBe('confusion');
        expect(window.MoveDB.hasEffect('Confuse Ray', 'confusion')).toBe(true);
    });

    test('Dynamic Punch has confusion as secondary', () => {
        expect(window.MoveDB.hasEffect('DynamicPunch', 'confusion')).toBe(true);
    });
});

describe('Volatile status', () => {
    test('Attract sets attract', () => {
        const fx = window.MoveDB.getEffects('Attract');
        expect(fx.volatileStatus).toBe('attract');
    });

    test('Encore sets encore', () => {
        const fx = window.MoveDB.getEffects('Encore');
        expect(fx.volatileStatus).toBe('encore');
    });

    test('Leech Seed sets leechseed', () => {
        const fx = window.MoveDB.getEffects('Leech Seed');
        expect(fx.volatileStatus).toBe('leechseed');
    });

    test('Taunt sets taunt', () => {
        const fx = window.MoveDB.getEffects('Taunt');
        expect(fx.volatileStatus).toBe('taunt');
    });
});

describe('Self volatile status', () => {
    test('Hyper Beam: must recharge', () => {
        const fx = window.MoveDB.getEffects('Hyper Beam');
        expect(fx.selfVolatile).toBe('mustrecharge');
    });
});

describe('Side conditions', () => {
    test('Stealth Rock', () => {
        expect(window.MoveDB.getSideCondition('Stealth Rock')).toBe('stealthrock');
        expect(window.MoveDB.hasEffect('Stealth Rock', 'sideCondition')).toBe(true);
    });

    test('Spikes', () => {
        expect(window.MoveDB.getSideCondition('Spikes')).toBe('spikes');
    });

    test('Toxic Spikes', () => {
        expect(window.MoveDB.getSideCondition('Toxic Spikes')).toBe('toxicspikes');
    });

    test('Sticky Web', () => {
        expect(window.MoveDB.getSideCondition('Sticky Web')).toBe('stickyweb');
    });

    test('Reflect', () => {
        expect(window.MoveDB.getSideCondition('Reflect')).toBe('reflect');
    });

    test('Light Screen', () => {
        expect(window.MoveDB.getSideCondition('Light Screen')).toBe('lightscreen');
    });

    test('Aurora Veil', () => {
        expect(window.MoveDB.getSideCondition('Aurora Veil')).toBe('auroraveil');
    });

    test('Tailwind', () => {
        expect(window.MoveDB.getSideCondition('Tailwind')).toBe('tailwind');
    });
});

describe('Weather moves', () => {
    test('Rain Dance sets rain', () => {
        const fx = window.MoveDB.getEffects('Rain Dance');
        expect(fx.weather).toBe('RainDance');
        expect(window.MoveDB.hasEffect('Rain Dance', 'weather')).toBe(true);
    });

    test('Sunny Day sets sun', () => {
        expect(window.MoveDB.hasEffect('Sunny Day', 'weather')).toBe(true);
    });

    test('Sandstorm sets sand', () => {
        expect(window.MoveDB.hasEffect('Sandstorm', 'weather')).toBe(true);
    });

    test('Hail sets hail', () => {
        expect(window.MoveDB.hasEffect('Hail', 'weather')).toBe(true);
    });
});

describe('Terrain moves', () => {
    test('Electric Terrain', () => {
        const fx = window.MoveDB.getEffects('Electric Terrain');
        expect(fx.terrain).toBe('electricterrain');
        expect(window.MoveDB.hasEffect('Electric Terrain', 'terrain')).toBe(true);
    });

    test('Grassy Terrain', () => {
        expect(window.MoveDB.hasEffect('Grassy Terrain', 'terrain')).toBe(true);
    });

    test('Psychic Terrain', () => {
        expect(window.MoveDB.hasEffect('Psychic Terrain', 'terrain')).toBe(true);
    });

    test('Misty Terrain', () => {
        expect(window.MoveDB.hasEffect('Misty Terrain', 'terrain')).toBe(true);
    });
});

describe('Self-switch moves', () => {
    test('U-turn', () => {
        expect(window.MoveDB.getSelfSwitch('U-turn')).toBe(true);
        expect(window.MoveDB.hasEffect('U-turn', 'selfSwitch')).toBe(true);
    });

    test('Volt Switch', () => {
        expect(window.MoveDB.getSelfSwitch('Volt Switch')).toBe(true);
    });

    test('Baton Pass copies volatiles', () => {
        expect(window.MoveDB.getSelfSwitch('Baton Pass')).toBe('copyvolatile');
    });
});

describe('Force-switch moves', () => {
    test('Roar', () => {
        expect(window.MoveDB.hasEffect('Roar', 'forceSwitch')).toBe(true);
    });

    test('Whirlwind', () => {
        expect(window.MoveDB.hasEffect('Whirlwind', 'forceSwitch')).toBe(true);
    });

    test('Dragon Tail', () => {
        expect(window.MoveDB.hasEffect('Dragon Tail', 'forceSwitch')).toBe(true);
    });
});

describe('Self-destruct moves', () => {
    test('Explosion', () => {
        expect(window.MoveDB.hasEffect('Explosion', 'selfDestruct')).toBe(true);
        expect(window.MoveDB.getEffects('Explosion').selfDestruct).toBe('always');
    });

    test('Self-Destruct', () => {
        expect(window.MoveDB.hasEffect('Self-Destruct', 'selfDestruct')).toBe(true);
    });
});

describe('Multihit moves', () => {
    test('Dual Chop hits twice', () => {
        const fx = window.MoveDB.getEffects('Dual Chop');
        expect(fx.multihit).toBe(2);
    });

    test('Bullet Seed hits 2-5 times', () => {
        const fx = window.MoveDB.getEffects('Bullet Seed');
        expect(fx.multihit).toEqual([2, 5]);
    });
});

describe('Will-crit and crit ratio', () => {
    test('Frost Breath always crits', () => {
        const entry = window.MoveDB.get('Frost Breath');
        expect(entry.willCrit).toBe(true);
    });

    test('Storm Throw always crits', () => {
        expect(window.MoveDB.get('Storm Throw').willCrit).toBe(true);
    });

    test('Slash has high crit ratio', () => {
        expect(window.MoveDB.get('Slash').critRatio).toBe(2);
    });

    test('Thunderbolt has normal crit ratio', () => {
        expect(window.MoveDB.get('Thunderbolt').critRatio).toBe(1);
    });
});

describe('MoveDB.getAll', () => {
    test('returns a large set of moves', () => {
        const all = window.MoveDB.getAll();
        expect(Object.keys(all).length).toBeGreaterThan(600);
    });
});

describe('Edge cases', () => {
    test('Move with both primary status and secondary', () => {
        // Dire Claw has status and secondary volatileStatus 
        // But most normal cases: a move like Scald has secondary only
        const fx = window.MoveDB.getEffects('Scald');
        expect(fx.status).toBeNull();
        expect(fx.secondaries.length).toBe(1);
        expect(fx.secondaries[0].status).toBe('brn');
    });

    test('Fake Out has flinch as secondary with 100% chance', () => {
        const secs = window.MoveDB.getSecondaries('Fake Out');
        expect(secs.length).toBe(1);
        expect(secs[0].volatileStatus).toBe('flinch');
        expect(secs[0].chance).toBe(100);
    });

    test('Rest has no explicit heal field (handled by game logic)', () => {
        const fx = window.MoveDB.getEffects('Rest');
        // RBDex does not store a heal field for Rest; the full-HP restore
        // and sleep are handled in battle_planner_ui applyMoveToStateEnhanced
        expect(fx.heal).toBeNull();
    });
});
