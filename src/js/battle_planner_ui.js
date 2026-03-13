/**
 * Battle Planner UI
 * 
 * Renders the battle planner interface with:
 * - Timeline tree visualization
 * - Pokemon card views with animated HP bars and sprites
 * - Full team overview with drag & drop
 * - Enhanced move info with damage ranges and effectiveness
 * - Speed comparison and battle info
 * - Probability cloud for outcome branching
 * - State inspector
 */

(function (window, $) {
    'use strict';

    var BattlePlanner = window.BattlePlanner;
    var CalcIntegration = null;
    var BattlePlannerLogic = null;

    /**
     * Helper to get the generation number from window.GENERATION
     */
    function getGenNum() {
        var genRaw = window.GENERATION;
        return (typeof genRaw === 'object' && genRaw.num) ? genRaw.num : (genRaw || 8);
    }

    // UI State
    var uiState = {
        tree: null,
        isVisible: false,
        selectedOutcome: null,
        selectedMove: null,
        selectedMoveP1: null,  // Move index for P1's selected move this turn
        selectedMoveP2: null,  // Move index for P2's selected move this turn
        currentOutcomes: null,
        expandedNodes: {},
        collapsedBranches: {},
        viewMode: 'split',
        animationsEnabled: true,
        showTeamPanel: true,
        selectedAttacker: 'p1',
        draggedPokemon: null,
        dragSource: null,
        p1Box: [],
        p2Box: [],
        // Turn-based battle state
        turnMode: true,  // Both sides must select moves
        p1Action: null,  // { type: 'move'|'switch', index: number }
        p2Action: null,
        moveDamageCache: {}, // Cache for move damage calculations
        p1HoverOverride: null, // Pokemon index being hovered
        p2HoverOverride: null,
        p1BoxHoverOverride: null, // Pokemon index in box being hovered
        p2BoxHoverOverride: null,
        lastRenderedNodeId: null,
        currentTrainer: null // Name of the currently selected opponent trainer
    };

    // DOM References
    var $container = null;
    var $treePanel = null;
    var $stagePanel = null;
    var $inspectorPanel = null;

    /**
     * Initialize the Battle Planner UI
     */
    function initialize() {
        if (!BattlePlanner.CalcIntegration) {
            setTimeout(initialize, 100);
            return;
        }
        CalcIntegration = BattlePlanner.CalcIntegration;
        BattlePlannerLogic = window.BattlePlannerLogic || null;

        createPlannerUI();
        setupEventHandlers();

        uiState.tree = new BattlePlanner.BattleTree();
        uiState.tree.onTreeUpdated = onTreeUpdated;
        uiState.tree.onCurrentNodeChanged = onCurrentNodeChanged;

        console.log('Battle Planner UI initialized');
    }

    /**
     * Create the main planner UI structure
     */
    function createPlannerUI() {
        var html = `
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

        $('body').append(html);

        $container = $('#battle-planner');
        $treePanel = $('.planner-tree-panel');
        $stagePanel = $('.planner-stage-panel');
        $inspectorPanel = $('.planner-inspector-panel');
    }

    /**
     * Setup event handlers
     */
    function setupEventHandlers() {
        // Open planner button
        $(document).on('click', '#open-battle-planner', showPlanner);

        // Keyboard shortcuts
        $(document).on('keydown', function (e) {
            if (e.key === 'p' && !$(e.target).is('input, textarea, select')) {
                e.preventDefault();
                togglePlanner();
            }
            if (e.key === 'Escape' && uiState.isVisible) {
                if ($('#trainer-select-modal').is(':visible')) {
                    $('#trainer-select-modal').hide();
                } else if ($('#planner-help-modal').is(':visible')) {
                    $('#planner-help-modal').hide();
                } else if ($('#team-select-modal').is(':visible')) {
                    $('#team-select-modal').hide();
                } else {
                    hidePlanner();
                }
            }
            if (uiState.isVisible && !$(e.target).is('input, textarea')) {
                if (e.key === 'ArrowLeft') navigateToPreviousTurn();
                if (e.key === 'ArrowRight') navigateToNextTurn();
            }
        });

        // View mode buttons
        $(document).on('click', '.planner-btn-view', function () {
            setViewMode($(this).data('view'));
        });

        // Close button
        $(document).on('click', '#planner-close', hidePlanner);

        // Help button
        $(document).on('click', '#planner-help', function () {
            $('#planner-help-modal').show();
        });
        $(document).on('click', '#help-modal-close, #planner-help-modal .modal-overlay', function () {
            $('#planner-help-modal').hide();
        });

        // Trainer selector
        $(document).on('click', '#planner-select-trainer', function () {
            openTrainerSelector();
        });
        $(document).on('click', '#trainer-modal-close, #trainer-select-modal .modal-overlay', function () {
            $('#trainer-select-modal').hide();
        });
        $(document).on('input', '#trainer-search-input', function () {
            filterTrainerList($(this).val());
        });
        $(document).on('click', '.trainer-list-item', function () {
            var trainerName = $(this).data('trainer');
            selectTrainerForBattle(trainerName);
        });

        // Team modal
        $(document).on('click', '#team-modal-close, #team-select-modal .modal-overlay', function () {
            $('#team-select-modal').hide();
        });

        // Switch selection modal (for turn action)
        $(document).on('click', '#switch-modal-close, #switch-select-modal .modal-overlay', function () {
            $('#switch-select-modal').hide();
        });
        $(document).on('click', '.switch-select-item', function () {
            var $modal = $(this).closest('.planner-modal');
            if ($modal.attr('id') === 'ko-replacement-modal') {
                var side = $(this).data('side');
                var index = $(this).data('index');
                selectKOReplacement(side, index);
            } else {
                var side = $(this).data('side');
                var index = $(this).data('index');
                var name = $(this).data('name');
                setSwitchAction(side, index, name);
                $('#switch-select-modal').hide();
            }
        });

        // Hover preview for party slots
        $(document).on('mouseenter', '.team-overview-slot:not(.empty)', function () {
            var side = $(this).data('side');
            var index = $(this).data('slot-index');

            if (side === 'p1') {
                uiState.p1HoverOverride = index;
                uiState.p1BoxHoverOverride = null;
            } else {
                uiState.p2HoverOverride = index;
                uiState.p2BoxHoverOverride = null;
            }
            renderStage();
        });

        // Hover preview for box slots
        $(document).on('mouseenter', '.box-slot:not(.empty)', function () {
            var side = $(this).closest('.box-container').attr('id').endsWith('p1') ? 'p1' : 'p2';
            var index = $(this).data('slot-index');

            if (side === 'p1') {
                uiState.p1BoxHoverOverride = index;
                uiState.p1HoverOverride = null;
            } else {
                uiState.p2BoxHoverOverride = index;
                uiState.p2HoverOverride = null;
            }
            renderStage();
        });

        // Use the wrapper level mouseleave for better reliability
        $(document).on('mouseleave', '.team-overview, .box-container', function () {
            uiState.p1HoverOverride = null;
            uiState.p2HoverOverride = null;
            uiState.p1BoxHoverOverride = null;
            uiState.p2BoxHoverOverride = null;
            renderStage();
        });

        // Fail-safe: clear overrides when mouse leaves the entire planner
        $(document).on('mouseleave', '#battle-planner', function () {
            uiState.p1HoverOverride = null;
            uiState.p2HoverOverride = null;
            uiState.p1BoxHoverOverride = null;
            uiState.p2BoxHoverOverride = null;
            renderStage();
        });

        // Individual slot leave
        $(document).on('mouseleave', '.team-overview-slot', function () {
            var side = $(this).data('side');
            var index = $(this).data('slot-index');

            if (side === 'p1' && uiState.p1HoverOverride === index) {
                uiState.p1HoverOverride = null;
                renderStage();
            } else if (side === 'p2' && uiState.p2HoverOverride === index) {
                uiState.p2HoverOverride = null;
                renderStage();
            }
        });

        $(document).on('mouseleave', '.box-slot', function () {
            var side = $(this).closest('.box-container').attr('id').endsWith('p1') ? 'p1' : 'p2';
            var index = $(this).data('slot-index');

            if (side === 'p1' && uiState.p1BoxHoverOverride === index) {
                uiState.p1BoxHoverOverride = null;
                renderStage();
            } else if (side === 'p2' && uiState.p2BoxHoverOverride === index) {
                uiState.p2BoxHoverOverride = null;
                renderStage();
            }
        });

        // Item selection modal
        $(document).on('click', '.team-item-btn', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            openItemSelector(side, index);
        });
        $(document).on('click', '#item-modal-close, #item-select-modal .modal-overlay', function () {
            $('#item-select-modal').hide();
        });
        $(document).on('click', '.item-select-option', function () {
            var item = $(this).data('item');
            applyItemToSlot(item);
            $('#item-select-modal').hide();
        });
        $(document).on('input', '#item-search-input', function () {
            var query = $(this).val().toLowerCase();
            filterItemList(query);
        });

        // Battle buttons
        $(document).on('click', '#planner-new', resetBattle);
        $(document).on('click', '#tree-start-battle', startNewBattle);
        $(document).on('click', '#tree-start-imported', startBattleWithImportedTeam);

        // Import/Export
        $(document).on('click', '#planner-import', importState);
        $(document).on('click', '#planner-export', exportPlan);
        $(document).on('click', '#planner-script', showBattleScript);

        // Tree navigation
        $(document).on('click', '#tree-expand-all', expandAllNodes);
        $(document).on('click', '#tree-collapse-all', collapseAllNodes);

        // Click on tree root header to switch to that root
        $(document).on('click', '.tree-root-header', function (e) {
            e.stopPropagation();
            var rootId = $(this).closest('.tree-root').data('root-id');
            if (rootId && uiState.tree) {
                uiState.tree.navigate(rootId);
                renderTree();
                renderStage();
            }
        });

        $(document).on('click', '.tree-node', function (e) {
            e.stopPropagation();
            selectNode($(this).data('node-id'));
        });

        $(document).on('click', '.tree-node-toggle', function (e) {
            e.stopPropagation();
            toggleNodeExpand($(this).closest('.tree-node').data('node-id'));
        });

        $(document).on('click', '.tree-branch-label', function (e) {
            e.stopPropagation();
            var parentId = $(this).data('branch-parent');
            if (!uiState.collapsedBranches) uiState.collapsedBranches = {};
            uiState.collapsedBranches[parentId] = !uiState.collapsedBranches[parentId];
            renderTree();
        });

        // Inline tree node delete
        $(document).on('click', '.tree-node-delete', function (e) {
            e.stopPropagation();
            var nodeId = $(this).data('node-id');
            if (nodeId && confirm('Delete this branch and all its children?')) {
                uiState.tree.removeNode(nodeId);
                renderTree();
                renderStage();
            }
        });

        // Variance icon click: retrigger branch creation
        $(document).on('click', '.tree-variance-icon', function (e) {
            e.stopPropagation();
            var nodeId = $(this).data('node-id');
            var node = uiState.tree ? uiState.tree.getNode(nodeId) : null;
            if (node && node.outcome && node.outcome.varianceWarnings && node.outcome.varianceWarnings.length > 0) {
                var parentNodeId = node.parentId || nodeId;
                showVarianceNotification(node.outcome.varianceWarnings, parentNodeId, nodeId);
            }
        });

        // Move selection (from Pokemon cards - redirect to move details panel)
        $(document).on('click', '.move-pill', function () {
            var moveIndex = $(this).data('move-index');
            var side = $(this).closest('.pokemon-card').hasClass('pokemon-card-p1') ? 'p1' : 'p2';
            var moveName = $(this).find('.move-name').text();
            selectMoveForTurn(side, moveIndex, moveName);
        });

        // Navigation
        $(document).on('click', '#stage-prev', navigateToPreviousTurn);
        $(document).on('click', '#stage-next', navigateToNextTurn);

        // Inspector
        $(document).on('click', '#inspector-collapse', toggleInspectorPanel);
        $(document).on('click', '#inspector-reopen', toggleInspectorPanel);
        $(document).on('click', '#inspector-delete-node', deleteCurrentNode);

        // AI tie branching now handled automatically in executeTurn()
        $(document).on('change', '#inspector-notes', function () {
            updateNodeNotes($(this).val());
        });

        // Switch Pokemon buttons (in card headers)
        $(document).on('click', '#p1-card-switch-btn', function () {
            openSwitchSelectorModal('p1');
        });
        $(document).on('click', '#p2-card-switch-btn', function () {
            openSwitchSelectorModal('p2');
        });

        // P2 forward/backward navigation
        $(document).on('click', '#p2-nav-prev, #p2-nav-next', function () {
            var direction = $(this).attr('id') === 'p2-nav-next' ? 1 : -1;
            cycleP2Pokemon(direction);
        });

        // Tooltips for items, abilities, moves
        $(document).on('mouseenter', '.item-badge, .card-ability, .move-cell-name, .status-badge', function (e) {
            var $el = $(this);
            var desc = '';
            if ($el.hasClass('item-badge') && window.RBDex) {
                var itemText = $el.text().replace(/^🎒\s*/, '').trim();
                desc = window.RBDex.getItemDesc(itemText);
            } else if ($el.hasClass('card-ability') && window.RBDex) {
                desc = window.RBDex.getAbilityDesc($el.text().trim());
            } else if ($el.hasClass('move-cell-name') && window.RBDex) {
                desc = window.RBDex.getMoveDesc($el.text().trim());
            } else if ($el.hasClass('status-badge')) {
                var st = $el.text().trim().toLowerCase();
                var statusDescs = {
                    'poisoned': 'Loses 1/8 max HP each turn.',
                    'badly poisoned': 'Loses increasing HP each turn (1/16, 2/16, 3/16...).',
                    'burned': 'Loses 1/8 max HP each turn. Physical attack halved.',
                    'paralyzed': 'Speed quartered. 25% chance to be fully paralyzed.',
                    'asleep': 'Cannot move for 1-3 turns.',
                    'frozen': 'Cannot move. 20% chance to thaw each turn.'
                };
                desc = statusDescs[st] || '';
            }
            if (desc) {
                var offset = $el.offset();
                var plannerOffset = $('#battle-planner').offset() || { top: 0, left: 0 };
                var $tooltip = $('#planner-tooltip');
                $tooltip.text(desc);
                var isInsideOverlay = $el.closest('.dex-overlay').length > 0;
                if (isInsideOverlay) {
                    $tooltip.css({
                        position: 'fixed',
                        top: (offset.top - $(window).scrollTop() - 8) + 'px',
                        left: (offset.left - $(window).scrollLeft()) + 'px',
                        transform: 'translateY(-100%)',
                        zIndex: 100010
                    });
                } else {
                    $tooltip.css({
                        position: 'absolute',
                        top: (offset.top - plannerOffset.top - 8) + 'px',
                        left: (offset.left - plannerOffset.left) + 'px',
                        transform: 'translateY(-100%)',
                        zIndex: ''
                    });
                }
                $tooltip.show();
            }
        });
        $(document).on('mouseleave', '.item-badge, .card-ability, .move-cell-name, .status-badge', function () {
            $('#planner-tooltip').hide();
        });

        // Dex overlay toggle
        $(document).on('click', '#dex-tab', function () {
            $('#dex-overlay').fadeIn(150);
            $('#dex-search-input').focus();
        });
        $(document).on('click', '#dex-close, #dex-backdrop', function () {
            $('#dex-overlay').fadeOut(150);
        });
        $(document).on('click', '#dex-search-clear', function () {
            $('#dex-search-input').val('').trigger('input');
        });
        $(document).on('input', '#dex-search-input', function () {
            var query = $(this).val().trim().toLowerCase();
            var activeTab = $('.dex-tab-btn.active').data('dex-tab') || 'all';
            renderDexSearchResults(query, activeTab);
        });
        $(document).on('click', '.dex-tab-btn', function () {
            $('.dex-tab-btn').removeClass('active');
            $(this).addClass('active');
            var query = $('#dex-search-input').val().trim().toLowerCase();
            renderDexSearchResults(query, $(this).data('dex-tab'));
        });
        $(document).on('click', '.dex-result-row', function () {
            var type = $(this).data('dex-type');
            var id = $(this).data('dex-id');
            showDexDetail(type, id);
        });
        $(document).on('click', '#dex-detail-back', function () {
            $('#dex-detail').hide();
            $('#dex-results').show();
        });
        // Learnset tab switching inside Dex detail
        $(document).on('click', '.dex-ls-tab', function () {
            $('.dex-ls-tab').removeClass('active');
            $(this).addClass('active');
            var tab = $(this).data('ls-tab');
            $('.dex-ls-content').hide();
            $('.dex-ls-content[data-ls-content="' + tab + '"]').show();
        });
        // Evolution chain link clicks
        $(document).on('click', '.dex-evo-name', function () {
            var type = $(this).data('dex-type');
            var eid = $(this).data('dex-id');
            if (type && eid) showDexDetail(type, eid);
        });

        // Execute Turn button
        $(document).on('click', '#execute-turn', function () {
            executeTurn();
        });

        // Team overview slot click
        // Note: Removed direct click handler for team-overview-slot
        // Only the switch button should trigger switching, not clicking on Pokemon

        // Move cell click (2x2 grid)
        $(document).on('click', '.move-cell', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            var moveName = $(this).data('move');
            selectMoveForTurn(side, index, moveName);
        });

        // Legacy: Move select button (for backwards compat)
        $(document).on('click', '.move-select-btn', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            var moveName = $(this).data('move');
            selectMoveForTurn(side, index, moveName);
        });

        // Crit button (now an actual button, not checkbox)
        $(document).on('click', '.move-crit-btn', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            var $btn = $(this);

            // Toggle the crit state
            var isCrit = !$btn.hasClass('active');
            $btn.toggleClass('active');

            // If move is selected, update the action
            var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
            if (action && action.index === index) {
                action.isCrit = isCrit;
                updateTurnActionsPanel();
            }

            // Re-render to show crit damage
            var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
            if (currentNode && currentNode.state) {
                var pokemon = side === 'p1' ? currentNode.state.p1.active : currentNode.state.p2.active;
                renderMoves(side, pokemon);
            }
        });

        // Effect button
        $(document).on('click', '.move-effect-btn', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            var $btn = $(this);

            // Toggle the effect state
            var applyEffect = !$btn.hasClass('active');
            $btn.toggleClass('active');

            // If move is selected, update the action
            var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
            if (action && action.index === index) {
                action.applyEffect = applyEffect;
                action.effectType = $btn.data('effect');
                updateTurnActionsPanel();
            }
        });

        // NEW: Multi-hit selector
        $(document).on('change', '.move-hits-select', function () {
            var side = $(this).data('side');
            var index = $(this).data('index');
            var hits = parseInt($(this).val());

            if (side === 'p1' && uiState.p1Action && uiState.p1Action.index === index) {
                uiState.p1Action.hits = hits;
            } else if (side === 'p2' && uiState.p2Action && uiState.p2Action.index === index) {
                uiState.p2Action.hits = hits;
            }

            // Recalculate damage display - re-render the cards
            var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
            if (currentNode && currentNode.state) {
                renderMoves(side, side === 'p1' ? currentNode.state.p1.active : currentNode.state.p2.active);
            }
        });

        // NEW: Effect toggle
        $(document).on('change', '.move-effect-toggle', function () {
            var side = $(this).data('side');
            var index = $(this).data('index');
            var effect = $(this).data('effect');
            var applyEffect = $(this).prop('checked');

            if (side === 'p1' && uiState.p1Action && uiState.p1Action.index === index) {
                uiState.p1Action.applyEffect = applyEffect;
                uiState.p1Action.effectType = effect;
            } else if (side === 'p2' && uiState.p2Action && uiState.p2Action.index === index) {
                uiState.p2Action.applyEffect = applyEffect;
                uiState.p2Action.effectType = effect;
            }
        });

        // NEW: Confirm Team button
        $(document).on('click', '#confirm-team-btn', openTeamConfirmModal);
        $(document).on('click', '#team-confirm-ok', confirmTeamAndCreateBattle);
        $(document).on('click', '#team-confirm-cancel, #team-confirm-close, #team-confirm-modal .modal-overlay', function () {
            $('#team-confirm-modal').hide();
        });

        // NEW: KO replacement selection
        $(document).on('click', '.ko-replacement-slot', function () {
            var side = $(this).data('side');
            var index = $(this).data('index');
            selectKOReplacement(side, index);
        });

        // Set lead button handler
        $(document).on('click', '.team-lead-btn', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            setTeamLead(side, index);
        });

        // Effect Editor Modal handlers
        $(document).on('click', '#open-effect-editor', openEffectEditor);
        $(document).on('click', '#effect-editor-close, #cancel-effects-btn, #effect-editor-modal .modal-overlay', function () {
            $('#effect-editor-modal').hide();
        });

        // Move Additional Effects button handler
        $(document).on('click', '.move-additional-effects-btn', function (e) {
            e.stopPropagation();
            var side = $(this).data('side');
            var index = $(this).data('index');
            var moveName = $(this).data('move');
            openMoveEffectsModal(side, index, moveName);
        });

        // Move Effects Modal handlers
        $(document).on('click', '#move-effects-close, #cancel-move-effects-btn, #move-effects-modal .modal-overlay', function () {
            $('#move-effects-modal').hide();
        });
        $(document).on('click', '#me-status-buttons .effect-btn', function () {
            $('#me-status-buttons .effect-btn').removeClass('active');
            $(this).addClass('active');
        });
        $(document).on('click', '#apply-move-effects-btn', applyMoveEffectsToAction);

        // Turn Action Modifiers - Crit buttons
        $(document).on('click', '#p1-crit-btn', function () {
            toggleActionCrit('p1');
        });
        $(document).on('click', '#p2-crit-btn', function () {
            toggleActionCrit('p2');
        });

        // Turn Action Modifiers - Effect buttons
        $(document).on('click', '#p1-effect-btn', function () {
            openMoveEffectsForAction('p1');
        });
        $(document).on('click', '#p2-effect-btn', function () {
            openMoveEffectsForAction('p2');
        });

        $(document).on('click', '#status-buttons .effect-btn', function () {
            var effect = $(this).data('effect');
            $('#status-buttons .effect-btn').removeClass('active');
            $(this).addClass('active');
            uiState.pendingStatus = effect;
        });
        $(document).on('click', '.stat-btn', function () {
            var $row = $(this).closest('.stat-row');
            var stat = $row.data('stat');
            var mod = parseInt($(this).data('mod'));
            var $value = $row.find('.stat-value');
            var current = parseInt($value.text()) || 0;
            var newVal = Math.max(-6, Math.min(6, current + mod));
            $value.text(newVal > 0 ? '+' + newVal : newVal);
            $value.attr('data-value', newVal);
        });
        $(document).on('click', '#clear-stat-changes', function () {
            $('.stat-value').text('0').attr('data-value', 0);
        });
        $(document).on('click', '#effect-sections .effect-btn:not(.effect-btn-clear)', function () {
            $(this).toggleClass('active');
        });
        $(document).on('click', '#apply-effects-btn', applyManualEffects);

        // Drag and drop for team management
        setupDragAndDrop();
    }

    /**
     * Setup drag and drop functionality
     */
    function setupDragAndDrop() {
        $(document).on('dragstart', '.team-overview-slot, .box-slot', function (e) {
            var $slot = $(this);
            var isTeamSlot = $slot.hasClass('team-overview-slot');
            var side = $slot.closest('.team-overview').hasClass('team-overview-p1') ? 'p1' : 'p2';

            uiState.draggedPokemon = {
                side: side,
                index: $slot.data('slot-index'),
                source: isTeamSlot ? 'team' : 'box'
            };

            $slot.addClass('dragging');
            e.originalEvent.dataTransfer.effectAllowed = 'move';
            e.originalEvent.dataTransfer.setData('text/plain', JSON.stringify(uiState.draggedPokemon));
        });

        $(document).on('dragend', '.team-overview-slot, .box-slot', function () {
            $(this).removeClass('dragging');
            $('.drag-over').removeClass('drag-over');
            uiState.draggedPokemon = null;
        });

        $(document).on('dragover', '.team-overview-slot, .box-slot, .box-slots', function (e) {
            e.preventDefault();
            $(this).addClass('drag-over');
        });

        $(document).on('dragleave', '.team-overview-slot, .box-slot, .box-slots', function () {
            $(this).removeClass('drag-over');
        });

        $(document).on('drop', '.team-overview-slot, .box-slot, .box-slots', function (e) {
            e.preventDefault();
            $(this).removeClass('drag-over');

            if (!uiState.draggedPokemon) return;

            var $target = $(this);
            var isTargetTeam = $target.hasClass('team-overview-slot');
            var isTargetBox = $target.hasClass('box-slot') || $target.hasClass('box-slots');
            var targetSide = $target.closest('.team-overview').hasClass('team-overview-p1') ? 'p1' : 'p2';
            var targetIndex = $target.data('slot-index');

            var source = uiState.draggedPokemon;

            // Handle the drop
            handlePokemonDrop(source, {
                side: targetSide,
                index: targetIndex,
                destination: isTargetTeam ? 'team' : 'box'
            });

            uiState.draggedPokemon = null;
        });
    }

    /**
     * Handle Pokemon drop between team and box
     */
    /**
     * Handle Pokemon drag & drop - just updates UI state, does NOT create tree branches
     * Tree branches are only created when "Confirm Team" is clicked
     */
    function applyTeamChange(state, source, target, pokemon) {
        if (source.source === 'team' && target.destination === 'box') {
            state.p1.team.splice(source.index, 1);
            uiState.p1Box.push(pokemon);
        } else if (source.source === 'box' && target.destination === 'team') {
            if (state.p1.team.length >= 6 && (target.index === undefined || target.index >= state.p1.team.length)) {
                alert('Maximum team size is 6 Pokemon!');
                return false;
            }
            uiState.p1Box.splice(source.index, 1);
            if (target.index !== undefined && target.index < state.p1.team.length) {
                var oldPoke = state.p1.team[target.index];
                state.p1.team[target.index] = pokemon;
                uiState.p1Box.push(oldPoke);
            } else {
                state.p1.team.push(pokemon);
            }
        } else if (source.source === 'team' && target.destination === 'team') {
            if (source.index !== target.index && target.index !== undefined) {
                if (target.index < state.p1.team.length) {
                    var temp = state.p1.team[source.index];
                    state.p1.team[source.index] = state.p1.team[target.index];
                    state.p1.team[target.index] = temp;
                } else {
                    state.p1.team.splice(source.index, 1);
                    state.p1.team.push(pokemon);
                }
            }
        }
        state.p1.team = state.p1.team.filter(function (p) { return !!p; });
        if (state.p1.teamSlot >= state.p1.team.length) {
            state.p1.teamSlot = Math.max(0, state.p1.team.length - 1);
        }
        if (state.p1.team.length > 0) {
            state.p1.active = state.p1.team[state.p1.teamSlot];
        }
        return true;
    }

    function propagateTeamToAllNodes(pokemon, isAdd) {
        if (!uiState.tree) return;
        var allNodes = uiState.tree.nodes;
        Object.keys(allNodes).forEach(function (nid) {
            var n = allNodes[nid];
            if (!n || !n.state || !n.state.p1) return;
            var team = n.state.p1.team;
            if (isAdd) {
                var alreadyHas = team.some(function (p) { return p && p.name === pokemon.name; });
                if (!alreadyHas && team.length < 6) {
                    team.push(pokemon.clone ? pokemon.clone() : Object.assign({}, pokemon));
                }
            }
        });
    }

    function handlePokemonDrop(source, target) {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;
        var state = currentNode.state;

        if (target.side === 'p2') return;

        var pokemon = null;
        if (source.source === 'team') {
            pokemon = state.p1.team[source.index];
        } else {
            pokemon = uiState.p1Box[source.index];
        }
        if (!pokemon) return;

        var isAddingToTeam = source.source === 'box' && target.destination === 'team';
        var isNotRoot = currentNode.parentId;

        if (isAddingToTeam && isNotRoot) {
            var choice = prompt(
                'You are adding ' + pokemon.name + ' to your team mid-battle.\n\n' +
                'Type "all" = Add retroactively (appears in all turns)\n' +
                'Type "here" = Only add from this turn onward\n' +
                'Press Cancel = Do nothing',
                'all'
            );
            if (choice === null) return;
            var trimmed = (choice || '').trim().toLowerCase();
            if (trimmed === 'all') {
                if (!applyTeamChange(state, source, target, pokemon)) return;
                propagateTeamToAllNodes(pokemon, true);
            } else if (trimmed === 'here') {
                if (!applyTeamChange(state, source, target, pokemon)) return;
            } else {
                return;
            }
        } else {
            if (!applyTeamChange(state, source, target, pokemon)) return;
        }

        renderStage();
    }

    function showPlanner() {
        uiState.isVisible = true;
        $container.fadeIn(300);
        $('body').addClass('planner-active');

        // Auto-start battle if Pokemon are selected in the calculator
        if (!uiState.tree || !uiState.tree.getRootNode()) {
            autoStartBattle();
        } else {
            // Refresh box from customsets to sync with any changes made in calculator
            refreshBoxFromCustomsets();
            renderTree();
            renderStage();
        }
    }

    /**
     * Auto-start battle using Pokemon from calculator and imported saves
     */
    function autoStartBattle() {
        try {
            var p1Pokemon = window.createPokemon ? window.createPokemon($('#p1')) : null;
            var p2Pokemon = window.createPokemon ? window.createPokemon($('#p2')) : null;
            var field = window.createField ? window.createField() : null;

            // Load all imported Pokemon into P1's box
            var customsets = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
            var importedPokemon = [];
            for (var name in customsets) {
                for (var setName in customsets[name]) {
                    var set = customsets[name][setName];
                    if (set && set.name) {
                        importedPokemon.push(set);
                    }
                }
            }

            // Load opponent's trainer Pokemon if available
            var opponentTeam = getOpponentTrainerPokemon();

            if (!p1Pokemon && importedPokemon.length > 0) {
                // Use first imported Pokemon as P1
                p1Pokemon = createCalcPokemonFromImported(importedPokemon[0]);
            }

            if (!p1Pokemon) {
                // Show placeholder - no battle started yet
                renderTree();
                renderStage();
                return;
            }

            var initialState = new BattlePlanner.BattleStateSnapshot();

            // Set up P1
            initialState.p1.active = new BattlePlanner.PokemonSnapshot(p1Pokemon);
            initialState.p1.team = [initialState.p1.active.clone()];

            // Add imported Pokemon to P1 box (excluding the active one)
            uiState.p1Box = [];
            for (var i = 0; i < importedPokemon.length; i++) {
                var snap = createSnapshotFromImported(importedPokemon[i]);
                if (snap && snap.name !== initialState.p1.active.name) {
                    uiState.p1Box.push(snap);
                }
            }

            // Set up P2 - opponent always has their full team (no box)
            initialState.p2.team = [];
            uiState.p2Box = []; // No box for opponent

            // First add the currently selected P2 Pokemon
            if (p2Pokemon) {
                initialState.p2.active = new BattlePlanner.PokemonSnapshot(p2Pokemon);
                initialState.p2.team.push(initialState.p2.active.clone());
            }

            // Add ALL opponent trainer Pokemon to P2's team (they always have full team)
            if (opponentTeam.length > 0) {
                for (var j = 0; j < opponentTeam.length; j++) {
                    var oppSnap = createSnapshotFromTrainerPokemon(opponentTeam[j]);
                    if (oppSnap) {
                        // Only add if not already the active Pokemon
                        var alreadyInTeam = initialState.p2.team.some(function (p) {
                            return p.name === oppSnap.name;
                        });

                        if (!alreadyInTeam) {
                            initialState.p2.team.push(oppSnap);
                        }

                        // Set first one as active if we don't have one yet
                        if (!initialState.p2.active || initialState.p2.active.name === '---') {
                            initialState.p2.active = oppSnap.clone();
                        }
                    }
                }
            }

            // Set up field
            if (field) {
                initialState.field.weather = field.weather || 'None';
                initialState.field.terrain = field.terrain || 'None';
            }

            // Detect current trainer from the main calc
            if (window.CURRENT_TRAINER) {
                uiState.currentTrainer = window.CURRENT_TRAINER;
            }
            updateTrainerLabel();

            // Reset turn actions
            uiState.p1Action = null;
            uiState.p2Action = null;

            uiState.tree.initialize(initialState);

            renderTree();
            renderStage();

            $('.tree-placeholder').hide();

            console.log('Battle auto-started with', importedPokemon.length, 'imported Pokemon and', opponentTeam.length, 'opponent Pokemon');
        } catch (e) {
            console.error('Failed to auto-start battle:', e);
            renderTree();
            renderStage();
        }
    }

    /**
     * Get opponent trainer Pokemon from the DOM
     */
    function getOpponentTrainerPokemon() {
        var trainerPokemon = [];

        // Look for opponent trainer Pokemon in the opposing list
        $('.trainer-pok-list-opposing .trainer-pok, .trainer-pok.right-side').each(function () {
            var dataId = $(this).data('id');
            if (dataId) {
                // Clean up the data-id (remove bracket prefix if present)
                var cleanId = dataId.replace(/^\[\d+\]/, '');
                trainerPokemon.push(cleanId);
            }
        });

        // Also check if there's a P2 Pokemon currently selected that's not in the list
        var p2Select = $('input.set-selector.opposing').val();
        if (p2Select && !trainerPokemon.includes(p2Select)) {
            var cleanP2 = p2Select.replace(/^\[\d+\]/, '');
            trainerPokemon.unshift(cleanP2);
        }

        return trainerPokemon;
    }

    /**
     * Create a calc.Pokemon from imported set data
     */
    function createCalcPokemonFromImported(set) {
        try {
            var gen = getGenNum();
            return new window.calc.Pokemon(gen, set.name, {
                level: set.level || 50,
                ability: set.ability,
                item: set.item,
                nature: set.nature,
                ivs: set.ivs || {},
                evs: set.evs || {},
                moves: (set.moves || []).map(function (m) {
                    return new window.calc.Move(gen, m);
                })
            });
        } catch (e) {
            console.error('Failed to create Pokemon from imported:', e);
            return null;
        }
    }

    /**
     * Create a PokemonSnapshot from trainer Pokemon data-id
     */
    function createSnapshotFromTrainerPokemon(dataId) {
        try {
            var name = dataId.split(' (')[0];
            var gen = getGenNum();
            var setName = dataId.includes('(') ? dataId.split('(')[1].replace(')', '') : null;
            var set = null;

            // Try setdex first, then fall back to SETDEX_SS (Run-and-Bun trainer data)
            if (setName && window.setdex && window.setdex[name] && window.setdex[name][setName]) {
                set = window.setdex[name][setName];
            } else if (setName && typeof SETDEX_SS !== 'undefined' && SETDEX_SS[name] && SETDEX_SS[name][setName]) {
                set = SETDEX_SS[name][setName];
            }

            var pokemon = null;
            if (set) {
                pokemon = new window.calc.Pokemon(gen, name, {
                    level: set.level || 50,
                    ability: set.ability,
                    item: set.item,
                    nature: set.nature,
                    ivs: set.ivs || {},
                    evs: set.evs || {},
                    moves: (set.moves || []).map(function (m) {
                        return new window.calc.Move(gen, m);
                    })
                });
            } else {
                pokemon = new window.calc.Pokemon(gen, name, { level: 50 });
            }

            return new BattlePlanner.PokemonSnapshot(pokemon);
        } catch (e) {
            console.error('Failed to create snapshot from trainer Pokemon:', e);
            return null;
        }
    }

    function hidePlanner() {
        uiState.isVisible = false;
        $container.fadeOut(200);
        $('body').removeClass('planner-active');
    }

    function togglePlanner() {
        if (uiState.isVisible) hidePlanner();
        else showPlanner();
    }

    function setViewMode(mode) {
        uiState.viewMode = mode;
        $('.planner-btn-view').removeClass('active');
        $('.planner-btn-view[data-view="' + mode + '"]').addClass('active');
        $container.removeClass('view-split view-tree view-stage').addClass('view-' + mode);
    }

    /**
     * Reset battle - clears timeline only, keeps trainer/team selections
     */
    function resetBattle() {
        if (!uiState.tree || !uiState.tree.rootId) return;
        if (!confirm('Are you sure you want to reset the battle?\n\nThis will clear the entire timeline but keep your trainer and team selections.')) return;

        try {
            var rootNode = uiState.tree.getRootNode();
            if (rootNode && rootNode.state) {
                var freshState = rootNode.state.clone();
                freshState.turnNumber = 0;
                // Reset all Pokemon HP to max
                if (freshState.p1.team) freshState.p1.team.forEach(function(p) { if (p) { p.currentHP = p.maxHP; p.status = 'Healthy'; p.boosts = {}; } });
                if (freshState.p2.team) freshState.p2.team.forEach(function(p) { if (p) { p.currentHP = p.maxHP; p.status = 'Healthy'; p.boosts = {}; } });
                if (freshState.p1.active) { freshState.p1.active.currentHP = freshState.p1.active.maxHP; freshState.p1.active.status = 'Healthy'; freshState.p1.active.boosts = {}; }
                if (freshState.p2.active) { freshState.p2.active.currentHP = freshState.p2.active.maxHP; freshState.p2.active.status = 'Healthy'; freshState.p2.active.boosts = {}; }
                uiState.tree.initialize(freshState);
            }

            uiState.p1Action = null;
            uiState.p2Action = null;
            uiState.collapsedBranches = {};
            uiState.expandedNodes = {};

            // Clear all UI banners and selections
            $('#ai-tie-banner').hide();
            $('#variance-banner').remove();
            $('#stage-ko-banner').remove();
            $('#p1-selected-move').text('Select a move').removeClass('selected');
            $('#p2-selected-move').text('Select a move').removeClass('selected');
            $('#p1-move-list .move-row, #p2-move-list .move-row').removeClass('selected');
            updateTurnActionsPanel();
            updateExecuteTurnButton();

            renderTree();
            renderStage();
            console.log('Battle reset - timeline cleared, teams kept');
        } catch (e) {
            console.error('Failed to reset battle:', e);
        }
    }

    /**
     * Start a new battle
     */
    function startNewBattle() {
        try {
            var p1Pokemon = window.createPokemon ? window.createPokemon($('#p1')) : null;
            var p2Pokemon = window.createPokemon ? window.createPokemon($('#p2')) : null;
            var field = window.createField ? window.createField() : null;

            if (!p1Pokemon || !p2Pokemon) {
                alert('Please set up both Pokemon in the calculator first.');
                return;
            }

            var initialState = CalcIntegration.createStateFromCalculator(p1Pokemon, p2Pokemon, field);

            // Clear boxes
            uiState.p1Box = [];
            uiState.p2Box = [];

            uiState.tree.initialize(initialState);

            renderTree();
            renderStage();

            $('.tree-placeholder').hide();

            console.log('Battle started:', initialState);
        } catch (e) {
            console.error('Failed to start battle:', e);
            alert('Failed to start battle: ' + e.message);
        }
    }

    /**
     * Start battle with imported team
     */
    function startBattleWithImportedTeam() {
        var customsets = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
        var importedPokemon = [];

        for (var name in customsets) {
            for (var setName in customsets[name]) {
                var set = customsets[name][setName];
                if (set && set.name) {
                    importedPokemon.push(set);
                }
            }
        }

        if (importedPokemon.length === 0) {
            alert('No imported Pokemon found. Please import a savefile first using the main calculator.');
            return;
        }

        try {
            var p2Pokemon = window.createPokemon ? window.createPokemon($('#p2')) : null;
            var field = window.createField ? window.createField() : null;

            var initialState = new BattlePlanner.BattleStateSnapshot();

            var firstPoke = importedPokemon[0];
            initialState.p1.active = createSnapshotFromImported(firstPoke);

            initialState.p1.team = importedPokemon.slice(0, 6).map(function (p) {
                return createSnapshotFromImported(p);
            });

            if (p2Pokemon) {
                initialState.p2.active = new BattlePlanner.PokemonSnapshot(p2Pokemon);
                initialState.p2.team = [initialState.p2.active.clone()];
            }

            if (field) {
                initialState.field.weather = field.weather || 'None';
                initialState.field.terrain = field.terrain || 'None';
            }

            // Clear boxes
            uiState.p1Box = [];
            uiState.p2Box = [];

            uiState.tree.initialize(initialState);

            renderTree();
            renderStage();

            $('.tree-placeholder').hide();

            console.log('Battle started with imported team:', importedPokemon.length, 'Pokemon');
        } catch (e) {
            console.error('Failed to start battle:', e);
            alert('Failed to start battle: ' + e.message);
        }
    }

    function createSnapshotFromImported(data) {
        var snapshot = new BattlePlanner.PokemonSnapshot(null);
        snapshot.name = data.name || '';
        snapshot.species = data.species || data.name || '';
        snapshot.level = data.level || 100;
        snapshot.ability = data.ability || '';
        snapshot.item = data.item || '';
        snapshot.nature = data.nature || 'Hardy';
        snapshot.moves = data.moves || [];
        snapshot.types = data.types || [];

        if (data.evs) {
            var statMap = { hp: 'hp', at: 'atk', df: 'def', sa: 'spa', sd: 'spd', sp: 'spe' };
            for (var key in data.evs) {
                var stat = statMap[key] || key;
                snapshot.evs[stat] = data.evs[key] || 0;
            }
        }
        if (data.ivs) {
            var statMap = { hp: 'hp', at: 'atk', df: 'def', sa: 'spa', sd: 'spd', sp: 'spe' };
            for (var key in data.ivs) {
                var stat = statMap[key] || key;
                snapshot.ivs[stat] = data.ivs[key] || 31;
            }
        }

        if (window.pokedex && window.pokedex[snapshot.name]) {
            var baseStats = window.pokedex[snapshot.name].bs || {};
            var baseHP = baseStats.hp || 50;
            var level = snapshot.level;
            var iv = snapshot.ivs.hp || 31;
            var ev = snapshot.evs.hp || 0;
            snapshot.maxHP = Math.floor(((2 * baseHP + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
            snapshot.currentHP = snapshot.maxHP;
            snapshot.percentHP = 100;

            var statNames = ['atk', 'def', 'spa', 'spd', 'spe'];
            var natureMap = getNatureMultipliers(snapshot.nature);
            for (var i = 0; i < statNames.length; i++) {
                var stat = statNames[i];
                var legacyStat = { atk: 'at', def: 'df', spa: 'sa', spd: 'sd', spe: 'sp' }[stat];
                var baseStat = baseStats[legacyStat] || 50;
                var statIV = snapshot.ivs[stat] || 31;
                var statEV = snapshot.evs[stat] || 0;
                var natureMult = natureMap[stat] || 1;
                snapshot.stats[stat] = Math.floor((Math.floor(((2 * baseStat + statIV + Math.floor(statEV / 4)) * level) / 100) + 5) * natureMult);
            }
            snapshot.stats.hp = snapshot.maxHP;
        } else {
            snapshot.maxHP = 300;
            snapshot.currentHP = 300;
            snapshot.percentHP = 100;
        }

        return snapshot;
    }

    function getNatureMultipliers(nature) {
        var natures = {
            'Adamant': { atk: 1.1, spa: 0.9 },
            'Bold': { def: 1.1, atk: 0.9 },
            'Brave': { atk: 1.1, spe: 0.9 },
            'Calm': { spd: 1.1, atk: 0.9 },
            'Careful': { spd: 1.1, spa: 0.9 },
            'Gentle': { spd: 1.1, def: 0.9 },
            'Hasty': { spe: 1.1, def: 0.9 },
            'Impish': { def: 1.1, spa: 0.9 },
            'Jolly': { spe: 1.1, spa: 0.9 },
            'Lax': { def: 1.1, spd: 0.9 },
            'Lonely': { atk: 1.1, def: 0.9 },
            'Mild': { spa: 1.1, def: 0.9 },
            'Modest': { spa: 1.1, atk: 0.9 },
            'Naive': { spe: 1.1, spd: 0.9 },
            'Naughty': { atk: 1.1, spd: 0.9 },
            'Quiet': { spa: 1.1, spe: 0.9 },
            'Rash': { spa: 1.1, spd: 0.9 },
            'Relaxed': { def: 1.1, spe: 0.9 },
            'Sassy': { spd: 1.1, spe: 0.9 },
            'Timid': { spe: 1.1, atk: 0.9 }
        };
        return natures[nature] || {};
    }

    function importState() {
        var json = prompt('Paste exported battle plan JSON:');
        if (json) {
            try {
                if (uiState.tree.deserialize(json)) {
                    renderTree();
                    renderStage();
                    $('.tree-placeholder').hide();
                    alert('Battle plan imported successfully!');
                } else {
                    alert('Failed to import battle plan.');
                }
            } catch (e) {
                alert('Invalid JSON format.');
            }
        }
    }

    function exportPlan() {
        var json = uiState.tree.serialize();

        navigator.clipboard.writeText(json).then(function () {
            alert('Battle plan copied to clipboard!');
        }).catch(function () {
            var textarea = document.createElement('textarea');
            textarea.value = json;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('Battle plan copied to clipboard!');
        });
    }

    /**
     * Generate and show a battle script modal for step-by-step playthrough.
     * Navigation model: clicking a branch replaces the modal content with that path.
     */
    function showBattleScript() {
        if (!uiState.tree || !uiState.tree.rootId) {
            alert('No battle plan to generate script from.');
            return;
        }

        var scriptHistory = [];

        var html = '<div class="battle-script-overlay" id="battle-script-overlay">';
        html += '<div class="battle-script-panel">';
        html += '<div class="battle-script-header">';
        html += '<button class="planner-btn planner-btn-xs" id="script-back" style="display:none">← Back</button>';
        html += '<h3>Battle Script</h3>';
        html += '<button class="dex-overlay-close" id="script-close">&times;</button>';
        html += '</div>';
        html += '<div class="battle-script-content" id="script-content"></div>';
        html += '</div></div>';

        $('body').append(html);

        function renderScriptFrom(nodeId, step) {
            var node = uiState.tree.getNode(nodeId);
            if (!node) node = uiState.tree.getRootNode();
            var content = generateScriptForNode(node, step || 1);
            $('#script-content').html(content);
            $('#script-back').toggle(scriptHistory.length > 0);
        }

        var rootNode = uiState.tree.getRootNode();
        renderScriptFrom(rootNode.id, 1);

        $(document).off('click.battleScript');

        $(document).on('click.battleScript', '#script-close', function () {
            $('#battle-script-overlay').remove();
            $(document).off('click.battleScript');
        });

        // Branch selection: replace content with that branch's path
        $(document).on('click.battleScript', '.script-branch-btn', function (e) {
            e.stopPropagation();
            var nodeId = $(this).data('node-id');
            var node = uiState.tree.getNode(nodeId);
            if (!node) return;
            var currentHtml = $('#script-content').html();
            scriptHistory.push(currentHtml);
            renderScriptFrom(nodeId, 1);
        });

        // Back button: restore previous view
        $(document).on('click.battleScript', '#script-back', function () {
            if (scriptHistory.length > 0) {
                var prev = scriptHistory.pop();
                $('#script-content').html(prev);
                $('#script-back').toggle(scriptHistory.length > 0);
            }
        });

        // "Plan from here" goes back to the planner
        $(document).on('click.battleScript', '.script-plan-btn', function () {
            var nodeId = $(this).data('node-id');
            $('#battle-script-overlay').remove();
            $(document).off('click.battleScript');
            selectNode(nodeId);
        });

        // "Go to planner" for a specific node
        $(document).on('click.battleScript', '.script-goto-planner', function () {
            var nodeId = $(this).data('node-id');
            $('#battle-script-overlay').remove();
            $(document).off('click.battleScript');
            selectNode(nodeId);
        });
    }

    function countTreeDepth(node) {
        if (!node || node.children.length === 0) return 0;
        var maxDepth = 0;
        node.children.forEach(function (childId) {
            var child = uiState.tree.getNode(childId);
            if (child) maxDepth = Math.max(maxDepth, 1 + countTreeDepth(child));
        });
        return maxDepth;
    }

    function generateScriptForNode(node, step) {
        if (!node) return '';
        var html = '';

        var p1 = node.state.p1.active;
        var p2 = node.state.p2.active;
        var p1Name = p1 ? p1.name : '?';
        var p2Name = p2 ? p2.name : '?';

        if (node.children.length === 0) {
            // Leaf node
            var allP2KO = node.state.p2.team.every(function(p) { return p && p.currentHP <= 0; });
            var allP1KO = node.state.p1.team.every(function(p) { return p && p.currentHP <= 0; });
            if (allP2KO) {
                html += '<div class="script-step script-end script-win"><span class="script-step-num">' + step + '</span> 🏆 <strong>Victory!</strong></div>';
            } else if (allP1KO) {
                html += '<div class="script-step script-end script-loss"><span class="script-step-num">' + step + '</span> 💀 <strong>Defeat</strong></div>';
            } else {
                html += '<div class="script-step script-unplanned"><span class="script-step-num">' + step + '</span> ⚠ Not planned beyond here. ';
                html += '<button class="planner-btn planner-btn-xs script-plan-btn" data-node-id="' + node.id + '">Plan from here</button></div>';
            }
            return html;
        }

        // Current turn info
        if (node.children.length === 1) {
            var child = uiState.tree.getNode(node.children[0]);
            if (child && child.actions) {
                var p1Act = child.actions.p1;
                var p2Act = child.actions.p2;
                var yourMove = p1Act ? (p1Act.type === 'switch' ? '→ ' + (p1Act.targetName || '?') : (p1Act.moveName || '?')) : '—';
                var probStr = child.outcome && child.outcome.probability < 1 ? ' <span class="script-prob">' + CalcIntegration.formatProbability(child.outcome.probability) + '</span>' : '';

                html += '<div class="script-step">';
                html += '<span class="script-step-num">' + step + '</span>';
                html += '<div class="script-step-body">';
                html += '<div class="script-you">Your ' + p1Name + ': <strong>' + yourMove + '</strong></div>';
                if (p2Act) {
                    var enemyMove = p2Act.type === 'switch' ? '→ ' + (p2Act.targetName || '?') : (p2Act.moveName || '?');
                    html += '<div class="script-enemy">Enemy ' + p2Name + ': <strong>' + enemyMove + '</strong></div>';
                }

                // Show expected HP after
                var cp1 = child.state.p1.active;
                var cp2 = child.state.p2.active;
                if (cp1 && cp2) {
                    html += '<div class="script-result">';
                    html += cp1.name + ': ' + cp1.currentHP + '/' + cp1.maxHP + ' HP';
                    html += ' | ' + cp2.name + ': ' + cp2.currentHP + '/' + cp2.maxHP + ' HP';
                    html += probStr;
                    html += '</div>';
                }
                html += '</div></div>';
            }
            html += generateScriptForNode(child, step + 1);
        } else {
            // Branch point
            html += '<div class="script-step script-branch-point">';
            html += '<span class="script-step-num">' + step + '</span>';
            html += '<div class="script-step-body">';
            html += '<div class="script-branch-header">⑂ What happened? (' + node.children.length + ' outcomes)</div>';
            html += '<div class="script-branches">';

            node.children.forEach(function (childId) {
                var child = uiState.tree.getNode(childId);
                if (!child) return;
                var desc = child.outcome ? child.outcome.description : '?';
                var prob = child.outcome && child.outcome.probability < 1 ? ' (' + CalcIntegration.formatProbability(child.outcome.probability) + ')' : '';
                var cp1 = child.state.p1.active;
                var cp2 = child.state.p2.active;
                var branchHPInfo = '';
                if (cp1 && cp2) {
                    var p1HPPct = cp1.maxHP > 0 ? Math.round((cp1.currentHP / cp1.maxHP) * 100) : 0;
                    var p2HPPct = cp2.maxHP > 0 ? Math.round((cp2.currentHP / cp2.maxHP) * 100) : 0;
                    branchHPInfo = '<div class="script-branch-hp">' +
                        '<span class="script-hp-p1">' + cp1.name + ': ' + cp1.currentHP + '/' + cp1.maxHP + ' (' + p1HPPct + '%)</span>' +
                        '<span class="script-hp-p2">' + cp2.name + ': ' + cp2.currentHP + '/' + cp2.maxHP + ' (' + p2HPPct + '%)</span>' +
                        '</div>';
                }
                var branchSteps = child.children.length > 0 ? '<span class="script-branch-depth">' + countTreeDepth(child) + ' turns planned</span>' : '<span class="script-branch-depth script-branch-unplanned">not planned</span>';
                html += '<div class="script-branch-option">';
                html += '<button class="planner-btn planner-btn-sm script-branch-btn" data-node-id="' + childId + '">' + desc + prob + '</button>';
                html += branchHPInfo;
                html += branchSteps;
                html += '</div>';
            });

            html += '</div></div></div>';
        }

        return html;
    }

    /**
     * Render tree visualization
     */
    function renderTree() {
        var $treeContent = $('#tree-container');

        if (!uiState.tree.rootId) {
            $treeContent.html($('.tree-placeholder').show());
            return;
        }

        // Get all roots (supports multiple starting points)
        var allRoots = uiState.tree.getAllRoots ? uiState.tree.getAllRoots() : [];
        if (allRoots.length === 0 && uiState.tree.rootId) {
            allRoots = [uiState.tree.getRootNode()];
        }

        var html = '';
        allRoots.forEach(function (rootNode) {
            if (rootNode) {
                var rootLabel = rootNode.label || 'Battle Start';
                var isCurrentRoot = rootNode.id === uiState.tree.rootId;
                html += '<div class="tree-root' + (isCurrentRoot ? ' tree-root-current' : '') + '" data-root-id="' + rootNode.id + '">';
                html += '<div class="tree-root-header" title="' + rootLabel + '">' + rootLabel + '</div>';
                html += renderTreeNode(rootNode.id, 0);
                html += '</div>';
            }
        });

        $treeContent.html(html);
    }

    function renderTreeNode(nodeId, depth) {
        var node = uiState.tree.getNode(nodeId);
        if (!node) return '';

        var isExpanded = uiState.expandedNodes[nodeId] !== false;
        var isCurrentNode = nodeId === uiState.tree.currentNodeId;
        var hasChildren = node.children.length > 0;
        var isRoot = !node.parentId;

        var nodeClasses = ['tree-node'];
        if (isCurrentNode) nodeClasses.push('tree-node-current');

        var p1Active = node.state.p1.active;
        var p2Active = node.state.p2.active;
        var p1HP = 0, p2HP = 0;
        if (p1Active && p1Active.maxHP > 0) {
            p1HP = Math.round((p1Active.currentHP / p1Active.maxHP) * 100);
        }
        if (p2Active && p2Active.maxHP > 0) {
            p2HP = Math.round((p2Active.currentHP / p2Active.maxHP) * 100);
        }

        var p1Color = p1HP > 50 ? 'hp-green' : p1HP > 20 ? 'hp-yellow' : 'hp-red';
        var p2Color = p2HP > 50 ? 'hp-green' : p2HP > 20 ? 'hp-yellow' : 'hp-red';

        var p1KO = p1Active && p1Active.currentHP <= 0;
        var p2KO = p2Active && p2Active.currentHP <= 0;
        // Also check stored KO flags (persist even after replacement switch)
        var storedKO = node.outcome && node.outcome.effects && node.outcome.effects.hadKO;
        if (storedKO) {
            if (storedKO.p1) p1KO = true;
            if (storedKO.p2) p2KO = true;
        }
        if (p1KO) nodeClasses.push('tree-node-p1ko');
        if (p2KO) nodeClasses.push('tree-node-p2ko');

        var p1Name = p1Active ? p1Active.name : '?';
        var p2Name = p2Active ? p2Active.name : '?';

        var turnLabel = 'T' + (node.state.turnNumber || 0);

        // Get branch name from outcome description, with probability
        var branchName = '';
        if (node.outcome && node.outcome.description) {
            branchName = node.outcome.description;
            if (node.outcome.probability && node.outcome.probability < 1) {
                var pctStr = CalcIntegration.formatProbability(node.outcome.probability);
                branchName += ' <span class="tree-probability">' + pctStr + '</span>';
            }
        }

        // Get parent node's active names to show "OldPokemon → NewPokemon" for switches
        var parentNode = node.parentId ? uiState.tree.getNode(node.parentId) : null;
        var parentP1Name = parentNode && parentNode.state.p1.active ? parentNode.state.p1.active.name : p1Name;
        var parentP2Name = parentNode && parentNode.state.p2.active ? parentNode.state.p2.active.name : p2Name;

        var p1ActionText = '';
        var p2ActionText = '';
        if (node.actions && node.actions.p1) {
            p1ActionText = node.actions.p1.type === 'switch'
                ? parentP1Name + ' → ' + (node.actions.p1.targetName || '?')
                : (node.actions.p1.moveName || '?');
        }
        if (node.actions && node.actions.p2) {
            p2ActionText = node.actions.p2.type === 'switch'
                ? parentP2Name + ' → ' + (node.actions.p2.targetName || '?')
                : (node.actions.p2.moveName || '?');
        }

        // Flat layout: NO indentation at any depth
        var html = '<div class="' + nodeClasses.join(' ') + '" data-node-id="' + nodeId + '">';
        html += '<div class="tree-node-card">';

        // Header row
        html += '<div class="tree-node-header">';
        if (hasChildren) {
            html += '<span class="tree-node-toggle">' + (isExpanded ? '▼' : '▶') + '</span>';
        } else {
            html += '<span class="tree-node-toggle tree-node-leaf">○</span>';
        }
        html += '<span class="tree-turn-badge">' + turnLabel + '</span>';
        if (branchName) html += '<span class="tree-branch-name">' + branchName + '</span>';

        var icons = '';
        if (p1KO) {
            var p1KOLabel = p1Name;
            if (node.outcome && node.outcome.effects && node.outcome.effects.p1KOName && node.outcome.effects.p1KOName !== p1Name) {
                p1KOLabel = node.outcome.effects.p1KOName + ' ✗ → ' + p1Name;
            }
            icons += '<span class="tree-ko-marker p1-ko">✗ ' + p1KOLabel + '</span>';
        }
        if (p2KO) {
            var p2KOLabel = p2Name;
            if (node.outcome && node.outcome.effects && node.outcome.effects.p2KOName && node.outcome.effects.p2KOName !== p2Name) {
                p2KOLabel = node.outcome.effects.p2KOName + ' ✗ → ' + p2Name;
            }
            icons += '<span class="tree-ko-marker p2-ko">✓ ' + p2KOLabel + '</span>';
        }
        if (node.pendingKO) icons += '<span class="tree-switch-needed" title="Click to resolve KO switch-in">🔄</span>';
        if (node.outcome && node.outcome.varianceWarnings && node.outcome.varianceWarnings.length > 0) {
            icons += '<span class="tree-variance-icon" data-node-id="' + nodeId + '" title="Click to create variance branches">⚠</span>';
        }
        if (node.outcome && node.outcome.effects && node.outcome.effects.flinchResult &&
            node.outcome.effects.flinchResult.flinches && node.outcome.effects.flinchResult.isGuaranteed) {
            icons += '<span class="tree-flinch-icon" title="Flinch!">💫</span>';
        }
        if (icons) html += '<span class="tree-node-icons">' + icons + '</span>';

        if (!isRoot) {
            html += '<button class="tree-node-delete" data-node-id="' + nodeId + '" title="Delete">&times;</button>';
        }
        html += '</div>';

        // Action rows (Player and Opponent each get their own line)
        var p1IsSwitch = node.actions && node.actions.p1 && node.actions.p1.type === 'switch';
        var p2IsSwitch = node.actions && node.actions.p2 && node.actions.p2.type === 'switch';
        if (p1ActionText || p2ActionText) {
            html += '<div class="tree-node-actions">';
            if (p1ActionText) {
                html += '<div class="tree-action-line">';
                if (!p1IsSwitch) {
                    html += '<span class="tree-action-name p1-name">' + parentP1Name + '</span>';
                }
                html += '<span class="tree-action-move">' + p1ActionText + '</span>';
                if (p1KO) {
                    html += '<span class="tree-action-hp hp-ko-transition"><span class="ko-old-name">' + parentP1Name + ' ✗</span></span>';
                    if (parentP1Name !== p1Name) {
                        html += '</div>';
                        html += '<div class="tree-action-line tree-action-switchin">';
                        html += '<span class="tree-action-name p1-name">→ ' + p1Name + '</span>';
                        html += '<span class="tree-action-hp ' + p1Color + '">' + p1Active.currentHP + '/' + p1Active.maxHP + ' (' + p1HP + '%)</span>';
                    }
                } else {
                    html += '<span class="tree-action-hp ' + p1Color + '">' + p1Active.currentHP + '/' + p1Active.maxHP + ' (' + p1HP + '%)</span>';
                }
                html += '</div>';
            }
            if (p2ActionText) {
                html += '<div class="tree-action-line">';
                if (!p2IsSwitch) {
                    html += '<span class="tree-action-name p2-name">' + parentP2Name + '</span>';
                }
                html += '<span class="tree-action-move">' + p2ActionText + '</span>';
                if (p2KO) {
                    html += '<span class="tree-action-hp hp-ko-transition"><span class="ko-old-name">' + parentP2Name + ' ✗</span></span>';
                    if (parentP2Name !== p2Name) {
                        html += '</div>';
                        html += '<div class="tree-action-line tree-action-switchin">';
                        html += '<span class="tree-action-name p2-name">→ ' + p2Name + '</span>';
                        html += '<span class="tree-action-hp ' + p2Color + '">' + p2Active.currentHP + '/' + p2Active.maxHP + ' (' + p2HP + '%)</span>';
                    }
                } else {
                    html += '<span class="tree-action-hp ' + p2Color + '">' + p2Active.currentHP + '/' + p2Active.maxHP + ' (' + p2HP + '%)</span>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // Status / boost indicators
        var statusLine = '';
        if (p1Active && p1Active.status && p1Active.status !== 'Healthy') statusLine += '<span class="tree-status p1-status">' + p1Name + ': ' + p1Active.status + '</span>';
        if (p2Active && p2Active.status && p2Active.status !== 'Healthy') statusLine += '<span class="tree-status p2-status">' + p2Name + ': ' + p2Active.status + '</span>';
        var boostLine = '';
        [{ mon: p1Active, name: p1Name, cls: 'p1' }, { mon: p2Active, name: p2Name, cls: 'p2' }].forEach(function (o) {
            if (o.mon && o.mon.boosts) {
                var parts = [];
                Object.keys(o.mon.boosts).forEach(function (s) {
                    var v = o.mon.boosts[s];
                    if (v && v !== 0) parts.push(s + (v > 0 ? '+' : '') + v);
                });
                if (parts.length) boostLine += '<span class="tree-boost ' + o.cls + '-boost">' + o.name + ': ' + parts.join(' ') + '</span>';
            }
        });
        if (statusLine || boostLine) {
            html += '<div class="tree-node-meta">' + statusLine + boostLine + '</div>';
        }

        // Battle end check: if all pokemon on one side are fainted
        if (!hasChildren) {
            var allP1KO = node.state.p1.team.every(function(p) { return p && p.currentHP <= 0; });
            var allP2KO = node.state.p2.team.every(function(p) { return p && p.currentHP <= 0; });
            if (allP2KO) {
                html += '<div class="tree-battle-end tree-battle-win">🏆 Victory!</div>';
            } else if (allP1KO) {
                html += '<div class="tree-battle-end tree-battle-loss">💀 Defeat</div>';
            }
        }

        html += '</div></div>';

        // Children: flat list, NO indentation. Branch groups get a label.
        if (hasChildren && isExpanded) {
            var isBranching = node.children.length > 1;
            if (isBranching) {
                var branchGroupId = 'branch-' + nodeId;
                var branchCollapsed = uiState.collapsedBranches && uiState.collapsedBranches[nodeId];
                html += '<div class="tree-branch-group" id="' + branchGroupId + '">';
                html += '<div class="tree-branch-label" data-branch-parent="' + nodeId + '">';
                html += '<span class="tree-branch-toggle">' + (branchCollapsed ? '▶' : '▼') + '</span>';
                html += ' ⑂ ' + node.children.length + ' Branches</div>';
                if (!branchCollapsed) {
                    node.children.forEach(function (childId) {
                        html += renderTreeNode(childId, depth + 1);
                    });
                }
                html += '</div>';
            } else {
                node.children.forEach(function (childId) {
                    html += renderTreeNode(childId, depth + 1);
                });
            }
        }

        return html;
    }

    /**
     * Render stage view
     */
    function renderStage() {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) {
            $('#stage-turn-label').text('TURN 0');
            return;
        }

        var gen = getGenNum();
        var state = currentNode.state;

        $('#stage-turn-label').text('TURN ' + state.turnNumber);

        // Get the effective active Pokemon (taking hover overrides into account)
        var p1Active = state.p1.active;
        if (uiState.p1HoverOverride !== null && state.p1.team[uiState.p1HoverOverride]) {
            p1Active = state.p1.team[uiState.p1HoverOverride];
        } else if (uiState.p1BoxHoverOverride !== null && uiState.p1Box[uiState.p1BoxHoverOverride]) {
            p1Active = uiState.p1Box[uiState.p1BoxHoverOverride];
        }

        var p2Active = state.p2.active;
        if (uiState.p2HoverOverride !== null && state.p2.team[uiState.p2HoverOverride]) {
            p2Active = state.p2.team[uiState.p2HoverOverride];
        } else if (uiState.p2BoxHoverOverride !== null && uiState.p2Box[uiState.p2BoxHoverOverride]) {
            p2Active = uiState.p2Box[uiState.p2BoxHoverOverride];
        }

        renderPokemonCard('p1', p1Active, p2Active);
        renderPokemonCard('p2', p2Active, p1Active);

        // Show KO info banner if this node had a KO that was resolved
        $('#stage-ko-banner').remove();
        var effects = currentNode.outcome && currentNode.outcome.effects;
        if (effects && effects.hadKO && !currentNode.pendingKO) {
            var koBannerParts = [];
            if (effects.hadKO.p2 && effects.p2KOName && effects.p2KOName !== (state.p2.active ? state.p2.active.name : '')) {
                koBannerParts.push('<span class="ko-banner-enemy">' + effects.p2KOName + ' was KO\'d → ' + (state.p2.active ? state.p2.active.name : '?') + ' switched in</span>');
            }
            if (effects.hadKO.p1 && effects.p1KOName && effects.p1KOName !== (state.p1.active ? state.p1.active.name : '')) {
                koBannerParts.push('<span class="ko-banner-player">' + effects.p1KOName + ' was KO\'d → ' + (state.p1.active ? state.p1.active.name : '?') + ' switched in</span>');
            }
            if (koBannerParts.length > 0) {
                $('#stage-container').prepend('<div id="stage-ko-banner" class="stage-ko-banner">' + koBannerParts.join(' | ') + '</div>');
            }
        }

        // Convert to real Pokemon objects for matchup and speed logic
        var p1ActiveObj = CalcIntegration.snapshotToPokemon(p1Active, gen);
        var p2ActiveObj = CalcIntegration.snapshotToPokemon(p2Active, gen);

        // Pass active Pokemon to speed comparison to ensure it uses overrides
        renderSpeedComparison(state, p1ActiveObj, p2ActiveObj);

        // Surgical update of highlights
        var isHoveringParty = uiState.p1HoverOverride !== null || uiState.p2HoverOverride !== null;
        var isHoveringBox = uiState.p1BoxHoverOverride !== null || uiState.p2BoxHoverOverride !== null;
        var isHovering = isHoveringParty || isHoveringBox;

        var p1ActiveSlot = uiState.p1HoverOverride !== null ? uiState.p1HoverOverride : state.p1.teamSlot;
        var p2ActiveSlot = uiState.p2HoverOverride !== null ? uiState.p2HoverOverride : state.p2.teamSlot;

        // If not hovering anywhere, or if we moved to a new node, do a full render
        if (!isHovering || uiState.lastRenderedNodeId !== currentNode.id) {
            renderTeamOverview('p1', state.p1.team, p1ActiveSlot, p2Active);
            renderTeamOverview('p2', state.p2.team, p2ActiveSlot, p1Active);
            renderBoxes(p2Active);
            uiState.lastRenderedNodeId = currentNode.id;
        } else {
            // Just update highlights surgically to keep DOM elements alive
            updateTeamSlotHighlights('p1', p1ActiveSlot, p2Active);
            updateTeamSlotHighlights('p2', p2ActiveSlot, p1Active);
            updateBoxHighlights('p1', uiState.p1BoxHoverOverride, p2Active);
            updateBoxHighlights('p2', uiState.p2BoxHoverOverride, p1Active);
        }

        renderInspector(currentNode);

        // Moves are now rendered in the Pokemon cards directly

        // Reset selections
        updateExecuteTurnButton();
    }

    /**
     * Render Pokemon card
     */
    function renderPokemonCard(side, pokemon, defender) {
        var prefix = 'stage-' + side;

        if (!pokemon) {
            $('#' + prefix + '-name').text('---');
            $('#' + prefix + '-level').text('Lv. --');
            $('#' + prefix + '-hp-text').text('---/---');
            $('#' + prefix + '-hp-fill').css('width', '0%');
            $('#' + prefix + '-sprite').attr('src', '').hide();
            $('#' + prefix + '-moves').empty();
            $('#' + prefix + '-types').empty();
            $('#' + prefix + '-ability').empty();
            $('#' + prefix + '-item').empty();
            $('#' + prefix + '-status').empty();
            $('#' + prefix + '-boosts').empty();
            $('#' + prefix + '-stats-mini').empty();
            return;
        }

        // Header: sprite, name, level
        $('#' + prefix + '-name').text(pokemon.name);
        $('#' + prefix + '-level').text('Lv. ' + pokemon.level);

        var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + pokemon.name + '.png';
        $('#' + prefix + '-sprite')
            .attr('src', spriteUrl)
            .show()
            .off('error')
            .on('error', function () {
                var spriteName = pokemon.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
                $(this).attr('src', 'https://play.pokemonshowdown.com/sprites/gen5/' + spriteName + '.png');
            });

        // Types (in header)
        var typesHtml = (pokemon.types || []).map(function (t) {
            return '<span class="type-badge type-' + t.toLowerCase() + '">' + t + '</span>';
        }).join('');
        $('#' + prefix + '-types').html(typesHtml);

        // HP bar
        var curHP = Math.max(0, pokemon.currentHP || 0);
        var maxHP = pokemon.maxHP || 1;
        var hpPercent = Math.round((curHP / maxHP) * 100);
        var hpColor = hpPercent > 50 ? 'hp-green' : hpPercent > 20 ? 'hp-yellow' : 'hp-red';
        $('#' + prefix + '-hp-text').text(curHP + '/' + maxHP);
        $('#' + prefix + '-hp-fill')
            .removeClass('hp-green hp-yellow hp-red')
            .addClass(hpColor)
            .css('width', hpPercent + '%');

        // Meta row: ability, item, status
        if (pokemon.ability) {
            $('#' + prefix + '-ability').text(pokemon.ability).show();
        } else {
            $('#' + prefix + '-ability').empty().hide();
        }

        if (pokemon.item) {
            $('#' + prefix + '-item').html('<span class="item-badge">🎒 ' + pokemon.item + '</span>');
        } else {
            $('#' + prefix + '-item').empty();
        }

        if (pokemon.status && pokemon.status !== 'Healthy') {
            var statusClass = 'status-' + pokemon.status.toLowerCase().replace(' ', '-');
            $('#' + prefix + '-status').html('<span class="status-badge ' + statusClass + '">' + pokemon.status + '</span>');
        } else {
            $('#' + prefix + '-status').empty();
        }

        // Boosts (inline badges)
        var boosts = pokemon.boosts || {};
        var boostHtml = '';
        ['atk', 'def', 'spa', 'spd', 'spe'].forEach(function (s) {
            var b = boosts[s] || 0;
            if (b > 0) boostHtml += '<span class="boost-badge boost-up">' + s.toUpperCase() + '+' + b + '</span>';
            else if (b < 0) boostHtml += '<span class="boost-badge boost-down">' + s.toUpperCase() + b + '</span>';
        });
        $('#' + prefix + '-boosts').html(boostHtml);

        // Stats row: 6-column horizontal grid
        var statDefs = [
            { key: 'hp', label: 'HP', val: pokemon.maxHP || 0 },
            { key: 'atk', label: 'ATK' },
            { key: 'def', label: 'DEF' },
            { key: 'spa', label: 'SPA' },
            { key: 'spd', label: 'SPD' },
            { key: 'spe', label: 'SPE' }
        ];
        var statsHtml = '';
        statDefs.forEach(function (sd) {
            var baseStat = sd.val !== undefined ? sd.val : (pokemon.stats ? (pokemon.stats[sd.key] || 0) : 0);
            var boost = sd.key === 'hp' ? 0 : (boosts[sd.key] || 0);
            var effectiveStat = baseStat;

            if (boost !== 0) {
                var multiplier = boost > 0 ? (2 + boost) / 2 : 2 / (2 - boost);
                effectiveStat = Math.floor(baseStat * multiplier);
            }

            var statClass = 'stat-item';
            var valueClass = 'stat-value';
            var boostIndicator = '';
            if (boost > 0) {
                statClass += ' stat-boosted';
                valueClass += ' boosted';
                boostIndicator = '<span class="stat-boost-arrow">↑' + boost + '</span>';
            } else if (boost < 0) {
                statClass += ' stat-lowered';
                valueClass += ' lowered';
                boostIndicator = '<span class="stat-boost-arrow">↓' + Math.abs(boost) + '</span>';
            }
            if (sd.key === 'spe') {
                statClass += ' stat-speed';
                var mySpeed = calcEffectiveSpeed(pokemon);
                var theirSpeed = defender ? calcEffectiveSpeed(defender) : 0;
                if (mySpeed > theirSpeed) statClass += ' stat-speed-faster';
                else if (mySpeed < theirSpeed) statClass += ' stat-speed-slower';
                else statClass += ' stat-speed-tie';
            }

            statsHtml += '<div class="' + statClass + '">' +
                '<span class="stat-label">' + sd.label + '</span>' +
                '<span class="' + valueClass + '">' + effectiveStat + boostIndicator + '</span>' +
                '</div>';
        });
        $('#' + prefix + '-stats-mini').html(statsHtml);

        // Show/hide P2 nav buttons based on team size
        if (side === 'p2') {
            var currentNode = uiState.tree.getCurrentNode();
            var p2TeamSize = currentNode && currentNode.state.p2.team ? currentNode.state.p2.team.length : 0;
            if (p2TeamSize > 1) {
                $('#p2-nav-btns').show();
            } else {
                $('#p2-nav-btns').hide();
            }
        }

        renderMoves(side, pokemon, defender);
    }

    /**
     * Render moves with full damage info like base calc (damage ranges, crit, effects)
     */
    function renderMoves(side, pokemon, defenderOverride) {
        var prefix = 'stage-' + side;
        var defender = defenderOverride;

        if (!defender) {
            if (side === 'p1') {
                defender = (uiState.p2HoverOverride !== null && uiState.tree.getCurrentNode().state.p2.team[uiState.p2HoverOverride]) ?
                    uiState.tree.getCurrentNode().state.p2.team[uiState.p2HoverOverride] :
                    uiState.tree.getCurrentNode()?.state.p2.active;
            } else {
                defender = (uiState.p1HoverOverride !== null && uiState.tree.getCurrentNode().state.p1.team[uiState.p1HoverOverride]) ?
                    uiState.tree.getCurrentNode().state.p1.team[uiState.p1HoverOverride] :
                    uiState.tree.getCurrentNode()?.state.p1.active;
            }
        }

        var selectedAction = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        var gen = getGenNum();

        var movesHtml = '<div class="move-grid-2x2">';

        // AI move scoring: use the full R&B AI scoring engine when available
        var aiRecommendedIdx = -1;
        var aiScores = null;
        if (side === 'p2' && defender && BattlePlannerLogic && BattlePlannerLogic.scoreAIMoves) {
            var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
            var scoreState = currentNode ? currentNode.state : null;
            if (scoreState) {
                var calcDmgForAI = function (attacker, target, moveName) {
                    try {
                        var aSide = attacker === pokemon ? 'p2' : 'p1';
                        var preview = getMovePreviewInfo(aSide, attacker, moveName, target, false);
                        if (!preview) return null;
                        return { min: preview.rawMin || 0, max: preview.rawMax || 0 };
                    } catch (e) { return null; }
                };
                aiScores = BattlePlannerLogic.scoreAIMoves(pokemon, defender, scoreState, calcDmgForAI);
                var bestScore = -999;
                if (aiScores) {
                    aiScores.forEach(function (sc, idx) {
                        if (sc.score > bestScore) { bestScore = sc.score; aiRecommendedIdx = idx; }
                    });
                }
            }
        }

        (pokemon.moves || []).forEach(function (moveName, i) {
            if (!moveName || moveName === '(No Move)') return;

            var isSelected = selectedAction && selectedAction.type !== 'switch' && selectedAction.index === i;
            var moveData = getMoveData(moveName, gen);
            var priority = moveData ? (moveData.priority || 0) : 0;

            // Get damage info
            var normalDamage = getMovePreviewInfo(side, pokemon, moveName, defender, false);
            var critDamage = getMovePreviewInfo(side, pokemon, moveName, defender, true);

            // Build classes
            var cellClasses = ['move-cell'];
            if (isSelected) cellClasses.push('selected');
            if (priority > 0) cellClasses.push('priority-move');
            if (priority < 0) cellClasses.push('negative-priority');
            if (moveData && moveData.category === 'Status') cellClasses.push('status-move');

            // Damage-based Highlighting (Inherit colors from matchup scheme)
            var defenderHP = defender ? (defender.currentHP !== undefined ? defender.currentHP : defender.maxHP) : 100;
            if (normalDamage && normalDamage.rawMax > 0 && moveData && moveData.category !== 'Status') {
                if (side === 'p1') {
                    if (normalDamage.rawMin >= defenderHP) cellClasses.push('match-dmg-1');
                    else if (normalDamage.rawMax >= defenderHP) cellClasses.push('match-dmg-2');
                } else {
                    if (normalDamage.rawMin >= defenderHP) cellClasses.push('match-dmg-4');
                    else if (normalDamage.rawMax >= defenderHP) cellClasses.push('match-dmg-3');
                }
            }

            // AI recommended move highlight for opponent
            if (side === 'p2' && i === aiRecommendedIdx) {
                cellClasses.push('ai-recommended');
            }

            movesHtml += '<button class="' + cellClasses.join(' ') + '" data-side="' + side + '" data-index="' + i + '" data-move="' + moveName + '">';

            // Move name with priority indicator and AI badge
            movesHtml += '<div class="move-cell-header">';
            movesHtml += '<span class="move-cell-name">' + moveName + '</span>';
            if (side === 'p2' && i === aiRecommendedIdx && aiScores && aiScores[i]) {
                var scoreVal = aiScores[i].score;
                var scoreReason = aiScores[i].reason || '';
                movesHtml += '<span class="ai-move-badge" title="' + scoreReason.replace(/"/g, '&quot;') + '">AI +' + scoreVal + '</span>';
            }
            if (priority > 0) {
                movesHtml += '<span class="priority-badge">+' + priority + '</span>';
            } else if (priority < 0) {
                movesHtml += '<span class="priority-badge neg">' + priority + '</span>';
            }
            if (normalDamage && normalDamage.type) {
                movesHtml += '<span class="move-type-mini type-' + normalDamage.type.toLowerCase() + '">' + normalDamage.type.substring(0, 3) + '</span>';
            }
            movesHtml += '</div>';

            // Damage or status info
            movesHtml += '<div class="move-cell-damage">';
            if (normalDamage && normalDamage.rawMin !== undefined && normalDamage.rawMax > 0) {
                var defHP = defender ? defender.maxHP : 100;
                var minPct = Math.round((normalDamage.rawMin / defHP) * 100);
                var maxPct = Math.round((normalDamage.rawMax / defHP) * 100);

                movesHtml += '<div class="move-cell-damage-row">';
                movesHtml += '<span class="dmg-range">' + normalDamage.rawMin + '-' + normalDamage.rawMax + '</span>';
                movesHtml += '<span class="dmg-percent">(' + minPct + '-' + maxPct + '%)</span>';
                if (normalDamage.effectiveness && normalDamage.effectivenessIcon) {
                    movesHtml += '<span class="eff-icon">' + normalDamage.effectivenessIcon + '</span>';
                }
                movesHtml += '</div>';

                // Show all 16 damage rolls as comma-separated list (like base calc)
                if (normalDamage.rolls && Array.isArray(normalDamage.rolls) && normalDamage.rolls.length > 1) {
                    var rolls = normalDamage.rolls.slice().sort(function(a,b){return a-b;});
                    var rollSpans = rolls.map(function(v) {
                        var isKO = v >= defenderHP;
                        var cls = isKO ? 'roll-ko' : '';
                        return '<span class="dmg-roll ' + cls + '">' + v + '</span>';
                    });
                    var koCount = rolls.filter(function(v) { return v >= defenderHP; }).length;
                    var koInfo = koCount > 0 && koCount < rolls.length
                        ? ' <span class="rolls-ko-info">(' + koCount + '/' + rolls.length + ' KO)</span>'
                        : '';
                    movesHtml += '<div class="move-cell-rolls">' + rollSpans.join(', ') + koInfo + '</div>';
                }

                if (critDamage && critDamage.rawMin !== undefined) {
                    var critMinPct = Math.round((critDamage.rawMin / defHP) * 100);
                    var critMaxPct = Math.round((critDamage.rawMax / defHP) * 100);
                    movesHtml += '<div class="move-cell-damage-row">';
                    movesHtml += '<span class="crit-range">Crit: ' + critDamage.rawMin + '-' + critDamage.rawMax + ' (' + critMinPct + '-' + critMaxPct + '%)</span>';
                    movesHtml += '</div>';
                }
            } else {
                movesHtml += '<div class="move-cell-damage-row">';
                movesHtml += '<span class="status-label">Status</span>';
                if (moveData && moveData.status) {
                    movesHtml += '<span class="status-effect">' + moveData.status.toUpperCase() + '</span>';
                }
                if (moveData && moveData.boosts) {
                    var boostStr = Object.entries(moveData.boosts).map(function (e) {
                        return e[0] + (e[1] > 0 ? '+' : '') + e[1];
                    }).join(' ');
                    movesHtml += '<span class="boost-effect">' + boostStr + '</span>';
                }
                movesHtml += '</div>';
            }

            if (normalDamage && normalDamage.hitCount && normalDamage.hitCount > 1) {
                var hitsLabel = normalDamage.multiHitRange
                    ? normalDamage.multiHitRange[0] + '-' + normalDamage.multiHitRange[1] + ' hits'
                    : normalDamage.hitCount + ' hits';
                if (normalDamage.perHitMin !== null) {
                    movesHtml += '<div class="move-cell-damage-row"><span class="multihit-badge">' + hitsLabel +
                        ' (' + normalDamage.perHitMin + '-' + normalDamage.perHitMax + ' each)</span></div>';
                } else {
                    movesHtml += '<div class="move-cell-damage-row"><span class="multihit-badge">' + hitsLabel + '</span></div>';
                }
            } else if (moveData && moveData.multihit) {
                var hitStr = Array.isArray(moveData.multihit) ? moveData.multihit[0] + '-' + moveData.multihit[1] : moveData.multihit;
                movesHtml += '<div class="move-cell-damage-row"><span class="multihit-badge">' + hitStr + ' hits</span></div>';
            }

            if (moveData && moveData.recoil) {
                movesHtml += '<span class="move-recoil">⚠️</span>';
            }
            if (moveData && moveData.drain) {
                movesHtml += '<span class="move-drain">💚</span>';
            }

            movesHtml += '</div>';

            // Move description from RBDex
            if (window.RBDex) {
                var dexDesc = window.RBDex.getMoveDesc(moveName);
                if (dexDesc) {
                    movesHtml += '<div class="move-cell-desc">' + dexDesc + '</div>';
                }
            }

            // AI score indicator for all P2 moves
            if (side === 'p2' && aiScores && aiScores[i] && aiScores[i].score > -100) {
                var sc = aiScores[i];
                movesHtml += '<div class="ai-score-row" title="' + (sc.reason||'').replace(/"/g,'&quot;') + '">';
                movesHtml += '<span class="ai-score-label">AI</span>';
                movesHtml += '<span class="ai-score-val' + (sc.score < 0 ? ' ai-score-neg' : '') + '">+' + sc.score + '</span>';
                movesHtml += '</div>';
            }

            movesHtml += '</button>';
        });

        movesHtml += '</div>';

        $('#' + prefix + '-moves').html(movesHtml);
    }

    /**
     * Get move preview info
     */
    function getMovePreviewInfo(side, attacker, moveName, defender, isCrit) {
        if (!moveName || moveName === '(No Move)' || !defender) return null;

        var gen = getGenNum();
        var moveData = null;

        try {
            if (window.calc && window.calc.Generations) {
                var genObj = window.calc.Generations.get(gen);
                if (genObj && genObj.moves) {
                    moveData = genObj.moves.get(window.calc.toID(moveName));
                }
            }
        } catch (e) {
            console.warn('Failed to get move data for', moveName, e);
        }

        if (!moveData) return null;

        var info = {
            type: moveData.type,
            power: moveData.basePower || null,
            category: moveData.category
        };

        // Calculate damage if it's an attacking move
        if (moveData.category !== 'Status' && moveData.basePower > 0) {
            try {
                var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, gen);
                var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, gen);

                if (attackerPokemon && defenderPokemon) {
                    var moveOptions = { isCrit: isCrit || false };

                    // Set hits for multi-hit moves
                    var rbdexMd = window.RBDex ? window.RBDex.getMove(moveName) : null;
                    var hitCount = 1;
                    if (rbdexMd && rbdexMd.multihit) {
                        if (Array.isArray(rbdexMd.multihit)) {
                            moveOptions.hits = rbdexMd.multihit[1]; // show max hits
                            hitCount = rbdexMd.multihit[1];
                            info.multiHitRange = rbdexMd.multihit;
                        } else {
                            moveOptions.hits = rbdexMd.multihit;
                            hitCount = rbdexMd.multihit;
                        }
                        info.hitCount = hitCount;
                    }

                    var move = new window.calc.Move(gen, moveName, moveOptions);
                    var result = window.calc.calculate(gen, attackerPokemon, defenderPokemon, move, window.createField ? window.createField() : null);
                    var range = CalcIntegration.getDamageRange(result);

                    info.rawMin = range.min;
                    info.rawMax = range.max;
                    info.rawAvg = range.avg;
                    info.rolls = range.rolls || [];
                    info.perHitMin = hitCount > 1 ? Math.floor(range.min / hitCount) : null;
                    info.perHitMax = hitCount > 1 ? Math.floor(range.max / hitCount) : null;

                    var minPercent = Math.round((range.min / defender.maxHP) * 100);
                    var maxPercent = Math.round((range.max / defender.maxHP) * 100);

                    info.damageText = minPercent + '-' + maxPercent + '%';

                    // Add effectiveness
                    var effectiveness = CalcIntegration.getTypeEffectiveness(moveData.type, defender.types);
                    info.effectivenessValue = effectiveness;
                    if (effectiveness > 1) {
                        info.damageText += ' ⬆️';
                        info.effectiveness = 'super';
                        info.effectivenessIcon = '⬆️';
                    } else if (effectiveness < 1 && effectiveness > 0) {
                        info.damageText += ' ⬇️';
                        info.effectiveness = 'resist';
                        info.effectivenessIcon = '⬇️';
                    } else if (effectiveness === 0) {
                        info.damageText = 'Immune';
                        info.effectiveness = 'immune';
                        info.effectivenessIcon = '🚫';
                        info.rawMin = 0;
                        info.rawMax = 0;
                    }
                }
            } catch (e) {
                console.warn('Damage calc error for', moveName, e);
            }
        }

        return info;
    }

    /**
     * Render the move details panel (like base calc)
     */
    function renderMoveDetailsPanel() {
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode || !currentNode.state) {
            $('#p1-move-list, #p2-move-list').html('<p class="move-list-empty">Start a battle to see moves</p>');
            return;
        }

        var state = currentNode.state;
        var p1 = state.p1.active;
        var p2 = state.p2.active;
        var gen = getGenNum();

        if (p1) {
            $('#p1-move-list').html(renderMoveListForSide('p1', p1, p2, gen));
        }
        if (p2) {
            $('#p2-move-list').html(renderMoveListForSide('p2', p2, p1, gen));
        }
    }

    /**
     * Render move list for one side with damage ranges, crit, hits, effects
     */
    function renderMoveListForSide(side, attacker, defender, gen) {
        var moves = attacker.moves || [];
        var html = '';

        moves.forEach(function (moveName, i) {
            if (!moveName || moveName === '(No Move)') return;

            var moveData = getMoveData(moveName, gen);
            var damageInfo = calculateMoveDamage(attacker, defender, moveName, gen);
            var critDamageInfo = calculateMoveDamage(attacker, defender, moveName, gen, true);

            var isMultiHit = moveData && Array.isArray(moveData.multihit);
            var isStatus = moveData && moveData.category === 'Status';
            var hasSecondary = moveData && (moveData.secondary || moveData.boosts || moveData.status ||
                moveData.drain || moveData.recoil || moveData.self);

            var selected = (side === 'p1' && uiState.p1Action && uiState.p1Action.index === i) ||
                (side === 'p2' && uiState.p2Action && uiState.p2Action.index === i);

            html += '<div class="move-row ' + (selected ? 'selected' : '') + '" data-side="' + side + '" data-index="' + i + '">';
            html += '<div class="move-row-main">';

            // Move name button
            html += '<button class="move-select-btn" data-side="' + side + '" data-index="' + i + '" data-move="' + moveName + '">';
            html += moveName;
            html += '</button>';

            // Damage range
            if (!isStatus && damageInfo) {
                html += '<span class="move-damage-range">' + damageInfo.minPercent + ' - ' + damageInfo.maxPercent + '%</span>';
            } else if (isStatus) {
                html += '<span class="move-damage-range status-move">Status</span>';
            } else {
                html += '<span class="move-damage-range">0 - 0%</span>';
            }

            // Crit toggle
            html += '<label class="move-crit-label">';
            html += '<input type="checkbox" class="move-crit-toggle" data-side="' + side + '" data-index="' + i + '">';
            html += '<span class="move-crit-btn">Crit</span>';
            html += '</label>';

            // Multi-hit selector
            if (isMultiHit) {
                html += '<select class="move-hits-select" data-side="' + side + '" data-index="' + i + '">';
                html += '<option value="2">2 hits</option>';
                html += '<option value="3" selected>3 hits</option>';
                html += '<option value="4">4 hits</option>';
                html += '<option value="5">5 hits</option>';
                html += '</select>';
            }

            // Effect toggle for moves with effects
            if (hasSecondary || isStatus) {
                var effectLabel = getEffectLabel(moveData);
                if (effectLabel) {
                    html += '<label class="move-effect-label">';
                    html += '<input type="checkbox" class="move-effect-toggle" data-side="' + side + '" data-index="' + i + '" data-effect="' + effectLabel + '">';
                    html += '<span class="move-effect-btn" title="Apply effect: ' + effectLabel + '">' + effectLabel + '</span>';
                    html += '</label>';
                }
            }

            html += '</div>'; // move-row-main

            // Crit damage row (shown when crit is checked)
            if (critDamageInfo && !isStatus) {
                html += '<div class="move-crit-row" style="display:none;">';
                html += '<span class="crit-label">Crit:</span>';
                html += '<span class="move-damage-range crit">' + critDamageInfo.minPercent + ' - ' + critDamageInfo.maxPercent + '%</span>';
                html += '</div>';
            }

            html += '</div>'; // move-row
        });

        return html || '<p class="move-list-empty">No moves available</p>';
    }

    /**
     * Get move data from generation
     */
    function getMoveData(moveName, gen) {
        try {
            if (window.calc && window.calc.Generations) {
                var genNum = (gen && gen.num) ? gen.num : (typeof gen === 'number' ? gen : 8);
                var genObj = window.calc.Generations.get(genNum);
                if (genObj && genObj.moves) {
                    var calcMove = genObj.moves.get(window.calc.toID(moveName));
                    if (calcMove) return calcMove;
                }
            }
        } catch (e) {
            console.error('getMoveData error:', e);
        }
        // Fall back to MoveDB (RBDex-derived) when calc data is unavailable
        if (window.MoveDB) {
            return window.MoveDB.get(moveName);
        }
        return null;
    }

    /**
     * Calculate move damage
     */
    function calculateMoveDamage(attacker, defender, moveName, gen, isCrit) {
        if (!attacker || !defender || !moveName) {
            return null;
        }

        // Normalize gen to number
        var genNum = (gen && gen.num) ? gen.num : (typeof gen === 'number' ? gen : 8);

        var moveData = getMoveData(moveName, genNum);
        if (!moveData || moveData.category === 'Status') {
            return null;
        }

        // For moves with variable BP (like Facade, Hex, etc.), they may have basePower = 0
        // but still deal damage based on conditions
        if (!moveData.basePower && !moveData.basePowerCallback) {
            return null;
        }

        try {
            var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, genNum);
            var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, genNum);

            if (!attackerPokemon || !defenderPokemon) {
                return null;
            }

            var move = new window.calc.Move(genNum, moveName, { isCrit: !!isCrit });
            var field = window.createField ? window.createField() : null;
            var result = window.calc.calculate(genNum, attackerPokemon, defenderPokemon, move, field);

            if (!result || !result.damage) {
                return null;
            }

            var range = CalcIntegration.getDamageRange(result);

            var defenderMaxHP = defender.maxHP || 100;
            return {
                min: range.min,
                max: range.max,
                minPercent: Math.round((range.min / defenderMaxHP) * 1000) / 10,
                maxPercent: Math.round((range.max / defenderMaxHP) * 1000) / 10
            };
        } catch (e) {
            console.error('calculateMoveDamage error for', moveName + ':', e);
            return null;
        }
    }

    /**
     * Get effect label for a move
     */
    function getEffectLabel(moveData) {
        if (!moveData) return null;

        var STATUS_NAMES = {
            'par': 'Paralyze', 'slp': 'Sleep', 'frz': 'Freeze',
            'brn': 'Burn', 'psn': 'Poison', 'tox': 'Toxic'
        };

        // Try MoveDB first for comprehensive labels
        var moveName = moveData.name || '';
        var db = window.MoveDB;
        if (db && moveName) {
            var fx = db.getEffects(moveName);
            if (fx) {
                if (fx.status) return STATUS_NAMES[fx.status] || fx.status;

                if (fx.selfBoosts) {
                    var sb = Object.keys(fx.selfBoosts).map(function (s) {
                        var v = fx.selfBoosts[s];
                        return (v > 0 ? '+' : '') + v + ' ' + s.toUpperCase();
                    });
                    return 'Self: ' + sb.join(', ');
                }

                if (fx.targetBoosts) {
                    var tb = Object.keys(fx.targetBoosts).map(function (s) {
                        var v = fx.targetBoosts[s];
                        return (v > 0 ? '+' : '') + v + ' ' + s.toUpperCase();
                    });
                    return tb.join(', ');
                }

                if (fx.sideCondition) {
                    var SC_LABELS = {
                        stealthrock: 'Stealth Rock', spikes: 'Spikes',
                        toxicspikes: 'Toxic Spikes', stickyweb: 'Sticky Web',
                        reflect: 'Reflect', lightscreen: 'Light Screen',
                        auroraveil: 'Aurora Veil', tailwind: 'Tailwind'
                    };
                    return SC_LABELS[fx.sideCondition] || fx.sideCondition;
                }

                if (fx.weather) return 'Weather';
                if (fx.terrain) return 'Terrain';
                if (fx.volatileStatus) {
                    var VOL_LABELS = {
                        confusion: 'Confuse', attract: 'Attract', leechseed: 'Leech Seed',
                        taunt: 'Taunt', encore: 'Encore', disable: 'Disable',
                        curse: 'Curse', yawn: 'Yawn', torment: 'Torment'
                    };
                    return VOL_LABELS[fx.volatileStatus] || fx.volatileStatus;
                }

                if (fx.selfSwitch) return 'Switch Out';
                if (fx.forceSwitch) return 'Force Switch';

                if (fx.drain) return 'Drain ' + Math.round((fx.drain.numerator / fx.drain.denominator) * 100) + '%';
                if (fx.recoil) return 'Recoil ' + Math.round((fx.recoil.numerator / fx.recoil.denominator) * 100) + '%';
                if (fx.heal) return 'Heal ' + Math.round((fx.heal.numerator / fx.heal.denominator) * 100) + '%';

                for (var i = 0; i < fx.secondaries.length; i++) {
                    var sec = fx.secondaries[i];
                    if (sec.volatileStatus === 'flinch') return sec.chance + '% Flinch';
                    if (sec.status) return sec.chance + '% ' + (STATUS_NAMES[sec.status] || sec.status).toUpperCase();
                    if (sec.targetBoosts) return sec.chance + '% stat drop';
                }

                if (fx.selfDestruct) return 'Self-Destruct';
                if (fx.multihit) return 'Multi-hit';
            }
        }

        // Fallback: raw moveData fields
        if (moveData.status) return STATUS_NAMES[moveData.status] || moveData.status;

        if (moveData.boosts) {
            var boosts = Object.keys(moveData.boosts).map(function (stat) {
                var val = moveData.boosts[stat];
                return (val > 0 ? '+' : '') + val + ' ' + stat.toUpperCase();
            });
            return boosts.join(', ');
        }

        if (moveData.self && moveData.self.boosts) {
            var selfBoosts = Object.keys(moveData.self.boosts).map(function (stat) {
                var val = moveData.self.boosts[stat];
                return (val > 0 ? '+' : '') + val + ' ' + stat.toUpperCase();
            });
            return 'Self: ' + selfBoosts.join(', ');
        }

        if (moveData.secondary) {
            if (moveData.secondary.status) return moveData.secondary.chance + '% ' + moveData.secondary.status.toUpperCase();
            if (moveData.secondary.boosts) return moveData.secondary.chance + '% stat drop';
            if (moveData.secondary.volatileStatus === 'flinch') return moveData.secondary.chance + '% Flinch';
        }

        if (moveData.selfSwitch) return 'Switch Out';
        if (moveData.forceSwitch) return 'Force Switch';

        if (moveData.drain) return 'Drain ' + Math.round((moveData.drain[0] / moveData.drain[1]) * 100) + '%';
        if (moveData.recoil) return 'Recoil ' + Math.round((moveData.recoil[0] / moveData.recoil[1]) * 100) + '%';
        if (moveData.heal) return 'Heal ' + Math.round((moveData.heal[0] / moveData.heal[1]) * 100) + '%';

        return null;
    }

    function getPokedexNumber(name) {
        // Simple lookup - expand as needed
        var numbers = {
            'bulbasaur': 1, 'charmander': 4, 'squirtle': 7, 'pikachu': 25,
            'houndoom': 229, 'minccino': 572, 'tyranitar': 248, 'salamence': 373,
            'metagross': 376, 'garchomp': 445, 'lucario': 448
        };
        var normalized = name.toLowerCase().replace(/[^a-z]/g, '');
        return numbers[normalized] || 0;
    }

    /**
     * Preview move damage
     */
    function previewMoveDamage() {
        // This is now handled in renderMoves
    }

    /**
     * Render speed comparison
     */
    function calcEffectiveSpeed(pokemon, field) {
        if (!pokemon || !pokemon.stats) return 0;
        if (typeof pokemon.getEffectiveSpeed === 'function') {
            return pokemon.getEffectiveSpeed(field);
        }
        // Manual fallback for cloned snapshots
        var baseSpe = pokemon.stats.spe || 0;
        var boost = (pokemon.boosts && pokemon.boosts.spe) || 0;
        var multiplier = 1;
        if (boost > 0) multiplier = (2 + boost) / 2;
        else if (boost < 0) multiplier = 2 / (2 - boost);
        var speed = Math.floor(baseSpe * multiplier);
        var status = (pokemon.status || '').toLowerCase();
        if (status === 'paralyzed' || status === 'par') speed = Math.floor(speed * 0.5);
        if (pokemon.item === 'Choice Scarf') speed = Math.floor(speed * 1.5);
        if (field && field.tailwind) speed = speed * 2;
        return speed;
    }

    function renderSpeedComparison() {
        // Speed banner removed - info shown inline on cards
    }

    function updateTeamSlotHighlights(side, activeSlot, opponentSnapshot) {
        var $slots = $('#team-overview-slots-' + side + ' .team-overview-slot');
        var team = side === 'p1' ? uiState.tree.getCurrentNode().state.p1.team : uiState.tree.getCurrentNode().state.p2.team;
        var field = uiState.tree.getCurrentNode()?.state.field;

        $slots.each(function (i) {
            var $slot = $(this);
            var isActive = i === activeSlot;
            $slot.toggleClass('active', isActive);

            // Update matchup coding if it's P1
            if (side === 'p1' && opponentSnapshot && field) {
                var poke = team[i];
                if (poke) {
                    var match = getMatchupState(poke, opponentSnapshot, field);
                    applyMatchupClasses($slot, match);
                } else {
                    clearMatchupClasses($slot);
                }
            } else if (side === 'p1') {
                clearMatchupClasses($slot);
            }
        });
    }

    /**
     * Update only the highlights of the box slots (e.g. during hover)
     */
    function updateBoxHighlights(side, hoverIndex, opponentSnapshot) {
        var $slots = $('#box-slots-' + side + ' .box-slot');
        var box = side === 'p1' ? uiState.p1Box : uiState.p2Box;
        var field = uiState.tree.getCurrentNode()?.state.field;

        $slots.each(function (i) {
            var $slot = $(this);
            var isHovered = i === hoverIndex;
            $slot.toggleClass('active', isHovered);

            // Update matchup coding if it's P1
            if (side === 'p1' && opponentSnapshot && field) {
                var poke = box[i];
                if (poke) {
                    var match = getMatchupState(poke, opponentSnapshot, field);
                    applyMatchupClasses($slot, match);
                } else {
                    clearMatchupClasses($slot);
                }
            } else if (side === 'p1') {
                clearMatchupClasses($slot);
            }
        });
    }

    /**
     * Clear matchup classes from an element
     */
    function clearMatchupClasses($el) {
        if (!$el.attr('class')) return;
        var classes = $el.attr('class').split(' ');
        var filtered = classes.filter(function (c) {
            return !c.startsWith('match-speed-') && !c.startsWith('match-dmg-');
        });
        $el.attr('class', filtered.join(' '));
    }

    /**
     * Compute and apply matchup classes to an element
     */
    function applyMatchupClasses($el, match) {
        clearMatchupClasses($el);
        if (match) {
            $el.addClass('match-speed-' + match.speed);
            $el.addClass('match-dmg-' + match.code);
        }
    }

    function getMatchupState(snapshot, opponentSnapshot, fieldSnapshot) {
        if (!snapshot || !opponentSnapshot || !fieldSnapshot) return null;

        var gen = getGenNum();
        var pokemon = CalcIntegration.snapshotToPokemon(snapshot, gen);
        var opponent = CalcIntegration.snapshotToPokemon(opponentSnapshot, gen);
        var field = CalcIntegration.snapshotToField(fieldSnapshot);

        if (!pokemon || !opponent || !field) return null;

        // Use effective speeds from real Pokemon objects
        var p1Speed = pokemon.getEffectiveSpeed ? pokemon.getEffectiveSpeed(field) : (pokemon.stats ? pokemon.stats.spe : 100);
        var p2Speed = opponent.getEffectiveSpeed ? opponent.getEffectiveSpeed(field) : (opponent.stats ? opponent.stats.spe : 100);

        // Handle trick room
        if (field.isTrickRoom) {
            var temp = p1Speed;
            p1Speed = p2Speed;
            p2Speed = temp;
        }

        var speedState = p1Speed > p2Speed ? "f" : p1Speed < p2Speed ? "s" : "t";

        var p1KO = 0, p2KO = 0;
        var p1HD = 0, p2HD = 0;

        // Player moves vs Opponent
        (snapshot.moves || []).forEach(function (moveName) {
            if (!moveName || moveName === '(No Move)') return;

            try {
                var calcMove = new window.calc.Move(gen, moveName);
                if (calcMove.category === 'Status') return;

                var result = window.calc.calculate(gen, pokemon, opponent, calcMove, field);
                var range = CalcIntegration.getDamageRange(result);
                var hits = calcMove.hits || 1;

                var maxDmg = range.max * hits;
                if (maxDmg === 0) return;

                var maxPct = (maxDmg / opponent.stats.hp) * 100;
                if (maxPct > p1HD) p1HD = maxPct;

                // KO Detection relative to CURRENT HP
                var minDmgTotal = range.min * hits;
                if (minDmgTotal >= opponentSnapshot.currentHP) p1KO = 1;
                else if (maxDmg >= opponentSnapshot.currentHP && p1KO === 0) p1KO = 2;
            } catch (e) { }
        });

        // Opponent moves vs Player
        var opponentField = field.clone ? field.clone() : CalcIntegration.snapshotToField(fieldSnapshot);
        if (opponentField.swap) opponentField.swap();

        (opponentSnapshot.moves || []).forEach(function (moveName) {
            if (!moveName || moveName === '(No Move)') return;

            try {
                var calcMove = new window.calc.Move(gen, moveName);
                if (calcMove.category === 'Status') return;

                var result = window.calc.calculate(gen, opponent, pokemon, calcMove, opponentField);
                var range = CalcIntegration.getDamageRange(result);
                var hits = calcMove.hits || 1;

                var maxDmg = range.max * hits;
                if (maxDmg === 0) return;

                var maxPct = (maxDmg / pokemon.stats.hp) * 100;
                if (maxPct > p2HD) p2HD = maxPct;

                // KO Detection relative to CURRENT HP
                var minDmgTotal = range.min * hits;
                if (minDmgTotal >= snapshot.currentHP) p2KO = 4;
                else if (maxDmg >= snapshot.currentHP && p2KO < 3) p2KO = 3;
            } catch (e) { }
        });

        // Result priority: First check if user is at risk, then check if user is walling, then just show dmg codes
        // Walling: opponent deals < 25% damage (4HKO), player deals 15%+ and at least 2x what opponent deals.
        var isWall = (p2KO < 3 && p2HD < 25 && p1HD >= 15 && p1HD > p2HD * 2);

        if (isWall) {
            if (p1KO === 1) return { speed: speedState, code: "W1" }; // Wall + Guaranteed OHKO
            if (p1KO === 2) return { speed: speedState, code: "W2" }; // Wall + Possible OHKO
            return { speed: speedState, code: "W" }; // Pure Wall
        }

        var code = (p1KO > 0 ? p1KO.toString() : "") + (p2KO > 0 ? p2KO.toString() : "");
        return { speed: speedState, code: code || "none" };
    }

    /**
     * Render full team overview
     */
    function renderTeamOverview(side, team, activeSlot, opponent) {
        var $container = $('#team-overview-slots-' + side);
        var field = uiState.tree.getCurrentNode()?.state.field;

        if (!team || team.length === 0) {
            if (side === 'p1') {
                team = [];
            } else {
                $container.html('<div class="team-empty">No team loaded</div>');
                return;
            }
        }

        var html = '';
        var renderedEmpty = false;
        for (var i = 0; i < 6; i++) {
            var poke = team[i];
            if (poke) {
                var isActive = i === activeSlot;
                var isFainted = poke.currentHP <= 0 || poke.hasFainted;
                var classes = ['team-overview-slot'];
                if (isActive) classes.push('active');
                if (isFainted) classes.push('fainted');

                // Add matchup classes for P1
                if (side === 'p1' && opponent && field) {
                    var match = getMatchupState(poke, opponent, field);
                    if (match) {
                        classes.push('match-speed-' + match.speed);
                        classes.push('match-dmg-' + match.code);
                    }
                }

                // Calculate HP percentage properly
                var hpPercent = poke.maxHP > 0 ? Math.round((poke.currentHP / poke.maxHP) * 100) : 0;
                if (isFainted) hpPercent = 0;
                var hpColor = hpPercent > 50 ? 'hp-green' : hpPercent > 20 ? 'hp-yellow' : 'hp-red';

                // Use same sprite source as main app
                var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + poke.name + '.png';
                var fallbackUrl = 'https://play.pokemonshowdown.com/sprites/gen5/' + poke.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '') + '.png';

                var statusBadge = '';
                if (isFainted) {
                    statusBadge = '<span class="team-slot-status fainted">FAINTED</span>';
                } else if (poke.status) {
                    statusBadge = '<span class="team-slot-status ' + poke.status + '">' + poke.status.toUpperCase() + '</span>';
                }

                var itemBadge = poke.item ? '<span class="team-slot-item" title="' + poke.item + '">🎒</span>' : '';
                var isP1 = side === 'p1';
                var buttons = isP1 ?
                    '<button class="team-lead-btn" data-side="' + side + '" data-index="' + i + '" title="Set as lead">★</button>' +
                    '<button class="team-item-btn" data-side="' + side + '" data-index="' + i + '" title="Change item">🎒</button>' : '';

                html += '<div class="' + classes.join(' ') + '" data-slot-index="' + i + '" data-side="' + side + '" draggable="' + (isP1 ? 'true' : 'false') + '" title="' + poke.name + ' - ' + poke.currentHP + '/' + poke.maxHP + ' HP">' +
                    buttons +
                    '<img class="team-slot-sprite" src="' + spriteUrl + '" alt="' + poke.name + '" onerror="this.src=\'' + fallbackUrl + '\'">' +
                    '<div class="team-slot-info">' +
                    '<div class="team-slot-name">' + poke.name + (poke.item ? ' <span class="team-item-name">(' + poke.item + ')</span>' : '') + '</div>' +
                    '<div class="team-slot-hp-bar"><div class="team-slot-hp-fill ' + hpColor + '" style="width: ' + hpPercent + '%"></div></div>' +
                    '<div class="team-slot-hp-text">' + Math.max(0, poke.currentHP) + '/' + poke.maxHP + '</div>' +
                    statusBadge +
                    '</div>' +
                    '</div>';
            } else if (side === 'p1' && !renderedEmpty) {
                // Empty slot for P1 - only show ONE
                html += '<div class="team-overview-slot empty" data-slot-index="' + i + '" data-side="' + side + '" title="Drag Pokemon here to add to team">' +
                    '<div class="team-slot-empty-icon">+</div>' +
                    '</div>';
                renderedEmpty = true;
            }
        }

        $container.html(html);
    }

    /**
     * Render boxes
     */
    function renderBoxes(opponent) {
        // Only render P1 box - P2 doesn't have a box (always full team)
        renderBox('p1', uiState.p1Box, opponent);
        // Hide P2 box container since opponent always has full team
        $('#box-container-p2').hide();
    }

    function renderBox(side, box, opponent) {
        var $container = $('#box-slots-' + side);
        var field = uiState.tree.getCurrentNode()?.state.field;

        if (!box || box.length === 0) {
            $container.html('<div class="box-slot" data-slot-index="0"><span class="box-slot-empty">+</span></div>');
            return;
        }

        var html = box.map(function (poke, i) {
            // Use same sprite source as main app
            var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + poke.name + '.png';
            var fallbackUrl = 'https://play.pokemonshowdown.com/sprites/gen5/' + poke.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '') + '.png';

            var isActive = (side === 'p1' && uiState.p1BoxHoverOverride === i) ||
                (side === 'p2' && uiState.p2BoxHoverOverride === i);
            var classes = ['box-slot'];
            if (isActive) classes.push('active');

            // Add matchup classes for P1
            if (side === 'p1' && opponent && field) {
                var match = getMatchupState(poke, opponent, field);
                if (match) {
                    classes.push('match-speed-' + match.speed);
                    classes.push('match-dmg-' + match.code);
                }
            }

            return '<div class="' + classes.join(' ') + '" data-slot-index="' + i + '" draggable="true">' +
                '<img class="box-slot-sprite" src="' + spriteUrl + '" alt="' + poke.name + '" onerror="this.src=\'' + fallbackUrl + '\'">' +
                '</div>';
        }).join('');

        // Add empty slot (only if under 6 pokemon limit in team + box)
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        var teamSize = currentNode && currentNode.state.p1.team ? currentNode.state.p1.team.length : 0;
        if (teamSize + box.length < 6) {
            html += '<div class="box-slot" data-slot-index="' + box.length + '"><span class="box-slot-empty">+</span></div>';
        }

        $container.html(html);
    }

    /**
     * Render probability cloud
     */
    function renderProbabilityCloud(outcomes) {
        var $cloud = $('#cloud-outcomes');

        if (!outcomes || outcomes.length === 0) {
            $cloud.html('<p class="cloud-empty">Select a move to see possible outcomes</p>');
            return;
        }

        var html = outcomes.map(function (outcome, i) {
            var probText = CalcIntegration.formatProbability(outcome.probability);
            var damageText = outcome.damageRange ?
                outcome.damageRange.min + '-' + outcome.damageRange.max :
                Math.round(outcome.damage || 0);
            var percentText = outcome.damagePercent ? outcome.damagePercent + '% HP' : '';

            var classes = ['outcome-btn'];
            if (outcome.effects && outcome.effects.crit) classes.push('outcome-crit');
            if (outcome.effects && outcome.effects.miss) classes.push('outcome-miss');
            if (outcome.koInfo && outcome.koInfo.ohko) classes.push('outcome-ohko');

            var html = '<button class="' + classes.join(' ') + '" data-outcome-index="' + i + '">';
            html += '<span class="outcome-label">' + outcome.label + '</span>';
            html += '<span class="outcome-prob">' + probText + '</span>';

            if (outcome.damage > 0 || outcome.damageRange) {
                html += '<span class="outcome-damage">' + damageText + ' dmg</span>';
                if (percentText) {
                    html += '<span class="outcome-damage">' + percentText + '</span>';
                }
            }

            if (outcome.koInfo && outcome.koInfo.label) {
                html += '<span class="outcome-ko">' + outcome.koInfo.label + '</span>';
            }

            if (outcome.effectivenessInfo && outcome.effectivenessInfo.class !== 'neutral') {
                html += '<span class="outcome-effects">' + outcome.effectivenessInfo.label + '</span>';
            }

            if (outcome.isStatusMove) {
                html += '<span class="outcome-effects">' + outcome.label + '</span>';
            }

            html += '</button>';
            return html;
        }).join('');

        $cloud.html(html);
        uiState.currentOutcomes = outcomes;
    }

    /**
     * Render inspector
     */
    function renderInspector(node) {
        if (!node) return;

        var state = node.state;
        if (!state) return;

        var cumProb = uiState.tree.getCumulativeProbability(node.id);

        $('#inspector-turn').text(state.turnNumber || 0);
        $('#inspector-probability').text(CalcIntegration.formatProbability(cumProb));

        // Build detailed action description
        var actionText = 'Initial State';
        if (node.actions) {
            var parts = [];
            if (node.actions.p1) {
                var p1Desc = node.actions.p1.type === 'switch' ?
                    'P1 → ' + (node.actions.p1.data.targetName || node.actions.p1.targetName || 'Pokemon') :
                    'P1: ' + (node.actions.p1.data.moveName || 'Attack');
                if (node.actions.p1.data.isCrit) p1Desc += ' (Crit)';
                parts.push(p1Desc);
            }
            if (node.actions.p2) {
                var p2Desc = node.actions.p2.type === 'switch' ?
                    'P2 → ' + (node.actions.p2.data.targetName || node.actions.p2.targetName || 'Pokemon') :
                    'P2: ' + (node.actions.p2.data.moveName || 'Attack');
                if (node.actions.p2.data.isCrit) p2Desc += ' (Crit)';
                parts.push(p2Desc);
            }
            actionText = parts.join(' | ') || 'Initial State';
        }
        $('#inspector-action').text(actionText);

        var field = state.field || {};
        $('#inspector-weather').text(field.weather || 'None');
        $('#inspector-terrain').text(field.terrain || 'None');

        if (state.sides) {
            renderSideEffects('p1', state.sides.p1 || {});
            renderSideEffects('p2', state.sides.p2 || {});
        }

        // Add outcome details if available
        var outcomeHtml = '';
        if (node.outcome) {
            if (node.outcome.details) {
                if (node.outcome.details.firstKO) {
                    var koVictim = node.outcome.details.firstMover === 'p1' ? 'Opponent' : 'Player';
                    outcomeHtml += '<span class="outcome-badge ko-badge">' + koVictim + ' KO\'d first!</span> ';
                }
                if (node.outcome.details.secondKO) {
                    var koVictim2 = node.outcome.details.firstMover === 'p2' ? 'Opponent' : 'Player';
                    outcomeHtml += '<span class="outcome-badge ko-badge">' + koVictim2 + ' KO\'d!</span> ';
                }
                if (node.outcome.details.endOfTurnEffects && node.outcome.details.endOfTurnEffects.length > 0) {
                    outcomeHtml += '<br><small>EOT: ' + node.outcome.details.endOfTurnEffects.join(', ') + '</small>';
                }
            }
        }

        // Display current HP for both sides
        if (state.p1.active && state.p2.active) {
            var p1HPText = state.p1.active.currentHP + '/' + state.p1.active.maxHP + ' HP';
            var p2HPText = state.p2.active.currentHP + '/' + state.p2.active.maxHP + ' HP';
            outcomeHtml += '<div class="inspector-hp-summary">';
            outcomeHtml += '<span class="hp-p1">' + state.p1.active.name + ': ' + p1HPText + '</span>';
            outcomeHtml += '<span class="hp-p2">' + state.p2.active.name + ': ' + p2HPText + '</span>';
            outcomeHtml += '</div>';
        }

        // Dynamic legend: only show entries for icons/badges currently visible
        var legendEntries = [];
        var $stage = $('#battle-planner');

        // Move card indicators
        if ($stage.find('.match-dmg-1').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-dmg-1"></span> Guaranteed OHKO</span>');
        if ($stage.find('.match-dmg-2').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-dmg-2"></span> Possible OHKO</span>');
        if ($stage.find('.match-dmg-3').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-dmg-3"></span> Risk of KO</span>');
        if ($stage.find('.match-dmg-4').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-dmg-4"></span> Guaranteed Faint</span>');
        if ($stage.find('.match-dmg-W').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-dmg-W"></span> Walling Defender</span>');

        // Speed indicators
        if ($stage.find('.match-speed-f').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-speed-f"></span> Outspeeds</span>');
        if ($stage.find('.match-speed-s').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-speed-s"></span> Slower</span>');
        if ($stage.find('.match-speed-t').length) legendEntries.push('<span class="legend-item"><span class="legend-swatch match-speed-t"></span> Speed Tie</span>');

        // AI and priority
        if ($stage.find('.ai-move-badge').length) legendEntries.push('<span class="legend-item"><span class="ai-move-badge" style="position:static;font-size:10px;">AI +6</span> AI recommended move (score)</span>');
        if ($stage.find('.priority-badge').length) legendEntries.push('<span class="legend-item"><span class="priority-badge" style="font-size:10px;">+1</span> Priority move bracket</span>');

        // KO markers
        if ($stage.find('.tree-ko-marker.p1-ko').length) legendEntries.push('<span class="legend-item"><span class="tree-ko-marker p1-ko">✗</span> Your Pokemon KO\'d</span>');
        if ($stage.find('.tree-ko-marker.p2-ko').length) legendEntries.push('<span class="legend-item"><span class="tree-ko-marker p2-ko">✓</span> Opponent Pokemon KO\'d</span>');

        // Timeline icons
        if ($stage.find('.tree-variance-icon').length) legendEntries.push('<span class="legend-item">⚠ Roll variance detected</span>');
        if ($stage.find('.tree-flinch-icon').length) legendEntries.push('<span class="legend-item">💫 Flinch occurred</span>');
        if ($stage.find('.tree-switch-needed').length) legendEntries.push('<span class="legend-item">🔄 KO switch-in needed</span>');
        if ($stage.find('.tree-battle-win').length) legendEntries.push('<span class="legend-item">🏆 Victory path</span>');
        if ($stage.find('.tree-battle-loss').length) legendEntries.push('<span class="legend-item">💀 Defeat path</span>');

        // Move card icons
        if ($stage.find('.eff-icon:contains("⬆")').length) legendEntries.push('<span class="legend-item">⬆️ Super effective</span>');
        if ($stage.find('.eff-icon:contains("⬇")').length) legendEntries.push('<span class="legend-item">⬇️ Not very effective</span>');
        if ($stage.find('.eff-icon:contains("🚫")').length) legendEntries.push('<span class="legend-item">🚫 Immune</span>');
        if ($stage.find('.move-drain').length) legendEntries.push('<span class="legend-item">💚 Draining move (heals HP)</span>');
        if ($stage.find('.move-recoil').length) legendEntries.push('<span class="legend-item">⚠️ Recoil damage</span>');
        if ($stage.find('.roll-ko').length) legendEntries.push('<span class="legend-item"><span class="dmg-roll roll-ko" style="font-size:9px;">KO</span> Roll that KOs</span>');
        if ($stage.find('.tree-probability').length) legendEntries.push('<span class="legend-item"><span class="tree-probability" style="font-size:10px;">50%</span> Branch probability</span>');
        if ($stage.find('.multihit-badge').length) legendEntries.push('<span class="legend-item"><span class="multihit-badge" style="font-size:10px;">x2</span> Multi-hit move</span>');

        // Status & stat badges
        if ($stage.find('.boost-badge.boost-up').length) legendEntries.push('<span class="legend-item"><span class="boost-badge boost-up" style="font-size:10px;">ATK+1</span> Stat boosted</span>');
        if ($stage.find('.boost-badge.boost-down').length) legendEntries.push('<span class="legend-item"><span class="boost-badge boost-down" style="font-size:10px;">DEF-1</span> Stat lowered</span>');
        if ($stage.find('.status-badge').length) legendEntries.push('<span class="legend-item"><span class="status-badge" style="font-size:10px;">PSN</span> Status condition</span>');

        if (legendEntries.length > 0) {
            var legendHtml = '<div id="inspector-legend" class="inspector-section"><h4>Legend</h4><div class="legend-items">' +
                legendEntries.join('') + '</div></div>';
            if ($('#inspector-legend').length) {
                $('#inspector-legend').replaceWith(legendHtml);
            } else {
                $('#inspector-container').append(legendHtml);
            }
        } else {
            $('#inspector-legend').remove();
        }

        if (outcomeHtml) {
            if (!$('#inspector-outcome').length) {
                $('#inspector-action').after('<div id="inspector-outcome" class="inspector-field"></div>');
            }
            $('#inspector-outcome').html(outcomeHtml);
        }

        $('#inspector-notes').val(node.notes || '');
    }

    function renderSideEffects(side, sideState) {
        var effects = [];

        if (sideState.stealthRock) effects.push('<span class="effect-tag effect-hazard">Stealth Rock</span>');
        if (sideState.spikes > 0) effects.push('<span class="effect-tag effect-hazard">Spikes ×' + sideState.spikes + '</span>');
        if (sideState.toxicSpikes > 0) effects.push('<span class="effect-tag effect-hazard">T-Spikes ×' + sideState.toxicSpikes + '</span>');
        if (sideState.stickyWeb) effects.push('<span class="effect-tag effect-hazard">Sticky Web</span>');
        if (sideState.reflect) effects.push('<span class="effect-tag effect-screen">Reflect</span>');
        if (sideState.lightScreen) effects.push('<span class="effect-tag effect-screen">Light Screen</span>');
        if (sideState.auroraVeil) effects.push('<span class="effect-tag effect-screen">Aurora Veil</span>');
        if (sideState.tailwind) effects.push('<span class="effect-tag effect-boost">Tailwind</span>');

        var html = effects.length > 0 ? effects.join('') : '<span class="no-effects">None</span>';
        $('#inspector-' + side + '-effects').html(html);
    }

    /**
     * Calculate move outcomes
     */
    function calculateMoveOutcomes(attackerSide, moveIndex) {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var state = currentNode.state;
        var attacker = attackerSide === 'p1' ? state.p1.active : state.p2.active;
        var defender = attackerSide === 'p1' ? state.p2.active : state.p1.active;

        if (!attacker || !defender) return;

        var moveName = attacker.moves[moveIndex];
        if (!moveName || moveName === '(No Move)') return;

        try {
            // Store the selection for turn-based combat
            if (attackerSide === 'p1') {
                uiState.p1Action = { type: 'move', index: moveIndex, moveName: moveName };
                $('#p1-selected-move').text(moveName).addClass('selected');
            } else {
                uiState.p2Action = { type: 'move', index: moveIndex, moveName: moveName };
                $('#p2-selected-move').text(moveName).addClass('selected');
            }

            // Highlight selected move
            $('.pokemon-card-' + attackerSide + ' .move-pill').removeClass('selected');
            $('.pokemon-card-' + attackerSide + ' .move-pill[data-move-index="' + moveIndex + '"]').addClass('selected');

            // Update Execute Turn button state
            updateExecuteTurnButton();

            // If both moves are selected, show turn preview
            if (uiState.p1Action && uiState.p2Action) {
                renderTurnPreview();
            } else {
                // Show individual move outcome preview
                var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, window.GENERATION);
                var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, window.GENERATION);

                if (!attackerPokemon || !defenderPokemon) {
                    attackerPokemon = window.createPokemon ? window.createPokemon($('#' + (attackerSide === 'p1' ? 'p1' : 'p2'))) : null;
                    defenderPokemon = window.createPokemon ? window.createPokemon($('#' + (attackerSide === 'p1' ? 'p2' : 'p1'))) : null;
                }

                if (attackerPokemon && defenderPokemon) {
                    var gen = getGenNum();
                    var move = new window.calc.Move(gen, moveName);

                    var outcomes = CalcIntegration.calculateKeyOutcomes(
                        attackerPokemon,
                        defenderPokemon,
                        move,
                        window.createField ? window.createField() : null,
                        window.GENERATION
                    );

                    uiState.selectedMove = {
                        side: attackerSide,
                        moveIndex: moveIndex,
                        moveName: moveName,
                        attacker: attackerPokemon,
                        defender: defenderPokemon
                    };

                    renderProbabilityCloud(outcomes);

                    // Show damage preview
                    if (outcomes.length > 0) {
                        var avgDamage = outcomes.find(function (o) { return o.type === 'normal'; });
                        if (avgDamage && avgDamage.damage > 0) {
                            showDamagePreview(attackerSide === 'p1' ? 'p2' : 'p1', avgDamage.damage, defender.maxHP);
                        }
                    }
                }
            }

        } catch (e) {
            console.error('Failed to calculate outcomes:', e);
            renderProbabilityCloud([]);
        }
    }

    /**
     * Show damage preview on HP bar
     */
    function showDamagePreview(side, damage, maxHP) {
        var $shadow = $('#stage-' + side + '-hp-shadow');
        var damagePercent = Math.min(100, (damage / maxHP) * 100);

        $shadow.css({
            'width': damagePercent + '%',
            'opacity': 0.5
        });
    }

    /**
     * Update the Execute Turn button state
     */
    function updateExecuteTurnButton() {
        var $btn = $('#execute-turn');
        var canExecute = uiState.p1Action && uiState.p2Action;
        $btn.prop('disabled', !canExecute);

        if (canExecute) {
            $btn.addClass('ready');
        } else {
            $btn.removeClass('ready');
        }
    }

    /**
     * Render turn preview showing what will happen
     */
    function renderTurnPreview() {
        if (!uiState.p1Action || !uiState.p2Action) return;

        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var state = currentNode.state;
        var p1 = state.p1.active;
        var p2 = state.p2.active;

        var p1Speed = calcEffectiveSpeed(p1, state.sides ? state.sides.p1 : null);
        var p2Speed = calcEffectiveSpeed(p2, state.sides ? state.sides.p2 : null);

        // Check for priority moves
        var p1Priority = getMovePriority(uiState.p1Action.moveName);
        var p2Priority = getMovePriority(uiState.p2Action.moveName);

        var firstMover, secondMover;
        if (p1Priority !== p2Priority) {
            firstMover = p1Priority > p2Priority ? 'p1' : 'p2';
        } else if (p1Speed !== p2Speed) {
            firstMover = state.field.isTrickRoom ?
                (p1Speed < p2Speed ? 'p1' : 'p2') :
                (p1Speed > p2Speed ? 'p1' : 'p2');
        } else {
            // Speed tie - random (show both outcomes)
            firstMover = 'tie';
        }
        secondMover = firstMover === 'p1' ? 'p2' : (firstMover === 'p2' ? 'p1' : 'tie');

        // Calculate outcomes for the turn
        var html = '<div class="turn-preview">';
        html += '<div class="turn-order-title">Turn Order:</div>';

        if (firstMover === 'tie') {
            html += '<div class="turn-order-item">⚡ Speed Tie! Order is random</div>';
        } else {
            html += '<div class="turn-order-item">';
            html += '<span class="order-num">1st:</span> ';
            html += '<span class="order-mon">' + (firstMover === 'p1' ? p1.name : p2.name) + '</span> uses ';
            html += '<span class="order-move">' + (firstMover === 'p1' ? uiState.p1Action.moveName : uiState.p2Action.moveName) + '</span>';
            html += '</div>';

            html += '<div class="turn-order-item">';
            html += '<span class="order-num">2nd:</span> ';
            html += '<span class="order-mon">' + (secondMover === 'p1' ? p1.name : p2.name) + '</span> uses ';
            html += '<span class="order-move">' + (secondMover === 'p1' ? uiState.p1Action.moveName : uiState.p2Action.moveName) + '</span>';
            html += '</div>';
        }

        // Calculate damage outcomes
        html += '<div class="turn-outcomes">';
        html += renderMoveOutcomePreview(firstMover === 'p1' ? 'p1' : 'p2');
        html += '</div>';

        html += '</div>';

        $('#cloud-outcomes').html(html);
    }

    /**
     * Render a move outcome preview
     */
    function renderMoveOutcomePreview(side) {
        var currentNode = uiState.tree.getCurrentNode();
        var state = currentNode.state;
        var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        var attacker = side === 'p1' ? state.p1.active : state.p2.active;
        var defender = side === 'p1' ? state.p2.active : state.p1.active;

        try {
            var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, window.GENERATION);
            var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, window.GENERATION);

            if (!attackerPokemon || !defenderPokemon) return '';

            var gen = getGenNum();
            var move = new window.calc.Move(gen, action.moveName);
            var result = window.calc.calculate(gen, attackerPokemon, defenderPokemon, move, window.createField ? window.createField() : null);
            var range = CalcIntegration.getDamageRange(result);

            var minPercent = Math.round((range.min / defender.maxHP) * 100);
            var maxPercent = Math.round((range.max / defender.maxHP) * 100);

            var koCheck = '';
            if (range.max >= defender.currentHP) {
                koCheck = ' <span class="ko-warning">⚠️ Possible KO!</span>';
            }

            return '<div class="outcome-preview">' +
                '<span class="outcome-attacker">' + attacker.name + '</span> → ' +
                '<span class="outcome-damage">' + minPercent + '-' + maxPercent + '%</span>' + koCheck +
                '</div>';
        } catch (e) {
            return '';
        }
    }

    /**
     * Get move priority
     */
    function getMovePriority(moveName) {
        if (!moveName) return 0;

        var gen = getGenNum();
        try {
            if (window.calc && window.calc.Generations) {
                var genObj = window.calc.Generations.get(gen);
                if (genObj && genObj.moves) {
                    var moveData = genObj.moves.get(window.calc.toID(moveName));
                    if (moveData) return moveData.priority || 0;
                }
            }
        } catch (e) { }

        // Fallback for common priority moves
        var priorityMoves = {
            'Quick Attack': 1, 'Mach Punch': 1, 'Aqua Jet': 1, 'Ice Shard': 1,
            'Bullet Punch': 1, 'Shadow Sneak': 1, 'Sucker Punch': 1, 'Vacuum Wave': 1,
            'Extreme Speed': 2, 'Fake Out': 3, 'First Impression': 2,
            'Protect': 4, 'Detect': 4, 'Endure': 4
        };
        return priorityMoves[moveName] || 0;
    }

    /**
     * Select a move for a side's turn
     */
    function selectMoveForTurn(side, index, moveName) {
        // Get current action if exists to preserve crit/effect toggles
        var existingAction = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        var preservedCrit = (existingAction && existingAction.index === index) ? existingAction.isCrit : false;
        var preservedEffect = (existingAction && existingAction.index === index) ? existingAction.applyEffect : false;

        var action = {
            type: 'move',
            index: index,
            moveName: moveName,
            isCrit: preservedCrit,
            hits: 3, // Default for multi-hit moves
            applyEffect: preservedEffect,
            effectType: null
        };

        if (side === 'p1') {
            uiState.p1Action = action;
        } else {
            uiState.p2Action = action;
        }

        // Re-render moves to update selection styling
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (currentNode && currentNode.state) {
            var pokemon = side === 'p1' ? currentNode.state.p1.active : currentNode.state.p2.active;
            renderMoves(side, pokemon);
        }

        updateTurnActionsPanel();
        updateExecuteTurnButton();

        // AI tie detection: when P2 move selected, check for ties
        if (side === 'p2') {
            checkAIMoveTies();
        }
    }

    function checkAIMoveTies() {
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode) return;
        var state = currentNode.state;
        var pokemon = state.p2.active;
        var defender = state.p1.active;

        if (!pokemon || !defender || !BattlePlannerLogic || !BattlePlannerLogic.scoreAIMoves) return;

        var calcDmgForAI = function (attacker, target, moveName) {
            try {
                var aSide = attacker === pokemon ? 'p2' : 'p1';
                var preview = getMovePreviewInfo(aSide, attacker, moveName, target, false);
                if (!preview) return null;
                return { min: preview.rawMin || 0, max: preview.rawMax || 0 };
            } catch (e) { return null; }
        };

        var aiScores = BattlePlannerLogic.scoreAIMoves(pokemon, defender, state, calcDmgForAI);
        if (!aiScores || aiScores.length < 2) return;

        var bestScore = -999;
        aiScores.forEach(function (s) { if (s.score > bestScore) bestScore = s.score; });
        var tiedMoves = aiScores.filter(function (s) { return s.score === bestScore; });

        if (tiedMoves.length > 1) {
            var moveNames = tiedMoves.map(function (s) { return s.moveName; }).join(', ');
            var $banner = $('#ai-tie-banner');
            if (!$banner.length) {
                $banner = $('<div id="ai-tie-banner" class="ai-tie-banner"></div>');
                $('#turn-actions-panel').append($banner);
            }
            $banner.html(
                '<span class="ai-tie-text">AI Tie: ' + tiedMoves.length + ' moves scored +' + bestScore + ' (' + moveNames + ') — will auto-branch on execute</span>'
            ).show();
        } else {
            $('#ai-tie-banner').hide();
        }
    }

    /**
     * Search RBDex data and render results in the overlay.
     */
    function renderDexSearchResults(query, tab) {
        var $results = $('#dex-results');
        $('#dex-detail').hide();
        $results.show();

        if (!query || query.length < 2) {
            $results.html('<p class="dex-placeholder">Type to search the Pokedex...</p>');
            return;
        }

        var html = '';
        var count = 0;
        var maxResults = 50;

        // Pokemon
        if ((tab === 'all' || tab === 'pokemon') && window.BattlePokedex) {
            var pokemonMatches = [];
            for (var pid in window.BattlePokedex) {
                var p = window.BattlePokedex[pid];
                if (!p || !p.name) continue;
                if (p.name.toLowerCase().indexOf(query) !== -1 || pid.indexOf(query) !== -1) {
                    pokemonMatches.push(p);
                    if (pokemonMatches.length >= maxResults) break;
                }
            }
            if (pokemonMatches.length > 0) {
                html += '<div class="dex-section-header">Pokemon</div>';
                pokemonMatches.forEach(function (p) {
                    var bs = p.baseStats || {};
                    var bst = (bs.hp || 0) + (bs.atk || 0) + (bs.def || 0) + (bs.spa || 0) + (bs.spd || 0) + (bs.spe || 0);
                    var types = (p.types || []).map(function (t) {
                        return '<span class="type-badge type-' + t.toLowerCase() + '">' + t + '</span>';
                    }).join(' ');
                    var abils = [];
                    if (p.abilities) {
                        if (p.abilities['0']) abils.push(p.abilities['0']);
                        if (p.abilities['1']) abils.push(p.abilities['1']);
                        if (p.abilities.H) abils.push(p.abilities.H);
                    }
                    html += '<div class="dex-result-row" data-dex-type="pokemon" data-dex-id="' + (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '">';
                    html += '<span class="dex-res-name">' + p.name + '</span>';
                    html += '<span class="dex-res-types">' + types + '</span>';
                    html += '<span class="dex-res-info">' + abils.join(' / ') + '</span>';
                    html += '<span class="dex-res-stats">HP ' + (bs.hp || '?') + ' / Atk ' + (bs.atk || '?') + ' / Def ' + (bs.def || '?') + ' / SpA ' + (bs.spa || '?') + ' / SpD ' + (bs.spd || '?') + ' / Spe ' + (bs.spe || '?') + ' <em>BST ' + bst + '</em></span>';
                    html += '</div>';
                    count++;
                });
            }
        }

        // Moves
        if ((tab === 'all' || tab === 'moves') && window.BattleMovedex) {
            var moveMatches = [];
            for (var mid in window.BattleMovedex) {
                var m = window.BattleMovedex[mid];
                if (!m || !m.name) continue;
                if (m.name.toLowerCase().indexOf(query) !== -1 || mid.indexOf(query) !== -1) {
                    moveMatches.push(m);
                    if (moveMatches.length >= maxResults) break;
                }
            }
            if (moveMatches.length > 0) {
                html += '<div class="dex-section-header">Moves</div>';
                moveMatches.forEach(function (m) {
                    html += '<div class="dex-result-row" data-dex-type="move" data-dex-id="' + (m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '">';
                    html += '<span class="dex-res-name">' + m.name + '</span>';
                    html += '<span class="type-badge type-' + (m.type || 'normal').toLowerCase() + '">' + (m.type || '?') + '</span>';
                    html += '<span class="dex-res-info">' + (m.category || '?') + ' | ' + (m.basePower || '-') + ' BP | ' + (m.accuracy === true ? '—' : (m.accuracy || '?')) + ' Acc</span>';
                    html += '<span class="dex-res-desc">' + (m.shortDesc || m.desc || '') + '</span>';
                    html += '</div>';
                    count++;
                });
            }
        }

        // Items
        if ((tab === 'all' || tab === 'items') && window.BattleItems) {
            var itemMatches = [];
            for (var iid in window.BattleItems) {
                var it = window.BattleItems[iid];
                if (!it || !it.name) continue;
                if (it.name.toLowerCase().indexOf(query) !== -1 || iid.indexOf(query) !== -1) {
                    itemMatches.push(it);
                    if (itemMatches.length >= maxResults) break;
                }
            }
            if (itemMatches.length > 0) {
                html += '<div class="dex-section-header">Items</div>';
                itemMatches.forEach(function (it) {
                    html += '<div class="dex-result-row" data-dex-type="item" data-dex-id="' + (it.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '">';
                    html += '<span class="dex-res-name">' + it.name + '</span>';
                    html += '<span class="dex-res-desc">' + (it.desc || it.shortDesc || '') + '</span>';
                    html += '</div>';
                    count++;
                });
            }
        }

        // Abilities
        if ((tab === 'all' || tab === 'abilities') && window.BattleAbilities) {
            var abilMatches = [];
            for (var aid in window.BattleAbilities) {
                var ab = window.BattleAbilities[aid];
                if (!ab || !ab.name) continue;
                if (ab.name.toLowerCase().indexOf(query) !== -1 || aid.indexOf(query) !== -1) {
                    abilMatches.push(ab);
                    if (abilMatches.length >= maxResults) break;
                }
            }
            if (abilMatches.length > 0) {
                html += '<div class="dex-section-header">Abilities</div>';
                abilMatches.forEach(function (ab) {
                    html += '<div class="dex-result-row" data-dex-type="ability" data-dex-id="' + (ab.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '">';
                    html += '<span class="dex-res-name">' + ab.name + '</span>';
                    html += '<span class="dex-res-desc">' + (ab.shortDesc || ab.desc || '') + '</span>';
                    html += '</div>';
                    count++;
                });
            }
        }

        if (count === 0) {
            html = '<p class="dex-placeholder">No results found for "' + query + '"</p>';
        }

        $results.html(html);
    }

    /**
     * Show detailed view for a specific Dex entry.
     */
    function buildEvolutionChain(speciesName) {
        if (!window.RBDex) return [];
        var chain = [];
        var cur = speciesName;
        // Walk backwards to the earliest pre-evolution
        while (cur) {
            var sp = window.RBDex.getSpecies(cur);
            if (!sp || chain.indexOf(sp.name || cur) !== -1) break;
            chain.unshift(sp.name || cur);
            cur = sp.prevo;
        }
        // Walk forward from the last element
        cur = chain[chain.length - 1];
        while (cur) {
            var sp2 = window.RBDex.getSpecies(cur);
            if (!sp2 || !sp2.evos || !sp2.evos.length) break;
            var nextName = sp2.evos[0];
            if (chain.indexOf(nextName) !== -1) break;
            chain.push(nextName);
            cur = nextName;
        }
        return chain;
    }

    function parseLearnsetCode(code) {
        // e.g. "9L5" -> { gen: 9, method: 'L', level: 5 }
        //      "9M"  -> { gen: 9, method: 'M' }
        //      "9T"  -> { gen: 9, method: 'T' }
        //      "9E"  -> { gen: 9, method: 'E' }
        var match = code.match(/^(\d+)([A-Z])(\d+)?$/);
        if (!match) return null;
        return { gen: parseInt(match[1], 10), method: match[2], level: match[3] ? parseInt(match[3], 10) : null };
    }

    function renderMoveRow(moveName, level) {
        var move = window.RBDex ? window.RBDex.getMove(moveName) : null;
        var name = move ? move.name : moveName;
        var type = move ? (move.type || 'Normal') : 'Normal';
        var cat = move ? (move.category || '—') : '—';
        var power = move ? (move.basePower || '—') : '—';
        var acc = move ? (move.accuracy === true ? '—' : (move.accuracy || '—')) : '—';
        var pp = move ? (move.pp || '—') : '—';
        var desc = move ? (move.shortDesc || '') : '';
        var lvlStr = level !== null && level !== undefined ? level : '—';
        return '<tr class="dex-move-row">' +
            '<td class="dex-move-lvl">' + lvlStr + '</td>' +
            '<td class="dex-move-name">' + name + '</td>' +
            '<td><span class="type-badge type-' + type.toLowerCase() + '">' + type + '</span></td>' +
            '<td class="dex-move-cat">' + cat + '</td>' +
            '<td class="dex-move-num">' + power + '</td>' +
            '<td class="dex-move-num">' + acc + '</td>' +
            '<td class="dex-move-num">' + pp + '</td>' +
            '<td class="dex-move-desc">' + desc + '</td>' +
            '</tr>';
    }

    function showDexDetail(type, id) {
        var $detail = $('#dex-detail-content');
        var html = '';

        if (type === 'pokemon') {
            var species = window.RBDex ? window.RBDex.getSpecies(id) : null;
            if (!species) { $detail.html('<p>Not found</p>'); return; }

            // Header: name, number, types
            html += '<div class="dex-pkmn-header">';
            html += '<h3>' + (species.name || id) + ' <span class="dex-num">#' + (species.num || '?') + '</span></h3>';
            if (species.types) {
                html += '<div class="dex-types">' + species.types.map(function (t) {
                    return '<span class="type-badge type-' + t.toLowerCase() + '">' + t + '</span>';
                }).join(' ') + '</div>';
            }
            html += '</div>';

            // Abilities
            if (species.abilities) {
                var abils = [];
                if (species.abilities['0']) abils.push('<span class="card-ability">' + species.abilities['0'] + '</span>');
                if (species.abilities['1']) abils.push('<span class="card-ability">' + species.abilities['1'] + '</span>');
                if (species.abilities.H) abils.push('<span class="card-ability"><em>' + species.abilities.H + '</em></span> (H)');
                html += '<div class="dex-row"><span class="dex-label">Abilities</span><span>' + abils.join(' | ') + '</span></div>';
            }

            // Base stats
            if (species.baseStats) {
                var bs = species.baseStats;
                var bst = (bs.hp||0)+(bs.atk||0)+(bs.def||0)+(bs.spa||0)+(bs.spd||0)+(bs.spe||0);
                html += '<div class="dex-detail-stats">';
                var statNames = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
                ['hp','atk','def','spa','spd','spe'].forEach(function (s) {
                    var val = bs[s] || 0;
                    var pct = Math.min(100, Math.round((val / 255) * 100));
                    var barColor = val >= 100 ? '#4caf50' : val >= 60 ? '#ffc107' : '#f44336';
                    html += '<div class="dex-stat-bar"><span class="dex-stat-label">' + statNames[s] + '</span><div class="dex-stat-fill-bg"><div class="dex-stat-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div><span class="dex-stat-val">' + val + '</span></div>';
                });
                html += '<div class="dex-stat-bar dex-stat-bst"><span class="dex-stat-label">BST</span><span class="dex-stat-val" style="margin-left:auto">' + bst + '</span></div>';
                html += '</div>';
            }

            // Evolution chain
            var evoChain = buildEvolutionChain(id);
            if (evoChain.length > 1) {
                html += '<div class="dex-evo-chain"><span class="dex-label">Evolution</span>';
                html += '<span class="dex-evo-links">' + evoChain.map(function (name) {
                    var isCurrent = name.toLowerCase().replace(/[^a-z0-9]/g, '') === id.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return '<span class="dex-evo-name' + (isCurrent ? ' dex-evo-current' : '') + '" data-dex-type="pokemon" data-dex-id="' + name + '">' + name + '</span>';
                }).join(' <span class="dex-evo-arrow">&rarr;</span> ') + '</span>';
                html += '</div>';
            }

            // Extra info
            var infoItems = [];
            if (species.weightkg) infoItems.push('<span class="dex-label">Weight</span> ' + species.weightkg + ' kg');
            if (species.heightm) infoItems.push('<span class="dex-label">Height</span> ' + species.heightm + ' m');
            if (species.catchrate) infoItems.push('<span class="dex-label">Catch Rate</span> ' + species.catchrate);
            if (species.eggGroups) infoItems.push('<span class="dex-label">Egg Groups</span> ' + species.eggGroups.join(', '));
            if (species.genderRatio) {
                var gr = species.genderRatio;
                infoItems.push('<span class="dex-label">Gender</span> ' + (gr.M * 100) + '% M / ' + (gr.F * 100) + '% F');
            }
            if (infoItems.length) {
                html += '<div class="dex-extra-info">' + infoItems.map(function (i) { return '<div class="dex-row">' + i + '</div>'; }).join('') + '</div>';
            }

            // Learnset tabs
            var learnset = window.RBDex ? window.RBDex.getLearnset(id) : null;
            if (learnset) {
                var levelUp = [];
                var tmHm = [];
                var tutor = [];
                var egg = [];
                Object.keys(learnset).forEach(function (moveName) {
                    var sources = learnset[moveName];
                    if (!Array.isArray(sources)) return;
                    sources.forEach(function (code) {
                        var parsed = parseLearnsetCode(code);
                        if (!parsed) return;
                        if (parsed.method === 'L') levelUp.push({ move: moveName, level: parsed.level || 0 });
                        else if (parsed.method === 'M') tmHm.push({ move: moveName });
                        else if (parsed.method === 'T') tutor.push({ move: moveName });
                        else if (parsed.method === 'E') egg.push({ move: moveName });
                    });
                });
                levelUp.sort(function (a, b) { return a.level - b.level; });

                html += '<div class="dex-learnset-tabs">';
                html += '<button class="dex-ls-tab active" data-ls-tab="levelup">Level-up (' + levelUp.length + ')</button>';
                html += '<button class="dex-ls-tab" data-ls-tab="tm">TM/HM (' + tmHm.length + ')</button>';
                if (tutor.length) html += '<button class="dex-ls-tab" data-ls-tab="tutor">Tutor (' + tutor.length + ')</button>';
                if (egg.length) html += '<button class="dex-ls-tab" data-ls-tab="egg">Egg (' + egg.length + ')</button>';
                html += '</div>';

                var moveTableHead = '<table class="dex-move-table"><thead><tr><th>Lv</th><th>Move</th><th>Type</th><th>Cat</th><th>Pow</th><th>Acc</th><th>PP</th><th>Effect</th></tr></thead><tbody>';

                // Level-up
                html += '<div class="dex-ls-content" data-ls-content="levelup">';
                html += moveTableHead;
                levelUp.forEach(function (entry) { html += renderMoveRow(entry.move, entry.level); });
                html += '</tbody></table></div>';

                // TM/HM
                html += '<div class="dex-ls-content" data-ls-content="tm" style="display:none">';
                html += moveTableHead;
                tmHm.forEach(function (entry) { html += renderMoveRow(entry.move, '—'); });
                html += '</tbody></table></div>';

                // Tutor
                if (tutor.length) {
                    html += '<div class="dex-ls-content" data-ls-content="tutor" style="display:none">';
                    html += moveTableHead;
                    tutor.forEach(function (entry) { html += renderMoveRow(entry.move, '—'); });
                    html += '</tbody></table></div>';
                }

                // Egg
                if (egg.length) {
                    html += '<div class="dex-ls-content" data-ls-content="egg" style="display:none">';
                    html += moveTableHead;
                    egg.forEach(function (entry) { html += renderMoveRow(entry.move, '—'); });
                    html += '</tbody></table></div>';
                }
            }

        } else if (type === 'move') {
            var move = window.RBDex ? window.RBDex.getMove(id) : null;
            if (!move) { $detail.html('<p>Not found</p>'); return; }
            html += '<h3>' + (move.name || id) + '</h3>';
            html += '<div class="dex-row"><span class="type-badge type-' + (move.type || 'normal').toLowerCase() + '">' + (move.type || '?') + '</span> ' + (move.category || '?') + '</div>';
            html += '<div class="dex-row"><span class="dex-label">Power</span><span>' + (move.basePower || '-') + '</span></div>';
            html += '<div class="dex-row"><span class="dex-label">Accuracy</span><span>' + (move.accuracy === true ? '—' : (move.accuracy || '?')) + '</span></div>';
            html += '<div class="dex-row"><span class="dex-label">PP</span><span>' + (move.pp || '?') + '</span></div>';
            if (move.priority) html += '<div class="dex-row"><span class="dex-label">Priority</span><span>' + move.priority + '</span></div>';
            if (move.desc) html += '<div class="dex-row dex-desc">' + move.desc + '</div>';
            else if (move.shortDesc) html += '<div class="dex-row dex-desc">' + move.shortDesc + '</div>';
        } else if (type === 'item') {
            var item = window.RBDex ? window.RBDex.getItem(id) : null;
            if (!item) { $detail.html('<p>Not found</p>'); return; }
            html += '<h3>' + (item.name || id) + '</h3>';
            if (item.desc) html += '<div class="dex-row dex-desc">' + item.desc + '</div>';
        } else if (type === 'ability') {
            var ab = null;
            if (window.BattleAbilities) {
                var abId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
                ab = window.BattleAbilities[abId];
            }
            if (!ab) { $detail.html('<p>Not found</p>'); return; }
            html += '<h3>' + (ab.name || id) + '</h3>';
            if (ab.desc) html += '<div class="dex-row dex-desc">' + ab.desc + '</div>';
            else if (ab.shortDesc) html += '<div class="dex-row dex-desc">' + ab.shortDesc + '</div>';
            // Show which Pokemon have this ability
            if (window.BattlePokedex) {
                var holders = [];
                for (var pid in window.BattlePokedex) {
                    var pp = window.BattlePokedex[pid];
                    if (!pp || !pp.abilities) continue;
                    if ((pp.abilities['0'] || '').toLowerCase() === (ab.name || '').toLowerCase() ||
                        (pp.abilities['1'] || '').toLowerCase() === (ab.name || '').toLowerCase() ||
                        (pp.abilities.H || '').toLowerCase() === (ab.name || '').toLowerCase()) {
                        holders.push(pp.name || pid);
                    }
                }
                if (holders.length > 0 && holders.length <= 30) {
                    html += '<div class="dex-row"><span class="dex-label">Pokemon</span><span>' + holders.join(', ') + '</span></div>';
                } else if (holders.length > 30) {
                    html += '<div class="dex-row"><span class="dex-label">Pokemon</span><span>' + holders.length + ' Pokemon have this ability</span></div>';
                }
            }
        }

        $detail.html(html);
        $('#dex-results').hide();
        $('#dex-detail').show();
    }

    /**
     * Open the dex overlay pre-filled with a Pokemon name.
     */
    function updateDexPanel(pokemonName) {
        if (!pokemonName) return;
        $('#dex-overlay').fadeIn(150);
        $('#dex-search-input').val(pokemonName).trigger('input');
    }

    /**
     * Cycle through P2 team members for preview (does not consume a turn)
     */
    function cycleP2Pokemon(direction) {
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode) return;
        var team = currentNode.state.p2.team;
        if (!team || team.length <= 1) return;

        var currentSlot = uiState.p2HoverOverride !== null ? uiState.p2HoverOverride : currentNode.state.p2.teamSlot;
        var newSlot = currentSlot + direction;
        if (newSlot < 0) newSlot = team.length - 1;
        if (newSlot >= team.length) newSlot = 0;

        uiState.p2HoverOverride = newSlot;
        renderStage();
    }

    /**
     * Open a nice modal for selecting switch target (only sets the action, doesn't execute)
     */
    function openSwitchSelectorModal(side) {
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode) return;

        var state = currentNode.state;
        var team = side === 'p1' ? state.p1.team : state.p2.team;
        var activeSlot = side === 'p1' ? state.p1.teamSlot : state.p2.teamSlot;

        if (!team || team.length <= 1) {
            alert('No Pokemon available to switch to!');
            return;
        }

        // Build available Pokemon list (exclude fainted and active)
        var available = [];
        team.forEach(function (p, i) {
            if (p && i !== activeSlot && p.currentHP > 0) {
                available.push({ pokemon: p, index: i });
            }
        });

        if (available.length === 0) {
            alert('No healthy Pokemon available to switch to!');
            return;
        }

        // Use the switch selector modal (nice UI)
        $('#switch-select-title').text('Switch ' + (side === 'p1' ? 'Your' : "Opponent's") + ' Pokemon');

        var html = available.map(function (item) {
            var poke = item.pokemon;
            var hpPercent = Math.round((poke.currentHP / poke.maxHP) * 100);
            var hpColor = hpPercent > 50 ? 'hp-green' : hpPercent > 20 ? 'hp-yellow' : 'hp-red';
            var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + poke.name + '.png';
            var fallbackUrl = 'https://play.pokemonshowdown.com/sprites/gen5/' + poke.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '') + '.png';

            return '<div class="switch-select-item" data-side="' + side + '" data-index="' + item.index + '" data-name="' + poke.name + '">' +
                '<img class="switch-select-sprite" src="' + spriteUrl + '" alt="' + poke.name + '" onerror="this.src=\'' + fallbackUrl + '\'">' +
                '<div class="switch-select-info">' +
                '<div class="switch-select-name">' + poke.name + '</div>' +
                '<div class="switch-select-hp-bar"><div class="switch-hp-fill ' + hpColor + '" style="width: ' + hpPercent + '%"></div></div>' +
                '<div class="switch-select-hp-text">' + poke.currentHP + '/' + poke.maxHP + '</div>' +
                '</div>' +
                '</div>';
        }).join('');

        $('#switch-select-grid').html(html);
        $('#switch-select-modal').show();
    }

    /**
     * Toggle crit on the current action
     */
    /**
     * Set switch as the action for a side (doesn't execute until Execute Turn)
     */
    function setSwitchAction(side, targetIndex, targetName) {
        var action = {
            type: 'switch',
            targetSlot: targetIndex,
            targetName: targetName,
            moveName: null
        };

        if (side === 'p1') {
            uiState.p1Action = action;
        } else {
            uiState.p2Action = action;
        }

        updateTurnActionsPanel();
        updateExecuteTurnButton();
    }

    // Item selector state
    var pendingItemSelection = { side: null, index: null };

    /**
     * Open item selector for a team slot
     */
    function openItemSelector(side, index) {
        pendingItemSelection.side = side;
        pendingItemSelection.index = index;

        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        var pokemon = null;
        if (currentNode) {
            var team = side === 'p1' ? currentNode.state.p1.team : currentNode.state.p2.team;
            if (team && team[index]) {
                pokemon = team[index];
            }
        }

        var pokeName = pokemon ? pokemon.name : 'Pokemon';
        var currentItem = pokemon ? pokemon.item : null;
        $('#item-select-title').text('Select Item for ' + pokeName);

        // Get common items list
        var items = getCommonItems();

        var html = '<div class="item-select-option' + (!currentItem ? ' selected' : '') + '" data-item="">(No Item)</div>';
        items.forEach(function (item) {
            var isSelected = currentItem === item ? ' selected' : '';
            var desc = window.RBDex ? window.RBDex.getItemDesc(item) : '';
            html += '<div class="item-select-option' + isSelected + '" data-item="' + item + '">';
            html += '<span class="item-opt-name">' + item + '</span>';
            if (desc) html += '<span class="item-opt-desc">' + desc + '</span>';
            html += '</div>';
        });

        $('#item-select-grid').html(html);
        $('#item-search-input').val('');
        $('#item-select-modal').show();
    }

    /**
     * Get list of common items for Run and Bun
     */
    function getCommonItems() {
        return [
            // Berries
            'Oran Berry', 'Sitrus Berry', 'Lum Berry', 'Cheri Berry', 'Chesto Berry',
            'Pecha Berry', 'Rawst Berry', 'Aspear Berry', 'Persim Berry', 'Leppa Berry',
            'Liechi Berry', 'Ganlon Berry', 'Salac Berry', 'Petaya Berry', 'Apicot Berry',
            // Type boosting
            'Charcoal', 'Mystic Water', 'Miracle Seed', 'Magnet', 'Sharp Beak',
            'Soft Sand', 'Hard Stone', 'Black Belt', 'Poison Barb', 'NeverMeltIce',
            'Spell Tag', 'TwistedSpoon', 'Dragon Fang', 'Black Glasses', 'Metal Coat',
            'Silk Scarf', 'Silver Powder', 'Pink Bow', 'Polkadot Bow',
            // Choice items
            'Choice Band', 'Choice Specs', 'Choice Scarf',
            // Held items
            'Leftovers', 'Life Orb', 'Focus Sash', 'Light Clay', 'Light Ball',
            'Eviolite', 'Assault Vest', 'Rocky Helmet', 'Black Sludge',
            'Expert Belt', 'Muscle Band', 'Wise Glasses', 'Scope Lens',
            'Shell Bell', 'Quick Claw', 'King\'s Rock', 'Bright Powder',
            // Evolution / stat items
            'Thick Club', 'Light Ball', 'DeepSeaTooth', 'DeepSeaScale',
            'Lucky Punch', 'Stick', 'Metal Powder', 'Quick Powder',
            // Plates
            'Flame Plate', 'Splash Plate', 'Meadow Plate', 'Zap Plate',
            'Icicle Plate', 'Fist Plate', 'Toxic Plate', 'Earth Plate',
            'Sky Plate', 'Mind Plate', 'Insect Plate', 'Stone Plate',
            'Spooky Plate', 'Draco Plate', 'Dread Plate', 'Iron Plate'
        ].sort();
    }

    /**
     * Filter item list by search query
     */
    function filterItemList(query) {
        $('.item-select-option').each(function () {
            var item = $(this).data('item') || '';
            var descText = $(this).find('.item-opt-desc').text() || '';
            if (!query || item.toLowerCase().includes(query) || descText.toLowerCase().includes(query)) {
                $(this).show();
            } else {
                $(this).hide();
            }
        });
    }

    /**
     * Apply selected item to the Pokemon slot
     */
    function applyItemToSlot(item) {
        var side = pendingItemSelection.side;
        var index = pendingItemSelection.index;

        if (!side || index === null) return;

        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode) return;

        var team = side === 'p1' ? currentNode.state.p1.team : currentNode.state.p2.team;
        if (!team || !team[index]) return;

        // Update the item
        team[index].item = item || null;

        // Also update active if this is the active slot
        var activeSlot = side === 'p1' ? currentNode.state.p1.teamSlot : currentNode.state.p2.teamSlot;
        if (index === activeSlot) {
            currentNode.state[side].active.item = item || null;
        }

        // Re-render
        renderStage();
    }

    /**
     * Toggle crit on the current action
     */
    function toggleActionCrit(side) {
        var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        if (!action || action.type === 'switch') return;

        action.isCrit = !action.isCrit;

        // Update button visual
        $('#' + side + '-crit-btn').toggleClass('active', action.isCrit);

        updateTurnActionsPanel();
    }

    /**
     * Open effect modal for current action
     */
    function openMoveEffectsForAction(side) {
        var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        if (!action || action.type === 'switch') return;

        openMoveEffectsModal(side, action.index, action.moveName);
    }

    /**
     * Update the Turn Actions panel with selected moves and damage info
     */
    function updateTurnActionsPanel() {
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode) return;

        var state = currentNode.state;

        // Helper to build effect badges
        function buildEffectBadges(action) {
            var badges = '';
            if (action.isCrit) badges += '<span class="effect-badge crit">CRIT</span>';
            if (action.customEffects) {
                var ce = action.customEffects;
                if (ce.noDamage) badges += '<span class="effect-badge">0 DMG</span>';
                if (ce.invulnerable) badges += '<span class="effect-badge">Invuln</span>';
                if (ce.switchSelf) badges += '<span class="effect-badge switch-out">Switch Out</span>';
                if (ce.switchTarget) badges += '<span class="effect-badge force-switch">Force Switch</span>';
                if (ce.targetStatus && ce.targetStatus !== 'none') badges += '<span class="effect-badge status">' + ce.targetStatus.toUpperCase() + '</span>';
                if (ce.targetBoosts) {
                    var boosts = Object.entries(ce.targetBoosts).filter(function (e) { return e[1] !== 0; });
                    if (boosts.length > 0) {
                        badges += '<span class="effect-badge stat-change">' + boosts.map(function (e) { return e[0] + (e[1] > 0 ? '+' : '') + e[1]; }).join(' ') + '</span>';
                    }
                }
                if (ce.selfBoosts) {
                    var selfBoosts = Object.entries(ce.selfBoosts).filter(function (e) { return e[1] !== 0; });
                    if (selfBoosts.length > 0) {
                        badges += '<span class="effect-badge self-buff">' + selfBoosts.map(function (e) { return e[0] + (e[1] > 0 ? '+' : '') + e[1]; }).join(' ') + '</span>';
                    }
                }
            }
            return badges;
        }

        // Update P1 selection display
        if (uiState.p1Action) {
            var p1Html;
            if (uiState.p1Action.type === 'switch') {
                p1Html = '<span class="turn-switch">🔄 → <strong>' + uiState.p1Action.targetName + '</strong></span>';
                $('#p1-action-modifiers').hide();
            } else {
                var p1Damage = getMovePreviewInfo('p1', state.p1.active, uiState.p1Action.moveName, state.p2.active, uiState.p1Action.isCrit);
                p1Html = '<strong>' + uiState.p1Action.moveName + '</strong>';
                if (p1Damage && p1Damage.rawMin !== undefined) {
                    p1Html += ' <span class="turn-damage">' + p1Damage.rawMin + '-' + p1Damage.rawMax + '</span>';
                    var defHP = state.p2.active ? state.p2.active.maxHP : 100;
                    var minPct = Math.round((p1Damage.rawMin / defHP) * 100);
                    var maxPct = Math.round((p1Damage.rawMax / defHP) * 100);
                    p1Html += ' <span class="turn-percent">(' + minPct + '-' + maxPct + '%)</span>';
                }
                p1Html += buildEffectBadges(uiState.p1Action);
                $('#p1-action-modifiers').show();
                $('#p1-crit-btn').toggleClass('active', !!uiState.p1Action.isCrit);
                var hasEffects = uiState.p1Action.customEffects && Object.values(uiState.p1Action.customEffects).some(Boolean);
                $('#p1-effect-btn').toggleClass('active', hasEffects);
            }
            $('#p1-selected-move').html(p1Html).addClass('selected');
        } else {
            $('#p1-selected-move').text('Click a move to select').removeClass('selected');
            $('#p1-action-modifiers').hide();
        }

        // Update P2 selection display
        if (uiState.p2Action) {
            var p2Html;
            if (uiState.p2Action.type === 'switch') {
                p2Html = '<span class="turn-switch">🔄 → <strong>' + uiState.p2Action.targetName + '</strong></span>';
                $('#p2-action-modifiers').hide();
            } else {
                var p2Damage = getMovePreviewInfo('p2', state.p2.active, uiState.p2Action.moveName, state.p1.active, uiState.p2Action.isCrit);
                p2Html = '<strong>' + uiState.p2Action.moveName + '</strong>';
                if (p2Damage && p2Damage.rawMin !== undefined) {
                    p2Html += ' <span class="turn-damage">' + p2Damage.rawMin + '-' + p2Damage.rawMax + '</span>';
                    var defHP2 = state.p1.active ? state.p1.active.maxHP : 100;
                    var minPct2 = Math.round((p2Damage.rawMin / defHP2) * 100);
                    var maxPct2 = Math.round((p2Damage.rawMax / defHP2) * 100);
                    p2Html += ' <span class="turn-percent">(' + minPct2 + '-' + maxPct2 + '%)</span>';
                }
                p2Html += buildEffectBadges(uiState.p2Action);
                $('#p2-action-modifiers').show();
                $('#p2-crit-btn').toggleClass('active', !!uiState.p2Action.isCrit);
                var hasEffects2 = uiState.p2Action.customEffects && Object.values(uiState.p2Action.customEffects).some(Boolean);
                $('#p2-effect-btn').toggleClass('active', hasEffects2);
            }
            $('#p2-selected-move').html(p2Html).addClass('selected');
        } else {
            $('#p2-selected-move').text('Click a move to select').removeClass('selected');
            $('#p2-action-modifiers').hide();
        }
    }

    /**
     * Update Execute Turn button state
     */
    function updateExecuteTurnButton() {
        var canExecute = uiState.p1Action && uiState.p2Action;
        $('#execute-turn').prop('disabled', !canExecute);
        if (canExecute) {
            $('#execute-turn').addClass('ready');
        } else {
            $('#execute-turn').removeClass('ready');
        }
    }

    /**
     * Open team confirmation modal
     */
    function openTeamConfirmModal() {
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        if (!currentNode) return;

        var state = currentNode.state;

        // Build preview
        var p1Html = (state.p1.team || []).map(function (p, i) {
            if (!p) return '';
            var spriteName = p.name ? p.name.split('-')[0] : 'unknown';
            return '<div class="team-confirm-slot">' +
                '<img src="https://raw.githubusercontent.com/May8th1995/sprites/master/' + spriteName + '.png" alt="' + p.name + '">' +
                '<span>' + p.name + '</span>' +
                '</div>';
        }).join('');

        var p2Html = (state.p2.team || []).map(function (p, i) {
            if (!p) return '';
            var spriteName = p.name ? p.name.split('-')[0] : 'unknown';
            return '<div class="team-confirm-slot">' +
                '<img src="https://raw.githubusercontent.com/May8th1995/sprites/master/' + spriteName + '.png" alt="' + p.name + '">' +
                '<span>' + p.name + '</span>' +
                '</div>';
        }).join('');

        $('#team-confirm-p1').html(p1Html || '<p>No team</p>');
        $('#team-confirm-p2').html(p2Html || '<p>No team</p>');
        $('#team-confirm-p2-title').text(uiState.currentTrainer ? 'vs ' + uiState.currentTrainer : "Opponent's Team");

        $('#team-confirm-modal').show();
    }

    /**
     * Confirm team and create new battle starting point
     */
    function confirmTeamAndCreateBattle() {
        $('#team-confirm-modal').hide();

        // Collect the current team from the UI (including drag-and-drop changes)
        var p1Team = collectTeamFromUI('p1');
        var p2Team = collectTeamFromUI('p2');

        if (p1Team.length === 0) {
            alert('Please add Pokemon to your team before confirming.');
            return;
        }

        // Get current lead positions from state
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        var p1Lead = currentNode ? (currentNode.state.p1.teamSlot || 0) : 0;
        var p2Lead = currentNode ? (currentNode.state.p2.teamSlot || 0) : 0;

        // Check if this exact team configuration AND lead combo already exists
        var existingNode = findExistingTeamNode(p1Team, p2Team, p1Lead, p2Lead);
        if (existingNode) {
            // Navigate to the existing node instead of creating a new one
            uiState.tree.navigate(existingNode.id);
            renderTree();
            renderStage();
            return;
        }

        // Create a new root-level starting point with fresh state
        var newInitialState = new BattlePlanner.BattleStateSnapshot();
        newInitialState.turnNumber = 0;

        // Set up P1 team - use current lead position
        newInitialState.p1.team = p1Team.map(function (p) {
            var cloned = p.clone ? p.clone() : Object.assign({}, p);
            cloned.currentHP = cloned.maxHP;
            cloned.status = null;
            cloned.boosts = {};
            return cloned;
        });
        // Set lead to current teamSlot, ensuring it's valid
        var effectiveP1Lead = Math.min(p1Lead, newInitialState.p1.team.length - 1);
        effectiveP1Lead = Math.max(0, effectiveP1Lead);
        newInitialState.p1.active = newInitialState.p1.team[effectiveP1Lead] ? newInitialState.p1.team[effectiveP1Lead].clone() : null;
        newInitialState.p1.teamSlot = effectiveP1Lead;

        // Set up P2 team - use current lead position
        newInitialState.p2.team = p2Team.map(function (p) {
            var cloned = p.clone ? p.clone() : Object.assign({}, p);
            cloned.currentHP = cloned.maxHP;
            cloned.status = null;
            cloned.boosts = {};
            return cloned;
        });
        // Set lead to current teamSlot, ensuring it's valid
        var effectiveP2Lead = Math.min(p2Lead, newInitialState.p2.team.length - 1);
        effectiveP2Lead = Math.max(0, effectiveP2Lead);
        newInitialState.p2.active = newInitialState.p2.team[effectiveP2Lead] ? newInitialState.p2.team[effectiveP2Lead].clone() : null;
        newInitialState.p2.teamSlot = effectiveP2Lead;

        // Copy field from current state if available
        if (currentNode && currentNode.state && currentNode.state.field) {
            newInitialState.field = Object.assign({}, currentNode.state.field);
        }

        // Generate team name with lead info
        var leadName = newInitialState.p1.active ? newInitialState.p1.active.name : '';
        var teamName = 'Lead: ' + leadName;
        var otherMons = p1Team.filter(function (p, i) { return i !== effectiveP1Lead && p; }).slice(0, 2).map(function (p) { return p.name; });
        if (otherMons.length > 0) teamName += ' (' + otherMons.join(', ') + (p1Team.length > 3 ? '...' : '') + ')';

        // Add as a new root branch
        uiState.tree.addRoot(newInitialState, teamName);

        renderTree();
        renderStage();
    }

    /**
     * Collect team from the UI panels
     */
    function collectTeamFromUI(side) {
        var team = [];
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;

        if (currentNode && currentNode.state) {
            var stateTeam = side === 'p1' ? currentNode.state.p1.team : currentNode.state.p2.team;
            if (stateTeam) {
                team = stateTeam.slice();
            }
        }

        // Also include Pokemon from the box that were dragged to team
        var box = side === 'p1' ? uiState.p1Box : uiState.p2Box;
        // Box is separate, team is what's in team slots

        return team;
    }

    /**
     * Find an existing node with the same team configuration
     */
    function findExistingTeamNode(p1Team, p2Team, p1Lead, p2Lead) {
        if (!uiState.tree) return null;

        var roots = uiState.tree.getAllRoots ? uiState.tree.getAllRoots() : [];
        for (var i = 0; i < roots.length; i++) {
            var node = roots[i];
            // Check if teams match AND leads match
            if (teamsMatch(node.state.p1.team, p1Team) &&
                teamsMatch(node.state.p2.team, p2Team) &&
                node.state.p1.teamSlot === p1Lead &&
                node.state.p2.teamSlot === p2Lead) {
                return node;
            }
        }
        return null;
    }

    /**
     * Set a Pokemon as the team lead (reorders team and updates state)
     */
    function setTeamLead(side, index) {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var state = currentNode.state;
        var sideState = side === 'p1' ? state.p1 : state.p2;
        var team = sideState.team;

        if (!team || !team[index]) return;

        // Check if fainted
        if (team[index].currentHP <= 0) {
            alert('Cannot set a fainted Pokemon as lead!');
            return;
        }

        // Reorder: Move team[index] to team[0]
        var poke = team.splice(index, 1)[0];
        team.unshift(poke);

        // After reordering, the lead is always at index 0
        sideState.teamSlot = 0;
        sideState.active = team[0];

        // Re-render to show the change
        renderStage();
    }

    /**
     * Check if two teams have the same Pokemon
     */
    function teamsMatch(team1, team2) {
        if (!team1 && !team2) return true;
        if (!team1 || !team2) return false;
        if (team1.length !== team2.length) return false;

        for (var i = 0; i < team1.length; i++) {
            var p1 = team1[i];
            var p2 = team2[i];
            if (!p1 && !p2) continue;
            if (!p1 || !p2) return false;
            if (p1.name !== p2.name) return false;
        }
        return true;
    }

    // Pending KO replacement state
    var pendingKOReplacement = null;

    /**
     * Show KO replacement modal
     */
    function showKOReplacementModal(side, state, onComplete, titleOverride) {
        var team = side === 'p1' ? state.p1.team : state.p2.team;
        var activeSlot = side === 'p1' ? state.p1.teamSlot : state.p2.teamSlot;

        if (!team || team.length <= 1) {
            // No replacements available
            onComplete(null);
            return;
        }

        var availableSlots = [];
        team.forEach(function (p, i) {
            if (p && i !== activeSlot && p.currentHP > 0) {
                availableSlots.push({ pokemon: p, index: i });
            }
        });

        if (availableSlots.length === 0) {
            // No healthy replacements
            onComplete(null);
            return;
        }

        pendingKOReplacement = { side: side, state: state, onComplete: onComplete };

        var sideLabel = side === 'p1' ? 'Your' : "Opponent's";
        var title = titleOverride || (sideLabel + ' Pokemon Fainted!');
        $('#ko-replacement-title').text(title);
        $('#ko-replacement-text').text('Select a replacement Pokemon:');

        var gridHtml = availableSlots.map(function (slot) {
            var p = slot.pokemon;
            var hpPercent = Math.round((p.currentHP / p.maxHP) * 100);
            var hpColor = hpPercent > 50 ? 'hp-green' : hpPercent > 20 ? 'hp-yellow' : 'hp-red';
            var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + p.name + '.png';
            var fallbackUrl = 'https://play.pokemonshowdown.com/sprites/gen5/' + p.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '') + '.png';

            return '<div class="switch-select-item" data-side="' + side + '" data-index="' + slot.index + '">' +
                '<img class="switch-select-sprite" src="' + spriteUrl + '" alt="' + p.name + '" onerror="this.src=\'' + fallbackUrl + '\'">' +
                '<div class="switch-select-info">' +
                '<div class="switch-select-name">' + p.name + '</div>' +
                '<div class="switch-select-hp-bar"><div class="switch-hp-fill ' + hpColor + '" style="width: ' + hpPercent + '%"></div></div>' +
                '<div class="switch-select-hp-text">' + p.currentHP + '/' + p.maxHP + '</div>' +
                '</div>' +
                '</div>';
        }).join('');

        $('#ko-replacement-grid').html(gridHtml);
        $('#ko-replacement-modal').show();
    }

    /**
     * Select KO replacement
     */
    function selectKOReplacement(side, index) {
        $('#ko-replacement-modal').hide();

        if (!pendingKOReplacement) {
            console.warn('selectKOReplacement called but no pending replacement found');
            return;
        }

        // IMPORTANT: Move the callback to a local variable and clear global state 
        // BEFORE calling it. This prevents nested calls (like U-turn followed by KO)
        // from accidentally wiping the new pending state.
        var onComplete = pendingKOReplacement.onComplete;
        pendingKOReplacement = null;

        onComplete(index);
    }

    /**
     * Show AI prediction banner for P2 switch-in, auto-selecting after a short delay
     * unless the user clicks "Override" to manually pick.
     */
    function showAIPredictBanner(prediction, newState, onDone) {
        var allScoresHtml = '';
        if (prediction.allScores && prediction.allScores.length > 0) {
            allScoresHtml = '<div class="ai-predict-scores">';
            prediction.allScores.forEach(function (s) {
                var isBest = s.slot === prediction.slot;
                allScoresHtml += '<div class="ai-predict-score-row' + (isBest ? ' ai-predict-best' : '') + '">';
                allScoresHtml += '<span class="ai-predict-name">' + s.name + '</span>';
                allScoresHtml += '<span class="ai-predict-score-val">+' + s.score + '</span>';
                allScoresHtml += '<span class="ai-predict-reason">' + s.reason + '</span>';
                allScoresHtml += '</div>';
            });
            allScoresHtml += '</div>';
        }

        var bannerHtml = '<div class="ai-predict-banner" id="ai-predict-banner">' +
            '<div class="ai-predict-header">' +
            '<span class="ai-label">AI Predicts Switch-in</span>' +
            '<span class="ai-mon">' + prediction.pokemon.name + '</span>' +
            '<span class="ai-score">+' + prediction.score + ' (' + prediction.reason + ')</span>' +
            '</div>' +
            allScoresHtml +
            '<div class="ai-predict-buttons">' +
            '<button class="planner-btn planner-btn-sm" id="ai-predict-accept">Accept</button>' +
            '<button class="planner-btn planner-btn-sm planner-btn-outline" id="ai-predict-override">Override</button>' +
            '</div>' +
            '</div>';

        $('#ai-predict-banner').remove();
        $('#stage-container').prepend(bannerHtml);

        var handled = false;

        $('#ai-predict-accept').on('click', function () {
            if (handled) return;
            handled = true;
            $('#ai-predict-banner').remove();
            onDone(prediction.slot);
        });

        $('#ai-predict-override').on('click', function () {
            if (handled) return;
            handled = true;
            $('#ai-predict-banner').remove();
            showKOReplacementModal('p2', newState, onDone);
        });
    }

    /**
     * Sort variance warnings by resolution priority:
     * 1. Faster mover's damage rolls (KO variance) - highest
     * 2. Faster mover's crit variance
     * 3. Slower mover's damage rolls
     * 4. Slower mover's crit variance
     * 5. Secondary effects
     * 6. Flinch
     */
    function sortVarianceByPriority(warnings, firstMover) {
        return warnings.slice().sort(function (a, b) {
            function getPriority(w) {
                var d = w.detail || {};
                if (d.minResult && d.maxResult && w.mover === firstMover) return 0;
                if (d.isCrit && w.mover === firstMover) return 1;
                if (d.minResult && d.maxResult && w.mover !== firstMover) return 2;
                if (d.isCrit && w.mover !== firstMover) return 3;
                if (d.isSecondary) return 4;
                if (d.isFlinch) return 5;
                return 6;
            }
            return getPriority(a) - getPriority(b);
        });
    }

    /**
     * Variance notification with priority-sorted warnings.
     * "Branch All" creates hierarchical branches: faster mover resolves first,
     * remaining variance becomes sub-branches under surviving outcomes.
     */
    function showVarianceNotification(warnings, parentNodeId, currentNodeId) {
        var currentNode = uiState.tree.getNode(currentNodeId);
        var firstMover = currentNode && currentNode.outcome && currentNode.outcome.effects
            ? currentNode.outcome.effects.firstMover : 'p1';

        var sorted = sortVarianceByPriority(warnings, firstMover);

        var branchable = [];
        sorted.forEach(function (w, idx) {
            var d = w.detail || {};
            var canBranch = !!(d.minResult && d.maxResult) || d.isCrit || d.isSecondary || d.isFlinch;
            if (canBranch) branchable.push({ warning: w, idx: idx });
        });

        var lines = sorted.map(function (w, idx) {
            var moverLabel = w.mover === 'p1' ? 'Player' : 'Opponent';
            var icon = '';
            if (w.detail.isCrit) icon = '💥 ';
            else if (w.detail.isSecondary) icon = '🎲 ';
            else if (w.detail.isFlinch) icon = '💫 ';
            else if (w.detail.reason && w.detail.reason.indexOf('KO') !== -1) icon = '☠ ';

            var priorityLabel = '';
            if (branchable.length > 1) {
                var bIdx = -1;
                for (var bi = 0; bi < branchable.length; bi++) {
                    if (branchable[bi].idx === idx) { bIdx = bi; break; }
                }
                if (bIdx === 0) priorityLabel = '<span class="variance-priority">1st</span> ';
                else if (bIdx === 1) priorityLabel = '<span class="variance-priority">2nd</span> ';
                else if (bIdx >= 2) priorityLabel = '<span class="variance-priority">' + (bIdx + 1) + 'th</span> ';
            }

            var btnHtml = '';
            var isBranchable = branchable.some(function (b) { return b.idx === idx; });
            if (isBranchable) {
                btnHtml = ' <button class="planner-btn planner-btn-xs variance-branch-single" data-vidx="' + idx + '">Branch</button>';
            }

            return '<div class="variance-line">' + priorityLabel + icon + '<strong>' + moverLabel + '</strong> ' +
                w.move + ': ' + w.detail.reason + btnHtml + '</div>';
        }).join('');

        var html = '<div class="variance-banner" id="variance-banner">' +
            '<div class="variance-header">⚠ Variance Detected (ordered by speed priority)</div>' +
            '<div class="variance-body">' + lines + '</div>' +
            '<div class="variance-actions">' +
            (branchable.length > 0 ? '<button class="planner-btn planner-btn-sm planner-btn-accent" id="variance-branch-all">Branch All (' + branchable.length + ')</button>' : '') +
            '<button class="planner-btn planner-btn-sm" id="variance-dismiss">Dismiss</button>' +
            '</div>' + '</div>';

        $('#variance-banner').remove();
        $('#stage-container').prepend(html);

        $('#variance-dismiss').on('click', function () {
            $('#variance-banner').remove();
        });

        // Hierarchical "Branch All": resolves faster mover first, nests remaining
        $('#variance-branch-all').on('click', function () {
            var sortedWarnings = branchable.map(function (b) { return b.warning; });
            createHierarchicalBranches(sortedWarnings, parentNodeId, currentNodeId);
            var parentNode = uiState.tree.getNode(parentNodeId);
            if (parentNode) {
                var idx = parentNode.children.indexOf(currentNodeId);
                if (idx !== -1) parentNode.children.splice(idx, 1);
                normalizeSiblingProbabilities(parentNodeId);
            }
            uiState.tree.navigate(parentNodeId);
            $('#variance-banner').remove();
            renderTree();
            renderStage();
        });

        $('.variance-branch-single').on('click', function () {
            var vidx = parseInt($(this).data('vidx'));
            var match = branchable.find(function (b) { return b.idx === vidx; });
            if (match) {
                createSingleVarianceBranch(match.warning, parentNodeId, currentNodeId);
                var parentNode = uiState.tree.getNode(parentNodeId);
                if (parentNode) {
                    var idx = parentNode.children.indexOf(currentNodeId);
                    if (idx !== -1) parentNode.children.splice(idx, 1);
                    normalizeSiblingProbabilities(parentNodeId);
                }
                $(this).closest('.variance-line').addClass('variance-branched');
                $(this).prop('disabled', true).text('Done');
                uiState.tree.navigate(parentNodeId);
                renderTree();
                renderStage();
            }
        });
    }

    /**
     * Create hierarchical branches: process the first warning to create branches,
     * then recursively attach remaining warnings as sub-branches under surviving outcomes.
     */
    function createHierarchicalBranches(sortedWarnings, parentNodeId, currentNodeId) {
        if (sortedWarnings.length === 0) return;

        var firstWarning = sortedWarnings[0];
        var remaining = sortedWarnings.slice(1);

        var branches = createVarianceBranchNodes(firstWarning, parentNodeId, currentNodeId);

        if (remaining.length > 0 && branches.length > 0) {
            branches.forEach(function (branch) {
                if (!branch.node) return;
                var defSide = firstWarning.mover === 'p1' ? 'p2' : 'p1';
                var defAlive = branch.node.state[defSide].active && branch.node.state[defSide].active.currentHP > 0;
                var atkAlive = branch.node.state[firstWarning.mover].active &&
                    branch.node.state[firstWarning.mover].active.currentHP > 0;

                if (defAlive && atkAlive) {
                    var applicable = remaining.filter(function (w) {
                        var wDefSide = w.mover === 'p1' ? 'p2' : 'p1';
                        return branch.node.state[wDefSide].active &&
                            branch.node.state[wDefSide].active.currentHP > 0;
                    });
                    if (applicable.length > 0) {
                        createHierarchicalBranches(applicable, branch.node.id, branch.node.id);
                    }
                }
            });
        }
    }

    /**
     * Create branch nodes for a single variance warning.
     * Returns array of { node, isKO } objects for hierarchical branching.
     */
    function createVarianceBranchNodes(w, parentNodeId, currentNodeId) {
        var currentNode = uiState.tree.getNode(currentNodeId);
        if (!currentNode) return [];
        var d = w.detail;
        var defSide = w.mover === 'p1' ? 'p2' : 'p1';
        var results = [];

        if (d.minResult && d.maxResult) {
            var minState = currentNode.state.clone();
            minState[defSide].active.currentHP = Math.max(0, d.minResult.hp);
            minState[defSide].active.percentHP = minState[defSide].active.maxHP > 0
                ? Math.round((minState[defSide].active.currentHP / minState[defSide].active.maxHP) * 100) : 0;
            minState[defSide].active.hasFainted = minState[defSide].active.currentHP <= 0;
            if (d.minResult.itemConsumed) minState[defSide].active.item = '';
            syncActiveToTeam(minState);
            var survProb = d.surviveChance || 0.5;
            var koProb = d.koChance || 0.5;
            var survPct = CalcIntegration.formatProbability(survProb);
            var koPct = CalcIntegration.formatProbability(koProb);
            var minN = uiState.tree.addBranch(parentNodeId, minState, currentNode.actions,
                new BattlePlanner.BattleOutcome('Survives (' + w.move + ', ' + survPct + ')', survProb, 0, { rollType: 'min' }));
            markBranchKOs(minN, minState);
            results.push({ node: minN, isKO: false });

            var maxState = currentNode.state.clone();
            maxState[defSide].active.currentHP = Math.max(0, d.maxResult.hp);
            maxState[defSide].active.percentHP = maxState[defSide].active.maxHP > 0
                ? Math.round((maxState[defSide].active.currentHP / maxState[defSide].active.maxHP) * 100) : 0;
            maxState[defSide].active.hasFainted = maxState[defSide].active.currentHP <= 0;
            if (d.maxResult.itemConsumed) maxState[defSide].active.item = '';
            syncActiveToTeam(maxState);
            var maxN = uiState.tree.addBranch(parentNodeId, maxState, currentNode.actions,
                new BattlePlanner.BattleOutcome('KO (' + w.move + ', ' + koPct + ')', koProb, 0, { rollType: 'max' }));
            markBranchKOs(maxN, maxState);
            results.push({ node: maxN, isKO: true });

        } else if (d.isCrit) {
            var normState = currentNode.state.clone();
            var normN = uiState.tree.addBranch(parentNodeId, normState, currentNode.actions,
                new BattlePlanner.BattleOutcome('No Crit (' + w.move + ')', 0.9375, 0, { rollType: 'noCrit' }));
            results.push({ node: normN, isKO: false });

            var critState = currentNode.state.clone();
            var critDef = critState[defSide].active;
            var critDmg = Math.floor((d.critMin + d.critMax) / 2);
            var normalDmg = Math.floor((d.normalMin + d.normalMax) / 2);
            var dmgDiff = critDmg - normalDmg;
            critDef.currentHP = Math.max(0, critDef.currentHP - dmgDiff);
            critDef.percentHP = critDef.maxHP > 0 ? Math.round((critDef.currentHP / critDef.maxHP) * 100) : 0;
            critDef.hasFainted = critDef.currentHP <= 0;
            syncActiveToTeam(critState);
            var critN = uiState.tree.addBranch(parentNodeId, critState, currentNode.actions,
                new BattlePlanner.BattleOutcome('Crit! (' + w.move + ')', 0.0625, 0, { rollType: 'crit' }));
            markBranchKOs(critN, critState);
            results.push({ node: critN, isKO: critDef.currentHP <= 0 });

        } else if (d.isSecondary && d.secondaryEffect) {
            var sec = d.secondaryEffect;
            var chance = sec.chance / 100;
            var missState = currentNode.state.clone();
            var missN = uiState.tree.addBranch(parentNodeId, missState, currentNode.actions,
                new BattlePlanner.BattleOutcome('No Effect (' + w.move + ' ' + sec.chance + '%)', 1 - chance, 0, { rollType: 'noSecondary' }));
            results.push({ node: missN, isKO: false });

            var hitState = currentNode.state.clone();
            var effTarget = hitState[defSide].active;
            var effUser = hitState[w.mover].active;
            if (sec.status && (!effTarget.status || effTarget.status === 'Healthy')) {
                effTarget.status = normalizeStatus(sec.status);
            }
            if (sec.boosts) applyBoosts(effTarget, sec.boosts);
            if (sec.selfBoosts) applyBoosts(effUser, sec.selfBoosts);
            syncActiveToTeam(hitState);
            var effectDesc = sec.status || (sec.boosts ? 'stat change' : sec.volatileStatus || 'effect');
            var hitN = uiState.tree.addBranch(parentNodeId, hitState, currentNode.actions,
                new BattlePlanner.BattleOutcome(effectDesc + ' (' + w.move + ' ' + sec.chance + '%)', chance, 0, { rollType: 'secondary' }));
            results.push({ node: hitN, isKO: false });

        } else if (d.isFlinch) {
            var noFlinchState = currentNode.state.clone();
            var noFlinchN = uiState.tree.addBranch(parentNodeId, noFlinchState, currentNode.actions,
                new BattlePlanner.BattleOutcome('No Flinch (' + w.move + ')', 1 - d.flinchChance, 0, { rollType: 'noFlinch' }));
            results.push({ node: noFlinchN, isKO: false });

            var flinchState = currentNode.state.clone();
            var flinchN = uiState.tree.addBranch(parentNodeId, flinchState, currentNode.actions,
                new BattlePlanner.BattleOutcome('Flinch! (' + w.move + ' ' + Math.round(d.flinchChance * 100) + '%)', d.flinchChance, 0, { rollType: 'flinch' }));
            results.push({ node: flinchN, isKO: false });
        }

        return results;
    }

    /**
     * Normalize sibling branch probabilities to sum to 1.0
     */
    function normalizeSiblingProbabilities(parentNodeId) {
        var parentNode = uiState.tree.getNode(parentNodeId);
        if (!parentNode || parentNode.children.length === 0) return;

        var total = 0;
        var children = [];
        parentNode.children.forEach(function (childId) {
            var child = uiState.tree.getNode(childId);
            if (child) {
                var prob = child.outcome ? child.outcome.probability : 1.0;
                total += prob;
                children.push(child);
            }
        });

        if (total > 0 && Math.abs(total - 1.0) > 0.001) {
            children.forEach(function (child) {
                if (child.outcome) {
                    child.outcome.probability = child.outcome.probability / total;
                }
            });
        }
    }

    /**
     * After creating a branch node, check if a Pokemon is KO'd and mark
     * the node so that navigating to it will trigger the switch flow.
     */
    function markBranchKOs(node, branchState) {
        var p1KO = branchState.p1.active && branchState.p1.active.currentHP <= 0;
        var p2KO = branchState.p2.active && branchState.p2.active.currentHP <= 0;
        if (p1KO || p2KO) {
            node.pendingKO = { p1: p1KO, p2: p2KO };
            if (!node.outcome) node.outcome = {};
            if (!node.outcome.effects) node.outcome.effects = {};
            if (p1KO) node.outcome.effects.p1KOName = branchState.p1.active.name;
            if (p2KO) node.outcome.effects.p2KOName = branchState.p2.active.name;
            node.outcome.effects.hadKO = { p1: p1KO, p2: p2KO };
        }
    }

    /**
     * Legacy wrapper: create branches for a single variance warning.
     */
    function createSingleVarianceBranch(w, parentNodeId, currentNodeId) {
        createVarianceBranchNodes(w, parentNodeId, currentNodeId);
    }

    /**
     * Calculate the best (highest max-roll) damage an attacker can deal to a defender,
     * iterating over all of the attacker's moves. Used for AI switch-in scoring.
     */
    function calcBestDamageForAI(attacker, defender, gen) {
        if (!attacker || !defender || !attacker.moves) return 0;
        var best = 0;
        var genNum = typeof gen === 'number' ? gen : (gen && gen.num ? gen.num : 3);

        for (var i = 0; i < attacker.moves.length; i++) {
            var moveName = attacker.moves[i];
            if (!moveName || moveName === '(No Move)') continue;

            try {
                var moveData = null;
                if (window.calc && window.calc.Generations) {
                    var genObj = window.calc.Generations.get(genNum);
                    if (genObj && genObj.moves) {
                        moveData = genObj.moves.get(window.calc.toID(moveName));
                    }
                }
                if (!moveData || moveData.category === 'Status' || !moveData.basePower) continue;

                var aPoke = CalcIntegration.snapshotToPokemon(attacker, genNum);
                var dPoke = CalcIntegration.snapshotToPokemon(defender, genNum);
                if (!aPoke || !dPoke) continue;

                var move = new window.calc.Move(genNum, moveName);
                var result = window.calc.calculate(genNum, aPoke, dPoke, move, window.createField ? window.createField() : null);
                var range = CalcIntegration.getDamageRange(result);
                if (range.max > best) best = range.max;
            } catch (e) { /* skip */ }
        }
        return best;
    }

    /**
     * Attempt to auto-predict the AI switch-in for P2 when an enemy faints.
     * Returns { slot, pokemon, score, reason } or null.
     */
    function tryPredictP2SwitchIn(newState) {
        if (!BattlePlannerLogic || !BattlePlannerLogic.predictAISwitchIn) return null;
        var gen = getGenNum();
        var playerActive = newState.p1.active;
        var p2Team = newState.p2.team;
        var faintedSlot = newState.p2.teamSlot;

        return BattlePlannerLogic.predictAISwitchIn(playerActive, p2Team, faintedSlot, gen, calcBestDamageForAI);
    }

    /**
     * Apply end-of-turn effects (poison, burn, weather, etc.)
     */
    function applyEndOfTurnEffects(state, gen) {
        if (BattlePlannerLogic) {
            return BattlePlannerLogic.applyEndOfTurnEffects(state, gen);
        }
        return [];
    }

    var isExecutingTurn = false;
    var isExecutingAITieBranches = false;

    /**
     * When AI has tied moves, execute the turn once per tied move to create branches.
     * Each branch represents a different AI choice with equal probability.
     */
    function executeAITieBranches(tiedMoves, parentNode) {
        var savedP1Action = JSON.parse(JSON.stringify(uiState.p1Action));
        var parentNodeId = parentNode.id;
        var aiPokemon = parentNode.state.p2.active;
        var branchIdx = 0;
        isExecutingAITieBranches = true;

        function executeNextBranch() {
            if (branchIdx >= tiedMoves.length) {
                $('#ai-tie-banner').hide();
                isExecutingTurn = false;
                isExecutingAITieBranches = false;
                uiState.tree.navigate(parentNodeId);
                renderTree();
                renderStage();
                return;
            }

            var tm = tiedMoves[branchIdx];
            branchIdx++;

            uiState.tree.navigate(parentNodeId);
            uiState.p1Action = JSON.parse(JSON.stringify(savedP1Action));
            uiState.p2Action = {
                type: 'move',
                index: (aiPokemon.moves || []).indexOf(tm.moveName),
                moveName: tm.moveName,
                isCrit: false,
                hits: 3,
                applyEffect: false
            };

            setTimeout(function () {
                executeTurn();
                setTimeout(executeNextBranch, 100);
            }, 50);
        }

        isExecutingTurn = false;
        executeNextBranch();
    }

    /**
     * Execute the full turn with both moves.
     * If the AI has tied moves, automatically creates branches for each tied move.
     */
    function executeTurn() {
        if (isExecutingTurn) {
            console.warn('Turn already executing...');
            return;
        }

        if (!uiState.p1Action || !uiState.p2Action) {
            alert('Please select moves for both Pokemon');
            return;
        }

        // Check for AI tied moves and auto-branch (skip if already executing tie branches)
        var currentNode = uiState.tree.getCurrentNode();
        if (!isExecutingAITieBranches && currentNode && uiState.p2Action.type === 'move' && BattlePlannerLogic && BattlePlannerLogic.scoreAIMoves) {
            var state = currentNode.state;
            var aiPokemon = state.p2.active;
            var playerPokemon = state.p1.active;
            if (aiPokemon && playerPokemon) {
                var calcDmgForAI = function (attacker, target, moveName) {
                    try {
                        var aSide = attacker === aiPokemon ? 'p2' : 'p1';
                        var preview = getMovePreviewInfo(aSide, attacker, moveName, target, false);
                        if (!preview) return null;
                        return { min: preview.rawMin || 0, max: preview.rawMax || 0 };
                    } catch (e) { return null; }
                };
                var aiScores = BattlePlannerLogic.scoreAIMoves(aiPokemon, playerPokemon, state, calcDmgForAI);
                if (aiScores) {
                    var bestScore = -999;
                    aiScores.forEach(function (s) { if (s.score > bestScore) bestScore = s.score; });
                    var tiedMoves = aiScores.filter(function (s) { return s.score === bestScore; });

                    if (tiedMoves.length > 1) {
                        executeAITieBranches(tiedMoves, currentNode);
                        return;
                    }
                }
            }
        }

        if (!currentNode) currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var state = currentNode.state;
        var gen = getGenNum();

        // Execute the turn
        try {
            isExecutingTurn = true;
            var newState = currentNode.state.clone();

            var p1IsSwitch = uiState.p1Action.type === 'switch';
            var p2IsSwitch = uiState.p2Action.type === 'switch';

            function performSwitch(side, action, stateObj) {
                if (BattlePlannerLogic) {
                    BattlePlannerLogic.performSwitch(stateObj, side, action.targetSlot);
                } else {
                    var sideData = stateObj[side];
                    if (sideData.team && sideData.teamSlot !== undefined && sideData.team[sideData.teamSlot]) {
                        sideData.team[sideData.teamSlot].currentHP = sideData.active.currentHP;
                        sideData.team[sideData.teamSlot].status = sideData.active.status;
                        sideData.team[sideData.teamSlot].boosts = {};
                    }
                    sideData.teamSlot = action.targetSlot;
                    sideData.active = sideData.team[action.targetSlot].clone();
                    sideData.active.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
                }
            }

            // Get priorities - switches have priority +6, also check custom priority modifiers
            var p1CustomPriority = uiState.p1Action.customEffects ? (uiState.p1Action.customEffects.priorityMod || 0) : 0;
            var p2CustomPriority = uiState.p2Action.customEffects ? (uiState.p2Action.customEffects.priorityMod || 0) : 0;
            var p1Priority = p1IsSwitch ? 6 : (getMovePriority(uiState.p1Action.moveName) + p1CustomPriority);
            var p2Priority = p2IsSwitch ? 6 : (getMovePriority(uiState.p2Action.moveName) + p2CustomPriority);

            var p1Speed = calcEffectiveSpeed(newState.p1.active, newState.sides ? newState.sides.p1 : null);
            var p2Speed = calcEffectiveSpeed(newState.p2.active, newState.sides ? newState.sides.p2 : null);

            var firstMover, secondMover;
            var isTrickRoom = newState.field && (newState.field.trickRoom || newState.field.isTrickRoom);

            if (p1Priority !== p2Priority) {
                firstMover = p1Priority > p2Priority ? 'p1' : 'p2';
            } else if (p1Speed !== p2Speed) {
                firstMover = isTrickRoom ?
                    (p1Speed < p2Speed ? 'p1' : 'p2') :
                    (p1Speed > p2Speed ? 'p1' : 'p2');
            } else {
                // Speed tie - randomly pick
                firstMover = Math.random() < 0.5 ? 'p1' : 'p2';
            }
            secondMover = firstMover === 'p1' ? 'p2' : 'p1';

            var firstAction = firstMover === 'p1' ? uiState.p1Action : uiState.p2Action;
            var secondAction = secondMover === 'p1' ? uiState.p1Action : uiState.p2Action;
            var firstIsSwitch = firstMover === 'p1' ? p1IsSwitch : p2IsSwitch;
            var secondIsSwitch = secondMover === 'p1' ? p1IsSwitch : p2IsSwitch;

            var firstKO = false;
            var secondKO = false;

            // Track pending switches for proper U-turn handling
            var pendingSwitchAfterMove = { p1: null, p2: null };
            var pendingForcedSwitch = { p1: false, p2: false };

            // Track damage ranges for variance detection
            var firstMoveResult = null;
            var secondMoveResult = null;
            var flinchResult = null;
            var p1NeedsSwitch = false;
            var p2NeedsSwitch = false;

            // --- Execute first action ---
            if (firstIsSwitch) {
                performSwitch(firstMover, firstAction, newState);
            } else {
                var firstAttacker = newState[firstMover].active;
                var firstDefender = newState[secondMover].active;
                firstMoveResult = applyMoveToStateEnhanced(firstAttacker, firstDefender, firstAction, gen, newState);

                firstKO = firstDefender.currentHP <= 0;
                var firstAttackerFainted = firstAttacker.currentHP <= 0;

                syncActiveToTeam(newState);

                if (firstAttacker.needsSwitchAfterMove && !firstAttackerFainted) {
                    pendingSwitchAfterMove[firstMover] = true;
                    delete firstAttacker.needsSwitchAfterMove;
                }

                if (firstDefender.needsForcedSwitch && !firstKO) {
                    pendingForcedSwitch[secondMover] = true;
                    delete firstDefender.needsForcedSwitch;
                }

                // Flinch check: use RBDex data which has proper secondary/flinch info
                if (!firstKO && !firstAttackerFainted && !firstIsSwitch) {
                    var flinchMoveData = (window.MoveDB && window.MoveDB.get(firstAction.moveName)) ||
                                         (window.RBDex ? window.RBDex.getMove(firstAction.moveName) : null);
                    if (flinchMoveData) {
                        flinchResult = BattlePlannerLogic.checkFlinch(
                            flinchMoveData, firstAttacker, firstDefender, firstAction.moveName
                        );
                    }
                }
            }

            // --- Execute second action (if second mover not KO'd and not forced to switch) ---
            var executeSecondAction = function (onSecondActionComplete) {
                try {
                    var secondAttacker = newState[secondMover].active;
                    var secondDefender = newState[firstMover].active;
                    var secondAttackerKO = secondAttacker.currentHP <= 0;

                    var secondForcedToSwitch = pendingForcedSwitch[secondMover];

                    // Check flinch: guaranteed flinch skips the second move
                    var secondFlinched = flinchResult && flinchResult.flinches && flinchResult.isGuaranteed;

                    if (!secondAttackerKO && !secondForcedToSwitch && !secondFlinched) {
                        if (secondIsSwitch) {
                            performSwitch(secondMover, secondAction, newState);
                        } else {
                            secondDefender = newState[firstMover].active;
                            console.log('Executing second move against:', secondDefender.name, 'HP:', secondDefender.currentHP);
                            secondMoveResult = applyMoveToStateEnhanced(secondAttacker, secondDefender, secondAction, gen, newState);

                            secondKO = secondDefender.currentHP <= 0;
                            var secondAttackerFainted = secondAttacker.currentHP <= 0;

                            console.log('Second move result - defender KO:', secondKO, 'attacker KO:', secondAttackerFainted);

                            syncActiveToTeam(newState);

                            if (secondAttacker.needsSwitchAfterMove && !secondAttackerFainted) {
                                pendingSwitchAfterMove[secondMover] = true;
                                delete secondAttacker.needsSwitchAfterMove;
                            }

                            if (secondDefender.needsForcedSwitch && !secondKO) {
                                pendingForcedSwitch[firstMover] = true;
                                delete secondDefender.needsForcedSwitch;
                            }
                        }
                    } else if (secondFlinched) {
                        console.log(secondAttacker.name + ' flinched and could not move!');
                    }
                } catch (e) {
                    console.error('Error in executeSecondAction:', e);
                } finally {
                    onSecondActionComplete();
                }
            };

            // Define the continuation function that handles everything after actions
            // This MUST be defined before the async callback below that references it
            var continueTurnAfterActions = function () {
                // Apply end-of-turn effects
                var endOfTurnEffects = applyEndOfTurnEffects(newState, gen);

                // Check for KOs after end-of-turn
                var p1FaintedAfterEOT = newState.p1.active.currentHP <= 0;
                var p2FaintedAfterEOT = newState.p2.active.currentHP <= 0;

                // Collect switch requirements
                var p1NeedsSwitch = pendingSwitchAfterMove.p1 && newState.p1.active.currentHP > 0;
                var p2NeedsSwitch = pendingSwitchAfterMove.p2 && newState.p2.active.currentHP > 0;
                var p1ForcedSwitch = pendingForcedSwitch.p1 && newState.p1.active.currentHP > 0;
                var p2ForcedSwitch = pendingForcedSwitch.p2 && newState.p2.active.currentHP > 0;

                // Increment turn number
                newState.turnNumber++;

                // Sync active Pokemon HP back to team arrays
                syncActiveToTeam(newState);

                // Create action description
                var p1Name = state.p1.active.name;
                var p2Name = state.p2.active.name;

                function getActionDesc(actionObj, name, moveRes) {
                    if (!actionObj) return name + ': nothing';
                    if (actionObj.type === 'switch') {
                        return name + ' → ' + actionObj.targetName;
                    }
                    var desc = name + ': ' + actionObj.moveName;
                    if (moveRes && moveRes.failed) desc += ' (FAILED)';
                    return desc;
                }

                var p1MoveRes = firstMover === 'p1' ? firstMoveResult : secondMoveResult;
                var p2MoveRes = firstMover === 'p2' ? firstMoveResult : secondMoveResult;
                var p1Desc = getActionDesc(uiState.p1Action, p1Name, p1MoveRes);
                var p2Desc = getActionDesc(uiState.p2Action, p2Name, p2MoveRes);
                var actionDesc = firstMover === 'p1' ? p1Desc + ', ' + p2Desc : p2Desc + ', ' + p1Desc;

                if (endOfTurnEffects.length > 0) {
                    actionDesc += ' | EOT: ' + endOfTurnEffects.join(', ');
                }

                // Create BattleAction objects
                function createBattleAction(actionObj) {
                    if (actionObj.type === 'switch') {
                        return new BattlePlanner.BattleAction('switch', {
                            targetSlot: actionObj.targetSlot,
                            targetName: actionObj.targetName
                        });
                    } else {
                        return new BattlePlanner.BattleAction('move', {
                            moveIndex: actionObj.index,
                            moveName: actionObj.moveName,
                            isCrit: actionObj.isCrit,
                            hits: actionObj.hits,
                            applyEffect: actionObj.applyEffect
                        });
                    }
                }

                var actionRecord = {
                    p1: createBattleAction(uiState.p1Action),
                    p2: createBattleAction(uiState.p2Action)
                };

                // Track KO'd Pokemon names for better display
                var p1KOName = null, p2KOName = null;
                var hadKO = { p1: false, p2: false };
                if (newState.p1.active.currentHP <= 0) { p1KOName = newState.p1.active.name; hadKO.p1 = true; }
                if (newState.p2.active.currentHP <= 0) { p2KOName = newState.p2.active.name; hadKO.p2 = true; }

                var outcome = new BattlePlanner.BattleOutcome(actionDesc, 1.0, 0, {
                    firstMover: firstMover,
                    firstKO: firstKO,
                    secondKO: secondKO,
                    endOfTurnEffects: endOfTurnEffects,
                    flinchResult: flinchResult,
                    p1KOName: p1KOName,
                    p2KOName: p2KOName,
                    hadKO: (hadKO.p1 || hadKO.p2) ? hadKO : undefined
                });

                // Variance detection: check if min/max rolls produce different outcomes
                var varianceWarnings = [];
                if (firstMoveResult && firstMoveResult.range && firstMoveResult.range.min !== firstMoveResult.range.max) {
                    var firstDef = newState[secondMover].active;
                    var v1 = BattlePlannerLogic.detectMeaningfulVariance(
                        { currentHP: state[secondMover].active.currentHP, maxHP: firstDef.maxHP, item: state[secondMover].active.item },
                        firstMoveResult.range.min, firstMoveResult.range.max,
                        firstMoveResult.range.rolls
                    );
                    if (v1) varianceWarnings.push({ move: firstAction.moveName, mover: firstMover, detail: v1 });
                }
                if (secondMoveResult && secondMoveResult.range && secondMoveResult.range.min !== secondMoveResult.range.max) {
                    var secondDef = newState[firstMover].active;
                    var v2 = BattlePlannerLogic.detectMeaningfulVariance(
                        { currentHP: state[firstMover].active.currentHP, maxHP: secondDef.maxHP, item: state[firstMover].active.item },
                        secondMoveResult.range.min, secondMoveResult.range.max,
                        secondMoveResult.range.rolls
                    );
                    if (v2) varianceWarnings.push({ move: secondAction.moveName, mover: secondMover, detail: v2 });
                }

                // Crit variance: check if a critical hit would change outcomes
                function checkCritVariance(moveName, attackerSnap, defenderSnap, side) {
                    if (!moveName || moveName === '(No Move)') return;
                    try {
                        var critPreview = getMovePreviewInfo(side, attackerSnap, moveName, defenderSnap, true);
                        var normPreview = getMovePreviewInfo(side, attackerSnap, moveName, defenderSnap, false);
                        if (!critPreview || !normPreview) return;
                        var normKills = normPreview.rawMax >= defenderSnap.currentHP;
                        var critKills = critPreview.rawMin >= defenderSnap.currentHP;
                        if (!normKills && critKills) {
                            varianceWarnings.push({
                                move: moveName + ' (crit)',
                                mover: side,
                                detail: {
                                    reason: 'Critical hit would KO (crit min ' + critPreview.rawMin + ' vs HP ' + defenderSnap.currentHP + ')',
                                    isCrit: true,
                                    critMin: critPreview.rawMin,
                                    critMax: critPreview.rawMax,
                                    normalMin: normPreview.rawMin,
                                    normalMax: normPreview.rawMax,
                                    defenderHP: defenderSnap.currentHP,
                                    defenderMaxHP: defenderSnap.maxHP
                                }
                            });
                        }
                    } catch (e) { /* ignore calc errors */ }
                }
                if (!firstIsSwitch) {
                    checkCritVariance(firstAction.moveName, state[firstMover].active, state[secondMover].active, firstMover);
                }
                if (!secondIsSwitch) {
                    checkCritVariance(secondAction.moveName, state[secondMover].active, state[firstMover].active, secondMover);
                }

                // Secondary effect variance: moves with <100% chance effects
                // Skip if the move guarantees a KO (secondary effects irrelevant on dead target)
                function addSecondaryVariance(moveRes, moveName, mover) {
                    if (!moveRes || !moveRes.secondaryEffects) return;
                    // If min roll KOs the target, secondary effects don't matter
                    if (moveRes.range && moveRes.range.min > 0) {
                        var defSide = mover === 'p1' ? 'p2' : 'p1';
                        var defHP = state[defSide].active ? state[defSide].active.currentHP : 0;
                        if (defHP > 0 && moveRes.range.min >= defHP) return;
                    }
                    moveRes.secondaryEffects.forEach(function (sec) {
                        var desc = sec.chance + '% chance';
                        if (sec.status) desc += ' ' + sec.status;
                        if (sec.boosts) desc += ' stat change';
                        if (sec.volatileStatus) desc += ' ' + sec.volatileStatus;
                        varianceWarnings.push({
                            move: moveName,
                            mover: mover,
                            detail: {
                                reason: desc,
                                isSecondary: true,
                                secondaryEffect: sec
                            }
                        });
                    });
                }
                addSecondaryVariance(firstMoveResult, firstAction.moveName, firstMover);
                addSecondaryVariance(secondMoveResult, secondAction.moveName, secondMover);

                // Check accumulated variance
                var p1Range = (firstMover === 'p1' && firstMoveResult && firstMoveResult.range) ? firstMoveResult.range :
                              (secondMover === 'p1' && secondMoveResult && secondMoveResult.range) ? secondMoveResult.range : null;
                var p2Range = (firstMover === 'p2' && firstMoveResult && firstMoveResult.range) ? firstMoveResult.range :
                              (secondMover === 'p2' && secondMoveResult && secondMoveResult.range) ? secondMoveResult.range : null;
                var accumVar = BattlePlannerLogic.checkAccumulatedVariance(newState, p1Range, p2Range);
                if (accumVar) {
                    varianceWarnings.push({ move: 'accumulated', mover: accumVar.side, detail: { reason: accumVar.reason } });
                }

                // Store variance info on the outcome for the timeline display
                if (varianceWarnings.length > 0) {
                    outcome.varianceWarnings = varianceWarnings;
                }

                // Add flinch info to action description and variance
                if (flinchResult && flinchResult.flinches) {
                    if (flinchResult.isGuaranteed) {
                        actionDesc += ' | ' + newState[secondMover].active.name + ' flinched!';
                        outcome.description = actionDesc;
                    } else {
                        varianceWarnings.push({
                            move: firstAction.moveName,
                            mover: firstMover,
                            detail: {
                                reason: flinchResult.reason + ' on ' + newState[secondMover].active.name,
                                isFlinch: true,
                                flinchChance: flinchResult.chance
                            }
                        });
                    }
                }

                // Check if we need KO replacements
                var needsP1Replacement = p1FaintedAfterEOT || (firstMover === 'p2' && firstKO) || (firstMover === 'p1' && secondKO);
                var needsP2Replacement = p2FaintedAfterEOT || (firstMover === 'p1' && firstKO) || (firstMover === 'p2' && secondKO);
                console.log('Replacement needs - P1:', needsP1Replacement, 'P2:', needsP2Replacement, 'firstKO:', firstKO, 'secondKO:', secondKO);

                // Check for switch-after-move effects (U-turn, etc.) - only if not fainted
                if (!needsP1Replacement && p1NeedsSwitch) {
                    needsP1Replacement = true; // Will prompt for switch
                }
                if (!needsP2Replacement && p2NeedsSwitch) {
                    needsP2Replacement = true; // Will prompt for switch  
                }

                // Check for forced switches (Roar, Whirlwind) - opponent forced to switch
                if (!needsP1Replacement && p1ForcedSwitch) {
                    needsP1Replacement = true; // Will prompt for forced switch
                }
                if (!needsP2Replacement && p2ForcedSwitch) {
                    needsP2Replacement = true; // Will prompt for forced switch
                }

                // Function to complete the turn after replacements
                var completeTurn = function (p1Replacement, p2Replacement) {
                    if (p1Replacement !== null && p1Replacement !== undefined) {
                        if (BattlePlannerLogic) {
                            BattlePlannerLogic.performSwitch(newState, 'p1', p1Replacement);
                        } else {
                            newState.p1.teamSlot = p1Replacement;
                            newState.p1.active = newState.p1.team[p1Replacement].clone();
                        }
                    }
                    if (p2Replacement !== null && p2Replacement !== undefined) {
                        if (BattlePlannerLogic) {
                            BattlePlannerLogic.performSwitch(newState, 'p2', p2Replacement);
                        } else {
                            newState.p2.teamSlot = p2Replacement;
                            newState.p2.active = newState.p2.team[p2Replacement].clone();
                        }
                    }

                    console.log('Completing turn. P1 Slot:', newState.p1.teamSlot, 'P1 Active HP:', newState.p1.active.currentHP);
                    var newNode = uiState.tree.addBranch(currentNode.id, newState, actionRecord, outcome);
                    console.log('New node added:', newNode.id);
                    uiState.tree.navigate(newNode.id);

                    // Reset selections for next turn
                    uiState.p1Action = null;
                    uiState.p2Action = null;
                    $('#p1-selected-move').text('Select a move').removeClass('selected');
                    $('#p2-selected-move').text('Select a move').removeClass('selected');
                    $('#p1-move-list .move-row, #p2-move-list .move-row').removeClass('selected');
                    updateExecuteTurnButton();

                    renderTree();
                    renderStage();

                    // Show variance warnings if any (skip popup during AI tie branching)
                    if (varianceWarnings.length > 0 && !isExecutingAITieBranches) {
                        showVarianceNotification(varianceWarnings, currentNode.id, newNode.id);
                    }

                    isExecutingTurn = false;
                };

                // AI prediction helper for P2 replacement
                var handleP2Replacement = function (onDone) {
                    if (p2ForcedSwitch) {
                        showKOReplacementModal('p2', newState, onDone, "Opponent Forced to Switch!");
                        return;
                    }
                    var prediction = tryPredictP2SwitchIn(newState);
                    if (prediction) {
                        showAIPredictBanner(prediction, newState, onDone);
                    } else {
                        showKOReplacementModal('p2', newState, onDone);
                    }
                };

                // During AI tie branching, defer all switch-ins as pendingKO
                if (isExecutingAITieBranches && (needsP1Replacement || needsP2Replacement)) {
                    completeTurn(null, null);
                    var lastNode = uiState.tree.getNode(uiState.tree.currentNodeId);
                    if (lastNode) {
                        var ko = {};
                        if (needsP1Replacement && newState.p1.active.currentHP <= 0) ko.p1 = true;
                        if (needsP2Replacement && newState.p2.active.currentHP <= 0) ko.p2 = true;
                        if (ko.p1 || ko.p2) {
                            lastNode.pendingKO = ko;
                            if (!lastNode.outcome.effects) lastNode.outcome.effects = {};
                            lastNode.outcome.effects.hadKO = ko;
                            if (ko.p1) lastNode.outcome.effects.p1KOName = newState.p1.active.name;
                            if (ko.p2) lastNode.outcome.effects.p2KOName = newState.p2.active.name;
                        }
                    }
                }
                // Normal flow: show modal for switch-ins
                else if (needsP1Replacement && needsP2Replacement) {
                    var p1Title = p1ForcedSwitch ? "Your Pokemon Forced to Switch!" : null;
                    showKOReplacementModal('p1', newState, function (p1Rep) {
                        handleP2Replacement(function (p2Rep) {
                            completeTurn(p1Rep, p2Rep);
                        });
                    }, p1Title);
                } else if (needsP1Replacement) {
                    var p1Title = p1ForcedSwitch ? "Your Pokemon Forced to Switch!" : null;
                    showKOReplacementModal('p1', newState, function (p1Rep) {
                        completeTurn(p1Rep, null);
                    }, p1Title);
                } else if (needsP2Replacement) {
                    handleP2Replacement(function (p2Rep) {
                        completeTurn(null, p2Rep);
                    });
                } else {
                    completeTurn(null, null);
                }
            };

            // Check if first mover needs to switch after their move (U-turn, Volt Switch)
            // This switch happens IMMEDIATELY, before the second mover attacks
            var firstMoverNeedsSwitchNow = pendingSwitchAfterMove[firstMover] && !firstKO && newState[firstMover].active.currentHP > 0;

            if (firstMoverNeedsSwitchNow && !isExecutingAITieBranches) {
                var switchTitle = "Select Pokemon to switch to (U-turn/Volt Switch):";
                showKOReplacementModal(firstMover, newState, function (switchChoice) {
                    if (switchChoice !== null && switchChoice !== undefined) {
                        performSwitch(firstMover, { targetSlot: switchChoice }, newState);
                    }
                    pendingSwitchAfterMove[firstMover] = false;
                    executeSecondAction(function () {
                        continueTurnAfterActions();
                    });
                }, switchTitle);
                return;
            } else {
                // No immediate switch needed, execute second action synchronously
                executeSecondAction(function () { });
                // Continue with the rest of the turn
                continueTurnAfterActions();
            }

        } catch (e) {
            console.error('Failed to execute turn:', e);
            alert('Failed to execute turn: ' + e.message);
        } finally {
            // Only clear execution flag if we are NOT waiting for a modal callback
            // In U-turn/KO cases, we finish in the callback
            if (!$('#ko-replacement-modal').is(':visible')) {
                isExecutingTurn = false;
            }
        }
    }

    /**
     * Sync active Pokemon state back to team arrays
     */
    function syncActiveToTeam(state) {
        // Sync P1 active to team
        if (state.p1.active && state.p1.team && state.p1.teamSlot !== undefined) {
            var p1Slot = state.p1.teamSlot;
            if (state.p1.team[p1Slot]) {
                state.p1.team[p1Slot].currentHP = state.p1.active.currentHP;
                state.p1.team[p1Slot].status = state.p1.active.status;
                state.p1.team[p1Slot].boosts = state.p1.active.boosts ? Object.assign({}, state.p1.active.boosts) : {};
                // Update percentHP
                if (state.p1.team[p1Slot].maxHP > 0) {
                    state.p1.team[p1Slot].percentHP = Math.round((state.p1.team[p1Slot].currentHP / state.p1.team[p1Slot].maxHP) * 100);
                }
            }
            // Also update active's percentHP
            if (state.p1.active.maxHP > 0) {
                state.p1.active.percentHP = Math.round((state.p1.active.currentHP / state.p1.active.maxHP) * 100);
            }
        }

        // Sync P2 active to team
        if (state.p2.active && state.p2.team && state.p2.teamSlot !== undefined) {
            var p2Slot = state.p2.teamSlot;
            if (state.p2.team[p2Slot]) {
                state.p2.team[p2Slot].currentHP = state.p2.active.currentHP;
                state.p2.team[p2Slot].status = state.p2.active.status;
                state.p2.team[p2Slot].boosts = state.p2.active.boosts ? Object.assign({}, state.p2.active.boosts) : {};
                // Update percentHP
                if (state.p2.team[p2Slot].maxHP > 0) {
                    state.p2.team[p2Slot].percentHP = Math.round((state.p2.team[p2Slot].currentHP / state.p2.team[p2Slot].maxHP) * 100);
                }
            }
            // Also update active's percentHP
            if (state.p2.active.maxHP > 0) {
                state.p2.active.percentHP = Math.round((state.p2.active.currentHP / state.p2.active.maxHP) * 100);
            }
        }
    }

    /**
     * Enhanced move application that uses action options (crit, hits, effects)
     */
    // Moves that fail entirely unless it's the user's first turn on the field
    var FIRST_TURN_ONLY_MOVES = { 'fakeout': true, 'firstimpression': true };

    function applyMoveToStateEnhanced(attacker, defender, action, gen, state) {
        var moveName = action.moveName;
        var isCrit = action.isCrit || false;
        var hits = action.hits || 3;
        var applyEffect = action.applyEffect || false;
        var customEffects = action.customEffects || {};
        var moveResult = { range: null, moveData: null };

        // Check first-turn-only moves (Fake Out, First Impression)
        var moveId = (moveName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (FIRST_TURN_ONLY_MOVES[moveId] && attacker.turnsOnField !== undefined && attacker.turnsOnField > 0) {
            moveResult.failed = true;
            moveResult.failReason = moveName + ' fails after the first turn';
            moveResult.range = { min: 0, max: 0, avg: 0, rolls: [] };
            return moveResult;
        }

        try {
            var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, gen);
            var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, gen);

            if (!attackerPokemon || !defenderPokemon) return moveResult;

            var moveOptions = { isCrit: isCrit };
            var moveData = getMoveData(moveName, gen);

            // Handle multi-hit moves: use fixed count or action override
            if (moveData && moveData.multihit) {
                if (Array.isArray(moveData.multihit)) {
                    // Variable hits (e.g. [2,5]) - use action.hits if specified, else max
                    moveOptions.hits = (action.hits && action.hits > 0) ? action.hits : moveData.multihit[1];
                } else {
                    // Fixed hits (e.g. 2 for Double Kick)
                    moveOptions.hits = moveData.multihit;
                }
                moveResult.totalHits = moveOptions.hits;
            }

            var move = new window.calc.Move(gen, moveName, moveOptions);
            var field = window.createField ? window.createField() : null;
            var result = window.calc.calculate(gen, attackerPokemon, defenderPokemon, move, field);

            var range = CalcIntegration.getDamageRange(result);
            moveResult.range = range;
            moveResult.moveData = moveData;
            var avgDamage = range.avg;

            // Check if custom effects override damage
            if (customEffects.noDamage) {
                avgDamage = 0;
                moveResult.range = { min: 0, max: 0, avg: 0, rolls: [] };
            }

            // Check if defender is invulnerable (from their own move like Bounce/Fly)
            if (defender.isInvulnerable) {
                avgDamage = 0;
            }

            // Apply item effects that trigger on damage (Focus Sash, berries)
            var itemFx = CalcIntegration.applyItemEffects(defender, avgDamage);

            // Apply damage
            defender.currentHP = Math.max(0, defender.currentHP - avgDamage);

            // Apply item healing (Focus Sash survival, berry triggers)
            if (itemFx.healed > 0) {
                defender.currentHP = Math.min(defender.maxHP, defender.currentHP + itemFx.healed);
            }
            if (itemFx.itemConsumed) {
                defender.item = '';
            }

            // Set invulnerable state for 2-turn moves
            if (customEffects.invulnerable || customEffects.charging) {
                attacker.isInvulnerable = true;
            } else {
                attacker.isInvulnerable = false;
            }

            // Always apply guaranteed move effects (status, stat changes)
            // Use RBDex data which has complete effect information
            var rbdexMoveData = window.RBDex ? window.RBDex.getMove(moveName) : null;
            var effectSource = rbdexMoveData || moveData;
            if (effectSource && avgDamage >= 0) {
                applyGuaranteedMoveEffects(attacker, defender, effectSource, state, moveResult);
            }

            // Use MoveDB for recoil/drain/heal when available
            var dbFx = window.MoveDB ? window.MoveDB.getEffects(moveName) : null;

            // Handle recoil
            if (dbFx && dbFx.recoil) {
                var recoilDamage = Math.floor(avgDamage * dbFx.recoil.numerator / dbFx.recoil.denominator);
                attacker.currentHP = Math.max(0, attacker.currentHP - recoilDamage);
            } else if (moveData && moveData.recoil) {
                var recoilDamage = Math.floor(avgDamage * moveData.recoil[0] / moveData.recoil[1]);
                attacker.currentHP = Math.max(0, attacker.currentHP - recoilDamage);
            }

            // Handle drain
            if (dbFx && dbFx.drain) {
                var drainHeal = Math.floor(avgDamage * dbFx.drain.numerator / dbFx.drain.denominator);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + drainHeal);
            } else if (moveData && moveData.drain) {
                var drainHeal = Math.floor(avgDamage * moveData.drain[0] / moveData.drain[1]);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + drainHeal);
            }

            // Handle healing moves (like Recover, Soft-Boiled, Roost, Synthesis, etc.)
            if (dbFx && dbFx.heal) {
                var healAmount = Math.floor(attacker.maxHP * dbFx.heal.numerator / dbFx.heal.denominator);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + healAmount);
            } else if (moveData && moveData.heal) {
                var healAmount = Math.floor(attacker.maxHP * moveData.heal[0] / moveData.heal[1]);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + healAmount);
            }

            // Special case for moves like Rest
            if (moveName.toLowerCase() === 'rest') {
                attacker.currentHP = attacker.maxHP;
                attacker.status = 'slp';
            }

            // Special case for Wish
            if (moveName.toLowerCase() === 'wish' && applyEffect) {
                var wishHeal = Math.floor(attacker.maxHP / 2);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + wishHeal);
            }

            // Edge case moves: item interaction
            applyMoveItemEffects(attacker, defender, moveId, avgDamage);

            // Apply custom effects from the move effects modal
            // Pokemon can only have one status condition - don't overwrite existing status
            if (customEffects.targetStatus && customEffects.targetStatus !== 'none' && (!defender.status || defender.status === 'Healthy')) {
                defender.status = customEffects.targetStatus;
            }

            // Apply custom target stat changes
            if (customEffects.targetBoosts) {
                if (!defender.boosts) defender.boosts = {};
                ['atk', 'def', 'spa', 'spd', 'spe'].forEach(function (stat) {
                    if (customEffects.targetBoosts[stat]) {
                        defender.boosts[stat] = (defender.boosts[stat] || 0) + customEffects.targetBoosts[stat];
                        defender.boosts[stat] = Math.max(-6, Math.min(6, defender.boosts[stat]));
                    }
                });
            }

            // Apply custom self stat changes
            if (customEffects.selfBoosts) {
                if (!attacker.boosts) attacker.boosts = {};
                ['atk', 'def', 'spa', 'spd', 'spe'].forEach(function (stat) {
                    if (customEffects.selfBoosts[stat]) {
                        attacker.boosts[stat] = (attacker.boosts[stat] || 0) + customEffects.selfBoosts[stat];
                        attacker.boosts[stat] = Math.max(-6, Math.min(6, attacker.boosts[stat]));
                    }
                });
            }

            // Apply self damage (recoil/crash damage from effects)
            if (customEffects.selfDamage && customEffects.selfDamage > 0) {
                attacker.currentHP = Math.max(0, attacker.currentHP - customEffects.selfDamage);
            }

            // Mark for switch after move (U-turn, Volt Switch, etc)
            if (customEffects.switchSelf) {
                attacker.needsSwitchAfterMove = true;
            }

            // Mark target for forced switch (Roar, Whirlwind, etc)
            if (customEffects.switchTarget) {
                defender.needsForcedSwitch = true;
            }

        } catch (e) {
            console.error('Error applying move:', e);
        }

        return moveResult;
    }

    /**
     * Handle edge-case move effects: item stealing, removal, swapping.
     * Bug Bite/Pluck steal + eat Berry, Knock Off removes item,
     * Thief/Covet steal item, Trick/Switcheroo swap items, Incinerate destroys Berry.
     */
    function applyMoveItemEffects(attacker, defender, moveId, damage) {
        if (!moveId || damage <= 0 || defender.currentHP < 0) return;
        var defItem = defender.item || '';
        var atkItem = attacker.item || '';
        var isBerry = defItem && /berry/i.test(defItem);

        var BERRY_STEAL_MOVES = { bugbite: 1, pluck: 1 };
        var ITEM_REMOVE_MOVES = { knockoff: 1 };
        var ITEM_STEAL_MOVES = { thief: 1, covet: 1 };
        var ITEM_SWAP_MOVES = { trick: 1, switcheroo: 1 };
        var BERRY_DESTROY_MOVES = { incinerate: 1 };

        if (BERRY_STEAL_MOVES[moveId] && isBerry) {
            var stolenBerry = defItem;
            defender.item = '';
            applyBerryEffect(attacker, stolenBerry);
        } else if (ITEM_REMOVE_MOVES[moveId] && defItem) {
            defender.item = '';
        } else if (ITEM_STEAL_MOVES[moveId] && defItem && !atkItem) {
            attacker.item = defItem;
            defender.item = '';
        } else if (ITEM_SWAP_MOVES[moveId]) {
            attacker.item = defItem;
            defender.item = atkItem;
        } else if (BERRY_DESTROY_MOVES[moveId] && isBerry) {
            defender.item = '';
        }
    }

    /**
     * Simulate eating a berry: apply its healing/stat effects to the Pokemon.
     */
    function applyBerryEffect(pokemon, berryName) {
        if (!pokemon || !berryName) return;
        var id = berryName.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Healing berries
        if (id === 'oranberry') {
            pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + 10);
        } else if (id === 'sitrusberry') {
            pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + Math.floor(pokemon.maxHP / 4));
        }
        // Status-curing berries
        else if (id === 'lumberry') {
            if (pokemon.status && pokemon.status !== 'Healthy') pokemon.status = 'Healthy';
        } else if (id === 'chestoberry') {
            if (pokemon.status === 'Asleep' || pokemon.status === 'slp') pokemon.status = 'Healthy';
        } else if (id === 'pechaberry') {
            if (pokemon.status === 'Poisoned' || pokemon.status === 'Badly Poisoned' || pokemon.status === 'psn' || pokemon.status === 'tox') pokemon.status = 'Healthy';
        } else if (id === 'rawstberry') {
            if (pokemon.status === 'Burned' || pokemon.status === 'brn') pokemon.status = 'Healthy';
        } else if (id === 'aspearberry') {
            if (pokemon.status === 'Frozen' || pokemon.status === 'frz') pokemon.status = 'Healthy';
        } else if (id === 'cheriberry') {
            if (pokemon.status === 'Paralyzed' || pokemon.status === 'par') pokemon.status = 'Healthy';
        }
        // Stat-boosting pinch berries (activate when eaten via Bug Bite regardless of HP)
        else if (id === 'liechiberry') { applyBoosts(pokemon, { atk: 1 }); }
        else if (id === 'ganlonberry') { applyBoosts(pokemon, { def: 1 }); }
        else if (id === 'petayaberry') { applyBoosts(pokemon, { spa: 1 }); }
        else if (id === 'apicotberry') { applyBoosts(pokemon, { spd: 1 }); }
        else if (id === 'salacberry') { applyBoosts(pokemon, { spe: 1 }); }
        else if (id === 'lansatberry') { /* crit rate +1 - not tracked */ }
        else if (id === 'starfberry') { /* random +2 - simplified */ }
    }

    /**
     * Apply move effects (status, stat changes, etc.)
     */
    function applyBoosts(pokemon, boostMap) {
        if (!boostMap || typeof boostMap !== 'object') return;
        if (!pokemon.boosts) pokemon.boosts = {};
        Object.keys(boostMap).forEach(function (stat) {
            if (boostMap[stat]) {
                pokemon.boosts[stat] = (pokemon.boosts[stat] || 0) + boostMap[stat];
                pokemon.boosts[stat] = Math.max(-6, Math.min(6, pokemon.boosts[stat]));
            }
        });
    }

    var STATUS_CODE_TO_NAME = {
        'par': 'Paralyzed', 'brn': 'Burned', 'psn': 'Poisoned',
        'tox': 'Badly Poisoned', 'slp': 'Asleep', 'frz': 'Frozen'
    };
    function normalizeStatus(code) {
        return STATUS_CODE_TO_NAME[code] || code;
    }

    /**
     * Apply guaranteed move effects (100% chance) automatically.
     * Secondary effects with < 100% chance are recorded for branch creation.
     */
    function applyGuaranteedMoveEffects(attacker, defender, moveData, state, moveResult) {
        if (!moveData) return;

        var selfTargets = { self: 1, allySide: 1, allyTeam: 1, allies: 1, adjacentAllyOrSelf: 1, adjacentAlly: 1 };
        var isSelfTarget = !!(selfTargets[moveData.target]);
        // Also treat non-damaging moves that only have boosts as self-targeting
        // (e.g., status moves with boosts but target="normal" are typically self-targeting if category is Status)
        if (!isSelfTarget && moveData.category === 'Status' && moveData.boosts && !moveData.status && moveData.target === 'normal') {
            // Check if the boosts are positive (self-buff) vs negative (debuff on opponent)
            var hasPositiveBoost = Object.keys(moveData.boosts).some(function(k) { return moveData.boosts[k] > 0; });
            var hasNegativeBoost = Object.keys(moveData.boosts).some(function(k) { return moveData.boosts[k] < 0; });
            if (hasPositiveBoost && !hasNegativeBoost) {
                isSelfTarget = true;
            }
        }

        if (moveData.status && !isSelfTarget && (!defender.status || defender.status === 'Healthy')) {
            defender.status = normalizeStatus(moveData.status);
        }

        // Guaranteed boosts: self-targeting moves boost the attacker, others boost the defender
        if (moveData.boosts) {
            if (isSelfTarget) {
                applyBoosts(attacker, moveData.boosts);
            } else {
                applyBoosts(defender, moveData.boosts);
            }
        }

        // Self boosts (e.g. Close Combat → -1 def, -1 spd on user)
        if (moveData.self && moveData.self.boosts) {
            applyBoosts(attacker, moveData.self.boosts);
        }

        // Secondary effects: only apply guaranteed ones (chance === 100)
        // Record non-guaranteed secondaries for potential branching
        var secondaries = [];
        if (moveData.secondary) secondaries.push(moveData.secondary);
        if (moveData.secondaries) secondaries = secondaries.concat(moveData.secondaries);

        if (!moveResult.secondaryEffects) moveResult.secondaryEffects = [];

        secondaries.forEach(function (sec) {
            if (!sec) return;
            var chance = sec.chance || 100;
            if (chance >= 100) {
                if (sec.status && (!defender.status || defender.status === 'Healthy')) {
                    defender.status = normalizeStatus(sec.status);
                }
                if (sec.boosts) applyBoosts(defender, sec.boosts);
                if (sec.self && sec.self.boosts) applyBoosts(attacker, sec.self.boosts);
            } else {
                // Non-guaranteed → record for branch UI
                moveResult.secondaryEffects.push({
                    chance: chance,
                    status: sec.status || null,
                    boosts: sec.boosts || null,
                    selfBoosts: (sec.self && sec.self.boosts) ? sec.self.boosts : null,
                    volatileStatus: sec.volatileStatus || null
                });
            }
        });
    }

    /**
     * Apply a move to the battle state
     */
    function applyMoveToState(attacker, defender, moveName, gen, state) {
        try {
            var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, gen);
            var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, gen);

            if (!attackerPokemon || !defenderPokemon) return null;

            var move = new window.calc.Move(gen, moveName);
            var field = window.createField ? window.createField() : null;
            var result = window.calc.calculate(gen, attackerPokemon, defenderPokemon, move, field);

            var range = CalcIntegration.getDamageRange(result);
            var avgDamage = range.avg;

            // Apply damage
            defender.currentHP = Math.max(0, defender.currentHP - avgDamage);

            // Recalculate percent
            defender.percentHP = defender.maxHP > 0 ? Math.round((defender.currentHP / defender.maxHP) * 100) : 0;
            defender.hasFainted = defender.currentHP <= 0;

            // Apply recoil/drain via MoveDB, falling back to calc data
            var dbFx = window.MoveDB ? window.MoveDB.getEffects(moveName) : null;
            if (dbFx && dbFx.recoil) {
                var recoilDamage = Math.floor(avgDamage * (dbFx.recoil.numerator / dbFx.recoil.denominator));
                attacker.currentHP = Math.max(0, attacker.currentHP - recoilDamage);
                attacker.percentHP = attacker.maxHP > 0 ? Math.round((attacker.currentHP / attacker.maxHP) * 100) : 0;
                attacker.hasFainted = attacker.currentHP <= 0;
            } else {
                var moveData = null;
                try {
                    var genObj = window.calc.Generations.get(gen);
                    if (genObj && genObj.moves) {
                        moveData = genObj.moves.get(window.calc.toID(moveName));
                    }
                } catch (e) { }
                if (moveData && moveData.recoil) {
                    var recoilDamage = Math.floor(avgDamage * (moveData.recoil[0] / moveData.recoil[1]));
                    attacker.currentHP = Math.max(0, attacker.currentHP - recoilDamage);
                    attacker.percentHP = attacker.maxHP > 0 ? Math.round((attacker.currentHP / attacker.maxHP) * 100) : 0;
                    attacker.hasFainted = attacker.currentHP <= 0;
                }
            }
            if (dbFx && dbFx.drain) {
                var drainHeal = Math.floor(avgDamage * (dbFx.drain.numerator / dbFx.drain.denominator));
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + drainHeal);
                attacker.percentHP = attacker.maxHP > 0 ? Math.round((attacker.currentHP / attacker.maxHP) * 100) : 0;
            }

            return result;
        } catch (e) {
            console.error('Failed to apply move:', e);
            return null;
        }
    }

    /**
     * Create branch from outcome
     */
    function createBranchFromOutcome(outcomeIndex) {
        var outcomes = uiState.currentOutcomes;
        var moveContext = uiState.selectedMove;

        if (!outcomes || !outcomes[outcomeIndex] || !moveContext) return;

        var outcome = outcomes[outcomeIndex];
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var newState = CalcIntegration.applyOutcomeToState(
            currentNode.state,
            outcome,
            moveContext.side,
            null
        );

        var action = {};
        action[moveContext.side] = new BattlePlanner.BattleAction('move', {
            moveName: moveContext.moveName,
            moveIndex: moveContext.moveIndex
        });

        var battleOutcome = new BattlePlanner.BattleOutcome(
            outcome.label,
            outcome.probability,
            outcome.damage,
            outcome.effects
        );

        var newNode = uiState.tree.addBranch(currentNode.id, newState, action, battleOutcome);

        if (newNode) {
            uiState.tree.navigate(newNode.id);
        }
    }

    /**
     * Open team selector
     */
    function openTeamSelector(side) {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var team = side === 'p1' ? currentNode.state.p1.team : currentNode.state.p2.team;
        if (!team || team.length === 0) {
            alert('No team available. Load a team first.');
            return;
        }

        $('#team-select-title').text('Switch ' + (side === 'p1' ? 'Your' : "Opponent's") + ' Pokemon');

        var html = team.map(function (poke, i) {
            var isActive = (side === 'p1' ? currentNode.state.p1.teamSlot : currentNode.state.p2.teamSlot) === i;
            var classes = ['team-select-item'];
            if (isActive) classes.push('team-select-active');
            if (poke.hasFainted) classes.push('team-select-fainted');

            // Use same sprite source as main app
            var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + poke.name + '.png';
            var fallbackUrl = 'https://play.pokemonshowdown.com/sprites/gen5/' + poke.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '') + '.png';

            return '<div class="' + classes.join(' ') + '" data-side="' + side + '" data-index="' + i + '">' +
                '<img class="team-select-sprite" src="' + spriteUrl + '" alt="' + poke.name + '" onerror="this.src=\'' + fallbackUrl + '\'">' +
                '<div class="team-select-info">' +
                '<div class="team-select-name">' + poke.name + '</div>' +
                '<div class="team-select-hp">' + poke.currentHP + '/' + poke.maxHP + ' HP</div>' +
                '</div>' +
                '</div>';
        }).join('');

        $('#team-select-grid').html(html);
        $('#team-select-modal').show();

        $('.team-select-item').off('click').on('click', function () {
            var clickedSide = $(this).data('side');
            var index = $(this).data('index');
            switchToTeamMember(clickedSide, index);
            $('#team-select-modal').hide();
        });
    }

    /**
     * Switch to team member
     */
    function switchToTeamMember(side, index) {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var team = side === 'p1' ? currentNode.state.p1.team : currentNode.state.p2.team;
        if (!team || !team[index]) return;

        var newState = currentNode.state.clone();
        newState.turnNumber++;

        if (BattlePlannerLogic) {
            BattlePlannerLogic.performSwitch(newState, side, index);
        } else if (side === 'p1') {
            newState.p1.active = team[index].clone();
            newState.p1.teamSlot = index;
        } else {
            newState.p2.active = team[index].clone();
            newState.p2.teamSlot = index;
        }

        var action = {};
        action[side] = new BattlePlanner.BattleAction('switch', {
            switchTo: team[index].name,
            switchToIndex: index
        });

        var newNode = uiState.tree.addBranch(
            currentNode.id,
            newState,
            action,
            new BattlePlanner.BattleOutcome('Switch', 1, 0, {})
        );

        if (newNode) {
            uiState.tree.navigate(newNode.id);
        }
    }

    /**
     * Restore the Turn Actions panel from either:
     * 1) This node's own actions (if it has any — branch/leaf nodes)
     * 2) This node's first child's actions (parent nodes — shows what was done next)
     */
    function restoreActionsFromNode(node) {
        if (!node) {
            uiState.p1Action = null;
            uiState.p2Action = null;
            updateTurnActionsPanel();
            return;
        }

        // Prefer the node's own actions (shows what happened to reach this state)
        var acts = null;
        if (node.actions && (node.actions.p1 || node.actions.p2)) {
            acts = node.actions;
        } else if (node.children.length > 0) {
            var childNode = uiState.tree.getNode(node.children[0]);
            if (childNode && childNode.actions) acts = childNode.actions;
        }

        if (!acts) {
            uiState.p1Action = null;
            uiState.p2Action = null;
            updateTurnActionsPanel();
            return;
        }

        // Restore P1 action
        if (acts.p1) {
            if (acts.p1.type === 'switch') {
                uiState.p1Action = {
                    type: 'switch',
                    targetSlot: acts.p1.targetSlot || (acts.p1.data && acts.p1.data.targetSlot) || 0,
                    targetName: acts.p1.targetName || (acts.p1.data && acts.p1.data.targetName) || '?'
                };
            } else {
                uiState.p1Action = {
                    type: 'move',
                    index: acts.p1.moveIndex || (acts.p1.data && acts.p1.data.moveIndex) || 0,
                    moveName: acts.p1.moveName || (acts.p1.data && acts.p1.data.moveName) || '',
                    isCrit: acts.p1.data ? !!acts.p1.data.isCrit : false,
                    hits: (acts.p1.data && acts.p1.data.hits) || 3,
                    applyEffect: false
                };
            }
        } else {
            uiState.p1Action = null;
        }

        // Restore P2 action
        if (acts.p2) {
            if (acts.p2.type === 'switch') {
                uiState.p2Action = {
                    type: 'switch',
                    targetSlot: acts.p2.targetSlot || (acts.p2.data && acts.p2.data.targetSlot) || 0,
                    targetName: acts.p2.targetName || (acts.p2.data && acts.p2.data.targetName) || '?'
                };
            } else {
                uiState.p2Action = {
                    type: 'move',
                    index: acts.p2.moveIndex || (acts.p2.data && acts.p2.data.moveIndex) || 0,
                    moveName: acts.p2.moveName || (acts.p2.data && acts.p2.data.moveName) || '',
                    isCrit: acts.p2.data ? !!acts.p2.data.isCrit : false,
                    hits: (acts.p2.data && acts.p2.data.hits) || 3,
                    applyEffect: false
                };
            }
        } else {
            uiState.p2Action = null;
        }

        updateTurnActionsPanel();
        updateExecuteTurnButton();

        // Re-apply visual selection on move rows
        $('#p1-move-list .move-row, #p2-move-list .move-row').removeClass('selected');
        if (uiState.p1Action && uiState.p1Action.type === 'move') {
            $('#p1-move-list .move-row[data-index="' + uiState.p1Action.index + '"]').addClass('selected');
        }
        if (uiState.p2Action && uiState.p2Action.type === 'move') {
            $('#p2-move-list .move-row[data-index="' + uiState.p2Action.index + '"]').addClass('selected');
        }
    }

    function selectNode(nodeId) {
        uiState.tree.navigate(nodeId);
        var node = uiState.tree.getNode(nodeId);

        // Restore actions from this node's children or this node itself
        restoreActionsFromNode(node);

        // Check if this branch has a pending KO that needs switch resolution
        if (node && node.pendingKO) {
            var ko = node.pendingKO;
            delete node.pendingKO;

            var handleSwitch = function (side, onDone) {
                if (side === 'p2') {
                    var prediction = tryPredictP2SwitchIn(node.state);
                    if (prediction) {
                        showAIPredictBanner(prediction, node.state, function (slot) {
                            if (BattlePlannerLogic) BattlePlannerLogic.performSwitch(node.state, 'p2', slot);
                            syncActiveToTeam(node.state);
                            renderStage();
                            renderTree();
                            if (onDone) onDone();
                        });
                    } else {
                        showKOReplacementModal('p2', node.state, function (slot) {
                            if (slot !== null && slot !== undefined) {
                                if (BattlePlannerLogic) BattlePlannerLogic.performSwitch(node.state, 'p2', slot);
                                syncActiveToTeam(node.state);
                            }
                            renderStage();
                            renderTree();
                            if (onDone) onDone();
                        });
                    }
                } else {
                    showKOReplacementModal('p1', node.state, function (slot) {
                        if (slot !== null && slot !== undefined) {
                            if (BattlePlannerLogic) BattlePlannerLogic.performSwitch(node.state, 'p1', slot);
                            syncActiveToTeam(node.state);
                        }
                        renderStage();
                        renderTree();
                        if (onDone) onDone();
                    });
                }
            };

            if (ko.p1 && ko.p2) {
                handleSwitch('p1', function () { handleSwitch('p2', null); });
            } else if (ko.p2) {
                handleSwitch('p2', null);
            } else if (ko.p1) {
                handleSwitch('p1', null);
            }
        }
    }

    function toggleNodeExpand(nodeId) {
        uiState.expandedNodes[nodeId] = !uiState.expandedNodes[nodeId];
        renderTree();
    }

    function expandAllNodes() {
        Object.keys(uiState.tree.nodes).forEach(function (id) {
            uiState.expandedNodes[id] = true;
        });
        renderTree();
    }

    function collapseAllNodes() {
        Object.keys(uiState.tree.nodes).forEach(function (id) {
            uiState.expandedNodes[id] = false;
        });
        if (uiState.tree.rootId) {
            uiState.expandedNodes[uiState.tree.rootId] = true;
        }
        renderTree();
    }

    function navigateToPreviousTurn() {
        var currentNode = uiState.tree.getCurrentNode();
        if (currentNode && currentNode.parentId) {
            uiState.tree.navigate(currentNode.parentId);
        }
    }

    function navigateToNextTurn() {
        var currentNode = uiState.tree.getCurrentNode();
        if (currentNode && currentNode.children.length > 0) {
            uiState.tree.navigate(currentNode.children[0]);
        }
    }

    function toggleInspectorPanel() {
        $inspectorPanel.toggleClass('collapsed');
        var isCollapsed = $inspectorPanel.hasClass('collapsed');
        $('#inspector-collapse').text(isCollapsed ? '▶' : '◀');
        if (isCollapsed) {
            if (!$('#inspector-reopen').length) {
                $inspectorPanel.after('<button id="inspector-reopen" class="inspector-reopen-btn" title="Open Inspector">▶</button>');
            }
            $('#inspector-reopen').show();
        } else {
            $('#inspector-reopen').hide();
        }
    }

    function deleteCurrentNode() {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode || currentNode.id === uiState.tree.rootId) {
            alert('Cannot delete the root node');
            return;
        }

        if (confirm('Delete this branch and all its children?')) {
            uiState.tree.removeNode(currentNode.id);
        }
    }

    function updateNodeNotes(notes) {
        var currentNode = uiState.tree.getCurrentNode();
        if (currentNode) {
            currentNode.notes = notes;
        }
    }

    // Current move effects modal state
    var pendingMoveEffects = {
        side: null,
        index: null,
        moveName: null
    };

    /**
     * Open the move effects modal for customizing a move
     */
    function openMoveEffectsModal(side, index, moveName) {
        pendingMoveEffects.side = side;
        pendingMoveEffects.index = index;
        pendingMoveEffects.moveName = moveName;

        $('#move-effects-title').text(moveName + ' Effects');

        // Reset form
        $('#me-no-damage, #me-invulnerable, #me-switch-self, #me-switch-target').prop('checked', false);
        $('#me-status-buttons .effect-btn').removeClass('active');
        $('#me-status-buttons .effect-btn[data-status="none"]').addClass('active');
        $('#me-stat-atk, #me-stat-def, #me-stat-spa, #me-stat-spd, #me-stat-spe').val(0);
        $('#me-self-atk, #me-self-def, #me-self-spa, #me-self-spd, #me-self-spe').val(0);
        $('#me-self-damage').val(0);
        $('#me-priority-mod').val('0');

        // Load existing effects if this move was already selected
        var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        if (action && action.index === index && action.customEffects) {
            var ce = action.customEffects;
            if (ce.noDamage) $('#me-no-damage').prop('checked', true);
            if (ce.invulnerable) $('#me-invulnerable').prop('checked', true);
            if (ce.switchSelf) $('#me-switch-self').prop('checked', true);
            if (ce.switchTarget) $('#me-switch-target').prop('checked', true);
            if (ce.selfDamage) $('#me-self-damage').val(ce.selfDamage);
            if (ce.priorityMod) $('#me-priority-mod').val(ce.priorityMod);
            if (ce.targetStatus) {
                $('#me-status-buttons .effect-btn').removeClass('active');
                $('#me-status-buttons .effect-btn[data-status="' + ce.targetStatus + '"]').addClass('active');
            }
            if (ce.targetBoosts) {
                $('#me-stat-atk').val(ce.targetBoosts.atk || 0);
                $('#me-stat-def').val(ce.targetBoosts.def || 0);
                $('#me-stat-spa').val(ce.targetBoosts.spa || 0);
                $('#me-stat-spd').val(ce.targetBoosts.spd || 0);
                $('#me-stat-spe').val(ce.targetBoosts.spe || 0);
            }
            if (ce.selfBoosts) {
                $('#me-self-atk').val(ce.selfBoosts.atk || 0);
                $('#me-self-def').val(ce.selfBoosts.def || 0);
                $('#me-self-spa').val(ce.selfBoosts.spa || 0);
                $('#me-self-spd').val(ce.selfBoosts.spd || 0);
                $('#me-self-spe').val(ce.selfBoosts.spe || 0);
            }
        }

        $('#move-effects-modal').show();
    }

    /**
     * Apply the configured move effects to the action
     */
    function applyMoveEffectsToAction() {
        var side = pendingMoveEffects.side;
        var index = pendingMoveEffects.index;
        var moveName = pendingMoveEffects.moveName;

        // First select the move if not already selected
        var action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        if (!action || action.index !== index) {
            selectMoveForTurn(side, index, moveName);
            action = side === 'p1' ? uiState.p1Action : uiState.p2Action;
        }

        // Build custom effects object
        var customEffects = {
            noDamage: $('#me-no-damage').is(':checked'),
            invulnerable: $('#me-invulnerable').is(':checked'),
            switchSelf: $('#me-switch-self').is(':checked'),
            switchTarget: $('#me-switch-target').is(':checked'),
            selfDamage: parseInt($('#me-self-damage').val()) || 0,
            priorityMod: parseInt($('#me-priority-mod').val()) || 0,
            targetStatus: $('#me-status-buttons .effect-btn.active').data('status') || null,
            targetBoosts: {
                atk: parseInt($('#me-stat-atk').val()) || 0,
                def: parseInt($('#me-stat-def').val()) || 0,
                spa: parseInt($('#me-stat-spa').val()) || 0,
                spd: parseInt($('#me-stat-spd').val()) || 0,
                spe: parseInt($('#me-stat-spe').val()) || 0
            },
            selfBoosts: {
                atk: parseInt($('#me-self-atk').val()) || 0,
                def: parseInt($('#me-self-def').val()) || 0,
                spa: parseInt($('#me-self-spa').val()) || 0,
                spd: parseInt($('#me-self-spd').val()) || 0,
                spe: parseInt($('#me-self-spe').val()) || 0
            }
        };

        // Remove empty boosts
        if (customEffects.targetStatus === 'none') customEffects.targetStatus = null;

        action.customEffects = customEffects;

        $('#move-effects-modal').hide();
        updateTurnActionsPanel();
    }

    /**
     * Open the effect editor modal
     */
    function openEffectEditor() {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        // Reset UI state
        uiState.pendingStatus = null;
        $('#status-buttons .effect-btn').removeClass('active');
        $('.stat-value').text('0').attr('data-value', 0);
        $('#effect-sections .effect-btn').removeClass('active');
        $('#effect-duration').val(3);

        // Load current state for the target Pokemon
        updateEffectEditorDisplay();

        $('#effect-editor-modal').show();
    }

    /**
     * Update the effect editor display based on current target
     */
    function updateEffectEditorDisplay() {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var target = $('#effect-target').val();
        var pokemon = target === 'p1' ? currentNode.state.p1.active : currentNode.state.p2.active;

        if (!pokemon) return;

        // Show current status
        if (pokemon.status) {
            $('#status-buttons .effect-btn[data-effect="' + pokemon.status + '"]').addClass('active');
        }

        // Show current boosts
        var boosts = pokemon.boosts || {};
        for (var stat in boosts) {
            var val = boosts[stat] || 0;
            $('#stat-' + stat).text(val > 0 ? '+' + val : val).attr('data-value', val);
        }
    }

    /**
     * Apply manually set effects to the target Pokemon
     */
    function applyManualEffects() {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var target = $('#effect-target').val();
        var state = currentNode.state;
        var pokemon = target === 'p1' ? state.p1.active : state.p2.active;

        if (!pokemon) return;

        // Create a new state with the changes
        var newState = state.clone();
        var targetPoke = target === 'p1' ? newState.p1.active : newState.p2.active;

        // Apply status
        var selectedStatus = $('#status-buttons .effect-btn.active').data('effect');
        if (selectedStatus === 'none') {
            targetPoke.status = '';
        } else if (selectedStatus) {
            targetPoke.status = selectedStatus;
            // Track toxic counter
            if (selectedStatus === 'tox') {
                targetPoke.toxicCounter = 1;
            }
        }

        // Apply stat changes
        var boosts = {};
        $('.stat-row').each(function () {
            var stat = $(this).data('stat');
            var val = parseInt($(this).find('.stat-value').attr('data-value')) || 0;
            if (val !== 0) {
                boosts[stat] = val;
            }
        });
        targetPoke.boosts = boosts;

        // Apply other effects
        targetPoke.volatileStatus = targetPoke.volatileStatus || [];
        $('#effect-sections .effect-btn.active').each(function () {
            var effect = $(this).data('effect');
            var duration = parseInt($('#effect-duration').val()) || 3;
            if (effect && !targetPoke.volatileStatus.includes(effect)) {
                targetPoke.volatileStatus.push({ type: effect, turnsLeft: duration });
            }
        });

        // Update team array as well
        if (target === 'p1' && newState.p1.team && newState.p1.teamSlot !== undefined) {
            newState.p1.team[newState.p1.teamSlot] = targetPoke;
        }
        if (target === 'p2' && newState.p2.team && newState.p2.teamSlot !== undefined) {
            newState.p2.team[newState.p2.teamSlot] = targetPoke;
        }

        // Create a branch for the effect application
        var action = {};
        action[target] = new BattlePlanner.BattleAction('effect', {
            description: 'Applied effects manually'
        });

        var newNode = uiState.tree.addBranch(
            currentNode.id,
            newState,
            action,
            new BattlePlanner.BattleOutcome('Effects applied', 1, 0, {})
        );

        if (newNode) {
            uiState.tree.navigate(newNode.id);
        }

        $('#effect-editor-modal').hide();
    }

    function onTreeUpdated() {
        renderTree();
        uiState.tree.analyzeOutcomes();
        saveBattleState();
    }

    function onCurrentNodeChanged(data) {
        renderTree();
        renderStage();

        var path = uiState.tree.getPathToNode(data.newNodeId);
        path.forEach(function (id) {
            uiState.expandedNodes[id] = true;
        });
        renderTree();

        setTimeout(function () {
            var node = $('.tree-node[data-node-id="' + data.newNodeId + '"]')[0];
            if (node) {
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    // Initialize on ready
    $(document).ready(initialize);

    // =========================================================================
    // TRAINER SELECTOR
    // =========================================================================

    /**
     * Build a map of trainer name -> array of { pokemonName, set } from SETDEX_SS
     */
    function buildTrainerMap() {
        if (typeof SETDEX_SS === 'undefined') return {};

        var map = {};
        for (var pokeName in SETDEX_SS) {
            if (!SETDEX_SS.hasOwnProperty(pokeName)) continue;
            var sets = SETDEX_SS[pokeName];
            for (var trainerName in sets) {
                if (!sets.hasOwnProperty(trainerName)) continue;
                if (!map[trainerName]) {
                    map[trainerName] = { pokemon: [], index: sets[trainerName].index || 9999 };
                }
                map[trainerName].pokemon.push({
                    name: pokeName,
                    set: sets[trainerName]
                });
                // Keep the lowest index for this trainer (earliest encounter)
                if (sets[trainerName].index < map[trainerName].index) {
                    map[trainerName].index = sets[trainerName].index;
                }
            }
        }
        return map;
    }

    var _trainerMap = null;
    function getTrainerMap() {
        if (!_trainerMap) _trainerMap = buildTrainerMap();
        return _trainerMap;
    }

    /**
     * Open the trainer selector modal
     */
    function openTrainerSelector() {
        var map = getTrainerMap();
        var trainers = Object.keys(map).map(function (name) {
            return { name: name, pokemon: map[name].pokemon, index: map[name].index };
        });

        // Sort by encounter order (index)
        trainers.sort(function (a, b) { return a.index - b.index; });

        var savedBattles = getSavedBattleKeys();

        var html = trainers.map(function (t) {
            var levels = t.pokemon.map(function (p) { return p.set.level || 50; });
            var minLvl = Math.min.apply(null, levels);
            var maxLvl = Math.max.apply(null, levels);
            var lvlStr = minLvl === maxLvl ? 'Lv ' + minLvl : 'Lv ' + minLvl + '-' + maxLvl;

            var hasSave = savedBattles.indexOf(t.name) !== -1;
            var saveIndicator = hasSave ? '<span class="trainer-save-badge" title="Saved battle data">&#9733;</span>' : '';

            var sprites = t.pokemon.map(function (p) {
                var spriteName = p.name;
                if (spriteName.includes('Vivillon')) spriteName = 'Vivillon';
                return '<img class="trainer-list-sprite" src="https://raw.githubusercontent.com/May8th1995/sprites/master/' + spriteName + '.png" alt="' + p.name + '" title="' + p.name + '">';
            }).join('');

            return '<div class="trainer-list-item" data-trainer="' + t.name + '" data-search="' + t.name.toLowerCase() + '">' +
                '<div class="trainer-list-header">' +
                    '<span class="trainer-list-name">' + t.name + '</span>' +
                    saveIndicator +
                    '<span class="trainer-list-level">' + lvlStr + '</span>' +
                '</div>' +
                '<div class="trainer-list-sprites">' + sprites + '</div>' +
            '</div>';
        }).join('');

        $('#trainer-list').html(html);
        $('#trainer-search-input').val('');
        $('#trainer-select-modal').show();
        $('#trainer-search-input').focus();
    }

    /**
     * Filter the trainer list by search string
     */
    function filterTrainerList(query) {
        var lower = (query || '').toLowerCase();
        $('.trainer-list-item').each(function () {
            var searchStr = $(this).data('search') || '';
            $(this).toggle(searchStr.indexOf(lower) !== -1);
        });
    }

    /**
     * Select a trainer and start/resume a battle
     */
    function selectTrainerForBattle(trainerName) {
        $('#trainer-select-modal').hide();

        var map = getTrainerMap();
        var trainerData = map[trainerName];
        if (!trainerData) return;

        uiState.currentTrainer = trainerName;
        updateTrainerLabel();

        // Check for saved battle
        var savedKey = 'plannerBattle_' + trainerName;
        var savedData = localStorage.getItem(savedKey);

        if (savedData) {
            var resume = confirm('You have a saved battle against ' + trainerName + '.\n\nClick OK to resume, or Cancel to start fresh.');
            if (resume) {
                var tree = new BattlePlanner.BattleTree();
                if (tree.deserialize(savedData)) {
                    uiState.tree = tree;
                    uiState.tree.onTreeUpdated = onTreeUpdated;
                    uiState.tree.onCurrentNodeChanged = onCurrentNodeChanged;
                    uiState.p1Action = null;
                    uiState.p2Action = null;
                    refreshBoxFromCustomsets();
                    renderTree();
                    renderStage();
                    $('.tree-placeholder').hide();
                    return;
                }
            }
        }

        // Start fresh battle with this trainer
        startBattleWithTrainer(trainerData.pokemon, trainerName);
    }

    /**
     * Start a fresh battle with the given trainer's Pokemon
     */
    function startBattleWithTrainer(trainerPokemon, trainerName) {
        var gen = getGenNum();
        var initialState = new BattlePlanner.BattleStateSnapshot();

        // P1 from calculator or imported team
        var p1Pokemon = window.createPokemon ? window.createPokemon($('#p1')) : null;
        if (!p1Pokemon) {
            var customsets = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
            for (var name in customsets) {
                for (var setName in customsets[name]) {
                    var set = customsets[name][setName];
                    if (set && set.name) {
                        p1Pokemon = createCalcPokemonFromImported(set);
                        break;
                    }
                }
                if (p1Pokemon) break;
            }
        }

        if (!p1Pokemon) {
            alert('Please set up your Pokemon first (in the calculator or by importing a save file).');
            return;
        }

        initialState.p1.active = new BattlePlanner.PokemonSnapshot(p1Pokemon);
        initialState.p1.team = [initialState.p1.active.clone()];

        // Add remaining imported Pokemon to team (up to 6)
        var customsets2 = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
        var addedNames = {};
        addedNames[initialState.p1.active.name] = true;
        for (var pName in customsets2) {
            if (initialState.p1.team.length >= 6) break;
            for (var sName in customsets2[pName]) {
                if (initialState.p1.team.length >= 6) break;
                var s = customsets2[pName][sName];
                if (s && s.name && !addedNames[s.name]) {
                    var snap = createSnapshotFromImported(s);
                    if (snap) {
                        initialState.p1.team.push(snap);
                        addedNames[snap.name] = true;
                    }
                }
            }
        }

        // Build P2 team from trainer data
        initialState.p2.team = [];
        for (var i = 0; i < trainerPokemon.length; i++) {
            var tp = trainerPokemon[i];
            try {
                var pokemon = new window.calc.Pokemon(gen, tp.name, {
                    level: tp.set.level || 50,
                    ability: tp.set.ability,
                    item: tp.set.item,
                    nature: tp.set.nature,
                    ivs: tp.set.ivs || {},
                    evs: tp.set.evs || {},
                    moves: (tp.set.moves || []).map(function (m) {
                        return new window.calc.Move(gen, m);
                    })
                });
                var snap2 = new BattlePlanner.PokemonSnapshot(pokemon);
                initialState.p2.team.push(snap2);
            } catch (e) {
                console.error('Failed to create trainer Pokemon:', tp.name, e);
            }
        }

        if (initialState.p2.team.length > 0) {
            initialState.p2.active = initialState.p2.team[0].clone();
            initialState.p2.teamSlot = 0;
        }

        var field = window.createField ? window.createField() : null;
        if (field) {
            initialState.field.weather = field.weather || 'None';
            initialState.field.terrain = field.terrain || 'None';
        }

        uiState.p1Action = null;
        uiState.p2Action = null;
        uiState.p1Box = [];
        uiState.p2Box = [];

        uiState.tree = new BattlePlanner.BattleTree();
        uiState.tree.onTreeUpdated = onTreeUpdated;
        uiState.tree.onCurrentNodeChanged = onCurrentNodeChanged;
        uiState.tree.initialize(initialState);

        refreshBoxFromCustomsets();
        renderTree();
        renderStage();
        $('.tree-placeholder').hide();

        console.log('Battle started against', trainerName, 'with', trainerPokemon.length, 'Pokemon');
    }

    /**
     * Update the trainer label in the header
     */
    function updateTrainerLabel() {
        $('#planner-trainer-label').hide();
        if (uiState.currentTrainer) {
            $('#p2-team-title').text('vs ' + uiState.currentTrainer);
        } else {
            $('#p2-team-title').text("OPPONENT'S TEAM");
        }
    }

    // =========================================================================
    // BATTLE PERSISTENCE
    // =========================================================================

    /**
     * Save the current battle tree to localStorage
     */
    function saveBattleState() {
        if (!uiState.currentTrainer || !uiState.tree) return;
        try {
            var key = 'plannerBattle_' + uiState.currentTrainer;
            var data = uiState.tree.serialize();
            localStorage.setItem(key, data);
        } catch (e) {
            console.error('Failed to save battle state:', e);
        }
    }

    /**
     * Get list of trainer names with saved battles
     */
    function getSavedBattleKeys() {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf('plannerBattle_') === 0) {
                keys.push(k.replace('plannerBattle_', ''));
            }
        }
        return keys;
    }

    /**
     * Refresh the planner's box from localStorage.customsets
     * Call this after importing new save files or modifying customsets
     */
    function refreshBoxFromCustomsets() {
        var customsets = localStorage.customsets ? JSON.parse(localStorage.customsets) : {};
        var importedPokemon = [];

        for (var name in customsets) {
            for (var setName in customsets[name]) {
                var set = customsets[name][setName];
                if (set && set.name) {
                    importedPokemon.push(set);
                }
            }
        }

        // Collect names of all team members to exclude from box
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        var teamNames = {};
        if (currentNode && currentNode.state.p1.team) {
            currentNode.state.p1.team.forEach(function (t) {
                if (t && t.name) teamNames[t.name] = true;
            });
        }

        // Update P1 box
        uiState.p1Box = [];
        for (var i = 0; i < importedPokemon.length; i++) {
            var snap = createSnapshotFromImported(importedPokemon[i]);
            if (snap && !teamNames[snap.name]) {
                uiState.p1Box.push(snap);
            }
        }

        console.log('Refreshed box with', uiState.p1Box.length, 'Pokemon from customsets');

        // Re-render if visible
        if (uiState.isVisible) {
            renderStage();
        }
    }

    // Export
    window.BattlePlannerUI = {
        show: showPlanner,
        hide: hidePlanner,
        toggle: togglePlanner,
        startBattle: startNewBattle,
        startWithImportedTeam: startBattleWithImportedTeam,
        refreshBox: refreshBoxFromCustomsets,
        getTree: function () { return uiState.tree; },
        isVisible: function () { return uiState.isVisible; }
    };

})(window, jQuery);
