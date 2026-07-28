/**
 * Battle Planner - Core Data Model
 * 
 * Implements a tree-based state model to support branching battle paths.
 * Tracks Pokemon state (HP, PP, Status, Boosts) across turns with support
 * for probability-based outcome branching (crits, misses, damage rolls).
 */

// UUID generator for node identification
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Safely extract a value that might be a getter function
 */
function safeGetValue(obj, prop, defaultVal) {
    if (!obj) return defaultVal;
    try {
        var val = obj[prop];
        // If it's a function (getter that didn't auto-execute), try calling it
        if (typeof val === 'function') {
            val = val.call(obj);
        }
        // If still undefined or NaN, use default
        if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) {
            return defaultVal;
        }
        return val;
    } catch (e) {
        return defaultVal;
    }
}

/**
 * Extract raw stats from a calc Pokemon object
 */
function extractPokemonStats(pokemon) {
    if (!pokemon) return null;
    
    var stats = {
        hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0
    };
    
    // Try rawStats first (calc library uses this)
    if (pokemon.rawStats) {
        stats.hp = safeGetValue(pokemon.rawStats, 'hp', 0);
        stats.atk = safeGetValue(pokemon.rawStats, 'atk', 0);
        stats.def = safeGetValue(pokemon.rawStats, 'def', 0);
        stats.spa = safeGetValue(pokemon.rawStats, 'spa', 0);
        stats.spd = safeGetValue(pokemon.rawStats, 'spd', 0);
        stats.spe = safeGetValue(pokemon.rawStats, 'spe', 0);
    }
    
    // Try stats property
    if (pokemon.stats) {
        stats.hp = safeGetValue(pokemon.stats, 'hp', stats.hp);
        stats.atk = safeGetValue(pokemon.stats, 'atk', stats.atk);
        stats.def = safeGetValue(pokemon.stats, 'def', stats.def);
        stats.spa = safeGetValue(pokemon.stats, 'spa', stats.spa);
        stats.spd = safeGetValue(pokemon.stats, 'spd', stats.spd);
        stats.spe = safeGetValue(pokemon.stats, 'spe', stats.spe);
    }
    
    return stats;
}

/**
 * Extract maxHP properly from a calc Pokemon
 */
function extractMaxHP(pokemon) {
    if (!pokemon) return 1;
    
    // Try direct property access
    var maxHP = 1;
    
    // Method 1: Try rawStats.hp
    if (pokemon.rawStats && typeof pokemon.rawStats.hp === 'number') {
        maxHP = pokemon.rawStats.hp;
    }
    // Method 2: Try species.baseStats with proper calculation
    else if (pokemon.species && pokemon.species.baseStats) {
        var baseHP = pokemon.species.baseStats.hp || 50;
        var level = pokemon.level || 100;
        var ivHP = (pokemon.ivs && pokemon.ivs.hp) || 31;
        var evHP = (pokemon.evs && pokemon.evs.hp) || 0;
        
        // Standard HP formula
        if (pokemon.species.name === 'Shedinja') {
            maxHP = 1;
        } else {
            maxHP = Math.floor(((2 * baseHP + ivHP + Math.floor(evHP / 4)) * level) / 100) + level + 10;
        }
    }
    // Method 3: Try the maxHP getter
    else {
        try {
            var val = pokemon.maxHP;
            if (typeof val === 'number' && !isNaN(val) && val > 0) {
                maxHP = val;
            }
        } catch(e) { }
    }
    
    // Handle Dynamax
    if (pokemon.isDynamaxed && maxHP > 1) {
        maxHP = maxHP * 2;
    }
    
    return Math.max(1, maxHP);
}

/**
 * Extract current HP properly from a calc Pokemon.
 *
 * NOTE: on a @smogon/calc Pokemon, `curHP` is a METHOD and the backing field is
 * `originalCurHP`. Reading `pokemon.curHP` as a value silently yields a function,
 * which used to fall through to maxHP and snapshot every Pokemon at full health.
 */
function extractCurHP(pokemon, maxHP) {
    if (!pokemon) return 0;

    var curHP = maxHP;

    // calc.Pokemon: curHP() already accounts for Dynamax doubling
    if (typeof pokemon.curHP === 'function') {
        try {
            var fromMethod = pokemon.curHP();
            if (typeof fromMethod === 'number' && !isNaN(fromMethod)) {
                return Math.max(0, Math.min(fromMethod, maxHP));
            }
        } catch (e) { /* fall through to the field reads below */ }
    }

    // Plain object / snapshot-like: a numeric curHP field
    if (typeof pokemon.curHP === 'number' && !isNaN(pokemon.curHP)) {
        curHP = pokemon.curHP;
    } else if (typeof pokemon.originalCurHP === 'number' && !isNaN(pokemon.originalCurHP)) {
        curHP = pokemon.originalCurHP;
        if (pokemon.isDynamaxed) curHP *= 2;
    } else if (typeof pokemon.currentHP === 'number' && !isNaN(pokemon.currentHP)) {
        curHP = pokemon.currentHP;
    }

    return Math.max(0, Math.min(curHP, maxHP));
}

/**
 * Canonical status handling.
 *
 * The codebase historically mixed calc-style codes ('brn') with display names
 * ('Burned'). Everything that writes a status must go through here so the two
 * conventions can never diverge again.
 */
var STATUS_CODE_TO_NAME = {
    '': 'Healthy',
    'par': 'Paralyzed',
    'psn': 'Poisoned',
    'tox': 'Badly Poisoned',
    'brn': 'Burned',
    'slp': 'Asleep',
    'frz': 'Frozen'
};
var STATUS_NAME_TO_CODE = {
    'Healthy': '',
    'Paralyzed': 'par',
    'Poisoned': 'psn',
    'Badly Poisoned': 'tox',
    'Burned': 'brn',
    'Asleep': 'slp',
    'Frozen': 'frz'
};

/** Accepts a code, a display name, '', null or undefined; always returns a display name. */
function normalizeStatusName(status) {
    if (status === null || status === undefined || status === '') return 'Healthy';
    if (STATUS_CODE_TO_NAME[status] !== undefined) return STATUS_CODE_TO_NAME[status];
    if (STATUS_NAME_TO_CODE[status] !== undefined) return status;
    // Tolerate loose casing ('poisoned', 'BRN', ...)
    var lower = String(status).toLowerCase();
    for (var code in STATUS_CODE_TO_NAME) {
        if (code && code === lower) return STATUS_CODE_TO_NAME[code];
        if (STATUS_CODE_TO_NAME[code].toLowerCase() === lower) return STATUS_CODE_TO_NAME[code];
    }
    return 'Healthy';
}

/** Accepts a code or display name; always returns a calc-style code ('' when healthy). */
function normalizeStatusCode(status) {
    return STATUS_NAME_TO_CODE[normalizeStatusName(status)];
}

/** True when the Pokemon carries a non-volatile status condition. */
function hasStatusCondition(status) {
    return normalizeStatusCode(status) !== '';
}

/**
 * Carry battle damage from one fight into the next.
 *
 * Back-to-back trainers (the Museum Aqua Grunts, for instance) give no chance
 * to heal or reorder between fights, so the second battle has to start with
 * the first battle's damage. This copies HP, status and consumed items from a
 * carried team onto a freshly created battle state, matched by name. Boosts
 * and volatiles do NOT carry — they reset when a battle ends.
 */
function applyCarriedTeam(state, carriedTeam) {
    if (!state || !state.p1 || !carriedTeam || !carriedTeam.length) return state;

    var byName = {};
    carriedTeam.forEach(function (mon) {
        if (mon && mon.name) byName[mon.name] = mon;
    });

    (state.p1.team || []).forEach(function (member, index) {
        var carried = member && byName[member.name];
        if (!carried) return;

        member.currentHP = Math.max(0, Math.min(member.maxHP, carried.currentHP));
        member.percentHP = member.maxHP > 0
            ? Math.round((member.currentHP / member.maxHP) * 100) : 0;
        member.hasFainted = member.currentHP <= 0;
        member.status = normalizeStatusName(carried.status);
        member.toxicCounter = carried.toxicCounter || 0;
        // An item consumed in the last fight is NOT restored between battles
        // (RnB: "Items that get consumed ... will not be restored")
        member.item = carried.item || '';
        if (carried.pp && carried.pp.length) member.pp = carried.pp.slice();
        // Fresh battle: no boosts, no volatiles, sleep counter reset
        member.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
        member.volatiles = {};
        member.sleepCounter = 0;

        if (index === state.p1.teamSlot && state.p1.active &&
                state.p1.active.name === member.name) {
            state.p1.active = member.clone();
        }
    });

    return state;
}

/**
 * Fill empty team slots (up to 6) from the box.
 *
 * At turn 0 the team is still yours to decide, so the projection is allowed
 * to RECRUIT: "the best answer for enemy #1, the next answer whenever one is
 * needed" only works if the candidates are actually on the team. Returns the
 * names it added so the UI can say "recruited from your box" and offer to
 * adopt the team for real.
 */
function recruitFromBox(state, box) {
    var recruits = [];
    if (!state || !state.p1 || !box || !box.length) {
        return {state: state, recruits: recruits};
    }
    if (!state.p1.team) state.p1.team = [];
    var team = state.p1.team;
    var have = {};
    team.forEach(function (member) {
        if (member) have[member.name] = true;
    });
    box.forEach(function (snap) {
        if (team.length >= 6 || !snap || !snap.name || have[snap.name]) return;
        if (snap.currentHP !== undefined && snap.currentHP <= 0) return;
        team.push(snap.clone ? snap.clone() : snap);
        have[snap.name] = true;
        recruits.push(snap.name);
    });
    return {state: state, recruits: recruits};
}

/** Base PP for a move, from RBDex when available. */
function getMoveBasePP(moveName) {
    if (!moveName) return 0;
    try {
        if (typeof window !== 'undefined' && window.MoveDB) {
            var entry = window.MoveDB.get(moveName);
            if (entry && entry.pp) return entry.pp;
        }
    } catch (e) { /* ignore */ }
    return 35;
}

/**
 * Represents the complete state of a Pokemon at a specific point in battle
 */
function PokemonSnapshot(pokemon) {
    if (!pokemon) {
        this.name = '';
        this.species = '';
        this.level = 100;
        this.currentHP = 0;
        this.maxHP = 0;
        this.percentHP = 100;
        this.status = 'Healthy';
        this.toxicCounter = 0;
        this.sleepCounter = 0;
        this.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
        this.volatiles = {};
        this.ability = '';
        this.item = '';
        this.nature = '';
        this.moves = [];
        this.pp = [35, 35, 35, 35];
        this.types = [];
        this.teraType = null;
        this.isTerastallized = false;
        this.stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
        this.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
        this.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
        this.isActive = true;
        this.hasFainted = false;
        this.turnsOnField = 0;
        this._pokemonData = null;
        return;
    }
    
    // Extract basic info
    this.name = safeGetValue(pokemon, 'name', '');
    this.species = pokemon.species ? safeGetValue(pokemon.species, 'name', this.name) : this.name;
    this.level = safeGetValue(pokemon, 'level', 100);
    
    // Extract HP properly
    this.maxHP = extractMaxHP(pokemon);
    this.currentHP = extractCurHP(pokemon, this.maxHP);
    this.percentHP = this.maxHP > 0 ? Math.round((this.currentHP / this.maxHP) * 100) : 100;
    
    // Status
    this.status = normalizeStatusName(safeGetValue(pokemon, 'status', ''));
    this.toxicCounter = safeGetValue(pokemon, 'toxicCounter', 0);
    this.sleepCounter = safeGetValue(pokemon, 'sleepCounter', 0);

    // Volatile conditions (Leech Seed, Curse, Aqua Ring, Ingrain, Confusion, ...).
    // These are carried by the snapshot so end-of-turn logic can act on them and
    // so clone() preserves them across turns.
    this.volatiles = {};
    var rawVolatiles = safeGetValue(pokemon, 'volatiles', null);
    if (rawVolatiles && typeof rawVolatiles === 'object') {
        for (var v in rawVolatiles) {
            if (rawVolatiles[v]) this.volatiles[v] = rawVolatiles[v];
        }
    }

    // Boosts
    var rawBoosts = safeGetValue(pokemon, 'boosts', {});
    this.boosts = {
        atk: safeGetValue(rawBoosts, 'atk', 0),
        def: safeGetValue(rawBoosts, 'def', 0),
        spa: safeGetValue(rawBoosts, 'spa', 0),
        spd: safeGetValue(rawBoosts, 'spd', 0),
        spe: safeGetValue(rawBoosts, 'spe', 0),
        accuracy: safeGetValue(rawBoosts, 'accuracy', 0),
        evasion: safeGetValue(rawBoosts, 'evasion', 0)
    };
    
    // Ability and Item
    this.ability = safeGetValue(pokemon, 'ability', '');
    this.item = safeGetValue(pokemon, 'item', '');
    this.nature = safeGetValue(pokemon, 'nature', 'Hardy');
    
    // Types
    this.types = [];
    if (pokemon.types) {
        this.types = Array.isArray(pokemon.types) ? pokemon.types.slice() : [];
    } else if (pokemon.species && pokemon.species.types) {
        this.types = pokemon.species.types.slice();
    }
    
    // Tera
    this.teraType = safeGetValue(pokemon, 'teraType', null);
    this.isTerastallized = !!this.teraType;
    
    // Moves
    this.moves = [];
    var rawMoves = safeGetValue(pokemon, 'moves', []);
    for (var i = 0; i < rawMoves.length; i++) {
        var move = rawMoves[i];
        if (typeof move === 'string') {
            this.moves.push(move);
        } else if (move && move.name) {
            this.moves.push(move.name);
        }
    }
    
    // PP: taken from the move's own data (RBDex) rather than a flat 35
    this.pp = [];
    for (var i = 0; i < 4; i++) {
        this.pp.push(this.moves[i] ? getMoveBasePP(this.moves[i]) : 0);
    }
    
    // Stats
    this.stats = extractPokemonStats(pokemon) || { hp: this.maxHP, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    this.stats.hp = this.maxHP;
    
    // EVs and IVs
    this.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    this.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    if (pokemon.evs) {
        for (var stat in this.evs) {
            this.evs[stat] = safeGetValue(pokemon.evs, stat, 0);
        }
    }
    if (pokemon.ivs) {
        for (var stat in this.ivs) {
            this.ivs[stat] = safeGetValue(pokemon.ivs, stat, 31);
        }
    }
    
    // State flags
    this.isActive = true;
    this.hasFainted = this.currentHP <= 0;
    this.turnsOnField = 0;
    
    // Store reference for later recreation
    this._pokemonData = pokemon;
}

PokemonSnapshot.prototype._statusCodeToName = function(code) {
    return normalizeStatusName(code);
};

PokemonSnapshot.prototype._statusNameToCode = function(name) {
    return normalizeStatusCode(name);
};

/** True when this Pokemon already carries a non-volatile status. */
PokemonSnapshot.prototype.hasStatus = function() {
    return hasStatusCondition(this.status);
};

PokemonSnapshot.prototype.clone = function() {
    var clone = new PokemonSnapshot(null);
    clone.name = this.name;
    clone.species = this.species;
    clone.level = this.level;
    clone.currentHP = this.currentHP;
    clone.maxHP = this.maxHP;
    clone.percentHP = this.percentHP;
    clone.status = this.status;
    clone.toxicCounter = this.toxicCounter;
    clone.sleepCounter = this.sleepCounter || 0;
    clone.boosts = Object.assign({}, this.boosts);
    clone.volatiles = Object.assign({}, this.volatiles || {});
    clone.ability = this.ability;
    clone.item = this.item;
    clone.nature = this.nature;
    clone.moves = this.moves.slice();
    clone.pp = this.pp.slice();
    clone.types = this.types.slice();
    clone.teraType = this.teraType;
    clone.isTerastallized = this.isTerastallized;
    clone.stats = Object.assign({}, this.stats);
    clone.evs = Object.assign({}, this.evs);
    clone.ivs = Object.assign({}, this.ivs);
    clone.isActive = this.isActive;
    clone.hasFainted = this.hasFainted;
    clone.turnsOnField = this.turnsOnField || 0;
    clone._pokemonData = this._pokemonData;
    return clone;
};

PokemonSnapshot.prototype.applyDamage = function(damage) {
    this.currentHP = Math.max(0, this.currentHP - Math.floor(damage));
    this.percentHP = this.maxHP > 0 ? Math.round((this.currentHP / this.maxHP) * 100) : 0;
    this.hasFainted = this.currentHP <= 0;
    return this;
};

PokemonSnapshot.prototype.applyHealing = function(amount) {
    this.currentHP = Math.min(this.maxHP, this.currentHP + Math.floor(amount));
    this.percentHP = this.maxHP > 0 ? Math.round((this.currentHP / this.maxHP) * 100) : 100;
    return this;
};

PokemonSnapshot.prototype.applyBoost = function(stat, stages) {
    if (this.boosts[stat] !== undefined) {
        this.boosts[stat] = Math.max(-6, Math.min(6, this.boosts[stat] + stages));
    }
    return this;
};

PokemonSnapshot.prototype.setStatus = function(status, toxicCounter) {
    // Accepts either a code ('brn') or a display name ('Burned').
    this.status = normalizeStatusName(status);
    this.toxicCounter = this.status === 'Badly Poisoned' ? (toxicCounter || 1) : 0;
    if (this.status !== 'Asleep') this.sleepCounter = 0;
    return this;
};

/**
 * Status-curing berries, consumed the instant the status lands.
 *
 * Lum Berry alone is held by 204 of the 1,626 trainer sets — the most common
 * item in the game — so leaving these unimplemented meant every status the
 * planner inflicted on those sets stuck when in game it would be cured
 * immediately.
 */
var STATUS_CURE_BERRIES = {
    'Cheri Berry': ['par'],
    'Chesto Berry': ['slp'],
    'Pecha Berry': ['psn', 'tox'],
    'Rawst Berry': ['brn'],
    'Aspear Berry': ['frz'],
    'Persim Berry': [],                                  // confusion only
    'Lum Berry': ['par', 'slp', 'psn', 'tox', 'brn', 'frz']
};
var CONFUSION_CURE_BERRIES = ['Persim Berry', 'Lum Berry'];

/** Items whose effect is suppressed, so the berry cannot be eaten. */
function canUseItem(pokemon) {
    var ability = (pokemon.ability || '').replace(/\s/g, '').toLowerCase();
    return ability !== 'klutz' && !pokemon.isEmbargoed;
}

/**
 * Type and ability immunities to non-volatile status.
 *
 * A Steel-type simply cannot be poisoned, and no amount of accuracy changes
 * that — so a planner that shows a poison branch against one is lying about the
 * position. Abilities that override the rule in either direction are honoured:
 * Corrosion poisons anything, Limber/Insomnia/Water Veil/Magma Armor grant
 * immunity, Misty Terrain protects anything grounded.
 */
var STATUS_TYPE_IMMUNITY = {
    psn: ['Steel', 'Poison'],
    tox: ['Steel', 'Poison'],
    par: ['Electric'],
    brn: ['Fire'],
    frz: ['Ice'],
    slp: []
};

var STATUS_ABILITY_IMMUNITY = {
    psn: ['immunity', 'pastelveil', 'purifyingsalt', 'comatose'],
    tox: ['immunity', 'pastelveil', 'purifyingsalt', 'comatose'],
    par: ['limber', 'purifyingsalt', 'comatose'],
    brn: ['waterveil', 'waterbubble', 'purifyingsalt', 'comatose'],
    frz: ['magmaarmor', 'purifyingsalt', 'comatose'],
    slp: ['insomnia', 'vitalspirit', 'sweetveil', 'purifyingsalt', 'comatose']
};

/**
 * Can this status land at all?
 *
 * `opts` may carry { attackerAbility, field, sideState, ignoreAbilities } so
 * Corrosion, Mold Breaker, terrain and Safeguard can be taken into account.
 */
PokemonSnapshot.prototype.canBeStatused = function(status, opts) {
    opts = opts || {};
    var code = normalizeStatusCode(status);
    if (code === '') return false;
    if (this.hasStatus()) return false;                  // one status at a time

    var attackerAbility = String(opts.attackerAbility || '').replace(/\s|-/g, '').toLowerCase();
    var myAbility = String(this.ability || '').replace(/\s|-/g, '').toLowerCase();
    var types = this.types || [];

    // Corrosion poisons Steel and Poison types regardless
    var corrosion = attackerAbility === 'corrosion' && (code === 'psn' || code === 'tox');

    var immuneTypes = STATUS_TYPE_IMMUNITY[code] || [];
    if (!corrosion && immuneTypes.some(function (t) { return types.indexOf(t) !== -1; })) {
        return false;
    }

    // Mold Breaker and friends ignore the target's ability, not its typing
    var moldBreaker = ['moldbreaker', 'turboblaze', 'teravolt'].indexOf(attackerAbility) !== -1;
    if (!moldBreaker && !opts.ignoreAbilities) {
        var immuneAbilities = STATUS_ABILITY_IMMUNITY[code] || [];
        if (immuneAbilities.indexOf(myAbility) !== -1) return false;
        // Leaf Guard blocks everything in harsh sun
        var weather = String((opts.field && opts.field.weather) || '').toLowerCase();
        if (myAbility === 'leafguard' && (weather === 'sun' || weather === 'harsh sunshine')) {
            return false;
        }
        if (myAbility === 'flowerveil' && types.indexOf('Grass') !== -1) return false;
    }

    // Grounded Pokemon are shielded by Misty Terrain; Electric Terrain blocks sleep
    var grounded = types.indexOf('Flying') === -1 && myAbility !== 'levitate' &&
        this.item !== 'Air Balloon';
    var terrain = String((opts.field && opts.field.terrain) || '').toLowerCase();
    if (grounded) {
        if (terrain === 'misty') return false;
        if (terrain === 'electric' && code === 'slp') return false;
    }

    // Safeguard on the target's own side
    if (opts.sideState && opts.sideState.safeguard && !moldBreaker) return false;

    return true;
};

/**
 * Inflict a non-volatile status, honouring type and ability immunities, the
 * existing-status rule, and any curing berry. Returns true if it stuck.
 */
PokemonSnapshot.prototype.inflictStatus = function(status, toxicCounter, opts) {
    var code = normalizeStatusCode(status);
    if (code === '') return false;
    if (!this.canBeStatused(code, opts)) return false;

    this.setStatus(code, toxicCounter);

    var cures = STATUS_CURE_BERRIES[this.item];
    if (cures && cures.indexOf(code) !== -1 && canUseItem(this)) {
        this.setStatus('Healthy');
        this.item = '';
        this.lastConsumedItem = 'status berry';
        return false;
    }
    return true;
};

/**
 * Inflict a volatile condition, honouring Persim/Lum for confusion.
 * Returns true if it stuck.
 */
PokemonSnapshot.prototype.inflictVolatile = function(name, value) {
    if (!name) return false;
    this.setVolatile(name, value === undefined ? true : value);

    if (name === 'confusion' && CONFUSION_CURE_BERRIES.indexOf(this.item) !== -1 && canUseItem(this)) {
        this.setVolatile('confusion', false);
        this.item = '';
        this.lastConsumedItem = 'status berry';
        return false;
    }
    return true;
};

PokemonSnapshot.prototype.setVolatile = function(name, value) {
    if (!name) return this;
    if (!this.volatiles) this.volatiles = {};
    if (value === false || value === undefined || value === null) {
        delete this.volatiles[name];
    } else {
        this.volatiles[name] = value;
    }
    return this;
};

PokemonSnapshot.prototype.hasVolatile = function(name) {
    return !!(this.volatiles && this.volatiles[name]);
};

/**
 * (Re)fill the PP array from the current move list.
 *
 * Several call sites build a blank snapshot and assign `moves` afterwards, so
 * the constructor cannot be the only place PP is derived — those snapshots
 * would keep a placeholder PP array that does not match their moves.
 */
PokemonSnapshot.prototype.refreshPP = function() {
    var pp = [];
    for (var i = 0; i < Math.max(4, this.moves.length); i++) {
        pp.push(this.moves[i] ? getMoveBasePP(this.moves[i]) : 0);
    }
    this.pp = pp;
    return this;
};

PokemonSnapshot.prototype.usePP = function(moveIndex) {
    if (this.pp[moveIndex] !== undefined && this.pp[moveIndex] > 0) {
        this.pp[moveIndex]--;
    }
    return this;
};

/**
 * Get effective speed considering boosts, paralysis, etc.
 */
PokemonSnapshot.prototype.getEffectiveSpeed = function(field) {
    var baseSpe = this.stats.spe || 100;
    var boost = this.boosts.spe || 0;
    
    // Apply boost multiplier
    var multiplier = 1;
    if (boost > 0) {
        multiplier = (2 + boost) / 2;
    } else if (boost < 0) {
        multiplier = 2 / (2 - boost);
    }
    
    var speed = Math.floor(baseSpe * multiplier);

    var ability = (this.ability || '').replace(/\s/g, '').toLowerCase();

    // RnB: Paralysis reduces speed by 75% (25% remaining). Quick Feet is immune
    // to the cut and instead gets a 1.5x boost from any non-volatile status.
    if (normalizeStatusCode(this.status) === 'par' && ability !== 'quickfeet') {
        speed = Math.floor(speed * 0.25);
    }
    if (ability === 'quickfeet' && hasStatusCondition(this.status)) {
        speed = Math.floor(speed * 1.5);
    }

    // Items
    if (this.item === 'Choice Scarf') {
        speed = Math.floor(speed * 1.5);
    } else if (this.item === 'Iron Ball' || this.item === 'Macho Brace' || this.item === 'Power Weight' ||
               this.item === 'Power Bracer' || this.item === 'Power Belt' || this.item === 'Power Lens' ||
               this.item === 'Power Band' || this.item === 'Power Anklet') {
        speed = Math.floor(speed * 0.5);
    }

    // NOTE: Sticky Web is deliberately NOT applied here — it is a -1 Speed stage
    // applied on switch-in and is already reflected in `boosts.spe`.

    // Tailwind (would need field info)
    if (field && field.tailwind) {
        speed = speed * 2;
    }
    
    return speed;
};

/**
 * Get display string for stat boosts
 */
PokemonSnapshot.prototype.getBoostSummary = function() {
    var parts = [];
    var statNames = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
    for (var stat in statNames) {
        if (this.boosts[stat] && this.boosts[stat] !== 0) {
            var val = this.boosts[stat];
            parts.push(statNames[stat] + ' ' + (val > 0 ? '+' : '') + val);
        }
    }
    return parts.length > 0 ? parts.join(', ') : 'No boosts';
};

/**
 * Represents the complete battle state at a specific point
 */
function BattleStateSnapshot() {
    this.turnNumber = 0;
    this.p1 = {
        active: null, // PokemonSnapshot
        team: [],     // Array of PokemonSnapshot
        teamSlot: 0   // Index of active Pokemon in team
    };
    this.p2 = {
        active: null,
        team: [],
        teamSlot: 0
    };
    this.field = {
        weather: 'None',
        weatherTurns: 0,
        terrain: 'None',
        terrainTurns: 0,
        trickRoom: false,
        trickRoomTurns: 0,
        gravity: false,
        gravityTurns: 0,
        magicRoom: false,
        wonderRoom: false
    };
    this.sides = {
        p1: {
            spikes: 0,
            toxicSpikes: 0,
            stealthRock: false,
            stickyWeb: false,
            reflect: false,
            reflectTurns: 0,
            lightScreen: false,
            lightScreenTurns: 0,
            auroraVeil: false,
            auroraVeilTurns: 0,
            tailwind: false,
            tailwindTurns: 0,
            safeguard: false,
            mist: false
        },
        p2: {
            spikes: 0,
            toxicSpikes: 0,
            stealthRock: false,
            stickyWeb: false,
            reflect: false,
            reflectTurns: 0,
            lightScreen: false,
            lightScreenTurns: 0,
            auroraVeil: false,
            auroraVeilTurns: 0,
            tailwind: false,
            tailwindTurns: 0,
            safeguard: false,
            mist: false
        }
    };
    this.rollVariance = null;
}

BattleStateSnapshot.prototype.clone = function() {
    var clone = new BattleStateSnapshot();
    clone.turnNumber = this.turnNumber;
    
    // Clone P1
    clone.p1.active = this.p1.active ? this.p1.active.clone() : null;
    clone.p1.team = this.p1.team.map(function(p) { return p.clone(); });
    clone.p1.teamSlot = this.p1.teamSlot;
    
    // Clone P2
    clone.p2.active = this.p2.active ? this.p2.active.clone() : null;
    clone.p2.team = this.p2.team.map(function(p) { return p.clone(); });
    clone.p2.teamSlot = this.p2.teamSlot;
    
    // Per-turn event log (full paralysis, confusion self-hit, ...) — part of
    // state identity, so it has to survive cloning
    clone.turnEvents = (this.turnEvents || []).slice();

    // Clone field
    clone.field = Object.assign({}, this.field);
    
    // Clone sides
    clone.sides = {
        p1: Object.assign({}, this.sides.p1),
        p2: Object.assign({}, this.sides.p2)
    };
    
    return clone;
};

/**
 * Get speed comparison between P1 and P2
 */
BattleStateSnapshot.prototype.getSpeedComparison = function() {
    var p1Speed = this.p1.active ? this.p1.active.getEffectiveSpeed(this.sides.p1) : 0;
    var p2Speed = this.p2.active ? this.p2.active.getEffectiveSpeed(this.sides.p2) : 0;
    
    // Account for Trick Room
    var trickRoom = this.field.trickRoom;
    
    return {
        p1Speed: p1Speed,
        p2Speed: p2Speed,
        p1First: trickRoom ? p1Speed < p2Speed : p1Speed > p2Speed,
        p2First: trickRoom ? p2Speed < p1Speed : p2Speed > p1Speed,
        speedTie: p1Speed === p2Speed,
        trickRoom: trickRoom,
        description: this._formatSpeedDesc(p1Speed, p2Speed, trickRoom)
    };
};

BattleStateSnapshot.prototype._formatSpeedDesc = function(p1Speed, p2Speed, trickRoom) {
    var p1Name = this.p1.active ? this.p1.active.name : 'P1';
    var p2Name = this.p2.active ? this.p2.active.name : 'P2';
    
    if (p1Speed === p2Speed) {
        return 'Speed Tie (' + p1Speed + ')';
    }
    
    if (trickRoom) {
        if (p1Speed < p2Speed) {
            return p1Name + ' is slower (' + p1Speed + ' vs ' + p2Speed + ') - moves first in Trick Room';
        } else {
            return p2Name + ' is slower (' + p2Speed + ' vs ' + p1Speed + ') - moves first in Trick Room';
        }
    } else {
        if (p1Speed > p2Speed) {
            return p1Name + ' outspeeds (' + p1Speed + ' vs ' + p2Speed + ')';
        } else {
            return p2Name + ' outspeeds (' + p2Speed + ' vs ' + p1Speed + ')';
        }
    }
};

/**
 * Represents an action taken by a player
 */
function BattleAction(type, data) {
    this.type = type; // 'move', 'switch', 'item', 'skip'
    this.data = data || {};
    
    // For moves
    this.moveName = data.moveName || '';
    this.moveIndex = data.moveIndex || 0;
    this.targetSlot = data.targetSlot || 0;
    
    // For switches
    this.targetName = data.targetName || '';
    this.switchTo = data.switchTo || null;
    this.switchToIndex = data.switchToIndex || 0;
    
    // For items
    this.itemName = data.itemName || '';
}

BattleAction.prototype.describe = function() {
    switch (this.type) {
        case 'move':
            return this.moveName || 'Attack';
        case 'switch':
            return '→ ' + (this.targetName || this.switchTo || '?');
        case 'item':
            return 'Use ' + (this.itemName || 'Item');
        case 'skip':
            return 'Skip';
        default:
            return 'Unknown';
    }
};

/**
 * Represents the outcome of an action (for probability branching)
 */
function BattleOutcome(description, probability, damageDealt, effects) {
    this.description = description || 'Normal';
    // A 0 probability is meaningful (an impossible branch); `|| 1.0` used to turn
    // it into a certainty.
    this.probability = (typeof probability === 'number' && !isNaN(probability)) ? probability : 1.0;
    this.damageDealt = (typeof damageDealt === 'number' && !isNaN(damageDealt)) ? damageDealt : 0;
    this.damagePercent = 0;
    this.effects = effects || {};
    
    // Specific outcome flags
    this.isCrit = effects && effects.crit || false;
    this.isMiss = effects && effects.miss || false;
    this.isHighRoll = effects && effects.highRoll || false;
    this.isLowRoll = effects && effects.lowRoll || false;
    this.secondaryTriggered = effects && effects.secondary || false;
}

BattleOutcome.prototype.getLabel = function() {
    var labels = [];
    if (this.isCrit) labels.push('Crit');
    if (this.isMiss) labels.push('Miss');
    if (this.isHighRoll) labels.push('Max');
    if (this.isLowRoll) labels.push('Min');
    if (this.secondaryTriggered) labels.push('Effect');
    return labels.length > 0 ? labels.join(', ') : 'Normal';
};

/**
 * A node in the battle tree - represents a single point in the battle timeline
 */
function BattleNode(parentId, state, action, outcome) {
    this.id = generateUUID();
    this.parentId = parentId || null;
    this.children = [];
    
    // The state AT THE START of this node's turn
    this.state = state || new BattleStateSnapshot();
    
    // The actions taken to reach this node (from parent)
    this.actions = {
        p1: action && action.p1 || null,
        p2: action && action.p2 || null
    };
    
    // The specific outcome that occurred
    this.outcome = outcome || new BattleOutcome();
    
    // Metadata for UI
    this.label = '';
    this.notes = '';
    this.isCollapsed = false;
    this.isBestCase = false;
    this.isWorstCase = false;
    this.createdAt = new Date().toISOString();
}

BattleNode.prototype.getTurnLabel = function() {
    return 'T' + this.state.turnNumber;
};

BattleNode.prototype.getFullLabel = function() {
    var parts = [this.getTurnLabel()];
    
    if (this.actions.p1 && this.actions.p1.type === 'move') {
        parts.push(this.actions.p1.moveName);
    }
    if (this.actions.p2 && this.actions.p2.type === 'move') {
        parts.push('vs ' + this.actions.p2.moveName);
    }
    if (this.outcome.description !== 'Normal' && this.outcome.description) {
        parts.push('(' + this.outcome.getLabel() + ')');
    }
    
    return parts.join(': ');
};

BattleNode.prototype.hasChildren = function() {
    return this.children.length > 0;
};

/**
 * The Battle Tree Manager
 */
function BattleTree() {
    this.nodes = {};
    this.rootId = null;
    // Own property: this used to live on the prototype, so addRoot() before
    // initialize() mutated an array shared by every BattleTree instance.
    this.rootIds = [];
    this.currentNodeId = null;
    this.undoStack = [];
    this.redoStack = [];
    
    // Event callbacks
    this.onNodeAdded = null;
    this.onNodeRemoved = null;
    this.onCurrentNodeChanged = null;
    this.onTreeUpdated = null;
}

BattleTree.prototype.initialize = function(initialState) {
    var rootNode = new BattleNode(null, initialState, null, null);
    rootNode.label = 'Battle Start';
    
    this.nodes = {};
    this.nodes[rootNode.id] = rootNode;
    this.rootId = rootNode.id;
    this.rootIds = [rootNode.id]; // Initialize rootIds array
    this.currentNodeId = rootNode.id;
    this.undoStack = [];
    this.redoStack = [];
    
    this._fireEvent('onTreeUpdated');
    return rootNode;
};

BattleTree.prototype.getNode = function(nodeId) {
    return this.nodes[nodeId] || null;
};

BattleTree.prototype.getCurrentNode = function() {
    return this.getNode(this.currentNodeId);
};

BattleTree.prototype.getRootNode = function() {
    return this.getNode(this.rootId);
};

BattleTree.prototype.addRoot = function(initialState, label) {
    var rootNode = new BattleNode(null, initialState, null, null);
    rootNode.label = label || 'Battle Start';
    
    this.nodes[rootNode.id] = rootNode;
    
    // Track multiple roots - ensure array is initialized
    if (!Array.isArray(this.rootIds)) {
        this.rootIds = [];
    }
    
    // Add existing root to array if not already there
    if (this.rootId && this.rootIds.indexOf(this.rootId) === -1) {
        this.rootIds.push(this.rootId);
    }
    
    // Add new root
    if (this.rootIds.indexOf(rootNode.id) === -1) {
        this.rootIds.push(rootNode.id);
    }
    
    // Set as current root
    this.rootId = rootNode.id;
    this.currentNodeId = rootNode.id;
    
    this._fireEvent('onTreeUpdated');
    return rootNode;
};

BattleTree.prototype.getAllRoots = function() {
    var self = this;
    var roots = [];
    
    if (!this.rootIds || this.rootIds.length === 0) {
        if (this.rootId) {
            return [this.getNode(this.rootId)];
        }
        return [];
    }
    
    this.rootIds.forEach(function(id) {
        var node = self.getNode(id);
        if (node) roots.push(node);
    });
    
    return roots;
};

BattleTree.prototype.navigate = function(nodeId) {
    if (this.nodes[nodeId]) {
        var prevNodeId = this.currentNodeId;
        this.currentNodeId = nodeId;
        this._fireEvent('onCurrentNodeChanged', { prevNodeId: prevNodeId, newNodeId: nodeId });
        return true;
    }
    return false;
};

BattleTree.prototype.addBranch = function(parentNodeId, newState, actions, outcome) {
    var parentNode = this.getNode(parentNodeId);
    if (!parentNode) {
        console.error('Parent node not found:', parentNodeId);
        return null;
    }
    
    var newNode = new BattleNode(parentNodeId, newState, actions, outcome);
    
    this.nodes[newNode.id] = newNode;
    parentNode.children.push(newNode.id);
    
    this.undoStack.push({
        type: 'addBranch',
        nodeId: newNode.id,
        parentId: parentNodeId
    });
    this.redoStack = [];
    
    this._fireEvent('onNodeAdded', { node: newNode, parentId: parentNodeId });
    this._fireEvent('onTreeUpdated');
    
    return newNode;
};

BattleTree.prototype.removeNode = function(nodeId) {
    var node = this.getNode(nodeId);
    if (!node || nodeId === this.rootId) {
        return false;
    }
    
    var toRemove = this._getDescendants(nodeId);
    toRemove.push(nodeId);
    
    var parentNode = this.getNode(node.parentId);
    if (parentNode) {
        var idx = parentNode.children.indexOf(nodeId);
        if (idx !== -1) {
            parentNode.children.splice(idx, 1);
        }
    }
    
    var self = this;
    toRemove.forEach(function(id) {
        delete self.nodes[id];
    });
    
    if (toRemove.indexOf(this.currentNodeId) !== -1) {
        this.currentNodeId = node.parentId || this.rootId;
    }
    
    this._fireEvent('onNodeRemoved', { nodeId: nodeId, removedIds: toRemove });
    this._fireEvent('onTreeUpdated');
    
    return true;
};

BattleTree.prototype._getDescendants = function(nodeId) {
    var result = [];
    var node = this.getNode(nodeId);
    if (!node) return result;
    
    var self = this;
    node.children.forEach(function(childId) {
        result.push(childId);
        result = result.concat(self._getDescendants(childId));
    });
    
    return result;
};

BattleTree.prototype.getPathToNode = function(nodeId) {
    var path = [];
    var currentId = nodeId;
    
    while (currentId) {
        path.unshift(currentId);
        var node = this.getNode(currentId);
        currentId = node ? node.parentId : null;
    }
    
    return path;
};

BattleTree.prototype.getLeafNodes = function() {
    var self = this;
    return Object.keys(this.nodes).filter(function(id) {
        return self.nodes[id].children.length === 0;
    }).map(function(id) {
        return self.nodes[id];
    });
};

BattleTree.prototype.getNodeDepth = function(nodeId) {
    return this.getPathToNode(nodeId).length - 1;
};

BattleTree.prototype.serialize = function() {
    return JSON.stringify({
        version: 2,
        rootId: this.rootId,
        rootIds: this.rootIds,
        currentNodeId: this.currentNodeId,
        nodes: this.nodes
    }, null, 2);
};

/** Rebuild a BattleOutcome (with its prototype) from plain deserialized JSON. */
function reviveOutcome(raw) {
    if (!raw) return new BattleOutcome();
    var outcome = new BattleOutcome(raw.description, raw.probability, raw.damageDealt, raw.effects);
    // Preserve any extra fields written by the branching engine
    Object.keys(raw).forEach(function(k) {
        if (!(k in outcome)) outcome[k] = raw[k];
    });
    outcome.damagePercent = raw.damagePercent || 0;
    return outcome;
}

/** Rebuild a BattleAction (with its prototype) from plain deserialized JSON. */
function reviveAction(raw) {
    if (!raw) return null;
    var action = new BattleAction(raw.type, raw.data || raw);
    Object.keys(raw).forEach(function(k) {
        if (k !== 'type' && k !== 'data') action[k] = raw[k];
    });
    return action;
}

BattleTree.prototype.deserialize = function(jsonStr) {
    try {
        var data = JSON.parse(jsonStr);
        
        this.rootId = data.rootId;
        this.rootIds = data.rootIds || [data.rootId];
        this.currentNodeId = data.currentNodeId;
        this.nodes = {};
        
        var self = this;
        Object.keys(data.nodes).forEach(function(id) {
            var nodeData = data.nodes[id];
            var node = Object.assign(new BattleNode(), nodeData);

            // Object.assign copies plain JSON objects over the constructed
            // instances, which used to strip the BattleOutcome / BattleAction
            // prototypes and make getFullLabel() throw on any loaded tree.
            node.outcome = reviveOutcome(nodeData.outcome);
            node.actions = {
                p1: reviveAction(nodeData.actions && nodeData.actions.p1),
                p2: reviveAction(nodeData.actions && nodeData.actions.p2)
            };

            if (nodeData.state) {
                node.state = Object.assign(new BattleStateSnapshot(), nodeData.state);
                
                if (nodeData.state.p1 && nodeData.state.p1.active) {
                    node.state.p1.active = Object.assign(new PokemonSnapshot(), nodeData.state.p1.active);
                }
                if (nodeData.state.p2 && nodeData.state.p2.active) {
                    node.state.p2.active = Object.assign(new PokemonSnapshot(), nodeData.state.p2.active);
                }
                
                // Reconstruct team member prototypes
                if (nodeData.state.p1 && nodeData.state.p1.team) {
                    node.state.p1.team = nodeData.state.p1.team.map(function(t) {
                        return Object.assign(new PokemonSnapshot(), t);
                    });
                }
                if (nodeData.state.p2 && nodeData.state.p2.team) {
                    node.state.p2.team = nodeData.state.p2.team.map(function(t) {
                        return Object.assign(new PokemonSnapshot(), t);
                    });
                }
            }
            
            self.nodes[id] = node;
        });
        
        this.undoStack = [];
        this.redoStack = [];
        
        this._fireEvent('onTreeUpdated');
        return true;
    } catch (e) {
        console.error('Failed to deserialize battle tree:', e);
        return false;
    }
};

BattleTree.prototype._fireEvent = function(eventName, data) {
    if (typeof this[eventName] === 'function') {
        try {
            this[eventName](data);
        } catch (e) {
            console.error('Event handler error:', eventName, e);
        }
    }
};

BattleTree.prototype.getCumulativeProbability = function(nodeId) {
    var path = this.getPathToNode(nodeId);
    var probability = 1.0;
    
    var self = this;
    path.forEach(function(id) {
        var node = self.getNode(id);
        if (node && node.outcome && node.outcome.probability) {
            probability *= node.outcome.probability;
        }
    });
    
    return probability;
};

BattleTree.prototype.analyzeOutcomes = function() {
    var leaves = this.getLeafNodes();
    if (leaves.length === 0) return null;
    
    // Reset flags
    Object.keys(this.nodes).forEach(function(id) {
        this.nodes[id].isBestCase = false;
        this.nodes[id].isWorstCase = false;
    }, this);
    
    var self = this;
    var analysis = leaves.map(function(leaf) {
        var p1HP = leaf.state.p1.active ? leaf.state.p1.active.percentHP : 0;
        var p2HP = leaf.state.p2.active ? leaf.state.p2.active.percentHP : 0;
        var advantage = p1HP - p2HP;
        
        return {
            nodeId: leaf.id,
            p1HP: p1HP,
            p2HP: p2HP,
            advantage: advantage,
            probability: self.getCumulativeProbability(leaf.id)
        };
    });
    
    analysis.sort(function(a, b) { return b.advantage - a.advantage; });
    
    if (analysis.length > 0) {
        // Outcomes are sorted but we no longer visually mark best/worst
    }
    
    return {
        best: analysis[0],
        worst: analysis[analysis.length - 1],
        all: analysis
    };
};

// Export for use in browser
window.BattlePlanner = {
    PokemonSnapshot: PokemonSnapshot,
    BattleStateSnapshot: BattleStateSnapshot,
    BattleAction: BattleAction,
    BattleOutcome: BattleOutcome,
    BattleNode: BattleNode,
    BattleTree: BattleTree,
    generateUUID: generateUUID,
    safeGetValue: safeGetValue,
    extractMaxHP: extractMaxHP,
    extractCurHP: extractCurHP,
    extractPokemonStats: extractPokemonStats,
    normalizeStatusName: normalizeStatusName,
    normalizeStatusCode: normalizeStatusCode,
    hasStatusCondition: hasStatusCondition,
    getMoveBasePP: getMoveBasePP,
    applyCarriedTeam: applyCarriedTeam,
    recruitFromBox: recruitFromBox,
    STATUS_TYPE_IMMUNITY: STATUS_TYPE_IMMUNITY,
    STATUS_ABILITY_IMMUNITY: STATUS_ABILITY_IMMUNITY,
    STATUS_CODE_TO_NAME: STATUS_CODE_TO_NAME,
    STATUS_NAME_TO_CODE: STATUS_NAME_TO_CODE
};
