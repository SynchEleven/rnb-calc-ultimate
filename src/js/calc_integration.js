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
            window.BattlePlannerCalcIntegration && window.BattlePlannerCalcIntegration();
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
     * Calculate type effectiveness
     */
    function getTypeEffectiveness(moveType, defenderTypes) {
        if (!moveType || !defenderTypes || defenderTypes.length === 0) return 1;

        var multiplier = 1;
        var chart = TYPE_CHART[moveType] || {};

        for (var i = 0; i < defenderTypes.length; i++) {
            var defType = defenderTypes[i];
            if (chart[defType] !== undefined) {
                multiplier *= chart[defType];
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
     * Calculate KO chance
     */
    function calculateKOChance(damage, defenderHP, defenderMaxHP) {
        // Guard against invalid damage values
        if (!damage || damage <= 0 || isNaN(damage)) {
            return { hitsToKO: Infinity, label: 'No damage' };
        }
        if (!defenderHP || defenderHP <= 0) {
            return { ohko: true, chance: 1, label: 'Already KO' };
        }

        if (damage >= defenderHP) {
            return { ohko: true, chance: 1, label: 'OHKO' };
        }
        if (damage * 2 >= defenderMaxHP) {
            return { twoHKO: true, chance: 0.5, label: '2HKO likely' };
        }
        if (damage * 3 >= defenderMaxHP) {
            return { threeHKO: true, chance: 0.33, label: '3HKO' };
        }
        var hitsToKO = Math.ceil(defenderHP / damage);
        if (isNaN(hitsToKO) || !isFinite(hitsToKO)) {
            return { hitsToKO: Infinity, label: 'No damage' };
        }
        return { hitsToKO: hitsToKO, label: hitsToKO + 'HKO' };
    }

    /**
     * Check if move is a status move
     */
    function isStatusMove(moveData) {
        if (!moveData) return false;
        return moveData.category === 'Status';
    }

    /**
     * Get status move effects
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

        // Status-inflicting moves
        var statusMoves = {
            'Thunder Wave': { targetStatus: 'par' },
            'Toxic': { targetStatus: 'tox' },
            'Will-O-Wisp': { targetStatus: 'brn' },
            'Hypnosis': { targetStatus: 'slp' },
            'Sleep Powder': { targetStatus: 'slp' },
            'Spore': { targetStatus: 'slp' },
            'Sing': { targetStatus: 'slp' },
            'Lovely Kiss': { targetStatus: 'slp' },
            'Dark Void': { targetStatus: 'slp' },
            'Stun Spore': { targetStatus: 'par' },
            'Glare': { targetStatus: 'par' },
            'Nuzzle': { targetStatus: 'par' },
            'Poison Gas': { targetStatus: 'psn' },
            'Poison Powder': { targetStatus: 'psn' }
        };

        // Stat boosting moves
        var boostMoves = {
            'Swords Dance': { atk: 2 },
            'Dragon Dance': { atk: 1, spe: 1 },
            'Nasty Plot': { spa: 2 },
            'Calm Mind': { spa: 1, spd: 1 },
            'Bulk Up': { atk: 1, def: 1 },
            'Iron Defense': { def: 2 },
            'Amnesia': { spd: 2 },
            'Agility': { spe: 2 },
            'Rock Polish': { spe: 2 },
            'Quiver Dance': { spa: 1, spd: 1, spe: 1 },
            'Shell Smash': { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 },
            'Curse': { atk: 1, def: 1, spe: -1 },
            'Growth': { atk: 1, spa: 1 },
            'Work Up': { atk: 1, spa: 1 },
            'Hone Claws': { atk: 1, accuracy: 1 },
            'Coil': { atk: 1, def: 1, accuracy: 1 },
            'Tail Glow': { spa: 3 },
            'Cotton Guard': { def: 3 },
            'Belly Drum': { atk: 6 },
            'Minimize': { evasion: 2 },
            'Double Team': { evasion: 1 },
            'Autotomize': { spe: 2 }
        };

        // Stat lowering moves
        var lowerMoves = {
            'Growl': { targetBoosts: { atk: -1 } },
            'Leer': { targetBoosts: { def: -1 } },
            'Screech': { targetBoosts: { def: -2 } },
            'Fake Tears': { targetBoosts: { spd: -2 } },
            'Metal Sound': { targetBoosts: { spd: -2 } },
            'Scary Face': { targetBoosts: { spe: -2 } },
            'Cotton Spore': { targetBoosts: { spe: -2 } },
            'String Shot': { targetBoosts: { spe: -2 } },
            'Charm': { targetBoosts: { atk: -2 } },
            'Feather Dance': { targetBoosts: { atk: -2 } },
            'Tickle': { targetBoosts: { atk: -1, def: -1 } },
            'Memento': { targetBoosts: { atk: -2, spa: -2 } },
            'Captivate': { targetBoosts: { spa: -2 } },
            'Confide': { targetBoosts: { spa: -1 } },
            'Noble Roar': { targetBoosts: { atk: -1, spa: -1 } },
            'Parting Shot': { targetBoosts: { atk: -1, spa: -1 } },
            'King\'s Shield': { targetBoosts: { atk: -2 } },
            'Baneful Bunker': { targetBoosts: {} }
        };

        // Hazard moves
        var hazardMoves = {
            'Stealth Rock': { hazard: 'stealthRock', side: 'defender' },
            'Spikes': { hazard: 'spikes', side: 'defender' },
            'Toxic Spikes': { hazard: 'toxicSpikes', side: 'defender' },
            'Sticky Web': { hazard: 'stickyWeb', side: 'defender' }
        };

        // Screen moves
        var screenMoves = {
            'Reflect': { screen: 'reflect', turns: 5 },
            'Light Screen': { screen: 'lightScreen', turns: 5 },
            'Aurora Veil': { screen: 'auroraVeil', turns: 5 }
        };

        // Weather moves
        var weatherMoves = {
            'Rain Dance': { weather: 'Rain', turns: 5 },
            'Sunny Day': { weather: 'Sun', turns: 5 },
            'Sandstorm': { weather: 'Sand', turns: 5 },
            'Hail': { weather: 'Hail', turns: 5 },
            'Snowscape': { weather: 'Snow', turns: 5 }
        };

        // Healing moves
        var healMoves = {
            'Recover': { heal: 0.5 },
            'Soft-Boiled': { heal: 0.5 },
            'Milk Drink': { heal: 0.5 },
            'Slack Off': { heal: 0.5 },
            'Roost': { heal: 0.5 },
            'Synthesis': { heal: 0.5 },
            'Morning Sun': { heal: 0.5 },
            'Moonlight': { heal: 0.5 },
            'Rest': { heal: 1, targetStatus: 'slp' },
            'Wish': { heal: 0.5, delayed: true },
            'Shore Up': { heal: 0.5 },
            'Strength Sap': { heal: 'target_atk' }
        };

        if (statusMoves[moveName]) {
            effects.targetStatus = statusMoves[moveName].targetStatus;
        }

        if (boostMoves[moveName]) {
            effects.selfBoosts = boostMoves[moveName];
        }

        if (lowerMoves[moveName]) {
            effects.targetBoosts = lowerMoves[moveName].targetBoosts;
        }

        if (hazardMoves[moveName]) {
            effects.hazards = hazardMoves[moveName];
        }

        if (screenMoves[moveName]) {
            effects.screens = screenMoves[moveName];
        }

        if (weatherMoves[moveName]) {
            effects.weather = weatherMoves[moveName];
        }

        if (healMoves[moveName]) {
            effects.heal = healMoves[moveName].heal;
            if (healMoves[moveName].targetStatus) {
                effects.selfStatus = healMoves[moveName].targetStatus;
            }
        }

        return effects;
    }

    /**
     * Get secondary effect chances from moves
     */
    function getSecondaryEffects(moveData) {
        var effects = [];

        if (!moveData) return effects;

        // Common secondary effects
        var secondaryEffectMoves = {
            'Thunderbolt': { status: 'par', chance: 0.1 },
            'Thunder': { status: 'par', chance: 0.3 },
            'Ice Beam': { status: 'frz', chance: 0.1 },
            'Blizzard': { status: 'frz', chance: 0.1 },
            'Flamethrower': { status: 'brn', chance: 0.1 },
            'Fire Blast': { status: 'brn', chance: 0.1 },
            'Scald': { status: 'brn', chance: 0.3 },
            'Lava Plume': { status: 'brn', chance: 0.3 },
            'Sludge Bomb': { status: 'psn', chance: 0.3 },
            'Poison Jab': { status: 'psn', chance: 0.3 },
            'Body Slam': { status: 'par', chance: 0.3 },
            'Discharge': { status: 'par', chance: 0.3 },
            'Iron Head': { flinch: true, chance: 0.3 },
            'Rock Slide': { flinch: true, chance: 0.3 },
            'Fake Out': { flinch: true, chance: 1 },
            'Air Slash': { flinch: true, chance: 0.3 },
            'Waterfall': { flinch: true, chance: 0.2 },
            'Zen Headbutt': { flinch: true, chance: 0.2 },
            'Close Combat': { selfBoost: { def: -1, spd: -1 } },
            'Superpower': { selfBoost: { atk: -1, def: -1 } },
            'Draco Meteor': { selfBoost: { spa: -2 } },
            'Overheat': { selfBoost: { spa: -2 } },
            'Leaf Storm': { selfBoost: { spa: -2 } },
            'Psycho Boost': { selfBoost: { spa: -2 } },
            'V-create': { selfBoost: { def: -1, spd: -1, spe: -1 } },
            'Hammer Arm': { selfBoost: { spe: -1 } },
            'Power-Up Punch': { selfBoost: { atk: 1 } },
            'Flame Charge': { selfBoost: { spe: 1 } },
            'Ancient Power': { selfBoost: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, chance: 0.1 },
            'Shadow Ball': { targetBoost: { spd: -1 }, chance: 0.2 },
            'Psychic': { targetBoost: { spd: -1 }, chance: 0.1 },
            'Earth Power': { targetBoost: { spd: -1 }, chance: 0.1 },
            'Energy Ball': { targetBoost: { spd: -1 }, chance: 0.1 },
            'Flash Cannon': { targetBoost: { spd: -1 }, chance: 0.1 },
            'Crunch': { targetBoost: { def: -1 }, chance: 0.2 }
        };

        var moveName = moveData.name || '';
        if (secondaryEffectMoves[moveName]) {
            effects.push(secondaryEffectMoves[moveName]);
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
        var effectiveness = getTypeEffectiveness(moveType, defenderTypes);
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

    /**
     * Get accuracy considering all modifiers
     */
    function getAccuracy(moveData, attacker, defender, field, gen) {
        if (!moveData) return 100;

        if (moveData.accuracy === true || moveData.accuracy === 0) return 100;

        var baseAccuracy = moveData.accuracy || 100;

        var attackerAbility = attacker ? (attacker.ability || '') : '';
        var defenderAbility = defender ? (defender.ability || '') : '';

        if (attackerAbility === 'No Guard' || defenderAbility === 'No Guard') {
            return 100;
        }
        if (attackerAbility === 'Compound Eyes') {
            baseAccuracy = Math.floor(baseAccuracy * 1.3);
        }
        if (attackerAbility === 'Hustle' && moveData.category === 'Physical') {
            baseAccuracy = Math.floor(baseAccuracy * 0.8);
        }

        var attackerItem = attacker ? (attacker.item || '') : '';
        if (attackerItem === 'Wide Lens') {
            baseAccuracy = Math.floor(baseAccuracy * 1.1);
        }

        var weather = field && field.weather ? field.weather : '';
        var moveName = moveData.name || '';

        if (moveName === 'Thunder' || moveName === 'Hurricane') {
            if (weather === 'Rain' || weather === 'Heavy Rain') {
                return 100;
            }
            if (weather === 'Sun' || weather === 'Harsh Sunshine') {
                baseAccuracy = 50;
            }
        }
        if (moveName === 'Blizzard' && (weather === 'Hail' || weather === 'Snow')) {
            return 100;
        }

        if (field && field.isGravity) {
            baseAccuracy = Math.floor(baseAccuracy * 5 / 3);
        }

        return Math.min(100, baseAccuracy);
    }

    /**
     * Get crit chance as a decimal
     */
    function getCritChance(move, attacker, defender, field, gen) {
        if (!move) return 0;

        var moveName = move.name || '';

        var alwaysCrit = ['Storm Throw', 'Frost Breath', 'Zippy Zap', 'Surging Strikes', 'Wicked Blow'];
        if (alwaysCrit.indexOf(moveName) !== -1) return 1;

        var defenderAbility = defender ? (defender.ability || '') : '';
        if (defenderAbility === 'Battle Armor' || defenderAbility === 'Shell Armor') {
            return 0;
        }

        var critStage = 0;

        var highCritMoves = [
            'Slash', 'Karate Chop', 'Razor Leaf', 'Crabhammer', 'Shadow Claw',
            'Stone Edge', 'Cross Chop', 'Aeroblast', 'Night Slash', 'Psycho Cut',
            'Spacial Rend', 'Air Cutter', 'Attack Order', 'Blaze Kick', 'Cross Poison',
            'Drill Run', 'Leaf Blade', 'Poison Tail', 'Sky Attack', 'Shadow Blast'
        ];
        if (highCritMoves.indexOf(moveName) !== -1) critStage++;

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
     * Extract damage range from result
     */
    function getDamageRange(result) {
        if (!result) return { min: 0, max: 0, avg: 0, rolls: [] };

        var damage = result.damage;
        var min = 0, max = 0, avg = 0;

        if (typeof damage === 'number') {
            min = max = avg = damage;
        } else if (Array.isArray(damage)) {
            if (damage.length === 2 && Array.isArray(damage[0])) {
                // Parental Bond or multi-hit
                var d0 = damage[0];
                var d1 = damage[1];
                min = (d0[0] || 0) + (d1[0] || 0);
                max = (d0[d0.length - 1] || 0) + (d1[d1.length - 1] || 0);
                avg = Math.floor((min + max) / 2);
            } else if (damage.length > 0) {
                // Regular damage array (16 rolls)
                min = Math.min.apply(null, damage);
                max = Math.max.apply(null, damage);
                var sum = 0;
                for (var i = 0; i < damage.length; i++) {
                    sum += (damage[i] || 0);
                }
                avg = Math.floor(sum / damage.length);
            }
        }

        // Fallback: if avg is still 0 but min/max aren't, use their average
        if (avg === 0 && (min > 0 || max > 0)) {
            avg = Math.floor((min + max) / 2);
        }

        return { min: min, max: max, avg: avg, rolls: damage };
    }

    /**
     * Simplify outcomes by filtering low probability ones
     */
    function simplifyOutcomes(outcomes, threshold) {
        threshold = threshold || 0.01;

        var significant = outcomes.filter(function (o) {
            return o.probability >= threshold;
        });

        var remainingProb = 0;
        outcomes.forEach(function (o) {
            if (o.probability < threshold) {
                remainingProb += o.probability;
            }
        });

        if (remainingProb > 0 && significant.length > 0) {
            significant[0].probability += remainingProb;
        }

        return significant;
    }

    /**
     * Apply item effects after damage
     */
    function applyItemEffects(pokemon, damage) {
        var effects = { healed: 0, itemConsumed: false, itemEffect: null };

        if (!pokemon || !pokemon.item) return effects;

        var item = pokemon.item;
        var currentHP = pokemon.currentHP;
        var maxHP = pokemon.maxHP;
        var newHP = currentHP - damage;
        var hpPercent = (newHP / maxHP) * 100;

        // Oran Berry - Heals 10 HP when HP drops to 50% or below
        if (item === 'Oran Berry' && hpPercent <= 50 && currentHP > maxHP * 0.5) {
            effects.healed = 10;
            effects.itemConsumed = true;
            effects.itemEffect = 'Oran Berry restored 10 HP';
        }

        // Sitrus Berry - Heals 25% HP when HP drops to 50% or below
        if (item === 'Sitrus Berry' && hpPercent <= 50 && currentHP > maxHP * 0.5) {
            effects.healed = Math.floor(maxHP * 0.25);
            effects.itemConsumed = true;
            effects.itemEffect = 'Sitrus Berry restored ' + effects.healed + ' HP';
        }

        // Focus Sash - Survives OHKO at full HP
        if (item === 'Focus Sash' && currentHP === maxHP && newHP <= 0) {
            effects.healed = 1 - newHP; // Restore to 1 HP
            effects.itemConsumed = true;
            effects.itemEffect = 'Focus Sash kept the Pokemon at 1 HP';
        }

        // Focus Band - 10% chance to survive at 1 HP
        if (item === 'Focus Band' && newHP <= 0) {
            // This would be handled as a separate outcome branch
            effects.focusBandChance = true;
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

            // Apply self boosts
            if (statusEffects.selfBoosts) {
                for (var stat in statusEffects.selfBoosts) {
                    if (stat !== 'accuracy' && stat !== 'evasion') {
                        attacker.applyBoost(stat, statusEffects.selfBoosts[stat]);
                    }
                }
            }

            // Apply target boosts (debuffs)
            if (statusEffects.targetBoosts) {
                for (var stat in statusEffects.targetBoosts) {
                    if (stat !== 'accuracy' && stat !== 'evasion') {
                        defender.applyBoost(stat, statusEffects.targetBoosts[stat]);
                    }
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

        // Update team slot HP
        if (attackerSide === 'p1' && newState.p2.team[newState.p2.teamSlot]) {
            newState.p2.team[newState.p2.teamSlot] = defender.clone();
        } else if (attackerSide === 'p2' && newState.p1.team[newState.p1.teamSlot]) {
            newState.p1.team[newState.p1.teamSlot] = attacker.clone();
        }

        return newState;
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
                // Ensure current state is applied
                if (typeof snapshot.currentHP === 'number') {
                    cloned.curHP = snapshot.currentHP;
                }
                if (snapshot.status) {
                    cloned.status = snapshot._statusNameToCode ? snapshot._statusNameToCode(snapshot.status) : '';
                }
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

    // Simple Pokedex number lookup
    function getPokedexNumber(name) {
        var numbers = {
            'bulbasaur': 1, 'ivysaur': 2, 'venusaur': 3, 'charmander': 4, 'charmeleon': 5,
            'charizard': 6, 'squirtle': 7, 'wartortle': 8, 'blastoise': 9, 'caterpie': 10,
            'pikachu': 25, 'raichu': 26, 'snorlax': 143, 'mew': 151, 'mewtwo': 150,
            'tyranitar': 248, 'salamence': 373, 'metagross': 376, 'garchomp': 445,
            'lucario': 448, 'togekiss': 468, 'darkrai': 491, 'arceus': 493,
            'houndoom': 229, 'minccino': 572
            // Add more as needed
        };

        var normalized = name.toLowerCase().replace(/[^a-z]/g, '');
        return numbers[normalized] || 0;
    }

    // Export
    window.BattlePlanner.CalcIntegration = {
        calculateAllOutcomes: calculateAllOutcomes,
        calculateKeyOutcomes: calculateKeyOutcomes,
        getAccuracy: getAccuracy,
        getCritChance: getCritChance,
        getDamageRange: getDamageRange,
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
