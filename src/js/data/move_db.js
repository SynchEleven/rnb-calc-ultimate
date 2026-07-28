/**
 * MoveDB – Single source of truth for move effects in the battle planner.
 *
 * Reads BattleMovedex (RBDex) at init and normalizes every move's raw
 * fields into a consistent effects descriptor.  All downstream code
 * (calc_integration, battle_planner_logic, battle_planner_ui) should
 * query MoveDB instead of maintaining hardcoded move-name maps.
 *
 * Exposed on `window.MoveDB`.
 */
(function () {
    'use strict';

    var cache = {};

    function toID(name) {
        return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    /**
     * Normalize a single RBDex move entry into a MoveDB descriptor.
     */
    function normalize(raw) {
        var isStatus = raw.category === 'Status';
        var effects = {
            damage: raw.basePower > 0,
            drain: raw.drain ? { numerator: raw.drain[0], denominator: raw.drain[1] } : null,
            recoil: raw.recoil ? { numerator: raw.recoil[0], denominator: raw.recoil[1] } : null,
            heal: raw.heal ? { numerator: raw.heal[0], denominator: raw.heal[1] } : null,
            selfDestruct: raw.selfdestruct || null,
            multihit: raw.multihit || null,

            status: raw.status || null,
            // A volatile on a self-targeting move (Protect, Detect, Aqua Ring,
            // Ingrain, Focus Energy...) lands on the USER. Storing it as a
            // target volatile made the executor protect the opponent.
            volatileStatus: (raw.volatileStatus && raw.target !== 'self')
                ? raw.volatileStatus : null,

            selfBoosts: null,
            targetBoosts: null,
            selfVolatile: (raw.volatileStatus && raw.target === 'self')
                ? raw.volatileStatus : null,
            selfStatus: null,

            selfSwitch: raw.selfSwitch || false,
            forceSwitch: raw.forceSwitch || false,

            sideCondition: raw.sideCondition || null,
            weather: raw.weather || null,
            terrain: raw.terrain || null,

            secondaries: [],

            desc: raw.desc || '',
            shortDesc: raw.shortDesc || ''
        };

        // Boosts: if the move targets self (status moves with boosts like
        // Swords Dance), these are self-boosts. If the move targets the
        // opponent (Growl, Leer), they're target boosts.
        if (raw.boosts) {
            if (raw.target === 'self' || raw.target === 'allySide' || raw.target === 'allies') {
                effects.selfBoosts = raw.boosts;
            } else {
                effects.targetBoosts = raw.boosts;
            }
        }

        // Self-effects (Close Combat self-drops, Overheat spa-2, etc.)
        if (raw.self) {
            if (raw.self.boosts) {
                effects.selfBoosts = effects.selfBoosts || {};
                var stats = Object.keys(raw.self.boosts);
                for (var i = 0; i < stats.length; i++) {
                    effects.selfBoosts[stats[i]] = (effects.selfBoosts[stats[i]] || 0) + raw.self.boosts[stats[i]];
                }
            }
            if (raw.self.volatileStatus) {
                effects.selfVolatile = raw.self.volatileStatus;
            }
            if (raw.self.status) {
                effects.selfStatus = raw.self.status;
            }
        }

        // Merge `secondary` (single) and `secondaries` (array) into one list
        if (raw.secondary && raw.secondary !== true) {
            effects.secondaries.push(normalizeSecondary(raw.secondary));
        }
        if (raw.secondaries && Array.isArray(raw.secondaries)) {
            for (var s = 0; s < raw.secondaries.length; s++) {
                effects.secondaries.push(normalizeSecondary(raw.secondaries[s]));
            }
        }

        return {
            id: toID(raw.name),
            name: raw.name,
            type: raw.type,
            basePower: raw.basePower || 0,
            accuracy: raw.accuracy,
            category: raw.category,
            priority: raw.priority || 0,
            pp: raw.pp || 0,
            flags: raw.flags || {},
            target: raw.target || 'normal',
            willCrit: !!raw.willCrit,
            critRatio: raw.critRatio || 1,
            effects: effects
        };
    }

    function normalizeSecondary(sec) {
        var result = { chance: sec.chance || 100 };
        if (sec.status) result.status = sec.status;
        if (sec.volatileStatus) result.volatileStatus = sec.volatileStatus;
        if (sec.boosts) result.targetBoosts = sec.boosts;
        if (sec.self) {
            if (sec.self.boosts) result.selfBoosts = sec.self.boosts;
            if (sec.self.volatileStatus) result.selfVolatile = sec.self.volatileStatus;
            if (sec.self.status) result.selfStatus = sec.self.status;
        }
        return result;
    }

    /**
     * Initialize the cache from BattleMovedex.
     * Called once on first access or explicitly via MoveDB.init().
     */
    function init() {
        cache = {};
        var source = (typeof window !== 'undefined' && window.BattleMovedex) ||
                     (typeof exports !== 'undefined' && exports.BattleMovedex) ||
                     null;
        if (!source) return;

        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; i++) {
            var raw = source[keys[i]];
            if (!raw || !raw.name) continue;
            var entry = normalize(raw);
            cache[entry.id] = entry;
        }
    }

    // --- Public API ---

    function get(moveName) {
        if (!moveName) return null;
        var id = toID(moveName);
        if (!cache[id] && Object.keys(cache).length === 0) {
            init();
        }
        return cache[id] || null;
    }

    function getEffects(moveName) {
        var entry = get(moveName);
        return entry ? entry.effects : null;
    }

    function isStatus(moveName) {
        var entry = get(moveName);
        return entry ? entry.category === 'Status' : false;
    }

    function getSecondaries(moveName) {
        var entry = get(moveName);
        return entry ? entry.effects.secondaries : [];
    }

    function hasEffect(moveName, effectType) {
        var fx = getEffects(moveName);
        if (!fx) return false;

        switch (effectType) {
            case 'drain': return !!fx.drain;
            case 'recoil': return !!fx.recoil;
            case 'heal': return !!fx.heal;
            case 'status': return !!fx.status;
            case 'volatileStatus': return !!fx.volatileStatus;
            case 'selfBoosts': return !!fx.selfBoosts;
            case 'targetBoosts': return !!fx.targetBoosts;
            case 'selfSwitch': return !!fx.selfSwitch;
            case 'forceSwitch': return !!fx.forceSwitch;
            case 'sideCondition': return !!fx.sideCondition;
            case 'weather': return !!fx.weather;
            case 'terrain': return !!fx.terrain;
            case 'selfDestruct': return !!fx.selfDestruct;
            case 'multihit': return !!fx.multihit;
            case 'flinch':
                if (fx.volatileStatus === 'flinch') return true;
                for (var i = 0; i < fx.secondaries.length; i++) {
                    if (fx.secondaries[i].volatileStatus === 'flinch') return true;
                }
                return false;
            case 'confusion':
                if (fx.volatileStatus === 'confusion') return true;
                for (var j = 0; j < fx.secondaries.length; j++) {
                    if (fx.secondaries[j].volatileStatus === 'confusion') return true;
                }
                return false;
            default: return false;
        }
    }

    function getSideCondition(moveName) {
        var fx = getEffects(moveName);
        return fx ? fx.sideCondition : null;
    }

    function getSelfSwitch(moveName) {
        var fx = getEffects(moveName);
        return fx ? fx.selfSwitch : false;
    }

    function getAll() {
        if (Object.keys(cache).length === 0) init();
        return cache;
    }

    var MoveDB = {
        init: init,
        get: get,
        getEffects: getEffects,
        isStatus: isStatus,
        getSecondaries: getSecondaries,
        hasEffect: hasEffect,
        getSideCondition: getSideCondition,
        getSelfSwitch: getSelfSwitch,
        getAll: getAll,
        toID: toID
    };

    if (typeof window !== 'undefined') {
        window.MoveDB = MoveDB;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MoveDB;
    }
})();
