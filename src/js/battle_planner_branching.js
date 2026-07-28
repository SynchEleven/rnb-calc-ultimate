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
        return next;
    }

    function withTag(state, tag, value) {
        state.__tags = Object.assign({}, state.__tags || {});
        state.__tags[tag] = value;
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

            return {
                side: side,
                targetSide: defenderSide,
                accuracy: accuracy,
                critChance: critChance,
                damageRolls: CI.getDamageRolls(result, moveOptions.hits),
                critDamageRolls: CI.getDamageRolls(critResult, moveOptions.hits),
                secondaries: secondariesFor(entry, side, defenderSide),
                entry: entry
            };
        }

        /** Every independent chance-based rider on the move. */
        function secondariesFor(entry, side, defenderSide) {
            if (!entry || !entry.effects) return [];
            var out = [];

            entry.effects.secondaries.forEach(function (sec) {
                var chance = (sec.chance === undefined ? 100 : sec.chance) / 100;
                if (chance <= 0) return;
                out.push({
                    chance: chance,
                    apply: function (state) {
                        var target = state[defenderSide].active;
                        var self = state[side].active;
                        if (sec.status && target && !target.hasStatus()) target.setStatus(sec.status);
                        if (sec.volatileStatus && target) target.setVolatile(sec.volatileStatus, true);
                        if (sec.targetBoosts && target) {
                            for (var s in sec.targetBoosts) target.applyBoost(s, sec.targetBoosts[s]);
                        }
                        if (sec.selfBoosts && self) {
                            for (var t in sec.selfBoosts) self.applyBoost(t, sec.selfBoosts[t]);
                        }
                        if (sec.selfStatus && self && !self.hasStatus()) self.setStatus(sec.selfStatus);
                    }
                });
            });

            return out;
        }

        /**
         * Deterministic on-hit riders: guaranteed stat changes, drain, recoil.
         * These do not branch — they either happen (the move connected) or they
         * do not (it missed).
         */
        function guaranteedEffectsStep(spec) {
            return function (state) {
                var entry = spec.entry;
                if (!entry || !entry.effects) return [{state: state, probability: 1}];
                if (state.__tags && state.__tags[spec.side + 'Missed']) {
                    return [{state: state, probability: 1}];
                }

                var fx = entry.effects;
                var hasWork = fx.selfBoosts || fx.targetBoosts || fx.recoil || fx.drain;
                if (!hasWork) return [{state: state, probability: 1}];

                var next = cloneState(state);
                var self = next[spec.side].active;
                var target = next[spec.targetSide].active;
                var dealt = state.__lastDamage || 0;

                if (fx.selfBoosts && self) {
                    for (var s in fx.selfBoosts) self.applyBoost(s, fx.selfBoosts[s]);
                }
                if (fx.targetBoosts && target && entry.category !== 'Status') {
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

                return [{state: next, probability: 1}];
            };
        }

        /** Damage application, including HP-threshold item and ability triggers. */
        function applyDamage(state, spec, amount) {
            var target = state[spec.targetSide].active;
            if (!target) return;

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

        return function executeTurn(state, actions) {
            var order = turnOrder(state, actions);
            var steps = [];

            order.forEach(function (side) {
                var action = actions[side];
                if (!action) return;

                steps.push(function (current) {
                    // A fainted attacker does nothing
                    var attacker = current[side].active;
                    if (!attacker || attacker.currentHP <= 0) {
                        return [{state: current, probability: 1}];
                    }
                    var spec = moveSpecFor(current, side, action);
                    if (!spec) return [{state: current, probability: 1}];

                    var moveStepFns = moveSteps(spec, applyDamage);
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
                next.turnNumber = (current.turnNumber || 0) + 1;
                return [{state: next, probability: 1}];
            });

            return applyTurnToState(state, {steps: steps});
        };
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

    window.BattlePlannerBranching = {
        createTurnExecutor: createTurnExecutor,
        turnOrder: turnOrder,
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
