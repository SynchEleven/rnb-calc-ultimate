/**
 * Battle Planner Template
 *
 * Contains the HTML/CSS template for the Battle Planner UI.
 * Extracted from battle_planner_ui.js for maintainability.
 *
 * Exposes: window.BattlePlannerTemplate.getHTML()
 */

(function (window) {
    'use strict';

    function getHTML() {
        return `
            <style>
                /* KO Highlighting for Moves - reduced opacity, enforced white text */
                .move-cell.match-dmg-1,
                .move-cell.match-dmg-2,
                .move-cell.match-dmg-3,
                .move-cell.match-dmg-4 {
                    color: #fff !important;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.7) !important;
                }
                .move-cell.match-dmg-1 .dmg-range,
                .move-cell.match-dmg-1 .dmg-percent,
                .move-cell.match-dmg-1 .crit-range,
                .move-cell.match-dmg-1 .move-cell-name,
                .move-cell.match-dmg-2 .dmg-range,
                .move-cell.match-dmg-2 .dmg-percent,
                .move-cell.match-dmg-2 .crit-range,
                .move-cell.match-dmg-2 .move-cell-name,
                .move-cell.match-dmg-3 .dmg-range,
                .move-cell.match-dmg-3 .dmg-percent,
                .move-cell.match-dmg-3 .crit-range,
                .move-cell.match-dmg-3 .move-cell-name,
                .move-cell.match-dmg-4 .dmg-range,
                .move-cell.match-dmg-4 .dmg-percent,
                .move-cell.match-dmg-4 .crit-range,
                .move-cell.match-dmg-4 .move-cell-name {
                    color: #fff !important;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.7) !important;
                }
                .move-cell.match-dmg-1 {
                    background: rgba(76, 175, 80, 0.25) !important;
                    border-left: 4px solid #4caf50;
                    box-shadow: inset 0 0 8px rgba(76, 175, 80, 0.3) !important;
                }
                .move-cell.match-dmg-2 {
                    background: rgba(255, 215, 0, 0.2) !important;
                    border-left: 4px solid #ffd700;
                    box-shadow: inset 0 0 8px rgba(255, 215, 0, 0.25) !important;
                }
                /* Opponent side follows Orange/Red rules */
                .move-cell.match-dmg-3 {
                    background: rgba(255, 140, 0, 0.2) !important;
                    border-left: 4px solid #ff8c00;
                    box-shadow: inset 0 0 8px rgba(255, 140, 0, 0.3) !important;
                }
                .move-cell.match-dmg-4 {
                    background: rgba(211, 47, 47, 0.25) !important;
                    border-left: 4px solid #d32f2f;
                    box-shadow: inset 0 0 8px rgba(211, 47, 47, 0.3) !important;
                }

                /* Matchup Color Coding (Speed Borders) */
                .team-overview-slot.match-speed-f, .box-slot.match-speed-f { border-color: #4fc3f7 !important; border-width: 2px !important; }
                .team-overview-slot.match-speed-t, .box-slot.match-speed-t { border-color: #ba68c8 !important; border-width: 2px !important; }
                .team-overview-slot.match-speed-s, .box-slot.match-speed-s { border-color: #555 !important; border-width: 2px !important; }

                /* Matchup Color Coding (OHKO Backgrounds) */
                .match-dmg-1, .match-dmg-W1 { background: rgba(76, 175, 80, 0.25) !important; box-shadow: inset 0 0 8px rgba(76, 175, 80, 0.3) !important; }
                .match-dmg-2, .match-dmg-W2 { background: rgba(255, 215, 0, 0.2) !important; box-shadow: inset 0 0 8px rgba(255, 215, 0, 0.25) !important; }
                .match-dmg-3 { background: rgba(255, 140, 0, 0.2) !important; box-shadow: inset 0 0 8px rgba(255, 140, 0, 0.3) !important; }
                .match-dmg-4 { background: rgba(211, 47, 47, 0.25) !important; box-shadow: inset 0 0 8px rgba(211, 47, 47, 0.3) !important; }
                
                .match-dmg-13, .match-dmg-14, .match-dmg-23, .match-dmg-24 { 
                    box-shadow: inset 0 0 8px rgba(255, 255, 255, 0.05) !important;
                    color: #fff !important;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.7) !important;
                }
                .match-dmg-13 { background: linear-gradient(135deg, rgba(76, 175, 80, 0.3) 50%, rgba(255, 140, 0, 0.3) 50%) !important; }
                .match-dmg-14 { background: linear-gradient(135deg, rgba(76, 175, 80, 0.3) 50%, rgba(211, 47, 47, 0.3) 50%) !important; }
                .match-dmg-23 { background: linear-gradient(135deg, rgba(255, 215, 0, 0.3) 50%, rgba(255, 140, 0, 0.3) 50%) !important; }
                .match-dmg-24 { background: linear-gradient(135deg, rgba(255, 215, 0, 0.3) 50%, rgba(211, 47, 47, 0.3) 50%) !important; }
                
                .match-dmg-W, .match-dmg-W1, .match-dmg-W2 { box-shadow: inset 3px 0 0 #ffffff !important; }
                .match-dmg-W { background: none !important; }

                .match-dmg-1 img, .match-dmg-2 img, .match-dmg-3 img, .match-dmg-4 img, 
                .match-dmg-13 img, .match-dmg-14 img, .match-dmg-23 img, .match-dmg-24 img,
                .match-dmg-W img, .match-dmg-WMO img {
                    filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5));
                }

                /* Legend Styles */
                .legend-divider {
                    height: 1px;
                    background: rgba(255,255,255,0.1);
                    margin: 8px 0;
                }
                .legend-swatch {
                    display: inline-block;
                    width: 14px;
                    height: 14px;
                    border-radius: 3px;
                    margin-right: 8px;
                    vertical-align: middle;
                    border: 1px solid rgba(255,255,255,0.4);
                    box-sizing: border-box;
                }
                .legend-swatch.match-speed-f { border: 2px solid #4fc3f7; }
                .legend-swatch.match-speed-t { border: 2px solid #ba68c8; }
                .legend-swatch.match-speed-s { border: 2px solid #555; }
                .legend-item {
                    display: flex !important;
                    align-items: center;
                    margin-bottom: 4px;
                    font-size: 0.85em;
                }
                .legend-item .tree-ko-marker {
                    margin-right: 8px;
                    width: 14px;
                    text-align: center;
                }
            </style>
            <div id="battle-planner" class="battle-planner-container" style="display: none;">
                <div class="planner-tooltip" id="planner-tooltip" style="display:none;"></div>
                <!-- Pokedex Overlay -->
                <div class="dex-overlay" id="dex-overlay" style="display:none;">
                    <div class="dex-overlay-backdrop" id="dex-backdrop"></div>
                    <div class="dex-overlay-panel">
                        <div class="dex-overlay-header">
                            <span class="dex-overlay-title">Pokedex</span>
                            <button class="dex-overlay-close" id="dex-close">&times;</button>
                        </div>
                        <div class="dex-overlay-search">
                            <input type="text" id="dex-search-input" placeholder="Search Pokemon, moves, abilities, items, types, or more" autocomplete="off">
                            <button class="dex-search-clear" id="dex-search-clear">&times;</button>
                        </div>
                        <div class="dex-overlay-tabs">
                            <button class="dex-tab-btn active" data-dex-tab="all">Search</button>
                            <button class="dex-tab-btn" data-dex-tab="pokemon">Pokemon</button>
                            <button class="dex-tab-btn" data-dex-tab="moves">Moves</button>
                            <button class="dex-tab-btn" data-dex-tab="items">Items</button>
                            <button class="dex-tab-btn" data-dex-tab="abilities">Abilities</button>
                        </div>
                        <div class="dex-overlay-results" id="dex-results">
                            <p class="dex-placeholder">Type to search the Pokedex...</p>
                        </div>
                        <div class="dex-overlay-detail" id="dex-detail" style="display:none;">
                            <button class="dex-detail-back" id="dex-detail-back">&larr; Back</button>
                            <div class="dex-detail-content" id="dex-detail-content"></div>
                        </div>
                    </div>
                </div>
                <div class="planner-header">
                    <h2 class="planner-title">
                        <span class="planner-icon">⚔️</span>
                        Battle Planner
                    </h2>
                    <span id="planner-trainer-label" class="planner-trainer-label" style="display: none;"></span>
                    <div class="planner-controls">
                        <button class="planner-btn planner-btn-view active" data-view="split" title="Split View">Split</button>
                        <button class="planner-btn planner-btn-view" data-view="tree" title="Tree View">Tree</button>
                        <button class="planner-btn planner-btn-view" data-view="stage" title="Stage View">Stage</button>
                        <span class="planner-separator">|</span>
                        <button class="planner-btn planner-btn-action" id="planner-select-trainer" title="Select Opponent Trainer">Trainers</button>
                        <button class="planner-btn planner-btn-action" id="planner-new" title="Reset Battle - Clears timeline only">Reset</button>
                        <button class="planner-btn planner-btn-action" id="planner-import" title="Import State">Import</button>
                        <button class="planner-btn planner-btn-action" id="planner-export" title="Export Plan">Export</button>
                        <button class="planner-btn planner-btn-action" id="planner-script" title="Battle Script - Play through your plan">Script</button>
                        <button class="planner-btn planner-btn-help" id="planner-help" title="How to Use">?</button>
                        <button class="planner-btn planner-btn-close" id="planner-close" title="Close Planner">×</button>
                    </div>
                </div>
                
                <div class="planner-body">
                    <!-- Timeline Tree Panel -->
                    <div class="planner-panel planner-tree-panel">
                        <div class="panel-header">
                            <span class="panel-title">TIMELINE</span>
                            <div class="panel-actions">
                                <button class="panel-btn" id="tree-expand-all" title="Expand All">▼</button>
                                <button class="panel-btn" id="tree-collapse-all" title="Collapse All">▶</button>
                            </div>
                        </div>
                        <div class="panel-content" id="tree-container">
                            <div class="tree-placeholder">
                                <div class="placeholder-icon">📋</div>
                                <p class="placeholder-title">No Battle Started</p>
                                <p class="placeholder-desc">Start a battle simulation to plan your moves</p>
                                <button class="planner-btn planner-btn-primary" id="tree-start-battle">
                                    Load from Calculator
                                </button>
                                <button class="planner-btn planner-btn-secondary" id="tree-start-imported">
                                    Use Imported Team
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Round Stage Panel -->
                    <div class="planner-panel planner-stage-panel">
                        <div class="panel-header">
                            <span class="panel-title" id="stage-turn-label">TURN 0</span>
                            <div class="panel-actions">
                                <button class="panel-btn" id="stage-prev" title="Previous Turn">◀</button>
                                <button class="panel-btn" id="stage-next" title="Next Turn">▶</button>
                            </div>
                        </div>
                        <div class="panel-content" id="stage-container">
                            <!-- Pokedex Floating Button -->
                            <div class="dex-tab" id="dex-tab">DEX</div>
                            <!-- Speed info moved to move cards -->
                            
                            <div class="stage-field">
                                <!-- P1 Pokemon Card -->
                                <div class="pokemon-card pokemon-card-p1" id="stage-p1">
                                    <div class="card-header">
                                        <img class="card-header-sprite" id="stage-p1-sprite" src="" alt="P1">
                                        <div class="card-header-info">
                                            <span class="card-label">PLAYER</span>
                                            <span class="card-name" id="stage-p1-name">---</span>
                                            <span class="card-level" id="stage-p1-level">Lv. --</span>
                                        </div>
                                        <div class="card-types" id="stage-p1-types"></div>
                                        <button class="card-switch-btn" id="p1-card-switch-btn" title="Switch Pokemon (uses your turn)">&#8644;</button>
                                    </div>
                                    <div class="card-body">
                                        <div class="card-hp-container">
                                            <div class="card-hp-bar">
                                                <div class="card-hp-fill" id="stage-p1-hp-fill"></div>
                                                <div class="card-hp-shadow" id="stage-p1-hp-shadow"></div>
                                            </div>
                                            <span class="card-hp-text" id="stage-p1-hp-text">---/---</span>
                                        </div>
                                        <div class="card-meta-row">
                                            <span class="card-ability" id="stage-p1-ability"></span>
                                            <span class="card-item" id="stage-p1-item"></span>
                                            <span class="card-status" id="stage-p1-status"></span>
                                            <span class="card-boosts" id="stage-p1-boosts"></span>
                                        </div>
                                        <div class="card-stats-row" id="stage-p1-stats-mini"></div>
                                    </div>
                                    <div class="card-moves" id="stage-p1-moves"></div>
                                </div>
                                
                                <!-- VS Indicator -->
                                <div class="stage-vs">
                                    <span class="vs-text">VS</span>
                                    <div class="vs-matchup" id="vs-matchup"></div>
                                </div>
                                
                                <!-- P2 Pokemon Card -->
                                <div class="pokemon-card pokemon-card-p2" id="stage-p2">
                                    <div class="card-header">
                                        <img class="card-header-sprite" id="stage-p2-sprite" src="" alt="P2">
                                        <div class="card-header-info">
                                            <span class="card-label">OPPONENT</span>
                                            <span class="card-name" id="stage-p2-name">---</span>
                                            <span class="card-level" id="stage-p2-level">Lv. --</span>
                                        </div>
                                        <div class="card-types" id="stage-p2-types"></div>
                                        <div class="card-nav-btns" id="p2-nav-btns" style="display:none;">
                                            <button class="card-nav-btn" id="p2-nav-prev" title="Previous enemy Pokemon">&#9664;</button>
                                            <button class="card-nav-btn" id="p2-nav-next" title="Next enemy Pokemon">&#9654;</button>
                                        </div>
                                        <button class="card-switch-btn" id="p2-card-switch-btn" title="Switch Pokemon (uses opponent's turn)">&#8644;</button>
                                    </div>
                                    <div class="card-body">
                                        <div class="card-hp-container">
                                            <div class="card-hp-bar">
                                                <div class="card-hp-fill" id="stage-p2-hp-fill"></div>
                                                <div class="card-hp-shadow" id="stage-p2-hp-shadow"></div>
                                            </div>
                                            <span class="card-hp-text" id="stage-p2-hp-text">---/---</span>
                                        </div>
                                        <div class="card-meta-row">
                                            <span class="card-ability" id="stage-p2-ability"></span>
                                            <span class="card-item" id="stage-p2-item"></span>
                                            <span class="card-status" id="stage-p2-status"></span>
                                            <span class="card-boosts" id="stage-p2-boosts"></span>
                                        </div>
                                        <div class="card-stats-row" id="stage-p2-stats-mini"></div>
                                    </div>
                                    <div class="card-moves" id="stage-p2-moves"></div>
                                </div>
                            </div>
                            
                            <!-- Turn Actions Panel -->
                            <div class="turn-actions-panel" id="turn-actions-panel">
                                <div class="turn-header">
                                    <span class="turn-title">TURN ACTIONS</span>
                                    <label class="ai-branch-toggle" title="When ticked, AI tied moves auto-branch on execute"><input type="checkbox" id="ai-branch-checkbox"> AI Branch</label>
                                    <button class="turn-execute-btn" id="execute-turn" disabled>Execute Turn</button>
                                </div>
                                <div class="turn-selections">
                                    <div class="turn-selection turn-selection-p1">
                                        <div class="turn-selection-header">
                                            <span class="turn-label">YOUR MOVE:</span>
                                        </div>
                                        <span class="turn-move" id="p1-selected-move">Select a move</span>
                                        <div class="turn-action-modifiers" id="p1-action-modifiers" style="display:none;">
                                            <button class="action-modifier-btn crit-btn" id="p1-crit-btn" title="Critical Hit">💥 Crit</button>
                                            <button class="action-modifier-btn effect-btn" id="p1-effect-btn" title="Additional Effects">⚙️ Effects</button>
                                        </div>
                                    </div>
                                    <div class="turn-selection turn-selection-p2">
                                        <div class="turn-selection-header">
                                            <span class="turn-label">OPPONENT'S MOVE:</span>
                                        </div>
                                        <span class="turn-move" id="p2-selected-move">Select a move</span>
                                        <div class="turn-action-modifiers" id="p2-action-modifiers" style="display:none;">
                                            <button class="action-modifier-btn crit-btn" id="p2-crit-btn" title="Critical Hit">💥 Crit</button>
                                            <button class="action-modifier-btn effect-btn" id="p2-effect-btn" title="Additional Effects">⚙️ Effects</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Probability Cloud / Turn Preview -->
                            <div id="cloud-outcomes" class="cloud-outcomes"></div>
                            
                            <!-- Status/Effect Editor Modal -->
                            <div id="effect-editor-modal" class="planner-modal" style="display: none;">
                                <div class="modal-overlay"></div>
                                <div class="modal-content modal-content-wide">
                                    <div class="modal-header">
                                        <h3>⚡ Apply Status / Effect</h3>
                                        <button class="modal-close" id="effect-editor-close">×</button>
                                    </div>
                                    <div class="modal-body">
                                        <div class="effect-target-selector">
                                            <label>Apply to:</label>
                                            <select id="effect-target">
                                                <option value="p1">Your Pokemon</option>
                                                <option value="p2">Opponent's Pokemon</option>
                                            </select>
                                        </div>
                                        <div class="effect-sections">
                                            <div class="effect-section">
                                                <h4>Status Conditions</h4>
                                                <div class="effect-buttons" id="status-buttons">
                                                    <button class="effect-btn" data-effect="psn">Poison</button>
                                                    <button class="effect-btn" data-effect="tox">Toxic</button>
                                                    <button class="effect-btn" data-effect="brn">Burn</button>
                                                    <button class="effect-btn" data-effect="par">Paralysis</button>
                                                    <button class="effect-btn" data-effect="slp">Sleep</button>
                                                    <button class="effect-btn" data-effect="frz">Freeze</button>
                                                    <button class="effect-btn effect-btn-clear" data-effect="none">Clear Status</button>
                                                </div>
                                            </div>
                                            <div class="effect-section">
                                                <h4>Stat Changes</h4>
                                                <div class="stat-change-grid">
                                                    <div class="stat-row" data-stat="atk"><span>Attack</span><button class="stat-btn stat-down" data-mod="-1">-1</button><span class="stat-value" id="stat-atk">0</span><button class="stat-btn stat-up" data-mod="+1">+1</button></div>
                                                    <div class="stat-row" data-stat="def"><span>Defense</span><button class="stat-btn stat-down" data-mod="-1">-1</button><span class="stat-value" id="stat-def">0</span><button class="stat-btn stat-up" data-mod="+1">+1</button></div>
                                                    <div class="stat-row" data-stat="spa"><span>Sp. Atk</span><button class="stat-btn stat-down" data-mod="-1">-1</button><span class="stat-value" id="stat-spa">0</span><button class="stat-btn stat-up" data-mod="+1">+1</button></div>
                                                    <div class="stat-row" data-stat="spd"><span>Sp. Def</span><button class="stat-btn stat-down" data-mod="-1">-1</button><span class="stat-value" id="stat-spd">0</span><button class="stat-btn stat-up" data-mod="+1">+1</button></div>
                                                    <div class="stat-row" data-stat="spe"><span>Speed</span><button class="stat-btn stat-down" data-mod="-1">-1</button><span class="stat-value" id="stat-spe">0</span><button class="stat-btn stat-up" data-mod="+1">+1</button></div>
                                                    <button class="effect-btn effect-btn-clear" id="clear-stat-changes">Reset All Stats</button>
                                                </div>
                                            </div>
                                            <div class="effect-section">
                                                <h4>Other Effects</h4>
                                                <div class="effect-buttons">
                                                    <button class="effect-btn" data-effect="confusion">Confusion</button>
                                                    <button class="effect-btn" data-effect="flinch">Flinch</button>
                                                    <button class="effect-btn" data-effect="leechseed">Leech Seed</button>
                                                    <button class="effect-btn" data-effect="curse">Curse</button>
                                                    <button class="effect-btn" data-effect="taunt">Taunt (3 turns)</button>
                                                    <button class="effect-btn" data-effect="encore">Encore (3 turns)</button>
                                                </div>
                                            </div>
                                            <div class="effect-section">
                                                <h4>Duration (for timed effects)</h4>
                                                <div class="duration-selector">
                                                    <label>Turns remaining:</label>
                                                    <input type="number" id="effect-duration" min="1" max="10" value="3">
                                                </div>
                                            </div>
                                        </div>
                                        <div class="effect-actions">
                                            <button class="planner-btn planner-btn-primary" id="apply-effects-btn">Apply Changes</button>
                                            <button class="planner-btn" id="cancel-effects-btn">Cancel</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Move Effects Modal -->
                            <div id="move-effects-modal" class="planner-modal" style="display: none;">
                                <div class="modal-overlay"></div>
                                <div class="modal-content">
                                    <div class="modal-header">
                                        <h3>⚙️ <span id="move-effects-title">Move Effects</span></h3>
                                        <button class="modal-close" id="move-effects-close">×</button>
                                    </div>
                                    <div class="modal-body">
                                        <div class="move-effect-options">
                                            <label><input type="checkbox" id="me-no-damage"> Move deals 0 damage this turn</label>
                                            <label><input type="checkbox" id="me-invulnerable"> User is invulnerable this turn (Fly, Dig, etc.)</label>
                                            <label><input type="checkbox" id="me-switch-self"> User switches out after move (U-turn, Volt Switch)</label>
                                            <label><input type="checkbox" id="me-switch-target"> Target is forced to switch out (Roar, Whirlwind)</label>
                                            <div class="me-inline-option">
                                                <label>Self damage (recoil/crash): </label>
                                                <input type="number" id="me-self-damage" min="0" max="999" value="0" style="width:60px"> HP
                                            </div>
                                            <div class="me-inline-option">
                                                <label>Priority modifier: </label>
                                                <select id="me-priority-mod" style="width:80px">
                                                    <option value="0">Normal</option>
                                                    <option value="1">+1</option>
                                                    <option value="2">+2</option>
                                                    <option value="3">+3</option>
                                                    <option value="4">+4</option>
                                                    <option value="-1">-1</option>
                                                    <option value="-2">-2</option>
                                                    <option value="-3">-3</option>
                                                    <option value="-6">-6</option>
                                                    <option value="-7">-7</option>
                                                </select>
                                            </div>
                                        </div>
                                        <hr>
                                        <h4>Apply Status to Target</h4>
                                        <div class="effect-buttons" id="me-status-buttons">
                                            <button class="effect-btn" data-status="none">None</button>
                                            <button class="effect-btn" data-status="psn">Poison</button>
                                            <button class="effect-btn" data-status="tox">Toxic</button>
                                            <button class="effect-btn" data-status="brn">Burn</button>
                                            <button class="effect-btn" data-status="par">Paralysis</button>
                                            <button class="effect-btn" data-status="slp">Sleep</button>
                                            <button class="effect-btn" data-status="frz">Freeze</button>
                                        </div>
                                        <h4>Stat Changes (to Target)</h4>
                                        <div class="stat-change-row">
                                            <span>Atk:</span><input type="number" id="me-stat-atk" value="0" min="-6" max="6">
                                            <span>Def:</span><input type="number" id="me-stat-def" value="0" min="-6" max="6">
                                            <span>SpA:</span><input type="number" id="me-stat-spa" value="0" min="-6" max="6">
                                            <span>SpD:</span><input type="number" id="me-stat-spd" value="0" min="-6" max="6">
                                            <span>Spe:</span><input type="number" id="me-stat-spe" value="0" min="-6" max="6">
                                        </div>
                                        <h4>Stat Changes (to User)</h4>
                                        <div class="stat-change-row">
                                            <span>Atk:</span><input type="number" id="me-self-atk" value="0" min="-6" max="6">
                                            <span>Def:</span><input type="number" id="me-self-def" value="0" min="-6" max="6">
                                            <span>SpA:</span><input type="number" id="me-self-spa" value="0" min="-6" max="6">
                                            <span>SpD:</span><input type="number" id="me-self-spd" value="0" min="-6" max="6">
                                            <span>Spe:</span><input type="number" id="me-self-spe" value="0" min="-6" max="6">
                                        </div>
                                        <div class="effect-actions">
                                            <button class="planner-btn planner-btn-primary" id="apply-move-effects-btn">Apply to Move</button>
                                            <button class="planner-btn" id="cancel-move-effects-btn">Cancel</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Full Team Overview (Bottom) -->
                            <div class="team-overview-container" id="team-overview-container">
                                <div class="team-overview team-overview-p1" id="team-overview-p1">
                                    <div class="team-overview-header">
                                        <span class="team-overview-title">YOUR TEAM</span>
                                    </div>
                                    <div class="team-overview-slots" id="team-overview-slots-p1"></div>
                                    <div class="box-container" id="box-container-p1">
                                        <div class="box-header">
                                            <span class="box-title">📦 Box (drag Pokemon here)</span>
                                        </div>
                                        <div class="box-slots" id="box-slots-p1"></div>
                                    </div>
                                </div>
                                <div class="team-confirm-container">
                                    <button class="planner-btn planner-btn-primary" id="confirm-team-btn">
                                        ✓ Confirm Team &amp; Create New Battle
                                    </button>
                                </div>
                                <div class="team-overview team-overview-p2" id="team-overview-p2">
                                    <div class="team-overview-header">
                                        <span class="team-overview-title" id="p2-team-title">OPPONENT'S TEAM</span>
                                    </div>
                                    <div class="team-overview-slots" id="team-overview-slots-p2"></div>
                                    <!-- No box for opponent - they always have their full team -->
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- State Inspector Panel -->
                    <div class="planner-panel planner-inspector-panel">
                        <div class="panel-header">
                            <span class="panel-title">INSPECTOR</span>
                            <div class="panel-actions">
                                <button class="panel-btn panel-collapse-btn" id="inspector-collapse" title="Collapse">◀</button>
                            </div>
                        </div>
                        <div class="panel-content" id="inspector-container">
                            <div class="inspector-section">
                                <h4>Node Info</h4>
                                <div class="inspector-grid">
                                    <div class="inspector-field">
                                        <label>Turn:</label>
                                        <span id="inspector-turn">0</span>
                                    </div>
                                    <div class="inspector-field">
                                        <label>Probability:</label>
                                        <span id="inspector-probability">100%</span>
                                    </div>
                                    <div class="inspector-field inspector-field-wide">
                                        <label>Action:</label>
                                        <span id="inspector-action">-</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="inspector-section">
                                <h4>Field Conditions</h4>
                                <div class="inspector-grid">
                                    <div class="inspector-field">
                                        <label>Weather:</label>
                                        <span id="inspector-weather">None</span>
                                    </div>
                                    <div class="inspector-field">
                                        <label>Terrain:</label>
                                        <span id="inspector-terrain">None</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="inspector-section">
                                <h4>Player Side</h4>
                                <div class="inspector-tags" id="inspector-p1-effects"></div>
                            </div>
                            
                            <div class="inspector-section">
                                <h4>Opponent Side</h4>
                                <div class="inspector-tags" id="inspector-p2-effects"></div>
                            </div>
                            
                            <div class="inspector-section">
                                <h4>Notes</h4>
                                <textarea id="inspector-notes" placeholder="Add strategy notes..."></textarea>
                            </div>
                            
                            <div class="inspector-actions">
                                <button class="planner-btn planner-btn-primary" id="open-effect-editor">
                                    ⚡ Apply Status/Effect
                                </button>
                                <button class="planner-btn planner-btn-danger" id="inspector-delete-node">
                                    Delete Branch
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Help Modal -->
            <div id="planner-help-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>📖 Battle Planner Guide</h3>
                        <button class="modal-close" id="help-modal-close">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="guide-section">
                            <h4>🎯 What is the Battle Planner?</h4>
                            <p>The Battle Planner lets you simulate and plan Pokemon battles turn by turn. 
                            You can explore different move choices and see how the battle could play out under different scenarios (crits, misses, damage rolls).</p>
                        </div>
                        
                        <div class="guide-section">
                            <h4>🚀 Getting Started</h4>
                            <ol>
                                <li><strong>Set up Pokemon</strong> in the main calculator first</li>
                                <li>Click <strong>"Load from Calculator"</strong> to start planning</li>
                                <li>Or use <strong>"Use Imported Team"</strong> if you've loaded a savefile</li>
                            </ol>
                        </div>
                        
                        <div class="guide-section">
                            <h4>⚔️ Planning Moves</h4>
                            <ol>
                                <li>Click a <strong>move button</strong> on either Pokemon's card</li>
                                <li>View <strong>damage range, % of HP, and KO chance</strong> for each move</li>
                                <li>The <strong>Outcome Branches</strong> panel shows possible results</li>
                                <li>Click an outcome to <strong>create a branch</strong> in the timeline</li>
                            </ol>
                        </div>
                        
                        <div class="guide-section">
                            <h4>👥 Team Management</h4>
                            <ul>
                                <li>View both teams at the <strong>bottom of the screen</strong></li>
                                <li><strong>Click a Pokemon</strong> to switch it in</li>
                                <li><strong>Drag Pokemon</strong> to the Box to test different combinations</li>
                                <li>Drag from Box to Team to add Pokemon back</li>
                            </ul>
                        </div>
                        
                        <div class="guide-section">
                            <h4>🌳 Using the Timeline</h4>
                            <ul>
                                <li>Click any node to <strong>jump to that point</strong> in the battle</li>
                                <li>✗ / ✓ markers indicate Pokemon KOs</li>
                                <li>⚠ indicates a variance branch point</li>
                                <li>Use ◀ ▶ buttons to navigate turns</li>
                            </ul>
                        </div>
                        
                        <div class="guide-section">
                            <h4>📊 Understanding Move Info</h4>
                            <ul>
                                <li><strong>Damage Range</strong>: Min - Max damage numbers</li>
                                <li><strong>% HP</strong>: How much of defender's HP the move takes</li>
                                <li><strong>KO Chance</strong>: OHKO, 2HKO, etc.</li>
                                <li><strong>Effectiveness</strong>: Super effective, not very effective, etc.</li>
                                <li><strong>Speed</strong>: Who moves first (shown in speed bar)</li>
                            </ul>
                        </div>
                        
                        <div class="guide-section">
                            <h4>⌨️ Keyboard Shortcuts</h4>
                            <ul>
                                <li><kbd>P</kbd> - Toggle planner open/close</li>
                                <li><kbd>Esc</kbd> - Close planner</li>
                                <li><kbd>←</kbd> / <kbd>→</kbd> - Navigate turns</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Trainer Selector Modal -->
            <div id="trainer-select-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content modal-content-trainer">
                    <div class="modal-header">
                        <h3>Select Opponent Trainer</h3>
                        <button class="modal-close" id="trainer-modal-close">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="trainer-search-container">
                            <input type="text" id="trainer-search-input" placeholder="Search trainers by name..." class="trainer-search-input" autocomplete="off">
                        </div>
                        <div id="trainer-list" class="trainer-list"></div>
                    </div>
                </div>
            </div>

            <!-- Team Selection Modal -->
            <div id="team-select-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content modal-content-sm">
                    <div class="modal-header">
                        <h3 id="team-select-title">Select Pokemon</h3>
                        <button class="modal-close" id="team-modal-close">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="team-select-grid" id="team-select-grid"></div>
                    </div>
                </div>
            </div>
            
            <!-- Switch Selection Modal (for turn action, not immediate execution) -->
            <div id="switch-select-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content modal-content-sm">
                    <div class="modal-header">
                        <h3 id="switch-select-title">Select Switch Target</h3>
                        <button class="modal-close" id="switch-modal-close">×</button>
                    </div>
                    <div class="modal-body">
                        <p class="modal-hint">Select a Pokemon to switch to. The switch will be executed when you click "Execute Turn".</p>
                        <div class="switch-select-grid" id="switch-select-grid"></div>
                    </div>
                </div>
            </div>
            
            <!-- Item Selection Modal -->
            <div id="item-select-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content modal-content-sm">
                    <div class="modal-header">
                        <h3 id="item-select-title">Select Item</h3>
                        <button class="modal-close" id="item-modal-close">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="item-search-container">
                            <input type="text" id="item-search-input" placeholder="Search items..." class="item-search-input">
                        </div>
                        <div class="item-select-grid" id="item-select-grid"></div>
                    </div>
                </div>
            </div>
            
            <!-- KO Replacement Modal -->
            <div id="ko-replacement-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content modal-content-sm">
                    <div class="modal-header">
                        <h3 id="ko-replacement-title">Pokemon Fainted!</h3>
                    </div>
                    <div class="modal-body">
                        <p id="ko-replacement-text" class="ko-replacement-text">Select a replacement Pokemon:</p>
                        <div class="ko-replacement-grid" id="ko-replacement-grid"></div>
                    </div>
                </div>
            </div>
            
            <!-- Team Confirmation Modal -->
            <div id="team-confirm-modal" class="planner-modal" style="display: none;">
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Confirm Team Configuration</h3>
                        <button class="modal-close" id="team-confirm-close">×</button>
                    </div>
                    <div class="modal-body">
                        <p>This will create a new starting point with the current team configuration.</p>
                        <div class="team-confirm-preview">
                            <div class="team-confirm-side">
                                <h4>Your Team</h4>
                                <div id="team-confirm-p1"></div>
                            </div>
                            <div class="team-confirm-side">
                                <h4 id="team-confirm-p2-title">Opponent's Team</h4>
                                <div id="team-confirm-p2"></div>
                            </div>
                        </div>
                        <div class="modal-actions">
                            <button class="planner-btn planner-btn-secondary" id="team-confirm-cancel">Cancel</button>
                            <button class="planner-btn planner-btn-primary" id="team-confirm-ok">Confirm Team</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    window.BattlePlannerTemplate = {
        getHTML: getHTML
    };

})(window);
