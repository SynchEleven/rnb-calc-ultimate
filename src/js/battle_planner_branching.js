/**
 * Outcome-Relevant Branching Engine
 * =================================
 *
 * The planner should NOT enumerate every possible damage roll. 16 rolls per
 * move per turn is 16^n paths and almost all of them play out identically.
 * What matters is whether a roll changes the STORY: whether something faints,
 * whether a berry fires, whether the next turn's kill still lands.
 *
 * Two ideas make that tractable.
 *
 * 1. DISTRIBUTIONS INSTEAD OF POINTS
 *    A node does not hold one state; it holds a weighted set of concrete
 *    states ("a StateDist"). Identical states merge, and because HP is an
 *    integer clamped to [0, maxHP] the set can never grow past maxHP+1 entries
 *    per side. Exact probability tracking stays cheap.
 *
 * 2. SPLIT ONLY ON DISTINGUISHING PREDICATES
 *    After a turn is applied, we ask a list of qualitative questions of the
 *    resulting distribution ("did the defender faint?", "did the burn land?",
 *    "did Sitrus fire?"). A question that every state answers the same way is
 *    not interesting and produces no branch. A question that splits the
 *    distribution produces exactly one child per distinct answer.
 *
 *    Damage rolls therefore collapse automatically: 16 rolls that all leave the
 *    target alive and above every threshold are ONE branch, and the branch
 *    carries the full HP distribution so a later turn can still tell them
 *    apart.
 *
 * RETROACTIVE REFINEMENT
 * ----------------------
 * Point 2 is only sound if a distinction that becomes relevant LATER can still
 * be recovered. It can, because a node's state distribution is never collapsed
 * to a single value: it is retained in full. When turn 3 asks "does the foe
 * survive?" and the answer differs across the HP values inherited from turn 2,
 * the split happens at turn 3 and the turn-2 node retroactively gains the
 * annotation that its rolls mattered.
 *
 * `reconcile()` replays the entire tree from the root: every node stores only
 * the ACTIONS taken plus the predicate answer that selected it, and all state
 * is derived. So any change — editing turn 1, correcting an ability, learning
 * that the opponent actually crit — automatically re-evaluates the past,
 * present and future of every path, adding branches that have become relevant
 * and pruning branches that have become impossible.
 *
 * Exposed on `window.BattlePlannerBranching`.
 */
(function (window) {
    'use strict';

    // =======================================================================
    // Probability-weighted state distributions
    // =======================================================================

    /** Round to 12 dp so float noise never fragments a distribution. */
    function roundProb(p) {
        return Math.round(p * 1e12) / 1e12;
    }

    /**
     * A weighted set of concrete BattleStateSnapshots.
     * Entries are { state, probability }, merged by structural key.
     */
    function StateDist(entries) {
        this.entries = entries || [];
    }

    StateDist.of = function (state, probability) {
        return new StateDist([{ state: state, probability: probability === undefined ? 1 : probability }]);
    };

    StateDist.prototype.totalProbability = function () {
        return this.entries.reduce(function (sum, e) { return sum + e.probability; }, 0);
    };

    StateDist.prototype.isEmpty = function () {
        return this.entries.length === 0 || this.totalProbability() <= 0;
    };

    /** Merge structurally identical states so the set stays small. */
    StateDist.prototype.merge = function () {
        var byKey = {};
        var order = [];

        this.entries.forEach(function (entry) {
            if (entry.probability <= 0) return;
            var key = stateKey(entry.state);
            if (byKey[key]) {
                byKey[key].probability = roundProb(byKey[key].probability + entry.probability);
            } else {
                byKey[key] = { state: entry.state, probability: roundProb(entry.probability) };
                order.push(key);
            }
        });

        this.entries = order.map(function (k) { return byKey[k]; });
        return this;
    };

    /** Renormalise to sum to 1 (used after conditioning on a predicate answer). */
    StateDist.prototype.normalized = function () {
        var total = this.totalProbability();
        if (total <= 0) return new StateDist([]);
        return new StateDist(this.entries.map(function (e) {
            return { state: e.state, probability: roundProb(e.probability / total) };
        }));
    };

    /** Apply a transform that may itself fan out into several weighted states. */
    StateDist.prototype.flatMap = function (fn) {
        var out = [];
        this.entries.forEach(function (entry) {
            var produced = fn(entry.state, entry.probability) || [];
            produced.forEach(function (p) {
                if (p.probability > 0) {
                    out.push({ state: p.state, probability: roundProb(entry.probability * p.probability) });
                }
            });
        });
        return new StateDist(out).merge();
    };

    /** Expected value of a numeric readout across the distribution. */
    StateDist.prototype.expected = function (fn) {
        var total = this.totalProbability();
        if (total <= 0) return 0;
        return this.entries.reduce(function (sum, e) {
            return sum + fn(e.state) * e.probability;
        }, 0) / total;
    };

    /** Distinct values of a readout, with the probability of each. */
    StateDist.prototype.spread = function (fn) {
        var byValue = {};
        this.entries.forEach(function (e) {
            var v = fn(e.state);
            byValue[v] = roundProb((byValue[v] || 0) + e.probability);
        });
        return Object.keys(byValue).map(function (v) {
            return { value: isNaN(Number(v)) ? v : Number(v), probability: byValue[v] };
        }).sort(function (a, b) { return b.probability - a.probability; });
    };

    /**
     * Structural identity of a state. Two states with the same key are
     * interchangeable for every future decision, so they can share a branch.
     */
    function stateKey(state) {
        return [
            (state.turnEvents || []).join(','),
            pokemonKey(state.p1 && state.p1.active),
            pokemonKey(state.p2 && state.p2.active),
            sideKey(state.sides && state.sides.p1),
            sideKey(state.sides && state.sides.p2),
            fieldKey(state.field),
            state.p1 ? state.p1.teamSlot : 0,
            state.p2 ? state.p2.teamSlot : 0
        ].join('|');
    }

    function pokemonKey(p) {
        if (!p) return 'none';
        var boosts = p.boosts || {};
        var volatiles = Object.keys(p.volatiles || {}).filter(function (k) {
            return p.volatiles[k];
        }).sort().join(',');
        return [
            p.name, p.currentHP, p.status, p.toxicCounter || 0, p.item || '',
            (p.types || []).join('/'),
            boosts.atk || 0, boosts.def || 0, boosts.spa || 0,
            boosts.spd || 0, boosts.spe || 0,
            boosts.accuracy || 0, boosts.evasion || 0,
            volatiles, (p.pp || []).join('.')
        ].join(';');
    }

    function sideKey(s) {
        if (!s) return 'none';
        return [
            s.spikes || 0, s.toxicSpikes || 0, s.stealthRock ? 1 : 0, s.stickyWeb ? 1 : 0,
            s.reflect ? s.reflectTurns : 0, s.lightScreen ? s.lightScreenTurns : 0,
            s.auroraVeil ? s.auroraVeilTurns : 0, s.tailwind ? s.tailwindTurns : 0
        ].join(';');
    }

    function fieldKey(f) {
        if (!f) return 'none';
        return [
            f.weather || 'None', f.weatherTurns || 0,
            f.terrain || 'None', f.terrainTurns || 0,
            f.trickRoom ? f.trickRoomTurns : 0, f.gravity ? 1 : 0
        ].join(';');
    }

    // =======================================================================
    // Distinguishing predicates
    // =======================================================================

    /**
     * A predicate labels a state with a discrete answer. If every state in a
     * distribution shares the answer, the predicate is uninteresting and no
     * branch is created.
     *
     * `significance` orders the branch list in the UI, highest first.
     */
    var PREDICATES = [
        {
            id: 'p1Fainted',
            significance: 100,
            label: function (v) { return v ? 'Your Pokemon faints' : 'Your Pokemon survives'; },
            evaluate: function (state) { return !!(state.p1.active && state.p1.active.currentHP <= 0); }
        },
        {
            id: 'p2Fainted',
            significance: 100,
            label: function (v) { return v ? 'Opponent faints' : 'Opponent survives'; },
            evaluate: function (state) { return !!(state.p2.active && state.p2.active.currentHP <= 0); }
        },
        {
            id: 'p1Status',
            significance: 80,
            label: function (v) { return v === 'Healthy' ? 'You avoid the status' : 'You are ' + v; },
            evaluate: function (state) { return state.p1.active ? state.p1.active.status : 'Healthy'; }
        },
        {
            id: 'p2Status',
            significance: 80,
            label: function (v) { return v === 'Healthy' ? 'Opponent avoids the status' : 'Opponent is ' + v; },
            evaluate: function (state) { return state.p2.active ? state.p2.active.status : 'Healthy'; }
        },
        {
            id: 'p1Item',
            significance: 60,
            label: function (v) { return v ? 'You keep your ' + v : 'Your item is consumed'; },
            evaluate: function (state) { return state.p1.active ? (state.p1.active.item || '') : ''; }
        },
        {
            id: 'p2Item',
            significance: 60,
            label: function (v) { return v ? 'Opponent keeps its ' + v : 'Opponent item is consumed'; },
            evaluate: function (state) { return state.p2.active ? (state.p2.active.item || '') : ''; }
        },
        {
            id: 'p1Boosts',
            significance: 55,
            label: function (v) { return 'Your boosts: ' + v; },
            evaluate: function (state) { return boostSignature(state.p1.active); }
        },
        {
            id: 'p2Boosts',
            significance: 55,
            label: function (v) { return 'Opponent boosts: ' + v; },
            evaluate: function (state) { return boostSignature(state.p2.active); }
        },
        {
            id: 'p1Volatiles',
            significance: 50,
            label: function (v) { return v ? 'You are affected by ' + v : 'No volatile effect on you'; },
            evaluate: function (state) { return volatileSignature(state.p1.active); }
        },
        {
            id: 'p2Volatiles',
            significance: 50,
            label: function (v) { return v ? 'Opponent affected by ' + v : 'No volatile effect on opponent'; },
            evaluate: function (state) { return volatileSignature(state.p2.active); }
        },
        {
            id: 'turnEvents',
            significance: 95,
            label: function (v) {
                if (!v) return 'Both sides acted normally';
                return v.split(',').map(function (e) {
                    var parts = e.split(':');
                    var who = parts[0] === 'p1' ? 'You were' : 'The opponent was';
                    return who + ' ' + parts[1];
                }).join('; ');
            },
            evaluate: function (state) { return (state.turnEvents || []).join(','); }
        },
        {
            id: 'weather',
            significance: 40,
            label: function (v) { return 'Weather: ' + v; },
            evaluate: function (state) { return state.field ? (state.field.weather || 'None') : 'None'; }
        },
        {
            id: 'terrain',
            significance: 40,
            label: function (v) { return 'Terrain: ' + v; },
            evaluate: function (state) { return state.field ? (state.field.terrain || 'None') : 'None'; }
        },
        {
            id: 'hazards',
            significance: 30,
            label: function (v) { return 'Hazards: ' + v; },
            evaluate: function (state) {
                return sideKey(state.sides && state.sides.p1) + '/' + sideKey(state.sides && state.sides.p2);
            }
        }
    ];

    function boostSignature(p) {
        if (!p || !p.boosts) return 'none';
        var parts = [];
        ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'].forEach(function (stat) {
            if (p.boosts[stat]) parts.push(stat + (p.boosts[stat] > 0 ? '+' : '') + p.boosts[stat]);
        });
        return parts.length ? parts.join(' ') : 'none';
    }

    function volatileSignature(p) {
        if (!p || !p.volatiles) return '';
        return Object.keys(p.volatiles).filter(function (k) { return p.volatiles[k]; }).sort().join(',');
    }

    /**
     * A "survival threshold" predicate generated on demand.
     *
     * This is what makes the retroactive part work. When a future turn needs to
     * know whether the HP inherited from an earlier turn is above or below some
     * value, we can manufacture exactly that question and split on it, without
     * ever having enumerated the intervening rolls.
     */
    function hpThresholdPredicate(side, threshold, description) {
        return {
            id: side + 'HpAtLeast:' + threshold,
            significance: 90,
            generated: true,
            label: function (v) {
                return v
                    ? (description || (side + ' is at ' + threshold + '+ HP'))
                    : (description ? 'NOT ' + description : side + ' is below ' + threshold + ' HP');
            },
            evaluate: function (state) {
                var mon = state[side] && state[side].active;
                return !!(mon && mon.currentHP >= threshold);
            }
        };
    }

    // =======================================================================
    // Branch detection
    // =======================================================================

    /**
     * Partition a distribution by the predicates that actually distinguish it.
     *
     * Returns [{ answers, label, probability, dist }]. A single element means
     * "nothing interesting happened" — every outcome plays out the same way, so
     * the caller should NOT create sibling nodes.
     */
    function detectBranches(dist, extraPredicates) {
        var merged = new StateDist(dist.entries.slice()).merge();
        if (merged.entries.length <= 1) {
            return [{ answers: {}, label: 'Only outcome', probability: merged.totalProbability(), dist: merged, trivial: true }];
        }

        var candidates = PREDICATES.concat(extraPredicates || []);

        // Keep only predicates that are non-constant across the distribution
        var distinguishing = candidates.filter(function (predicate) {
            var seen = null;
            var varies = false;
            merged.entries.forEach(function (e) {
                var answer = predicate.evaluate(e.state);
                if (seen === null) seen = answer;
                else if (answer !== seen) varies = true;
            });
            return varies;
        });

        if (!distinguishing.length) {
            // States differ only in ways nothing downstream can observe
            // (e.g. HP values that cross no threshold). One branch, full spread.
            return [{ answers: {}, label: 'Only outcome', probability: merged.totalProbability(), dist: merged, trivial: true }];
        }

        distinguishing.sort(function (a, b) { return b.significance - a.significance; });

        // Group by the tuple of answers to every distinguishing predicate
        var groups = {};
        var order = [];
        merged.entries.forEach(function (entry) {
            var answers = {};
            var keyParts = [];
            distinguishing.forEach(function (p) {
                var a = p.evaluate(entry.state);
                answers[p.id] = a;
                keyParts.push(p.id + '=' + a);
            });
            var key = keyParts.join('&');
            if (!groups[key]) {
                groups[key] = {
                    answers: answers,
                    label: describeAnswers(distinguishing, answers),
                    probability: 0,
                    entries: []
                };
                order.push(key);
            }
            groups[key].probability = roundProb(groups[key].probability + entry.probability);
            groups[key].entries.push(entry);
        });

        return order.map(function (key) {
            var g = groups[key];
            return {
                answers: g.answers,
                label: g.label,
                probability: g.probability,
                dist: new StateDist(g.entries).merge()
            };
        }).sort(function (a, b) { return b.probability - a.probability; });
    }

    /** Human-readable summary of a branch, using the most significant answers. */
    function describeAnswers(predicates, answers) {
        var parts = [];
        predicates.slice(0, 3).forEach(function (p) {
            parts.push(p.label(answers[p.id]));
        });
        return parts.join(', ') || 'Outcome';
    }

    // =======================================================================
    // Turn application
    // =======================================================================

    /**
     * Everything that can independently fan a single state into several.
     *
     * Each entry returns an array of { state, probability } summing to 1. They
     * compose multiplicatively, and the resulting states are merged, so
     * combinations that end up identical cost nothing.
     */
    function applyTurnToState(state, plan, hooks) {
        var results = [{ state: state, probability: 1 }];

        function fanOut(fn) {
            var next = [];
            results.forEach(function (r) {
                var produced = fn(r.state) || [{ state: r.state, probability: 1 }];
                produced.forEach(function (p) {
                    if (p.probability > 0) {
                        next.push({ state: p.state, probability: roundProb(r.probability * p.probability) });
                    }
                });
            });
            results = next;
        }

        (plan.steps || []).forEach(function (step) {
            fanOut(function (s) { return step(s, hooks); });
        });

        return results;
    }

    /**
     * Build the fan-out steps for one side's move.
     *
     * `spec` describes the move's stochastic surface:
     *   { side, accuracy, damageRolls, critChance, critDamageRolls,
     *     secondaries: [{chance, apply}], applyHit, applyMiss }
     */
    function moveSteps(spec, applyDamage) {
        var steps = [];

        // 1. Hit or miss
        var hitChance = spec.accuracy === undefined ? 1 : Math.max(0, Math.min(1, spec.accuracy / 100));
        // 2. Crit or not
        var critChance = Math.max(0, Math.min(1, spec.critChance || 0));

        steps.push(function (state) {
            var out = [];

            // A target that protected this turn blocks the whole move: no
            // damage, no secondaries, no guaranteed effects. Until now the AI
            // could click Protect and the player's damage sailed through anyway.
            var protectedTarget = state[spec.targetSide] && state[spec.targetSide].active;
            if (protectedTarget && protectedTarget.hasVolatile &&
                    protectedTarget.hasVolatile('protect')) {
                var blocked = withTag(cloneState(state), spec.side + 'Missed', 'protected');
                blocked.turnEvents = (blocked.turnEvents || []).concat(
                    'protect:' + protectedTarget.name + ' protected itself');
                return [{state: blocked, probability: 1}];
            }

            if (hitChance < 1) {
                out.push({
                    state: withTag(cloneState(state), spec.side + 'Missed', true),
                    probability: 1 - hitChance
                });
            }
            if (hitChance <= 0) return out;

            function pushRolls(rolls, probabilityScale, isCrit) {
                (rolls || []).forEach(function (roll) {
                    var next = cloneState(state);
                    applyDamage(next, spec, roll.damage, isCrit);
                    out.push({ state: next, probability: roll.probability * probabilityScale });
                });
            }

            if (critChance > 0 && spec.critDamageRolls && spec.critDamageRolls.length) {
                pushRolls(spec.critDamageRolls, hitChance * critChance, true);
                pushRolls(spec.damageRolls, hitChance * (1 - critChance), false);
            } else {
                pushRolls(spec.damageRolls, hitChance, false);
            }

            return out.length ? out : [{ state: state, probability: 1 }];
        });

        // 3. Independent secondary effects (burn chance, flinch chance, ...)
        (spec.secondaries || []).forEach(function (secondary) {
            var chance = Math.max(0, Math.min(1, secondary.chance));
            if (chance <= 0) return;
            steps.push(function (state) {
                // A secondary cannot trigger if the move missed or the target is gone
                if (state.__tags && state.__tags[spec.side + 'Missed']) {
                    return [{ state: state, probability: 1 }];
                }
                if (chance >= 1) {
                    var certain = cloneState(state);
                    secondary.apply(certain);
                    return [{ state: certain, probability: 1 }];
                }
                var triggered = cloneState(state);
                secondary.apply(triggered);
                return [
                    { state: triggered, probability: chance },
                    { state: state, probability: 1 - chance }
                ];
            });
        });

        return steps;
    }

    function cloneState(state) {
        var next = state.clone();
        next.__tags = Object.assign({}, state.__tags || {});
        next.turnEvents = (state.turnEvents || []).slice();
        return next;
    }

    /**
     * Do two outcome sets describe the same future?
     *
     * Compared on the merged state keys and their probabilities, so ordering and
     * duplicate entries do not matter. This is what keeps "nothing actually
     * changed" from becoming a branch.
     */
    function distributionsEquivalent(a, b, tolerance) {
        var eps = tolerance === undefined ? 1e-9 : tolerance;
        var left = toKeyedWeights(a);
        var right = toKeyedWeights(b);

        var keys = Object.keys(left);
        if (keys.length !== Object.keys(right).length) return false;

        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (right[k] === undefined) return false;
            if (Math.abs(left[k] - right[k]) > eps) return false;
        }
        return true;
    }

    /** Ignores turnEvents, which are commentary rather than battle state. */
    function toKeyedWeights(outcomes) {
        var out = {};
        (outcomes || []).forEach(function (o) {
            var key = stateKey(o.state).split('|').slice(1).join('|');
            out[key] = roundProb((out[key] || 0) + o.probability);
        });
        return out;
    }

    /** Combine several weighted outcome sets into one normalised set. */
    function mixWeighted(parts) {
        var out = [];
        parts.forEach(function (part) {
            (part.outcomes || []).forEach(function (o) {
                if (o.probability * part.weight > 0) {
                    out.push({state: o.state, probability: roundProb(o.probability * part.weight)});
                }
            });
        });
        return out;
    }

    /** Expand every entry of a weighted list through another weighted split. */
    function fanEach(entries, fn) {
        var out = [];
        entries.forEach(function (entry) {
            (fn(entry.state) || []).forEach(function (p) {
                if (p.probability > 0) {
                    out.push({state: p.state, probability: roundProb(entry.probability * p.probability)});
                }
            });
        });
        return out;
    }

    /**
     * Confusion self-hit: a typeless 40 BP physical hit against the confused
     * Pokemon's own Attack and Defense, ignoring the opponent entirely.
     */
    function confusionSelfDamage(mon) {
        var level = mon.level || 100;
        var atk = (mon.stats && mon.stats.atk) || 100;
        var def = (mon.stats && mon.stats.def) || 100;
        var atkStage = (mon.boosts && mon.boosts.atk) || 0;
        var defStage = (mon.boosts && mon.boosts.def) || 0;
        var stage = function (v, s) {
            return s >= 0 ? Math.floor(v * (2 + s) / 2) : Math.floor(v * 2 / (2 - s));
        };
        var base = Math.floor(
            Math.floor(Math.floor(2 * level / 5 + 2) * 40 * stage(atk, atkStage) /
                Math.max(1, stage(def, defStage))) / 50
        ) + 2;
        return Math.max(1, base);
    }

    function withTag(state, tag, value) {
        state.__tags = Object.assign({}, state.__tags || {});
        state.__tags[tag] = value;
        // Incapacitation is a qualitative event the planner must surface ("you
        // were fully paralysed here"), not just an HP difference, so it is
        // recorded on the state where stateKey and the predicates can see it.
        if (/Incapacitated$/.test(tag)) {
            state.turnEvents = (state.turnEvents || []).concat(tag.replace('Incapacitated', '') + ':' + value);
        }
        return state;
    }

    // =======================================================================
    // Whole-tree reconciliation
    // =======================================================================

    /**
     * Replay the tree from the root and rebuild every node's state
     * distribution, re-deciding at each node which branches are warranted.
     *
     * This is the "check the whole tree again" pass. Because nodes store only
     * the actions taken plus the predicate answers that identify them, a change
     * anywhere is automatically propagated: branches that stopped mattering are
     * collapsed, branches that started mattering are created, and impossible
     * paths are marked dead rather than silently kept.
     *
     * `executeTurn(state, actions)` must return an array of
     * { state, probability } — normally produced via applyTurnToState.
     */
    function reconcile(tree, executeTurn, options) {
        options = options || {};
        var maxBranchesPerNode = options.maxBranchesPerNode || 8;
        var minBranchProbability = options.minBranchProbability || 0.0005;

        var report = {
            nodesVisited: 0,
            branchesAdded: 0,
            branchesRemoved: 0,
            branchesCollapsed: 0,
            deadPaths: []
        };

        var roots = tree.getAllRoots ? tree.getAllRoots() : [tree.getRootNode()];

        roots.forEach(function (root) {
            if (!root) return;
            root.dist = root.dist || StateDist.of(root.state, 1);
            visit(root, root.dist);
        });

        function visit(node, incoming) {
            report.nodesVisited++;
            node.dist = incoming;
            // The representative state keeps the existing UI working unchanged
            node.state = representativeState(incoming) || node.state;
            node.stateSpread = summarizeDist(incoming);

            var children = (node.children || []).map(function (id) { return tree.getNode(id); })
                .filter(Boolean);
            if (!children.length) return;

            // Every child of a node shares the same actions; the children exist
            // to separate outcomes, not decisions.
            var childrenByActionKey = {};
            children.forEach(function (child) {
                var key = actionKey(child.actions);
                (childrenByActionKey[key] = childrenByActionKey[key] || []).push(child);
            });

            Object.keys(childrenByActionKey).forEach(function (key) {
                var siblings = childrenByActionKey[key];
                var actions = siblings[0].actions;

                // Re-execute the turn against the FULL inherited distribution
                var produced = incoming.flatMap(function (state, _p) {
                    return executeTurn(state, actions) || [{ state: state, probability: 1 }];
                });

                var branches = detectBranches(produced, node.extraPredicates || []);
                branches = branches.filter(function (b) { return b.probability >= minBranchProbability; });
                if (branches.length > maxBranchesPerNode) {
                    branches = coalesceBranches(branches, maxBranchesPerNode);
                    report.branchesCollapsed++;
                }

                reconcileSiblings(node, siblings, branches, actions);
            });
        }

        /** Match existing children to the branches that are now warranted. */
        function reconcileSiblings(parent, siblings, branches, actions) {
            var unmatched = siblings.slice();
            var used = [];

            // Pass 1: exact matches, so a child keeps its identity (and its own
            // subtree) across reconciliations.
            var claimed = new Array(branches.length);
            branches.forEach(function (branch, bi) {
                var branchId = branchKey(branch.answers);
                for (var i = 0; i < unmatched.length; i++) {
                    if (branchKey(unmatched[i].branchAnswers || {}) === branchId) {
                        claimed[bi] = unmatched.splice(i, 1)[0];
                        return;
                    }
                }
            });

            // Pass 2: adopt never-reconciled placeholders (a node the user just
            // created has no branchAnswers yet), then any child whose
            // distinction has stopped mattering. Reusing beats churning the
            // tree, because children carry their own subtrees.
            function adopt() {
                for (var i = 0; i < unmatched.length; i++) {
                    if (!unmatched[i].branchAnswers) return unmatched.splice(i, 1)[0];
                }
                return unmatched.length ? unmatched.shift() : null;
            }

            branches.forEach(function (branch, bi) {
                var match = claimed[bi];

                if (!match) match = adopt();

                if (!match) {
                    match = tree.addBranch(
                        parent.id,
                        representativeState(branch.dist),
                        actions,
                        new window.BattlePlanner.BattleOutcome(branch.label, branch.probability, 0, {})
                    );
                    report.branchesAdded++;
                }

                match.branchAnswers = branch.answers;
                match.outcome.description = branch.label;
                match.outcome.probability = branch.probability;
                match.isTrivialBranch = !!branch.trivial;
                used.push(match);

                visit(match, branch.dist.normalized());
            });

            // Anything left over describes an outcome that can no longer happen
            unmatched.forEach(function (orphan) {
                if (options.pruneImpossible) {
                    tree.removeNode(orphan.id);
                    report.branchesRemoved++;
                } else {
                    orphan.isImpossible = true;
                    orphan.outcome.probability = 0;
                    report.deadPaths.push(orphan.id);
                }
            });
        }

        // Percentages are checked, not assumed
        report.validation = validateTree(tree);

        return report;
    }

    /**
     * Merge the least likely branches together when a node would otherwise
     * exceed the branch budget. Merged branches keep their combined
     * distribution, so nothing is lost — a later turn can still split them.
     */
    function coalesceBranches(branches, limit) {
        var sorted = branches.slice().sort(function (a, b) { return b.probability - a.probability; });
        var kept = sorted.slice(0, limit - 1);
        var tail = sorted.slice(limit - 1);
        if (!tail.length) return kept;

        var mergedEntries = [];
        var totalProb = 0;
        tail.forEach(function (b) {
            totalProb = roundProb(totalProb + b.probability);
            mergedEntries = mergedEntries.concat(b.dist.entries);
        });

        kept.push({
            answers: { __coalesced: tail.map(function (b) { return branchKey(b.answers); }).join('|') },
            label: 'Other outcomes (' + tail.length + ')',
            probability: totalProb,
            dist: new StateDist(mergedEntries).merge(),
            coalesced: true
        });
        return kept;
    }

    function branchKey(answers) {
        return Object.keys(answers).sort().map(function (k) {
            return k + '=' + answers[k];
        }).join('&');
    }

    function actionKey(actions) {
        function one(a) {
            if (!a) return 'none';
            return [a.type, a.moveName || '', a.switchToIndex === undefined ? '' : a.switchToIndex,
                a.isCrit ? 'crit' : '', a.hits || ''].join(':');
        }
        return one(actions && actions.p1) + '#' + one(actions && actions.p2);
    }

    /** The single most likely concrete state, for rendering. */
    function representativeState(dist) {
        if (!dist || !dist.entries.length) return null;
        var best = dist.entries[0];
        dist.entries.forEach(function (e) {
            if (e.probability > best.probability) best = e;
        });
        return best.state;
    }

    /** Compact summary the UI can render without knowing about distributions. */
    function summarizeDist(dist) {
        if (!dist || !dist.entries.length) return null;
        return {
            outcomes: dist.entries.length,
            p1HP: dist.spread(function (s) { return s.p1.active ? s.p1.active.currentHP : 0; }),
            p2HP: dist.spread(function (s) { return s.p2.active ? s.p2.active.currentHP : 0; }),
            p1FaintChance: dist.entries.reduce(function (sum, e) {
                return sum + (e.state.p1.active && e.state.p1.active.currentHP <= 0 ? e.probability : 0);
            }, 0),
            p2FaintChance: dist.entries.reduce(function (sum, e) {
                return sum + (e.state.p2.active && e.state.p2.active.currentHP <= 0 ? e.probability : 0);
            }, 0),
            expectedP1HP: Math.round(dist.expected(function (s) { return s.p1.active ? s.p1.active.currentHP : 0; })),
            expectedP2HP: Math.round(dist.expected(function (s) { return s.p2.active ? s.p2.active.currentHP : 0; }))
        };
    }

    // =======================================================================
    // Relevance analysis: which past rolls still matter?
    // =======================================================================

    /**
     * Walk a path and report, for each node, whether the HP spread it carries
     * is still capable of changing anything downstream.
     *
     * This is the diagnostic behind "turn 2's second-highest roll became
     * relevant again in turn 3": a node whose spread straddles a threshold used
     * later is reported as `stillRelevant`, with the thresholds that make it so.
     */
    function analyzeRollRelevance(tree, nodeId) {
        var node = tree.getNode(nodeId);
        if (!node || !node.dist) return null;

        var thresholds = collectDownstreamThresholds(tree, node);
        var report = { nodeId: nodeId, thresholds: thresholds, straddled: [] };

        ['p1', 'p2'].forEach(function (side) {
            var spread = node.dist.spread(function (s) {
                return s[side].active ? s[side].active.currentHP : 0;
            });
            if (spread.length <= 1) return;

            var values = spread.map(function (e) { return e.value; });
            var lo = Math.min.apply(null, values);
            var hi = Math.max.apply(null, values);

            thresholds.filter(function (t) { return t.side === side; }).forEach(function (t) {
                if (lo < t.value && hi >= t.value) {
                    report.straddled.push({
                        side: side, threshold: t.value, reason: t.reason,
                        belowProbability: spread.filter(function (e) { return e.value < t.value; })
                            .reduce(function (a, e) { return a + e.probability; }, 0)
                    });
                }
            });
        });

        report.stillRelevant = report.straddled.length > 0;
        return report;
    }

    /**
     * Thresholds that any descendant of `node` is sensitive to: lethal damage,
     * berry activation points, ability activation points.
     */
    function collectDownstreamThresholds(tree, node) {
        var thresholds = [];
        var seen = {};

        function add(side, value, reason) {
            if (value === undefined || value === null || value <= 0) return;
            var key = side + ':' + value + ':' + reason;
            if (seen[key]) return;
            seen[key] = true;
            thresholds.push({ side: side, value: Math.ceil(value), reason: reason });
        }

        function walk(current) {
            if (!current) return;
            ['p1', 'p2'].forEach(function (side) {
                var mon = current.state && current.state[side] && current.state[side].active;
                if (!mon) return;

                // Surviving at all
                add(side, 1, 'survives the hit');

                // Item / ability activation points
                if (mon.item === 'Sitrus Berry' || mon.item === 'Oran Berry') {
                    add(side, Math.floor(mon.maxHP / 2) + 1, mon.item + ' activation');
                }
                if (['Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry'].indexOf(mon.item) !== -1) {
                    add(side, Math.floor(mon.maxHP / 4) + 1, mon.item + ' activation');
                }
                if (mon.item === 'Focus Sash') add(side, mon.maxHP, 'Focus Sash requires full HP');

                var ability = (mon.ability || '').replace(/\s/g, '').toLowerCase();
                if (['blaze', 'torrent', 'overgrow', 'swarm'].indexOf(ability) !== -1) {
                    add(side, Math.floor(mon.maxHP / 3) + 1, mon.ability + ' activation');
                }
                if (ability === 'berserk' || ability === 'emergencyexit' || ability === 'wimpout') {
                    add(side, Math.floor(mon.maxHP / 2) + 1, mon.ability + ' activation');
                }
                if (ability === 'sturdy') add(side, mon.maxHP, 'Sturdy requires full HP');

                // Damage the opponent's known moves can do to this side
                var foeSide = side === 'p1' ? 'p2' : 'p1';
                var foe = current.state[foeSide] && current.state[foeSide].active;
                if (foe && foe.knownMaxDamageTo) {
                    add(side, foe.knownMaxDamageTo + 1, 'surviving ' + foe.name + "'s best roll");
                }
            });

            (current.children || []).forEach(function (id) { walk(tree.getNode(id)); });
        }

        walk(node);
        return thresholds;
    }

    // =======================================================================
    // Turn executor
    // =======================================================================

    /**
     * Build the `executeTurn(state, actions)` function that reconcile() drives.
     *
     * Dependencies are injected so this stays testable without the DOM:
     *   { calc, CalcIntegration, MoveDB, Logic, gen, getField }
     *
     * The executor turns one turn into a weighted set of resulting states by
     * composing every independent source of variance:
     *   accuracy -> crit -> damage roll -> secondary effects -> end of turn
     */
    function createTurnExecutor(deps) {
        var calc = deps.calc;
        var CI = deps.CalcIntegration;
        var MoveDB = deps.MoveDB;
        var Logic = deps.Logic;
        var genNum = deps.gen || 8;

        function moveSpecFor(state, side, action) {
            var attackerSnap = state[side].active;
            var defenderSide = side === 'p1' ? 'p2' : 'p1';
            var defenderSnap = state[defenderSide].active;
            if (!attackerSnap || !defenderSnap || !action || action.type !== 'move') return null;

            var entry = MoveDB ? MoveDB.get(action.moveName) : null;
            var attacker = CI.snapshotToPokemon(attackerSnap, genNum);
            var defender = CI.snapshotToPokemon(defenderSnap, genNum);
            if (!attacker || !defender) return null;

            var field = deps.getField ? deps.getField(state) : new calc.Field();

            var moveOptions = {isCrit: false};
            if (entry && entry.effects && entry.effects.multihit) {
                var mh = entry.effects.multihit;
                moveOptions.hits = Array.isArray(mh)
                    ? (action.hits && action.hits > 0 ? action.hits : mh[1])
                    : mh;
            }

            var move = new calc.Move(genNum, action.moveName, moveOptions);
            var critMove = new calc.Move(genNum, action.moveName,
                Object.assign({}, moveOptions, {isCrit: true}));

            var result = calc.calculate(genNum, attacker, defender, move, field);
            var critResult = calc.calculate(genNum, attacker, defender, critMove, field);

            var accuracy = CI.getAccuracy(
                entry || {name: action.moveName}, attackerSnap, defenderSnap, field, genNum);
            var critChance = action.isCrit
                ? 1
                : CI.getCritChance(move, attackerSnap, defenderSnap, field, genNum);

            // A target that is immune (by type OR by an ability such as
            // Levitate / Volt Absorb) is not touched at all: no damage, no
            // secondary, nothing. Without this, Thunder Punch happily rolled
            // its 10% paralysis against a Ground type.
            var immune = false;
            if (entry && entry.category !== 'Status') {
                immune = CI.getTypeEffectiveness(
                    entry.type, defenderSnap.types || [], defenderSnap) === 0;
            }

            return {
                side: side,
                targetSide: defenderSide,
                accuracy: accuracy,
                critChance: immune ? 0 : critChance,
                damageRolls: immune
                    ? [{damage: 0, probability: 1}]
                    : CI.getDamageRolls(result, moveOptions.hits),
                critDamageRolls: immune
                    ? [{damage: 0, probability: 1}]
                    : CI.getDamageRolls(critResult, moveOptions.hits),
                secondaries: immune
                    ? []
                    : secondariesFor(entry, side, defenderSide, attackerSnap, defenderSnap),
                entry: entry,
                immune: immune,
                sheerForce: hasAbility(attackerSnap, 'sheerforce') && hasSecondaries(entry)
            };
        }

        function hasAbility(mon, normalized) {
            return !!mon && String(mon.ability || '').replace(/[\s-]/g, '').toLowerCase() === normalized;
        }

        function hasSecondaries(entry) {
            return !!(entry && entry.effects && entry.effects.secondaries &&
                entry.effects.secondaries.length);
        }

        /**
         * Every independent chance-based rider on the move, after the abilities
         * and items that suppress, add to or reweight them.
         *
         *   Sheer Force   - removes ALL secondaries (the engine has already paid
         *                   the +30% base power for them, so applying the effect
         *                   as well was double-dipping)
         *   Shield Dust   - blocks secondaries that target the defender
         *   Covert Cloak  - same, as a held item
         *   Serene Grace  - doubles every secondary's chance
         *   King's Rock / Razor Fang - adds a 10% flinch to moves without one
         *   Poison Touch  - adds a 30% poison chance to contact moves
         *
         * Mold Breaker and friends ignore Shield Dust (but not Covert Cloak).
         */
        function secondariesFor(entry, side, defenderSide, attackerSnap, defenderSnap) {
            if (!entry || !entry.effects) return [];

            // Sheer Force trades the secondary away for the power boost
            if (hasAbility(attackerSnap, 'sheerforce') && hasSecondaries(entry)) return [];

            var moldBreaker = hasAbility(attackerSnap, 'moldbreaker') ||
                hasAbility(attackerSnap, 'turboblaze') || hasAbility(attackerSnap, 'teravolt');
            var shieldDust = hasAbility(defenderSnap, 'shielddust') && !moldBreaker;
            var covertCloak = !!defenderSnap && defenderSnap.item === 'Covert Cloak';
            var defenderProtected = shieldDust || covertCloak;
            var sereneGrace = hasAbility(attackerSnap, 'serenegrace');

            var out = [];

            entry.effects.secondaries.forEach(function (sec) {
                var targetsDefender = !!(sec.status || sec.volatileStatus || sec.targetBoosts);
                var targetsSelf = !!(sec.selfBoosts || sec.selfStatus || sec.selfVolatile);

                // Shield Dust / Covert Cloak only stop what would hit the target
                if (defenderProtected && targetsDefender && !targetsSelf) return;

                var chance = (sec.chance === undefined ? 100 : sec.chance) / 100;
                if (sereneGrace) chance = Math.min(1, chance * 2);
                if (chance <= 0) return;

                out.push({
                    chance: chance,
                    apply: function (state) {
                        var target = state[defenderSide].active;
                        var self = state[side].active;
                        var ctx = {
                            attackerAbility: self ? self.ability : '',
                            field: state.field,
                            sideState: state.sides ? state.sides[defenderSide] : null
                        };
                        if (!defenderProtected && target) {
                            if (sec.status) target.inflictStatus(sec.status, undefined, ctx);
                            if (sec.volatileStatus) applyVolatile(target, sec.volatileStatus);
                            if (sec.targetBoosts) {
                                for (var s in sec.targetBoosts) target.applyBoost(s, sec.targetBoosts[s]);
                            }
                        }
                        if (self) {
                            if (sec.selfBoosts) {
                                for (var t in sec.selfBoosts) self.applyBoost(t, sec.selfBoosts[t]);
                            }
                            if (sec.selfStatus) self.inflictStatus(sec.selfStatus, undefined, {
                                field: state.field,
                                sideState: state.sides ? state.sides[side] : null
                            });
                            if (sec.selfVolatile) applyVolatile(self, sec.selfVolatile);
                        }
                    }
                });
            });

            // King's Rock / Razor Fang add a flinch chance to moves that lack one
            var flinchItem = attackerSnap &&
                (attackerSnap.item === "King's Rock" || attackerSnap.item === 'Razor Fang');
            var alreadyFlinches = entry.effects.secondaries.some(function (s) {
                return s.volatileStatus === 'flinch';
            });
            if (flinchItem && !alreadyFlinches && !defenderProtected && entry.category !== 'Status') {
                out.push({
                    chance: sereneGrace ? 0.2 : 0.1,
                    apply: function (state) {
                        applyVolatile(state[defenderSide].active, 'flinch');
                    }
                });
            }

            // Poison Touch: 30% poison on a contact move
            if (hasAbility(attackerSnap, 'poisontouch') && entry.flags && entry.flags.contact &&
                !defenderProtected) {
                out.push({
                    chance: sereneGrace ? 0.6 : 0.3,
                    apply: function (state) {
                        var target = state[defenderSide].active;
                        var self = state[side].active;
                        if (target) {
                            target.inflictStatus('psn', undefined, {
                                attackerAbility: self ? self.ability : '',
                                field: state.field,
                                sideState: state.sides ? state.sides[defenderSide] : null
                            });
                        }
                    }
                });
            }

            return out;
        }

        function applyVolatile(mon, name) {
            if (!mon) return;
            // inflictVolatile honours Persim/Lum for confusion
            mon.inflictVolatile(name, true);
        }

        /**
         * Deterministic on-hit riders: guaranteed stat changes, drain, recoil.
         * These do not branch — they either happen (the move connected) or they
         * do not (it missed).
         */
        // Moves that rewrite the target's typing
        var TYPE_CHANGE_MOVES = {
            'Soak': {set: ['Water']},
            'Magic Powder': {set: ['Psychic']},
            "Forest's Curse": {add: 'Grass'},
            'Trick-or-Treat': {add: 'Ghost'}
        };

        var SIDE_HAZARDS = {
            stealthrock: 'stealthRock', spikes: 'spikes',
            toxicspikes: 'toxicSpikes', stickyweb: 'stickyWeb'
        };
        var SIDE_SCREENS = {
            reflect: 'reflect', lightscreen: 'lightScreen', auroraveil: 'auroraVeil'
        };
        var WEATHER_IDS = {
            raindance: 'Rain', sunnyday: 'Sun', sandstorm: 'Sand',
            hail: 'Hail', snow: 'Snow'
        };
        var TERRAIN_IDS = {
            electricterrain: 'Electric', grassyterrain: 'Grassy',
            mistyterrain: 'Misty', psychicterrain: 'Psychic'
        };

        function applySideCondition(state, spec, sc) {
            var id = String(sc).toLowerCase();
            var sides = state.sides || {};
            if (SIDE_HAZARDS[id]) {
                // Hazards land on the TARGET's side of the field
                var theirs = sides[spec.targetSide];
                if (!theirs) return;
                if (id === 'spikes') theirs.spikes = Math.min(3, (theirs.spikes || 0) + 1);
                else if (id === 'toxicspikes') theirs.toxicSpikes = Math.min(2, (theirs.toxicSpikes || 0) + 1);
                else theirs[SIDE_HAZARDS[id]] = true;
                return;
            }
            var mine = sides[spec.side];
            if (!mine) return;
            if (SIDE_SCREENS[id]) {
                mine[SIDE_SCREENS[id]] = true;
                mine[SIDE_SCREENS[id] + 'Turns'] = 5;
            } else if (id === 'tailwind') {
                mine.tailwind = true;
                mine.tailwindTurns = 4;
            } else if (id === 'safeguard') {
                mine.safeguard = true;
            } else if (id === 'mist') {
                mine.mist = true;
            }
        }

        /**
         * Everything a connecting move deterministically does besides its
         * damage. Chance-based riders live in secondariesFor; this step is the
         * certain part — and for a status move it IS the move.
         */
        function guaranteedEffectsStep(spec) {
            return function (state) {
                var entry = spec.entry;
                if (!entry || !entry.effects) return [{state: state, probability: 1}];
                if (state.__tags && state.__tags[spec.side + 'Missed']) {
                    return [{state: state, probability: 1}];
                }
                // An immune target is simply not affected
                if (spec.immune) return [{state: state, probability: 1}];

                var fx = entry.effects;
                var isStatus = entry.category === 'Status';
                var hasWork = fx.selfBoosts || fx.targetBoosts || fx.recoil || fx.drain ||
                    (isStatus && (fx.status || fx.heal || fx.sideCondition || fx.weather ||
                        fx.terrain || fx.volatileStatus || fx.selfStatus || fx.selfVolatile)) ||
                    entry.name === 'Rest' || entry.name === 'Defend Order' ||
                    TYPE_CHANGE_MOVES[entry.name];
                if (!hasWork) return [{state: state, probability: 1}];

                var next = cloneState(state);
                var self = next[spec.side].active;
                var target = next[spec.targetSide].active;
                var dealt = state.__lastDamage || 0;
                var targetCtx = {
                    attackerAbility: self ? self.ability : '',
                    field: next.field,
                    sideState: next.sides ? next.sides[spec.targetSide] : null
                };

                if (fx.selfBoosts && self) {
                    for (var s in fx.selfBoosts) self.applyBoost(s, fx.selfBoosts[s]);
                }
                // Growl, Screech, Icy-Wind-style drops: applies for EVERY
                // category. The old exclusion of Status moves made Growl a no-op.
                if (fx.targetBoosts && target) {
                    for (var t in fx.targetBoosts) target.applyBoost(t, fx.targetBoosts[t]);
                }
                if (fx.recoil && self && dealt > 0) {
                    self.applyDamage(Math.max(1,
                        Math.floor(dealt * fx.recoil.numerator / fx.recoil.denominator)));
                }
                if (fx.drain && self && dealt > 0) {
                    self.applyHealing(Math.max(1,
                        Math.floor(dealt * fx.drain.numerator / fx.drain.denominator)));
                }

                if (isStatus) {
                    // Thunder Wave is the one status move stopped by type
                    // immunity: an Electric-immune target shrugs it off entirely.
                    var thunderWaveBlocked = entry.name === 'Thunder Wave' && target &&
                        CI.getTypeEffectiveness('Electric', target.types || [], target) === 0;

                    if (fx.status && target && !thunderWaveBlocked) {
                        // inflictStatus enforces type/ability immunity, terrain,
                        // Safeguard and curing berries
                        target.inflictStatus(fx.status, undefined, targetCtx);
                    }
                    if (fx.selfStatus && self) {
                        self.inflictStatus(fx.selfStatus, undefined, {
                            field: next.field,
                            sideState: next.sides ? next.sides[spec.side] : null
                        });
                    }
                    if (fx.volatileStatus && target) {
                        // Grass types are immune to Leech Seed
                        var seedBlocked = fx.volatileStatus === 'leechseed' &&
                            (target.types || []).indexOf('Grass') !== -1;
                        if (!seedBlocked) applyVolatile(target, fx.volatileStatus);
                    }
                    // Protect, Detect, Aqua Ring, Ingrain, Focus Energy: the
                    // volatile lands on the USER. A CONSECUTIVE Protect fails —
                    // modelled as always failing (the real game gives 1/3); the
                    // AI never clicks it twice in a row anyway, see the AI
                    // policy filter in the projection.
                    if (fx.selfVolatile && self) {
                        if (fx.selfVolatile === 'protect' &&
                                self.hasVolatile && self.hasVolatile('protectused')) {
                            next.turnEvents = (next.turnEvents || []).concat(
                                "protect:" + self.name + "'s Protect failed (consecutive use)");
                        } else {
                            applyVolatile(self, fx.selfVolatile);
                        }
                    }
                    // RnB: "Defend Order: Functions like Protect."
                    if (entry.name === 'Defend Order' && self) {
                        if (self.hasVolatile && self.hasVolatile('protectused')) {
                            next.turnEvents = (next.turnEvents || []).concat(
                                "protect:" + self.name + "'s Defend Order failed (consecutive use)");
                        } else {
                            self.setVolatile('protect', true);
                        }
                    }
                    // Type-changing moves. The AI clicks Soak to strip a Steel
                    // type's poison immunity when nothing else works — from
                    // that point every immunity check and damage calc must see
                    // the NEW typing.
                    var typeChange = TYPE_CHANGE_MOVES[entry.name];
                    if (typeChange && target) {
                        var beforeTypes = (target.types || []).join('/');
                        if (typeChange.set) {
                            target.types = typeChange.set.slice();
                        } else if (typeChange.add &&
                                (target.types || []).indexOf(typeChange.add) === -1) {
                            target.types = (target.types || []).concat(typeChange.add);
                        }
                        next.turnEvents = (next.turnEvents || []).concat(
                            'type:' + target.name + ' became ' +
                            (target.types || []).join('/') +
                            ' (was ' + beforeTypes + ')');
                    }
                    if (fx.heal && self) {
                        self.applyHealing(Math.max(1,
                            Math.floor(self.maxHP * fx.heal.numerator / fx.heal.denominator)));
                    }
                    if (entry.name === 'Rest' && self) {
                        // Rest overwrites any existing status by design
                        self.currentHP = self.maxHP;
                        self.setStatus('slp');
                        self.sleepCounter = 0;
                    }
                    if (fx.sideCondition) applySideCondition(next, spec, fx.sideCondition);
                    if (fx.weather && next.field) {
                        next.field.weather = WEATHER_IDS[String(fx.weather).toLowerCase()] || fx.weather;
                        next.field.weatherTurns = 5;
                    }
                    if (fx.terrain && next.field) {
                        next.field.terrain = TERRAIN_IDS[String(fx.terrain).toLowerCase()] || fx.terrain;
                        next.field.terrainTurns = 5;
                    }
                }

                return [{state: next, probability: 1}];
            };
        }

        /**
         * Focus Band: a 10% chance to survive a lethal hit at 1 HP. Unlike Focus
         * Sash it is a roll, so it genuinely forks the battle and must branch.
         */
        function focusBandStep(spec) {
            return function (state) {
                var target = state[spec.targetSide].active;
                if (!target || target.item !== 'Focus Band' || target.currentHP > 0) {
                    return [{state: state, probability: 1}];
                }
                var held = cloneState(state);
                var survivor = held[spec.targetSide].active;
                survivor.currentHP = 1;
                survivor.hasFainted = false;
                held.turnEvents = (held.turnEvents || []).concat('focusBand:held on');
                return [
                    {state: held, probability: 0.1},
                    {state: state, probability: 0.9}
                ];
            };
        }

        /** Damage application, including HP-threshold item and ability triggers. */
        function applyDamage(state, spec, amount) {
            var target = state[spec.targetSide].active;
            if (!target) return;

            // RnB: "Disguise: No damage taken as the Disguise is broken." The
            // damage engine has no notion of Disguise at all, so without this a
            // Mimikyu's free turn simply vanished from the plan. Vanilla gen 8
            // also chips 1/8 max HP on the break; the docs remove that.
            var targetAbility = String(target.ability || '').replace(/\s|-/g, '').toLowerCase();
            if (amount > 0 && targetAbility === 'disguise' && !target.hasVolatile('disguiseBroken')) {
                target.setVolatile('disguiseBroken', true);
                state.turnEvents = (state.turnEvents || []).concat('item:Disguise absorbed the hit');
                state.__lastDamage = 0;
                return;
            }

            var before = target.currentHP;
            var itemFx = CI.applyItemEffects(target, amount);
            target.applyDamage(amount);
            if (itemFx.healed > 0 && (target.currentHP > 0 || itemFx.survivesAtOneHP)) {
                target.applyHealing(itemFx.healed);
            }
            if (itemFx.itemConsumed) target.item = '';
            // Recorded so recoil/drain can be sized off the damage actually dealt
            state.__lastDamage = Math.max(0, before - target.currentHP);
        }

        /**
         * Conditions that can stop a Pokemon acting at all, each of which is a
         * genuine fork in the battle rather than a damage-roll nuance.
         *
         *   flinch     - certain, if the volatile is set (it was rolled last turn)
         *   paralysis  - 25% full paralysis
         *   confusion  - 33% self-hit for typeless 40 BP physical damage
         *   freeze     - 20% thaw per turn, otherwise cannot move
         *   sleep      - cannot move until the counter runs out
         *
         * Each returns weighted states; a certainty produces one entry and so
         * never creates a branch.
         */
        function incapacitationStep(side) {
            return function (state) {
                var mon = state[side].active;
                if (!mon || mon.currentHP <= 0) return [{state: state, probability: 1}];

                var statusCode = window.BattlePlanner.normalizeStatusCode(mon.status);

                // Flinch: already decided, just consume it
                if (mon.hasVolatile('flinch')) {
                    var flinched = cloneState(state);
                    flinched[side].active.setVolatile('flinch', false);
                    return [{state: withTag(flinched, side + 'Incapacitated', 'flinch'), probability: 1}];
                }

                // Freeze: 20% thaw, otherwise frozen solid
                if (statusCode === 'frz') {
                    var thawed = cloneState(state);
                    thawed[side].active.setStatus('Healthy');
                    var stillFrozen = withTag(cloneState(state), side + 'Incapacitated', 'frozen');
                    return [
                        {state: thawed, probability: 0.2},
                        {state: stillFrozen, probability: 0.8}
                    ];
                }

                // Sleep: wakes when the counter expires
                if (statusCode === 'slp') {
                    var asleep = cloneState(state);
                    var sleeper = asleep[side].active;
                    sleeper.sleepCounter = (sleeper.sleepCounter || 0) + 1;
                    if (sleeper.sleepCounter >= 3) {
                        sleeper.setStatus('Healthy');
                        return [{state: asleep, probability: 1}];
                    }
                    return [{state: withTag(asleep, side + 'Incapacitated', 'asleep'), probability: 1}];
                }

                var branches = [{state: state, probability: 1}];

                // Paralysis: 25% chance of not moving
                if (statusCode === 'par') {
                    branches = fanEach(branches, function (s) {
                        return [
                            {state: withTag(cloneState(s), side + 'Incapacitated', 'paralysed'), probability: 0.25},
                            {state: s, probability: 0.75}
                        ];
                    });
                }

                // Confusion: 33% self-hit, and the counter ticks down either way
                if (mon.hasVolatile('confusion')) {
                    branches = fanEach(branches, function (s) {
                        var target = s[side].active;
                        // The counter lives inside `volatiles` so it survives
                        // clone() — a plain property on the snapshot would be
                        // dropped on the next turn.
                        var turnsSoFar = Number(target.volatiles.confusion) || 1;

                        function tick(next) {
                            var m = next[side].active;
                            // Confusion lasts 2-5 turns; 4 is the average
                            if (turnsSoFar >= 4) {
                                m.setVolatile('confusion', false);
                            } else {
                                m.setVolatile('confusion', turnsSoFar + 1);
                            }
                            return next;
                        }

                        var selfHit = tick(cloneState(s));
                        var hurt = selfHit[side].active;
                        hurt.applyDamage(confusionSelfDamage(hurt));
                        withTag(selfHit, side + 'Incapacitated', 'confusion');

                        return [
                            {state: selfHit, probability: 1 / 3},
                            {state: tick(cloneState(s)), probability: 2 / 3}
                        ];
                    });
                }

                return branches;
            };
        }

        /**
         * Move priority, from RBDex when the caller has not supplied it.
         *
         * turnOrder only reads `action.priority`, so without this a Quick Attack
         * or Sucker Punch entered from the UI would be ordered purely on Speed.
         */
        var PROTECT_LIKE = ['Protect', 'Detect', 'Defend Order'];

        function withPriority(action) {
            if (!action || action.type !== 'move') return action;
            if (typeof action.priority === 'number') return action;
            var entry = MoveDB ? MoveDB.get(action.moveName) : null;
            var priority = (entry && entry.priority) || 0;
            // RnB: "Defend Order: Functions like Protect" — including its +4
            // priority, which the data file does not carry.
            if (PROTECT_LIKE.indexOf(action.moveName) !== -1 && priority < 4) {
                priority = 4;
            }
            return Object.assign({}, action, {priority: priority});
        }

        /**
         * Expand an action that represents a CHOICE rather than a decision.
         *
         * When the AI has several moves it is equally likely to pick, that is a
         * real fork: each candidate plays out differently and the user needs to
         * see all of them with honest weights. An action carrying `candidates`
         * (from the AI distribution) is expanded into one weighted sub-turn per
         * candidate.
         */
        function expandChoices(state, actions, run) {
            var sides = ['p1', 'p2'];
            for (var i = 0; i < sides.length; i++) {
                var side = sides[i];
                var action = actions[side];
                var candidates = action && action.candidates;
                if (!candidates || candidates.length <= 1) continue;

                var total = candidates.reduce(function (a, c) { return a + (c.probability || 0); }, 0);
                if (total <= 0) continue;

                var parts = candidates.filter(function (c) { return c.probability > 0; })
                    .map(function (candidate) {
                        var chosen = {};
                        chosen[side] = Object.assign({}, action, {
                            moveName: candidate.moveName,
                            candidates: null,
                            priority: undefined
                        });
                        chosen[side === 'p1' ? 'p2' : 'p1'] = actions[side === 'p1' ? 'p2' : 'p1'];

                        // Tag AFTER the sub-turn: the recursive call clears
                        // turnEvents at its start, so tagging first would wipe it.
                        var produced = run(cloneState(state), chosen).map(function (o) {
                            var tagged = cloneState(o.state);
                            tagged.turnEvents = (o.state.turnEvents || [])
                                .concat('aiChoice:' + side + ' used ' + candidate.moveName);
                            return {state: tagged, probability: o.probability};
                        });

                        return {outcomes: produced, weight: candidate.probability / total};
                    });

                return mixWeighted(parts);
            }
            return null;
        }

        function executeTurn(startState, rawActions) {
            // Events describe THIS turn only; clear whatever the last turn left
            // before anything records into it.
            var state = cloneState(startState);
            state.turnEvents = [];
            // __tags are per-turn bookkeeping (missed, incapacitated, ...).
            // They used to survive into the next turn, where a stale 'Missed'
            // tag silently suppressed that turn's effects.
            state.__tags = {};

            // A choice (tied AI moves) expands into one weighted sub-turn each
            var expanded = expandChoices(state, rawActions || {}, executeTurn);
            if (expanded) return expanded;

            var actions = {
                p1: withPriority(rawActions && rawActions.p1),
                p2: withPriority(rawActions && rawActions.p2)
            };

            // A speed tie is only worth a branch if the two orderings actually
            // lead somewhere different. Running the same pair of moves in either
            // order usually converges on the identical distribution, and forking
            // there would litter the tree with branches that change nothing.
            if (isSpeedTie(state, actions)) {
                var p1First = runTurn(cloneState(state), actions, ['p1', 'p2']);
                var p2First = runTurn(cloneState(state), actions, ['p2', 'p1']);

                if (distributionsEquivalent(p1First, p2First)) {
                    return p1First;
                }

                return mixWeighted([
                    {outcomes: tagOrder(p1First, 'you won the speed tie'), weight: 0.5},
                    {outcomes: tagOrder(p2First, 'the opponent won the speed tie'), weight: 0.5}
                ]);
            }

            return runTurn(state, actions, turnOrder(state, actions));
        }

        /** Label an outcome set with which side won the tie, for the branch name. */
        function tagOrder(outcomes, note) {
            return outcomes.map(function (o) {
                var tagged = cloneState(o.state);
                tagged.turnEvents = (o.state.turnEvents || []).concat('speedTie:' + note);
                return {state: tagged, probability: o.probability};
            });
        }

        function runTurn(state, actions, order) {
            var steps = [];

            // Switches resolve before any move, in slot order, and are certain —
            // they never branch. Handling them here keeps a replay of the tree
            // faithful to what the user actually planned.
            ['p1', 'p2'].forEach(function (side) {
                var action = actions[side];
                if (!action || action.type !== 'switch') return;
                steps.push(function (current) {
                    var next = cloneState(current);
                    var slot = action.switchToIndex !== undefined
                        ? action.switchToIndex : action.targetSlot;
                    if (Logic && typeof Logic.performSwitch === 'function') {
                        Logic.performSwitch(next, side, slot);
                    } else if (next[side].team && next[side].team[slot]) {
                        next[side].teamSlot = slot;
                        next[side].active = next[side].team[slot].clone();
                    }
                    next.turnEvents = (next.turnEvents || [])
                        .concat('switch:' + side + ' brought in ' +
                            (next[side].active ? next[side].active.name : 'a Pokemon'));
                    return [{state: next, probability: 1}];
                });
            });

            order.forEach(function (side) {
                var action = actions[side];
                if (!action || action.type === 'switch') return;

                // Can this Pokemon act at all?
                steps.push(incapacitationStep(side));

                steps.push(function (current) {
                    // A fainted or incapacitated attacker does nothing
                    var attacker = current[side].active;
                    if (!attacker || attacker.currentHP <= 0) {
                        return [{state: current, probability: 1}];
                    }
                    if (current.__tags && current.__tags[side + 'Incapacitated']) {
                        return [{state: current, probability: 1}];
                    }
                    var spec = moveSpecFor(current, side, action);
                    if (!spec) return [{state: current, probability: 1}];

                    var moveStepFns = moveSteps(spec, applyDamage);
                    // Focus Band is a 10% survival roll, so it is its own fork
                    moveStepFns.push(focusBandStep(spec));
                    // Guaranteed riders (Close Combat's Def/SpD drop, Overheat's
                    // SpA drop, Superpower, ...) are not secondaries: they always
                    // happen on a connecting hit and so never branch.
                    moveStepFns.push(guaranteedEffectsStep(spec));
                    var produced = applyTurnToState(current, {steps: moveStepFns});
                    return produced.length ? produced : [{state: current, probability: 1}];
                });
            });

            // End-of-turn residuals, once per resulting state
            steps.push(function (current) {
                var next = cloneState(current);
                if (Logic) Logic.applyEndOfTurnEffects(next, genNum);
                // Protection lasts exactly the turn it was used — but the
                // game REMEMBERS it for one more turn: a consecutive Protect
                // fails and the AI won't click it again.
                ['p1', 'p2'].forEach(function (sd) {
                    var active = next[sd] && next[sd].active;
                    if (active && active.setVolatile) {
                        var protectedThisTurn = active.hasVolatile &&
                            active.hasVolatile('protect');
                        active.setVolatile('protect', false);
                        active.setVolatile('protectused', !!protectedThisTurn);
                    }
                });
                next.turnNumber = (current.turnNumber || 0) + 1;
                return [{state: next, probability: 1}];
            });

            return applyTurnToState(state, {steps: steps});
        }

        return executeTurn;
    }

    /**
     * True when both sides act, share a priority bracket and have identical
     * Speed — a genuine 50/50 that can decide who faints.
     */
    function isSpeedTie(state, actions) {
        var p1 = actions && actions.p1;
        var p2 = actions && actions.p2;
        if (!p1 || !p2) return false;
        if ((p1.priority || 0) !== (p2.priority || 0)) return false;

        var sides = state.sides || {};
        var p1Speed = state.p1.active ? state.p1.active.getEffectiveSpeed(sides.p1) : 0;
        var p2Speed = state.p2.active ? state.p2.active.getEffectiveSpeed(sides.p2) : 0;
        return p1Speed === p2Speed && p1Speed > 0;
    }

    /** Who acts first, by priority then Speed (respecting Trick Room). */
    function turnOrder(state, actions) {
        var p1 = actions && actions.p1;
        var p2 = actions && actions.p2;
        if (!p1) return ['p2'];
        if (!p2) return ['p1'];

        var p1Priority = (p1.priority || 0);
        var p2Priority = (p2.priority || 0);
        if (p1Priority !== p2Priority) return p1Priority > p2Priority ? ['p1', 'p2'] : ['p2', 'p1'];

        var sides = state.sides || {};
        var p1Speed = state.p1.active ? state.p1.active.getEffectiveSpeed(sides.p1) : 0;
        var p2Speed = state.p2.active ? state.p2.active.getEffectiveSpeed(sides.p2) : 0;
        var trickRoom = state.field && state.field.trickRoom;

        if (p1Speed === p2Speed) return ['p1', 'p2'];
        var p1First = trickRoom ? p1Speed < p2Speed : p1Speed > p2Speed;
        return p1First ? ['p1', 'p2'] : ['p2', 'p1'];
    }

    // =======================================================================
    // Team roster: team building lives OUTSIDE the branch tree
    // =======================================================================

    /**
     * Which Pokemon a side has actually committed to in the tree.
     *
     * Team building and battle planning are separate activities: you edit the
     * squad while you plan, and swapping a Pokemon you have not used yet must
     * not invalidate the tree. Storing the roster inside every node made the
     * two inseparable — editing the team meant editing state history.
     *
     * A Pokemon counts as "used" once it has been the active Pokemon at any
     * node other than the root, or once its battle state has diverged from the
     * roster entry (damaged, statused, boosted, item consumed).
     */
    function getUsedPokemon(tree, side) {
        var used = {};

        (tree.getAllRoots ? tree.getAllRoots() : [tree.getRootNode()]).forEach(function (root) {
            if (!root) return;
            (function walk(node, isRoot) {
                if (!node) return;
                var active = node.state && node.state[side] && node.state[side].active;
                if (active && !isRoot) used[active.name] = true;

                // Even at the root, a Pokemon that has been touched is committed
                if (active && isRoot && pokemonHasActed(active)) used[active.name] = true;

                (node.children || []).forEach(function (id) { walk(tree.getNode(id), false); });
            })(root, true);
        });

        return Object.keys(used);
    }

    function pokemonHasActed(mon) {
        if (!mon) return false;
        if (mon.currentHP < mon.maxHP) return true;
        if (mon.status && mon.status !== 'Healthy') return true;
        if (mon.volatiles && Object.keys(mon.volatiles).some(function (k) { return mon.volatiles[k]; })) return true;
        var b = mon.boosts || {};
        return ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'].some(function (s) {
            return b[s];
        });
    }

    /**
     * Can this roster slot still be changed?
     * Only Pokemon that have not featured anywhere in the tree may be swapped.
     */
    function canEditRosterSlot(tree, side, pokemonName) {
        return getUsedPokemon(tree, side).indexOf(pokemonName) === -1;
    }

    /**
     * Replace the roster for a side and re-project it into the tree.
     *
     * Returns { applied, rejected } — rejected entries name Pokemon that are
     * already committed to the plan and therefore cannot be swapped out.
     * Only the untouched slots are rewritten, so the branch structure and every
     * probability survive a team edit untouched.
     */
    function updateRoster(tree, side, newRoster, executeTurn, options) {
        var used = getUsedPokemon(tree, side);
        var applied = [];
        var rejected = [];

        var current = rosterOf(tree, side);
        var byName = {};
        current.forEach(function (p) { byName[p.name] = p; });

        // A used Pokemon must still be present, in the same slot it occupies now
        used.forEach(function (name) {
            var stillThere = newRoster.some(function (p) { return p.name === name; });
            if (!stillThere) rejected.push({name: name, reason: 'already used in the plan'});
        });

        if (rejected.length && !(options && options.force)) {
            return {applied: [], rejected: rejected, roster: current};
        }

        var resolved = newRoster.map(function (entry) {
            // Keep the live battle state of anything already committed
            if (used.indexOf(entry.name) !== -1 && byName[entry.name]) return byName[entry.name];
            applied.push(entry.name);
            return entry;
        });

        setRoster(tree, side, resolved);
        projectRosterIntoTree(tree, side);

        var report = executeTurn ? reconcile(tree, executeTurn, options || {}) : null;
        return {applied: applied, rejected: rejected, roster: resolved, reconcile: report};
    }

    function rosterOf(tree, side) {
        if (!tree.roster) tree.roster = {};
        if (!tree.roster[side]) {
            var root = tree.getRootNode();
            tree.roster[side] = root && root.state && root.state[side]
                ? (root.state[side].team || []).map(function (p) { return p.clone(); })
                : [];
        }
        return tree.roster[side];
    }

    function setRoster(tree, side, roster) {
        if (!tree.roster) tree.roster = {};
        tree.roster[side] = roster.map(function (p) {
            return typeof p.clone === 'function' ? p.clone() : p;
        });
    }

    /**
     * Push roster changes down into every node, preserving battle state for
     * Pokemon that are already in play.
     */
    function projectRosterIntoTree(tree, side) {
        var roster = rosterOf(tree, side);

        Object.keys(tree.nodes).forEach(function (id) {
            var node = tree.nodes[id];
            if (!node.state || !node.state[side]) return;

            var sideState = node.state[side];
            var activeName = sideState.active && sideState.active.name;

            sideState.team = roster.map(function (entry, index) {
                // The Pokemon currently out keeps its live battle state
                if (activeName && entry.name === activeName && sideState.teamSlot === index) {
                    return sideState.active.clone();
                }
                var existing = (sideState.team || []).find(function (p) {
                    return p && p.name === entry.name;
                });
                return existing && pokemonHasActed(existing) ? existing : entry.clone();
            });

            // Keep teamSlot pointing at the active Pokemon after a reorder
            if (activeName) {
                var slot = sideState.team.findIndex(function (p) { return p && p.name === activeName; });
                if (slot !== -1) sideState.teamSlot = slot;
            }
        });
    }

    // =======================================================================
    // Probability invariants
    // =======================================================================

    /**
     * Every percentage the planner shows has to be defensible, so the
     * invariants are checked rather than assumed:
     *
     *   1. every node's children sum to exactly 1 (they partition the parent)
     *   2. no probability is negative, NaN or greater than 1
     *   3. a node's state distribution sums to 1
     *   4. cumulative path probability equals the product down the path, and the
     *      leaves of the whole tree sum to 1
     *
     * reconcile() runs this automatically and attaches the result, so a
     * regression surfaces as a reported violation instead of a wrong number on
     * screen.
     */
    function validateTree(tree, tolerance) {
        var eps = tolerance === undefined ? 1e-6 : tolerance;
        var violations = [];

        function badNumber(p) {
            return typeof p !== 'number' || isNaN(p) || p < -eps || p > 1 + eps;
        }

        Object.keys(tree.nodes).forEach(function (id) {
            var node = tree.nodes[id];
            var children = (node.children || []).map(function (cid) { return tree.getNode(cid); })
                .filter(Boolean);

            if (node.outcome && badNumber(node.outcome.probability)) {
                violations.push({
                    nodeId: id, kind: 'probabilityOutOfRange',
                    value: node.outcome && node.outcome.probability
                });
            }

            if (children.length) {
                var sum = children.reduce(function (a, c) {
                    return a + ((c.outcome && c.outcome.probability) || 0);
                }, 0);
                if (Math.abs(sum - 1) > eps) {
                    violations.push({
                        nodeId: id, kind: 'childrenDoNotSumToOne',
                        sum: sum, childCount: children.length
                    });
                }
            }

            if (node.dist) {
                var distTotal = node.dist.totalProbability();
                if (Math.abs(distTotal - 1) > eps) {
                    violations.push({nodeId: id, kind: 'distributionNotNormalised', sum: distTotal});
                }
            }
        });

        // Leaves of each root must account for exactly the whole probability mass
        (tree.getAllRoots ? tree.getAllRoots() : [tree.getRootNode()]).forEach(function (root) {
            if (!root) return;
            var leafMass = 0;
            (function walk(node, cumulative) {
                if (!node) return;
                var children = (node.children || []).map(function (cid) { return tree.getNode(cid); })
                    .filter(Boolean);
                if (!children.length) { leafMass += cumulative; return; }
                children.forEach(function (child) {
                    walk(child, cumulative * ((child.outcome && child.outcome.probability) || 0));
                });
            })(root, 1);

            if (Math.abs(leafMass - 1) > eps) {
                violations.push({nodeId: root.id, kind: 'leafMassNotOne', sum: leafMass});
            }
        });

        return {valid: violations.length === 0, violations: violations};
    }

    // =======================================================================
    // Bulk apply: the same actions across every branch at a depth
    // =======================================================================

    /** Every node at a given depth from the root, left to right. */
    function nodesAtDepth(tree, depth) {
        var out = [];
        (tree.getAllRoots ? tree.getAllRoots() : [tree.getRootNode()]).forEach(function (root) {
            if (!root) return;
            (function walk(node, d) {
                if (!node) return;
                if (d === depth) { out.push(node); return; }
                (node.children || []).forEach(function (id) { walk(tree.getNode(id), d + 1); });
            })(root, 0);
        });
        return out;
    }

    /**
     * Check whether the same pair of actions makes sense on every branch at a
     * level, BEFORE committing to it.
     *
     * When both sides repeat a move for several turns you do not want to click
     * it once per branch, but a blanket apply is only safe if the move is
     * actually legal and meaningful everywhere. This reports, per node:
     *
     *   fainted        - the acting Pokemon is dead on this branch
     *   notOnTeam      - the active Pokemon does not know that move here
     *                    (a different Pokemon is out, e.g. after a KO)
     *   noPP           - the move is out of PP on this branch
     *   immune         - the move cannot affect the current target at all
     *   alreadyApplied - a status/setup move whose effect is already in place
     *                    (Swords Dance at +6, Thunder Wave into an existing
     *                    status, Stealth Rock already set)
     *   incapacitated  - asleep or frozen, so the move will not execute
     *
     * `safe` is true only when nothing was flagged anywhere.
     */
    function validateBulkApply(tree, depth, actions, deps) {
        var nodes = nodesAtDepth(tree, depth);
        var warnings = [];
        var MoveDB = deps && deps.MoveDB;
        var CI = deps && deps.CalcIntegration;

        nodes.forEach(function (node) {
            var state = node.state;
            if (!state) return;

            ['p1', 'p2'].forEach(function (side) {
                var action = actions[side];
                if (!action || action.type !== 'move') return;

                var mon = state[side].active;
                var foe = state[side === 'p1' ? 'p2' : 'p1'].active;
                var where = {nodeId: node.id, side: side, label: node.outcome && node.outcome.description};

                if (!mon || mon.currentHP <= 0) {
                    warnings.push(Object.assign({kind: 'fainted', move: action.moveName}, where));
                    return;
                }

                var idx = (mon.moves || []).indexOf(action.moveName);
                if (idx === -1) {
                    warnings.push(Object.assign({
                        kind: 'notOnTeam', move: action.moveName, pokemon: mon.name
                    }, where));
                    return;
                }

                // An all-zero pp array means PP was never derived for this
                // snapshot, not that every move is exhausted — do not cry wolf.
                var ppKnown = mon.pp && mon.pp.some(function (v) { return v > 0; });
                if (ppKnown && mon.pp[idx] !== undefined && mon.pp[idx] <= 0) {
                    warnings.push(Object.assign({kind: 'noPP', move: action.moveName}, where));
                }

                var statusCode = window.BattlePlanner.normalizeStatusCode(mon.status);
                if (statusCode === 'slp' || statusCode === 'frz') {
                    warnings.push(Object.assign({
                        kind: 'incapacitated', move: action.moveName, status: mon.status
                    }, where));
                }

                var entry = MoveDB ? MoveDB.get(action.moveName) : null;
                if (!entry || !foe) return;

                if (entry.category !== 'Status' && CI) {
                    var eff = CI.getTypeEffectiveness(entry.type, foe.types || [], foe);
                    if (eff === 0) {
                        warnings.push(Object.assign({
                            kind: 'immune', move: action.moveName, target: foe.name
                        }, where));
                    }
                }

                var fx = entry.effects || {};
                if (fx.status && foe.hasStatus && foe.hasStatus()) {
                    warnings.push(Object.assign({
                        kind: 'alreadyApplied', move: action.moveName,
                        detail: foe.name + ' is already ' + foe.status
                    }, where));
                }
                if (fx.selfBoosts && entry.category === 'Status') {
                    var maxed = Object.keys(fx.selfBoosts).every(function (stat) {
                        var cur = (mon.boosts && mon.boosts[stat]) || 0;
                        return fx.selfBoosts[stat] > 0 ? cur >= 6 : cur <= -6;
                    });
                    if (maxed) {
                        warnings.push(Object.assign({
                            kind: 'alreadyApplied', move: action.moveName,
                            detail: mon.name + ' cannot boost further'
                        }, where));
                    }
                }
                if (fx.sideCondition) {
                    var foeSide = state.sides[side === 'p1' ? 'p2' : 'p1'];
                    var sc = fx.sideCondition;
                    var set = (sc === 'stealthrock' && foeSide.stealthRock) ||
                        (sc === 'stickyweb' && foeSide.stickyWeb) ||
                        (sc === 'spikes' && foeSide.spikes >= 3) ||
                        (sc === 'toxicspikes' && foeSide.toxicSpikes >= 2);
                    if (set) {
                        warnings.push(Object.assign({
                            kind: 'alreadyApplied', move: action.moveName,
                            detail: sc + ' is already at its maximum'
                        }, where));
                    }
                }
            });
        });

        return {
            depth: depth,
            nodeCount: nodes.length,
            nodeIds: nodes.map(function (n) { return n.id; }),
            warnings: warnings,
            safe: warnings.length === 0
        };
    }

    /**
     * Apply the same actions to every branch at a depth, then reconcile.
     *
     * Nodes flagged by validateBulkApply are skipped unless `options.force` is
     * set, so a blanket "both sides repeat this move" cannot quietly produce a
     * turn where a fainted or move-less Pokemon acts. Reconciliation runs once
     * at the end, so the whole tree — including turns before and after this
     * level — is re-derived together.
     */
    function bulkApply(tree, depth, actions, executeTurn, deps, options) {
        options = options || {};
        var validation = validateBulkApply(tree, depth, actions, deps);
        var skip = {};

        if (!options.force) {
            validation.warnings.forEach(function (w) {
                if (w.kind !== 'alreadyApplied' && w.kind !== 'noPP') skip[w.nodeId] = true;
            });
        }

        var applied = [];
        nodesAtDepth(tree, depth).forEach(function (node) {
            if (skip[node.id]) return;
            // Replace this node's existing continuation with the chosen actions
            (node.children || []).slice().forEach(function (id) { tree.removeNode(id); });
            tree.addBranch(node.id, node.state.clone(), actions,
                new window.BattlePlanner.BattleOutcome('pending', 1, 0, {}));
            applied.push(node.id);
        });

        var report = reconcile(tree, executeTurn, options);
        report.bulk = {
            requestedNodes: validation.nodeCount,
            appliedNodes: applied.length,
            skippedNodes: Object.keys(skip),
            warnings: validation.warnings
        };
        return report;
    }

    // =======================================================================

    window.BattlePlannerBranching = {
        createTurnExecutor: createTurnExecutor,
        turnOrder: turnOrder,
        isSpeedTie: isSpeedTie,
        validateTree: validateTree,
        getUsedPokemon: getUsedPokemon,
        canEditRosterSlot: canEditRosterSlot,
        updateRoster: updateRoster,
        rosterOf: rosterOf,
        setRoster: setRoster,
        projectRosterIntoTree: projectRosterIntoTree,
        distributionsEquivalent: distributionsEquivalent,
        mixWeighted: mixWeighted,
        nodesAtDepth: nodesAtDepth,
        validateBulkApply: validateBulkApply,
        bulkApply: bulkApply,
        StateDist: StateDist,
        stateKey: stateKey,
        PREDICATES: PREDICATES,
        hpThresholdPredicate: hpThresholdPredicate,
        detectBranches: detectBranches,
        applyTurnToState: applyTurnToState,
        moveSteps: moveSteps,
        reconcile: reconcile,
        coalesceBranches: coalesceBranches,
        analyzeRollRelevance: analyzeRollRelevance,
        collectDownstreamThresholds: collectDownstreamThresholds,
        summarizeDist: summarizeDist,
        representativeState: representativeState,
        branchKey: branchKey,
        actionKey: actionKey
    };

})(window);
