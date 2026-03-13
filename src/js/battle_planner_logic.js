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

        // Update percentHP, hasFainted, and turnsOnField on both sides
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon) return;
            pokemon.percentHP = pokemon.maxHP > 0 ? Math.round((pokemon.currentHP / pokemon.maxHP) * 100) : 0;
            pokemon.hasFainted = pokemon.currentHP <= 0;
            if (pokemon.turnsOnField !== undefined) {
                pokemon.turnsOnField++;
            }
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
        sideData.active.turnsOnField = 0;

        // Apply entry hazards
        var hazardEffects = applyEntryHazards(sideData.active, state.sides[side]);

        return hazardEffects;
    }

    /**
     * Score an AI candidate switch-in against the player's active Pokemon.
     *
     * @param {object} params
     * @param {string} params.candidateName      - species name of the candidate
     * @param {number} params.candidateSpeed      - effective speed of the candidate
     * @param {number} params.candidateHP         - current HP of the candidate
     * @param {number} params.playerSpeed         - effective speed of the player active
     * @param {number} params.playerHP            - current HP of the player active
     * @param {number} params.bestAIMoveDamage    - max damage the candidate's best move does to player
     * @param {number} params.bestAIMovePct       - that damage as % of player max HP
     * @param {number} params.bestPlayerMoveDamage - max damage player's best move does to candidate
     * @param {number} params.bestPlayerMovePct   - that damage as % of candidate max HP
     *
     * @returns {object} { score: number, reason: string }
     */
    function scoreAISwitchIn(params) {
        var name = params.candidateName || '';

        if (name === 'Ditto') {
            return { score: 2, reason: 'Ditto always scores 2' };
        }

        if (name === 'Wynaut' || name === 'Wobbuffet') {
            var wFaster = params.candidateSpeed >= params.playerSpeed;
            var wOHKOd = params.bestPlayerMoveDamage >= params.candidateHP;
            if (!wFaster && wOHKOd) {
                return { score: 0, reason: name + ' slower and OHKO\'d' };
            }
            return { score: 2, reason: name + ' trapper' };
        }

        var aiIsFaster = params.candidateSpeed > params.playerSpeed;
        var aiOHKOs = params.bestAIMoveDamage >= params.playerHP;
        var playerOHKOs = params.bestPlayerMoveDamage >= params.candidateHP;
        var aiDealsBetterPct = params.bestAIMovePct > params.bestPlayerMovePct;

        if (aiIsFaster && aiOHKOs) {
            return { score: 5, reason: 'faster + OHKO' };
        }
        if (!aiIsFaster && aiOHKOs && !playerOHKOs) {
            return { score: 4, reason: 'slower but OHKOs, not OHKOd' };
        }
        if (aiIsFaster && aiDealsBetterPct) {
            return { score: 3, reason: 'faster + better damage%' };
        }
        if (!aiIsFaster && aiDealsBetterPct) {
            return { score: 2, reason: 'slower but better damage%' };
        }
        if (aiIsFaster) {
            return { score: 1, reason: 'faster but worse damage%' };
        }
        if (!aiIsFaster && playerOHKOs) {
            return { score: -1, reason: 'slower and OHKO\'d' };
        }
        return { score: 0, reason: 'default' };
    }

    /**
     * Predict the best AI switch-in from the opponent's alive team members.
     *
     * @param {object}   playerActive  - PokemonSnapshot of the player's active
     * @param {Array}    p2Team        - array of PokemonSnapshot (opponent's full team)
     * @param {number}   faintedSlot   - team index of the fainted Pokemon to exclude
     * @param {number}   gen           - generation number
     * @param {function} calcBestDamage - function(attacker, defender, gen) => number (max damage)
     *
     * @returns {object|null} { slot: number, pokemon: PokemonSnapshot, score: number, reason: string } or null
     */
    function predictAISwitchIn(playerActive, p2Team, faintedSlot, gen, calcBestDamage) {
        if (!playerActive || !p2Team) return null;

        var candidates = [];
        for (var i = 0; i < p2Team.length; i++) {
            if (i === faintedSlot) continue;
            var mon = p2Team[i];
            if (!mon || mon.currentHP <= 0) continue;
            candidates.push({ slot: i, pokemon: mon });
        }

        if (candidates.length === 0) return null;
        if (candidates.length === 1) {
            return { slot: candidates[0].slot, pokemon: candidates[0].pokemon, score: 0, reason: 'only option' };
        }

        var playerSpeed = playerActive.stats ? (playerActive.stats.spe || 0) : 0;
        var playerHP = playerActive.currentHP || 0;
        var playerMaxHP = playerActive.maxHP || 1;

        var best = null;
        for (var c = 0; c < candidates.length; c++) {
            var cand = candidates[c].pokemon;
            var candSpeed = cand.stats ? (cand.stats.spe || 0) : 0;
            var candHP = cand.currentHP || 0;
            var candMaxHP = cand.maxHP || 1;

            var bestAIDmg = 0;
            var bestPlayerDmg = 0;
            if (typeof calcBestDamage === 'function') {
                bestAIDmg = calcBestDamage(cand, playerActive, gen) || 0;
                bestPlayerDmg = calcBestDamage(playerActive, cand, gen) || 0;
            }

            var result = scoreAISwitchIn({
                candidateName: cand.name,
                candidateSpeed: candSpeed,
                candidateHP: candHP,
                playerSpeed: playerSpeed,
                playerHP: playerHP,
                bestAIMoveDamage: bestAIDmg,
                bestAIMovePct: playerMaxHP > 0 ? (bestAIDmg / playerMaxHP) * 100 : 0,
                bestPlayerMoveDamage: bestPlayerDmg,
                bestPlayerMovePct: candMaxHP > 0 ? (bestPlayerDmg / candMaxHP) * 100 : 0
            });

            if (!best || result.score > best.score) {
                best = { slot: candidates[c].slot, pokemon: cand, score: result.score, reason: result.reason };
            }
        }

        return best;
    }

    /**
     * Simulate applying a specific damage value to a defender, including item
     * effects (Focus Sash, berry triggers). Returns the resulting HP.
     *
     * This does NOT mutate the original -- it works on copies of HP/item.
     */
    function simulateHPAfterDamage(defenderHP, defenderMaxHP, damage, item) {
        var hp = defenderHP;
        var itemConsumed = false;

        // Focus Sash: survive with 1 HP if at full
        if (item === 'Focus Sash' && hp === defenderMaxHP && damage >= hp) {
            hp = 1;
            itemConsumed = true;
        } else {
            hp = Math.max(0, hp - damage);
        }

        // Berry triggers (check after damage)
        if (!itemConsumed && hp > 0) {
            var pct = hp / defenderMaxHP;
            if (item === 'Sitrus Berry' && pct <= 0.5) {
                hp = Math.min(defenderMaxHP, hp + Math.floor(defenderMaxHP / 4));
                itemConsumed = true;
            } else if (item === 'Oran Berry' && pct <= 0.5) {
                hp = Math.min(defenderMaxHP, hp + 10);
                itemConsumed = true;
            }
        }

        return { hp: hp, fainted: hp <= 0, itemConsumed: itemConsumed };
    }

    /**
     * Detect whether min vs max damage roll produces a meaningfully different
     * outcome (KO vs survive, berry trigger vs not, etc.).
     *
     * @param {object} defender   - PokemonSnapshot of the target
     * @param {number} minDamage  - min roll damage
     * @param {number} maxDamage  - max roll damage
     *
     * @returns {object|null} null if no meaningful difference, or:
     *   { reason: string, minResult: { hp, fainted, itemConsumed },
     *     maxResult: { hp, fainted, itemConsumed } }
     */
    function detectMeaningfulVariance(defender, minDamage, maxDamage) {
        if (!defender || minDamage === maxDamage) return null;

        var item = defender.item || '';
        var hp = defender.currentHP;
        var maxHP = defender.maxHP;

        var minResult = simulateHPAfterDamage(hp, maxHP, minDamage, item);
        var maxResult = simulateHPAfterDamage(hp, maxHP, maxDamage, item);

        // KO difference
        if (minResult.fainted !== maxResult.fainted) {
            return {
                reason: maxResult.fainted ? 'Max roll KOs, min roll survives' : 'Min roll KOs, max roll survives',
                minResult: minResult,
                maxResult: maxResult
            };
        }

        // Berry/Sash trigger difference
        if (minResult.itemConsumed !== maxResult.itemConsumed) {
            return {
                reason: (maxResult.itemConsumed ? 'Max' : 'Min') + ' roll triggers ' + item,
                minResult: minResult,
                maxResult: maxResult
            };
        }

        // Significant HP difference that could matter later (>15% HP swing)
        var hpDiff = Math.abs(minResult.hp - maxResult.hp);
        if (hpDiff > 0 && maxHP > 0) {
            var pctDiff = (hpDiff / maxHP) * 100;
            if (pctDiff >= 15) {
                return {
                    reason: 'Roll variance is ' + Math.round(pctDiff) + '% HP (' + hpDiff + ' HP)',
                    minResult: minResult,
                    maxResult: maxResult
                };
            }
        }

        return null;
    }

    /**
     * Check accumulated roll variance across turns. Called after each turn to
     * see if past roll differences now cross a KO threshold.
     *
     * @param {object} state - BattleStateSnapshot with rollVariance tracking
     * @param {object} p1Range - { min, max } damage range for P1's move this turn
     * @param {object} p2Range - { min, max } damage range for P2's move this turn
     *
     * @returns {object|null} { side: 'p1'|'p2', reason: string } if a retroactive split is warranted
     */
    function checkAccumulatedVariance(state, p1Range, p2Range) {
        if (!state.rollVariance) {
            state.rollVariance = {
                p1DmgToP2: { minTotal: 0, maxTotal: 0 },
                p2DmgToP1: { minTotal: 0, maxTotal: 0 }
            };
        }

        var rv = state.rollVariance;
        if (p1Range) {
            rv.p1DmgToP2.minTotal += (p1Range.min || 0);
            rv.p1DmgToP2.maxTotal += (p1Range.max || 0);
        }
        if (p2Range) {
            rv.p2DmgToP1.minTotal += (p2Range.min || 0);
            rv.p2DmgToP1.maxTotal += (p2Range.max || 0);
        }

        // Check if accumulated P1 damage variance causes different KO outcome for P2
        var p2 = state.p2.active;
        if (p2 && p2.currentHP > 0) {
            var p2HPAfterAllMin = p2.maxHP - rv.p1DmgToP2.minTotal;
            var p2HPAfterAllMax = p2.maxHP - rv.p1DmgToP2.maxTotal;
            if ((p2HPAfterAllMin > 0) !== (p2HPAfterAllMax > 0)) {
                return { side: 'p2', reason: 'Accumulated P1 rolls now determine P2 KO (' +
                    rv.p1DmgToP2.minTotal + ' min vs ' + rv.p1DmgToP2.maxTotal + ' max total)' };
            }
        }

        // Same for P2 damage to P1
        var p1 = state.p1.active;
        if (p1 && p1.currentHP > 0) {
            var p1HPAfterAllMin = p1.maxHP - rv.p2DmgToP1.minTotal;
            var p1HPAfterAllMax = p1.maxHP - rv.p2DmgToP1.maxTotal;
            if ((p1HPAfterAllMin > 0) !== (p1HPAfterAllMax > 0)) {
                return { side: 'p1', reason: 'Accumulated P2 rolls now determine P1 KO (' +
                    rv.p2DmgToP1.minTotal + ' min vs ' + rv.p2DmgToP1.maxTotal + ' max total)' };
            }
        }

        return null;
    }

    /**
     * Check whether a move causes flinch on the target.
     *
     * @param {object} moveData    - calc engine move data (with .secondary)
     * @param {object} attacker    - PokemonSnapshot of the attacker
     * @param {object} defender    - PokemonSnapshot of the defender
     * @param {string} moveName    - name of the move
     *
     * @returns {object} { flinches: bool, chance: number, isGuaranteed: bool, blocked: bool, reason: string }
     */
    function checkFlinch(moveData, attacker, defender, moveName) {
        var result = { flinches: false, chance: 0, isGuaranteed: false, blocked: false, reason: '' };

        if (!moveData) return result;

        // Check for flinch in secondary
        var hasFlinch = false;
        var flinchChance = 0;

        if (moveData.secondary && moveData.secondary.volatileStatus === 'flinch') {
            hasFlinch = true;
            flinchChance = (moveData.secondary.chance || 100) / 100;
        } else if (moveData.secondaries) {
            for (var i = 0; i < moveData.secondaries.length; i++) {
                if (moveData.secondaries[i].volatileStatus === 'flinch') {
                    hasFlinch = true;
                    flinchChance = (moveData.secondaries[i].chance || 100) / 100;
                    break;
                }
            }
        }

        if (!hasFlinch) return result;

        // Fake Out: only works on the first turn after being sent in.
        // turnsOnField is incremented at end-of-turn, so on the first turn
        // the Pokemon can act, turnsOnField is 0 (just switched in this turn)
        // or 1 (was on field at start, end-of-turn incremented it once).
        var mName = (moveName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (mName === 'fakeout') {
            if (attacker.turnsOnField !== undefined && attacker.turnsOnField > 1) {
                result.reason = 'Fake Out fails after first turn';
                return result;
            }
        }

        // Inner Focus: immune to flinch
        var defAbility = (defender.ability || '').replace(/\s/g, '').toLowerCase();
        if (defAbility === 'innerfocus') {
            result.blocked = true;
            result.reason = 'Inner Focus prevents flinch';
            return result;
        }

        result.flinches = true;
        result.chance = flinchChance;
        result.isGuaranteed = flinchChance >= 1;
        result.reason = result.isGuaranteed ? 'Guaranteed flinch' : (Math.round(flinchChance * 100) + '% flinch chance');

        // Serene Grace doubles flinch chance
        var atkAbility = (attacker.ability || '').replace(/\s/g, '').toLowerCase();
        if (atkAbility === 'serenegrace' && !result.isGuaranteed) {
            result.chance = Math.min(1, flinchChance * 2);
            result.isGuaranteed = result.chance >= 1;
            result.reason = (result.isGuaranteed ? 'Guaranteed' : Math.round(result.chance * 100) + '%') + ' flinch (Serene Grace)';
        }

        return result;
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
        scoreAISwitchIn: scoreAISwitchIn,
        predictAISwitchIn: predictAISwitchIn,
        simulateHPAfterDamage: simulateHPAfterDamage,
        detectMeaningfulVariance: detectMeaningfulVariance,
        checkAccumulatedVariance: checkAccumulatedVariance,
        checkFlinch: checkFlinch,
        PRIORITY_MOVES: PRIORITY_MOVES
    };

})(typeof window !== 'undefined' ? window : global);
