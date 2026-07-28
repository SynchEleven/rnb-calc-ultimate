/**
 * Calculator Integration for Battle Planner
 * 
 * Wraps the existing @smogon/calc engine to provide:
 * - Multiple outcome scenarios (crit/no-crit, hit/miss)
 * - Damage ranges with probability weighting
 * - State transitions based on move effects
 * - Item triggers (Oran Berry, Sitrus Berry, Focus Sash, etc.)
 * - Status move effects
 * - Type effectiveness calculations
 */

(function (window) {
    'use strict';

    // Wait for BattlePlanner to be available
    if (!window.BattlePlanner) {
        setTimeout(function () {
            if (window.BattlePlannerCalcIntegration) window.BattlePlannerCalcIntegration();
        }, 100);
        return;
    }

    var BattlePlanner = window.BattlePlanner;
    var calc = window.calc;

    // Type chart for effectiveness calculations
    var TYPE_CHART = {
        Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
        Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
        Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
        Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
        Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
        Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
        Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
        Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
        Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
        Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
        Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
        Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
        Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
        Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
        Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
        Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
        Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
        Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 }
    };

    /**
     * Type-based immunities granted by an ability, keyed by move type.
     * The raw TYPE_CHART above only knows about types, so a Ground move would
     * report 2x against a Levitate Bronzong while the engine correctly deals 0.
     */
    var ABILITY_TYPE_IMMUNITIES = {
        levitate: ['Ground'],
        flashfire: ['Fire'],
        waterabsorb: ['Water'],
        stormdrain: ['Water'],
        dryskin: ['Water'],
        voltabsorb: ['Electric'],
        lightningrod: ['Electric'],
        motordrive: ['Electric'],
        sapsipper: ['Grass'],
        eartheater: ['Ground'],
        windrider: ['Flying'],
        goodasgold: ['__status__']
    };

    function abilityGrantsImmunity(ability, moveType) {
        if (!ability || !moveType) return false;
        var key = String(ability).replace(/\s|-/g, '').toLowerCase();
        var immune = ABILITY_TYPE_IMMUNITIES[key];
        return !!(immune && immune.indexOf(moveType) !== -1);
    }

    /**
     * Calculate type effectiveness.
     *
     * `defender` is optional; when supplied, ability-granted immunities
     * (Levitate, Flash Fire, Water Absorb, ...) and Wonder Guard are honoured
     * so this agrees with what the damage engine actually computes.
     */
    function getTypeEffectiveness(moveType, defenderTypes, defender) {
        if (!moveType || !defenderTypes || defenderTypes.length === 0) return 1;

        var multiplier = 1;
        var chart = TYPE_CHART[moveType] || {};

        for (var i = 0; i < defenderTypes.length; i++) {
            var defType = defenderTypes[i];
            if (chart[defType] !== undefined) {
                multiplier *= chart[defType];
            }
        }

        if (defender) {
            var ability = defender.ability || '';
            var hasRingTarget = defender.item === 'Ring Target';
            if (multiplier === 0 && hasRingTarget) {
                // Ring Target removes type-based immunities (not ability ones)
                multiplier = 1;
                for (var j = 0; j < defenderTypes.length; j++) {
                    var t = defenderTypes[j];
                    if (chart[t] !== undefined && chart[t] !== 0) multiplier *= chart[t];
                }
            }
            if (abilityGrantsImmunity(ability, moveType)) return 0;
            if (String(ability).replace(/\s/g, '').toLowerCase() === 'wonderguard' && multiplier <= 1) {
                return 0;
            }
        }

        return multiplier;
    }

    /**
     * Get effectiveness label
     */
    function getEffectivenessLabel(multiplier) {
        if (multiplier === 0) return { label: 'Immune', class: 'immune' };
        if (multiplier < 1) return { label: 'Not Very Effective', class: 'not-very' };
        if (multiplier > 1) return { label: 'Super Effective', class: 'super' };
        return { label: 'Neutral', class: 'neutral' };
    }

    /**
     * Calculate how many hits are needed to KO from the defender's CURRENT hp.
     *
     * All branches now measure against current HP. The old code mixed current HP
     * (for the OHKO test) with max HP (for the 2HKO/3HKO tests), so 100 damage
     * against a defender at 200/300 reported "3HKO" when two hits kill. The
     * fabricated `chance: 0.5 / 0.33` constants are gone as well — a real KO
     * probability needs the roll distribution, which calculateOutcomeSpread
     * provides.
     */
    function calculateKOChance(damage, defenderHP, defenderMaxHP) {
        // Guard against invalid damage values
        if (!damage || damage <= 0 || isNaN(damage)) {
            return { hitsToKO: Infinity, label: 'No damage' };
        }
        if (!defenderHP || defenderHP <= 0) {
            return { ohko: true, hitsToKO: 0, chance: 1, label: 'Already KO' };
        }

        var hitsToKO = Math.ceil(defenderHP / damage);
        if (isNaN(hitsToKO) || !isFinite(hitsToKO)) {
            return { hitsToKO: Infinity, label: 'No damage' };
        }

        var info = { hitsToKO: hitsToKO, label: hitsToKO + 'HKO' };
        if (hitsToKO <= 1) {
            info.ohko = true;
            info.chance = 1;
            info.label = 'OHKO';
        } else if (hitsToKO === 2) {
            info.twoHKO = true;
            info.label = '2HKO';
        } else if (hitsToKO === 3) {
            info.threeHKO = true;
            info.label = '3HKO';
        }
        // How many hits from FULL health, for the "healthy matchup" read-out
        if (defenderMaxHP > 0) {
            info.hitsToKOFromFull = Math.ceil(defenderMaxHP / damage);
        }
        return info;
    }

    /**
     * Check if move is a status move
     */
    function isStatusMove(moveData) {
        if (!moveData) return false;
        if (moveData.category === 'Status') return true;
        if (moveData.name && window.MoveDB) return window.MoveDB.isStatus(moveData.name);
        return false;
    }

    /**
     * Mapping from RBDex sideCondition ids to the legacy hazard/screen shapes
     * used by applyOutcomeToState and downstream callers.
     */
    var SIDE_CONDITION_HAZARDS = {
        stealthrock: { hazard: 'stealthRock', side: 'defender' },
        spikes:      { hazard: 'spikes',      side: 'defender' },
        toxicspikes: { hazard: 'toxicSpikes',  side: 'defender' },
        stickyweb:   { hazard: 'stickyWeb',    side: 'defender' }
    };
    var SIDE_CONDITION_SCREENS = {
        reflect:    { screen: 'reflect',     turns: 5 },
        lightscreen:{ screen: 'lightScreen', turns: 5 },
        auroraveil: { screen: 'auroraVeil',  turns: 5 }
    };

    var WEATHER_DISPLAY = {
        RainDance:  'Rain',
        sunnyday:   'Sun',
        Sandstorm:  'Sand',
        hail:       'Hail',
        snow:       'Snow'
    };

    /**
     * Get status move effects.
     * Derives everything from MoveDB (RBDex data) instead of hardcoded maps.
     * Return shape is unchanged so downstream callers keep working.
     */
    function getStatusMoveEffects(moveName, moveData) {
        var effects = {
            targetStatus: null,
            selfBoosts: {},
            targetBoosts: {},
            hazards: null,
            screens: null,
            weather: null,
            terrain: null,
            heal: 0,
            other: null
        };

        if (!moveData) return effects;

        var db = window.MoveDB;
        if (!db) return effects;

        var fx = db.getEffects(moveName);
        if (!fx) return effects;

        if (fx.status) {
            effects.targetStatus = fx.status;
        }

        if (fx.selfBoosts) {
            effects.selfBoosts = fx.selfBoosts;
        }

        if (fx.targetBoosts) {
            effects.targetBoosts = fx.targetBoosts;
        }

        if (fx.sideCondition) {
            var sc = fx.sideCondition;
            if (SIDE_CONDITION_HAZARDS[sc]) {
                effects.hazards = SIDE_CONDITION_HAZARDS[sc];
            }
            if (SIDE_CONDITION_SCREENS[sc]) {
                effects.screens = SIDE_CONDITION_SCREENS[sc];
            }
        }

        if (fx.weather) {
            var weatherName = WEATHER_DISPLAY[fx.weather] || fx.weather;
            effects.weather = { weather: weatherName, turns: 5 };
        }

        if (fx.terrain) {
            effects.terrain = fx.terrain;
        }

        if (fx.heal) {
            effects.heal = fx.heal.numerator / fx.heal.denominator;
        }

        // Rest: full heal + self-inflicted sleep (not in RBDex structured fields)
        if (moveName === 'Rest') {
            effects.heal = 1;
            effects.selfStatus = 'slp';
        }

        if (fx.selfStatus) {
            effects.selfStatus = fx.selfStatus;
        }

        if (fx.volatileStatus) {
            effects.other = fx.volatileStatus;
        }

        return effects;
    }

    /**
     * Get secondary effect chances from moves.
     * Derives from MoveDB (RBDex data) instead of a hardcoded map.
     *
     * Returns an array of effect objects in the legacy shape:
     *   { status?, flinch?, selfBoost?, targetBoost?, chance? }
     *
     * Self-boosts that are guaranteed (self.boosts, not secondary) are
     * also included here with chance omitted so the planner can display
     * them alongside secondary effects.
     */
    function getSecondaryEffects(moveData) {
        var effects = [];
        if (!moveData) return effects;

        var db = window.MoveDB;
        if (!db) return effects;

        var moveName = moveData.name || '';
        var entry = db.get(moveName);
        if (!entry) return effects;

        var fx = entry.effects;

        // Guaranteed self-boosts on damaging moves (Close Combat, Overheat, etc.)
        if (fx.selfBoosts && entry.category !== 'Status') {
            effects.push({ selfBoost: fx.selfBoosts });
        }

        // Secondary effects from RBDex
        for (var i = 0; i < fx.secondaries.length; i++) {
            var sec = fx.secondaries[i];
            var legacy = {};
            if (sec.chance) legacy.chance = sec.chance / 100;

            if (sec.status) legacy.status = sec.status;
            if (sec.volatileStatus === 'flinch') legacy.flinch = true;
            if (sec.volatileStatus && sec.volatileStatus !== 'flinch') legacy.volatileStatus = sec.volatileStatus;
            if (sec.targetBoosts) legacy.targetBoost = sec.targetBoosts;
            if (sec.selfBoosts) legacy.selfBoost = sec.selfBoosts;

            effects.push(legacy);
        }

        return effects;
    }

    /**
     * Calculate all possible outcomes for a move
     */
    function calculateAllOutcomes(attacker, defender, move, field, gen) {
        gen = gen || window.GENERATION || (calc && calc.Generations ? calc.Generations.get(8) : 8);
        field = field || (calc ? new calc.Field() : null);

        var outcomes = [];

        if (!calc || !attacker || !defender || !move) {
            return outcomes;
        }

        var moveName = move.name || move;
        var moveData = null;

        try {
            if (gen && gen.moves) {
                moveData = gen.moves.get(calc.toID(moveName));
            }
        } catch (e) { }

        if (!moveData) {
            return [{
                type: 'unknown',
                label: 'Unknown Move',
                probability: 1,
                damage: 0,
                effects: {}
            }];
        }

        var accuracy = getAccuracy(moveData, attacker, defender, field, gen);
        var missChance = accuracy < 100 ? (100 - accuracy) / 100 : 0;
        var hitChance = 1 - missChance;
        var critChance = getCritChance(move, attacker, defender, field, gen);

        // Miss outcome
        if (missChance > 0) {
            outcomes.push(new BattlePlanner.BattleOutcome('Miss', missChance, 0, { miss: true }));
        }

        // Normal hit (no crit)
        if (hitChance > 0 && critChance < 1) {
            try {
                var normalResult = calc.calculate(gen, attacker, defender, move, field);
                var normalDamageRange = getDamageRange(normalResult);

                outcomes.push(new BattlePlanner.BattleOutcome(
                    'Low Roll',
                    hitChance * (1 - critChance) * 0.0625,
                    normalDamageRange.min,
                    { lowRoll: true }
                ));

                outcomes.push(new BattlePlanner.BattleOutcome(
                    'Normal',
                    hitChance * (1 - critChance) * 0.875,
                    normalDamageRange.avg,
                    {}
                ));

                outcomes.push(new BattlePlanner.BattleOutcome(
                    'High Roll',
                    hitChance * (1 - critChance) * 0.0625,
                    normalDamageRange.max,
                    { highRoll: true }
                ));
            } catch (e) {
                console.error('Failed to calculate normal hit:', e);
            }
        }

        // Crit hit
        if (hitChance > 0 && critChance > 0) {
            try {
                var critMove = move;
                if (move.clone) {
                    critMove = move.clone();
                    critMove.isCrit = true;
                }
                var critResult = calc.calculate(gen, attacker, defender, critMove, field);
                var critDamageRange = getDamageRange(critResult);

                outcomes.push(new BattlePlanner.BattleOutcome(
                    'Crit (Low)',
                    hitChance * critChance * 0.0625,
                    critDamageRange.min,
                    { crit: true, lowRoll: true }
                ));

                outcomes.push(new BattlePlanner.BattleOutcome(
                    'Crit',
                    hitChance * critChance * 0.875,
                    critDamageRange.avg,
                    { crit: true }
                ));

                outcomes.push(new BattlePlanner.BattleOutcome(
                    'Crit (High)',
                    hitChance * critChance * 0.0625,
                    critDamageRange.max,
                    { crit: true, highRoll: true }
                ));
            } catch (e) {
                console.error('Failed to calculate crit:', e);
            }
        }

        outcomes = simplifyOutcomes(outcomes);

        return outcomes;
    }

    /**
     * Calculate simplified key outcomes (for UI display)
     */
    function calculateKeyOutcomes(attacker, defender, move, field, gen) {
        gen = gen || window.GENERATION || (calc && calc.Generations ? calc.Generations.get(8) : 8);
        field = field || (calc ? new calc.Field() : null);

        var outcomes = [];

        if (!calc || !attacker || !defender || !move) {
            return outcomes;
        }

        var moveName = move.name || move;
        var moveData = null;

        try {
            if (gen && gen.moves) {
                moveData = gen.moves.get(calc.toID(moveName));
            }
        } catch (e) { }

        if (!moveData) {
            return [{
                type: 'unknown',
                label: 'Unknown',
                probability: 1,
                damage: 0,
                damageRange: { min: 0, max: 0, avg: 0 },
                effects: {}
            }];
        }

        // Handle status moves
        if (isStatusMove(moveData)) {
            var statusEffects = getStatusMoveEffects(moveName, moveData);
            var accuracy = getAccuracy(moveData, attacker, defender, field, gen);

            if (accuracy < 100) {
                outcomes.push({
                    type: 'miss',
                    label: 'Miss',
                    probability: (100 - accuracy) / 100,
                    damage: 0,
                    damageRange: { min: 0, max: 0, avg: 0 },
                    effects: { miss: true }
                });
            }

            outcomes.push({
                type: 'status',
                label: getStatusMoveLabel(statusEffects),
                probability: accuracy / 100,
                damage: 0,
                damageRange: { min: 0, max: 0, avg: 0 },
                effects: { statusMove: true, statusEffects: statusEffects },
                isStatusMove: true
            });

            return outcomes;
        }

        // Get type effectiveness
        var defenderTypes = defender.types || (defender.species && defender.species.types) || [];
        var moveType = moveData.type || 'Normal';
        var effectiveness = getTypeEffectiveness(moveType, defenderTypes, defender);
        var effectivenessInfo = getEffectivenessLabel(effectiveness);

        var accuracy = getAccuracy(moveData, attacker, defender, field, gen);
        var missChance = accuracy < 100 ? (100 - accuracy) / 100 : 0;
        var hitChance = 1 - missChance;
        var critChance = getCritChance(move, attacker, defender, field, gen);

        // Get secondary effects
        var secondaryEffects = getSecondaryEffects(moveData);

        // Miss outcome (only show if 5%+)
        if (missChance >= 0.05) {
            outcomes.push({
                type: 'miss',
                label: 'Miss',
                probability: missChance,
                damage: 0,
                damageRange: { min: 0, max: 0, avg: 0 },
                effects: { miss: true }
            });
        }

        // Normal hit
        if (hitChance > 0 && (1 - critChance) > 0) {
            try {
                var normalResult = calc.calculate(gen, attacker, defender, move, field);
                var normalRange = getDamageRange(normalResult);

                // Calculate KO chance - handle both calc.Pokemon objects (getters) and snapshots
                var defenderHP = typeof defender.curHP === 'function' ? defender.curHP() :
                    (defender.curHP || (defender.rawStats && defender.rawStats.hp) || 100);
                var defenderMaxHP = typeof defender.maxHP === 'function' ? defender.maxHP() :
                    (defender.maxHP || (defender.rawStats && defender.rawStats.hp) || defenderHP);
                var koInfo = calculateKOChance(normalRange.avg, defenderHP, defenderMaxHP);

                outcomes.push({
                    type: 'normal',
                    label: 'Normal',
                    probability: hitChance * (1 - critChance),
                    damage: normalRange.avg,
                    damageRange: normalRange,
                    damagePercent: defenderMaxHP > 0 ? Math.round((normalRange.avg / defenderMaxHP) * 100) : 0,
                    damagePercentRange: defenderMaxHP > 0 ? {
                        min: Math.round((normalRange.min / defenderMaxHP) * 100),
                        max: Math.round((normalRange.max / defenderMaxHP) * 100)
                    } : { min: 0, max: 0 },
                    effects: { secondaryEffects: secondaryEffects },
                    effectiveness: effectiveness,
                    effectivenessInfo: effectivenessInfo,
                    koInfo: koInfo,
                    result: normalResult
                });
            } catch (e) {
                console.error('Failed to calc normal:', e);
            }
        }

        // Crit
        if (hitChance > 0 && critChance > 0.01) {
            try {
                var critMove = move;
                if (move.clone) {
                    critMove = move.clone();
                    critMove.isCrit = true;
                }
                var critResult = calc.calculate(gen, attacker, defender, critMove, field);
                var critRange = getDamageRange(critResult);

                // Calculate KO chance - handle both calc.Pokemon objects (getters) and snapshots
                var defHP = typeof defender.curHP === 'function' ? defender.curHP() :
                    (defender.curHP || (defender.rawStats && defender.rawStats.hp) || 100);
                var defMaxHP = typeof defender.maxHP === 'function' ? defender.maxHP() :
                    (defender.maxHP || (defender.rawStats && defender.rawStats.hp) || defHP);
                var critKoInfo = calculateKOChance(critRange.avg, defHP, defMaxHP);

                outcomes.push({
                    type: 'crit',
                    label: 'Critical Hit',
                    probability: hitChance * critChance,
                    damage: critRange.avg,
                    damageRange: critRange,
                    damagePercent: defenderMaxHP > 0 ? Math.round((critRange.avg / defenderMaxHP) * 100) : 0,
                    damagePercentRange: defenderMaxHP > 0 ? {
                        min: Math.round((critRange.min / defenderMaxHP) * 100),
                        max: Math.round((critRange.max / defenderMaxHP) * 100)
                    } : { min: 0, max: 0 },
                    effects: { crit: true, secondaryEffects: secondaryEffects },
                    effectiveness: effectiveness,
                    effectivenessInfo: effectivenessInfo,
                    koInfo: critKoInfo,
                    result: critResult
                });
            } catch (e) {
                console.error('Failed to calc crit:', e);
            }
        }

        return outcomes;
    }

    function getStatusMoveLabel(effects) {
        var labels = [];

        if (effects.targetStatus) {
            var statusNames = {
                'par': 'Paralyze',
                'brn': 'Burn',
                'psn': 'Poison',
                'tox': 'Toxic',
                'slp': 'Sleep',
                'frz': 'Freeze'
            };
            labels.push(statusNames[effects.targetStatus] || effects.targetStatus);
        }

        if (Object.keys(effects.selfBoosts).length > 0) {
            var boostLabels = [];
            for (var stat in effects.selfBoosts) {
                var val = effects.selfBoosts[stat];
                var statNames = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
                boostLabels.push((statNames[stat] || stat) + (val > 0 ? '+' + val : val));
            }
            labels.push(boostLabels.join(', '));
        }

        if (Object.keys(effects.targetBoosts).length > 0) {
            labels.push('Lower stats');
        }

        if (effects.hazards) {
            labels.push('Set hazard');
        }

        if (effects.screens) {
            labels.push('Set screen');
        }

        if (effects.weather) {
            labels.push(effects.weather.weather);
        }

        if (effects.heal) {
            labels.push('Heal');
        }

        return labels.length > 0 ? labels.join(', ') : 'Effect';
    }

    /** Accuracy/evasion stage multipliers (gen 3+). */
    var ACCURACY_STAGE_MULTIPLIERS = {
        '-6': 3 / 9, '-5': 3 / 8, '-4': 3 / 7, '-3': 3 / 6, '-2': 3 / 5, '-1': 3 / 4,
        '0': 1,
        '1': 4 / 3, '2': 5 / 3, '3': 2, '4': 7 / 3, '5': 8 / 3, '6': 3
    };

    /**
     * Resolve a move's base accuracy.
     *
     * IMPORTANT: @smogon/calc move data carries NO accuracy field at all (the
     * engine does not model accuracy), so reading `moveData.accuracy` from a
     * `gen.moves.get(...)` result always yielded undefined and every move came
     * back as 100%. RBDex is the source of accuracy, so consult MoveDB first and
     * only fall back to whatever the caller handed us.
     */
    function resolveBaseAccuracy(moveData) {
        if (!moveData) return null;

        if (moveData.accuracy !== undefined && moveData.accuracy !== null) {
            return moveData.accuracy;
        }

        var name = moveData.name || moveData;
        var db = window.MoveDB;
        if (db && typeof name === 'string') {
            var entry = db.get(name);
            if (entry && entry.accuracy !== undefined && entry.accuracy !== null) {
                return entry.accuracy;
            }
        }
        return null;
    }

    /**
     * Get accuracy (0-100) considering all modifiers, including accuracy and
     * evasion stages which used to be discarded entirely.
     */
    function getAccuracy(moveData, attacker, defender, field, gen) {
        if (!moveData) return 100;

        var baseAccuracy = resolveBaseAccuracy(moveData);

        // `true` means "cannot miss"; null/undefined means we have no data
        if (baseAccuracy === true || baseAccuracy === null || baseAccuracy === undefined) return 100;
        if (baseAccuracy === 0) return 100;

        var attackerAbility = attacker ? (attacker.ability || '') : '';
        var defenderAbility = defender ? (defender.ability || '') : '';
        var moveName = moveData.name || '';
        var weather = field && field.weather ? field.weather : '';

        if (attackerAbility === 'No Guard' || defenderAbility === 'No Guard') {
            return 100;
        }

        // Weather overrides come before the modifier chain
        if (moveName === 'Thunder' || moveName === 'Hurricane') {
            if (weather === 'Rain' || weather === 'Heavy Rain') return 100;
            if (weather === 'Sun' || weather === 'Harsh Sunshine') baseAccuracy = 50;
        }
        if (moveName === 'Blizzard' && (weather === 'Hail' || weather === 'Snow')) {
            return 100;
        }

        // Accuracy and evasion stages (net stage, clamped to +/-6)
        var accStage = (attacker && attacker.boosts && attacker.boosts.accuracy) || 0;
        var evaStage = (defender && defender.boosts && defender.boosts.evasion) || 0;
        // Moves that ignore evasion boosts
        if (isNamedMove(moveName, 'Chip Away', 'Sacred Sword', 'Darkest Lariat')) evaStage = 0;
        // Keen Eye / Illuminate / Minds Eye ignore the target's evasion boosts
        if (isAbility(attackerAbility, 'Keen Eye', 'Illuminate', "Mind's Eye")) evaStage = Math.min(0, evaStage);
        if (isAbility(attackerAbility, 'Unaware')) evaStage = 0;
        var netStage = Math.max(-6, Math.min(6, accStage - evaStage));
        var stageMultiplier = ACCURACY_STAGE_MULTIPLIERS[String(netStage)] || 1;

        var accuracy = baseAccuracy * stageMultiplier;

        // Abilities
        if (attackerAbility === 'Compound Eyes') accuracy = Math.floor(accuracy * 1.3);
        if (attackerAbility === 'Hustle' && moveData.category === 'Physical') accuracy = Math.floor(accuracy * 0.8);
        if (attackerAbility === 'Victory Star') accuracy = Math.floor(accuracy * 1.1);
        if (isAbility(defenderAbility, 'Sand Veil') && (weather === 'Sand' || weather === 'Sandstorm')) {
            accuracy = Math.floor(accuracy * 0.8);
        }
        if (isAbility(defenderAbility, 'Snow Cloak') && (weather === 'Hail' || weather === 'Snow')) {
            accuracy = Math.floor(accuracy * 0.8);
        }
        if (isAbility(defenderAbility, 'Tangled Feet') && defender && defender.volatiles && defender.volatiles.confusion) {
            accuracy = Math.floor(accuracy * 0.5);
        }

        // Items
        var attackerItem = attacker ? (attacker.item || '') : '';
        var defenderItem = defender ? (defender.item || '') : '';
        if (attackerItem === 'Wide Lens') accuracy = Math.floor(accuracy * 1.1);
        if (attackerItem === 'Zoom Lens') accuracy = Math.floor(accuracy * 1.2);
        if (defenderItem === 'Bright Powder' || defenderItem === 'BrightPowder') accuracy = Math.floor(accuracy * 0.9);
        if (defenderItem === 'Lax Incense') accuracy = Math.floor(accuracy * 0.95);

        // Field
        if (field && field.isGravity) accuracy = Math.floor(accuracy * 5 / 3);

        return Math.max(0, Math.min(100, Math.round(accuracy)));
    }

    // Variadic membership helpers: isNamedMove(name, 'A', 'B', ...)
    function isNamedMove(name) {
        for (var i = 1; i < arguments.length; i++) {
            if (name === arguments[i]) return true;
        }
        return false;
    }

    function isAbility(ability) {
        for (var i = 1; i < arguments.length; i++) {
            if (ability === arguments[i]) return true;
        }
        return false;
    }

    /**
     * Get crit chance as a decimal
     */
    function getCritChance(move, attacker, defender, field, gen) {
        if (!move) return 0;

        var moveName = move.name || '';

        var db = window.MoveDB;
        var dbEntry = db ? db.get(moveName) : null;

        if (dbEntry && dbEntry.willCrit) return 1;

        var defenderAbility = defender ? (defender.ability || '') : '';
        if (defenderAbility === 'Battle Armor' || defenderAbility === 'Shell Armor') {
            return 0;
        }

        var critStage = 0;

        if (dbEntry && dbEntry.critRatio >= 2) critStage++;

        var attackerItem = attacker ? (attacker.item || '') : '';
        var attackerAbility = attacker ? (attacker.ability || '') : '';
        var attackerName = attacker ? (attacker.name || '') : '';

        if (attackerItem === 'Scope Lens' || attackerItem === 'Razor Claw') critStage++;
        if (attackerItem === 'Leek' && (attackerName === "Farfetch'd" || attackerName === "Sirfetch'd")) critStage += 2;
        if (attackerItem === 'Lucky Punch' && attackerName === 'Chansey') critStage += 2;
        if (attackerItem === 'Stick' && attackerName === "Farfetch'd") critStage += 2;

        if (attackerAbility === 'Super Luck') critStage++;

        var genNum = 8;
        if (gen && gen.num) {
            genNum = gen.num;
        } else if (typeof gen === 'number') {
            genNum = gen;
        }

        if (genNum >= 7) {
            var rates = [1 / 24, 1 / 8, 1 / 2, 1, 1];
            return rates[Math.min(critStage, 4)];
        } else {
            var rates = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2];
            return rates[Math.min(critStage, 4)];
        }
    }

    /**
     * How many times a Result's move actually connects.
     * @smogon/calc stores this on the Move as `hits`.
     */
    function getResultHitCount(result) {
        if (!result || !result.move) return 1;
        var hits = result.move.hits;
        return (typeof hits === 'number' && hits > 0) ? hits : 1;
    }

    /**
     * Extract the damage range from a calc Result.
     *
     * CRITICAL: for a multi-hit move, `result.damage` holds PER-HIT rolls — only
     * `result.desc()` multiplies by the hit count. Treating those rolls as the
     * total made the planner apply (and display) a single hit's damage for
     * Pin Missile, Icicle Spear, Rock Blast, Bullet Seed and friends.
     *
     * Returns per-hit figures alongside the totals so callers can render an
     * honest "x-y per hit x N = a-b total" breakdown.
     */
    function getDamageRange(result, hitCountOverride) {
        if (!result) return { min: 0, max: 0, avg: 0, rolls: [], hits: 1, perHitMin: 0, perHitMax: 0, perHitAvg: 0 };

        var damage = result.damage;
        var hits = (typeof hitCountOverride === 'number' && hitCountOverride > 0)
            ? hitCountOverride
            : getResultHitCount(result);

        var min = 0, max = 0, avg = 0;
        var perHitRolls = null;

        if (typeof damage === 'number') {
            min = max = avg = damage;
        } else if (Array.isArray(damage)) {
            if (Array.isArray(damage[0])) {
                // Parental Bond / distinct-per-hit shape: [rolls(hit1), rolls(hit2), ...].
                // Each sub-array is one hit, so the total is the sum across all of them.
                min = 0; max = 0;
                for (var h = 0; h < damage.length; h++) {
                    var sub = damage[h] || [];
                    min += (sub[0] || 0);
                    max += (sub[sub.length - 1] || 0);
                }
                avg = Math.floor((min + max) / 2);
                // The sub-arrays already enumerate every hit; don't multiply again.
                hits = damage.length;
                perHitRolls = damage;
            } else if (damage.length > 0) {
                // Flat 16-roll array of PER-HIT damage
                var perMin = Math.min.apply(null, damage);
                var perMax = Math.max.apply(null, damage);
                var sum = 0;
                for (var i = 0; i < damage.length; i++) {
                    sum += (damage[i] || 0);
                }
                var perAvg = sum / damage.length;

                min = perMin * hits;
                max = perMax * hits;
                avg = Math.floor(perAvg * hits);
                perHitRolls = damage;
            }
        }

        // Fallback: if avg is still 0 but min/max aren't, use their average
        if (avg === 0 && (min > 0 || max > 0)) {
            avg = Math.floor((min + max) / 2);
        }

        return {
            min: min,
            max: max,
            avg: avg,
            rolls: damage,
            hits: hits,
            perHitRolls: perHitRolls,
            perHitMin: hits > 0 ? Math.floor(min / hits) : min,
            perHitMax: hits > 0 ? Math.floor(max / hits) : max,
            perHitAvg: hits > 0 ? Math.floor(avg / hits) : avg
        };
    }

    /**
     * Every distinct total-damage value the move can roll, with its probability.
     * This is what the branching engine consumes: exact, merged, and already
     * scaled by hit count.
     */
    function getDamageRolls(result, hitCountOverride) {
        var range = getDamageRange(result, hitCountOverride);
        var rolls = [];

        if (result && typeof result.damage === 'number') {
            return [{ damage: result.damage, probability: 1 }];
        }

        if (Array.isArray(range.perHitRolls) && Array.isArray(range.perHitRolls[0])) {
            // Distinct per-hit roll arrays: total = sum of the i-th roll of each hit.
            // calc emits aligned arrays, so index i across sub-arrays is one outcome.
            var n = range.perHitRolls[0].length;
            for (var i = 0; i < n; i++) {
                var total = 0;
                for (var h = 0; h < range.perHitRolls.length; h++) {
                    total += (range.perHitRolls[h][i] || 0);
                }
                rolls.push(total);
            }
        } else if (Array.isArray(range.perHitRolls)) {
            for (var j = 0; j < range.perHitRolls.length; j++) {
                rolls.push((range.perHitRolls[j] || 0) * range.hits);
            }
        }

        if (!rolls.length) return [{ damage: range.avg, probability: 1 }];

        // Merge duplicates — the 16 rolls collapse into far fewer distinct values
        var counts = {};
        for (var k = 0; k < rolls.length; k++) {
            counts[rolls[k]] = (counts[rolls[k]] || 0) + 1;
        }
        return Object.keys(counts).map(function (dmg) {
            return { damage: Number(dmg), probability: counts[dmg] / rolls.length };
        }).sort(function (a, b) { return a.damage - b.damage; });
    }

    /** Outcomes of the same kind can absorb each other's probability mass. */
    function outcomeKind(o) {
        if (o.isMiss || (o.effects && o.effects.miss)) return 'miss';
        if (o.isCrit || (o.effects && o.effects.crit)) return 'crit';
        return 'hit';
    }

    /**
     * Drop negligible outcomes without distorting the meaningful ones.
     *
     * The old version dumped all the discarded probability mass onto
     * `significant[0]` — whichever outcome happened to be pushed first, i.e. the
     * Miss branch when one existed. That silently inflated miss chance with
     * leftover crit mass.
     *
     * Now a dropped outcome folds into the largest surviving outcome of the SAME
     * kind (a negligible "Crit (High)" merges into "Crit", not into "Miss"), so
     * the probability of missing, critting and connecting each stay exact. Only
     * when a whole kind disappears is the remainder spread proportionally.
     */
    function simplifyOutcomes(outcomes, threshold) {
        threshold = threshold || 0.01;

        var significant = [];
        var dropped = [];
        outcomes.forEach(function (o) {
            (o.probability >= threshold ? significant : dropped).push(o);
        });

        if (!significant.length) return outcomes.slice();

        var orphanMass = 0;
        dropped.forEach(function (o) {
            var kind = outcomeKind(o);
            var kin = null;
            significant.forEach(function (candidate) {
                if (outcomeKind(candidate) !== kind) return;
                if (!kin || candidate.probability > kin.probability) kin = candidate;
            });
            if (kin) {
                kin.probability += o.probability;
            } else {
                orphanMass += o.probability;
            }
        });

        if (orphanMass > 0) {
            var keptMass = significant.reduce(function (sum, o) { return sum + o.probability; }, 0);
            if (keptMass > 0) {
                var scale = (keptMass + orphanMass) / keptMass;
                significant.forEach(function (o) { o.probability *= scale; });
            }
        }

        return significant;
    }

    /** Pinch berries heal 1/3 max HP at <=25% HP (gen 7+). */
    var PINCH_BERRIES = ['Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry'];

    /**
     * Apply damage-triggered item/ability effects.
     *
     * Reports what WOULD happen if `damage` is dealt; the caller applies it.
     * `survivesAtOneHP` covers Focus Sash and Sturdy; `focusBandChance` marks a
     * probabilistic survival that the branching engine turns into its own branch.
     */
    function applyItemEffects(pokemon, damage) {
        var effects = { healed: 0, itemConsumed: false, itemEffect: null };

        if (!pokemon) return effects;

        var item = pokemon.item || '';
        var ability = (pokemon.ability || '').replace(/\s/g, '').toLowerCase();
        var currentHP = pokemon.currentHP;
        var maxHP = pokemon.maxHP;
        var newHP = currentHP - damage;
        var hpPercent = maxHP > 0 ? (newHP / maxHP) * 100 : 0;
        var wasAboveHalf = currentHP > maxHP * 0.5;
        var wasAboveQuarter = currentHP > maxHP * 0.25;

        // Sturdy: survive at 1 HP from full, no item consumed
        if (ability === 'sturdy' && currentHP === maxHP && newHP <= 0) {
            effects.healed = 1;
            effects.survivesAtOneHP = true;
            effects.itemEffect = 'Sturdy kept the Pokemon at 1 HP';
            return effects;
        }

        if (!item) return effects;

        // Oran Berry - Heals 10 HP when HP drops to 50% or below
        if (item === 'Oran Berry' && hpPercent <= 50 && wasAboveHalf) {
            effects.healed = 10;
            effects.itemConsumed = true;
            effects.itemEffect = 'Oran Berry restored 10 HP';
        }

        // Sitrus Berry - Heals 25% HP when HP drops to 50% or below
        if (item === 'Sitrus Berry' && hpPercent <= 50 && wasAboveHalf) {
            effects.healed = Math.floor(maxHP * 0.25);
            effects.itemConsumed = true;
            effects.itemEffect = 'Sitrus Berry restored ' + effects.healed + ' HP';
        }

        // Pinch berries - Heal 1/3 max HP at 25% or below
        if (PINCH_BERRIES.indexOf(item) !== -1 && hpPercent <= 25 && wasAboveQuarter && newHP > 0) {
            effects.healed = Math.max(1, Math.floor(maxHP / 3));
            effects.itemConsumed = true;
            effects.itemEffect = item + ' restored ' + effects.healed + ' HP';
        }

        // Focus Sash - Survives OHKO at full HP
        if (item === 'Focus Sash' && currentHP === maxHP && newHP <= 0) {
            effects.healed = 1; // applyDamage clamps to 0, so healing 1 leaves at 1 HP
            effects.itemConsumed = true;
            effects.survivesAtOneHP = true;
            effects.itemEffect = 'Focus Sash kept the Pokemon at 1 HP';
        }

        // Focus Band - 10% chance to survive at 1 HP (a probabilistic branch)
        if (item === 'Focus Band' && newHP <= 0) {
            effects.focusBandChance = 0.1;
        }

        // Leftovers healing (end of turn)
        if (item === 'Leftovers') {
            effects.endOfTurnHeal = Math.floor(maxHP / 16);
        }

        // Black Sludge healing (end of turn for Poison types)
        if (item === 'Black Sludge' && pokemon.types && pokemon.types.indexOf('Poison') !== -1) {
            effects.endOfTurnHeal = Math.floor(maxHP / 16);
        }

        return effects;
    }

    /**
     * Apply an outcome to a battle state
     */
    function applyOutcomeToState(state, outcome, attackerSide, moveData) {
        var newState = state.clone();
        newState.turnNumber++;

        var attacker = attackerSide === 'p1' ? newState.p1.active : newState.p2.active;
        var defender = attackerSide === 'p1' ? newState.p2.active : newState.p1.active;

        if (!defender || !attacker) return newState;

        // Handle status moves
        if (outcome.isStatusMove && outcome.effects.statusEffects) {
            var statusEffects = outcome.effects.statusEffects;

            // Apply target status
            // Pokemon can only have one status condition - don't overwrite existing status
            if (statusEffects.targetStatus && (!defender.status || defender.status === 'Healthy')) {
                defender.setStatus(convertStatusCode(statusEffects.targetStatus));
            }

            // Apply self status
            if (statusEffects.selfStatus) {
                attacker.setStatus(convertStatusCode(statusEffects.selfStatus));
            }

            // Apply self boosts. accuracy/evasion are included now that
            // getAccuracy honours those stages (Double Team, Hone Claws, ...).
            if (statusEffects.selfBoosts) {
                for (var stat in statusEffects.selfBoosts) {
                    attacker.applyBoost(stat, statusEffects.selfBoosts[stat]);
                }
            }

            // Apply target boosts (debuffs)
            if (statusEffects.targetBoosts) {
                for (var stat in statusEffects.targetBoosts) {
                    defender.applyBoost(stat, statusEffects.targetBoosts[stat]);
                }
            }

            // Apply hazards
            if (statusEffects.hazards) {
                var hazardSide = attackerSide === 'p1' ? 'p2' : 'p1';
                if (statusEffects.hazards.hazard === 'spikes') {
                    newState.sides[hazardSide].spikes = Math.min(3, newState.sides[hazardSide].spikes + 1);
                } else if (statusEffects.hazards.hazard === 'toxicSpikes') {
                    newState.sides[hazardSide].toxicSpikes = Math.min(2, newState.sides[hazardSide].toxicSpikes + 1);
                } else if (statusEffects.hazards.hazard === 'stealthRock') {
                    newState.sides[hazardSide].stealthRock = true;
                } else if (statusEffects.hazards.hazard === 'stickyWeb') {
                    newState.sides[hazardSide].stickyWeb = true;
                }
            }

            // Apply screens
            if (statusEffects.screens) {
                var screenSide = attackerSide;
                if (statusEffects.screens.screen === 'reflect') {
                    newState.sides[screenSide].reflect = true;
                    newState.sides[screenSide].reflectTurns = 5;
                } else if (statusEffects.screens.screen === 'lightScreen') {
                    newState.sides[screenSide].lightScreen = true;
                    newState.sides[screenSide].lightScreenTurns = 5;
                } else if (statusEffects.screens.screen === 'auroraVeil') {
                    newState.sides[screenSide].auroraVeil = true;
                    newState.sides[screenSide].auroraVeilTurns = 5;
                }
            }

            // Apply weather
            if (statusEffects.weather) {
                newState.field.weather = statusEffects.weather.weather;
                newState.field.weatherTurns = statusEffects.weather.turns || 5;
            }

            // Apply healing
            if (statusEffects.heal) {
                var healAmount = typeof statusEffects.heal === 'number'
                    ? Math.floor(attacker.maxHP * statusEffects.heal)
                    : 0;
                attacker.applyHealing(healAmount);
            }

            // Status moves change the attacker (boosts, healing, Rest) and the
            // defender, so their team slots need syncing too.
            syncTeamSlots(newState, attackerSide, attacker, defender);
            return newState;
        }

        // Apply damage for attacking moves
        var damage = outcome.damage || outcome.damageDealt || 0;
        if (damage > 0) {
            // Check for item effects before applying damage
            var itemEffects = applyItemEffects(defender, damage);

            defender.applyDamage(damage);

            // Apply item healing
            if (itemEffects.healed > 0) {
                defender.applyHealing(itemEffects.healed);
            }

            // Consume item
            if (itemEffects.itemConsumed) {
                defender.item = '';
            }
        }

        // Apply secondary effects
        if (outcome.effects && outcome.effects.secondaryEffects) {
            outcome.effects.secondaryEffects.forEach(function (effect) {
                // Apply with probability
                // Don't overwrite existing status conditions
                if (effect.status && (!defender.status || defender.status === 'Healthy')) {
                    defender.setStatus(convertStatusCode(effect.status));
                }
                if (effect.selfBoost) {
                    for (var stat in effect.selfBoost) {
                        attacker.applyBoost(stat, effect.selfBoost[stat]);
                    }
                }
                if (effect.targetBoost) {
                    for (var stat in effect.targetBoost) {
                        defender.applyBoost(stat, effect.targetBoost[stat]);
                    }
                }
            });
        }

        syncTeamSlots(newState, attackerSide, attacker, defender);

        return newState;
    }

    /**
     * Mirror the active Pokemon back into their team slots.
     *
     * The old code wrote `attacker.clone()` into p1's team when p2 attacked —
     * but with attackerSide 'p2' the attacker IS the p2 Pokemon, so the
     * opponent was injected into the player's team and the damage was lost.
     * Both sides are synced now, since self-boosts, healing, recoil and item
     * consumption change the attacker too.
     */
    function syncTeamSlots(state, attackerSide, attacker, defender) {
        var attackerTeam = attackerSide === 'p1' ? state.p1 : state.p2;
        var defenderTeam = attackerSide === 'p1' ? state.p2 : state.p1;

        if (attacker && attackerTeam.team[attackerTeam.teamSlot]) {
            attackerTeam.team[attackerTeam.teamSlot] = attacker.clone();
        }
        if (defender && defenderTeam.team[defenderTeam.teamSlot]) {
            defenderTeam.team[defenderTeam.teamSlot] = defender.clone();
        }
    }

    function convertStatusCode(code) {
        var map = {
            'par': 'Paralyzed',
            'brn': 'Burned',
            'psn': 'Poisoned',
            'tox': 'Badly Poisoned',
            'slp': 'Asleep',
            'frz': 'Frozen'
        };
        return map[code] || code;
    }

    /**
     * Create a Pokemon object from a snapshot for calculation
     */
    function snapshotToPokemon(snapshot, gen) {
        if (!snapshot) {
            return null;
        }

        // If it's already a Pokemon object, return it (or a clone)
        if (window.calc && snapshot instanceof window.calc.Pokemon) {
            return snapshot.clone ? snapshot.clone() : snapshot;
        }

        // Try to use stored Pokemon data first
        if (snapshot._pokemonData && snapshot._pokemonData.clone) {
            try {
                var cloned = snapshot._pokemonData.clone();
                // Ensure current state is applied.
                //
                // `curHP` is a METHOD on calc.Pokemon; the backing field is
                // `originalCurHP`. Assigning to `.curHP` shadowed the method and
                // the engine kept using full HP, so every HP-dependent mechanic
                // (Super Fang, Brine, Eruption, Reversal, Flail, Endeavor) and
                // every KO description was computed as if nothing was damaged.
                if (typeof snapshot.currentHP === 'number') {
                    cloned.originalCurHP = Math.max(0, Math.min(snapshot.currentHP, cloned.maxHP()));
                }
                cloned.status = window.BattlePlanner.normalizeStatusCode(snapshot.status);
                if (snapshot.boosts) {
                    cloned.boosts = Object.assign({}, snapshot.boosts);
                }
                return cloned;
            } catch (e) {
                console.warn('snapshotToPokemon: Clone failed, falling back to recreation:', e);
            }
        }

        if (!window.calc || !snapshot.name) {
            return null;
        }

        try {
            var genNum = 8;
            if (gen && gen.num) genNum = gen.num;
            else if (typeof gen === 'number') genNum = gen;

            var options = {
                level: snapshot.level || 100,
                ability: snapshot.ability || '',
                item: snapshot.item || '',
                nature: snapshot.nature || 'Hardy',
                evs: snapshot.evs || {},
                ivs: snapshot.ivs || {},
                boosts: snapshot.boosts || {},
                status: window.BattlePlanner.normalizeStatusCode(snapshot.status),
                // The constructor accepts `curHP` as an option (it writes
                // originalCurHP internally) — that path is fine.
                curHP: snapshot.currentHP
            };

            if (snapshot.moves && snapshot.moves.length > 0) {
                options.moves = snapshot.moves.map(function (moveName) {
                    return new window.calc.Move(genNum, moveName);
                });
            }

            return new window.calc.Pokemon(genNum, snapshot.name, options);
        } catch (e) {
            console.error('Failed to create Pokemon from snapshot:', e);
            return null;
        }
    }

    /**
     * Create a calc.Field object from snapshot
     */
    function snapshotToField(snapshot) {
        if (!window.calc) return null;
        var field = new window.calc.Field();
        if (!snapshot) return field;

        field.weather = snapshot.weather && snapshot.weather !== 'None' ? snapshot.weather : undefined;
        field.terrain = snapshot.terrain && snapshot.terrain !== 'None' ? snapshot.terrain : undefined;
        field.isTrickRoom = !!snapshot.trickRoom;
        field.isGravity = !!snapshot.gravity;
        field.isMagicRoom = !!snapshot.magicRoom;
        field.isWonderRoom = !!snapshot.wonderRoom;

        return field;
    }

    /**
     * Create a BattleStateSnapshot from current calculator state
     */
    function createStateFromCalculator(p1Pokemon, p2Pokemon, field) {
        var state = new BattlePlanner.BattleStateSnapshot();

        if (p1Pokemon) {
            state.p1.active = new BattlePlanner.PokemonSnapshot(p1Pokemon);
            state.p1.team = [state.p1.active.clone()];
            state.p1.teamSlot = 0;
        }
        if (p2Pokemon) {
            state.p2.active = new BattlePlanner.PokemonSnapshot(p2Pokemon);
            state.p2.team = [state.p2.active.clone()];
            state.p2.teamSlot = 0;
        }

        if (field) {
            state.field.weather = field.weather || 'None';
            state.field.terrain = field.terrain || 'None';
            state.field.trickRoom = !!field.isTrickRoom;
            state.field.gravity = !!field.isGravity;

            if (field.attackerSide) {
                var as = field.attackerSide;
                state.sides.p1.spikes = as.spikes || 0;
                state.sides.p1.stealthRock = !!as.isSR;
                state.sides.p1.reflect = !!as.isReflect;
                state.sides.p1.lightScreen = !!as.isLightScreen;
                state.sides.p1.tailwind = !!as.isTailwind;
            }

            if (field.defenderSide) {
                var ds = field.defenderSide;
                state.sides.p2.spikes = ds.spikes || 0;
                state.sides.p2.stealthRock = !!ds.isSR;
                state.sides.p2.reflect = !!ds.isReflect;
                state.sides.p2.lightScreen = !!ds.isLightScreen;
                state.sides.p2.tailwind = !!ds.isTailwind;
            }
        }

        return state;
    }

    /**
     * Format probability as percentage
     */
    function formatProbability(probability) {
        var percent = probability * 100;
        if (percent >= 99.99) return '100%';
        if (percent <= 0.01) return '<0.1%';
        if (percent >= 10) return percent.toFixed(1) + '%';
        return percent.toFixed(2) + '%';
    }

    /**
     * Format damage as percentage of max HP
     */
    function formatDamagePercent(damage, maxHP) {
        if (!maxHP || maxHP <= 0) return '0%';
        var percent = (damage / maxHP) * 100;
        return percent.toFixed(1) + '%';
    }

    /**
     * Get sprite URL for a Pokemon
     */
    function getSpriteUrl(pokemonName, shiny) {
        if (!pokemonName) return '';

        // Normalize name for URL
        var spriteName = pokemonName.toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '');

        // Try multiple sprite sources
        var sources = [
            'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + getPokedexNumber(pokemonName) + '.png',
            'https://play.pokemonshowdown.com/sprites/gen5/' + spriteName + '.png',
            'https://raw.githubusercontent.com/msPokemon/images/master/sprites/pokemon/other/official-artwork/' + getPokedexNumber(pokemonName) + '.png'
        ];

        return sources[0];
    }

    /**
     * Pokedex number lookup, sourced from RBDex (which carries `num` for all
     * ~1,137 species). The previous hardcoded table had ~20 entries, so every
     * other Pokemon resolved to sprite "0.png".
     */
    function getPokedexNumber(name) {
        if (!name) return 0;

        var species = window.RBDex ? window.RBDex.getSpecies(name) : null;
        if (species && species.num) return species.num;

        // Alternate formes (Charizard-Mega-X, Rotom-Wash, ...) share the base
        // species' national number.
        var base = String(name).split('-')[0];
        if (base !== name) {
            var baseSpecies = window.RBDex ? window.RBDex.getSpecies(base) : null;
            if (baseSpecies && baseSpecies.num) return baseSpecies.num;
        }

        return 0;
    }

    // Export
    window.BattlePlanner.CalcIntegration = {
        calculateAllOutcomes: calculateAllOutcomes,
        calculateKeyOutcomes: calculateKeyOutcomes,
        getAccuracy: getAccuracy,
        resolveBaseAccuracy: resolveBaseAccuracy,
        getCritChance: getCritChance,
        getDamageRange: getDamageRange,
        getDamageRolls: getDamageRolls,
        getResultHitCount: getResultHitCount,
        syncTeamSlots: syncTeamSlots,
        simplifyOutcomes: simplifyOutcomes,
        applyOutcomeToState: applyOutcomeToState,
        snapshotToPokemon: snapshotToPokemon,
        snapshotToField: snapshotToField,
        createStateFromCalculator: createStateFromCalculator,
        formatProbability: formatProbability,
        formatDamagePercent: formatDamagePercent,
        getTypeEffectiveness: getTypeEffectiveness,
        getEffectivenessLabel: getEffectivenessLabel,
        calculateKOChance: calculateKOChance,
        applyItemEffects: applyItemEffects,
        isStatusMove: isStatusMove,
        getStatusMoveEffects: getStatusMoveEffects,
        getSecondaryEffects: getSecondaryEffects,
        getSpriteUrl: getSpriteUrl
    };

})(window);
