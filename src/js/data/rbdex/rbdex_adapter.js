/**
 * RBDex Adapter - Makes RBDex data available on window for the battle planner.
 *
 * RBDex files use CommonJS (exports.BattleMovedex etc.).  This adapter
 * creates a temporary `exports` object before each script loads and then
 * copies the result onto `window`.
 *
 * Load order in index.template.html must be:
 *   1. rbdex/moves.js
 *   2. rbdex/items.js
 *   3. rbdex/pokedex.js
 *   4. rbdex/abilities.js
 *   5. rbdex/rbdex_adapter.js   <-- this file (runs last, copies to window)
 */
(function () {
    'use strict';

    if (typeof window.exports === 'object') {
        if (window.exports.BattleMovedex && !window.BattleMovedex) {
            window.BattleMovedex = window.exports.BattleMovedex;
        }
        if (window.exports.BattleItems && !window.BattleItems) {
            window.BattleItems = window.exports.BattleItems;
        }
        if (window.exports.BattlePokedex && !window.BattlePokedex) {
            window.BattlePokedex = window.exports.BattlePokedex;
        }
        if (window.exports.BattleAbilities && !window.BattleAbilities) {
            window.BattleAbilities = window.exports.BattleAbilities;
        }
    }

    window.RBDex = {
        getMove: function (moveName) {
            if (!moveName || !window.BattleMovedex) return null;
            var id = moveName.toLowerCase().replace(/[^a-z0-9]+/g, '');
            return window.BattleMovedex[id] || null;
        },
        getItem: function (itemName) {
            if (!itemName || !window.BattleItems) return null;
            var id = itemName.toLowerCase().replace(/[^a-z0-9]+/g, '');
            return window.BattleItems[id] || null;
        },
        getSpecies: function (speciesName) {
            if (!speciesName || !window.BattlePokedex) return null;
            var id = speciesName.toLowerCase().replace(/[^a-z0-9]+/g, '');
            return window.BattlePokedex[id] || null;
        },
        getMoveDesc: function (moveName) {
            var m = this.getMove(moveName);
            return m ? (m.shortDesc || m.desc || '') : '';
        },
        getItemDesc: function (itemName) {
            var i = this.getItem(itemName);
            return i ? (i.desc || i.shortDesc || '') : '';
        },
        getAbilityDesc: function (abilityName) {
            if (!abilityName) return '';
            if (window.BattleAbilities) {
                var id = abilityName.toLowerCase().replace(/[^a-z0-9]+/g, '');
                var a = window.BattleAbilities[id];
                if (a) return a.desc || a.shortDesc || '';
            }
            return '';
        }
    };
})();
