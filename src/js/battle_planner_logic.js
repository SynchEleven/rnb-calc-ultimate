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

    function clampBoost(val) { return Math.max(-6, Math.min(6, val)); }

    function applyBoostMap(target, boosts) {
        if (!boosts) return;
        if (!target.boosts) target.boosts = {};
        var stats = Object.keys(boosts);
        for (var i = 0; i < stats.length; i++) {
            var s = stats[i];
            target.boosts[s] = clampBoost((target.boosts[s] || 0) + boosts[s]);
        }
    }

    /**
     * Apply move effects (status, stat changes, volatiles, side conditions,
     * weather, terrain, switches) to attacker/defender.
     *
     * Uses MoveDB when available, falling back to raw moveData fields.
     * Deterministic -- the caller decides whether to apply them.
     *
     * @param {object} attacker  - PokemonSnapshot
     * @param {object} defender  - PokemonSnapshot
     * @param {object} moveData  - raw move object (from calc or RBDex)
     * @param {object} [state]   - BattleStateSnapshot (needed for side/field effects)
     * @param {string} [attackerSide] - 'p1' or 'p2' (needed for side effects)
     */
    function applyMoveEffects(attacker, defender, moveData, state, attackerSide) {
        if (!moveData) return;

        var db = typeof window !== 'undefined' ? window.MoveDB : null;
        var fx = db ? db.getEffects(moveData.name) : null;

        if (fx) {
            // Primary status
            if (fx.status && (!defender.status || defender.status === 'Healthy')) {
                defender.status = fx.status;
            }

            // Volatile status on target
            if (fx.volatileStatus) {
                if (!defender.volatiles) defender.volatiles = {};
                defender.volatiles[fx.volatileStatus] = true;
            }

            // Target stat changes
            applyBoostMap(defender, fx.targetBoosts);

            // Self stat changes
            applyBoostMap(attacker, fx.selfBoosts);

            // Self volatile (mustrecharge etc.)
            if (fx.selfVolatile) {
                if (!attacker.volatiles) attacker.volatiles = {};
                attacker.volatiles[fx.selfVolatile] = true;
            }

            // Secondaries (applied deterministically when caller opted in)
            for (var i = 0; i < fx.secondaries.length; i++) {
                var sec = fx.secondaries[i];
                if (sec.status && (!defender.status || defender.status === 'Healthy')) {
                    defender.status = sec.status;
                }
                if (sec.volatileStatus) {
                    if (!defender.volatiles) defender.volatiles = {};
                    defender.volatiles[sec.volatileStatus] = true;
                }
                applyBoostMap(defender, sec.targetBoosts);
                applyBoostMap(attacker, sec.selfBoosts);
            }

            // Self-switch / force-switch
            if (fx.selfSwitch) {
                attacker.needsSwitchAfterMove = true;
            }
            if (fx.forceSwitch) {
                defender.needsForcedSwitch = true;
            }

            // Side conditions (hazards, screens, tailwind)
            if (fx.sideCondition && state && attackerSide) {
                var defSide = attackerSide === 'p1' ? 'p2' : 'p1';
                var sc = fx.sideCondition;
                if (sc === 'stealthrock')  state.sides[defSide].stealthRock = true;
                if (sc === 'spikes')       state.sides[defSide].spikes = Math.min(3, (state.sides[defSide].spikes || 0) + 1);
                if (sc === 'toxicspikes')  state.sides[defSide].toxicSpikes = Math.min(2, (state.sides[defSide].toxicSpikes || 0) + 1);
                if (sc === 'stickyweb')    state.sides[defSide].stickyWeb = true;
                if (sc === 'reflect')      { state.sides[attackerSide].reflect = true; state.sides[attackerSide].reflectTurns = 5; }
                if (sc === 'lightscreen')  { state.sides[attackerSide].lightScreen = true; state.sides[attackerSide].lightScreenTurns = 5; }
                if (sc === 'auroraveil')   { state.sides[attackerSide].auroraVeil = true; state.sides[attackerSide].auroraVeilTurns = 5; }
                if (sc === 'tailwind')     { state.sides[attackerSide].tailwind = true; state.sides[attackerSide].tailwindTurns = 4; }
            }

            // Weather
            if (fx.weather && state) {
                var WEATHER_MAP = { RainDance: 'Rain', sunnyday: 'Sun', Sandstorm: 'Sand', hail: 'Hail', snow: 'Snow' };
                state.field.weather = WEATHER_MAP[fx.weather] || fx.weather;
                state.field.weatherTurns = 5;
            }

            // Terrain
            if (fx.terrain && state) {
                state.field.terrain = fx.terrain;
                state.field.terrainTurns = 5;
            }

            return;
        }

        // Fallback: raw moveData fields (when MoveDB not available)
        if (moveData.status && (!defender.status || defender.status === 'Healthy')) {
            defender.status = moveData.status;
        }

        if (moveData.boosts) {
            applyBoostMap(defender, moveData.boosts);
        }

        if (moveData.self && moveData.self.boosts) {
            applyBoostMap(attacker, moveData.self.boosts);
        }

        if (moveData.secondary) {
            if (moveData.secondary.status && (!defender.status || defender.status === 'Healthy')) {
                defender.status = moveData.secondary.status;
            }
            if (moveData.secondary.boosts) {
                applyBoostMap(defender, moveData.secondary.boosts);
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
        sideData.active.turnsOnField = -1;

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
            var only = candidates[0];
            return { slot: only.slot, pokemon: only.pokemon, score: 0, reason: 'only option', allScores: [{ slot: only.slot, name: only.pokemon.name, score: 0, reason: 'only option' }] };
        }

        var playerSpeed = playerActive.stats ? (playerActive.stats.spe || 0) : 0;
        var playerHP = playerActive.currentHP || 0;
        var playerMaxHP = playerActive.maxHP || 1;

        var best = null;
        var allScores = [];
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

            allScores.push({ slot: candidates[c].slot, name: cand.name, score: result.score, reason: result.reason });

            if (!best || result.score > best.score) {
                best = { slot: candidates[c].slot, pokemon: cand, score: result.score, reason: result.reason };
            }
        }

        allScores.sort(function (a, b) { return b.score - a.score; });
        best.allScores = allScores;
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
     * Accepts either raw moveData (legacy) or a moveName string.
     * Prefers MoveDB when available.
     *
     * @param {object|string} moveDataOrName - raw move data OR move name
     * @param {object} attacker    - PokemonSnapshot of the attacker
     * @param {object} defender    - PokemonSnapshot of the defender
     * @param {string} [moveName]  - name of the move (optional if first arg is string)
     *
     * @returns {object} { flinches: bool, chance: number, isGuaranteed: bool, blocked: bool, reason: string }
     */
    function checkFlinch(moveDataOrName, attacker, defender, moveName) {
        var result = { flinches: false, chance: 0, isGuaranteed: false, blocked: false, reason: '' };

        var name = moveName || (typeof moveDataOrName === 'string' ? moveDataOrName : (moveDataOrName && moveDataOrName.name) || '');
        var moveData = typeof moveDataOrName === 'object' ? moveDataOrName : null;

        var hasFlinch = false;
        var flinchChance = 0;

        // Try MoveDB first
        var db = typeof window !== 'undefined' ? window.MoveDB : null;
        if (db && name) {
            var secs = db.getSecondaries(name);
            for (var i = 0; i < secs.length; i++) {
                if (secs[i].volatileStatus === 'flinch') {
                    hasFlinch = true;
                    flinchChance = (secs[i].chance || 100) / 100;
                    break;
                }
            }
        }

        // Fallback to raw moveData
        if (!hasFlinch && moveData) {
            if (moveData.secondary && moveData.secondary.volatileStatus === 'flinch') {
                hasFlinch = true;
                flinchChance = (moveData.secondary.chance || 100) / 100;
            } else if (moveData.secondaries) {
                for (var j = 0; j < moveData.secondaries.length; j++) {
                    if (moveData.secondaries[j].volatileStatus === 'flinch') {
                        hasFlinch = true;
                        flinchChance = (moveData.secondaries[j].chance || 100) / 100;
                        break;
                    }
                }
            }
        }

        if (!hasFlinch) return result;

        // Fake Out: only works on the first turn after being sent in.
        // turnsOnField: constructor=0 (starting mon), performSwitch=-1 (just switched),
        // end-of-turn increments. At move execution: starting T1=0, switched first attack=0.
        var mName = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (mName === 'fakeout') {
            if (attacker && attacker.turnsOnField !== undefined && attacker.turnsOnField > 0) {
                result.reason = 'Fake Out fails after first turn';
                return result;
            }
        }

        // Inner Focus: immune to flinch
        var defAbility = defender ? (defender.ability || '').replace(/\s/g, '').toLowerCase() : '';
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
        var atkAbility = attacker ? (attacker.ability || '').replace(/\s/g, '').toLowerCase() : '';
        if (atkAbility === 'serenegrace' && !result.isGuaranteed) {
            result.chance = Math.min(1, flinchChance * 2);
            result.isGuaranteed = result.chance >= 1;
            result.reason = (result.isGuaranteed ? 'Guaranteed' : Math.round(result.chance * 100) + '%') + ' flinch (Serene Grace)';
        }

        return result;
    }

    // ================================================================
    // AI MOVE SCORING ENGINE
    // Based on Pokemon Run and Bun (1.07) AI document by Croven
    // ================================================================

    function toMoveId(name) {
        return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function getMoveDataFromRBDex(moveName) {
        if (!moveName || typeof window === 'undefined' || !window.RBDex) return null;
        return window.RBDex.getMove(moveName);
    }

    function analyzePlayerMoves(playerMon, aiMon, calcDamage) {
        var result = {
            canKO: false, can2HKO: false, can3HKO: false,
            maxDamage: 0, hasPhysical: false, hasSpecial: false,
            hasStatus: false, hasSoundMove: false, hasFlinchMove: false
        };
        var playerMoves = playerMon.moves || [];
        playerMoves.forEach(function (mn) {
            if (!mn || mn === '(No Move)') return;
            var md = getMoveDataFromRBDex(mn);
            if (!md) return;
            if (md.category === 'Physical') result.hasPhysical = true;
            else if (md.category === 'Special') result.hasSpecial = true;
            else result.hasStatus = true;
            if (md.flags && md.flags.sound) result.hasSoundMove = true;
            if (md.secondary && md.secondary.volatileStatus === 'flinch') result.hasFlinchMove = true;
            if (md.secondaries) {
                md.secondaries.forEach(function (s) {
                    if (s.volatileStatus === 'flinch') result.hasFlinchMove = true;
                });
            }
            if (md.category !== 'Status') {
                try {
                    var dmg = calcDamage(playerMon, aiMon, mn);
                    if (dmg && dmg.max > result.maxDamage) result.maxDamage = dmg.max;
                } catch (e) { /* skip */ }
            }
        });
        var aiHP = aiMon.currentHP || 0;
        result.canKO = result.maxDamage >= aiHP;
        result.can2HKO = (result.maxDamage * 2) >= aiHP;
        result.can3HKO = (result.maxDamage * 3) >= aiHP;
        return result;
    }

    function isPlayerIncapacitated(playerMon) {
        var status = (playerMon.status || '').toLowerCase();
        if (status === 'slp' || status === 'sleep') return true;
        if (status === 'frz' || status === 'frozen') {
            var thawing = { scald:1, flamewheel:1, sacredfire:1, flareblitz:1, fusionflare:1, burnup:1, pyroball:1 };
            var hasThawy = (playerMon.moves || []).some(function (m) { return thawing[toMoveId(m)]; });
            if (!hasThawy) return true;
        }
        return false;
    }

    function shouldAIRecover(aiMon, aiFaster, healPercent, playerMaxDamage) {
        var aiHP = aiMon.currentHP || 0;
        var aiMaxHP = aiMon.maxHP || 1;
        var aiHPPct = (aiHP / aiMaxHP) * 100;
        if (aiHPPct >= 100 || aiHPPct >= 85) return false;
        var status = (aiMon.status || '').toLowerCase();
        if (status === 'tox' || status === 'badly poisoned') return false;
        var healAmt = Math.floor(aiMaxHP * healPercent / 100);
        if (playerMaxDamage >= healAmt) return false;
        if (aiFaster) {
            var hpAfterHeal = Math.min(aiMaxHP, aiHP + healAmt);
            if (playerMaxDamage >= aiHP && playerMaxDamage < hpAfterHeal) return true;
            if (playerMaxDamage < aiHP) {
                if (aiHPPct < 40) return true;
                if (aiHPPct < 66) return true;
            }
        } else {
            if (aiHPPct < 50) return true;
            if (aiHPPct < 70) return true;
        }
        return false;
    }

    /**
     * Score all of the AI's moves based on the Run and Bun AI document.
     *
     * @param {object} aiMon      - AI's active PokemonSnapshot
     * @param {object} playerMon  - Player's active PokemonSnapshot
     * @param {object} state      - BattleStateSnapshot
     * @param {function} calcDamage - (attacker, defender, moveName) => {min,max}|null
     * @returns {Array<{moveName:string, score:number, reason:string}>}
     */
    function scoreAIMoves(aiMon, playerMon, state, calcDamage) {
        var results = [];
        var aiMoves = aiMon.moves || [];
        if (!aiMoves.length) return results;

        // --- Speed ---
        var aiSpeed = aiMon.getEffectiveSpeed
            ? aiMon.getEffectiveSpeed(state.sides ? state.sides.p2 : null)
            : (aiMon.stats ? aiMon.stats.spe : 100);
        var playerSpeed = playerMon.getEffectiveSpeed
            ? playerMon.getEffectiveSpeed(state.sides ? state.sides.p1 : null)
            : (playerMon.stats ? playerMon.stats.spe : 100);
        var isTR = state.field && (state.field.trickRoom || state.field.isTrickRoom);
        var aiFaster = isTR ? (aiSpeed <= playerSpeed) : (aiSpeed >= playerSpeed);

        // --- HP ---
        var aiHP = aiMon.currentHP || 0;
        var aiMaxHP = aiMon.maxHP || 1;
        var aiHPPct = (aiHP / aiMaxHP) * 100;
        var playerHP = playerMon.currentHP || 0;
        var playerMaxHP = playerMon.maxHP || 1;

        // --- Abilities / Items ---
        var aiAbId = toMoveId(aiMon.ability || '');
        var aiItemId = toMoveId(aiMon.item || '');
        var defAbId = toMoveId(playerMon.ability || '');

        // --- Player analysis ---
        var pa = analyzePlayerMoves(playerMon, aiMon, calcDamage);
        var hasSturdy = aiAbId === 'sturdy' && aiHP >= aiMaxHP;
        var hasSash = aiItemId === 'focussash' && aiHP >= aiMaxHP;
        var hasProtection = hasSturdy || hasSash;

        // --- Damage for each AI move ---
        var moveDmgs = [];
        var moveMds = [];
        aiMoves.forEach(function (mn) {
            if (!mn || mn === '(No Move)') { moveMds.push(null); moveDmgs.push(null); return; }
            var md = getMoveDataFromRBDex(mn);
            moveMds.push(md);
            if (md && md.category !== 'Status') {
                try { moveDmgs.push(calcDamage(aiMon, playerMon, mn)); }
                catch (e) { moveDmgs.push(null); }
            } else { moveDmgs.push(null); }
        });

        // --- Highest damage ---
        var excl = { explosion:1,selfdestruct:1,finalgambit:1,relicsong:1,rollout:1,iceball:1,
                     meteorbeam:1,futuresight:1,whirlpool:1,firespin:1,sandtomb:1,
                     magmastorm:1,infestation:1,bind:1,wrap:1,clamp:1 };
        var hiDmg = 0;
        var hiIdx = [];
        aiMoves.forEach(function (mn, i) {
            var d = moveDmgs[i], md = moveMds[i];
            if (!d || !md || md.category === 'Status') return;
            if (excl[toMoveId(mn)]) return;
            if (d.max > hiDmg) { hiDmg = d.max; hiIdx = [i]; }
            else if (d.max === hiDmg && hiDmg > 0) hiIdx.push(i);
        });
        // All killing moves count as "highest"
        aiMoves.forEach(function (mn, i) {
            var d = moveDmgs[i], md = moveMds[i];
            if (!d || !md || md.category === 'Status') return;
            if (excl[toMoveId(mn)]) return;
            if (d.max >= playerHP && hiIdx.indexOf(i) === -1) hiIdx.push(i);
        });

        var pIncap = isPlayerIncapacitated(playerMon);
        var rawPStatus = (playerMon.status || '').toLowerCase();
        var pStatus = (rawPStatus && rawPStatus !== 'healthy') ? rawPStatus : '';
        var isFirstTurn = (aiMon.turnsOnField || 0) <= 0;
        var p1Haz = state.sides && state.sides.p1 ? state.sides.p1 : {};
        var p2Sides = state.sides && state.sides.p2 ? state.sides.p2 : {};

        // Team counts for explosion / memento / baton pass
        var aiTeam = state.p2 && state.p2.team ? state.p2.team : [];
        var aiAlive = aiTeam.filter(function (p) { return p && p.currentHP > 0; }).length;

        // --- Score each move ---
        aiMoves.forEach(function (mn, i) {
            if (!mn || mn === '(No Move)') {
                results.push({ moveName: mn, score: -100, reason: 'No move' });
                return;
            }
            var md = moveMds[i];
            if (!md) { results.push({ moveName: mn, score: 0, reason: 'Unknown' }); return; }

            var mid = toMoveId(mn);
            var dmg = moveDmgs[i];
            var isHi = hiIdx.indexOf(i) !== -1;
            var kills = dmg && dmg.max >= playerHP;
            var hasPrio = md.priority && md.priority > 0;
            var s = 0;
            var r = [];

            // =============================================================
            //  DAMAGING MOVES
            // =============================================================
            if (md.category !== 'Status') {

                // -- Rollout / Ice Ball --
                if (mid === 'rollout' || mid === 'iceball') {
                    results.push({ moveName: mn, score: 7, reason: 'Rollout always +7' }); return;
                }
                // -- Meteor Beam --
                if (mid === 'meteorbeam') {
                    results.push({ moveName: mn, score: aiItemId === 'powerherb' ? 9 : -20,
                        reason: aiItemId === 'powerherb' ? 'Meteor Beam+Power Herb +9' : 'No Power Herb' }); return;
                }
                // -- Fake Out --
                if (mid === 'fakeout') {
                    if (!isFirstTurn) { results.push({ moveName: mn, score: -20, reason: 'Fake Out not T1' }); return; }
                    if (defAbId === 'shielddust' || defAbId === 'innerfocus') {
                        results.push({ moveName: mn, score: -20, reason: 'Blocked by ' + (playerMon.ability||'ability') }); return;
                    }
                    results.push({ moveName: mn, score: 9, reason: 'Fake Out T1 +9' }); return;
                }
                // -- Explosion / Self-Destruct / Misty Explosion --
                if (mid === 'explosion' || mid === 'selfdestruct' || mid === 'mistyexplosion') {
                    var pTypes = playerMon.types || [];
                    var ghostImm = pTypes.some(function (t) { return t && t.toLowerCase() === 'ghost'; });
                    if (ghostImm && mid !== 'mistyexplosion') { results.push({ moveName: mn, score: -20, reason: 'Ghost immune' }); return; }
                    var pAlive = (state.p1 && state.p1.team ? state.p1.team : []).filter(function (p) { return p && p.currentHP > 0; }).length;
                    if (aiAlive <= 1 && pAlive > 1) { results.push({ moveName: mn, score: -20, reason: 'Last mon vs multiple' }); return; }
                    if (aiHPPct < 10) { s = 10; r.push('Boom <10% +10'); }
                    else if (aiHPPct < 33) { s = 8; r.push('Boom <33% +8'); }
                    else if (aiHPPct < 66) { s = 7; r.push('Boom <66% +7'); }
                    else { s = 0; r.push('Boom >66% likely +0'); }
                    if (aiAlive <= 1 && pAlive <= 1) { s -= 1; r.push('-1 last v last'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Final Gambit --
                if (mid === 'finalgambit') {
                    if (aiFaster && aiHP > playerHP) s = 8;
                    else if (aiFaster && pa.canKO) s = 7;
                    else s = 6;
                    results.push({ moveName: mn, score: s, reason: 'Final Gambit +' + s }); return;
                }
                // -- Relic Song --
                if (mid === 'relicsong') {
                    if ((aiMon.name || '').toLowerCase().indexOf('pirouette') !== -1) {
                        results.push({ moveName: mn, score: -20, reason: 'Pirouette never Relic Songs' }); return;
                    }
                    s = 10; r.push('Relic Song +10');
                    if (kills) { s += aiFaster ? 6 : 3; r.push(aiFaster ? '+6 fast kill' : '+3 slow kill'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Pursuit --
                if (mid === 'pursuit') {
                    var php = playerMaxHP > 0 ? (playerHP / playerMaxHP) * 100 : 100;
                    if (kills) { s = 10; r.push('Pursuit KO +10'); }
                    else if (php < 20) { s = 10; r.push('Pursuit <20% +10'); }
                    else if (php < 40) { s = 8; r.push('Pursuit <40% +8'); }
                    if (aiFaster) { s += 3; r.push('+3 faster'); }
                    if (kills) { s += aiFaster ? 6 : 3; r.push(aiFaster ? '+6 fast kill' : '+3 slow kill'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Fell Stinger --
                if (mid === 'fellstinger') {
                    var atkStg = (aiMon.boosts && aiMon.boosts.atk) || 0;
                    if (atkStg < 6 && kills) {
                        results.push({ moveName: mn, score: aiFaster ? 21 : 15,
                            reason: 'Fell Stinger KO ' + (aiFaster ? '+21' : '+15') }); return;
                    }
                }
                // -- Future Sight --
                if (mid === 'futuresight') {
                    s = (aiFaster && pa.canKO) ? 8 : 6;
                    r.push('Future Sight +' + s);
                    if (kills) { s += aiFaster ? 6 : 3; r.push(aiFaster ? '+6 fast kill' : '+3 slow kill'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Damaging trapping moves --
                var trap = { whirlpool:1,firespin:1,sandtomb:1,magmastorm:1,infestation:1,bind:1,wrap:1,clamp:1 };
                if (trap[mid]) {
                    s = 6; r.push('Trapping +6');
                    if (kills) { s += (aiFaster||hasPrio) ? 6 : 3; r.push((aiFaster||hasPrio)?'+6 fast kill':'+3 slow kill'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Damaging speed reduction --
                var spdDrop = { icywind:1,electroweb:1,rocktomb:1,mudshot:1,lowsweep:1 };
                if (spdDrop[mid] && !isHi) {
                    var blocked = defAbId==='contrary'||defAbId==='clearbody'||defAbId==='whitesmoke';
                    s = (!blocked && !aiFaster) ? 6 : 5;
                    r.push('Speed drop ' + (s===6?'(slower) +6':'+5'));
                    if (kills) { s += (aiFaster||hasPrio)?6:3; r.push((aiFaster||hasPrio)?'+6 fast kill':'+3 slow kill'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Guaranteed Atk/SpAtk reduction --
                var phyDrop = { tropkick:1,lunge:1 };
                var spaDrop = { skittersmack:1,strugglebug:1,mysticalfire:1,snarl:1 };
                if ((phyDrop[mid]||spaDrop[mid]) && !isHi) {
                    var blocked2 = defAbId==='contrary'||defAbId==='clearbody'||defAbId==='whitesmoke';
                    var corr = phyDrop[mid] ? pa.hasPhysical : pa.hasSpecial;
                    s = (!blocked2 && corr) ? 6 : 5;
                    r.push('Stat drop ' + (s===6?'(relevant) +6':'+5'));
                    if (kills) { s += (aiFaster||hasPrio)?6:3; r.push((aiFaster||hasPrio)?'+6 fast kill':'+3 slow kill'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // -- Contrary setup (Overheat, Leaf Storm, Superpower) --
                var contrarySetup = { overheat:1,leafstorm:1,superpower:1 };
                if (contrarySetup[mid] && aiAbId === 'contrary' && !isHi && !kills) {
                    s = 6; r.push('Contrary setup +6');
                    if (pIncap) { s += 3; r.push('+3 incap'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }

                // ---- Normal damaging move scoring ----
                if (isHi) { s = 6; r.push('Highest dmg +6'); }

                if (kills) {
                    if (aiFaster || (hasPrio && !aiFaster)) { s += 6; r.push('+6 fast kill'); }
                    else { s += 3; r.push('+3 slow kill'); }
                    var boostAb = { moxie:1,beastboost:1,chillingneigh:1,grimneigh:1 };
                    if (boostAb[aiAbId]) { s += 1; r.push('+1 ' + aiMon.ability); }
                }

                // Priority when AI dies to player and is slower
                if (pa.canKO && !aiFaster && hasPrio) { s += 11; r.push('+11 prio (dying+slow)'); }

                // Acid Spray always +6 additional
                if (mid === 'acidspray') { s += 6; r.push('+6 Acid Spray -2SpDef'); }

                if (!r.length) r.push('Damaging move');
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }

            // =============================================================
            //  STATUS MOVES
            // =============================================================

            // -- Stealth Rock --
            if (mid === 'stealthrock') {
                if (p1Haz.stealthRock) { results.push({ moveName: mn, score: -20, reason: 'SR already up' }); return; }
                s = isFirstTurn ? 9 : 7;
                results.push({ moveName: mn, score: s, reason: 'SR ' + (isFirstTurn?'T1 +9':'+7') }); return;
            }
            // -- Spikes / Toxic Spikes --
            if (mid === 'spikes' || mid === 'toxicspikes') {
                var layers = mid === 'spikes' ? (p1Haz.spikes||0) : (p1Haz.toxicSpikes||0);
                var maxL = mid === 'spikes' ? 3 : 2;
                if (layers >= maxL) { results.push({ moveName: mn, score: -20, reason: 'At max layers' }); return; }
                s = isFirstTurn ? 9 : 7;
                if (layers > 0) s -= 1;
                results.push({ moveName: mn, score: s, reason: mn + (isFirstTurn?' T1':'') + ' +' + s }); return;
            }
            // -- Sticky Web --
            if (mid === 'stickyweb') {
                if (p1Haz.stickyWeb) { results.push({ moveName: mn, score: -20, reason: 'Web already up' }); return; }
                s = isFirstTurn ? 12 : 9;
                results.push({ moveName: mn, score: s, reason: 'Sticky Web ' + (isFirstTurn?'T1 +12':'+9') }); return;
            }
            // -- Protect / Detect / King's Shield --
            if (mid==='protect'||mid==='detect'||mid==='kingsshield'||mid==='banefulbunker'||mid==='spikyshield') {
                s = 6; r.push('Protect +6');
                var badSt = ['psn','tox','brn','poison','burn','badly poisoned'];
                var aiSt = (aiMon.status||'').toLowerCase();
                if (badSt.indexOf(aiSt)!==-1) { s -= 2; r.push('-2 AI status'); }
                if (badSt.indexOf(pStatus)!==-1) { s += 1; r.push('+1 player status'); }
                if (isFirstTurn) { s -= 1; r.push('-1 T1'); }
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }
            // -- Recovery --
            var recov = { recover:1,slackoff:1,healorder:1,softboiled:1,roost:1,milkdrink:1,shoreup:1,strengthsap:1 };
            var sunRecov = { morningsun:1,synthesis:1,moonlight:1 };
            if (recov[mid] || sunRecov[mid] || mid === 'rest') {
                if (aiHPPct >= 100) { results.push({ moveName: mn, score: -20, reason: 'Full HP' }); return; }
                if (aiHPPct >= 85) { results.push({ moveName: mn, score: -6, reason: '>85% HP' }); return; }
                var hpct = 50;
                if (sunRecov[mid]) {
                    var wx = state.field ? (state.field.weather||'') : '';
                    hpct = (wx.toLowerCase().indexOf('sun')!==-1) ? 67 : 50;
                }
                if (mid === 'rest') hpct = 100;
                var shouldR = shouldAIRecover(aiMon, aiFaster, hpct, pa.maxDamage);
                if (mid === 'rest') {
                    if (shouldR) {
                        var cure = { lumberry:1,chestoberry:1 };
                        var cureAb = { shedskin:1,earlybird:1,hydration:1 };
                        var hasCure = !!cure[aiItemId] || !!cureAb[aiAbId];
                        var hasTalk = (aiMon.moves||[]).some(function(m){var x=toMoveId(m);return x==='sleeptalk'||x==='snore';});
                        s = (hasCure||hasTalk) ? 8 : 7;
                    } else { s = 5; }
                    r.push('Rest +' + s);
                } else {
                    s = shouldR ? 7 : 5;
                    r.push('Recovery +' + s);
                }
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }
            // -- Thunder Wave / Stun Spore / Glare / Nuzzle --
            var paraMoves = { thunderwave:1,stunspore:1,glare:1,nuzzle:1,zapcannon:1 };
            if (paraMoves[mid]) {
                if (pStatus) { results.push({ moveName: mn, score: -20, reason: 'Already statused' }); return; }
                var pt = playerMon.types || [];
                if (mid==='thunderwave') {
                    if (pt.some(function(t){return t&&t.toLowerCase()==='electric';})) { results.push({moveName:mn,score:-20,reason:'Electric immune'}); return; }
                    if (pt.some(function(t){return t&&t.toLowerCase()==='ground';})) { results.push({moveName:mn,score:-20,reason:'Ground immune'}); return; }
                }
                var pSpdAfterPara = playerSpeed / 4;
                var paraCond = false;
                if (!aiFaster && aiSpeed > pSpdAfterPara) paraCond = true;
                if (pa.hasFlinchMove) paraCond = true;
                var hasHex = (aiMon.moves||[]).some(function(m){return toMoveId(m)==='hex';});
                if (hasHex) paraCond = true;
                s = paraCond ? 8 : 7;
                results.push({ moveName: mn, score: s, reason: 'Para ' + (paraCond?'+8 (speed flip/hex)':'+7') }); return;
            }
            // -- Will-o-Wisp --
            if (mid === 'willowisp') {
                if (pStatus) { results.push({ moveName: mn, score: -20, reason: 'Already statused' }); return; }
                var pt2 = playerMon.types || [];
                if (pt2.some(function(t){return t&&t.toLowerCase()==='fire';})) { results.push({moveName:mn,score:-20,reason:'Fire immune'}); return; }
                s = 6; r.push('WoW +6');
                if (pa.hasPhysical) { s += 1; r.push('+1 phys'); }
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }
            // -- Sleep moves --
            var sleepMv = { yawn:1,darkvoid:1,spore:1,sleeppowder:1,grasswhistle:1,sing:1,hypnosis:1,lovelykiss:1 };
            if (sleepMv[mid]) {
                if (pStatus) { results.push({ moveName: mn, score: -20, reason: 'Already statused' }); return; }
                s = 6;
                results.push({ moveName: mn, score: s, reason: 'Sleep +6' }); return;
            }
            // -- Poison status moves --
            var poisonMv = { toxic:1,poisonpowder:1,poisongas:1 };
            if (poisonMv[mid]) {
                if (pStatus) { results.push({ moveName: mn, score: -20, reason: 'Already statused' }); return; }
                var pt3 = playerMon.types || [];
                if (pt3.some(function(t){return t&&(t.toLowerCase()==='poison'||t.toLowerCase()==='steel');})) {
                    results.push({ moveName: mn, score: -20, reason: 'Immune to poison' }); return;
                }
                s = 6;
                results.push({ moveName: mn, score: s, reason: 'Poison +6' }); return;
            }
            // -- Memento --
            if (mid === 'memento') {
                if (aiAlive <= 1) { results.push({ moveName: mn, score: -20, reason: 'Last mon' }); return; }
                if (aiHPPct < 10) s = 16;
                else if (aiHPPct < 33) s = 14;
                else if (aiHPPct < 66) s = 13;
                else s = 6;
                results.push({ moveName: mn, score: s, reason: 'Memento +' + s }); return;
            }
            // -- Tailwind --
            if (mid === 'tailwind') {
                s = !aiFaster ? 9 : 5;
                results.push({ moveName: mn, score: s, reason: 'Tailwind ' + (!aiFaster?'+9 slower':'+5') }); return;
            }
            // -- Trick Room --
            if (mid === 'trickroom') {
                if (isTR) { results.push({ moveName: mn, score: -20, reason: 'TR already up' }); return; }
                s = !aiFaster ? 10 : 5;
                results.push({ moveName: mn, score: s, reason: 'Trick Room +' + s }); return;
            }
            // -- Light Screen / Reflect --
            if (mid === 'lightscreen' || mid === 'reflect') {
                if (mid==='lightscreen' && p2Sides.lightScreen) { results.push({moveName:mn,score:-20,reason:'Already up'}); return; }
                if (mid==='reflect' && p2Sides.reflect) { results.push({moveName:mn,score:-20,reason:'Already up'}); return; }
                s = 6; r.push((mid==='reflect'?'Reflect':'Light Screen')+' +6');
                var corrMov = mid==='reflect' ? pa.hasPhysical : pa.hasSpecial;
                if (corrMov) { s += 1; r.push('+1 relevant'); if (aiItemId==='lightclay') { s += 1; r.push('+1 Light Clay'); } }
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }
            // -- Substitute --
            if (mid === 'substitute') {
                if (aiHPPct <= 50) { results.push({ moveName: mn, score: -20, reason: 'Too low HP' }); return; }
                if (defAbId === 'infiltrator') { results.push({ moveName: mn, score: -20, reason: 'Infiltrator' }); return; }
                s = 6; r.push('Sub +6');
                if (pStatus==='slp'||pStatus==='sleep') { s += 2; r.push('+2 asleep'); }
                if (pa.hasSoundMove) { s -= 8; r.push('-8 sound move'); }
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }
            // -- Taunt --
            if (mid === 'taunt') {
                var hasTR2 = (playerMon.moves||[]).some(function(m){return toMoveId(m)==='trickroom';});
                var hasDefog = (playerMon.moves||[]).some(function(m){return toMoveId(m)==='defog';});
                if (hasTR2 && !isTR) s = 9;
                else if (hasDefog && p2Sides.auroraVeil && aiFaster) s = 9;
                else s = 5;
                results.push({ moveName: mn, score: s, reason: 'Taunt +' + s }); return;
            }
            // -- Encore --
            if (mid === 'encore') {
                if (isFirstTurn) { results.push({ moveName: mn, score: -20, reason: 'No move to Encore T1' }); return; }
                s = aiFaster ? 7 : 6;
                results.push({ moveName: mn, score: s, reason: 'Encore +' + s }); return;
            }
            // -- Trick / Switcheroo --
            if (mid === 'trick' || mid === 'switcheroo') {
                var bad = { toxicorb:1,flameorb:1,blacksludge:1,ironball:1,laggingtail:1,stickybarb:1 };
                s = bad[aiItemId] ? 7 : 5;
                results.push({ moveName: mn, score: s, reason: 'Trick +' + s }); return;
            }
            // -- Destiny Bond --
            if (mid === 'destinybond') {
                s = (aiFaster && pa.canKO) ? 7 : 5;
                results.push({ moveName: mn, score: s, reason: 'Destiny Bond +' + s }); return;
            }
            // -- Baton Pass --
            if (mid === 'batonpass') {
                if (aiAlive <= 1) { results.push({ moveName: mn, score: -20, reason: 'Last mon' }); return; }
                var hasBoosts = false;
                if (aiMon.boosts) { Object.keys(aiMon.boosts).forEach(function(k){if(aiMon.boosts[k]>0)hasBoosts=true;}); }
                s = hasBoosts ? 14 : 0;
                results.push({ moveName: mn, score: s, reason: 'BP ' + (hasBoosts?'+14 boosts':'+0') }); return;
            }
            // -- Agility / Rock Polish / Autotomize --
            if (mid==='agility'||mid==='rockpolish'||mid==='autotomize') {
                if (aiFaster) { results.push({ moveName: mn, score: -20, reason: 'Already faster' }); return; }
                results.push({ moveName: mn, score: 7, reason: mn + ' (slower) +7' }); return;
            }
            // -- Focus Energy / Laser Focus --
            if (mid==='focusenergy'||mid==='laserfocus') {
                if (defAbId==='shellarmor'||defAbId==='battlearmor') { results.push({moveName:mn,score:-20,reason:'Shell/Battle Armor'}); return; }
                var hasHiCrit = (aiMon.moves||[]).some(function(m){var x=getMoveDataFromRBDex(m);return x&&x.critRatio&&x.critRatio>1;});
                var critAb = aiAbId==='superluck'||aiAbId==='sniper';
                var critItem = aiItemId==='scopelens'||aiItemId==='razorclaw';
                s = (hasHiCrit||critAb||critItem) ? 7 : 6;
                results.push({ moveName: mn, score: s, reason: 'Focus Energy +' + s }); return;
            }
            // -- Imprison --
            if (mid === 'imprison') {
                var hasCommon = (playerMon.moves||[]).some(function(pm){return (aiMon.moves||[]).some(function(am){return toMoveId(pm)===toMoveId(am);});});
                results.push({ moveName: mn, score: hasCommon ? 9 : -20, reason: 'Imprison ' + (hasCommon?'+9':'-20 no shared') }); return;
            }
            // -- Terrain --
            var terrain = { electricterrain:1,psychicterrain:1,grassyterrain:1,mistyterrain:1 };
            if (terrain[mid]) {
                s = aiItemId === 'terrainextender' ? 9 : 8;
                results.push({ moveName: mn, score: s, reason: 'Terrain +' + s }); return;
            }
            // -- Helping Hand / Follow Me --
            if (mid==='helpinghand'||mid==='followme') {
                results.push({ moveName: mn, score: 6, reason: mn + ' +6' }); return;
            }
            // -- Counter / Mirror Coat --
            if (mid==='counter'||mid==='mirrorcoat') {
                if (pa.canKO && !hasProtection) { results.push({ moveName: mn, score: -20, reason: 'Player KOs' }); return; }
                s = 6; r.push((mid==='counter'?'Counter':'Mirror Coat')+' +6');
                var only = mid==='counter' ? (pa.hasPhysical&&!pa.hasSpecial) : (pa.hasSpecial&&!pa.hasPhysical);
                if (only) { s += 2; r.push('+2 only matching split'); }
                results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
            }

            // ===== SETUP MOVES =====
            var offSetup = { swordsdance:1,howl:1,meditate:1,sharpen:1,honeclaws:1,poweruppunch:1 };
            var defSetup = { acidarmor:1,barrier:1,cottonguard:1,harden:1,irondefense:1,stockpile:1,cosmicpower:1 };
            var mixSetup = { bulkup:1,calmmind:1,quiverdance:1,coil:1,noretreat:1 };
            var spaSetup = { tailglow:1,nastyplot:1,workup:1,growth:1,chargebeam:1 };
            var isSetup = offSetup[mid]||defSetup[mid]||mixSetup[mid]||spaSetup[mid]||
                mid==='shellsmash'||mid==='bellydrum'||mid==='dragondance'||mid==='shiftgear';

            if (isSetup) {
                // Unaware check (PuP/SD/Howl exempt)
                var unawareExempt = { poweruppunch:1,swordsdance:1,howl:1 };
                if (defAbId==='unaware' && !unawareExempt[mid]) { results.push({moveName:mn,score:-20,reason:'Unaware'}); return; }
                // Player can KO check
                if (pa.canKO && !hasProtection) { results.push({moveName:mn,score:-20,reason:'Player KOs, won\'t setup'}); return; }

                // Shell Smash
                if (mid === 'shellsmash') {
                    var ab = (aiMon.boosts&&aiMon.boosts.atk)||0;
                    var as2 = (aiMon.boosts&&aiMon.boosts.spa)||0;
                    if (ab >= 1 || as2 >= 6 || ab >= 6) { results.push({moveName:mn,score:-20,reason:'Already boosted'}); return; }
                    s = 6; r.push('Shell Smash +6');
                    if (pIncap) { s += 3; r.push('+3 incap'); }
                    if (!pa.canKO) { s += 2; r.push('+2 survives'); }
                    else if (hasProtection) { s += 2; r.push('+2 Sturdy/Sash'); }
                    else { s -= 2; r.push('-2 might die'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // Belly Drum
                if (mid === 'bellydrum') {
                    if (pIncap) s = 9;
                    else if (!pa.canKO) s = 8;
                    else s = 4;
                    results.push({ moveName: mn, score: s, reason: 'Belly Drum +' + s }); return;
                }
                // Dragon Dance / Shift Gear (offensive)
                if (mid==='dragondance'||mid==='shiftgear') {
                    s = 6; r.push(mn + ' +6');
                    if (pIncap) { s += 3; r.push('+3 incap'); }
                    if (!aiFaster && pa.can2HKO) { s -= 5; r.push('-5 slower+2HKO'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // Mixed setup (Bulk Up, Calm Mind, Quiver Dance, Coil, No Retreat)
                if (mixSetup[mid]) {
                    var physMix = { bulkup:1,coil:1,noretreat:1 };
                    var isDef = physMix[mid] ? (pa.hasPhysical&&!pa.hasSpecial) : (pa.hasSpecial&&!pa.hasPhysical);
                    s = 6; r.push(mn + ' +6');
                    if (isDef) {
                        if (!aiFaster && pa.can2HKO) { s -= 5; r.push('-5 slower+2HKO'); }
                        if (pIncap) { s += 2; r.push('+2 incap'); }
                        var dS = (aiMon.boosts&&aiMon.boosts.def)||0;
                        var sS = (aiMon.boosts&&aiMon.boosts.spd)||0;
                        if (dS < 2 || sS < 2) { s += 2; r.push('+2 def/spd<+2'); }
                    } else {
                        if (pIncap) { s += 3; r.push('+3 incap'); }
                        if (!aiFaster && pa.can2HKO) { s -= 5; r.push('-5 slower+2HKO'); }
                    }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // Nasty Plot / Tail Glow / Work Up / Growth / Charge Beam
                if (spaSetup[mid]) {
                    s = 6; r.push(mn + ' +6');
                    if (pIncap) { s += 3; r.push('+3 incap'); }
                    else if (!pa.can3HKO) {
                        s += 1; r.push('+1 can\'t 3HKO');
                        if (aiFaster) { s += 1; r.push('+1 faster'); }
                    }
                    if (!aiFaster && pa.can2HKO) { s -= 5; r.push('-5 slower+2HKO'); }
                    var spS = (aiMon.boosts&&aiMon.boosts.spa)||0;
                    if (spS >= 2) { s -= 1; r.push('-1 already +2 SpA'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // Pure offensive setup (SD, Howl, etc.)
                if (offSetup[mid]) {
                    s = 6; r.push(mn + ' +6');
                    if (pIncap) { s += 3; r.push('+3 incap'); }
                    if (!aiFaster && pa.can2HKO) { s -= 5; r.push('-5 slower+2HKO'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
                // Defensive setup
                if (defSetup[mid]) {
                    s = 6; r.push(mn + ' +6');
                    if (!aiFaster && pa.can2HKO) { s -= 5; r.push('-5 slower+2HKO'); }
                    if (pIncap) { s += 2; r.push('+2 incap'); }
                    results.push({ moveName: mn, score: s, reason: r.join(', ') }); return;
                }
            }

            // -- Default status move --
            results.push({ moveName: mn, score: 6, reason: 'Status default +6' });
        });

        return results;
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
        scoreAIMoves: scoreAIMoves,
        PRIORITY_MOVES: PRIORITY_MOVES
    };

})(typeof window !== 'undefined' ? window : global);
