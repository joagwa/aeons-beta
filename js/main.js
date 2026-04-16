/**
 * Aeons: The Grand Unfolding — Entry Point
 * Bootstraps all game systems in dependency order.
 */

// === Core Imports ===
import { ErrorReporter } from './core/ErrorReporter.js?v=f0dd23a';
import { LogBuffer } from './core/LogBuffer.js?v=f0dd23a';
import { EventBus } from './core/EventBus.js?v=f0dd23a';
import { GameLoop } from './core/GameLoop.js?v=f0dd23a';
import { formatNumber, setNotationMode, getNotationMode } from './core/NumberFormatter.js?v=f0dd23a';
import { SaveSystem } from './core/SaveSystem.js?v=f0dd23a';
import { UpdateChecker } from './core/UpdateChecker.js?v=f0dd23a';

// === Engine Imports ===
import { ResourceManager } from './engine/ResourceManager.js?v=f0dd23a';
import { UpgradeSystem } from './engine/UpgradeSystem.js?v=f0dd23a';
import { MilestoneSystem } from './engine/MilestoneSystem.js?v=f0dd23a';
import { StarManager } from './engine/StarManager.js?v=f0dd23a';
import { EpochSystem } from './engine/EpochSystem.js?v=f0dd23a';
import { MoteController } from './engine/MoteController.js?v=f0dd23a';
import { ProceduralMoteGenerator } from './engine/ProceduralMoteGenerator.js?v=f0dd23a';
import { DarkMatterSystem } from './engine/DarkMatterSystem.js?v=f0dd23a';
import { AutoBuySystem } from './engine/AutoBuySystem.js?v=f0dd23a';
import { FusionEngine } from './engine/FusionEngine.js?v=f0dd23a';
import { MoleculeEngine } from './engine/MoleculeEngine.js?v=f0dd23a';
import { ProtonSynthesisEngine } from './engine/ProtonSynthesisEngine.js?v=f0dd23a';

// === Renderer Imports ===
import { CanvasRenderer } from './renderer/CanvasRenderer.js?v=f0dd23a';

// === UI Imports ===
import { ResourcePanel } from './ui/ResourcePanel.js?v=f0dd23a';
import { UpgradePanel } from './ui/UpgradePanel.js?v=f0dd23a';
import { MilestoneNotification } from './ui/MilestoneNotification.js?v=f0dd23a';
import { ChroniclePanel } from './ui/ChroniclePanel.js?v=f0dd23a';
import { SettingsPanel } from './ui/SettingsPanel.js?v=f0dd23a';
import { OfflineProgress } from './ui/OfflineProgress.js?v=f0dd23a';
import { EpochTransitionOverlay } from './ui/EpochTransitionOverlay.js?v=f0dd23a';
import { ResidualBonusPanel } from './ui/ResidualBonusPanel.js?v=f0dd23a';
import { StatsPanel } from './ui/StatsPanel.js?v=f0dd23a';
import { GoalWidget } from './ui/GoalWidget.js?v=f0dd23a';
import { MobileTabBar } from './ui/MobileTabBar.js?v=f0dd23a';
import { FeedbackPanel } from './ui/FeedbackPanel.js?v=f0dd23a';
import { FusionLabPanel } from './ui/FusionLabPanel.js?v=f0dd23a';
import { PrestigeSystem } from './engine/PrestigeSystem.js?v=f0dd23a';
import { PrestigePanel } from './ui/PrestigePanel.js?v=f0dd23a';
import { NarrativePanel } from './ui/NarrativePanel.js?v=f0dd23a';
import { QuarkEngine } from './engine/QuarkEngine.js?v=f0dd23a';
import { QuarkPanel } from './ui/QuarkPanel.js?v=f0dd23a';
import { SubatomicEngine } from './engine/SubatomicEngine.js?v=f0dd23a';
import { ParticleForgePanel } from './ui/ParticleForgePanel.js?v=f0dd23a';

// === Game State ===
let gameState = {
  epochId: 'epoch1',
  pathChoice: null,
  residualBonuses: [],
  aeonCount: 0,
  prestigeCount: 0,
  collapsedOnce: false,
  collapseInProgress: false,
  collapseCount: 0,
  totalRealTime: 0,
  cosmicEchoCount: 0,
  prestigePurgatory: false, // true when prestige executed but menu still open
  settings: {
    notationMode: 'shortSuffix',
    glowEnabled: true,
  },
};

// === System Instances ===
const resourceManager = new ResourceManager(EventBus);
const upgradeSystem = new UpgradeSystem(EventBus, resourceManager);
const milestoneSystem = new MilestoneSystem(EventBus, resourceManager);
const starManager = new StarManager(EventBus, resourceManager);
const epochSystem = new EpochSystem(EventBus, resourceManager, upgradeSystem, milestoneSystem, starManager, gameState);
const moteController = new MoteController(EventBus);
const proceduralMoteGenerator = new ProceduralMoteGenerator(EventBus);
const darkMatterSystem = new DarkMatterSystem(EventBus, upgradeSystem);

const fusionEngine = new FusionEngine(EventBus, resourceManager);
const moleculeEngine = new MoleculeEngine(EventBus, resourceManager);
const protonSynthesisEngine = new ProtonSynthesisEngine(resourceManager);
protonSynthesisEngine.setUpgradeSystem(upgradeSystem);
fusionEngine.setUpgradeSystem(upgradeSystem);

const prestigeSystem = new PrestigeSystem(EventBus, upgradeSystem, resourceManager);
const quarkEngine = new QuarkEngine(EventBus);
const subatomicEngine = new SubatomicEngine(EventBus, resourceManager, upgradeSystem, quarkEngine);

// Cross-wire systems that need references to each other
resourceManager.setUpgradeSystem(upgradeSystem);
upgradeSystem.setMilestoneSystem(milestoneSystem);
darkMatterSystem.setResourceManager(resourceManager);
darkMatterSystem.setMilestoneSystem(milestoneSystem);
darkMatterSystem.setPrestigeSystem(prestigeSystem);

const saveSystem = new SaveSystem(EventBus, resourceManager, upgradeSystem, milestoneSystem, starManager, epochSystem, gameState, moteController, darkMatterSystem, protonSynthesisEngine, fusionEngine, moleculeEngine, prestigeSystem, quarkEngine, subatomicEngine);

const autoBuySystem = new AutoBuySystem(EventBus, upgradeSystem);

const canvasRenderer = new CanvasRenderer(EventBus);
const resourcePanel = new ResourcePanel(EventBus);
const upgradePanel = new UpgradePanel(EventBus, upgradeSystem);
const milestoneNotification = new MilestoneNotification(EventBus);
const chroniclePanel = new ChroniclePanel(EventBus, milestoneSystem);
const settingsPanel = new SettingsPanel(EventBus, saveSystem, gameState, autoBuySystem);
const offlineProgress = new OfflineProgress(EventBus);
const epochTransitionOverlay = new EpochTransitionOverlay(EventBus, epochSystem);
const residualBonusPanel = new ResidualBonusPanel(EventBus, gameState);
const statsPanel = new StatsPanel(EventBus);
const goalWidget = new GoalWidget(EventBus, milestoneSystem, resourceManager);
const mobileTabBar = new MobileTabBar(EventBus);
const fusionLabPanel = new FusionLabPanel(EventBus, upgradeSystem, protonSynthesisEngine, fusionEngine, moleculeEngine, resourceManager);
const prestigePanel = new PrestigePanel(EventBus, prestigeSystem, moteController);
const quarkPanel = new QuarkPanel(EventBus, quarkEngine);
const particleForgePanel = new ParticleForgePanel(subatomicEngine, resourceManager, EventBus);
const feedbackPanel = new FeedbackPanel(() => ({
  resources: resourceManager.getAll(),
  upgrades:  upgradeSystem.getStates(),
  milestones: milestoneSystem.getStates(),
  totalTime: gameState.totalRealTime,
  version:   document.querySelector('meta[name="game-version"]')?.content,
}));

// === Bootstrap ===
async function bootstrap() {
  // Start error reporter and log buffer immediately so any crash during init is captured.
  new ErrorReporter();
  LogBuffer.install();

  console.debug('[main] Bootstrapping Aeons: The Grand Unfolding');

  // Init canvas
  const mainCanvas = document.getElementById('main-canvas');
  const glowCanvas = document.getElementById('glow-canvas');
  canvasRenderer.init(mainCanvas, glowCanvas);
  canvasRenderer.setMoteController(moteController);
  canvasRenderer.setDarkMatterSystem(darkMatterSystem);

  // Init UI panels
  resourcePanel.setResourceManager(resourceManager);
  resourcePanel.init();
  upgradePanel.init();
  milestoneNotification.init();
  chroniclePanel.init();
  settingsPanel.init();
  offlineProgress.init();
  epochTransitionOverlay.init();
  residualBonusPanel.init();
  statsPanel.init(resourceManager, upgradeSystem, milestoneSystem);
  statsPanel.setEngines(proceduralMoteGenerator, protonSynthesisEngine);
  goalWidget.init();
  mobileTabBar.init();
  feedbackPanel.init();
  fusionLabPanel.init();
  prestigePanel.init();

  // Narrative panel for Epoch Collapse story text
  const narrativePanel = new NarrativePanel(EventBus);
  narrativePanel.init();
  canvasRenderer.setNarrativePanel(narrativePanel);

  // Quark panel (visible after first Epoch Collapse)
  quarkPanel.init();

  // Particle Forge panel (visible after 2nd Epoch Collapse)
  particleForgePanel.init();

  // Wire quark color changes to orbital display
  EventBus.on('quarks:colorChanged', ({ color }) => {
    if (canvasRenderer._orbitalDisplay) {
      canvasRenderer._orbitalDisplay.setQuarkColor(color);
    }
  });

  // --- Particle Storm state (tracks absorption bonus end time) ---
  let _particleStormEndTime = 0;

  // --- Energy Resonance: base generation rate (without resonance applied) ---
  let _baseGenerationRate = 5;

  // --- Particle absorption (Gravitational Pull visual mechanic) ---
  EventBus.on('particle:absorbed', (data) => {
    // Quality-based base value
    const qualityMultipliers = [1.0, 1.5, 2.5, 5, 10];
    const qualityMult = qualityMultipliers[Math.min(data.quality || 0, 4)] || 1.0;
    let energyValue = qualityMult;

    // Apply all absorptionMultiplier upgrades (Quantum Fluctuation, Vacuum Harvesting, etc.)
    for (const { definition: def } of upgradeSystem.getAll()) {
      if (def.effectType === 'absorptionMultiplier') {
        const level = upgradeSystem.getLevel(def.id) || 0;
        if (level > 0) {
          energyValue *= Math.pow(def.effectMagnitude, level);
        }
      }
    }

    const roundedValue = Math.max(1, Math.round(energyValue));

    // Triple energy absorption during Particle Storm
    const stormBonus = (_particleStormEndTime > 0 && Date.now() < _particleStormEndTime) ? 3 : 1;
    resourceManager.add('energy', roundedValue * stormBonus);

    // Floating number at absorption point
    const floatingText = `+${formatNumber(roundedValue * stormBonus)}`;
    canvasRenderer.spawnFloatingNumber(floatingText, data.screenX, data.screenY - 40);
  });

  // --- Milestone reward application ---
  EventBus.on('milestone:triggered', (data) => {
    const rewards = Array.isArray(data.reward)
      ? data.reward
      : data.reward
      ? [data.reward]
      : [];

    for (const reward of rewards) {
      switch (reward.type) {
        case 'resource_grant':
          resourceManager.add(reward.target, reward.amount);
          break;
        case 'unlock_mechanic':
          if (reward.target === 'darkMatter_display') {
            resourceManager.setVisible('darkMatter', true);
          } else if (reward.target === 'darkMatter_generation') {
            // Activate the interactive DarkMatterSystem (nodes in the void) instead of passive generation
            const voidRegion = canvasRenderer.canvasConfig?.regions?.find(r => r.regionId === 'void');
            if (voidRegion) darkMatterSystem.setVoidBounds(voidRegion.worldBounds);
            darkMatterSystem.activate();
          } else if (reward.target === 'hydrogen_display') {
            resourceManager.setVisible('hydrogen', true);
          } else if (reward.target === 'iron_display') {
            resourceManager.setVisible('iron', true);
          } else if (reward.target === 'star_lifecycle') {
            starManager.addStar();
          }
          break;
        case 'cap_increase':
          resourceManager.increaseCap(reward.target, reward.amount);
          break;
        case 'rate_bonus':
          resourceManager.applyRateBonus(reward.target, reward.amount);
          break;
        case 'particle_storm':
          canvasRenderer.activateParticleStorm(30_000);
          _particleStormEndTime = Date.now() + 30_000;
          setTimeout(() => { _particleStormEndTime = 0; }, 30_000);
          break;
        case 'cosmic_echo':
          gameState.cosmicEchoCount = (gameState.cosmicEchoCount || 0) + 1;
          resourceManager.applyCapBonus('energy', 1000);
          break;
      }
    }
  });

  // --- Star milestones ---
  EventBus.on('milestone:triggered', (data) => {
    if (data.milestoneId === 'ms_firstAtom') {
      const massState = resourceManager.get('mass');
      if (massState) {
        resourceManager.add('hydrogen', massState.currentValue * 0.1);
        resourceManager.add('helium', massState.currentValue * 0.025);
      }
    }
    if (data.milestoneId === 'ms_mainSequenceStar') {
      if (starManager.getStates().length === 0) {
        starManager.addStar();
      }
    }
  });

  // --- Upgrade:purchased -> star and mote effects ---
  EventBus.on('upgrade:purchased', (data) => {
    // Movement speed multiplier
    if (data.upgradeId === 'upg_movementSpeed') {
      const level = data.level || 0;
      const mult = Math.pow(1.2, level); // ×1.2 per level
      moteController.setSpeedMultiplier(mult);
    }

    if (data.upgradeId === 'upg_parallelStars') {
      starManager.addStar();
    }
    // Upgrade effects that modify star manager
    if (data.upgradeId === 'upg_rapidCycling') {
      starManager.setDurationMult(0.8);
    }
    if (['upg_starLifeExtension', 'upg_elementalYield', 'upg_hydrogenFusion', 'upg_heliumIgnition'].includes(data.upgradeId)) {
      fusionEngine.recalculateMults(upgradeSystem);
    }

    // Unlock ProtonSynthesisEngine when protonForge is purchased
    if (data.upgradeId === 'upg_protonForge') {
      protonSynthesisEngine.unlock();
      const psePanel = document.getElementById('proton-synthesis-panel');
      if (psePanel) psePanel.classList.remove('hidden');
      syncFusionLabVisibility();
    }
    if (data.upgradeId === 'upg_moteGeneration' || data.upgradeId === 'upg_moteFlood' || data.upgradeId === 'upg_voidSaturation' || data.upgradeId === 'upg_nebularSurge' || data.upgradeId === 'upg_stellarTide') {
      const genLevel     = upgradeSystem.getLevel('upg_moteGeneration') || 0;
      const floodLevel   = upgradeSystem.getLevel('upg_moteFlood')      || 0;
      const satLevel     = upgradeSystem.getLevel('upg_voidSaturation') || 0;
      const nebularLevel = upgradeSystem.getLevel('upg_nebularSurge')   || 0;
      const stellarLevel = upgradeSystem.getLevel('upg_stellarTide')    || 0;
      const combined     = genLevel + floodLevel + satLevel + nebularLevel + stellarLevel;
      const genMag     = upgradeSystem.getEffectMagnitude('upg_moteGeneration') ?? 3.0;
      const floodMag   = upgradeSystem.getEffectMagnitude('upg_moteFlood')      ?? 3.0;
      const satMag     = upgradeSystem.getEffectMagnitude('upg_voidSaturation') ?? 5.0;
      const nebularMag = upgradeSystem.getEffectMagnitude('upg_nebularSurge')   ?? 4.0;
      const stellarMag = upgradeSystem.getEffectMagnitude('upg_stellarTide')    ?? 5.0;
      const rate = 5 * Math.pow(genMag, genLevel) * Math.pow(floodMag, floodLevel) * Math.pow(satMag, satLevel) * Math.pow(nebularMag, nebularLevel) * Math.pow(stellarMag, stellarLevel);
      _baseGenerationRate = rate;
      proceduralMoteGenerator.setGenerationRate(rate);
      // Density grows slowly; quality does the heavy lifting
      const voidCount = Math.min(150, Math.floor(40 + combined * 8));
      if (canvasRenderer.particleSystem) {
        canvasRenderer.particleSystem.spawnInitialParticles('void', voidCount);
        // Burst-spawn attracted particles near tractor beam for immediate collection feedback
        if (data.upgradeId === 'upg_moteGeneration' || data.upgradeId === 'upg_moteFlood' || data.upgradeId === 'upg_voidSaturation') {
          const nearCombined = (upgradeSystem.getLevel('upg_moteGeneration') || 0)
                             + (upgradeSystem.getLevel('upg_moteFlood')      || 0)
                             + (upgradeSystem.getLevel('upg_voidSaturation') || 0);
          const nearCount = Math.min(20, Math.max(5, nearCombined));
          canvasRenderer.particleSystem.spawnWithinAttractionRange('void', nearCount);
        }
        const qualLevel = upgradeSystem.getLevel('upg_moteQuality') || 0;
        const effectiveQuality = Math.min(8, Math.floor(combined / 2) + qualLevel);
        proceduralMoteGenerator.setQualityLevel(effectiveQuality);
        canvasRenderer.particleSystem.setQualityLevel(effectiveQuality);
      }
    }
    if (data.upgradeId === 'upg_moteQuality') {
      const genLevel   = upgradeSystem.getLevel('upg_moteGeneration') || 0;
      const floodLevel = upgradeSystem.getLevel('upg_moteFlood')      || 0;
      const satLevel   = upgradeSystem.getLevel('upg_voidSaturation') || 0;
      const combined   = genLevel + floodLevel + satLevel;
      const qualLevel  = upgradeSystem.getLevel('upg_moteQuality')    || 0;
      const effectiveQuality = Math.min(8, Math.floor(combined / 2) + qualLevel);
      proceduralMoteGenerator.setQualityLevel(effectiveQuality);
      canvasRenderer.particleSystem.setQualityLevel(effectiveQuality);
    }
  });

  // --- Prestige toggle button ---
  {
    const toggleBtn = document.getElementById('prestige-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (prestigePanel.isVisible()) prestigePanel.hide();
        else prestigePanel.show();
        syncPrestigeButtonVisibility();
      });
    }
    const promptBtn = document.getElementById('prestige-prompt-btn');
    if (promptBtn) {
      promptBtn.addEventListener('click', () => {
        prestigePanel.show();
        syncPrestigeButtonVisibility();
      });
    }
    // Re-show prompt when prestige panel closes (user dismissed without prestiging)
    const closeBtn = document.getElementById('prestige-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => syncPrestigeButtonVisibility());
    }
  }

  // --- Show prestige button once energy reaches cap ---
  EventBus.on('resource:updated', (data) => {
    if (data?.resourceId === 'energy') syncPrestigeButtonVisibility();
  });

  // --- Prestige execution → Purgatory ---
  let pendingPrestigeData = null;
  
  EventBus.on('prestige:execute', ({ count, aeonsEarned, aeonTotal, peakEnergy }) => {
    // Store prestige data but don't execute reset yet
    // The reset happens when prestige:purgatory:enter fires
    pendingPrestigeData = { count, aeonsEarned, aeonTotal, peakEnergy };
    console.log(`[Prestige] Prestige executed. Entering purgatory...`);
  });

  EventBus.on('prestige:purgatory:enter', async () => {
    if (!pendingPrestigeData) return;
    const { count, aeonsEarned, aeonTotal, peakEnergy } = pendingPrestigeData;
    
    // Hide center-screen prompt
    const promptEl = document.getElementById('prestige-prompt');
    if (promptEl) promptEl.classList.add('hidden');

    // Update gameState
    gameState.aeonCount = aeonTotal;
    gameState.prestigeCount = count;
    gameState.prestigePurgatory = true;

    // Reset movement and renderer gravity state BEFORE loadEpoch
    moteController.resetForPrestige();
    canvasRenderer.resetForPrestige();

    // Full reset of in-run systems
    resourceManager.reset();
    upgradeSystem.reset();
    milestoneSystem.reset();
    starManager.reset();
    fusionEngine.reset();
    moleculeEngine.reset();
    darkMatterSystem.reset();
    protonSynthesisEngine.reset();

    // Reload epoch data
    await epochSystem.loadEpoch('epoch1');

    // Reposition player to new epoch home object
    const homeObj = canvasRenderer.canvasConfig?.homeObject;
    if (homeObj) {
      moteController.worldX = homeObj.worldX;
      moteController.worldY = homeObj.worldY;
    }

    // Apply prestige run bonuses (cap, seed energy, free upgrades, rate multipliers, movement unlock)
    prestigeSystem.applyRunBonuses(resourceManager, upgradeSystem, moteController, peakEnergy);

    // Spawn DM nodes for visual flavor
    const voidRegion = canvasRenderer.canvasConfig?.regions?.find(r => r.regionId === 'void');
    if (voidRegion) darkMatterSystem.setVoidBounds(voidRegion.worldBounds);
    darkMatterSystem.activate();
    const params = darkMatterSystem._getParams();
    for (let i = 0; i < 10; i++) {
      darkMatterSystem._spawnNode(params);
    }

    // Sync UI after reset (but keep prestige menu open!)
    syncFusionLabVisibility();
    syncPrestigeButtonVisibility();

    console.log(`[Prestige] Purgatory entered. Run ${count} reset. +${aeonsEarned} Aeons (total: ${aeonTotal}). Waiting for menu close...`);
  });

  EventBus.on('prestige:purgatory:exit', () => {
    gameState.prestigePurgatory = false;
    // Unblock input and allow new run to begin
    moteController.unblockAllInput();
    pendingPrestigeData = null;
    console.log(`[Prestige] Purgatory exited. New run begins!`);
  });

  // --- Epoch Collapse complete (narrative [Continue] clicked) ---
  EventBus.on('collapse:complete', () => {
    gameState.collapseCount = (gameState.collapseCount || 0) + 1;
    const collapseNum = gameState.collapseCount;
    console.log(`[EpochCollapse] Collapse #${collapseNum} complete — awarding Epoch Echo`);

    // Mark as collapsed (backward compat)
    gameState.collapsedOnce = true;
    gameState.cosmicEchoCount = (gameState.cosmicEchoCount || 0) + 1;

    // Award Epoch Echo in prestige system
    prestigeSystem.awardEpochEcho();

    if (collapseNum === 1) {
      // 1st Collapse: unlock quarks + reveal synthesis chain
      prestigeSystem.purchaseUpgrade('prs_quarkSight');
      quarkEngine.unlock();
      upgradeSystem.setHidden('upg_protonForge', false);
      upgradeSystem.setHidden('upg_quantumNucleogenesis', false);
    } else if (collapseNum === 2) {
      // 2nd Collapse: auto-grant the full echo chain then unlock subatomic
      // Force-grant any missing prerequisites so Deep Structure can be purchased
      for (const echoId of ['prs_quarkSight', 'prs_chromaticField', 'prs_flavourResonance', 'prs_deepStructure']) {
        if (prestigeSystem.getLevel(echoId) < 1) {
          prestigeSystem.forceGrantUpgrade(echoId);
        }
      }
      subatomicEngine.unlock();
      particleForgePanel.show();
      // Switch orbital display to subatomic mode
      if (canvasRenderer._orbitalDisplay) {
        canvasRenderer._orbitalDisplay.setMode('subatomic');
      }
    }

    // Reset collapse animation state
    canvasRenderer.resetCollapse();
    gameState.collapseInProgress = false;

    // Trigger prestige reset — the prestige:execute handler does the full reset
    prestigeSystem.executePrestige();

    console.log(`[EpochCollapse] Post-collapse prestige complete. Echoes: ${gameState.cosmicEchoCount}`);
  });


  EventBus.on('settings:changed', (data) => {
    if (data.key === 'notationMode') {
      setNotationMode(data.value);
      gameState.settings.notationMode = data.value;
    }
    if (data.key === 'glowEnabled') {
      gameState.settings.glowEnabled = data.value;
      canvasRenderer.setGlowEnabled(data.value);
    }
  });

  // --- Fusion element reveal ---
  EventBus.on('fusion:element:first', ({ element }) => {
    resourceManager.setVisible(element, true);
  });

  // --- Molecule synthesis reveal ---
  EventBus.on('molecule:first', ({ molId }) => {
    resourceManager.setVisible(molId, true);
  });

  // --- Epoch transition ---
  EventBus.on('epoch:transition:complete', (data) => {
    if (data.canvasConfig) {
      canvasRenderer.loadEpochConfig(data.canvasConfig);
      // Set mote controller bounds from canvas config
      moteController.setBounds(data.canvasConfig.universeWidth, data.canvasConfig.universeHeight);
      // Restrict procedural mote generation to defined regions
      if (typeof proceduralMoteGenerator.setValidRegions === 'function') {
        proceduralMoteGenerator.setValidRegions(data.canvasConfig.regions);
      }
    } else {
      canvasRenderer.onEpochChange(data.epochId);
    }
  });

  // --- Register game loop tick callbacks ---

  // --- Proton Synthesis slider wiring ---
  const pseSlider = document.getElementById('proton-synthesis-slider');
  const psePct = document.getElementById('proton-synthesis-pct');
  if (pseSlider) {
    pseSlider.addEventListener('input', () => {
      const val = parseInt(pseSlider.value, 10) / 100;
      protonSynthesisEngine.setSliderFraction(val);
      if (psePct) psePct.textContent = `${Math.round(val * 100)}%`;
    });
    if (psePct) psePct.textContent = `${pseSlider.value}%`;
  }

  GameLoop.onTick((dt) => {
    // Skip game progression when in prestige purgatory
    // (Rendering continues via onFrame, so canvas still animates)
    if (gameState.prestigePurgatory) {
      return;
    }

    resourceManager.tick(dt);
    milestoneSystem.check();
    starManager.tick(dt);
    fusionEngine.tick(dt);
    moleculeEngine.tick(dt);
    protonSynthesisEngine.tick(dt);
    prestigeSystem.trackPeakEnergy();

    // --- Aeon Automaton: auto-purchase Phase 1 energy upgrades ---
    if (prestigeSystem.getLevel('prs_aeonAutomaton') >= 1 && !gameState.collapseInProgress && gameState.collapseCount < 1) {
      // Only in energy phase, before first collapse
      const energy = resourceManager.get('energy')?.currentValue ?? 0;
      if (energy > 0) {
        // Find the best Phase 1 energy upgrade to auto-purchase
        const phase1Upgrades = [
          'upg_moteGeneration',
          'upg_clickAmplifier',
          'upg_energyHarvesting',
          'upg_moteQuality',
          'upg_moteFlood',
          'upg_voidSaturation',
          'upg_gravitationalPull',
        ];
        
        // Score each upgrade: prefer rate multipliers and lower costs
        let bestUpgrade = null;
        let bestScore = -Infinity;
        
        for (const upgradeId of phase1Upgrades) {
          const def = upgradeSystem.getDefinition(upgradeId);
          if (!def) continue;
          
          const level = upgradeSystem.getLevel(upgradeId) || 0;
          if (level >= def.maxLevel) continue; // Already maxed
          
          const cost = upgradeSystem.getCost(upgradeId, level + 1);
          if (energy < cost) continue; // Can't afford
          
          // Prefer upgrades with rate multiplier effects
          const isRateMult = def.effect?.type === 'rateMultiplier' ? 2 : 1;
          // Prefer lower cost upgrades (easier progression)
          const costScore = 100 / (cost + 1);
          const score = isRateMult * costScore;
          
          if (score > bestScore) {
            bestScore = score;
            bestUpgrade = upgradeId;
          }
        }
        
        if (bestUpgrade && gameState._aeonAutomatonTick === undefined) {
          gameState._aeonAutomatonTick = 0;
        }
        
        // Throttle: only auto-purchase every 10 ticks to avoid spam
        if (gameState._aeonAutomatonTick !== undefined) {
          gameState._aeonAutomatonTick++;
          if (gameState._aeonAutomatonTick >= 10 && bestUpgrade) {
            upgradeSystem.purchase(bestUpgrade);
            gameState._aeonAutomatonTick = 0;
          }
        }
      }
    } else if (gameState._aeonAutomatonTick !== undefined && (gameState.collapseInProgress || gameState.collapseCount >= 1)) {
      // Reset throttle when leaving energy phase
      gameState._aeonAutomatonTick = undefined;
    }

    quarkEngine.tick(resourceManager.get('energy')?.currentValue ?? 0);
    subatomicEngine.tick(dt);
    if (subatomicEngine.isUnlocked()) {
      particleForgePanel.refresh();
      // Update orbital display with subatomic counts
      const od = canvasRenderer._orbitalDisplay;
      if (od && od.getMode() === 'subatomic') {
        od.setSubatomicCounts(
          Math.floor(resourceManager.get('proton')?.currentValue ?? 0),
          Math.floor(resourceManager.get('neutron')?.currentValue ?? 0),
          Math.floor(resourceManager.get('electron')?.currentValue ?? 0),
        );
      }
    }
    gameState.totalRealTime += dt;

    // --- Energy Resonance: dynamic mote genesis & attraction multiplier ---
    {
      const resonanceLevel = upgradeSystem.getLevel('upg_clickAmplifier') || 0;
      const SOFT_CAP = 200;
      const mag = upgradeSystem.getEffectMagnitude('upg_clickAmplifier') ?? 0.25;
      const energy = resonanceLevel > 0 ? (resourceManager.get('energy')?.currentValue ?? 0) : 0;
      const resonanceMult = resonanceLevel > 0
        ? 1 + resonanceLevel * mag * (energy / (energy + SOFT_CAP))
        : 1;
      // Subatomic bonuses: proton boosts energy rate, electron boosts attract radius
      const subBonuses = subatomicEngine.getPassiveBonuses();
      const energyRateMult = resonanceMult * (1 + subBonuses.energyRateBonus);
      const attractMult = resonanceMult * (1 + subBonuses.attractRadiusBonus);
      proceduralMoteGenerator.setGenerationRate(_baseGenerationRate * energyRateMult);
      canvasRenderer.setResonanceMult(attractMult);
    }

    // --- Dark matter node update ---
    if (darkMatterSystem.active) {
      const ho = canvasRenderer.canvasConfig?.homeObject;
      if (ho) {
        const collected = darkMatterSystem.update(dt, ho.worldX, ho.worldY);
        for (const node of collected) {
          resourceManager.add('darkMatter', node.value);
          EventBus.emit('darkMatter:collected', { value: node.value });
          const label = node.value >= 10
            ? `+${formatNumber(Math.round(node.value))} DM`
            : `+${node.value.toFixed(2)} DM`;
          const { sx, sy } = canvasRenderer.camera?.worldToScreen(node.x, node.y) ?? { sx: 0, sy: 0 };
          canvasRenderer.spawnFloatingNumber(label, sx, sy - 12);
        }
      }
    }

    // --- Epoch Collapse trigger: auto-fire when energy reaches absoluteCap ---
    // 1st collapse: collapseCount 0 → 1 (unlocks quarks)
    // 2nd collapse: collapseCount 1 → 2 (unlocks subatomic, requires quark + Deep Structure)
    if (!gameState.collapseInProgress && gameState.collapseCount < 2) {
      const energyRes = resourceManager.get('energy');
      const energyDef = resourceManager.getDefinition('energy');
      if (energyRes && energyRes.currentValue >= (energyDef?.absoluteCap ?? Infinity)) {
        gameState.collapseInProgress = true;
        canvasRenderer.startEpochCollapse();
      }
    }

    // --- Auto-buy (dev mode only) ---
    if (window.AEONS_AUTO_BUY) {
      for (const { definition: def } of upgradeSystem.getAll()) {
        if (upgradeSystem.canPurchase(def.id)) {
          upgradeSystem.purchase(def.id);
        }
      }
    }
  });

  // Camera centering is handled in CanvasRenderer.onFrame() — no lerp needed

  // --- Register render frame callback (mote movement runs here for 60fps smoothness) ---
  let _lastFrameTs = null;
  GameLoop.onFrame((ts) => {
    if (_lastFrameTs !== null) {
      const realDt = Math.min((ts - _lastFrameTs) / 1000, 0.1);
      moteController.tick(realDt);
    }
    _lastFrameTs = ts;
    canvasRenderer.onFrame(ts);
  });

  // Handle breaking save reset (major update incompatibility)
  EventBus.on('save:breaking_reset', () => {
    const modal = document.getElementById('reset-notice-modal');
    if (!modal) return;
    modal.innerHTML = '';
    modal.classList.remove('hidden');

    const content = document.createElement('div');
    content.className = 'modal-content offline-modal-content';

    const heading = document.createElement('h2');
    heading.textContent = '⚡ New Era — Progress Reset';
    content.appendChild(heading);

    const body = document.createElement('p');
    body.style.cssText = 'margin: 12px 0; line-height: 1.6; color: var(--text-secondary, #aaa);';
    body.innerHTML =
      'A major update has arrived — <strong style="color:#c8a0ff">Elemental Fusion</strong>. ' +
      'The universe now tracks individual elements: Hydrogen, Helium, Carbon, Oxygen, and Iron. ' +
      '<br><br>This changes the core resource system in a way that is incompatible with your previous save. ' +
      'Your progress has been reset so you can experience the new mechanics from the start.' +
      '<br><br>The cosmos awaits — may your next run go further.';
    content.appendChild(body);

    const btn = document.createElement('button');
    btn.className = 'offline-dismiss';
    btn.textContent = 'Begin Again';
    btn.addEventListener('click', () => modal.classList.add('hidden'));
    content.appendChild(btn);

    modal.appendChild(content);
  });

  // --- Attempt load or fresh start ---
  let localStorageAvailable = true;
  try {
    localStorage.setItem('__aeons_test', '1');
    localStorage.removeItem('__aeons_test');
  } catch (e) {
    localStorageAvailable = false;
  }

  if (!localStorageAvailable) {
    showBanner('save-error-banner', '⚠ Progress cannot be saved in this browser mode.', 'warning');
  }

  const loaded = await saveSystem.load();
  console.log(`[Bootstrap] Save loaded: ${loaded}`);
  if (!loaded) {
    await epochSystem.loadEpoch('epoch1');
    console.log('[Bootstrap] Fresh epoch1 loaded');
  }

  // Restore dark matter system if ms_gasCloud was already triggered in the save
  {
    const dmState = milestoneSystem.getStates();
    if (dmState['ms_gasCloud']?.triggered) {
      const voidRegion = canvasRenderer.canvasConfig?.regions?.find(r => r.regionId === 'void');
      if (voidRegion) darkMatterSystem.setVoidBounds(voidRegion.worldBounds);
      darkMatterSystem.activate();
      // Also restore the renderer's dark matter visual layer, which is normally
      // activated via milestone:triggered but is not re-emitted on load.
      canvasRenderer.setDarkMatterActive(true);
    }
  }

  // Sync FusionEngine star stages from loaded save
  fusionEngine.syncFromStarManager(starManager.getStates());

  // If Cosmic Drift was already purchased, stop the background drift immediately
  if (upgradeSystem.getLevel('upg_cosmicDrift') > 0) {
    canvasRenderer.stopBackgroundDrift();
  }

  // Initialise mote controller with home object position from canvas config
  {
    const ho = canvasRenderer.canvasConfig?.homeObject;
    // If a save was loaded, preserve the already-restored position (init() would overwrite it)
    const initX = loaded ? moteController.worldX : (ho?.worldX ?? 2000);
    const initY = loaded ? moteController.worldY : (ho?.worldY ?? 2500);
    console.log(`[Bootstrap] MoteController init at (${initX}, ${initY})`);
    moteController.init(initX, initY, mainCanvas);
    if (canvasRenderer.canvasConfig) {
      moteController.setBounds(
        canvasRenderer.canvasConfig.universeWidth,
        canvasRenderer.canvasConfig.universeHeight
      );
      // Restrict procedural mote generation to defined regions
      if (typeof proceduralMoteGenerator.setValidRegions === 'function') {
        proceduralMoteGenerator.setValidRegions(canvasRenderer.canvasConfig.regions);
      }
      // Source auto-drift bounds from the void region so drift stays in the right area
      const voidRegion = canvasRenderer.canvasConfig.regions.find(r => r.regionId === 'void');
      if (voidRegion) {
        moteController.setDriftBounds(
          voidRegion.worldBounds.x, voidRegion.worldBounds.y,
          voidRegion.worldBounds.w, voidRegion.worldBounds.h
        );
      }
    }
  }

  // Apply saved settings
  setNotationMode(gameState.settings.notationMode);

  // Restore proton synthesis slider if unlocked from save
  if (protonSynthesisEngine.isUnlocked()) {
    const psePanel = document.getElementById('proton-synthesis-panel');
    if (psePanel) psePanel.classList.remove('hidden');
    const pseSliderEl = document.getElementById('proton-synthesis-slider');
    if (pseSliderEl) {
      const savedFrac = protonSynthesisEngine.getSliderFraction();
      pseSliderEl.value = Math.round(savedFrac * 100);
      const psePctEl = document.getElementById('proton-synthesis-pct');
      if (psePctEl) psePctEl.textContent = `${Math.round(savedFrac * 100)}%`;
    }
  }

  // Apply persistent prestige bonuses after load (cap, rate multipliers — no re-seeding)
  if (prestigeSystem.getCount() > 0) {
    prestigeSystem.applyPersistentBonuses(resourceManager);
  }

  // Restore subatomic UI state on load
  if (subatomicEngine.isUnlocked()) {
    particleForgePanel.show();
    if (canvasRenderer._orbitalDisplay) {
      canvasRenderer._orbitalDisplay.setMode('subatomic');
    }
  }

  // Restore quark panel visibility if quarks are unlocked
  if (quarkEngine.isUnlocked()) {
    quarkPanel.show?.();
  }

  // Restore synthesis upgrade visibility after 1st collapse
  if (gameState.collapseCount >= 1) {
    upgradeSystem.setHidden('upg_protonForge', false);
    upgradeSystem.setHidden('upg_quantumNucleogenesis', false);
  }

  // Show Fusion Lab panel if protonForge was already purchased
  syncFusionLabVisibility();
  syncPrestigeButtonVisibility();

  // Dev mode: boost initial resources for faster iteration
  if (window.AEONS_DEBUG) {
    resourceManager.add('energy', 50);    // 50 initial energy
  }

  // Default glow off on mobile
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isMobile && gameState.settings.glowEnabled === undefined) {
    gameState.settings.glowEnabled = false;
  }
  canvasRenderer.setGlowEnabled(gameState.settings.glowEnabled);

  // Start systems
  if (localStorageAvailable) {
    saveSystem.startAutoSave();
  }
  GameLoop.start();

  // --- Update Checker ---
  const gameVersion = document.querySelector('meta[name="game-version"]')?.content || 'dev';
  const updateChecker = new UpdateChecker(EventBus, gameVersion);
  EventBus.on('update:available', (data) => {
    showUpdateBanner(data.newVersion);
  });
  updateChecker.start();

  // Tab conflict detection
  if (localStorageAvailable) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'aeons_save_v1' && e.newValue !== null) {
        showBanner('tab-conflict-banner', '⚠ The game is open in another tab. Saving here may overwrite that session\'s progress.', 'warning');
      }
    });
  }

  // Debug mode
  if (window.AEONS_DEBUG) {
    window.aeons = {
      gameLoop: GameLoop,
      resourceManager,
      upgradeSystem,
      milestoneSystem,
      starManager,
      fusionEngine,
      moleculeEngine,
      epochSystem,
      saveSystem,
      canvasRenderer,
      moteController,
      proceduralMoteGenerator,
      darkMatterSystem,
      protonSynthesisEngine,
      prestigeSystem,
      quarkEngine,
      subatomicEngine,
      eventBus: EventBus,
      gameState,
    };
  }

  console.debug('[main] Bootstrap complete');
}

function showBanner(id, message, type) {
  const banner = document.getElementById(id);
  if (!banner) return;
  banner.className = `banner ${type}`;
  banner.innerHTML = `<span>${message}</span><button class="dismiss-btn" onclick="this.parentElement.classList.add('hidden')">Dismiss</button>`;
  banner.classList.remove('hidden');
}

function syncPrestigeButtonVisibility() {
  const toggleBtn = document.getElementById('prestige-toggle');
  const promptEl  = document.getElementById('prestige-prompt');

  // Hide everything during Epoch Collapse animation
  if (gameState.collapseInProgress) {
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (promptEl)  promptEl.classList.add('hidden');
    return;
  }

  // Toolbar button: visible once player has ever prestiged or can prestige now
  const energy = resourceManager.get('energy');
  const hasPrestiged = prestigeSystem.getCount() > 0;
  const canPrestige = prestigeSystem.canPrestige();
  if (toggleBtn) toggleBtn.style.display = (hasPrestiged || canPrestige) ? '' : 'none';

  // Center-screen prompt: only show when prestige is available AND panel is not already open
  if (promptEl) {
    const panelOpen = !document.getElementById('prestige-overlay')?.classList.contains('hidden');
    if (canPrestige && !panelOpen) {
      promptEl.classList.remove('hidden');
    } else {
      promptEl.classList.add('hidden');
    }
  }
}

function syncFusionLabVisibility() {
  const protonPurchased = upgradeSystem.getLevel('upg_protonForge') >= 1;
  const panel = document.getElementById('fusion-lab-panel');
  const btn   = document.getElementById('fusion-lab-toggle');
  if (panel) panel.classList.toggle('hidden', !protonPurchased);
  if (btn)   btn.style.display = protonPurchased ? '' : 'none';
}

function showUpdateBanner(newVersion) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.className = 'banner info';
  banner.innerHTML = `
    <span>🔄 A new version of Aeons is available!</span>
    <button class="refresh-btn" onclick="window.location.reload()">Refresh Now</button>
    <button class="dismiss-btn" onclick="this.parentElement.classList.add('hidden')">Later</button>
  `;
  banner.classList.remove('hidden');
}

// --- DOM Ready ---
document.addEventListener('DOMContentLoaded', bootstrap);
