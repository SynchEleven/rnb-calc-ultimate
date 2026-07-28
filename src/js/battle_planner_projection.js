/**
 * Forward Projection
 * ==================
 *
 * "If I keep playing from here, how does this end?"
 *
 * The branch tree only knows about turns the user has actually planned. This
 * rolls the *unplanned* future forward from any node and reports where the
 * probability mass lands, using the same exact arithmetic as the tree itself —
 * no sampling, no hand-waved constants.
 *
 * HOW IT WORKS
 * ------------
 * 1. Start from the node's real state distribution (every reachable state with
 *    its exact probability).
 * 2. For each simulated turn:
 *      - the opponent's move comes from `ai.ts` — the same RnB AI engine that
 *        drives the move panel, so the projection predicts what the AI will
 *        actually click, not what would be strongest;
 *      - the player's move comes from a policy (by default: whatever the plan
 *        already says, otherwise the move that kills soonest);
 *      - the turn resolves through the ordinary turn executor, so accuracy,
 *        crits, damage rolls, secondaries, items, statuses, speed ties and
 *        end-of-turn residuals are all applied exactly as they are in the tree.
 * 3. Fainted Pokemon are replaced by the next healthy team member.
 * 4. States that are decided (one side wiped) drop out into the terminal pile.
 * 5. Surviving states merge; the beam keeps the heaviest and reports whatever
 *    mass it had to drop, so a number is never quietly wrong.
 *
 * TWO AXES, NOT ONE
 * -----------------
 * In a run, winning is the goal but losing a Pokemon is the thing you actually
 * pay for, and those come apart constantly: a line can win 90% of the time and
 * still cost you a team member in half of those. So the result reports both —
 * win/loss probability AND the distribution over how many Pokemon you lose —
 * and never collapses them into a single score.
 *
 * Exposed on `window.BattlePlannerProjection`.
 */
(function (window) {
    'use strict';

    var B = null;
    function branching() {
        if (!B) B = window.BattlePlannerBranching;
        return B;
    }

    function roundProb(p) {
        return Math.round(p * 1e12) / 1e12;
    }

    // =======================================================================
    // Damage memo
    // =======================================================================
    //
    // Every policy question ("does this kill?", "what's the worst they do to
    // me?", "who survives a switch-in?") bottoms out in calc.calculate, and
    // the projection asks the same question about the same position thousands
    // of times per run. The memo answers repeats from a table. Keys carry the
    // exact HP, boosts, EVs and typing of both sides, so HP-scaling moves
    // (Eruption, Flail, Brine...) and Soak'd typings can never be served a
    // stale answer.

    function fieldOf(deps, state) {
        return deps.getField ? deps.getField(state) : new deps.calc.Field();
    }

    function fieldKeyOf(state) {
        var f = state && state.field;
        if (!f) return '';
        return (f.weather || '') + '~' + (f.terrain || '') + '~' + (f.trickRoom ? 1 : 0);
    }

    function statBlockKey(block) {
        if (!block) return '';
        return [block.hp, block.atk, block.def, block.spa, block.spd, block.spe].join(',');
    }

    function dmgMonKey(m) {
        if (!m) return 'x';
        return [
            m.name, m.level, m.currentHP, m.status, m.toxicCounter || 0,
            m.item || '', m.ability || '', (m.types || []).join('/'),
            m.nature || '', statBlockKey(m.evs), statBlockKey(m.ivs),
            m.boosts ? [m.boosts.atk, m.boosts.def, m.boosts.spa, m.boosts.spd,
                m.boosts.spe, m.boosts.accuracy, m.boosts.evasion].join('.') : ''
        ].join(':');
    }

    var EMPTY_DAMAGE = {rolls: [], range: {min: 0, max: 0, avg: 0}};

    /** Rebuilding a calc Pokemon from a snapshot is itself worth memoising. */
    function pokemonFor(deps, cache, snap, genNum) {
        var key = dmgMonKey(snap) + '@' + genNum;
        if (key in cache.pk) return cache.pk[key];
        var built = deps.CalcIntegration.snapshotToPokemon(snap, genNum);
        if (cache.pkN > 1500) { cache.pk = {}; cache.pkN = 0; }
        cache.pk[key] = built;
        cache.pkN++;
        return built;
    }

    /** Memoised damage rolls for one attack in one position. */
    function damageFor(deps, state, attackerSnap, defenderSnap, moveName, attackerIsAI) {
        var cache = deps.__dmgCache || (deps.__dmgCache = {map: {}, pk: {}, n: 0, pkN: 0});
        var key = dmgMonKey(attackerSnap) + '>' + dmgMonKey(defenderSnap) + '#' +
            moveName + '#' + (attackerIsAI ? 1 : 0) + '#' + fieldKeyOf(state);
        var hit = cache.map[key];
        if (hit) return hit;

        var out;
        try {
            var CI = deps.CalcIntegration;
            var calc = deps.calc;
            var genNum = deps.gen || 8;
            var attacker = pokemonFor(deps, cache, attackerSnap, genNum);
            var defender = pokemonFor(deps, cache, defenderSnap, genNum);
            if (!attacker || !defender) {
                out = EMPTY_DAMAGE;
            } else {
                var field = fieldOf(deps, state);
                if (attackerIsAI && field.clone) field = field.clone().swap();
                var result = calc.calculate(genNum, attacker, defender,
                    new calc.Move(genNum, moveName), field);
                out = {rolls: CI.getDamageRolls(result), range: CI.getDamageRange(result)};
            }
        } catch (e) {
            out = EMPTY_DAMAGE;
        }
        if (cache.n > 4000) { cache.map = {}; cache.n = 0; }
        cache.map[key] = out;
        cache.n++;
        return out;
    }

    // =======================================================================
    // Policies
    // =======================================================================

    var PROTECT_LIKE = ['Protect', 'Detect', 'Defend Order'];

    /**
     * The AI does not click Protect twice in a row — and the executor makes a
     * consecutive Protect fail regardless. Without this filter the traced
     * "likeliest line" could sit in an impossible eternal Protect loop, with
     * ~27% Protect beating every individual damage-roll branch turn after
     * turn.
     */
    function stripConsecutiveProtect(state, action, deps) {
        var ai = state.p2.active;
        if (!action || action.type !== 'move' || !ai ||
                !ai.hasVolatile || !ai.hasVolatile('protectused')) {
            return action;
        }
        function isProtect(name) { return PROTECT_LIKE.indexOf(name) !== -1; }

        if (action.candidates && action.candidates.length) {
            var rest = action.candidates.filter(function (c) {
                return !isProtect(c.moveName);
            });
            if (rest.length) {
                var total = rest.reduce(function (a, c) { return a + c.probability; }, 0);
                rest.forEach(function (c) { c.probability = c.probability / total; });
                return rest.length === 1
                    ? {type: 'move', moveName: rest[0].moveName}
                    : {type: 'move', moveName: rest[0].moveName, candidates: rest};
            }
        }
        if (!isProtect(action.moveName)) return action;

        // The pick itself was Protect: fall back to the hardest other hit
        var moves = (ai.moves || []).filter(Boolean).filter(function (n) {
            return !isProtect(n);
        });
        if (!moves.length) return action;   // Protect is literally all it has
        var best = moves[0];
        var bestAvg = -1;
        moves.forEach(function (name) {
            var avg = damageFor(deps, state, ai, state.p1.active, name, true).range.avg;
            if (avg > bestAvg) { bestAvg = avg; best = name; }
        });
        return {type: 'move', moveName: best};
    }

    /**
     * What the opponent does, from the real AI engine.
     *
     * Returns `candidates` in the shape the turn executor understands, so a
     * genuine AI tie forks the projection exactly as it forks the tree.
     * Falls back to "the move that does the most damage" only when the AI
     * engine is unavailable.
     */
    function createAIPolicy(deps) {
        var calc = deps.calc;
        var genNum = deps.gen || 8;
        var cache = {};

        return function chooseAI(state) {
            var ai = state.p2.active;
            var player = state.p1.active;
            if (!ai || !player || ai.currentHP <= 0) return null;

            var moves = (ai.moves || []).filter(Boolean);
            if (!moves.length) return null;
            if (moves.length === 1) return {type: 'move', moveName: moves[0]};

            var key = aiCacheKey(state);
            if (cache[key]) return cloneAction(cache[key]);

            var action = null;
            try {
                action = aiFromEngine(state, deps, genNum, calc);
            } catch (e) {
                action = null;
            }
            if (!action) action = greedyDamage(state, 'p2', deps, genNum);
            action = stripConsecutiveProtect(state, action, deps);

            cache[key] = action;
            return cloneAction(action);
        };
    }

    function cloneAction(a) {
        if (!a) return null;
        var copy = Object.assign({}, a);
        if (a.candidates) copy.candidates = a.candidates.map(function (c) { return Object.assign({}, c); });
        return copy;
    }

    /** HP buckets keep the cache useful without changing which move is picked. */
    function aiCacheKey(state) {
        function part(mon) {
            if (!mon) return 'x';
            return [
                mon.name,
                Math.round((mon.currentHP / Math.max(1, mon.maxHP)) * 20),
                mon.status,
                (mon.boosts && [mon.boosts.atk, mon.boosts.def, mon.boosts.spa,
                    mon.boosts.spd, mon.boosts.spe].join('.')) || '',
                mon.item || '',
                (mon.hasVolatile && mon.hasVolatile('protectused')) ? 'P' : ''
            ].join(':');
        }
        return part(state.p2.active) + '|' + part(state.p1.active) +
            '|' + (state.field ? state.field.weather + state.field.terrain : '');
    }

    /**
     * Run the AI engine for this position and turn its distribution into
     * weighted move candidates.
     */
    function aiFromEngine(state, deps, genNum, calc) {
        if (!deps.generateMoveDist || !deps.CalcIntegration) return null;

        var CI = deps.CalcIntegration;
        var attacker = CI.snapshotToPokemon(state.p2.active, genNum);
        var defender = CI.snapshotToPokemon(state.p1.active, genNum);
        if (!attacker || !defender) return null;

        var field = deps.getField ? deps.getField(state) : new calc.Field();
        var swapped = field.clone ? field.clone().swap() : field;

        var aiMoveNames = (state.p2.active.moves || []).filter(Boolean);
        var playerMoveNames = (state.p1.active.moves || []).filter(Boolean);

        var aiMoves = aiMoveNames.map(function (n) {
            return new calc.Move(genNum, n, {
                ability: attacker.ability, item: attacker.item, species: attacker.name
            });
        });
        var playerMoves = playerMoveNames.map(function (n) {
            return new calc.Move(genNum, n, {
                ability: defender.ability, item: defender.item, species: defender.name
            });
        });
        if (!aiMoves.length) return null;

        // ai.ts reads the player's ability off defender.moves[0].ability
        attacker.moves = aiMoves;
        defender.moves = playerMoves.length ? playerMoves : aiMoves;

        var playerResults = (playerMoves.length ? playerMoves : aiMoves).map(function (m) {
            return calc.calculate(genNum, defender, attacker, m, field);
        });
        var aiResults = aiMoves.map(function (m) {
            return calc.calculate(genNum, attacker, defender, m, swapped);
        });

        var p1Speed = state.p1.active.getEffectiveSpeed(state.sides && state.sides.p1);
        var p2Speed = state.p2.active.getEffectiveSpeed(state.sides && state.sides.p2);
        var fastestSide = p2Speed >= p1Speed ? '1' : '0';

        var dist = deps.generateMoveDist([playerResults, aiResults], fastestSide,
            deps.aiOptions || {});
        if (!dist || !dist.length) return null;

        var candidates = [];
        for (var i = 0; i < dist.length && i < aiMoveNames.length; i++) {
            if (dist[i] > 1e-6) {
                candidates.push({moveName: aiMoveNames[i], probability: dist[i]});
            }
        }
        if (!candidates.length) return null;

        var total = candidates.reduce(function (a, c) { return a + c.probability; }, 0);
        candidates.forEach(function (c) { c.probability = c.probability / total; });

        if (candidates.length === 1) {
            return {type: 'move', moveName: candidates[0].moveName};
        }
        return {type: 'move', moveName: candidates[0].moveName, candidates: candidates};
    }

    /** Fallback / default player policy: whatever kills the target soonest. */
    function greedyDamage(state, side, deps, genNum) {
        var CI = deps.CalcIntegration;
        var me = state[side].active;
        var foeSide = side === 'p1' ? 'p2' : 'p1';
        var foe = state[foeSide].active;
        if (!me || !foe) return null;

        var moves = (me.moves || []).filter(Boolean);
        if (!moves.length) return null;

        var best = null;
        var bestScore = -Infinity;
        var field = fieldOf(deps, state);

        moves.forEach(function (name) {
            var score;
            try {
                var range = damageFor(deps, state, me, foe, name, false).range;
                var accuracy = CI.getAccuracy(
                    deps.MoveDB ? deps.MoveDB.get(name) : {name: name}, me, foe, field, genNum);
                score = range.avg * (accuracy / 100);
                // Prefer a guaranteed kill over a bigger average
                if (range.min >= foe.currentHP) score += 10000;
            } catch (e) {
                score = 0;
            }
            if (score > bestScore) { bestScore = score; best = name; }
        });

        return {type: 'move', moveName: best || moves[0]};
    }

    /**
     * The player policy.
     *
     * A pure "hit it hardest" policy systematically under-rates the position,
     * because the strongest lines in a run are often not attacks at all:
     *
     *   - PIVOTING OUT of a losing matchup preserves a team member, and losing
     *     a team member is the currency that actually matters;
     *   - BAITING is real: you send something in specifically to eat a move,
     *     then switch to what walls it;
     *   - a STATUS turn (Toxic, Will-O-Wisp, a Speed drop) frequently beats a
     *     chunk of damage measured across the next three turns.
     *
     * So every legal action is scored on one scale and the best is taken. This
     * is a one-ply lookahead, not a search: the point is that the projection no
     * longer assumes you would spam your biggest move where a human obviously
     * would not.
     */
    function createPlayerPolicy(deps, policyOptions) {
        var genNum = deps.gen || 8;
        // How much of the toolbox this policy may reach for:
        //   0 — attacks + the EMERGENCY pivot ("about to die, can't trade —
        //       switch"): that is the simplest plan a human would actually
        //       play, so it belongs in the cheapest tier;
        //   1 — plus status moves;
        //   2 — plus PROACTIVE repositioning: switching out of a bad matchup
        //       before it turns lethal (baiting, positioning) — the default.
        // The tiers exist so the smart projection can try the SIMPLE plan
        // first and only pay for cleverness when simple is not good enough.
        var complexity = policyOptions && policyOptions.complexity !== undefined
            ? policyOptions.complexity : 2;

        return function choosePlayer(state, plannedAction) {
            if (plannedAction) return plannedAction;
            var me = state.p1.active;
            if (!me || me.currentHP <= 0) return null;

            var attack = greedyDamage(state, 'p1', deps, genNum);

            var options = [];

            if (attack) {
                options.push({
                    action: attack,
                    score: scoreMove(state, attack.moveName, deps, genNum)
                });
            }

            if (complexity >= 1) {
                (me.moves || []).filter(Boolean).forEach(function (name) {
                    if (attack && name === attack.moveName) return;
                    var score = scoreMove(state, name, deps, genNum);
                    if (score > 0) {
                        options.push({action: {type: 'move', moveName: name}, score: score});
                    }
                });
            }

            // Pivoting: worth it when this Pokemon is about to die and cannot
            // trade for the kill. The switch costs tempo but saves the team
            // member, which is the expensive resource in a run.
            var threat = incomingThreat(state, deps, genNum);
            var canKill = attack ? killChance(state, attack.moveName, deps, genNum) : 0;
            var emergency = threat.koChance > 0.5 && canKill < 0.5;

            if (emergency) {
                // Losing a team member, on the same scale as "100 = a full HP
                // bar of damage". It outweighs any single non-killing turn,
                // which is exactly how a run player values it.
                var LOSS_WEIGHT = 120;

                var mySpeed = me.getEffectiveSpeed
                    ? me.getEffectiveSpeed(state.sides && state.sides.p1) : 0;
                var foe = state.p2.active;
                var foeSpeed = foe && foe.getEffectiveSpeed
                    ? foe.getEffectiveSpeed(state.sides && state.sides.p2) : 0;
                var trickRoom = !!(state.field && state.field.trickRoom);
                var meFaster = trickRoom ? mySpeed < foeSpeed : mySpeed > foeSpeed;

                // Staying in is not free: whatever the move is worth, you also
                // pay for the KO you are about to eat — and if you are slower,
                // the move likely never even happens. Without this discount the
                // policy preferred clicking Growl with 1 HP over saving the
                // Pokemon, because 25 points beat a 5-point switch.
                options.forEach(function (o) {
                    if (o.action.type !== 'move') return;
                    var landed = meFaster ? o.score : o.score * (1 - threat.koChance);
                    o.score = landed - threat.koChance * LOSS_WEIGHT;
                });

                // How well would STAYING hold up? A pivot is only worth
                // offering when the replacement is meaningfully sturdier —
                // otherwise the policy ping-pongs between two doomed Pokemon,
                // burning the horizon on switches and resolving nothing.
                var mySurvival = Math.max(0,
                    1 - (threat.maxDamage / Math.max(1, me.currentHP)));

                (state.p1.team || []).forEach(function (candidate, index) {
                    if (!candidate || candidate.currentHP <= 0) return;
                    if (index === state.p1.teamSlot) return;

                    var survives = switchSurvivalScore(state, candidate, deps, genNum);
                    // Not an escape if the replacement barely improves on
                    // standing still...
                    if (survives <= mySurvival + 0.15) return;
                    // ...and when staying is merely RISKY (not certain death),
                    // demand a genuinely sturdy replacement. When staying is
                    // certain death, anything that survives the hit is a win.
                    if (mySurvival > 0.05 && survives < 0.35) return;

                    // The saved team member, minus the tempo the switch costs
                    options.push({
                        action: {type: 'switch', switchToIndex: index, targetSlot: index},
                        score: threat.koChance * LOSS_WEIGHT * survives - 25
                    });
                });
            } else if (complexity >= 2 && canKill < 0.05) {
                // Proactive repositioning: not in immediate danger, but stuck
                // in a matchup where this Pokemon achieves little. Offer a
                // switch to a team member that both takes the incoming hits
                // comfortably AND hits meaningfully harder — the "send in the
                // answer before things get lethal" play.
                var myShare = attack && state.p2.active
                    ? Math.min(1, damageFor(deps, state, me, state.p2.active,
                        attack.moveName, false).range.avg /
                        Math.max(1, state.p2.active.currentHP))
                    : 0;
                var myHold = Math.max(0,
                    1 - (threat.maxDamage / Math.max(1, me.currentHP)));

                (state.p1.team || []).forEach(function (candidate, index) {
                    if (!candidate || candidate.currentHP <= 0) return;
                    if (index === state.p1.teamSlot) return;

                    var survives = switchSurvivalScore(state, candidate, deps, genNum);
                    // Only a genuinely comfortable answer is worth the tempo —
                    // and the asymmetric 1.5x damage bar means two Pokemon can
                    // never both look like upgrades over each other, so the
                    // policy cannot ping-pong.
                    if (survives < 0.6 || survives < myHold) return;

                    var candBest = 0;
                    (candidate.moves || []).filter(Boolean).forEach(function (name) {
                        var avg = damageFor(deps, state, candidate,
                            state.p2.active, name, false).range.avg;
                        if (avg > candBest) candBest = avg;
                    });
                    var candShare = state.p2.active
                        ? Math.min(1, candBest / Math.max(1, state.p2.active.currentHP))
                        : 0;
                    if (candShare <= myShare * 1.5) return;

                    options.push({
                        action: {type: 'switch', switchToIndex: index, targetSlot: index},
                        score: candShare * 70 - 20
                    });
                });
            }

            if (!options.length) return attack;
            options.sort(function (a, b) { return b.score - a.score; });
            return options[0].action;
        };
    }

    /** Expected damage as a share of the target's remaining HP, x100. */
    function scoreMove(state, moveName, deps, genNum) {
        var CI = deps.CalcIntegration;
        var calc = deps.calc;
        var me = state.p1.active;
        var foe = state.p2.active;
        if (!me || !foe) return 0;

        var entry = deps.MoveDB ? deps.MoveDB.get(moveName) : null;
        var field = deps.getField ? deps.getField(state) : new calc.Field();
        var accuracy = CI.getAccuracy(entry || {name: moveName}, me, foe, field, genNum) / 100;

        if (entry && entry.category === 'Status') {
            // Worth roughly what it denies over the next few turns. Scored
            // modestly so it can never outrank an available kill.
            var fx = entry.effects || {};
            var worth = 0;
            if (fx.status && foe.canBeStatused && foe.canBeStatused(fx.status, {
                attackerAbility: me.ability,
                field: state.field,
                sideState: state.sides ? state.sides.p2 : null
            })) {
                worth = (fx.status === 'tox' || fx.status === 'brn') ? 45 : 35;
            }
            if (fx.selfBoosts) worth = Math.max(worth, 30);
            if (fx.targetBoosts) worth = Math.max(worth, 25);
            if (fx.heal) {
                var missing = 1 - (me.currentHP / Math.max(1, me.maxHP));
                worth = Math.max(worth, missing * 80);
            }
            return worth * accuracy;
        }

        try {
            var range = damageFor(deps, state, me, foe, moveName, false).range;
            var share = Math.min(1, range.avg / Math.max(1, foe.currentHP));
            return share * 100 * accuracy + (range.min >= foe.currentHP ? 500 : 0);
        } catch (e) {
            return 0;
        }
    }

    /** P(this move kills right now). */
    function killChance(state, moveName, deps, genNum) {
        var foe = state.p2.active;
        if (!foe) return 0;
        return damageFor(deps, state, state.p1.active, foe, moveName, false)
            .rolls.filter(function (r) { return r.damage >= foe.currentHP; })
            .reduce(function (a, r) { return a + r.probability; }, 0);
    }

    /** The worst the opponent can do to the current active Pokemon. */
    function incomingThreat(state, deps, genNum) {
        var me = state.p1.active;
        var foe = state.p2.active;
        var out = {koChance: 0, maxDamage: 0};
        if (!me || !foe) return out;

        (foe.moves || []).filter(Boolean).forEach(function (name) {
            var dmg = damageFor(deps, state, foe, me, name, true);
            var ko = dmg.rolls.filter(function (r) { return r.damage >= me.currentHP; })
                .reduce(function (a, r) { return a + r.probability; }, 0);
            if (ko > out.koChance) out.koChance = ko;
            if (dmg.range.max > out.maxDamage) out.maxDamage = dmg.range.max;
        });
        return out;
    }

    /**
     * How well a candidate would hold up if switched in: 1 means it takes the
     * opponent's best hit comfortably, 0 means it dies to it.
     */
    function switchSurvivalScore(state, candidate, deps, genNum) {
        var foe = state.p2.active;
        if (!foe) return 0;

        var worst = 0;
        (foe.moves || []).filter(Boolean).forEach(function (name) {
            var max = damageFor(deps, state, foe, candidate, name, true).range.max;
            if (max > worst) worst = max;
        });

        if (worst <= 0) return 1;
        return Math.max(0, 1 - (worst / Math.max(1, candidate.currentHP)));
    }

    // =======================================================================
    // Replacements
    // =======================================================================

    /** Send in the next healthy team member after a faint. */
    function replaceFainted(state, side) {
        var sideState = state[side];
        var active = sideState.active;
        if (!active || active.currentHP > 0) return false;

        var team = sideState.team || [];
        for (var i = 0; i < team.length; i++) {
            if (team[i] && team[i].currentHP > 0 && i !== sideState.teamSlot) {
                sideState.teamSlot = i;
                sideState.active = team[i].clone();
                return true;
            }
        }
        return false;
    }

    function sideIsWiped(state, side) {
        var sideState = state[side];
        var team = sideState.team || [];
        if (!team.length) {
            return !sideState.active || sideState.active.currentHP <= 0;
        }
        return team.every(function (p) { return !p || p.currentHP <= 0; });
    }

    /** How many of a side's Pokemon are down. */
    function faintedCount(state, side) {
        var team = state[side].team || [];
        if (!team.length) {
            return state[side].active && state[side].active.currentHP <= 0 ? 1 : 0;
        }
        return team.filter(function (p) { return p && p.currentHP <= 0; }).length;
    }

    /** Team state must mirror the active Pokemon or faint counting lies. */
    function syncActive(state) {
        ['p1', 'p2'].forEach(function (side) {
            var s = state[side];
            if (s.active && s.team && s.team[s.teamSlot]) {
                s.team[s.teamSlot] = s.active.clone();
            }
        });
    }

    /**
     * The kept state whose HP totals are closest, so a coalesced line lands
     * somewhere that plays out similarly rather than being thrown away.
     */
    function nearestByHP(kept, state) {
        if (!kept.length) return null;
        function hp(s) {
            return [
                s.p1.active ? s.p1.active.currentHP : 0,
                s.p2.active ? s.p2.active.currentHP : 0
            ];
        }
        var target = hp(state);
        var best = null;
        var bestScore = Infinity;
        kept.forEach(function (candidate) {
            var c = hp(candidate.state);
            var score = Math.abs(c[0] - target[0]) + Math.abs(c[1] - target[1]);
            if (score < bestScore) { bestScore = score; best = candidate; }
        });
        return best;
    }

    // =======================================================================
    // Projection
    // =======================================================================

    /**
     * Roll the position forward and report where it lands.
     *
     * options:
     *   horizon    how many turns to simulate (default 8)
     *   beamWidth  how many distinct states to carry (default 24)
     *   plannedP1  action to use on the first simulated turn, if any
     */
    function createProjection(deps) {
        var chooseAI = deps.aiPolicy || createAIPolicy(deps);
        var choosePlayer = deps.playerPolicy || createPlayerPolicy(deps);
        var executeTurn = deps.executeTurn;

        /** Best single-move max damage attacker can do to defender. */
        function calcBestDamage(attackerSnap, defenderSnap) {
            var best = 0;
            (attackerSnap.moves || []).filter(Boolean).forEach(function (name) {
                var max = damageFor(deps, null, attackerSnap, defenderSnap, name, false).range.max;
                if (max > best) best = max;
            });
            return best;
        }

        /**
         * Replace a fainted Pokemon the way the battle actually would.
         *
         * The opponent uses the game's own post-KO switch AI
         * (Logic.predictAISwitchIn — the RnB switch logic is deterministic);
         * the player picks the best matchup by survival and damage output.
         * The old behaviour was "next healthy slot", which routinely sent in
         * exactly the wrong Pokemon and skipped entry hazards entirely.
         */
        function replaceSmart(state, side) {
            var sideState = state[side];
            if (!sideState.active || sideState.active.currentHP > 0) return false;

            var faintedName = sideState.active.name;
            var faintedSlot = sideState.teamSlot;
            var team = sideState.team || [];
            var slot = null;

            if (side === 'p2' && deps.Logic && deps.Logic.predictAISwitchIn) {
                var predicted = deps.Logic.predictAISwitchIn(
                    state.p1.active, team, faintedSlot, deps.gen || 8, calcBestDamage);
                if (predicted) slot = predicted.slot;
            } else if (side === 'p1') {
                var bestScore = -Infinity;
                team.forEach(function (candidate, index) {
                    if (!candidate || candidate.currentHP <= 0 || index === faintedSlot) return;
                    var survives = switchSurvivalScore(state, candidate, deps, deps.gen || 8);
                    var foe = state.p2.active;
                    var damageShare = foe
                        ? Math.min(1, calcBestDamage(candidate, foe) / Math.max(1, foe.currentHP))
                        : 0;
                    var score = survives * 100 + damageShare * 60;
                    if (score > bestScore) { bestScore = score; slot = index; }
                });
            }

            if (slot === null || slot === undefined) {
                for (var i = 0; i < team.length; i++) {
                    if (team[i] && team[i].currentHP > 0 && i !== faintedSlot) { slot = i; break; }
                }
            }
            if (slot === null || slot === undefined) return false;

            if (deps.Logic && deps.Logic.performSwitch) {
                // performSwitch also applies entry hazards, resets boosts and
                // the sleep counter — everything a real switch-in pays
                deps.Logic.performSwitch(state, side, slot);
            } else {
                sideState.teamSlot = slot;
                sideState.active = team[slot].clone();
            }
            state.turnEvents = (state.turnEvents || []).concat(
                'faint:' + faintedName + ' fainted, ' +
                (sideState.active ? sideState.active.name : '?') + ' sent in');
            return true;
        }

        /** Priority-enriched copy so turn order can be computed for the trace. */
        function withTracePriority(action) {
            if (!action || action.type !== 'move') return action;
            if (typeof action.priority === 'number') return action;
            var entry = deps.MoveDB ? deps.MoveDB.get(action.moveName) : null;
            var priority = (entry && entry.priority) || 0;
            if (['Protect', 'Detect', 'Defend Order'].indexOf(action.moveName) !== -1 &&
                    priority < 4) priority = 4;
            return Object.assign({}, action, {priority: priority});
        }

        /**
         * Start a trace record: everything decided BEFORE the dice roll —
         * who does what, in which order, and how the turn can split.
         * Must run before the replacement loop mutates the produced states.
         */
        /** 'switch' alone says nothing — name who is coming in. */
        function describeAction(state, side, action) {
            if (!action) return 'nothing';
            if (action.type === 'switch') {
                var slot = action.switchToIndex !== undefined
                    ? action.switchToIndex : action.targetSlot;
                var team = state[side] ? (state[side].team || []) : [];
                var incoming = team[slot];
                return 'switch → ' + (incoming ? incoming.name : '?');
            }
            return action.moveName || action.type;
        }

        function beginTraceRecord(state, p1Action, p2Action, produced) {
            var Bx = branching();
            var order = Bx.turnOrder(state, {
                p1: withTracePriority(p1Action),
                p2: withTracePriority(p2Action)
            });

            var total = produced.reduce(function (a, o) { return a + o.probability; }, 0) || 1;
            var branches = Bx.detectBranches(new Bx.StateDist(produced.map(function (o) {
                return {state: o.state, probability: o.probability};
            })).merge());
            var splits = branches.length > 1
                ? branches.map(function (b) {
                    return {label: b.label, probability: roundProb(b.probability / total)};
                }).slice(0, 4)
                : [];

            return {
                turn: (state.turnNumber || 0) + 1,
                you: state.p1.active ? state.p1.active.name : '-',
                yourHP: state.p1.active ? state.p1.active.currentHP : 0,
                yourMaxHP: state.p1.active ? state.p1.active.maxHP : 0,
                yourMove: describeAction(state, 'p1', p1Action),
                yourAction: cloneAction(p1Action),
                yourActionType: p1Action ? p1Action.type : null,
                foe: state.p2.active ? state.p2.active.name : '-',
                foeHP: state.p2.active ? state.p2.active.currentHP : 0,
                foeMaxHP: state.p2.active ? state.p2.active.maxHP : 0,
                foeMove: describeAction(state, 'p2', p2Action),
                foeAction: cloneAction(p2Action),
                foeActionType: p2Action ? p2Action.type : null,
                foeAlternatives: p2Action && p2Action.candidates
                    ? p2Action.candidates.map(function (c) {
                        return c.moveName + ' ' + Math.round(c.probability * 100) + '%';
                    }).join(', ')
                    : null,
                firstMover: order[0] || 'p1',
                branches: splits
            };
        }

        /** Human-readable stage/status changes between two snapshots of a mon. */
        function describeChanges(before, after) {
            if (!before || !after || before.name !== after.name) return '';
            var parts = [];
            var stats = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'];
            var labels = {atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD',
                spe: 'Spe', accuracy: 'Acc', evasion: 'Eva'};
            stats.forEach(function (st) {
                var delta = ((after.boosts && after.boosts[st]) || 0) -
                    ((before.boosts && before.boosts[st]) || 0);
                if (delta) parts.push(labels[st] + ' ' + (delta > 0 ? '+' : '') + delta);
            });
            if (before.status !== after.status && after.status !== 'Healthy') {
                parts.push(after.status);
            }
            if (before.item && !after.item) parts.push('used ' + before.item);
            return parts.join(', ');
        }

        /** Close a trace record with what actually happened in its likeliest line. */
        function finishTraceRecord(record, startState, top) {
            if (!top) return;
            var s = top.state;
            record.lineProbability = roundProb(top.weight);
            record.after = {
                you: s.p1.active ? s.p1.active.name : '-',
                yourHP: s.p1.active ? s.p1.active.currentHP : 0,
                foe: s.p2.active ? s.p2.active.name : '-',
                foeHP: s.p2.active ? s.p2.active.currentHP : 0
            };
            record.events = (s.turnEvents || []).slice();
            record.youChanges = describeChanges(startState.p1.active, s.p1.active);
            record.foeChanges = describeChanges(startState.p2.active, s.p2.active);
            if (startState.p1.active && s.p1.active &&
                    startState.p1.active.name !== s.p1.active.name) {
                record.youReplaced = {
                    fainted: startState.p1.active.name,
                    sentIn: s.p1.active.name,
                    // A planned switch is a decision, a faint is an event —
                    // they must not read the same
                    voluntary: record.yourActionType === 'switch'
                };
            }
            if (startState.p2.active && s.p2.active &&
                    startState.p2.active.name !== s.p2.active.name) {
                record.foeReplaced = {
                    fainted: startState.p2.active.name,
                    sentIn: s.p2.active.name,
                    voluntary: record.foeActionType === 'switch'
                };
            }
        }

        /**
         * The simulation as a resumable run: `step(budget)` advances up to
         * `budget` states and returns whether the run is finished, so a
         * driver can spread the work over timer ticks and keep the page
         * responsive. `project()` below drains it synchronously.
         */
        function makeRun(startDist, options) {
            options = options || {};
            // Run until the battle is DECIDED — the loop exits the moment no
            // undecided line remains, so the cap is only a stall guard
            // (imagine two Growl users staring at each other).
            var horizon = options.horizon || 30;
            var beamWidth = options.beamWidth || 24;
            var Bx = branching();

            var live = startDist.entries.map(function (e) {
                return {state: e.state, probability: e.probability};
            });

            var terminal = [];      // decided lines
            var traceKey = null;    // stateKey of the line the trace follows
            var droppedMass = 0;    // genuinely discarded (should stay at 0)
            var coalescedMass = 0;  // folded onto a near-identical state
            var turnsSimulated = 0;

            var turn = 0;
            var i = 0;
            var next = [];
            var inTurn = false;
            var traceEntry = null;
            var finished = false;

            // Stall detection: an HP-and-faints fingerprint of the frontier.
            // If it is identical for several turns straight, NOTHING is
            // happening (a Growl war) — stop and report the mass as
            // unresolved instead of re-simulating the stalemate to the guard.
            var lastDigest = null;
            var stagnantTurns = 0;

            function frontierDigest() {
                function sideSig(state, sideName) {
                    var team = state[sideName].team || [];
                    if (!team.length) {
                        var a = state[sideName].active;
                        return a ? a.currentHP : 0;
                    }
                    var hp = 0, down = 0;
                    team.forEach(function (m) {
                        if (!m) return;
                        hp += m.currentHP;
                        if (m.currentHP <= 0) down++;
                    });
                    return hp + '-' + down;
                }
                return live.map(function (e) {
                    return sideSig(e.state, 'p1') + '/' + sideSig(e.state, 'p2') +
                        '@' + Math.round(e.probability * 1e6);
                }).sort().join(';');
            }

            function pickTraceEntry() {
                if (!options.trace || !live.length) return null;
                if (traceKey) {
                    for (var t = 0; t < live.length; t++) {
                        if (Bx.stateKey(live[t].state) === traceKey) return live[t];
                    }
                }
                // The followed line was coalesced into a neighbour by the
                // beam; the trace continues from the likeliest remaining line
                // and says so rather than pretending.
                if (traceKey && options.trace.length) {
                    options.trace[options.trace.length - 1].lineageBroken = true;
                }
                return live.reduce(function (a, b) {
                    return b.probability > a.probability ? b : a;
                }, live[0]);
            }

            function processEntry(entry) {
                var state = entry.state;

                var p1Action = choosePlayer(state, turn === 0 ? options.plannedP1 : null);
                var p2Action = chooseAI(state);

                if (!p1Action && !p2Action) {
                    terminal.push(entry);
                    return;
                }

                var produced;
                try {
                    produced = executeTurn(state, {p1: p1Action, p2: p2Action});
                } catch (e) {
                    terminal.push(entry);
                    return;
                }

                // Snapshot the turn's split BEFORE the replacement loop
                // mutates the produced states
                var traceRecord = null;
                var tracedTop = null;
                if (entry === traceEntry && options.trace) {
                    traceRecord = beginTraceRecord(state, p1Action, p2Action, produced);
                }

                produced.forEach(function (outcome) {
                    var s = outcome.state;
                    syncActive(s);

                    var p1Wiped = sideIsWiped(s, 'p1');
                    var p2Wiped = sideIsWiped(s, 'p2');

                    if (!p1Wiped) replaceSmart(s, 'p1');
                    if (!p2Wiped) replaceSmart(s, 'p2');

                    var weight = roundProb(entry.probability * outcome.probability);
                    if (weight <= 0) return;

                    var decided = p1Wiped || p2Wiped;
                    if (decided) {
                        terminal.push({state: s, probability: weight});
                    } else {
                        next.push({state: s, probability: weight});
                    }

                    if (traceRecord && (!tracedTop || weight > tracedTop.weight)) {
                        tracedTop = {state: s, weight: weight, decided: decided};
                    }
                });

                if (traceRecord) {
                    finishTraceRecord(traceRecord, state, tracedTop);
                    options.trace.push(traceRecord);
                    traceKey = (tracedTop && !tracedTop.decided)
                        ? Bx.stateKey(tracedTop.state)
                        : null;
                }
            }

            function endTurn() {
                // Merge identical futures, then bound the frontier.
                //
                // Dropping the tail outright made the projection report things
                // like "covers 17.3% of outcomes", which is not a usable number.
                // Instead the tail is COALESCED onto the nearest kept state by
                // HP, so its probability still counts toward the totals and only
                // the fine detail of those lines is approximated.
                var merged = new Bx.StateDist(next).merge();
                var entries = merged.entries.slice()
                    .sort(function (a, b) { return b.probability - a.probability; });

                if (entries.length > beamWidth) {
                    var kept = entries.slice(0, beamWidth);
                    var tail = entries.slice(beamWidth);

                    tail.forEach(function (e) {
                        var nearest = nearestByHP(kept, e.state);
                        if (nearest) {
                            nearest.probability = roundProb(nearest.probability + e.probability);
                            coalescedMass += e.probability;
                            // If the traced line itself is folded, follow it
                            // into its fold target: the story continues from
                            // the nearest-by-HP line instead of teleporting to
                            // whichever unrelated line is heaviest.
                            if (options.trace && traceKey &&
                                    Bx.stateKey(e.state) === traceKey) {
                                traceKey = Bx.stateKey(nearest.state);
                                // Still honest: the story continues, but on a
                                // nearby line — say so instead of pretending
                                if (options.trace.length) {
                                    options.trace[options.trace.length - 1]
                                        .lineageApproximated = true;
                                }
                            }
                        } else {
                            droppedMass += e.probability;
                        }
                    });
                    entries = kept;
                }
                live = entries;
                turn++;
                i = 0;
                inTurn = false;

                var digest = frontierDigest();
                if (digest === lastDigest) {
                    stagnantTurns++;
                    if (stagnantTurns >= 3) finished = true;
                } else {
                    stagnantTurns = 0;
                    lastDigest = digest;
                }
            }

            function step(budget) {
                var processed = 0;
                while (!finished && processed < budget) {
                    if (!inTurn) {
                        if (turn >= horizon || !live.length) { finished = true; break; }
                        // Effectively decided: don't burn turns on a sliver
                        var liveMass = live.reduce(function (a, e) { return a + e.probability; }, 0);
                        if (liveMass < 1e-4) { finished = true; break; }
                        turnsSimulated++;
                        next = [];
                        i = 0;
                        traceEntry = pickTraceEntry();
                        inTurn = true;
                    }
                    while (i < live.length && processed < budget) {
                        processEntry(live[i]);
                        i++;
                        processed++;
                    }
                    if (i >= live.length) endTurn();
                }
                return finished;
            }

            /** A cheap read of where the run stands, for live progress UI. */
            function progress() {
                var pending = inTurn ? live.slice(i).concat(next) : live.slice();
                var snap = summarise(pending, terminal, droppedMass, coalescedMass,
                    turnsSimulated, horizon, null);
                snap.traceTail = options.trace ? options.trace.slice(-4) : null;
                snap.finished = finished;
                return snap;
            }

            function finish() {
                return summarise(live, terminal, droppedMass, coalescedMass,
                    turnsSimulated, horizon, options.trace);
            }

            return {step: step, progress: progress, finish: finish};
        }

        /** Synchronous projection — tests and small runs drain it in place. */
        function project(startDist, options) {
            var run = makeRun(startDist, options);
            while (!run.step(Infinity)) { /* drain */ }
            return run.finish();
        }

        /**
         * Chunked projection: identical arithmetic, spread over timer ticks so
         * the browser never freezes. Reports through callbacks (not Promises)
         * so progress and completion render synchronously within a tick.
         *
         *   options.onProgress(partial)  after every tick
         *   options.onDone(report)       report is null if cancelled
         *   options.onError(e)
         *
         * Returns a handle with `cancel()`.
         */
        project.start = function (startDist, options) {
            options = options || {};
            var run = makeRun(startDist, options);
            var handle = {cancelled: false};
            handle.cancel = function () { handle.cancelled = true; };

            function tick() {
                if (handle.cancelled) {
                    if (options.onDone) options.onDone(null);
                    return;
                }
                var done = false;
                try {
                    var deadline = Date.now() + 20;
                    do { done = run.step(64); } while (!done && Date.now() < deadline);
                } catch (e) {
                    if (options.onError) options.onError(e);
                    return;
                }
                if (options.onProgress) options.onProgress(run.progress());
                if (done) {
                    if (options.onDone) options.onDone(run.finish());
                    return;
                }
                setTimeout(tick, 0);
            }
            setTimeout(tick, 0);
            return handle;
        };

        /** Promise flavour of `start`, for callers that prefer awaiting. */
        project.async = function (startDist, options) {
            options = options || {};
            var handle;
            var promise = new Promise(function (resolve, reject) {
                handle = project.start(startDist, Object.assign({}, options, {
                    onDone: resolve,
                    onError: reject
                }));
            });
            promise.cancel = function () { handle.cancel(); };
            return promise;
        };

        return project;
    }

    /**
     * The team the simulated line ACTUALLY used, in order: who led, who was
     * pulled in when, what each one fought and how they left the field. At
     * turn 0 this IS the projected team plan — the human algorithm of "best
     * answer for enemy #1, next answer whenever one is needed" made visible.
     */
    function buildTeamPlan(trace) {
        if (!trace || !trace.length) return null;
        var plan = [];
        var seg = null;
        trace.forEach(function (rec) {
            if (!seg || seg.name !== rec.you) {
                seg = {
                    name: rec.you,
                    fromTurn: rec.turn,
                    toTurn: rec.turn,
                    foes: [],
                    exit: 'standing',
                    endHP: rec.yourHP,
                    maxHP: rec.yourMaxHP
                };
                plan.push(seg);
            }
            if (seg.foes.indexOf(rec.foe) === -1) seg.foes.push(rec.foe);
            seg.toTurn = rec.turn;
            if (rec.youReplaced) {
                seg.exit = rec.youReplaced.voluntary ? 'switched out' : 'fainted';
                // A voluntary pivot leaves with its pre-turn HP; a faint with 0
                seg.endHP = rec.youReplaced.voluntary ? rec.yourHP : 0;
                seg = null;   // the incoming mon opens a new segment next record
            } else if (rec.after) {
                seg.endHP = rec.after.yourHP;
            }
        });
        return plan;
    }

    /**
     * Turn the terminal pile into the two numbers that matter, plus the detail
     * behind them.
     */
    function summarise(live, terminal, droppedMass, coalescedMass, turnsSimulated, horizon, trace) {
        var win = 0, loss = 0, unresolved = 0;
        var lossesByCount = {};
        var expectedLost = 0;
        var atLeastOneLost = 0;
        var totalMass = 0;
        var teamHPLeft = 0;

        function teamHPFraction(s) {
            var team = s.p1.team || [];
            if (!team.length) {
                var a = s.p1.active;
                return a ? a.currentHP / Math.max(1, a.maxHP) : 0;
            }
            var cur = 0, max = 0;
            team.forEach(function (m) {
                if (!m) return;
                cur += Math.max(0, m.currentHP);
                max += m.maxHP;
            });
            return max > 0 ? cur / max : 0;
        }

        function record(entry, decided) {
            var s = entry.state;
            var w = entry.probability;
            totalMass += w;
            teamHPLeft += teamHPFraction(s) * w;

            var lost = faintedCount(s, 'p1');
            lossesByCount[lost] = roundProb((lossesByCount[lost] || 0) + w);
            expectedLost += lost * w;
            if (lost > 0) atLeastOneLost += w;

            if (!decided) { unresolved += w; return; }
            if (sideIsWiped(s, 'p1')) loss += w;
            else if (sideIsWiped(s, 'p2')) win += w;
            else unresolved += w;
        }

        terminal.forEach(function (e) { record(e, true); });
        live.forEach(function (e) { record(e, false); });

        // Renormalise against the mass we actually modelled, so the reported
        // percentages are percentages OF the modelled outcomes, and the
        // unmodelled remainder is stated separately rather than hidden.
        var scale = totalMass > 0 ? 1 / totalMass : 0;

        var lossDistribution = Object.keys(lossesByCount)
            .map(function (k) {
                return {pokemonLost: Number(k), probability: roundProb(lossesByCount[k] * scale)};
            })
            .sort(function (a, b) { return a.pokemonLost - b.pokemonLost; });

        return {
            winProbability: roundProb(win * scale),
            lossProbability: roundProb(loss * scale),
            unresolvedProbability: roundProb(unresolved * scale),

            // The run currency: how many team members this costs
            expectedPokemonLost: Math.round(expectedLost * scale * 100) / 100,
            probabilityOfLosingAny: roundProb(atLeastOneLost * scale),
            lossDistribution: lossDistribution,
            // How much of the team's HP bar walks out of the fight, on
            // average — the damage you carry into whatever comes next.
            expectedTeamHPLeft: Math.round(teamHPLeft * scale * 1000) / 1000,

            turnsSimulated: turnsSimulated,
            horizon: horizon,
            statesConsidered: terminal.length + live.length,
            // Genuinely discarded mass. Should be zero: the frontier coalesces
            // rather than truncates.
            truncatedMass: roundProb(droppedMass),
            coverage: roundProb(1 - droppedMass),
            // Mass that was folded onto a near-identical state to bound the
            // frontier. Still counted in the totals, but its fine detail is
            // approximate — worth surfacing so the number can be trusted for
            // what it is.
            approximatedMass: roundProb(coalescedMass),
            // Turn-by-turn record of what the simulation actually did
            trace: trace || null,
            // Who the line used, in order — the projected team plan
            teamPlan: buildTeamPlan(trace)
        };
    }

    // =======================================================================
    // Short-term read: what happens THIS turn
    // =======================================================================

    /**
     * The immediate picture, for the panel above the projection: can either
     * side be knocked out right now, and by what.
     *
     * Everything here is derived from the same roll distributions the branch
     * engine uses, so the percentages agree with the branches that follow.
     */
    function assessTurn(state, deps, options) {
        options = options || {};
        var CI = deps.CalcIntegration;
        var calc = deps.calc;
        var genNum = deps.gen || 8;
        var MoveDB = deps.MoveDB;

        var you = state.p1.active;
        var foe = state.p2.active;
        if (!you || !foe) return null;

        var field = deps.getField ? deps.getField(state) : new calc.Field();

        function threats(attackerSnap, defenderSnap, attackerIsAI) {
            var attacker = CI.snapshotToPokemon(attackerSnap, genNum);
            var defender = CI.snapshotToPokemon(defenderSnap, genNum);
            if (!attacker || !defender) return [];

            return (attackerSnap.moves || []).filter(Boolean).map(function (name) {
                var entry = MoveDB ? MoveDB.get(name) : null;
                var out = {
                    moveName: name,
                    category: entry ? entry.category : 'Physical',
                    accuracy: CI.getAccuracy(entry || {name: name}, attackerSnap, defenderSnap, field, genNum),
                    priority: entry ? (entry.priority || 0) : 0,
                    koChance: 0, critKoChance: 0,
                    minPercent: 0, maxPercent: 0, rolls: []
                };
                if (!entry || entry.category === 'Status') return out;

                try {
                    var opts = {};
                    if (entry.effects && entry.effects.multihit) {
                        var mh = entry.effects.multihit;
                        opts.hits = Array.isArray(mh) ? mh[1] : mh;
                    }
                    var res = calc.calculate(genNum, attacker, defender,
                        new calc.Move(genNum, name, opts), attackerIsAI ? field.clone().swap() : field);
                    var rolls = CI.getDamageRolls(res, opts.hits);
                    var range = CI.getDamageRange(res, opts.hits);

                    out.rolls = rolls;
                    out.min = range.min;
                    out.max = range.max;
                    out.minPercent = Math.round((range.min / defenderSnap.maxHP) * 1000) / 10;
                    out.maxPercent = Math.round((range.max / defenderSnap.maxHP) * 1000) / 10;
                    out.koChance = rolls.filter(function (r) { return r.damage >= defenderSnap.currentHP; })
                        .reduce(function (a, r) { return a + r.probability; }, 0) * (out.accuracy / 100);

                    var critMove = new calc.Move(genNum, name, Object.assign({isCrit: true}, opts));
                    var critRes = calc.calculate(genNum, attacker, defender, critMove,
                        attackerIsAI ? field.clone().swap() : field);
                    var critRolls = CI.getDamageRolls(critRes, opts.hits);

                    // P(a crit roll is lethal) — conditional on having crit
                    var lethalGivenCrit = critRolls
                        .filter(function (r) { return r.damage >= defenderSnap.currentHP; })
                        .reduce(function (a, r) { return a + r.probability; }, 0);

                    out.critChance = CI.getCritChance(
                        critMove, attackerSnap, defenderSnap, field, genNum);
                    out.lethalGivenCrit = lethalGivenCrit;

                    // The ABSOLUTE chance this move crit-kills: it has to connect,
                    // it has to crit, and the crit roll has to be lethal. Reporting
                    // the conditional figure here made a "crit always kills" move
                    // look like a certainty rather than a 1-in-16 risk.
                    out.critKoChance = lethalGivenCrit * out.critChance * (out.accuracy / 100);
                    out.critRange = CI.getDamageRange(critRes, opts.hits);
                } catch (e) { /* leave the zeros */ }

                return out;
            });
        }

        var yourMoves = threats(you, foe, false);
        var theirMoves = threats(foe, you, true);

        function worst(list) {
            return list.reduce(function (acc, m) {
                return m.koChance > acc.koChance ? m : acc;
            }, {koChance: 0, moveName: null});
        }

        var yourBest = worst(yourMoves);
        var theirBest = worst(theirMoves);

        // Turn order decides whether their threat ever happens.
        //
        // The read-out used to compute both sides independently, which produced
        // the nonsense "Bibarel dies this turn to Low Sweep" alongside "Monferno
        // dies to Pluck 43.8%" — impossible, because Monferno is faster, so
        // Bibarel is already gone before it can attack. If you move first and
        // kill, their move is never used, so their KO chance has to be
        // conditioned on your kill failing.
        var yourSpeed = you.getEffectiveSpeed
            ? you.getEffectiveSpeed(state.sides && state.sides.p1) : 0;
        var foeSpeed = foe.getEffectiveSpeed
            ? foe.getEffectiveSpeed(state.sides && state.sides.p2) : 0;
        var trickRoom = !!(state.field && state.field.trickRoom);
        var youFirst = yourSpeed === foeSpeed
            ? null                                    // a genuine coin flip
            : (trickRoom ? yourSpeed < foeSpeed : yourSpeed > foeSpeed);

        // The move the player has actually selected, if any — that is the one
        // whose kill would pre-empt the opponent.
        var selected = options.selectedMove
            ? yourMoves.filter(function (m) { return m.moveName === options.selectedMove; })[0]
            : null;
        var yourKillChance = selected ? selected.koChance : yourBest.koChance;

        // P(they get to act) — 1 if they are faster, otherwise 1 minus your kill
        var theyAct;
        if (youFirst === true) theyAct = 1 - yourKillChance;
        else if (youFirst === false) theyAct = 1;
        else theyAct = 0.5 * (1 - yourKillChance) + 0.5;   // speed tie

        // Priority overrides raw speed for the move actually chosen
        if (selected && selected.priority > 0 && youFirst === false) {
            theyAct = 1 - yourKillChance;
        }

        return {
            youMoveFirst: youFirst,
            yourSpeed: yourSpeed,
            foeSpeed: foeSpeed,
            trickRoom: trickRoom,
            opponentActsChance: theyAct,
            selectedMoveName: selected ? selected.moveName : null,
            you: {name: you.name, hp: you.currentHP, maxHP: you.maxHP},
            foe: {name: foe.name, hp: foe.currentHP, maxHP: foe.maxHP},
            yourMoves: yourMoves,
            theirMoves: theirMoves,
            youCanKO: yourBest.koChance,
            youCanKOWith: yourBest.moveName,
            // Conditioned on the opponent surviving long enough to attack
            youMightDie: theirBest.koChance * theyAct,
            youMightDieTo: theirBest.moveName,
            youMightDieUnconditional: theirBest.koChance,
            // The chance a crit is what kills you, over and above the rolls that
            // kill anyway. Runs end here, so it is reported separately rather
            // than folded into youMightDie.
            youMightDieToCrit: theirMoves.reduce(function (a, m) {
                return Math.max(a, m.critKoChance);
            }, 0) * theyAct,
            // Kept for the panel: "a crit from this move would kill" is useful
            // even when the crit itself is unlikely.
            worstCaseCritIsLethal: theirMoves.some(function (m) {
                return m.lethalGivenCrit >= 0.999;
            })
        };
    }

    /**
     * "Which of my team should even start this fight?"
     *
     * Runs the same projection once per healthy team member as the lead and
     * returns the results sorted best-first: win chance, then fewest expected
     * losses. Only meaningful at turn 0 — mid-battle the lead is whoever is
     * standing there.
     */
    function createLeadComparison(deps) {
        // Openers are ranked with the cheapest policy tier (attacks + the
        // emergency pivot). Callers can override via deps.playerPolicy.
        var project = createProjection(Object.assign({}, deps, {
            playerPolicy: deps.playerPolicy ||
                createPlayerPolicy(deps, {complexity: 0})
        }));

        function healthySlots(state) {
            var out = [];
            ((state.p1 && state.p1.team) || []).forEach(function (m, i) {
                if (m && m.currentHP > 0) out.push(i);
            });
            return out;
        }

        function makeVariant(state, slot) {
            var variant = state.clone();
            variant.p1.teamSlot = slot;
            variant.p1.active = variant.p1.team[slot].clone();
            // A fresh opener starts clean
            variant.p1.active.boosts = {
                atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0
            };
            variant.p1.active.volatiles = {};
            return variant;
        }

        function toRow(state, slot, report) {
            return {
                slot: slot,
                report: report,
                name: state.p1.team[slot].name,
                isCurrent: slot === state.p1.teamSlot,
                winProbability: report.winProbability,
                lossProbability: report.lossProbability,
                unresolvedProbability: report.unresolvedProbability,
                expectedPokemonLost: report.expectedPokemonLost,
                probabilityOfLosingAny: report.probabilityOfLosingAny
            };
        }

        function sortRows(rows) {
            rows.sort(function (a, b) {
                return (b.winProbability - a.winProbability) ||
                    (a.expectedPokemonLost - b.expectedPokemonLost);
            });
            return rows;
        }

        function compareLeads(state, options) {
            options = options || {};
            var Bx = branching();
            var rows = [];
            healthySlots(state).forEach(function (slot) {
                var report = project(Bx.StateDist.of(makeVariant(state, slot), 1), {
                    horizon: options.horizon || 16,
                    beamWidth: options.beamWidth || 24
                });
                rows.push(toRow(state, slot, report));
            });
            return sortRows(rows);
        }

        /**
         * Chunked flavour: one lead at a time, each spread over timer ticks.
         * onProgress receives {leadIndex, leadCount, name, rows, inner};
         * onDone receives the sorted rows (partial if cancelled mid-way).
         */
        compareLeads.start = function (state, options) {
            options = options || {};
            var Bx = branching();
            var slots = healthySlots(state);
            var rows = [];
            var handle = {cancelled: false, inner: null};
            handle.cancel = function () {
                handle.cancelled = true;
                if (handle.inner) handle.inner.cancel();
            };

            function nextLead(idx) {
                if (handle.cancelled || idx >= slots.length) {
                    if (options.onDone) options.onDone(sortRows(rows));
                    return;
                }
                var slot = slots[idx];
                handle.inner = project.start(
                    Bx.StateDist.of(makeVariant(state, slot), 1), {
                        horizon: options.horizon || 16,
                        beamWidth: options.beamWidth || 24,
                        onProgress: function (p) {
                            if (options.onProgress) {
                                options.onProgress({
                                    leadIndex: idx,
                                    leadCount: slots.length,
                                    name: state.p1.team[slot].name,
                                    rows: rows.slice(),
                                    inner: p
                                });
                            }
                        },
                        onDone: function (report) {
                            if (report) rows.push(toRow(state, slot, report));
                            nextLead(idx + 1);
                        },
                        onError: options.onError
                    });
            }
            nextLead(0);
            return handle;
        };

        return compareLeads;
    }

    // =======================================================================
    // Roster selection: "the best 6 for THIS fight", team and box together
    // =======================================================================

    /**
     * Rank every owned candidate — current team AND box — against the
     * opponent's whole team, and return the best `limit` as the planning
     * roster. Score per enemy: how hard the candidate hits them (share of
     * their HP bar per turn) plus how comfortably it takes their best hit.
     * The current active stays on the roster (it is the lead right now; the
     * lead comparison may still recommend opening with someone else).
     *
     * This is the turn-0 promise made real: the projection decides the team,
     * not the other way round. Pre-building a team is never required.
     */
    function selectBestRoster(state, box, deps, limit) {
        limit = limit || 6;
        var enemies = ((state.p2 && state.p2.team) || []).filter(function (m) {
            return m && m.currentHP > 0;
        });
        if (!enemies.length && state.p2 && state.p2.active) {
            enemies = [state.p2.active];
        }

        var pool = [];
        ((state.p1 && state.p1.team) || []).forEach(function (m) {
            if (m && m.currentHP > 0) pool.push({snap: m, fromBox: false});
        });
        (box || []).forEach(function (m) {
            if (!m || !m.name || (m.currentHP !== undefined && m.currentHP <= 0)) return;
            var dupe = pool.some(function (e) { return e.snap.name === m.name; });
            if (!dupe) pool.push({snap: m, fromBox: true});
        });
        if (!pool.length) return [];

        function bestShare(attacker, defender) {
            var best = 0;
            (attacker.moves || []).filter(Boolean).forEach(function (name) {
                var avg = damageFor(deps, null, attacker, defender, name, false).range.avg;
                if (avg > best) best = avg;
            });
            return Math.min(1, best / Math.max(1, defender.maxHP));
        }

        pool.forEach(function (entry) {
            var score = 0;
            enemies.forEach(function (enemy) {
                var offense = bestShare(entry.snap, enemy);
                var pain = bestShare(enemy, entry.snap);
                score += offense * 60 + (1 - pain) * 40;
            });
            entry.score = enemies.length ? score / enemies.length : 0;
        });
        pool.sort(function (a, b) { return b.score - a.score; });

        var activeName = state.p1 && state.p1.active ? state.p1.active.name : null;
        var roster = [];
        pool.forEach(function (e) {
            if (activeName && e.snap.name === activeName) roster.push(e);
        });
        pool.forEach(function (e) {
            if (roster.length >= limit) return;
            if (roster.indexOf(e) !== -1) return;
            roster.push(e);
        });
        return roster;
    }

    // =======================================================================
    // Strategy escalation: simple plans first
    // =======================================================================

    /**
     * Try the SIMPLEST strategy first and escalate only when it is not good
     * enough:
     *
     *   1. pure offense       — click the best attack every turn;
     *   2. + status moves     — Toxic, Will-O-Wisp, stat drops on the table;
     *   3. the full toolbox   — pivoting out, baiting, sacking.
     *
     * If just attacking wins the fight without losing anyone, that IS the
     * answer — a plan you can execute without thinking beats a clever one.
     * Escalation only happens when the simple plan loses the fight or pays
     * for it with a team member. The best result across the tried tiers is
     * returned (win first, fewest losses second); ties go to the simpler
     * plan. All tiers share one damage memo and one AI-move cache, so an
     * escalation costs far less than a fresh run.
     */
    function createSmartProjection(deps) {
        var TIERS = [
            {complexity: 0, label: 'pure offense'},
            {complexity: 1, label: 'offense + status moves'},
            {complexity: 2, label: 'full toolbox (pivots & baiting)'}
        ];

        // Created BEFORE the per-tier deps copies so every tier — and any
        // lead comparison made from the same deps afterwards — shares one
        // damage memo and one AI-move cache.
        deps.__dmgCache = deps.__dmgCache || {map: {}, pk: {}, n: 0, pkN: 0};
        deps.aiPolicy = deps.aiPolicy || createAIPolicy(deps);

        function tierProject(tier) {
            return createProjection(Object.assign({}, deps, {
                playerPolicy: createPlayerPolicy(deps, {complexity: tier.complexity})
            }));
        }

        /**
         * Which tiers can even produce a DIFFERENT answer here? A team with
         * no status moves makes tier 1 identical to tier 0; a team with no
         * bench makes tier 2's repositioning identical to tier 1. Skipping
         * them is free accuracy — the run they would do is the run before.
         */
        function applicableTiers(startDist) {
            var first = startDist.entries[0] && startDist.entries[0].state;
            var team = first ? ((first.p1 && first.p1.team) || []) : [];
            var healthy = team.filter(function (m) {
                return m && m.currentHP > 0;
            }).length;
            var hasStatus = team.some(function (m) {
                if (!m || m.currentHP <= 0) return false;
                return (m.moves || []).filter(Boolean).some(function (name) {
                    var entry = deps.MoveDB ? deps.MoveDB.get(name) : null;
                    return entry && entry.category === 'Status';
                });
            });
            var tiers = [TIERS[0]];
            if (hasStatus) tiers.push(TIERS[1]);
            if (healthy > 1) tiers.push(TIERS[2]);
            return tiers;
        }

        function goodEnough(report) {
            return report.winProbability >= 0.995 &&
                report.probabilityOfLosingAny <= 0.005;
        }

        function tag(report, tier) {
            report.strategy = tier.label;
            report.strategyTier = tier.complexity;
            return report;
        }

        function pickBest(results) {
            if (!results.length) return null;
            var best = results.slice().sort(function (a, b) {
                return (b.winProbability - a.winProbability) ||
                    (a.expectedPokemonLost - b.expectedPokemonLost) ||
                    (a.strategyTier - b.strategyTier);
            })[0];
            best.strategiesTried = results.map(function (r) {
                return {
                    strategy: r.strategy,
                    winProbability: r.winProbability,
                    expectedPokemonLost: r.expectedPokemonLost
                };
            });
            return best;
        }

        function probeBeam(options) {
            return Math.max(24, Math.round((options.beamWidth || 24) / 3));
        }

        function runOptions(options, full) {
            return {
                horizon: options.horizon,
                beamWidth: full ? options.beamWidth : probeBeam(options),
                plannedP1: options.plannedP1,
                trace: full ? [] : null
            };
        }

        function smart(startDist, options) {
            options = options || {};
            var tiers = applicableTiers(startDist);
            var results = [];
            for (var t = 0; t < tiers.length; t++) {
                // Tier 0 is the likeliest winner: run it at full quality with
                // a trace, so the common case needs exactly one run.
                var report = tag(tierProject(tiers[t])(startDist,
                    runOptions(options, t === 0)), tiers[t]);
                results.push(report);
                if (goodEnough(report)) break;
            }
            var best = pickBest(results);
            if (best && !best.trace) {
                // An escalation won its probe: re-run just the winner at full
                // beam with a trace for display.
                var tier = tiers.filter(function (x) {
                    return x.complexity === best.strategyTier;
                })[0] || TIERS[2];
                var rerun = tag(tierProject(tier)(startDist,
                    runOptions(options, true)), tier);
                rerun.strategiesTried = best.strategiesTried;
                best = rerun;
            }
            return best;
        }

        /** Chunked flavour, same callback contract as project.start. */
        smart.start = function (startDist, options) {
            options = options || {};
            var tiers = applicableTiers(startDist);
            var results = [];
            var handle = {cancelled: false, inner: null};
            handle.cancel = function () {
                handle.cancelled = true;
                if (handle.inner) handle.inner.cancel();
            };

            function withProgress(opts, tier) {
                opts.onProgress = function (r) {
                    if (options.onProgress) {
                        r.strategy = tier.label;
                        r.strategyTier = tier.complexity;
                        r.strategyCount = tiers.length;
                        options.onProgress(r);
                    }
                };
                opts.onError = options.onError;
                return opts;
            }

            function finish(best) {
                if (best && !best.trace && !handle.cancelled) {
                    var tier = tiers.filter(function (x) {
                        return x.complexity === best.strategyTier;
                    })[0] || TIERS[2];
                    var opts = withProgress(runOptions(options, true), tier);
                    opts.onDone = function (rerun) {
                        if (rerun) {
                            tag(rerun, tier);
                            rerun.strategiesTried = best.strategiesTried;
                        }
                        if (options.onDone) options.onDone(rerun || best);
                    };
                    handle.inner = tierProject(tier).start(startDist, opts);
                    return;
                }
                if (options.onDone) options.onDone(best);
            }

            function runTier(t) {
                if (handle.cancelled) {
                    if (options.onDone) options.onDone(null);
                    return;
                }
                if (t >= tiers.length) {
                    finish(pickBest(results));
                    return;
                }
                var tier = tiers[t];
                var opts = withProgress(runOptions(options, t === 0), tier);
                opts.onDone = function (report) {
                    if (!report) {
                        if (options.onDone) options.onDone(null);
                        return;
                    }
                    tag(report, tier);
                    results.push(report);
                    if (goodEnough(report)) {
                        finish(pickBest(results));
                        return;
                    }
                    runTier(t + 1);
                };
                handle.inner = tierProject(tier).start(startDist, opts);
            }
            runTier(0);
            return handle;
        };

        return smart;
    }

    window.BattlePlannerProjection = {
        createProjection: createProjection,
        createSmartProjection: createSmartProjection,
        selectBestRoster: selectBestRoster,
        createLeadComparison: createLeadComparison,
        createAIPolicy: createAIPolicy,
        createPlayerPolicy: createPlayerPolicy,
        greedyDamage: greedyDamage,
        scoreMove: scoreMove,
        killChance: killChance,
        incomingThreat: incomingThreat,
        switchSurvivalScore: switchSurvivalScore,
        assessTurn: assessTurn,
        replaceFainted: replaceFainted,
        sideIsWiped: sideIsWiped,
        faintedCount: faintedCount
    };

})(window);
