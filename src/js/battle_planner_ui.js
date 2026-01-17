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
        lastRenderedNodeId: null
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
                /* KO Highlighting for Moves (Player side follows Green/GoldOHKO rules) */
                .move-cell.match-dmg-1 {
                    background: rgba(76, 175, 80, 0.45) !important;
                    border-left: 4px solid #4caf50;
                    box-shadow: inset 0 0 12px rgba(76, 175, 80, 0.5) !important;
                }
                .move-cell.match-dmg-2 {
                    background: rgba(255, 215, 0, 0.45) !important;
                    border-left: 4px solid #ffd700;
                    box-shadow: inset 0 0 12px rgba(255, 215, 0, 0.4) !important;
                }
                /* Opponent side follows Orange/Red rules */
                .move-cell.match-dmg-3 {
                    background: rgba(255, 140, 0, 0.45) !important;
                    border-left: 4px solid #ff8c00;
                    box-shadow: inset 0 0 12px rgba(255, 140, 0, 0.5) !important;
                }
                .move-cell.match-dmg-4 {
                    background: rgba(211, 47, 47, 0.45) !important;
                    border-left: 4px solid #d32f2f;
                    box-shadow: inset 0 0 12px rgba(211, 47, 47, 0.5) !important;
                }

                /* Matchup Color Coding (Speed Borders) */
                .team-overview-slot.match-speed-f, .box-slot.match-speed-f { border-color: #4fc3f7 !important; border-width: 2px !important; }
                .team-overview-slot.match-speed-t, .box-slot.match-speed-t { border-color: #ba68c8 !important; border-width: 2px !important; }
                .team-overview-slot.match-speed-s, .box-slot.match-speed-s { border-color: #555 !important; border-width: 2px !important; }

                /* Matchup Color Coding (OHKO Backgrounds) */
                .match-dmg-1, .match-dmg-W1 { background: rgba(76, 175, 80, 0.45) !important; box-shadow: inset 0 0 12px rgba(76, 175, 80, 0.5) !important; }
                .match-dmg-2, .match-dmg-W2 { background: rgba(255, 215, 0, 0.45) !important; box-shadow: inset 0 0 12px rgba(255, 215, 0, 0.4) !important; }
                .match-dmg-3 { background: rgba(255, 140, 0, 0.45) !important; box-shadow: inset 0 0 12px rgba(255, 140, 0, 0.5) !important; }
                .match-dmg-4 { background: rgba(211, 47, 47, 0.45) !important; box-shadow: inset 0 0 12px rgba(211, 47, 47, 0.5) !important; }
                
                .match-dmg-13, .match-dmg-14, .match-dmg-23, .match-dmg-24 { 
                    box-shadow: inset 0 0 12px rgba(255, 255, 255, 0.1) !important;
                }
                .match-dmg-13 { background: linear-gradient(135deg, rgba(76, 175, 80, 0.5) 50%, rgba(255, 140, 0, 0.5) 50%) !important; }
                .match-dmg-14 { background: linear-gradient(135deg, rgba(76, 175, 80, 0.5) 50%, rgba(211, 47, 47, 0.5) 50%) !important; }
                .match-dmg-23 { background: linear-gradient(135deg, rgba(255, 215, 0, 0.5) 50%, rgba(255, 140, 0, 0.5) 50%) !important; }
                .match-dmg-24 { background: linear-gradient(135deg, rgba(255, 215, 0, 0.5) 50%, rgba(211, 47, 47, 0.5) 50%) !important; }
                
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
                <div class="planner-header">
                    <h2 class="planner-title">
                        <span class="planner-icon">⚔️</span>
                        Battle Planner
                    </h2>
                    <div class="planner-controls">
                        <button class="planner-btn planner-btn-view active" data-view="split" title="Split View">Split</button>
                        <button class="planner-btn planner-btn-view" data-view="tree" title="Tree View">Tree</button>
                        <button class="planner-btn planner-btn-view" data-view="stage" title="Stage View">Stage</button>
                        <span class="planner-separator">|</span>
                        <button class="planner-btn planner-btn-action" id="planner-new" title="New Battle">New</button>
                        <button class="planner-btn planner-btn-action" id="planner-import" title="Import State">Import</button>
                        <button class="planner-btn planner-btn-action" id="planner-export" title="Export Plan">Export</button>
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
                            <!-- Speed Comparison Bar -->
                            <div class="speed-comparison-bar" id="speed-comparison">
                                <span class="speed-icon">⚡</span>
                                <span class="speed-text" id="speed-text">--</span>
                            </div>
                            
                            <div class="stage-field">
                                <!-- P1 Pokemon Card -->
                                <div class="pokemon-card pokemon-card-p1" id="stage-p1">
                                    <div class="card-header">
                                        <span class="card-label">PLAYER</span>
                                        <button class="card-switch-btn" id="p1-card-switch-btn" title="Switch Pokemon (uses your turn)">⇄</button>
                                    </div>
                                    <div class="card-body">
                                        <div class="card-sprite-container">
                                            <img class="card-sprite" id="stage-p1-sprite" src="" alt="P1">
                                            <div class="card-types" id="stage-p1-types"></div>
                                        </div>
                                        <div class="card-info">
                                            <div class="card-name" id="stage-p1-name">---</div>
                                            <div class="card-details">
                                                <span class="card-level" id="stage-p1-level">Lv. --</span>
                                                <span class="card-ability" id="stage-p1-ability"></span>
                                            </div>
                                            <div class="card-hp-container">
                                                <div class="card-hp-bar">
                                                    <div class="card-hp-fill" id="stage-p1-hp-fill"></div>
                                                    <div class="card-hp-shadow" id="stage-p1-hp-shadow"></div>
                                                </div>
                                                <span class="card-hp-text" id="stage-p1-hp-text">---/---</span>
                                            </div>
                                            <div class="card-status-boosts">
                                                <span class="card-status" id="stage-p1-status"></span>
                                                <span class="card-item" id="stage-p1-item"></span>
                                            </div>
                                            <div class="card-boosts" id="stage-p1-boosts"></div>
                                            <div class="card-stats-mini" id="stage-p1-stats-mini"></div>
                                        </div>
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
                                        <span class="card-label">OPPONENT</span>
                                        <button class="card-switch-btn" id="p2-card-switch-btn" title="Switch Pokemon (uses opponent's turn)">⇄</button>
                                    </div>
                                    <div class="card-body">
                                        <div class="card-sprite-container">
                                            <img class="card-sprite" id="stage-p2-sprite" src="" alt="P2">
                                            <div class="card-types" id="stage-p2-types"></div>
                                        </div>
                                        <div class="card-info">
                                            <div class="card-name" id="stage-p2-name">---</div>
                                            <div class="card-details">
                                                <span class="card-level" id="stage-p2-level">Lv. --</span>
                                                <span class="card-ability" id="stage-p2-ability"></span>
                                            </div>
                                            <div class="card-hp-container">
                                                <div class="card-hp-bar">
                                                    <div class="card-hp-fill" id="stage-p2-hp-fill"></div>
                                                    <div class="card-hp-shadow" id="stage-p2-hp-shadow"></div>
                                                </div>
                                                <span class="card-hp-text" id="stage-p2-hp-text">---/---</span>
                                            </div>
                                            <div class="card-status-boosts">
                                                <span class="card-status" id="stage-p2-status"></span>
                                                <span class="card-item" id="stage-p2-item"></span>
                                            </div>
                                            <div class="card-boosts" id="stage-p2-boosts"></div>
                                            <div class="card-stats-mini" id="stage-p2-stats-mini"></div>
                                        </div>
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
                                        <span class="team-overview-title">OPPONENT'S TEAM</span>
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
                                <li><span class="badge badge-best">Green</span> nodes = best case scenario</li>
                                <li><span class="badge badge-worst">Red</span> nodes = worst case scenario</li>
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
                                <h4>Opponent's Team</h4>
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
                if ($('#planner-help-modal').is(':visible')) {
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
        $(document).on('click', '#planner-new, #tree-start-battle', startNewBattle);
        $(document).on('click', '#tree-start-imported', startBattleWithImportedTeam);

        // Import/Export
        $(document).on('click', '#planner-import', importState);
        $(document).on('click', '#planner-export', exportPlan);

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
        $(document).on('click', '#inspector-delete-node', deleteCurrentNode);
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
    function handlePokemonDrop(source, target) {
        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var state = currentNode.state;

        // Only allow P1 team/box manipulation - P2 team is fixed
        if (target.side === 'p2') {
            console.log('Cannot modify opponent team via drag/drop');
            return;
        }

        var pokemon = null;

        // Get the pokemon from source
        if (source.source === 'team') {
            pokemon = state.p1.team[source.index];
        } else {
            pokemon = uiState.p1Box[source.index];
        }
        if (!pokemon) return;

        if (source.source === 'team' && target.destination === 'box') {
            // Move from team to box
            state.p1.team.splice(source.index, 1);
            uiState.p1Box.push(pokemon);
        } else if (source.source === 'box' && target.destination === 'team') {
            // Move from box to team
            if (state.p1.team.length >= 6 && (target.index === undefined || target.index >= state.p1.team.length)) {
                alert('Maximum team size is 6 Pokemon!');
                return;
            }

            uiState.p1Box.splice(source.index, 1);

            if (target.index !== undefined && target.index < state.p1.team.length) {
                // Swap box pokemon with team pokemon
                var oldPoke = state.p1.team[target.index];
                state.p1.team[target.index] = pokemon;
                uiState.p1Box.push(oldPoke);
            } else {
                // Add to team
                state.p1.team.push(pokemon);
            }
        } else if (source.source === 'team' && target.destination === 'team') {
            // Swap within team
            if (source.index !== target.index && target.index !== undefined) {
                if (target.index < state.p1.team.length) {
                    var temp = state.p1.team[source.index];
                    state.p1.team[source.index] = state.p1.team[target.index];
                    state.p1.team[target.index] = temp;
                } else {
                    // Moving to an empty slot at the end
                    state.p1.team.splice(source.index, 1);
                    state.p1.team.push(pokemon);
                }
            }
        }

        // Clean up any undefined in team
        state.p1.team = state.p1.team.filter(function (p) { return !!p; });

        // Update active/slot if needed
        if (state.p1.teamSlot >= state.p1.team.length) {
            state.p1.teamSlot = Math.max(0, state.p1.team.length - 1);
        }
        if (state.p1.team.length > 0) {
            state.p1.active = state.p1.team[state.p1.teamSlot];
        }

        // Just re-render
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
        var p2Select = $('#p2 .pokemon-select').val();
        if (p2Select && !trainerPokemon.includes(p2Select)) {
            trainerPokemon.unshift(p2Select);
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
            // dataId format is usually "Name (Set Name)" or similar
            var name = dataId.split(' (')[0];
            var gen = getGenNum();

            // Try to get the set from setdex
            var setName = dataId.includes('(') ? dataId.split('(')[1].replace(')', '') : null;
            var pokemon = null;

            if (setName && window.setdex && window.setdex[name] && window.setdex[name][setName]) {
                var set = window.setdex[name][setName];
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
                // Fallback: create basic Pokemon
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

        var nodeClasses = ['tree-node'];
        if (isCurrentNode) nodeClasses.push('tree-node-current');
        if (node.isBestCase) nodeClasses.push('tree-node-best');
        if (node.isWorstCase) nodeClasses.push('tree-node-worst');

        // Calculate HP percentages properly
        var p1Active = node.state.p1.active;
        var p2Active = node.state.p2.active;
        var p1HP = 0, p2HP = 0;
        if (p1Active && p1Active.maxHP > 0) {
            p1HP = Math.round((p1Active.currentHP / p1Active.maxHP) * 100);
        }
        if (p2Active && p2Active.maxHP > 0) {
            p2HP = Math.round((p2Active.currentHP / p2Active.maxHP) * 100);
        }

        // HP colors
        var p1Color = p1HP > 50 ? 'hp-green' : p1HP > 20 ? 'hp-yellow' : 'hp-red';
        var p2Color = p2HP > 50 ? 'hp-green' : p2HP > 20 ? 'hp-yellow' : 'hp-red';

        // Check for KOs
        var p1KO = p1Active && p1Active.currentHP <= 0;
        var p2KO = p2Active && p2Active.currentHP <= 0;
        if (p1KO) nodeClasses.push('tree-node-p1ko');
        if (p2KO) nodeClasses.push('tree-node-p2ko');

        var label = node.id === uiState.tree.rootId ? 'Start' : node.getFullLabel();
        var probText = '';
        if (node.outcome && node.outcome.probability < 1) {
            probText = CalcIntegration.formatProbability(node.outcome.probability);
        }

        // Build tooltip with full details
        var p1Name = p1Active ? p1Active.name : 'P1';
        var p2Name = p2Active ? p2Active.name : 'P2';
        var p1HPText = p1Active ? (p1Active.currentHP + '/' + p1Active.maxHP) : '?/?';
        var p2HPText = p2Active ? (p2Active.currentHP + '/' + p2Active.maxHP) : '?/?';
        var tooltip = p1Name + ': ' + p1HPText + ' | ' + p2Name + ': ' + p2HPText;
        if (node.outcome && node.outcome.description) {
            tooltip += '\n' + node.outcome.description;
        }

        var html = '<div class="' + nodeClasses.join(' ') + '" data-node-id="' + nodeId + '" style="margin-left: ' + (depth * 16) + 'px;" title="' + tooltip.replace(/"/g, '&quot;') + '">';
        html += '<div class="tree-node-content">';

        if (hasChildren) {
            html += '<span class="tree-node-toggle">' + (isExpanded ? '▼' : '▶') + '</span>';
        } else {
            html += '<span class="tree-node-toggle tree-node-leaf">○</span>';
        }

        html += '<span class="tree-node-label">' + label + '</span>';
        html += '<span class="tree-node-hp">';
        html += '<span class="hp-bar-p1 ' + p1Color + '" style="width:' + Math.max(0, p1HP) + '%"></span>';
        html += '<span class="hp-bar-p2 ' + p2Color + '" style="width:' + Math.max(0, p2HP) + '%"></span>';
        html += '</span>';

        if (probText) {
            html += '<span class="tree-node-prob">' + probText + '</span>';
        }

        // KO markers
        if (p1KO) html += '<span class="tree-ko-marker p1-ko">✗</span>';
        if (p2KO) html += '<span class="tree-ko-marker p2-ko">✓</span>';

        html += '</div></div>';

        if (hasChildren && isExpanded) {
            node.children.forEach(function (childId) {
                html += renderTreeNode(childId, depth + 1);
            });
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

        // Name and level
        $('#' + prefix + '-name').text(pokemon.name);
        $('#' + prefix + '-level').text('Lv. ' + pokemon.level);

        // Ability
        if (pokemon.ability) {
            $('#' + prefix + '-ability').text(pokemon.ability).show();
        } else {
            $('#' + prefix + '-ability').empty().hide();
        }

        // HP - calculate from currentHP/maxHP directly
        var curHP = Math.max(0, pokemon.currentHP || 0);
        var maxHP = pokemon.maxHP || 1;
        var hpPercent = Math.round((curHP / maxHP) * 100);
        var hpColor = hpPercent > 50 ? 'hp-green' : hpPercent > 20 ? 'hp-yellow' : 'hp-red';
        $('#' + prefix + '-hp-text').text(curHP + '/' + maxHP);
        $('#' + prefix + '-hp-fill')
            .removeClass('hp-green hp-yellow hp-red')
            .addClass(hpColor)
            .css('width', hpPercent + '%');

        // Sprite - use the same sprite source as the main app
        var spriteUrl = 'https://raw.githubusercontent.com/May8th1995/sprites/master/' + pokemon.name + '.png';
        $('#' + prefix + '-sprite')
            .attr('src', spriteUrl)
            .show()
            .off('error')
            .on('error', function () {
                // Fallback to Showdown sprites if May8th1995 doesn't have it
                var spriteName = pokemon.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
                $(this).attr('src', 'https://play.pokemonshowdown.com/sprites/gen5/' + spriteName + '.png');
            });

        // Types
        var typesHtml = (pokemon.types || []).map(function (t) {
            return '<span class="type-badge type-' + t.toLowerCase() + '">' + t + '</span>';
        }).join('');
        $('#' + prefix + '-types').html(typesHtml);

        // Status
        if (pokemon.status && pokemon.status !== 'Healthy') {
            var statusClass = 'status-' + pokemon.status.toLowerCase().replace(' ', '-');
            $('#' + prefix + '-status').html('<span class="status-badge ' + statusClass + '">' + pokemon.status + '</span>');
        } else {
            $('#' + prefix + '-status').empty();
        }

        // Item
        if (pokemon.item) {
            $('#' + prefix + '-item').html('<span class="item-badge">🎒 ' + pokemon.item + '</span>');
        } else {
            $('#' + prefix + '-item').empty();
        }

        // Hide the separate boosts container - boosts are shown in stat grid only
        $('#' + prefix + '-boosts').empty();

        // Full stats display with boost indicators
        var boosts = pokemon.boosts || {};
        var statsHtml = '<div class="stats-grid">';

        // HP row
        statsHtml += '<div class="stat-item"><span class="stat-label">HP</span><span class="stat-value">' + (pokemon.maxHP || '?') + '</span></div>';

        // Other stats with boost indicators
        var statDefs = [
            { key: 'atk', label: 'Atk' },
            { key: 'def', label: 'Def' },
            { key: 'spa', label: 'SpA' },
            { key: 'spd', label: 'SpD' },
            { key: 'spe', label: 'Spe' }
        ];

        statDefs.forEach(function (statDef) {
            var boost = boosts[statDef.key] || 0;
            var baseStat = pokemon.stats[statDef.key] || 0;
            var effectiveStat = baseStat;

            // Calculate effective stat with boost modifier
            if (boost !== 0) {
                var multiplier;
                if (boost > 0) {
                    multiplier = (2 + boost) / 2; // +1 = 1.5, +2 = 2, +3 = 2.5, etc.
                } else {
                    multiplier = 2 / (2 - boost); // -1 = 0.67, -2 = 0.5, -3 = 0.4, etc.
                }
                effectiveStat = Math.floor(baseStat * multiplier);
            }

            var statClass = 'stat-item';
            var valueClass = 'stat-value';
            var boostIndicator = '';

            if (boost > 0) {
                statClass += ' stat-boosted';
                valueClass += ' boosted';
                boostIndicator = ' <span class="stat-boost-arrow">↑' + boost + '</span>';
            } else if (boost < 0) {
                statClass += ' stat-lowered';
                valueClass += ' lowered';
                boostIndicator = ' <span class="stat-boost-arrow">↓' + Math.abs(boost) + '</span>';
            }

            if (statDef.key === 'spe') statClass += ' stat-speed';

            statsHtml += '<div class="' + statClass + '">';
            statsHtml += '<span class="stat-label">' + statDef.label + '</span>';
            statsHtml += '<span class="' + valueClass + '">' + effectiveStat + boostIndicator + '</span>';
            statsHtml += '</div>';
        });

        statsHtml += '</div>';
        $('#' + prefix + '-stats-mini').html(statsHtml);

        // Render moves with damage preview
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

            movesHtml += '<button class="' + cellClasses.join(' ') + '" data-side="' + side + '" data-index="' + i + '" data-move="' + moveName + '">';

            // Move name with priority indicator
            movesHtml += '<div class="move-cell-header">';
            movesHtml += '<span class="move-cell-name">' + moveName + '</span>';
            if (priority > 0) {
                movesHtml += '<span class="priority-badge">+' + priority + '</span>';
            } else if (priority < 0) {
                movesHtml += '<span class="priority-badge neg">' + priority + '</span>';
            }
            if (normalDamage && normalDamage.type) {
                movesHtml += '<span class="move-type-mini type-' + normalDamage.type.toLowerCase() + '">' + normalDamage.type.substring(0, 3) + '</span>';
            }
            movesHtml += '</div>';

            // Damage or status indicator
            movesHtml += '<div class="move-cell-damage">';
            if (normalDamage && normalDamage.rawMin !== undefined && normalDamage.rawMax > 0) {
                var defHP = defender ? defender.maxHP : 100;
                var minPct = Math.round((normalDamage.rawMin / defHP) * 100);
                var maxPct = Math.round((normalDamage.rawMax / defHP) * 100);

                movesHtml += '<span class="dmg-range">' + normalDamage.rawMin + '-' + normalDamage.rawMax + '</span>';
                movesHtml += '<span class="dmg-percent">(' + minPct + '-' + maxPct + '%)</span>';

                // Effectiveness icon
                if (normalDamage.effectiveness && normalDamage.effectivenessIcon) {
                    movesHtml += '<span class="eff-icon">' + normalDamage.effectivenessIcon + '</span>';
                }

                // Crit damage (smaller)
                if (critDamage && critDamage.rawMin !== undefined) {
                    var critMinPct = Math.round((critDamage.rawMin / defHP) * 100);
                    var critMaxPct = Math.round((critDamage.rawMax / defHP) * 100);
                    movesHtml += '<span class="crit-range">Crit: ' + critDamage.rawMin + '-' + critDamage.rawMax + ' (' + critMinPct + '-' + critMaxPct + '%)</span>';
                }
            } else {
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
            }

            // Multi-hit indicator
            if (moveData && moveData.multihit) {
                var hits = Array.isArray(moveData.multihit) ? moveData.multihit[0] + '-' + moveData.multihit[1] : moveData.multihit;
                movesHtml += '<span class="multihit-badge">' + hits + ' hits</span>';
            }

            // Recoil/Drain small icons
            if (moveData && moveData.recoil) {
                movesHtml += '<span class="move-recoil">⚠️</span>';
            }
            if (moveData && moveData.drain) {
                movesHtml += '<span class="move-drain">💚</span>';
            }

            movesHtml += '</div>';
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
                    var move = new window.calc.Move(gen, moveName, moveOptions);
                    var result = window.calc.calculate(gen, attackerPokemon, defenderPokemon, move, window.createField ? window.createField() : null);
                    var range = CalcIntegration.getDamageRange(result);

                    // Store raw values
                    info.rawMin = range.min;
                    info.rawMax = range.max;
                    info.rawAvg = range.avg;
                    info.rolls = range.rolls || [];

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
                // Handle gen as object or number
                var genNum = (gen && gen.num) ? gen.num : (typeof gen === 'number' ? gen : 8);
                var genObj = window.calc.Generations.get(genNum);
                if (genObj && genObj.moves) {
                    return genObj.moves.get(window.calc.toID(moveName));
                }
            }
        } catch (e) {
            console.error('getMoveData error:', e);
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

        // Status moves
        if (moveData.status) {
            var statusMap = {
                'par': 'Paralyze',
                'slp': 'Sleep',
                'frz': 'Freeze',
                'brn': 'Burn',
                'psn': 'Poison',
                'tox': 'Toxic'
            };
            return statusMap[moveData.status] || moveData.status;
        }

        // Stat changes
        if (moveData.boosts) {
            var boosts = Object.keys(moveData.boosts).map(function (stat) {
                var val = moveData.boosts[stat];
                return (val > 0 ? '+' : '') + val + ' ' + stat.toUpperCase();
            });
            return boosts.join(', ');
        }

        // Self stat changes
        if (moveData.self && moveData.self.boosts) {
            var selfBoosts = Object.keys(moveData.self.boosts).map(function (stat) {
                var val = moveData.self.boosts[stat];
                return (val > 0 ? '+' : '') + val + ' ' + stat.toUpperCase();
            });
            return 'Self: ' + selfBoosts.join(', ');
        }

        // Secondary effects
        if (moveData.secondary) {
            if (moveData.secondary.status) {
                return moveData.secondary.chance + '% ' + moveData.secondary.status.toUpperCase();
            }
            if (moveData.secondary.boosts) {
                return moveData.secondary.chance + '% stat drop';
            }
        }

        // Switch effects
        if (moveData.selfSwitch) return 'Switch Out';
        if (moveData.forceSwitch) return 'Force Switch';

        // Drain/Recoil
        if (moveData.drain) {
            var drainPct = Math.round((moveData.drain[0] / moveData.drain[1]) * 100);
            return 'Drain ' + drainPct + '%';
        }
        if (moveData.recoil) {
            var recoilPct = Math.round((moveData.recoil[0] / moveData.recoil[1]) * 100);
            return 'Recoil ' + recoilPct + '%';
        }

        // Healing
        if (moveData.heal) {
            var healPct = Math.round((moveData.heal[0] / moveData.heal[1]) * 100);
            return 'Heal ' + healPct + '%';
        }

        // Flinch (from secondary)
        if (moveData.secondary && moveData.secondary.volatileStatus === 'flinch') {
            return moveData.secondary.chance + '% Flinch';
        }

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
    function renderSpeedComparison(state, p1ActiveOverride, p2ActiveOverride) {
        var $text = $('#speed-text');

        // Use overrides if provided, otherwise fallback to current state
        var p1Active = p1ActiveOverride || (state.p1 ? state.p1.active : null);
        var p2Active = p2ActiveOverride || (state.p2 ? state.p2.active : null);

        // Get speed comparison - handle both prototype method and manual calculation
        var comparison;
        if (typeof state.getSpeedComparison === 'function' && !p1ActiveOverride && !p2ActiveOverride) {
            comparison = state.getSpeedComparison();
        } else {
            // Manual calculation if method is missing (cloned state) or if overrides are present
            var p1Speed = p1Active ? (p1Active.getEffectiveSpeed ? p1Active.getEffectiveSpeed(state.field) : (p1Active.stats ? p1Active.stats.spe : 100)) : 100;
            var p2Speed = p2Active ? (p2Active.getEffectiveSpeed ? p2Active.getEffectiveSpeed(state.field) : (p2Active.stats ? p2Active.stats.spe : 100)) : 100;

            comparison = {
                p1Speed: p1Speed,
                p2Speed: p2Speed,
                p1First: p1Speed > p2Speed,
                speedTie: p1Speed === p2Speed
            };
        }

        if (comparison.speedTie) {
            $text.html('<span class="speed-tie">Speed Tie! (' + comparison.p1Speed + ')</span>');
        } else if (comparison.p1First) {
            var p1Name = p1Active ? p1Active.name : 'P1';
            $text.html('<span class="speed-p1">' + p1Name + ' moves first</span> <span class="speed-values">(' + comparison.p1Speed + ' vs ' + comparison.p2Speed + ')</span>');
        } else {
            var p2Name = p2Active ? p2Active.name : 'P2';
            $text.html('<span class="speed-p2">' + p2Name + ' moves first</span> <span class="speed-values">(' + comparison.p2Speed + ' vs ' + comparison.p1Speed + ')</span>');
        }

        if (state.field && state.field.trickRoom) {
            $text.append(' <span class="trick-room-badge">Trick Room!</span>');
        }
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
                    'P1 switches to ' + (node.actions.p1.data.targetName || 'Pokemon') :
                    'P1: ' + (node.actions.p1.data.moveName || 'Attack');
                if (node.actions.p1.data.isCrit) p1Desc += ' (Crit)';
                parts.push(p1Desc);
            }
            if (node.actions.p2) {
                var p2Desc = node.actions.p2.type === 'switch' ?
                    'P2 switches to ' + (node.actions.p2.data.targetName || 'Pokemon') :
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

        // Show legend
        if (!$('#inspector-legend').length) {
            $('#inspector-container').append(
                '<div id="inspector-legend" class="inspector-section">' +
                '<h4>Legend</h4>' +
                '<div class="legend-items">' +
                '<span class="legend-item"><span class="tree-ko-marker p2-ko">✓</span> Best Outcome</span>' +
                '<span class="legend-item"><span class="tree-ko-marker p1-ko">✗</span> Worst Outcome</span>' +
                '<div class="legend-divider"></div>' +
                '<span class="legend-item"><span class="legend-swatch match-dmg-1"></span> Guaranteed OHKO</span>' +
                '<span class="legend-item"><span class="legend-swatch match-dmg-2"></span> Possible OHKO</span>' +
                '<span class="legend-item"><span class="legend-swatch match-dmg-3"></span> Risk of KO</span>' +
                '<span class="legend-item"><span class="legend-swatch match-dmg-4"></span> Guaranteed Faint</span>' +
                '<div class="legend-divider"></div>' +
                '<span class="legend-item"><span class="legend-swatch match-dmg-W"></span> Walling Defender (White)</span>' +
                '<span class="legend-item"><span class="legend-swatch match-speed-f"></span> Outspeeds (Blue)</span>' +
                '<span class="legend-item"><span class="legend-swatch match-speed-s"></span> Slower (Gray)</span>' +
                '<span class="legend-item"><span class="legend-swatch match-speed-t"></span> Speed Tie (Purple)</span>' +
                '</div></div>'
            );
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

        // Determine speed order
        var p1Speed = p1.getEffectiveSpeed ? p1.getEffectiveSpeed(state.field) : p1.stats.spe;
        var p2Speed = p2.getEffectiveSpeed ? p2.getEffectiveSpeed(state.field) : p2.stats.spe;

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
    }

    /**
     * Open switch selector for a side (as a turn action)
     */
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
            html += '<div class="item-select-option' + isSelected + '" data-item="' + item + '">' + item + '</div>';
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
            if (!query || item.toLowerCase().includes(query)) {
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
                p1Html = '<span class="turn-switch">🔄 Switch to <strong>' + uiState.p1Action.targetName + '</strong></span>';
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
                p2Html = '<span class="turn-switch">🔄 Switch to <strong>' + uiState.p2Action.targetName + '</strong></span>';
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
     * Apply end-of-turn effects (poison, burn, weather, etc.)
     */
    function applyEndOfTurnEffects(state, gen) {
        var effects = [];

        // Apply to both Pokemon
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon || pokemon.currentHP <= 0) return;

            // Status damage
            if (pokemon.status) {
                var statusDamage = 0;
                var statusName = '';

                switch (pokemon.status.toLowerCase()) {
                    case 'psn':
                    case 'poison':
                        // 1/8 max HP (gen 3+)
                        statusDamage = Math.floor(pokemon.maxHP / 8);
                        statusName = 'Poison';
                        break;
                    case 'tox':
                    case 'toxic':
                        // Toxic increases each turn - simplified to 1/16 * turn counter
                        var toxicCounter = pokemon.toxicCounter || 1;
                        statusDamage = Math.floor(pokemon.maxHP * toxicCounter / 16);
                        pokemon.toxicCounter = Math.min(15, toxicCounter + 1);
                        statusName = 'Toxic';
                        break;
                    case 'brn':
                    case 'burn':
                        // 1/16 max HP (gen 7+) or 1/8 (earlier)
                        statusDamage = gen >= 7 ? Math.floor(pokemon.maxHP / 16) : Math.floor(pokemon.maxHP / 8);
                        statusName = 'Burn';
                        break;
                }

                if (statusDamage > 0) {
                    pokemon.currentHP = Math.max(0, pokemon.currentHP - statusDamage);
                    effects.push(pokemon.name + ' takes ' + statusDamage + ' damage from ' + statusName);
                }
            }
        });

        // Weather damage
        if (state.field && state.field.weather) {
            var weather = state.field.weather.toLowerCase();

            ['p1', 'p2'].forEach(function (side) {
                var pokemon = state[side].active;
                if (!pokemon || pokemon.currentHP <= 0) return;

                var types = pokemon.types || [];
                var isImmune = false;
                var weatherDamage = 0;
                var weatherName = '';

                if (weather === 'sand' || weather === 'sandstorm') {
                    // Ground, Rock, Steel immune
                    isImmune = types.includes('Ground') || types.includes('Rock') || types.includes('Steel');
                    // Magic Guard, Sand Veil, Sand Force, Sand Rush, Overcoat immunities
                    var ability = (pokemon.ability || '').toLowerCase();
                    if (['magicguard', 'sandveil', 'sandforce', 'sandrush', 'overcoat'].includes(ability.replace(/\s/g, ''))) {
                        isImmune = true;
                    }
                    if (!isImmune) {
                        weatherDamage = Math.floor(pokemon.maxHP / 16);
                        weatherName = 'Sandstorm';
                    }
                } else if (weather === 'hail') {
                    // Ice immune
                    isImmune = types.includes('Ice');
                    // Various ability immunities
                    var ability = (pokemon.ability || '').toLowerCase();
                    if (['magicguard', 'icebody', 'snowcloak', 'overcoat', 'slushush'].includes(ability.replace(/\s/g, ''))) {
                        isImmune = true;
                    }
                    if (!isImmune) {
                        weatherDamage = Math.floor(pokemon.maxHP / 16);
                        weatherName = 'Hail';
                    }
                }

                if (weatherDamage > 0) {
                    pokemon.currentHP = Math.max(0, pokemon.currentHP - weatherDamage);
                    effects.push(pokemon.name + ' takes ' + weatherDamage + ' damage from ' + weatherName);
                }
            });
        }

        // Leftovers/Black Sludge healing
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon || pokemon.currentHP <= 0) return;

            var item = (pokemon.item || '').toLowerCase().replace(/\s/g, '');
            var types = pokemon.types || [];

            if (item === 'leftovers') {
                var heal = Math.floor(pokemon.maxHP / 16);
                pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                effects.push(pokemon.name + ' recovers ' + heal + ' HP from Leftovers');
            } else if (item === 'blacksludge') {
                if (types.includes('Poison')) {
                    var heal = Math.floor(pokemon.maxHP / 16);
                    pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                    effects.push(pokemon.name + ' recovers ' + heal + ' HP from Black Sludge');
                } else {
                    var damage = Math.floor(pokemon.maxHP / 8);
                    pokemon.currentHP = Math.max(0, pokemon.currentHP - damage);
                    effects.push(pokemon.name + ' takes ' + damage + ' damage from Black Sludge');
                }
            }
        });

        // Berry consumption (at low HP)
        ['p1', 'p2'].forEach(function (side) {
            var pokemon = state[side].active;
            if (!pokemon || pokemon.currentHP <= 0) return;

            var item = (pokemon.item || '').toLowerCase().replace(/\s/g, '');
            var hpPercent = pokemon.currentHP / pokemon.maxHP;

            // Sitrus Berry: Heals 25% at 50% HP or less
            if (item === 'sitrusberry' && hpPercent <= 0.5) {
                var heal = Math.floor(pokemon.maxHP / 4);
                pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                pokemon.item = ''; // Berry consumed
                effects.push(pokemon.name + ' ate its Sitrus Berry and recovered ' + heal + ' HP');
            }
            // Oran Berry: Heals 10 HP at 50% HP or less (gen 3)
            else if (item === 'oranberry' && hpPercent <= 0.5) {
                var heal = 10;
                pokemon.currentHP = Math.min(pokemon.maxHP, pokemon.currentHP + heal);
                pokemon.item = ''; // Berry consumed
                effects.push(pokemon.name + ' ate its Oran Berry and recovered ' + heal + ' HP');
            }
        });

        return effects;
    }

    var isExecutingTurn = false;

    /**
     * Execute the full turn with both moves
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

        var currentNode = uiState.tree.getCurrentNode();
        if (!currentNode) return;

        var state = currentNode.state;
        var gen = getGenNum();

        // Execute the turn
        try {
            isExecutingTurn = true;
            var newState = currentNode.state.clone();

            var p1IsSwitch = uiState.p1Action.type === 'switch';
            var p2IsSwitch = uiState.p2Action.type === 'switch';

            // Helper to perform a switch
            function performSwitch(side, action, stateObj) {
                var sideData = stateObj[side];
                // Sync current active back to team first
                if (sideData.team && sideData.teamSlot !== undefined && sideData.team[sideData.teamSlot]) {
                    sideData.team[sideData.teamSlot].currentHP = sideData.active.currentHP;
                    sideData.team[sideData.teamSlot].status = sideData.active.status;
                    sideData.team[sideData.teamSlot].boosts = {};
                }
                // Switch in new Pokemon
                sideData.teamSlot = action.targetSlot;
                sideData.active = sideData.team[action.targetSlot].clone();
                // Reset boosts on switch-in
                sideData.active.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
            }

            // Get priorities - switches have priority +6, also check custom priority modifiers
            var p1CustomPriority = uiState.p1Action.customEffects ? (uiState.p1Action.customEffects.priorityMod || 0) : 0;
            var p2CustomPriority = uiState.p2Action.customEffects ? (uiState.p2Action.customEffects.priorityMod || 0) : 0;
            var p1Priority = p1IsSwitch ? 6 : (getMovePriority(uiState.p1Action.moveName) + p1CustomPriority);
            var p2Priority = p2IsSwitch ? 6 : (getMovePriority(uiState.p2Action.moveName) + p2CustomPriority);

            // Determine speed order
            var p1Speed = newState.p1.active.getEffectiveSpeed ? newState.p1.active.getEffectiveSpeed(newState.field) : (newState.p1.active.stats ? newState.p1.active.stats.spe : 100);
            var p2Speed = newState.p2.active.getEffectiveSpeed ? newState.p2.active.getEffectiveSpeed(newState.field) : (newState.p2.active.stats ? newState.p2.active.stats.spe : 100);

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

            // --- Execute first action ---
            if (firstIsSwitch) {
                performSwitch(firstMover, firstAction, newState);
            } else {
                var firstAttacker = newState[firstMover].active;
                var firstDefender = newState[secondMover].active;
                applyMoveToStateEnhanced(firstAttacker, firstDefender, firstAction, gen, newState);

                // NEW: Track both attacker and defender faints
                firstKO = firstDefender.currentHP <= 0;
                var firstAttackerFainted = firstAttacker.currentHP <= 0;

                // NEW: Sync after first move
                syncActiveToTeam(newState);

                // Check for switch-after-move (U-turn, Volt Switch)
                if (firstAttacker.needsSwitchAfterMove && !firstAttackerFainted) {
                    pendingSwitchAfterMove[firstMover] = true;
                    delete firstAttacker.needsSwitchAfterMove;
                }

                // Check for forced switch on target (Roar, Whirlwind)
                if (firstDefender.needsForcedSwitch && !firstKO) {
                    pendingForcedSwitch[secondMover] = true;
                    delete firstDefender.needsForcedSwitch;
                }
            }

            // --- Execute second action (if second mover not KO'd and not forced to switch) ---
            // This is wrapped in a function so we can handle U-turn/Volt Switch switches first
            var executeSecondAction = function (onSecondActionComplete) {
                try {
                    var secondAttacker = newState[secondMover].active;
                    var secondDefender = newState[firstMover].active;
                    var secondAttackerKO = secondAttacker.currentHP <= 0;

                    // Explicitly check for forced switch
                    var secondForcedToSwitch = pendingForcedSwitch[secondMover];

                    if (!secondAttackerKO && !secondForcedToSwitch) {
                        if (secondIsSwitch) {
                            performSwitch(secondMover, secondAction, newState);
                        } else {
                            // Re-get the defender - this now picks up the switched-in Pokemon from U-turn
                            secondDefender = newState[firstMover].active;
                            console.log('Executing second move against:', secondDefender.name, 'HP:', secondDefender.currentHP);
                            applyMoveToStateEnhanced(secondAttacker, secondDefender, secondAction, gen, newState);

                            // secondKO tracks the defender of the second move
                            secondKO = secondDefender.currentHP <= 0;
                            // Check if attacker fainted from recoil too
                            var secondAttackerFainted = secondAttacker.currentHP <= 0;

                            console.log('Second move result - defender KO:', secondKO, 'attacker KO:', secondAttackerFainted);

                            // NEW: Sync after second move
                            syncActiveToTeam(newState);

                            // Check for switch-after-move on second mover
                            if (secondAttacker.needsSwitchAfterMove && !secondAttackerFainted) {
                                pendingSwitchAfterMove[secondMover] = true;
                                delete secondAttacker.needsSwitchAfterMove;
                            }

                            // Check for forced switch on first mover (Roar/Whirlwind)
                            if (secondDefender.needsForcedSwitch && !secondKO) {
                                pendingForcedSwitch[firstMover] = true;
                                delete secondDefender.needsForcedSwitch;
                            }
                        }
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

                function getActionDesc(actionObj, name) {
                    if (!actionObj) return name + ' does nothing';
                    if (actionObj.type === 'switch') {
                        return name + ' switches to ' + actionObj.targetName;
                    } else {
                        return name + ' uses ' + actionObj.moveName;
                    }
                }

                var p1Desc = getActionDesc(uiState.p1Action, p1Name);
                var p2Desc = getActionDesc(uiState.p2Action, p2Name);
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

                var outcome = new BattlePlanner.BattleOutcome(actionDesc, 1.0, 0, {
                    firstMover: firstMover,
                    firstKO: firstKO,
                    secondKO: secondKO,
                    endOfTurnEffects: endOfTurnEffects
                });

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
                    // Apply replacements
                    if (p1Replacement !== null && p1Replacement !== undefined) {
                        newState.p1.teamSlot = p1Replacement;
                        newState.p1.active = newState.p1.team[p1Replacement].clone();
                    }
                    if (p2Replacement !== null && p2Replacement !== undefined) {
                        newState.p2.teamSlot = p2Replacement;
                        newState.p2.active = newState.p2.team[p2Replacement].clone();
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
                    isExecutingTurn = false;
                };

                // Handle KO replacements if needed
                if (needsP1Replacement && needsP2Replacement) {
                    // Both need replacement
                    var p1Title = p1ForcedSwitch ? "Your Pokemon Forced to Switch!" : null;
                    var p2Title = p2ForcedSwitch ? "Opponent Forced to Switch!" : null;

                    showKOReplacementModal('p1', newState, function (p1Rep) {
                        showKOReplacementModal('p2', newState, function (p2Rep) {
                            completeTurn(p1Rep, p2Rep);
                        }, p2Title);
                    }, p1Title);
                } else if (needsP1Replacement) {
                    var p1Title = p1ForcedSwitch ? "Your Pokemon Forced to Switch!" : null;
                    showKOReplacementModal('p1', newState, function (p1Rep) {
                        completeTurn(p1Rep, null);
                    }, p1Title);
                } else if (needsP2Replacement) {
                    var p2Title = p2ForcedSwitch ? "Opponent Forced to Switch!" : null;
                    showKOReplacementModal('p2', newState, function (p2Rep) {
                        completeTurn(null, p2Rep);
                    }, p2Title);
                } else {
                    completeTurn(null, null);
                }
            };

            // Check if first mover needs to switch after their move (U-turn, Volt Switch)
            // This switch happens IMMEDIATELY, before the second mover attacks
            var firstMoverNeedsSwitchNow = pendingSwitchAfterMove[firstMover] && !firstKO && newState[firstMover].active.currentHP > 0;

            if (firstMoverNeedsSwitchNow) {
                // Show switch modal for first mover, then execute second action
                // Use custom title for U-turn/Volt Switch
                var switchTitle = "Select Pokemon to switch to (U-turn/Volt Switch):";
                showKOReplacementModal(firstMover, newState, function (switchChoice) {
                    if (switchChoice !== null && switchChoice !== undefined) {
                        // Execute the switch immediately
                        performSwitch(firstMover, { targetSlot: switchChoice }, newState);
                    }
                    // Clear the pending switch since we handled it
                    pendingSwitchAfterMove[firstMover] = false;

                    // Now execute the second action (opponent attacks the new Pokemon)
                    executeSecondAction(function () {
                        // Continue with the rest of the turn
                        continueTurnAfterActions();
                    });
                }, switchTitle);
                return; // Exit early - continueTurnAfterActions will be called in callback
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
    function applyMoveToStateEnhanced(attacker, defender, action, gen, state) {
        var moveName = action.moveName;
        var isCrit = action.isCrit || false;
        var hits = action.hits || 3;
        var applyEffect = action.applyEffect || false;
        var customEffects = action.customEffects || {};

        try {
            var attackerPokemon = CalcIntegration.snapshotToPokemon(attacker, gen);
            var defenderPokemon = CalcIntegration.snapshotToPokemon(defender, gen);

            if (!attackerPokemon || !defenderPokemon) return;

            var moveOptions = { isCrit: isCrit };
            var moveData = getMoveData(moveName, gen);

            // Handle multi-hit moves
            if (moveData && Array.isArray(moveData.multihit)) {
                moveOptions.hits = hits;
            }

            var move = new window.calc.Move(gen, moveName, moveOptions);
            var field = window.createField ? window.createField() : null;
            var result = window.calc.calculate(gen, attackerPokemon, defenderPokemon, move, field);

            var range = CalcIntegration.getDamageRange(result);
            var avgDamage = range.avg;

            // Check if custom effects override damage
            if (customEffects.noDamage) {
                avgDamage = 0;
            }

            // Check if defender is invulnerable (from their own move like Bounce/Fly)
            if (defender.isInvulnerable) {
                avgDamage = 0;
            }

            // Apply damage
            defender.currentHP = Math.max(0, defender.currentHP - avgDamage);

            // Set invulnerable state for 2-turn moves
            if (customEffects.invulnerable || customEffects.charging) {
                attacker.isInvulnerable = true;
            } else {
                attacker.isInvulnerable = false;
            }

            // Apply effects if toggled
            if (applyEffect && moveData) {
                applyMoveEffects(attacker, defender, moveData, state);
            }

            // Handle recoil
            if (moveData && moveData.recoil) {
                var recoilDamage = Math.floor(avgDamage * moveData.recoil[0] / moveData.recoil[1]);
                attacker.currentHP = Math.max(0, attacker.currentHP - recoilDamage);
            }

            // Handle drain
            if (moveData && moveData.drain) {
                var drainHeal = Math.floor(avgDamage * moveData.drain[0] / moveData.drain[1]);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + drainHeal);
            }

            // Handle healing moves (like Recover, Soft-Boiled, Roost, Synthesis, etc.)
            if (moveData && moveData.heal) {
                // heal is typically [1, 2] for 50% heal
                var healAmount = Math.floor(attacker.maxHP * moveData.heal[0] / moveData.heal[1]);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + healAmount);
            }

            // Special case for moves like Rest
            if (moveName.toLowerCase() === 'rest') {
                attacker.currentHP = attacker.maxHP;
                attacker.status = 'slp'; // Rest puts you to sleep
            }

            // Special case for Wish (would need turn tracking)
            // For now just apply healing immediately if effect is toggled
            if (moveName.toLowerCase() === 'wish' && applyEffect) {
                var wishHeal = Math.floor(attacker.maxHP / 2);
                attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + wishHeal);
            }

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
    }

    /**
     * Apply move effects (status, stat changes, etc.)
     */
    function applyMoveEffects(attacker, defender, moveData, state) {
        // Status effects on defender
        // Pokemon can only have one status condition - don't overwrite existing status
        if (moveData.status && (!defender.status || defender.status === 'Healthy')) {
            defender.status = moveData.status;
        }

        // Stat changes on defender
        if (moveData.boosts) {
            if (!defender.boosts) defender.boosts = {};
            Object.keys(moveData.boosts).forEach(function (stat) {
                defender.boosts[stat] = (defender.boosts[stat] || 0) + moveData.boosts[stat];
                defender.boosts[stat] = Math.max(-6, Math.min(6, defender.boosts[stat]));
            });
        }

        // Self stat changes
        if (moveData.self && moveData.self.boosts) {
            if (!attacker.boosts) attacker.boosts = {};
            Object.keys(moveData.self.boosts).forEach(function (stat) {
                attacker.boosts[stat] = (attacker.boosts[stat] || 0) + moveData.self.boosts[stat];
                attacker.boosts[stat] = Math.max(-6, Math.min(6, attacker.boosts[stat]));
            });
        }

        // Secondary effects (e.g., 30% chance to burn)
        if (moveData.secondary) {
            // Only apply secondary status if defender doesn't already have one
            if (moveData.secondary.status && (!defender.status || defender.status === 'Healthy')) {
                defender.status = moveData.secondary.status;
            }
            if (moveData.secondary.boosts) {
                if (!defender.boosts) defender.boosts = {};
                Object.keys(moveData.secondary.boosts).forEach(function (stat) {
                    defender.boosts[stat] = (defender.boosts[stat] || 0) + moveData.secondary.boosts[stat];
                    defender.boosts[stat] = Math.max(-6, Math.min(6, defender.boosts[stat]));
                });
            }
        }
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

            // Apply recoil if applicable
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

        if (side === 'p1') {
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

    function selectNode(nodeId) {
        uiState.tree.navigate(nodeId);
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
        $('#inspector-collapse').text($inspectorPanel.hasClass('collapsed') ? '▶' : '◀');
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

        // Get current active Pokemon names to exclude from box
        var currentNode = uiState.tree ? uiState.tree.getCurrentNode() : null;
        var activeP1Name = currentNode && currentNode.state.p1.active ? currentNode.state.p1.active.name : null;

        // Update P1 box
        uiState.p1Box = [];
        for (var i = 0; i < importedPokemon.length; i++) {
            var snap = createSnapshotFromImported(importedPokemon[i]);
            if (snap && snap.name !== activeP1Name) {
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
