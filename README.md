# Pokemon Run and Bun Calculator Ultimate

**The ultimate tool for the Pokemon Run and Bun ROM hack.**

This project combines the advanced damage calculation features of the [SylmarDev calculator](https://github.com/SylmarDev/syl-rnb-calc) with the essential savefile import functionality from the [unc calculator](https://github.com/unclest/rnbsavefile), plus a full Battle Planner, Range Compare tool, and AI move prediction engine.

**Current Version: 2.4.3**

## Current Status

### What Works

- **Core Damage Calculator** -- Full Smogon-based damage calc with Run and Bun specific data (custom species stats, moves, abilities, items, learnsets)
- **AI Move Prediction** -- ~2,600 lines of custom AI logic that generates probability distributions for what move an AI opponent will choose, factoring in kill detection, setup opportunities, status moves, recovery, priority, and dozens of special cases
- **Savefile Import** -- Parse Pokemon Emerald `.sav` files to extract party and PC Pokemon (species, IVs, EVs, nature, moves, items, ability)
- **Trainer/Boss Sets** -- ~1,626 individual trainer-Pokemon sets across ~672 unique trainer encounters, selectable and searchable by trainer name
- **Battle Planner** -- Tree-based multi-turn battle simulation with
  outcome-relevant branching, exact probability tracking, and state management
- **Outcome-Relevant Branching** -- The planner does not enumerate all 16 damage
  rolls. Each node carries a *distribution* of concrete states, and a branch is
  created only where an outcome genuinely diverges (something faints, a berry
  fires, a status lands, an item is consumed). Rolls that change nothing stay in
  one branch but are still carried in full, so a distinction that only becomes
  relevant two turns later can still be split then. `recheckBranches()` replays
  the whole tree from the root, adding branches that have become relevant,
  collapsing ones that stopped mattering, and marking paths that can no longer
  happen. See `src/js/battle_planner_branching.js`
- **Range Compare** -- Compare damage ranges across different move/set combinations with chart visualization
- **Custom RnB Moves** -- Paleo Wave (85 BP, Rock, Special) and Shadow Strike (80 BP, Ghost, Physical) fully integrated in the calc engine
- **Custom RnB Items** -- Soul Dew functions as Choice Specs/Assault Vest equivalent for Latios/Latias (matching the ROM hack)
- **Dark Mode** -- Toggleable dark/light theme with persistence
- **Export All** -- Export all imported sets at once
- **Color Codings** -- Persist between sessions
- **Mega Evolution** -- Proper ability/stat switching on form change

### Deliberate RnB divergences from standard Smogon mechanics

These are **intentional** and match the ROM, not bugs. They are called out here
because they make this fork's numbers differ from any other calculator:

- **Explosion / Self-Destruct halve the target's Defense** (`gen789.ts`), which
  standard Gen 5+ removed
- **Terrain boosts damage by 1.5x, not 1.3x** (`gen789.ts`, `terrainMultiplier`)
- **Paralysis leaves 25% Speed, not 50%** (`mechanics/util.ts`)
- **Gen 9 rebalances applied at gen 8** -- Cresselia, Zacian(-Crowned),
  Zamazenta(-Crowned) stats and Glacial Lance / Grassy Glide / Wicked Blow BP
- **~135 species have RnB-specific primary abilities** (`RNB_ABILITY_PATCH` in
  `calc/src/data/species.ts`)
- **Soul Dew** acts as Choice Specs / Assault Vest for Latios and Latias

`calc/src/test/data.test.ts` cross-validates the damage engine's data against
`src/js/data/rbdex/` on every run, so these cannot silently drift apart again.

### Known Issues (Bugs)

- **Sitrus/Figy Berry + Unburden** -- Does not affect defender's speed
  (acknowledged in `mechanics/util.ts`)
- **`splitKeyString` / `setKeyStrings` in `ai.ts`** -- Both iterated arrays with
  `for...in`, so they walked indices instead of values; one of them appears to
  be compensated for by an inverted filter ("I have no idea why this needs to be
  inversed"). Behaviour is preserved as-is and flagged in the code -- untangling
  it changes real AI probabilities and needs expected-output tests first
- **Damaging speed/attack reduction moves** -- Score of 0 lets them get kill
  bonuses incorrectly
- **Triple Axel / Triple Kick** -- BP calculation described as "hacks" in code
  comments; noted as "bugged" in the UI
- **Dynamax HP** -- Pokemon constructor expects non-Dynamaxed HP, but Dynamaxed
  values may be passed in some flows
- **Doubles** -- The AI engine has ~15 TODO markers for doubles mechanics
- **Side-collapser layout** -- A stray semicolon that made `- relativeHeight` a
  no-op was fixed; the collapser's positioning is worth an eyeball in the UI

---

## Roadmap: What's Still Missing

This is an exhaustive list of everything needed to make a 100% perfect calculator for Run and Bun players.

### Calculation Engine

- [x] **Drain/recoil move HP adjustment** -- Applied by both the turn executor and the branching engine, sized off the damage actually dealt
- [ ] **Sun-based recovery** -- Morning Sun / Synthesis / Moonlight recovery percentage is hardcoded to `1` (100%); should use actual weather-dependent fractions (2/3 in sun, 1/4 in rain/sand/hail)
- [ ] **Fling power data** -- Hardcoded in `items.ts` instead of being in the data files
- [ ] **Move data flags migration** -- Flat booleans (`makesContact`, `isPunch`, etc.) need migration to proper `flags` object
- [ ] **`heal` flag** -- Not yet added to the move interface (`data/interface.ts:91`)
- [ ] **Recoil damage description** -- Should return exact HP recoil, not just a description (`desc.ts:149`)
- [ ] **Parental Bond approximation** -- Acknowledged as needing a better formula (`desc.ts:819`)
- [ ] **Max Move detection** -- Checking `basePower === 10` for Max move detection is fragile (`move.ts:72`)
- [ ] **`baseStats` rename** -- Species data uses `bs` shorthand instead of `baseStats` (`data/species.ts:6`)
- [x] **Full species stat cross-validation** -- All 1,137 species checked (stats, types, abilities) by `data.test.ts` on every run
- [x] **Full move data cross-validation** -- All 758 moves checked (BP, type, category) by `data.test.ts`, plus every move used by the 1,626 trainer sets

### AI Move Prediction

- [ ] **Multi-hit moves** -- Pin Missile and similar need damage calculation updates for AI scoring
- [ ] **Explosion / Final Gambit / Rollout** -- Kill checking needs rework for these moves
- [ ] **Tail Glow** -- Needs testing in AI scoring
- [ ] **Flame Charge** -- No documentation or consensus on AI score; currently unhandled
- [ ] **Sleep Talk** -- No documentation or consensus; assumed +6 if asleep but not implemented
- [ ] **Shore Up** -- Not implemented in AI scoring
- [ ] **Crit handling in AI** -- Consider turning off crits except where crit should be guaranteed
- [ ] **Thaw moves** -- Not accounted for in AI scoring
- [ ] **Truant ability** -- Not handled in AI prediction
- [x] **`statusApplyingMoves` array** -- Now lists 17 moves and applies a -40 score when the target is already statused

### Doubles Support (AI)

The AI system has ~15 separate TODO markers for doubles mechanics:
- [ ] Icy Wind / Electroweb spread damage
- [ ] Spread move targeting and reduction
- [ ] Protect usage in doubles context
- [ ] Tailwind for doubles
- [ ] Helping Hand
- [ ] Trick Room in doubles
- [ ] Sleep moves + Hex interaction in doubles
- [ ] Coaching
- [ ] General doubles move selection logic

### Battle Planner -- Missing End-of-Turn Effects

- [x] **Leech Seed** damage/drain
- [x] **Curse** (Ghost-type) residual damage
- [x] **Grassy Terrain** healing
- [x] **Rain Dish / Ice Body** ability healing
- [x] **Dry Skin** damage (Sun) and healing (Rain)
- [x] **Poison Heal** ability
- [ ] **Wish** delayed healing
- [x] **Aqua Ring** healing
- [x] **Ingrain** healing
- [ ] **Snow** (Gen 9) -- no distinction from Hail; Snow gives Ice-types a Defense boost without chip damage

### Battle Planner -- Missing Item Effects

Only Leftovers, Black Sludge, Sitrus Berry, and Oran Berry have end-of-turn effects. Missing:
- [x] **Flame Orb** activation
- [x] **Toxic Orb** activation
- [x] **Figy / Wiki / Mago / Aguav / Iapapa Berries** (pinch berries)
- [ ] **Focus Band** -- Flagged but not functionally implemented
- [ ] **Other passive items** with end-of-turn or triggered effects

### Battle Planner -- Other Missing Features

- [x] **Pokedex number mapping** -- Now sourced from RBDex `num` for all ~1,137 species instead of ~20 hardcoded entries
- [ ] **Post-KO switch-in AI** -- Deterministic switch order display (except for crit variance cases)
- [ ] **Switch percentage** -- Show AI switch probability underneath moves (rare but important edge case)

### Savefile Import Gaps

- [ ] **Only reads 2 of 14 PC boxes** -- PCA and PCB only; boxes 3-14 are ignored
- [ ] **Gender not parsed** -- All Pokemon default to male regardless of actual gender (personality value gender bit not read)
- [ ] **No nickname support** -- Pokemon nicknames are not extracted from save data
- [ ] **Emerald-only** -- Only supports save files of exactly 131,072 or 131,088 bytes; FireRed, LeafGreen, Ruby, Sapphire saves are not supported (may not be needed for RnB specifically)

### RBDex Data Gaps

- [ ] **Paleo Wave missing from `rbdex/moves.js`** -- No tooltip or description data in the UI for this custom move
- [ ] **Shadow Strike missing from `rbdex/moves.js`** -- Same issue
- [ ] **Paleo Wave / Shadow Strike missing from `rbdex/learnsets.js`** -- Learnset checker cannot show which Pokemon learn these moves
- [ ] **~29 Pokedex species without learnset entries** -- Likely alternate formes; should verify they inherit correctly

### UI / UX Improvements Needed

- [ ] **Move rate display** -- Show how often the AI selects each move as a percentage (acknowledged as desired: "one day...")
- [ ] **Crit toggle improvements** -- Auto-set crit buttons for guaranteed-crit moves (Frost Breath, Super Luck + Scope Lens + high-crit moves); show crit rate as percentage next to toggle
- [ ] **Stat boosts layout** -- Move stat boost controls to be horizontal and closer to the top for easier access
- [ ] **Battle visualization** -- Show what the in-game screen would look like between the two calc panels (requires backsprites)
- [ ] **Pie chart visualization** -- Chart.js (or similar) visualization of AI move probabilities for visual learners
- [ ] **Survival chance calculator** -- Port the existing Python implementation to the web app
- [ ] **Range Compare: custom moves** -- Add button to create a custom move with name, damage rolls, crit rate, and crit damage rolls
- [ ] **Range Compare: moves stored as attacks** -- Moves should store all current field effects and attacker stats
- [ ] **Range Compare: stat stage changes** -- Show crit rate and stat stage changes in the display
- [ ] **Range Compare: -1 atk/-1 def handling** -- Doesn't handle attacker/target stat drops
- [ ] **Range Compare: resizer** -- Add a drag handle to resize the Range Compare panel
- [ ] **Range Compare: item dropdown sync** -- Changing item on Range Compare dropdown should update the target panel
- [ ] **Range Compare: HP comparison validation** -- HP comparison box should reject negative values and letters
- [ ] **Range Compare: styling** -- Compare HP submit button should match `.btn-range-add` style
- [ ] **Remove all items button** -- Set all box Pokemon to have no items
- [ ] **Quick-tick buttons** -- Toggleable buttons for Sitrus Berry heal, burn tick, poison tick, sand tick
- [ ] **Min/max roll visibility** -- Draw more attention to min and max damage rolls
- [ ] **Crit + non-crit combined view** -- Show crit rolls alongside normal rolls (toggleable)
- [ ] **Notes under AI Options** -- Disclaimers when a percentage is murky or may not display correctly
- [ ] **Box customization** -- Renameable boxes, add more boxes, Pokemon remember their box assignments (localStorage)
- [ ] **Suggestions/bug report link** -- In-app feedback mechanism
- [ ] **Debug logging toggle** -- Range Compare has debug TODO that should be a proper toggle

### Code Quality / Technical Debt

- [ ] **`battle_planner_ui.js` is 7,669 lines** -- Should be split into separate concerns (modals, rendering, events, state)
- [ ] **Refactor `ai.ts` pushes** -- All `pushes to moveStringsToAdd` should use a shared function
- [ ] **Remove `scripts/` folder** -- Contains obsolete Python utilities
- [ ] **Gen 2 damage tests** -- Missing tests for "damage always rounded up to 1" (`gen12.ts:216`)
- [ ] **Gigantamax cleanup** -- `pokemon.ts:74` and test files note cleanup needed for proper Gigantamax support
- [ ] **Security vulnerabilities** -- Noted as "must have" in ver-2.md (not audited)
- [ ] **Analytics** -- Track usage: calc count, toggle preferences, user count

---

## How to Use

1. **Open the Calculator**: Visit the hosted version or open `dist/index.html` locally
2. **Import Save**:
   - Scroll to the "Import / Export" section
   - Click **"Import from Savefile"**
   - Select your `.sav` file (Pokemon Emerald save)
   - *Alternatively, drag and drop your `.sav` file into the import text area*
3. **Select Opponent**: Search by trainer name or Pokemon to load boss encounter sets
4. **Calculate**: Your imported Pokemon will appear in the "Custom Set" list for the Player side. Select one to see how it fares against the opponent.
5. **AI Prediction**: Toggle AI options to see probability distributions for what moves the opponent is likely to click
6. **Battle Planner**: Use the Battle Planner to simulate multi-turn encounters with branching outcomes
7. **Range Compare**: Save and compare damage ranges across different scenarios

## Development

If you want to run this locally or contribute:

1. **Clone the repository:**
    ```bash
    git clone https://github.com/SynchEleven/rnb-calc-ultimate.git
    cd rnb-calc-ultimate
    ```

2. **Install dependencies:**
    ```bash
    npm install
    ```

3. **Build the project:**
    ```bash
    npm run build
    ```

4. **Run locally:**
    ```bash
    npm start
    ```
    Then open `http://localhost:3000` in your browser.

5. **Run tests:**
    ```bash
    npm run test:all
    ```

## Architecture

```
rnb-calc-ultimate/
  calc/           -- @smogon/calc TypeScript damage calculation engine
    src/
      ai.ts       -- AI move prediction engine (~2,600 lines)
      mechanics/  -- Generation-specific damage formulas
      data/       -- Static game data (abilities, items, moves, species, types)
  src/            -- Frontend (vanilla JS + jQuery)
    js/
      battle_planner*.js   -- Multi-turn battle simulation
      calc_integration.js  -- Bridge between calc engine and planner
      range_compare.js     -- Damage range comparison tool
      gen3_loadsave.js     -- .sav file parser
      shared_controls.js   -- Core UI logic
      data/
        rbdex/    -- Run and Bun specific Pokemon data
        sets/     -- Trainer/boss encounter sets (gen8.js)
  dist/           -- Built output (generated by npm run build)
  server.js       -- Express server for production
```

## Credits

- **rnb-calc-ultimate**: Maintained by [SynchEleven](https://github.com/SynchEleven)
- **syl-rnb-calc**: Created by [SylmarDev](https://github.com/SylmarDev), adding AI move prediction, Range Compare, and significant QoL improvements
- **unc**: Created by [unclest](https://github.com/unclest), implementing the original Gen 3 savefile parsing logic
- **Smogon Damage Calc**: The original foundation, created by [Honko](https://github.com/Honko) and maintained by [Austin](https://github.com/Austin-Williams) and others
- **Croven**: AI behavior documentation (Pokemon Run and Bun 1.07 AI document)
