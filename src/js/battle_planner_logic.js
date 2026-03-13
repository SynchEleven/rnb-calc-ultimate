/**
 * Battle Planner Logic - Pure functions extracted for testability.
 *
 * All functions here operate on PokemonSnapshot / BattleStateSnapshot objects
 * and have no DOM or UI dependencies.
 */

(function (window) {
    'use strict';

    var PRIORITY_MOVES = {
        'Quick Attack': 1, 'Mach Punch': 1, 'Aqua Jet': 1, 'Ice Shard': 1,
        'Bullet Punch': 1, 'Shadow Sneak': 1, 'Sucker Punch': 1, 'Vacuum Wave': 1,
        'Water Shuriken': 1, 'Accelerock': 1,
        'Extreme Speed': 2, 'First Impression': 2,
        'Fake Out': 3,
        'Protect': 4, 'Detect': 4, 'Endure': 4, 'King\'s Shield': 4,
        'Baneful Bunker': 4, 'Spiky Shield': 4,
        'Pursuit': -1, 'Roar': -6, 'Whirlwind': -6,
        'Trick Room': -7, 'Teleport': -6
    };

    /**
     * Get priority bracket for a move, using the calc engine when available
     * and falling back to a hardcoded table.
     */
    function getMovePriority(moveName, gen) {
        if (!moveName) return 0;

        try {
            if (window.calc && window.calc.Generations) {
                var genNum = (gen && gen.num) ? gen.num : (typeof gen === 'number' ? gen : 3);
                var genObj = window.calc.Generations.get(genNum);
                if (genObj && genObj.moves) {
                    var moveData = genObj.moves.get(window.calc.toID(moveName));
                    if (moveData && moveData.priority !== undefined) return moveData.priority;
                }
            }
        } catch (e) { /* fall through */ }

        return PRIORITY_MOVES[moveName] || 0;
    }

    /**
     * Determine which side moves first given priorities, speeds, and Trick Room.
     * Returns { firstMover: 'p1'|'p2', secondMover: 'p1'|'p2', reason: string }
     *
     * Pass a seeded random value (0-1) for deterministic speed-tie resolution in tests.
     */
    function resolveSpeedOrder(p1Priority, p2Priority, p1Speed, p2Speed, isTrickRoom, randomValue) {
        if (p1Priority !== p2Priority) {
            var first = p1Priority > p2Priority ? 'p1' : 'p2';
            return { firstMover: first, secondMover: first === 'p1' ? 'p2' : 'p1', reason: 'priority' };
        }

        if (p1Speed !== p2Speed) {
            var first;
            if (isTrickRoom) {
                first = p1Speed < p2Speed ? 'p1' : 'p2';
            } else {
                first = p1Speed > p2Speed ? 'p1' : 'p2';
            }
            return { firstMover: first, secondMover: first === 'p1' ? 'p2' : 'p1', reason: isTrickRoom ? 'trick_room' : 'speed' };
        }

        var rand = typeof randomValue === 'number' ? randomValue : Math.random();
        var first = rand < 0.5 ? 'p1' : 'p2';
        return { firstMover: first, secondMover: first === 'p1' ? 'p2' : 'p1', reason: 'speed_tie' };
    }

    /**
     * Apply end-of-turn effects to a battle state, mutating it in place.
     * Returns an array of human-readable effect descriptions.
     */
    function applyEndOfTurnEffects(state, gen) {
        var effects = [];

        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon || pokemon.currentHP <= 0) return;

            if (pokemon.status) {
                var statusDamage = 0;
                var statusName = '';
                var statusLower = pokemon.status.toLowerCase();

                if (statusLower === 'psn' || statusLower === 'poison' || statusLower === 'poisoned') {
                    statusDamage = Math.max(1, Math.floor(pokemon.maxHP / 8));
                    statusName = 'Poison';
                } else if (statusLower === 'tox' || statusLower === 'toxic' || statusLower === 'badly poisoned') {
                    var toxicCounter = pokemon.toxicCounter || 1;
                    statusDamage = Math.max(1, Math.floor(pokemon.maxHP * toxicCounter / 16));
                    pokemon.toxicCounter = Math.min(15, toxicCounter + 1);
                    statusName = 'Toxic';
                } else if (statusLower === 'brn' || statusLower === 'burn' || statusLower === 'burned') {
                    statusDamage = gen >= 7
                        ? Math.max(1, Math.floor(pokemon.maxHP / 16))
                        : Math.max(1, Math.floor(pokemon.maxHP / 8));
                    statusName = 'Burn';
                }

                if (statusDamage > 0) {
                    if (pokemon.ability && pokemon.ability === 'Magic Guard') {
                        // Magic Guard blocks indirect damage
                    } else {
                        pokemon.currentHP = Math.max(0, pokemon.currentHP - statusDamage);
                        pokemon.hasFainted = pokemon.currentHP <= 0;
                        effects.push(pokemon.name + ' takes ' + statusDamage + ' damage from ' + statusName);
                    }
                }
            }
        });

        // Weather damage
        if (state.field && state.field.weather && state.field.weather !== 'None') {
            var weather = state.field.weather.toLowerCase();

            ['p1', 'p2'].forEach(function (side) {
                var pokemon = state[side].active;
                if (!pokemon || pokemon.currentHP <= 0) return;

                var types = pokemon.types || [];
                var ability = (pokemon.ability || '').replace(/\s/g, '').toLowerCase();
                var isImmune = false;
                var weatherDamage = 0;
                var weatherName = '';

                if (ability === 'magicguard') {
                    isImmune = true;
                }

                if (weather === 'sand' || weather === 'sandstorm') {
                    if (!isImmune) {
                        isImmune = types.indexOf('Ground') !== -1 || types.indexOf('Rock') !== -1 || types.indexOf('Steel') !== -1;
                        if (['sandveil', 'sandforce', 'sandrush', 'overcoat'].indexOf(ability) !== -1) {
                            isImmune = true;
                        }
                    }
                    if (!isImmune) {
                        weatherDamage = Math.max(1, Math.floor(pokemon.maxHP / 16));
                        weatherName = 'Sandstorm';
                    }
                } else if (weather === 'hail') {
                    if (!isImmune) {
                        isImmune = types.indexOf('Ice') !== -1;
                        if (['icebody', 'snowcloak', 'overcoat', 'slushrush'].indexOf(ability) !== -1) {
                            isImmune = true;
                        }
                    }
                    if (!isImmune) {
                        weatherDamage = Math.max(1, Math.floor(pokemon.maxHP / 16));
                        weatherName = 'Hail';
                    }
                }

                if (weatherDamage > 0) {
                    pokemon.currentHP = Math.max(0, pokemon.currentHP - weatherDamage);
                    pokemon.hasFainted = pokemon.currentHP <= 0;
                    effects.push(pokemon.name + ' takes ' + weatherDamage + ' damage from ' + weatherName);
                }
            });
        }

        // Leftovers / Black Sludge
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon || pokemon.currentHP <= 0) return;

            var item = (pokemon.item || '');
            var types = pokemon.types || [];

            if (item === 'Leftovers') {
                var heal = Math.max(1, Math.floor(pokemon.maxHP / 16));
                if (pokemon.currentHP < pokemon.maxHP) {
                    pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                    effects.push(pokemon.name + ' recovers ' + heal + ' HP from Leftovers');
                }
            } else if (item === 'Black Sludge') {
                if (types.indexOf('Poison') !== -1) {
                    var heal = Math.max(1, Math.floor(pokemon.maxHP / 16));
                    if (pokemon.currentHP < pokemon.maxHP) {
                        pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                        effects.push(pokemon.name + ' recovers ' + heal + ' HP from Black Sludge');
                    }
                } else {
                    var damage = Math.max(1, Math.floor(pokemon.maxHP / 8));
                    pokemon.currentHP = Math.max(0, pokemon.currentHP - damage);
                    pokemon.hasFainted = pokemon.currentHP <= 0;
                    effects.push(pokemon.name + ' takes ' + damage + ' damage from Black Sludge');
                }
            }
        });

        // Berry consumption at low HP (end-of-turn check)
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon || pokemon.currentHP <= 0) return;

            var item = pokemon.item || '';
            var hpPercent = pokemon.currentHP / pokemon.maxHP;

            if (item === 'Sitrus Berry' && hpPercent <= 0.5) {
                var heal = Math.floor(pokemon.maxHP / 4);
                pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                pokemon.item = '';
                effects.push(pokemon.name + ' ate its Sitrus Berry and recovered ' + heal + ' HP');
            } else if (item === 'Oran Berry' && hpPercent <= 0.5) {
                var heal = 10;
                pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                pokemon.item = '';
                effects.push(pokemon.name + ' ate its Oran Berry and recovered 10 HP');
            }
        });

        // Decrement weather turns
        if (state.field && state.field.weatherTurns > 0) {
            state.field.weatherTurns--;
            if (state.field.weatherTurns <= 0) {
                effects.push('The ' + state.field.weather + ' subsided.');
                state.field.weather = 'None';
                state.field.weatherTurns = 0;
            }
        }

        // Decrement screen turns
        ['p1', 'p2'].forEach(function (side) {
            var s = state.sides[side];
            if (s.reflect && s.reflectTurns > 0) {
                s.reflectTurns--;
                if (s.reflectTurns <= 0) { s.reflect = false; effects.push(side + '\'s Reflect faded.'); }
            }
            if (s.lightScreen && s.lightScreenTurns > 0) {
                s.lightScreenTurns--;
                if (s.lightScreenTurns <= 0) { s.lightScreen = false; effects.push(side + '\'s Light Screen faded.'); }
            }
            if (s.auroraVeil && s.auroraVeilTurns > 0) {
                s.auroraVeilTurns--;
                if (s.auroraVeilTurns <= 0) { s.auroraVeil = false; effects.push(side + '\'s Aurora Veil faded.'); }
            }
            if (s.tailwind && s.tailwindTurns > 0) {
                s.tailwindTurns--;
                if (s.tailwindTurns <= 0) { s.tailwind = false; effects.push(side + '\'s Tailwind died down.'); }
            }
        });

        // Decrement Trick Room turns
        if (state.field && state.field.trickRoom && state.field.trickRoomTurns > 0) {
            state.field.trickRoomTurns--;
            if (state.field.trickRoomTurns <= 0) {
                state.field.trickRoom = false;
                effects.push('Trick Room ended.');
            }
        }

        // Update percentHP and hasFainted on both sides
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon) return;
            pokemon.percentHP = pokemon.maxHP > 0 ? Math.round((pokemon.currentHP / pokemon.maxHP) * 100) : 0;
            pokemon.hasFainted = pokemon.currentHP <= 0;
        });

        return effects;
    }

    /**
     * Apply entry hazard damage when a Pokemon switches in.
     * Mutates the pokemon snapshot. Returns array of effect descriptions.
     */
    function applyEntryHazards(pokemon, sideState) {
        var effects = [];
        if (!pokemon || !sideState) return effects;
        if (pokemon.currentHP <= 0) return effects;

        var types = pokemon.types || [];
        var ability = (pokemon.ability || '').replace(/\s/g, '').toLowerCase();

        if (ability === 'magicguard') return effects;

        // Stealth Rock: type-chart based on Rock vs defender types
        if (sideState.stealthRock) {
            var rockEffectiveness = getHazardEffectiveness('Rock', types);
            var srDamage = Math.max(1, Math.floor(pokemon.maxHP * rockEffectiveness / 8));
            pokemon.currentHP = Math.max(0, pokemon.currentHP - srDamage);
            effects.push(pokemon.name + ' takes ' + srDamage + ' damage from Stealth Rock');
        }

        // Spikes: 1/8, 1/6, 1/4 max HP for 1, 2, 3 layers; Flying immune
        if (sideState.spikes > 0 && types.indexOf('Flying') === -1 && ability !== 'levitate') {
            var spikeDivisors = [0, 8, 6, 4];
            var layers = Math.min(3, sideState.spikes);
            var spikeDamage = Math.max(1, Math.floor(pokemon.maxHP / spikeDivisors[layers]));
            pokemon.currentHP = Math.max(0, pokemon.currentHP - spikeDamage);
            effects.push(pokemon.name + ' takes ' + spikeDamage + ' damage from Spikes');
        }

        // Toxic Spikes: 1 layer = Poison, 2 layers = Toxic; Poison-type absorbs
        if (sideState.toxicSpikes > 0 && types.indexOf('Flying') === -1 && ability !== 'levitate') {
            if (types.indexOf('Poison') !== -1) {
                sideState.toxicSpikes = 0;
                effects.push(pokemon.name + ' absorbed the Toxic Spikes');
            } else if (types.indexOf('Steel') === -1) {
                if (!pokemon.status || pokemon.status === 'Healthy') {
                    if (sideState.toxicSpikes >= 2) {
                        pokemon.status = 'Badly Poisoned';
                        pokemon.toxicCounter = 1;
                        effects.push(pokemon.name + ' was badly poisoned by Toxic Spikes');
                    } else {
                        pokemon.status = 'Poisoned';
                        effects.push(pokemon.name + ' was poisoned by Toxic Spikes');
                    }
                }
            }
        }

        // Sticky Web: -1 Speed
        if (sideState.stickyWeb && types.indexOf('Flying') === -1 && ability !== 'levitate') {
            if (!pokemon.boosts) pokemon.boosts = {};
            pokemon.boosts.spe = Math.max(-6, (pokemon.boosts.spe || 0) - 1);
            effects.push(pokemon.name + '\'s Speed was lowered by Sticky Web');
        }

        pokemon.percentHP = pokemon.maxHP > 0 ? Math.round((pokemon.currentHP / pokemon.maxHP) * 100) : 0;
        pokemon.hasFainted = pokemon.currentHP <= 0;

        return effects;
    }

    /**
     * Simplified type chart multiplier for hazard calculations.
     */
    function getHazardEffectiveness(hazardType, defenderTypes) {
        var chart = {
            Rock: {
                Fire: 2, Ice: 2, Flying: 2, Bug: 2,
                Fighting: 0.5, Ground: 0.5, Steel: 0.5,
                Normal: 1, Water: 1, Electric: 1, Grass: 1,
                Poison: 1, Psychic: 1, Ghost: 1, Dragon: 1, Dark: 1, Fairy: 1
            }
        };

        var typeChart = chart[hazardType];
        if (!typeChart) return 1;

        var multiplier = 1;
        for (var i = 0; i < defenderTypes.length; i++) {
            multiplier *= (typeChart[defenderTypes[i]] || 1);
        }
        return multiplier;
    }

    /**
     * Apply move secondary effects (status, stat changes) to attacker/defender.
     * Deterministic -- the caller decides whether to apply them.
     */
    function applyMoveEffects(attacker, defender, moveData) {
        if (!moveData) return;

        if (moveData.status && (!defender.status || defender.status === 'Healthy')) {
            defender.status = moveData.status;
        }

        if (moveData.boosts) {
            if (!defender.boosts) defender.boosts = {};
            var stats = Object.keys(moveData.boosts);
            for (var i = 0; i < stats.length; i++) {
                var stat = stats[i];
                defender.boosts[stat] = Math.max(-6, Math.min(6, (defender.boosts[stat] || 0) + moveData.boosts[stat]));
            }
        }

        if (moveData.self && moveData.self.boosts) {
            if (!attacker.boosts) attacker.boosts = {};
            var stats = Object.keys(moveData.self.boosts);
            for (var i = 0; i < stats.length; i++) {
                var stat = stats[i];
                attacker.boosts[stat] = Math.max(-6, Math.min(6, (attacker.boosts[stat] || 0) + moveData.self.boosts[stat]));
            }
        }

        if (moveData.secondary) {
            if (moveData.secondary.status && (!defender.status || defender.status === 'Healthy')) {
                defender.status = moveData.secondary.status;
            }
            if (moveData.secondary.boosts) {
                if (!defender.boosts) defender.boosts = {};
                var stats = Object.keys(moveData.secondary.boosts);
                for (var i = 0; i < stats.length; i++) {
                    var stat = stats[i];
                    defender.boosts[stat] = Math.max(-6, Math.min(6, (defender.boosts[stat] || 0) + moveData.secondary.boosts[stat]));
                }
            }
        }
    }

    /**
     * Perform a switch: sync current active back to team, load new slot,
     * reset boosts, and apply entry hazards.
     *
     * Returns an array of hazard effect descriptions.
     */
    function performSwitch(state, side, targetSlot) {
        var sideData = state[side];
        if (!sideData || !sideData.team || !sideData.team[targetSlot]) return [];

        // Sync current active back to team
        if (sideData.active && sideData.teamSlot !== undefined && sideData.team[sideData.teamSlot]) {
            sideData.team[sideData.teamSlot].currentHP = sideData.active.currentHP;
            sideData.team[sideData.teamSlot].status = sideData.active.status;
            sideData.team[sideData.teamSlot].boosts = {};
        }

        // Switch in new Pokemon
        sideData.teamSlot = targetSlot;
        sideData.active = sideData.team[targetSlot].clone();
        sideData.active.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };

        // Apply entry hazards
        var hazardEffects = applyEntryHazards(sideData.active, state.sides[side]);

        return hazardEffects;
    }

    // Export
    window.BattlePlannerLogic = {
        getMovePriority: getMovePriority,
        resolveSpeedOrder: resolveSpeedOrder,
        applyEndOfTurnEffects: applyEndOfTurnEffects,
        applyEntryHazards: applyEntryHazards,
        applyMoveEffects: applyMoveEffects,
        performSwitch: performSwitch,
        getHazardEffectiveness: getHazardEffectiveness,
        PRIORITY_MOVES: PRIORITY_MOVES
    };

})(typeof window !== 'undefined' ? window : global);
