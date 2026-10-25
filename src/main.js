/* ==========================================================================
 * 测试版 · 橙色 —— 交互控制层
 * ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var canvas = $('#board');
  var game = null;
  var R = null;
  var mode = 'idle';
  /* 侧栏、底栏折叠状态（记忆在 localStorage） */
  var panelsHidden = { left: false, right: false, bottom: false };
  try {
    var savedPanels = JSON.parse(localStorage.getItem('dsh-panels') || 'null');
    if (savedPanels) panelsHidden = savedPanels;
  } catch (e) {}

  (function panelsFromUrl() {
    var m = /panels=([a-z,]+)/.exec(location.search || '');
    if (!m) return;
    m[1].split(',').forEach(function (w) {
      if (w === 'left' || w === 'right' || w === 'bottom') panelsHidden[w] = true;
    });
  })();

  // 触屏 / 窄屏：默认收起左右面板，把战场让出来
  (function mobileDefaults() {
    window.__mobileInit = true;
    var narrow = window.innerWidth <= 900;
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    var fromUrl = /panels=/.test(location.search || '');
    if (narrow && !fromUrl) {
      panelsHidden.left = true;
      panelsHidden.right = true;
    }
    document.documentElement.classList.toggle('is-mobile', touch && narrow);
  })();

  window.__mobileResize = true;

  /** 手机竖屏 → 旋转画面当作横屏用；桌面永远不转 */
  function applyOrientation() {
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var narrow = Math.min(window.innerWidth, window.innerHeight) <= 1000;
    var portrait = window.innerHeight > window.innerWidth;
    var want = (touch || coarse) && narrow && portrait;
    if (/force-landscape/.test(location.search || '')) want = true;   // force-landscape 调试
    if (/no-rotate/.test(location.search || '')) want = false;
    var now = document.documentElement.classList.contains('force-landscape');
    if (want !== now) {
      document.documentElement.classList.toggle('force-landscape', want);
      setTimeout(function () { if (R && R.resize) R.resize(); }, 80);
      setTimeout(function () { if (R && R.resize) R.resize(); }, 350);
    }
  }
  window.addEventListener('resize', applyOrientation);
  setTimeout(function () {
    applyOrientation();
    if (R && R.resize) R.resize();
  }, 120);

  window.addEventListener('orientationchange', function () {
    setTimeout(function () {
      applyOrientation();
      if (R && R.resize) R.resize();
      applyPanels();
    }, 300);
  });

  function applyPanels() {
    var hud = document.getElementById('hud');
    if (!hud) return;
    ['left', 'right', 'bottom'].forEach(function (w) {
      hud.classList.toggle('hide-' + w, !!panelsHidden[w]);
    });
    var lb = document.getElementById('tab-left');
    var rb2 = document.getElementById('tab-right');
    var bb = document.getElementById('tab-bottom');
    if (lb) { lb.textContent = panelsHidden.left ? '▶' : '◀'; lb.title = (panelsHidden.left ? '展开' : '收起') + '左栏（[）'; }
    if (rb2) { rb2.textContent = panelsHidden.right ? '◀' : '▶'; rb2.title = (panelsHidden.right ? '展开' : '收起') + '右栏（]）'; }
    if (bb) { bb.textContent = panelsHidden.bottom ? '▲' : '▼'; bb.title = (panelsHidden.bottom ? '展开' : '收起') + '行动栏（H）'; }
  }

  function togglePanel(which) {
    panelsHidden[which] = !panelsHidden[which];
    applyPanels();
    try { localStorage.setItem('dsh-panels', JSON.stringify(panelsHidden)); } catch (e) {}
  }

  var selectedId = null;
  var deployPickId = null;
  var rioterCfg = { swaps: 0, picks: [] };
  var pendingThrow = null;
  var loadout = {};                    // { 单位key: [武器id...] }
  var equipment = {};                  // { 'officer#3': [装备id...] }
  var POOL_OF = {
    sheriff: 'police-leader', officer: 'police', shieldman: 'police', marksman: 'police',
    boss: 'rioter-leader', thug: 'rioter', gunner: 'rioter', looter: 'rioter'
  };
  function poolWeapons(key) {
    var pool = POOL_OF[key];
    return Object.keys(DATA.WEAPONS).filter(function (w) {
      var wp = DATA.WEAPONS[w];
      return wp.pool === pool && (wp.type === 'ranged' || wp.type === 'melee' || wp.type === 'shield');
    });
  }
  var pendingDice = null;
  var actionLock = false;
  var vsAI = false;
  var humanSide = 'police';
  var aiSide = 'rioters';

  /* ------------------------------------------------------------ 屏幕 */
  function showScreen(id) {
    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    var s = $('#scr-' + id);
    if (s) s.classList.add('active');
    var battle = (id === 'battle');
    $('#hud').classList.toggle('hidden', !battle);
    if (!battle) hideDeployBanner();
  }

  $$('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () {
      var go = b.getAttribute('data-go');
      if (go === 'roster') { showScreen('roster'); renderRoster(); }
      else if (go === 'brief') { showScreen('brief'); }
      else showScreen(go);
    });
  });

  // 对局模式 / 节奏 / 执哪一方
  $$('#mode-toggle .mt-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.hasAttribute('data-ai-level')) return;   // 难度按钮走自己的处理器，别混进模式组
      var group = b.hasAttribute('data-pace') ? '[data-pace]'
        : b.hasAttribute('data-human') ? '[data-human]' : '[data-mode]';
      $$('#mode-toggle ' + group).forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      if (b.hasAttribute('data-pace')) {
        DATA.CONFIG.PACE = parseFloat(b.getAttribute('data-pace'));
      } else if (b.hasAttribute('data-human')) {
        humanSide = b.getAttribute('data-human');
        aiSide = humanSide === 'police' ? 'rioters' : 'police';
      } else {
        vsAI = b.getAttribute('data-mode') === 'ai';
        syncAiLevelUI();
      }
    });
  });

  var aiLevel = 'veteran';
  function syncAiLevelUI() {
    ['rookie', 'veteran', 'ruthless'].forEach(function (k) {
      var b = document.getElementById('ai-lv-' + k);
      if (b) b.hidden = !vsAI;
    });
    var lb = document.getElementById('ai-level-label');
    if (lb) lb.hidden = !vsAI;
  }
  $$('#mode-toggle [data-ai-level]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#mode-toggle [data-ai-level]').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      aiLevel = b.getAttribute('data-ai-level');
      if (window.AI && AI.setLevel) AI.setLevel(aiLevel);
    });
  });

  // 启动参数：?vs=ai&level=ruthless&human=rioters（方便直接开一局人机）
  (function presetFromUrl() {
    var q = {};
    (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      var a = kv.split('=');
      if (a[0]) q[a[0]] = decodeURIComponent(a[1] || '');
    });
    if (q.vs === 'ai') vsAI = true;
    if (q.human === 'rioters' || q.human === 'police') {
      humanSide = q.human;
      aiSide = humanSide === 'police' ? 'rioters' : 'police';
    }
    if (q.level && ['rookie', 'veteran', 'ruthless'].indexOf(q.level) >= 0) aiLevel = q.level;
    if (window.AI && AI.setLevel) AI.setLevel(aiLevel);
    // 同步按钮选中态
    $$('#mode-toggle [data-mode]').forEach(function (b) {
      b.classList.toggle('on', (b.getAttribute('data-mode') === 'ai') === vsAI);
    });
    $$('#mode-toggle [data-human]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-human') === humanSide);
    });
    $$('#mode-toggle [data-ai-level]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-ai-level') === aiLevel);
    });
    syncAiLevelUI();
  })();

  /* --------------------------------------------------------- 装备选择 */
  var teamQuota = { police: 13, rioters: 18 };
  function equipPoolFor(side) {
    return Object.keys(DATA.EQUIP).filter(function (id) {
      var E = DATA.EQUIP[id];
      return E.side === 'both' || E.side === side;
    });
  }
  function countThrows(side) {
    var n = 0;
    Object.keys(equipment).forEach(function (k) {
      if (k.indexOf(side === 'police' ? 'officer#' : 'thug#') !== 0 &&
          k.indexOf(side === 'police' ? 'sheriff#' : 'boss#') !== 0) return;
      (equipment[k] || []).forEach(function (id) {
        var E = DATA.EQUIP[id];
        if (E && E.cat === 'throwable') n++;
      });
    });
    return n;
  }
  function openEquipPicker(key, side) {
    var pool = equipPoolFor(side);
    var cur = (equipment[key] || []).slice();
    var html = '<div class="combat-lines" style="font-size:12px;line-height:1.6">' +
      '投掷物每人最多 <b>3</b> 件；常驻装备每人 <b>1</b> 件；全队投掷物不得超过 <b>' + teamQuota[side] +
      '</b>（当前 ' + countThrows(side) + '）。</div><div class="equip-grid">';
    pool.forEach(function (id) {
      var E = DATA.EQUIP[id];
      var on = cur.indexOf(id) >= 0;
      html += '<label class="equip-item' + (on ? ' on' : '') + '" data-eq="' + id + '">' +
        '<input type="checkbox"' + (on ? ' checked' : '') + '>' +
        '<b>' + E.name + '</b><span>' + E.desc + '</span>' +
        '<i class="tag">' + (E.cat === 'throwable' ? '投掷' : E.cat) + ' · 强度 ' + E.power +
        (E.limit ? ' · 限 ' + E.limit : '') + '</i></label>';
    });
    html += '</div>';
    showModal('装备：' + key, html, function () { renderRoster(); }, '完成');
    $$('#dice-body .equip-item').forEach(function (lab) {
      lab.onclick = function (ev) {
        ev.preventDefault();
        var id = lab.getAttribute('data-eq');
        var E = DATA.EQUIP[id];
        var list = equipment[key] || [];
        var at = list.indexOf(id);
        if (at >= 0) { list.splice(at, 1); }
        else {
          if (E.cat === 'throwable') {
            var mine = list.filter(function (x) { return DATA.EQUIP[x].cat === 'throwable'; }).length;
            if (mine >= 3) { toast('每名特工最多带 3 件投掷物'); return; }
            if (countThrows(side) >= teamQuota[side]) { toast('全队投掷物已达上限（' + teamQuota[side] + '）'); return; }
          } else {
            var gearN = list.filter(function (x) { return DATA.EQUIP[x].cat !== 'throwable'; }).length;
            if (gearN >= 1) { toast('每名特工只能带 1 件常驻装备（投掷物不受限）'); return; }
            if (E.limit) {
              var used = 0;
              Object.keys(equipment).forEach(function (k2) {
                if (k2 === key) return;
                if ((equipment[k2] || []).indexOf(id) >= 0) used++;
              });
              if (used >= E.limit) { toast('「' + E.name + '」全队最多 ' + E.limit + ' 件'); return; }
            }
          }
          list.push(id);
        }
        equipment[key] = list;
        closeModal();
        openEquipPicker(key, side);
        renderRoster();
      };
    });
  }

  /* 每类单位：主武器 + 近战 各选一把（唯一武器全场限 1） */
  var UNIQUE_TAKEN = {};
  function weaponOptions(pool, type, cur, key) {
    return Object.keys(DATA.WEAPONS).filter(function (id) {
      var w = DATA.WEAPONS[id];
      return w.pool === pool && w.type === type && (w.type !== 'gear');
    }).map(function (id) {
      var w = DATA.WEAPONS[id];
      var used = w.unique && UNIQUE_TAKEN[id] && UNIQUE_TAKEN[id] !== key;
      var label = w.name + '（' + (w.type === 'melee' ? 'A' + w.attacks + ' ' + w.hit + '+' : 'A' + w.attacks + ' ' + w.hit + '+ ' + w.dmg + '/' + w.crit + ' ' + w.range + '"') + '）';
      return '<option value="' + id + '"' + (id === cur ? ' selected' : '') + (used ? ' disabled' : '') +
        '>' + label + (w.unique ? ' ★唯一' : '') + '</option>';
    }).join('');
  }

  function weaponPicker(t) {
    var li = document.createElement('li');
    li.className = 'wpick';
    var pool = POOL_OF[t.key] || 'police';
    var lo = loadout[t.key] || {};
    var primary = lo.primary || (t.weapons.filter(function (w) {
      return DATA.WEAPONS[w] && DATA.WEAPONS[w].type === 'ranged';
    })[0] || '');
    var melee = lo.melee || (t.weapons.filter(function (w) {
      return DATA.WEAPONS[w] && DATA.WEAPONS[w].type === 'melee';
    })[0] || '');
    if (DATA.WEAPONS[primary] && DATA.WEAPONS[primary].unique) UNIQUE_TAKEN[primary] = t.key;
    if (DATA.WEAPONS[melee] && DATA.WEAPONS[melee].unique) UNIQUE_TAKEN[melee] = t.key;

    li.innerHTML = '<span class="st">主武器</span>' +
      '<select data-key="' + t.key + '" data-slot="primary">' + weaponOptions(pool, 'ranged', primary, t.key) + '</select>' +
      '<span class="st" style="margin-left:8px">近战</span>' +
      '<select data-key="' + t.key + '" data-slot="melee">' + weaponOptions(pool, 'melee', melee, t.key) + '</select>';

    li.querySelectorAll('select').forEach(function (sel) {
      sel.onchange = function () {
        var key = sel.getAttribute('data-key');
        var slot = sel.getAttribute('data-slot');
        var cur = loadout[key] || {};
        cur[slot] = sel.value;
        loadout[key] = cur;
        UNIQUE_TAKEN = {};
        renderRoster();
      };
    });
    return li;
  }

  /* ------------------------------------------------------------ 存档 */
  var SAVE_KEY = 'czone.save.v1';

  function saveNow() {
    try {
      if (!game || !game.hasSaveableState || !game.hasSaveableState()) return;
      var data = game.serialize();
      data.savedAt = Date.now();
      data.loadout = loadout;
      data.equipment = equipment;
      data.mode = { hotseat: hotseat, vsAI: vsAI, aiSide: aiSide, humanSide: humanSide, level: AI.getLevel() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (err) { /* 存档失败不影响游戏 */ }
  }

  function loadSaveRaw() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function hasSave() { return !!loadSaveRaw(); }

  setInterval(function () { try { saveNow(); } catch (e) {} }, 15000);

  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }

  function continueGame() {
    var save = loadSaveRaw();
    if (!save) { toast('没有存档'); return; }
    if (save.loadout) loadout = save.loadout;
    if (save.equipment) equipment = save.equipment;
    if (save.mode) {
      hotseat = save.mode.hotseat; vsAI = save.mode.vsAI;
      aiSide = save.mode.aiSide; humanSide = save.mode.humanSide;
      if (save.mode.level) AI.setLevel(save.mode.level);
    }
    game = ENGINE.createGame({ seed: save.seed || 1 });
    var r = game.restore(save);
    if (!r.ok) { toast(r.error); return; }
    showScreen('battle');
    R.build3D && R.build3D();
    updateHUD(); R.draw();
    closeModal();
    if (vsAI && game.state.actingSide === aiSide) maybeAITurn();
  }

  /* ------------------------------------------------------------ 编成 */
  function syncCounts() {
    var pc = document.getElementById('police-count');
    var rc = document.getElementById('rioter-count');
    var pn = DATA.FACTIONS.police.units.reduce(function (n, u) { return n + (u.count || 1); }, 0);
    var rn = DATA.FACTIONS.rioters.units.reduce(function (n, u) { return n + (u.count || 1); }, 0);
    if (pc) pc.textContent = pn;
    if (rc) rc.textContent = rn;
    var title = document.getElementById('title-counts');
    if (title) title.textContent = '警方 ' + pn + ' 人 vs 暴匪 ' + rn + ' 人';
  }

  function renderRoster() {
    var host = { police: document.getElementById('police-list'), rioters: document.getElementById('rioter-list') };
    ['police', 'rioters'].forEach(function (sid) {
      var fac = DATA.FACTIONS[sid];
      var ul = host[sid];
      ul.innerHTML = '';
      fac.units.forEach(function (t) {
        var count = t.count || 1;
        var pool = POOL_OF[t.key] || (sid === 'police' ? 'police' : 'rioter');
        for (var k = 0; k < count; k++) {
          var key = t.key + '#' + k;
          var lo = loadout[key] || {};
          var primary = lo.primary || (t.weapons.filter(function (w) {
            return DATA.WEAPONS[w] && DATA.WEAPONS[w].type === 'ranged';
          })[0] || '');
          var melee = lo.melee || (t.weapons.filter(function (w) {
            return DATA.WEAPONS[w] && DATA.WEAPONS[w].type === 'melee';
          })[0] || '');
          var li = document.createElement('li');
          li.className = 'unit-row';
          li.innerHTML = '<span class="cnt">' + (k + 1) + '</span>' +
            '<span class="nm">' + t.name + '</span>' +
            '<span class="wp"><select data-key="' + key + '" data-slot="primary">' +
            weaponOptions(pool, 'ranged', primary, key) + '</select>' +
            '<select data-key="' + key + '" data-slot="melee">' +
            weaponOptions(pool, 'melee', melee, key) + '</select>' +
            '<button class="equip-btn" data-eq="' + key + '">装备 ' +
            (equipment[key] || []).length + '</button></span>';
          ul.appendChild(li);
          var eqBtn = li.querySelector('.equip-btn');
          if (eqBtn) eqBtn.onclick = function (ev) {
            ev.stopPropagation();
            openEquipPicker(key, sid);
          };
          li.querySelectorAll('select').forEach(function (sel) {
            sel.onchange = function () {
              var kk = sel.getAttribute('data-key');
              var slot = sel.getAttribute('data-slot');
              var cur = loadout[kk] || {};
              cur[slot] = sel.value;
              loadout[kk] = cur;
              renderRoster();
            };
          });
        }
      });
    });
    syncCounts();

    // 换装行
    var rows = document.getElementById('swap-rows');
    rows.innerHTML = '';
    ((DATA.FACTIONS.rioters.trade || {}).options || []).forEach(function (opt) {
      var row = document.createElement('div');
      row.className = 'swap-row' + (rioterCfg.picks.indexOf(opt.id) >= 0 ? ' on' : '');
      row.innerHTML = '<span class="box">' + (rioterCfg.picks.indexOf(opt.id) >= 0 ? '✓' : '') + '</span>' +
        '<span class="nm">' + opt.name + '</span>';
      row.title = opt.desc;
      row.addEventListener('click', function () {
        var i = rioterCfg.picks.indexOf(opt.id);
        if (i >= 0) rioterCfg.picks.splice(i, 1);
        else {
          if (rioterCfg.picks.length >= 4) { toast('最多只能换装 4 次'); return; }
          rioterCfg.picks.push(opt.id);
        }
        rioterCfg.swaps = rioterCfg.picks.length;
        renderRoster();
      });
      rows.appendChild(row);
    });

    $('#rioter-count').textContent = DATA.FACTIONS.rioters.units.reduce(function (n, u) { return n + (u.count || 1); }, 0) - rioterCfg.swaps;
    $('#swap-count').textContent = rioterCfg.swaps;
    $('#police-count').textContent = DATA.FACTIONS.police.units.reduce(function (n, u) { return n + (u.count || 1); }, 0);
  }

  /* ------------------------------------------------------------ 开局 */
  window.__afterTutorial = function () {
    // 教程结束后留在战场，正常继续这一局
    try { showScreen('battle'); updateHUD(); if (R && R.draw) R.draw(); } catch (e) {}
  };

  window.__dbg = function () {
    return { game: game, tut: window.TUTORIAL, R: R };
  };

  window.__tutSetAI = function () {
    vsAI = true;
    aiSide = 'rioters';
    humanSide = 'police';
  };

  function startTutorial() {
    // 走和正式对局完全相同的路径，保证渲染器与点击都正常
    startGame();
    autoDeploy();
    if (game.choosePrimary) {
      try { game.choosePrimary('police', 'critical'); } catch (e) {}
      try { game.choosePrimary('rioters', 'kill'); } catch (e) {}
    }
    closeModal();
    TUTORIAL.attach(game);
  }

  function startGame() {
    clearSave();
    if (vsAI && DATA.autoEquip) {
      var auto = DATA.autoEquip(aiSide, aiSide === 'police' ? 13 : 18);
      Object.keys(auto).forEach(function (k) { equipment[k] = auto[k]; });
    }
    game = ENGINE.createGame({ seed: Date.now() % 100000, loadout: loadout, equip: equipment, rioters: {
      swaps: rioterCfg.swaps, picks: rioterCfg.picks.slice()
    } });
    game.setup();
    R = null;
    try {
      if (window.THREE && window.RENDER3D && window.RENDER3D.create) {
        R = RENDER3D.create(canvas, game);
      }
    } catch (e) {
      console.warn('3D 初始化失败，退回 2D 渲染', e);
      R = null;
    }
    if (!R) R = RENDER.create(canvas, game);
    R.view.showZones = true;
    R.resize();
    bindCanvas();
    showScreen('battle');
    enterDeploy();
    updateHUD();
  }

  /* ------------------------------------------------------------ 部署 */
  function enterDeploy() {
    mode = 'deploy';
    deployPickId = null;
    R.view.showZones = true;
    R.view.mode = 'idle';
    R.view.ghost = null;
    R.draw();
    renderDeployUI();
  }

  function renderDeployUI() {
    var side = game.state.deploy.side;
    var remain = game.state.deploy.remaining[side];
    var list = game.state.units.filter(function (u) { return u.side === side && !u.deployed; });
    var stillValid = list.some(function (u) { return u.id === deployPickId; });
    if (!stillValid) deployPickId = list.length ? list[0].id : null;
    updateHUD();
    var bar = $('#action-bar');
    var info = $('#active-info');
    info.innerHTML = '<b>' + (side === 'police' ? '警方' : '暴匪') + ' 部署</b> · 剩余 ' + remain +
      ' 名 · 先在左侧点选要部署的单位，再点击集结区落点';
    if (deployPickId) {
      var pu = game.unit(deployPickId);
      if (pu) info.innerHTML += '（当前：<b>' + pu.name + '</b>）';
    }
    var acts = $('#actions');
    acts.innerHTML = '';
    var btn = document.createElement('button');
    btn.className = 'act-btn danger';
    btn.innerHTML = '自动部署<span class="cost">一键铺开</span>';
    btn.onclick = autoDeploy;
    acts.appendChild(btn);
    showDeployBanner(side, remain);
    renderRosterPanel();
    if (vsAI && side === aiSide) maybeAIDeploy();
  }

  function autoDeploy() {
    var guard = 0;
    while (game.state.phase === 'deploy' && guard++ < 60) {
      var side = game.state.deploy.side;
      if (vsAI && side === aiSide) break;      // 电脑那边让它自己铺
      var u = game.state.units.filter(function (x) { return x.side === side && !x.deployed; })[0];
      if (!u) break;
      var spot = game.findDeploySpot(u);
      if (!spot || !game.deployUnit(u.id, spot.x, spot.y).ok) break;
    }
    if (game.state.phase === 'battle') {
      hideDeployBanner();
      mode = 'idle';
      R.view.showZones = false;
      logFlash('部署完成，战斗开始。');
      updateHUD();
      R.draw();
      promptPrimary();
      maybeAITurn();
    } else {
      renderDeployUI();
      R.draw();
    }
  }

  function showDeployBanner(side, remain) {
    hideDeployBanner();
    var b = document.createElement('div');
    b.className = 'deploy-banner';
    b.id = 'deploy-banner';
    b.innerHTML = '<b>' + (side === 'police' ? '警方' : '暴匪') + '</b> 部署中 · 还剩 ' + remain + ' 名' +
      '<div style="font-size:11px;color:#8b97a6;margin-top:4px;font-family:monospace">阵地：' +
      (side === 'police' ? '西侧' : '东侧') + '集结区 · 点击模型后点地图放置</div>';
    $('#app').appendChild(b);
  }
  function hideDeployBanner() {
    var b = $('#deploy-banner');
    if (b) b.remove();
  }

  /* ------------------------------------------------------------ 交互 */
  function humanLocked() {
    return !!(game && game.state.phase === 'battle' && aiControls(game.state.actingSide));
  }

  function pickUnitClient(e) {
    if (R.pickUnitAt) {
      var id = R.pickUnitAt(e.clientX, e.clientY);
      return id ? game.unit(id) : null;
    }
    var p = R.inv(e.clientX, e.clientY);
    return R.pickUnit(p.x, p.y);
  }

  var downAt = null;
  function bindCanvas() {
    canvas.addEventListener('pointerdown', function (e) {
      downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    canvas.addEventListener('mousemove', function (e) {
      var p = R.inv(e.clientX, e.clientY);
      R.view.hoverPos = p;
      var u = pickUnitClient(e);
      R.view.hoverUnitId = u ? u.id : null;
      if (game.state.phase === 'deploy') {
        var cu = game.unit(deployPickId);
        R.view.ghost = { x: p.x, y: p.y, valid: cu ? game.canPlace(cu, p.x, p.y) : false };
        R.draw();
        return;
      }
      if (mode === 'move' || mode === 'charge' || mode === 'dash' || mode === 'fallback') {
        var act = game.unit(game.state.activeId);
        if (act) {
          var cost = Math.ceil(Math.hypot(p.x - act.pos.x, p.y - act.pos.y));
          var budget = mode === 'dash' ? Math.round(DATA.CONFIG.DASH_DISTANCE * DATA.CONFIG.PACE)
            : mode === 'charge' ? act.move + Math.round(DATA.CONFIG.CHARGE_BONUS * DATA.CONFIG.PACE) : act.move;
          R.view.previewValid = cost <= budget && game.canPlace(act, p.x, p.y);
        }
      }
      R.draw();
    });
    canvas.addEventListener('mouseleave', function () {
      R.view.hoverUnitId = null;
      R.view.hoverPos = null;
      R.view.ghost = null;
      R.draw();
    });
    canvas.addEventListener('click', function (e) {
      if (humanLocked()) return;             // 电脑回合：不接受地图操作
      // 拖拽旋转视角时不要触发行动
      if (downAt) {
        var moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        if (moved > 8) { downAt = null; return; }
      }
      downAt = null;
      var p = R.inv(e.clientX, e.clientY);
      onClick(p, e);
    });
  }

  function onClick(p, e) {
    if (game.state.phase === 'deploy') return onDeployClick(p);
    if (game.state.phase === 'end') return;
    var active = game.unit(game.state.activeId);
    var hit = e ? pickUnitClient(e) : R.pickUnit(p.x, p.y);
    var mk = R.pickMarker(p.x, p.y);

    if (mode === 'move' || mode === 'dash' || mode === 'fallback') {
      if (!active) return;
      var res = game.doMove(active.id, mode, [{ x: p.x, y: p.y }]);
      if (res && res.ok && window.TUTORIAL) TUTORIAL.notify(mode === 'dash' ? 'dash' : 'move');
      if (!res.ok) { toast(res.error); return; }
      finishAction();
      return;
    }
    if (mode === 'charge') {
      if (!active || !hit || hit.side === active.side) { toast('选择一个敌方目标'); return; }
      // 目标若在哨戒，会先冲刺躲开；躲完可能已经不在冲锋范围内
      var sentryRes = game.trySentry ? game.trySentry(hit.id, active.pos) : null;
      if (sentryRes && sentryRes.ok && sentryRes.dashed) {
        R.draw();
        var spot2 = findChargeSpot(active, hit);
        if (!spot2) { toast('目标已经脱离冲锋范围'); return; }
        var r2b = game.doMove(active.id, 'charge', [spot2]);
        if (!r2b.ok) { toast(r2b.error); return; }
        mode = 'idle'; R.view.mode = 'idle';
        finishAction();
        return;
      }
      var spot = findChargeSpot(active, hit);
      if (!spot) { toast('没有可落脚的位置'); return; }
      var r2 = game.doMove(active.id, 'charge', [spot]);
      if (!r2.ok) { toast(r2.error); return; }
      mode = 'idle'; R.view.mode = 'idle';
      var dist = Math.hypot(hit.pos.x - spot.x, hit.pos.y - spot.y);
      if (dist <= 1) toast('冲锋成功，可以对目标发动近战');
      finishAction();
      return;
    }
    if (mode === 'drone') {
      if (!active || !hit || hit.side === active.side) { toast('选择一名敌方目标'); return; }
      var dres = active.droneShot && active.droneUsedTP !== game.state.tp
        ? game.useDroneShot(active.id, hit.id)
        : game.useDroneScout(active.id, hit.id);
      if (!dres.ok) { toast(dres.error); return; }
      mode = 'idle'; R.view.mode = 'idle';
      showDiceResult('无人机 · ' + (dres.hits != null ? '攻击' : '侦察'), { ok: true, lines: dres.lines || ['目标已被标定。'] });
      updateHUD(); R.draw();
      return;
    }
    if (mode === 'throw') {
      if (!active) { toast('没有激活的单位'); return; }
      // 点到敌人 → 以它为目标；点到空地 → 以落点为中心
      var aim = null;
      if (hit && hit.side !== active.side) aim = hit.id;
      else {
        var gp = R.inv ? R.inv(e.clientX, e.clientY) : null;
        if (!gp) { toast('选择投掷点'); return; }
        aim = { x: gp.x, y: gp.y };
      }
      var tr = game.throwGear(active.id, pendingThrow, aim);
      if (tr && tr.ok && window.TUTORIAL) TUTORIAL.notify('throw');
      if (!tr.ok) { toast(tr.error); return; }
      mode = 'idle'; R.view.mode = 'idle'; pendingThrow = null;
      showDiceResult('投掷 · ' + DATA.EQUIP[tr.equipment].name, { lines: tr.lines, ok: true });
      updateHUD(); R.draw();
      return;
    }
    if (mode === 'shoot') {
      if (!active || !hit || hit.side === active.side) { toast('选择一个敌方目标'); return; }
      doShoot(active, hit);
      return;
    }
    if (mode === 'fight') {
      if (!active || !hit || hit.side === active.side) { toast('选择一个敌方目标'); return; }
      doFight(active, hit);
      return;
    }
    if (mode === 'pick') {
      if (!mk) { toast('点击要拾取的标识'); return; }
      var r3 = game.pickUp(active.id, mk.id);
      if (!r3.ok) { toast(r3.error); return; }
      finishAction();
      return;
    }
    if (mode === 'place') {
      if (!active) return;
      var r4 = game.placeMarker(active.id, p.x, p.y);
      if (!r4.ok) { toast(r4.error); return; }
      finishAction();
      return;
    }

    // 选择
    if (hit) selectUnit(hit.id);
    else { selectedId = null; R.view.selectedId = null; updateHUD(); }
  }

  /** 部署阶段：选中某个待部署单位 */
  function pickDeployUnit(id) {
    if (game.state.phase !== 'deploy') return;
    var side = game.state.deploy.side;
    var u = game.unit(id);
    if (!u || u.side !== side || u.deployed) { toast('只能选择本回合待部署的己方单位'); return; }
    deployPickId = id;
    selectedId = id;
    R.view.selectedId = id;
    var rows = document.querySelectorAll('.roster-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('picked', rows[i].getAttribute('data-uid') === id);
    }
    var info = $('#active-info');
    if (info) {
      info.innerHTML = '<b>' + (side === 'police' ? '警方' : '暴匪') + ' 部署</b> · 已选 <b>' + u.name +
        '</b> · 在集结区内点击落点（也可以按「自动部署」）';
    }
    R.draw();
  }

  function onDeployClick(p) {
    var side = game.state.deploy.side;
    if (vsAI && side === aiSide) return;      // 电脑部署回合，别抢它的手
    var avail = game.state.units.filter(function (x) { return x.side === side && !x.deployed; });
    if (!avail.length) return;
    if (!avail.some(function (x) { return x.id === deployPickId; })) {
      deployPickId = avail[0].id;             // 选中项已失效（换边/已放好）就重选
    }
    var res = game.deployUnit(deployPickId, p.x, p.y);
    if (!res.ok) { toast(res.error); return; }
    // 自动指向下一个待部署单位（仍可随时手动改选）
    var nextList = game.state.units.filter(function (x) { return x.side === side && !x.deployed; });
    deployPickId = nextList.length ? nextList[0].id : null;
    if (game.state.phase === 'battle') {
      hideDeployBanner();
      mode = 'idle';
      R.view.showZones = false;
      logFlash('部署完成，战斗开始。');
      promptPrimary();
      maybeAITurn();
    } else {
      renderDeployUI();
    }
    updateHUD();
    R.draw();
  }

  function findChargeSpot(active, target) {
    var best = null, bestCost = 1e9;
    for (var a = 0; a < 24; a++) {
      var ang = (a / 24) * Math.PI * 2;
      for (var rr = 0.9; rr <= 1.0; rr += 0.05) {
        var x = target.pos.x + Math.cos(ang) * rr;
        var y = target.pos.y + Math.sin(ang) * rr;
        if (!game.canPlace(active, x, y, { forCharge: true })) continue;
        var cost = game.pathCost(active, [{ x: x, y: y }]);
        if (cost <= active.move + Math.round(DATA.CONFIG.CHARGE_BONUS * DATA.CONFIG.PACE) && cost < bestCost) {
          var blocked = game.blockReason(active, active.pos, { x: x, y: y }, { ignoreEnemies: true });
          if (!blocked) { bestCost = cost; best = { x: x, y: y }; }
        }
      }
    }
    return best;
  }

  function selectUnit(id) {
    selectedId = id;
    R.view.selectedId = id;
    var u = game.unit(id);
    if (u && u.side === game.state.actingSide && u.state === 'ready' && !game.state.activeId) {
      // 点击己方就绪特工 → 弹出激活命令选择
      openActivate(u);
      return;
    }
    updateHUD();
    R.draw();
  }

  function openActivate(u) {
    var order = u.order || 'conceal';
    showModal('选择命令 · ' + u.name,
      '<div class="dice-row"><div class="dice-label">当前命令：' + (order === 'engage' ? '交战' : '隐匿') + '</div>' +
      '<div class="combat-lines" style="font-size:12.5px;line-height:1.7">' +
      '<b>交战</b>：可以射击、冲锋、反应。<br>' +
      '<b>隐匿</b>：不能射击/冲锋/反应，但有掩护时不是有效目标。</div></div>' +
      '<div class="actions" style="margin-top:12px">' +
      '<button class="act-btn" id="pick-engage">交战命令<span class="cost">EXPOSE</span></button>' +
      '<button class="act-btn" id="pick-conceal">隐匿命令<span class="cost">HIDE</span></button>' +
      '</div>',
      null);
    $('#pick-engage').onclick = function () { closeModal(); activate(u, 'engage'); };
    $('#pick-conceal').onclick = function () { closeModal(); activate(u, 'conceal'); };
  }

  function activate(u, order) {
    var res = game.activate(u.id, order);
    if (!res.ok) { toast(res.error); return; }
    selectedId = u.id;
    R.view.selectedId = u.id;
    mode = 'idle';
    R.view.mode = 'idle';
    updateHUD();
    R.draw();
  }

  /* ------------------------------------------------------------ 战斗行动 */
  function finishAction() {
    saveNow();
    mode = 'idle';
    R.view.mode = 'idle';
    if (game.state.reacting) {
      game.endActivation();
      postAction(false);
      return;
    }
    updateHUD();
    R.draw();
  }

  /* 反应：挑一名待机交战特工 */
  function openReactionPicker(side) {
    var list = game.state.units.filter(function (u) {
      return u.alive && u.side === side && u.state === 'spent' &&
        u.order === 'engage' && !u.reactedThisTP;
    });
    if (!list.length) { toast('没有可反应的特工（需要待机 + 交战命令）'); return; }
    var html = '<div class="combat-lines" style="font-size:12.5px;line-height:1.7">' +
      '选择一名<b>待机</b>且<b>交战命令</b>的特工，免费执行 1 个行动（移动最多 2"）。每名特工每转折点一次。</div>' +
      '<div class="actions" style="margin-top:12px;flex-wrap:wrap">';
    list.forEach(function (u) {
      html += '<button class="act-btn" data-rid="' + u.id + '">' + u.name +
        '<span class="cost">' + (u.role || '') + '</span></button>';
    });
    html += '</div>';
    showModal('选择反应特工', html, null);
    $$('#dice-body .act-btn').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-rid');
        closeModal();
        var r = game.beginReaction(id);
        if (!r.ok) { toast(r.error); return; }
        selectedId = id;
        R.view.selectedId = id;
        updateHUD();
        R.draw();
      };
    });
  }

  /* 目标在哨戒时问一句要不要冲刺（不强制） */
  function askSentry(target, threatPos, then) {
    if (!game.guardThreat || !game.guardThreat(target.id)) { then(); return; }
    if (aiControls(target.side)) {
      var lv = (window.AI && AI.getLevel) ? AI.getLevel() : 'veteran';
      if (lv !== 'rookie' || Math.random() < 0.5) game.sentryDash(target.id, threatPos);
      updateHUD(); R.draw();
      then();
      return;
    }
    askModal('你的「' + target.name + '」可以哨戒',
      '被敌方锁定。是否花预留的 1 行动点先冲刺 3" 躲开？',
      '冲刺', function () {
        game.sentryDash(target.id, threatPos);
        updateHUD(); R.draw();
        then();
      },
      '不动', function () { then(); });
  }

  function doShoot(attacker, target) {
    var w = attacker.weapons.map(function (id) { return DATA.WEAPONS[id]; })
      .filter(function (x) { return x && x.type === 'ranged'; })[0];
    if (!w) { toast('没有远程武器'); return; }
    if (game.guardThreat && game.guardThreat(target.id)) {
      askSentry(target, attacker.pos, function () { doShootNow(attacker, target, w); });
      return;
    }
    doShootNow(attacker, target, w);
  }

  function doShootNow(attacker, target, w) {
    mode = 'idle'; R.view.mode = 'idle';
    var pending = game.beginShoot(attacker.id, target.id, w.id);
    if (!pending.ok) { toast(pending.error); return; }
    // 双方都能自主决策时才让玩家决定重掷；AI 一律不花 CP
    var humanCanReroll = !aiControls(attacker.side) || !aiControls(target.side);
    if (!humanCanReroll) {
      var res = game.finishShoot(pending);
      showDiceResult('射击 · ' + w.name, res);
      updateHUD(); R.draw();
      return;
    }
    showCombatPending(pending, w);
  }

  /* 掷骰后、结算前的面板：可以花 1CP 指挥重掷 */
  var shotPending = false;
  function showCombatPending(p, w) {
    shotPending = true;
    var a = game.unit(p.attacker), t = game.unit(p.target);
    function chip(d, i, who, clickable) {
      var cls = 'die ';
      if (d.v === 1) cls += 'fail';
      else if (d.v >= (who === 'defense' ? 6 : p.attackLethal)) cls += 'crit';
      else if (d.v >= (who === 'defense' ? p.defenseNeed : p.attackNeed)) cls += 'success';
      else cls += 'fail';
      if (clickable) cls += ' clickable';
      return '<div class="' + cls + '" data-who="' + who + '" data-i="' + i + '">' + d.v + '</div>';
    }
    var atkClick = !aiControls(a.side) && game.state.sides[a.side].cp > 0;
    var defClick = !aiControls(t.side) && game.state.sides[t.side].cp > 0;

    var body = '<div class="dice-row"><div class="dice-label">攻击骰 · ' + p.info.dist.toFixed(1) + '"' +
      (p.info.cover ? ' · 有掩护' : '') + (p.info.obscured ? ' · 遮挡' : '') +
      (p.info.precision ? ' · 精准' + p.info.precision : '') +
      ' · 需 ' + p.attackNeed + '+（6 关键）</div><div class="dice-pool">';
    p.attackDice.forEach(function (d, i) { body += chip(d, i, 'attack', atkClick); });
    body += '</div></div>';

    body += '<div class="dice-row"><div class="dice-label">防御骰 · 需 ' + p.defenseNeed + '+（6 关键）' +
      (p.coverSave ? ' · 掩护豁免 1 个普通成功' : '') + '</div><div class="dice-pool">';
    if (p.defenseDice.length === 0) body += '<span style="color:#8b97a6;font-size:12px">（无防御骰）</span>';
    p.defenseDice.forEach(function (d, i) { body += chip(d, i, 'defense', defClick); });
    body += '</div></div>';

    var cpRow = '警方 CP ' + game.state.sides.police.cp + ' · 暴匪 CP ' + game.state.sides.rioters.cp;
    body += '<div class="dice-label" style="margin-top:6px">指挥重掷：点一枚骰子，花 1CP 重掷一次 · ' + cpRow + '</div>';
    body += '<div class="combat-lines">' + p.lines.slice(-4).map(function (l) {
      return '<div>' + escapeHtml(l) + '</div>';
    }).join('') + '</div>';

    showModal('射击 · ' + w.name, body, function () {
      shotPending = false;
      var res = game.finishShoot(p);
      showDiceResult('射击结算 · ' + w.name, res);
      updateHUD(); R.draw();
    }, '结算射击');

    $$('#dice-body .die.clickable').forEach(function (el) {
      el.onclick = function () {
        var who = el.getAttribute('data-who');
        var i = parseInt(el.getAttribute('data-i'), 10);
        var r = game.rerollDie(p, who, i);
        if (!r.ok) { toast(r.error); return; }
        updateHUD();
        showCombatPending(p, w);
      };
    });
  }

  function doFight(attacker, target) {
    if (game.guardThreat && game.guardThreat(target.id)) {
      askSentry(target, attacker.pos, function () { doFightNow(attacker, target); });
      return;
    }
    doFightNow(attacker, target);
  }

  function doFightNow(attacker, target) {
    var w = game.firstMelee(attacker);
    var res = game.fight(attacker.id, target.id, w ? w.id : null);
    if (!res.ok) { toast(res.error); return; }
    showDiceResult('近战 · ' + (w ? w.name : '徒手'), res);
    mode = 'idle'; R.view.mode = 'idle';
    updateHUD(); R.draw();
  }

  /* ------------------------------------------------------------ 骰子面板 */
  function dieHtml(d, cls) {
    var c = 'die ' + (cls || '');
    if (d.v === 0) return '<div class="die cover">' + (d.cover ? '盾' : '自') + '</div>';
    return '<div class="' + c + '">' + d.v + '</div>';
  }

  function showDiceResult(title, res) {
    var body = '';
    if (res.attack) {
      body += '<div class="dice-row"><div class="dice-label">攻击骰 · ' + res.info.dist.toFixed(1) + '"' +
        (res.info.cover ? ' · 有掩护' : '') + (res.info.obscured ? ' · 遮挡' : '') +
        (res.info.precision ? ' · 精准' + res.info.precision : '') + '</div><div class="dice-pool">';
      res.attack.crits.forEach(function (d) { body += dieHtml(d, 'crit'); });
      res.attack.normals.forEach(function (d) { body += dieHtml(d, 'success'); });
      res.attack.fails.forEach(function (d) { body += dieHtml(d, 'fail'); });
      body += '</div></div>';
      body += '<div class="dice-row"><div class="dice-label">防御骰</div><div class="dice-pool">';
      res.defense.crits.forEach(function (d) { body += dieHtml(d, 'crit'); });
      res.defense.normals.forEach(function (d) { body += dieHtml(d, 'success'); });
      body += '</div></div>';
    }
    body += '<div class="combat-lines">' + res.lines.map(function (l) {
      return '<div>' + l + '</div>';
    }).join('') + '</div>';
    body += '<div class="verdict">' + (res.killed ? '目标被残废。' : '造成 ' + (res.damage || res.damageToTarget || 0) + ' 点伤害。') + '</div>';
    showModal(title, body, function () { afterCombat(); });
  }

  function afterCombat() {
    if (game.state.reacting) {
      game.endActivation();
      postAction(false);
      return;
    }
    updateHUD();
    R.draw();
  }

  /* ------------------------------------------------------------ HUD */
  var lastLogLen = 0;
  function updateHUD() {
    if (!game) return;
    var s = game.state;
    $('#tp-label').textContent = s.phase === 'deploy'
      ? '部署阶段'
      : s.phase === 'end' ? '战斗结束'
        : '第 ' + s.tp + ' / 4 转折点 · ' + (s.tpPhase === 'strategic' ? '战略阶段' : '交战阶段');
    $('#vp-police').textContent = s.sides.police.vp;
    $('#vp-rioters').textContent = s.sides.rioters.vp;
    $('#cp-police').textContent = s.sides.police.cp;
    $('#cp-rioters').textContent = s.sides.rioters.cp;
    $('#initiative-name').textContent = s.initiative === 'police' ? '警方' : '暴匪';
    $('#initiative-name').style.color = s.initiative === 'police' ? 'var(--blue)' : 'var(--orange)';

    renderUnitPanel();
    renderRosterPanel();
    renderLog();
    renderActions();
  }

  function renderUnitPanel() {
    var u = game.unit(selectedId || game.state.activeId);
    var body = $('#unit-body');
    if (!u) { body.className = 'panel-body empty'; body.textContent = '未选择特工'; return; }
    body.className = 'panel-body';
    var fac = DATA.FACTIONS[u.side];
    var wfrac = Math.max(0, u.wounds / u.maxWounds);
    var html = '<div class="unit-name"><span style="color:' + fac.color + '">◆</span>' + u.name + '</div>';
    html += '<div class="unit-role">' + fac.name + ' · ' + (u.role || '') + ' · ' +
      (u.order === 'engage' ? '交战命令' : '隐匿命令') + ' · ' +
      (u.state === 'ready' ? '就绪' : u.state === 'active' ? '激活中' : '待机') + '</div>';
    html += '<div class="stat-grid">' +
      '<div class="stat"><div class="k">APL</div><div class="v">' + u.apl + '</div></div>' +
      '<div class="stat"><div class="k">MOVE</div><div class="v">' + u.move + '"</div></div>' +
      '<div class="stat"><div class="k">SAVE</div><div class="v">' + u.save + '+</div></div>' +
      '<div class="stat"><div class="k">WND</div><div class="v">' + u.wounds + '/' + u.maxWounds + '</div></div>' +
      '</div>';
    html += '<div class="wound-bar ' + (wfrac <= 0.25 ? 'low' : '') + '"><i style="width:' + (wfrac * 100) + '%"></i></div>';
    u.weapons.forEach(function (wid) {
      var w = DATA.WEAPONS[wid];
      if (!w) return;
      var d = w.type === 'shield' ? '护盾' :
        (w.type === 'melee' ? 'A' + w.attacks + ' · ' + w.hit + '+ · ' + w.dmg + '/' + w.crit :
          'A' + w.attacks + ' · ' + w.hit + '+ · ' + w.dmg + '/' + w.crit + ' · ' + w.range + '"');
      html += '<div class="weapon-row"><span class="wn">' + w.name + '</span><span class="wd">' + d + '</span></div>';
    });
    (u.abilities || []).forEach(function (a) {
      html += '<div class="abil">◇ ' + a + '</div>';
    });
    if (u.weapons.indexOf('riot_shield') >= 0) html += '<div class="tagline">防暴盾：豁免 +1（最差 2+）</div>';
    body.innerHTML = html;
  }

  function renderRosterPanel() {
    var body = $('#roster-body');
    if (!body) return;
    var html = '';
    ['police', 'rioters'].forEach(function (sid) {
      var fac = DATA.FACTIONS[sid];
      var units = game.state.units.filter(function (u) { return u.side === sid; });
      var alive = units.filter(function (u) { return u.alive; }).length;
      html += '<div class="unit-role" style="color:' + fac.color + ';margin:6px 0 3px">' +
        fac.name + ' ' + alive + '/' + units.length +
        (game.state.sides[sid].primary ? ' · 主行动：' +
          (game.state.sides[sid].primary === 'critical' ? '关键' : '击杀') : '') + '</div>';
      units.forEach(function (u) {
        var cls = 'roster-row' + (u.state === 'spent' ? ' spent' : '') +
          (game.state.activeId === u.id ? ' active' : '') + (u.alive ? '' : ' spent');
        var st = !u.alive ? '阵亡' : (game.state.phase === 'deploy' && !u.deployed && u.side === game.state.deploy.side) ? '待部署' : u.state === 'ready' ? '就绪' : u.state === 'active' ? '激活' : '待机';
        html += '<div class="' + cls + '" data-uid="' + u.id + '">' +
          '<span class="dot" style="background:' + (u.order === 'engage' ? '#ff5a3c' : '#35e0ff') + '"></span>' +
          '<span class="nm">' + u.name + '</span><span class="st">' + st + '</span></div>';
      });
    });
    body.innerHTML = html;
    $$('.roster-row', body).forEach(function (row) {
      row.onclick = function () {
        var id = row.getAttribute('data-uid');
        var u = game.unit(id);
        // 部署阶段：点谁就放谁
        if (game.state && game.state.phase === 'deploy') {
          if (u && u.side === game.state.deploy.side && !u.deployed) { pickDeployUnit(id); return; }
          selectedId = id; updateHUD(); R.draw(); return;
        }
        if (!u || !u.alive) { selectedId = id; updateHUD(); return; }
        if (u.side === game.state.actingSide && u.state === 'ready' && !game.state.activeId) {
          selectedId = id; R.view.selectedId = id; openActivate(u); return;
        }
        selectedId = id; R.view.selectedId = id;
        updateHUD(); R.draw();
      };
    });
  }

  function renderLog() {
    var body = $('#log-body');
    if (!body) return;
    var logs = game.state.log;
    if (logs.length === lastLogLen) return;
    lastLogLen = logs.length;
    body.innerHTML = logs.slice(-120).map(function (l) {
      return '<div class="ln ' + (l.kind || '') + '">' + escapeHtml(l.text) + '</div>';
    }).join('');
    body.scrollTop = body.scrollHeight;
  }

  function renderActions() {
    var acts = $('#actions');
    var info = $('#active-info');
    if (!game || game.state.phase !== 'battle') { acts.innerHTML = ''; return; }
    var u = game.unit(game.state.activeId);
    if (!u) {
      var side = game.state.actingSide;
      var aiTurn = humanLocked();
      info.innerHTML = aiTurn
        ? '轮到 <b style="color:' + (side === 'police' ? 'var(--blue)' : 'var(--orange)') + '">' +
          (side === 'police' ? '警方' : '暴匪') + '</b> · <b style="color:var(--amber)">电脑行动中…</b>' +
          '<span style="color:#7c8798">（就绪 ' + game.readyCount(side) + ' 名）</span>'
        : '轮到 <b style="color:' + (side === 'police' ? 'var(--blue)' : 'var(--orange)') + '">' +
          (side === 'police' ? '警方' : '暴匪') + '</b> · 点击一名就绪特工开始激活' +
          '（就绪 ' + game.readyCount(side) + ' 名）';
      acts.innerHTML = '';
      if (aiTurn) return;
      if (game.canReact(side)) {
        var rb = document.createElement('button');
        rb.className = 'act-btn on';
        rb.setAttribute('data-key', 'reaction');
        rb.title = '快捷键 R';
        rb.innerHTML = '反应<span class="cost">1 行动 · 2"</span><kbd class="kbd">R</kbd>';
        rb.onclick = function () { openReactionPicker(side); };
        acts.appendChild(rb);
      }
      var pass = document.createElement('button');
      pass.className = 'act-btn';
      pass.setAttribute('data-key', 'pass');
      pass.title = '快捷键 Tab';
      pass.innerHTML = '跳过激活<span class="cost">PASS</span><kbd class="kbd">Tab</kbd>';
      pass.onclick = function () { if (humanLocked()) return; game.passOver(); updateHUD(); R.draw(); maybeAITurn(); };
      acts.appendChild(pass);
      return;
    }
    info.innerHTML = '<b>' + u.name + '</b> · ' + (u.order === 'engage' ? '交战' : '隐匿') +
      (u.guard ? ' · <b style="color:#ffd23c">' + game.guardName(u.guard) + '</b>' : '') +
      (u.reaction ? ' · <b style="color:var(--amber)">反应中</b>' : '') +
      ' · <span class="ap">AP ' + game.apLeft(u) + '/' + u.apl + '</span>' +
      ' · ' + (mode === 'idle' ? '选择行动' : '选择目标/位置');
    acts.innerHTML = '';

    var inEnemy = game.enemiesInControlOf(u.pos, u.side).length > 0;
    var nearEnemy = game.enemiesOf(u).some(function (e) { return game.dist(e.pos, u.pos) <= 1; });
    var defs = [
      { id: 'move', name: '转移', cost: '1 AP', on: !inEnemy && game.apLeft(u) >= 1 },
      { id: 'dash', name: '冲刺', cost: '1 AP · 3"', on: !inEnemy && game.apLeft(u) >= 1 },
      { id: 'charge', name: '冲锋', cost: '1 AP', on: u.order === 'engage' && !inEnemy && game.apLeft(u) >= 1 },
      { id: 'fallback', name: '后撤', cost: '2 AP', on: inEnemy && game.apLeft(u) >= 2 },
      { id: 'shoot', name: '射击', cost: '1 AP', on: u.order === 'engage' && !inEnemy && game.apLeft(u) >= 1 },
      { id: 'fight', name: '近战', cost: '1 AP', on: nearEnemy && game.apLeft(u) >= 1 },
      { id: 'stairs', name: u.onRoof ? '下楼' : '上楼', cost: '1 AP', on: game.apLeft(u) >= 1 && game.canStairs(u) },
      { id: 'door', name: '开门', cost: '1 AP', on: game.apLeft(u) >= 1 && game.doorsNear(u).length > 0 },
      { id: 'window', name: '翻窗', cost: '1 AP', on: game.apLeft(u) >= 1 && game.windowsNear(u).length > 0 },
      { id: 'pickup', name: '拾取', cost: '1 AP', on: game.apLeft(u) >= 1 && game.pickupsNear(u).length > 0 },
      { id: 'throw', name: '投掷', cost: '1 AP', on: game.apLeft(u) >= 1 && throwablesOf(u).length > 0 },
      { id: 'drone', name: '无人机', cost: '1 AP', on: game.apLeft(u) >= 1 &&
        ((u.droneShot && u.droneUsedTP !== game.state.tp) || (u.scout && u.scoutUsedTP !== game.state.tp)) },
      { id: 'med', name: '急救', cost: '1 AP', on: game.apLeft(u) >= 1 && !!u.medkit },
      { id: 'radio', name: '电台', cost: '1 AP', on: game.apLeft(u) >= 1 && !!u.radioAP && u.radioUsedTP !== game.state.tp },
      { id: 'overwatch', name: '警戒', cost: '1 AP · 留 1', on: game.apLeft(u) >= 2 && !u.guard },
      { id: 'sentry', name: '哨戒', cost: '1 AP · 留 1', on: game.apLeft(u) >= 2 && !u.guard },
      { id: 'cover', name: '掩护', cost: '1 AP · 留 1', on: game.apLeft(u) >= 2 && !u.guard },
      { id: 'pick', name: '拾取', cost: '1 AP', on: hasPickup(u) && game.apLeft(u) >= 1 },
      { id: 'place', name: '放置', cost: '1 AP', on: !!u.carrying && game.apLeft(u) >= 1 }
    ];
    var KEYMAP = { move: 'm', dash: 'd', charge: 'c', fallback: 'f', shoot: 's', fight: 'x',
      overwatch: 'z', sentry: 't', cover: 'y', pick: 'g', place: 'v', window: 'w', door: 'e', stairs: 'q' };
    defs.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'act-btn' + (mode === d.id ? ' on' : '');
      var k = KEYMAP[d.id] || '';
      if (k) { b.setAttribute('data-key', k); b.title = '快捷键 ' + k.toUpperCase(); }
      b.innerHTML = d.name + '<span class="cost">' + d.cost + '</span>' +
        (k ? '<kbd class="kbd">' + k.toUpperCase() + '</kbd>' : '');
      b.disabled = !d.on;
      b.onclick = function () { startAction(d.id, u); };
      acts.appendChild(b);
    });
    var end = document.createElement('button');
    end.className = 'act-btn danger';
    end.setAttribute('data-key', 'end');
    end.title = '快捷键 Space';
    end.innerHTML = '结束激活<span class="cost">END</span><kbd class="kbd">␣</kbd>';
    end.onclick = function () { endActivation(); };
    acts.appendChild(end);
  }

  function throwablesOf(u) {
    return (u.equip || []).filter(function (id) {
      var E = DATA.EQUIP[id];
      if (!E || E.cat !== 'throwable') return false;
      return !(u.throwUsed && u.throwUsed.indexOf(id) >= 0);
    });
  }

  function hasPickup(u) {
    return game.state.markers.some(function (m) {
      return !m.carriedBy && game.dist(u.pos, m) <= 1;
    });
  }

  function startAction(id, u) {
    if (id === 'stairs') {
      var sr = game.useStairs(u.id);
      if (!sr.ok) { toast(sr.error); return; }
      if (window.TUTORIAL) TUTORIAL.notify('stairs');
      toast(sr.up ? '上屋顶（1 AP）' : '下到室内（1 AP）');
      finishAction();
      pendingGuardFlow(function () { updateHUD(); R.draw(); });
      return;
    }
    if (id === 'door') {
      var ds = game.doorsNear(u);
      if (!ds.length) { toast('附近 1 寸内没有门'); return; }
      var dr = game.useDoor(u.id, ds[0].id);
      if (!dr.ok) { toast(dr.error); return; }
      toast(dr.inside ? '进入建筑（1 AP）' : '走出建筑（1 AP）');
      finishAction();
      pendingGuardFlow(function () { updateHUD(); R.draw(); });
      return;
    }
    if (id === 'drone') {
      mode = 'drone';
      R.view.mode = 'shoot';
      toast('点击 12" 内的敌人：' + (u.droneShot ? '攻击无人机出击' : '侦察无人机标定'));
      updateHUD(); R.draw();
      return;
    }
    if (id === 'pickup') {
      var near = game.pickupsNear(u);
      if (!near.length) { toast('附近没有可拾取的目标'); return; }
      var pr = game.pickUp(u.id, near[0].id);
      if (!pr.ok) { toast(pr.error); return; }
      toast('拾取 ' + pr.picked + '（+' + pr.vp + 'VP）');
      finishAction();
      return;
    }
    if (id === 'throw') {
      var list = throwablesOf(u);
      if (!list.length) { toast('没有可用的投掷物'); return; }
      pendingThrow = list[0];
      mode = 'throw';
      R.view.mode = 'shoot';
      toast('点击 12" 内的敌人或空地投掷「' + DATA.EQUIP[pendingThrow].name + '」');
      updateHUD(); R.draw();
      return;
    }
    if (id === 'med') {
      var wounded = game.state.units.filter(function (x) {
        return x.alive && x.side === u.side && x.id !== u.id && x.wounds < x.maxWounds &&
          game.dist(x.pos, u.pos) <= 1.5;
      }).sort(function (a, b) { return a.wounds - b.wounds; })[0];
      var mr = game.useMedkit(u.id, wounded ? wounded.id : u.id);
      if (!mr.ok) { toast(mr.error); return; }
      toast('恢复 ' + mr.healed + ' 点伤势');
      finishAction();
      return;
    }
    if (id === 'radio') {
      var ally = game.state.units.filter(function (x) {
        return x.alive && x.side === u.side && x.id !== u.id && x.state === 'ready' &&
          game.dist(x.pos, u.pos) <= 12;
      })[0];
      var rr = game.useRadio(u.id, ally ? ally.id : u.id);
      if (!rr.ok) { toast(rr.error); return; }
      toast('电台：+1 AP');
      finishAction();
      return;
    }
    if (id === 'window') {
      var ws = game.windowsNear(u);
      if (!ws.length) { toast('附近 1 寸内没有窗洞'); return; }
      ws.sort(function (a, b) {
        return game.dist(u.pos, { x: a.x + a.w / 2, y: a.y + a.h / 2 }) -
               game.dist(u.pos, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      });
      var wr = game.useWindow(u.id, ws[0].id);
      if (!wr.ok) { toast(wr.error); return; }
      toast('翻窗 1 AP');
      finishAction();
      pendingGuardFlow(function () { updateHUD(); R.draw(); });
      return;
    }
    if (id === 'overwatch' || id === 'sentry' || id === 'cover') {
      var g = game.setGuard(u.id, id);
      if (!g.ok) { toast(g.error); return; }
      toast({ overwatch: '进入警戒：敌人移动进入射界会被打断射击',
        sentry: '进入哨戒：被射击/冲锋/近战时先冲刺躲开',
        cover: '进入掩护：友军被警戒射击时先还击' }[id]);
      finishAction();
      return;
    }
    if (id === 'pick') {
      var m = game.state.markers.filter(function (mm) {
        return !mm.carriedBy && game.dist(u.pos, mm) <= 1;
      })[0];
      if (m) {
        var r = game.pickUp(u.id, m.id);
        if (!r.ok) toast(r.error);
        finishAction();
      }
      return;
    }
    mode = id;
    R.view.mode = id === 'move' || id === 'dash' || id === 'fallback' ? 'move' : id;
    toast({
      move: '点击目的地（单段直线，每段向上取整）',
      dash: '点击目的地（最多 3"）',
      fallback: '点击目的地（必须在敌方控制范围外结束）',
      charge: '点击敌方目标，自动冲锋到其 1" 内',
      shoot: '点击要射击的敌方目标',
      fight: '点击相邻的敌方目标',
      place: '点击要放置标识的位置（1" 内）'
    }[id] || '');
    updateHUD();
    R.draw();
  }

  function endActivation() {
    saveNow();
    var r = game.endActivation();
    selectedId = game.state.activeId;
    R.view.selectedId = null;
    postAction(r.tpEnded);
  }

  function postAction(tpEnded) {
    if (game.state.phase === 'end') { showResult(); return; }
    if (tpEnded) { afterTurningPoint(); }
    updateHUD();
    R.draw();
    maybeAITurn();
  }

  /* 主要行动 op：第 1 转折点秘密二选一（结算时按该路 VP 的一半加分） */
  function promptPrimary() {
    if (!game || game.state.tp !== 1) return;
    var need = false;
    ['police', 'rioters'].forEach(function (sid) {
      var s = game.state.sides[sid];
      if (s.primary) return;
      if (aiControls(sid)) {
        game.choosePrimary(sid, sid === 'rioters' ? 'kill' : 'critical');
      } else {
        need = true;
      }
    });
    if (!need) { maybeAITurn(); return; }

    var html = '<div class="combat-lines" style="font-size:12.5px;line-height:1.7">' +
      '第 1 转折点秘密选定主要行动 op：结算时追加该条得分线所得 VP 的<b>一半（向上取整）</b>。<br>' +
      '<b>关键行动</b>：靠控制目标标识得分；<b>击杀行动</b>：靠残废敌方特工得分。</div>';
    ['police', 'rioters'].forEach(function (sid) {
      if (aiControls(sid)) return;
      html += '<div class="dice-row" style="margin-top:12px"><div class="dice-label">' +
        (sid === 'police' ? '警方' : '暴匪') + '</div><div class="actions">' +
        '<button class="act-btn" data-sid="' + sid + '" data-op="critical">关键行动<span class="cost">占点</span></button>' +
        '<button class="act-btn" data-sid="' + sid + '" data-op="kill">击杀行动<span class="cost">收割</span></button>' +
        '</div></div>';
    });
    showModal('主要行动 op', html, function () {
      ['police', 'rioters'].forEach(function (sid) {
        if (!game.state.sides[sid].primary && !aiControls(sid)) {
          game.choosePrimary(sid, 'critical');
        }
      });
      updateHUD(); R.draw();
      maybeAITurn();
    }, '确定');

    $$('#dice-body .act-btn').forEach(function (b) {
      b.onclick = function () {
        var sid = b.getAttribute('data-sid');
        var op = b.getAttribute('data-op');
        var r = game.choosePrimary(sid, op);
        if (!r.ok) { toast(r.error); return; }
        closeModal();
        updateHUD(); R.draw();
        promptPrimary();   // 还有另一方没选就继续问
      };
    });
  }


  var aiTimer = null;
  var autoBoth = false;          // 调试：双方都交给 AI（自动演示 / 端到端验证）
  function aiControls(side) {
    if (autoBoth) return true;
    return vsAI && side === aiSide;
  }

  var aiChip = null;
  function setAiThinking(on) {
    if (on) {
      if (aiChip) return;
      aiChip = document.createElement('div');
      aiChip.className = 'ai-chip';
      aiChip.innerHTML = '<span class="dot"></span>电脑思考中…';
      document.getElementById('app').appendChild(aiChip);
    } else if (aiChip) {
      aiChip.remove();
      aiChip = null;
    }
  }

  function maybeAITurn() {
    if (!game || game.state.phase !== 'battle') { setAiThinking(false); return; }
    var sideNow = game.state.actingSide;
    if (!aiControls(sideNow)) { setAiThinking(false); return; }
    if (game.state.activeId) return;
    clearTimeout(aiTimer);
    setAiThinking(true);
    aiTimer = setTimeout(function () {
      if (!game || game.state.phase !== 'battle') return;
      var s = game.state.actingSide;
      if (!aiControls(s) || game.state.activeId) return;
      var prevTp = game.state.tp;
      var did = false;
      try {
        if (game.canReact(s)) did = AI.takeReaction(game, s);
        if (!did) did = AI.takeTurn(game, s);
      } catch (e) { console.error(e); did = false; }
      if (!did) game.passOver();
      if (game.state.phase === 'end') { showResult(); return; }
      if (game.state.tp !== prevTp) {
        afterTurningPoint();
        return;
      }
      updateHUD();
      R.draw();
      var aiOn = aiControls(game.state.actingSide) && game.state.phase === 'battle';
      setAiThinking(aiOn);
      if (aiOn) {
        aiTimer = setTimeout(maybeAITurn, autoBoth ? 160 : 240);
      }
    }, autoBoth ? 220 : 520);
  }

  /* AI 自动部署 */
  var aiDeployTimer = null;
  function maybeAIDeploy() {
    if (!game || game.state.phase !== 'deploy') return;
    if (!aiControls(game.state.deploy.side)) return;
    clearTimeout(aiDeployTimer);
    aiDeployTimer = setTimeout(function () {
      if (game.state.phase !== 'deploy' || !aiControls(game.state.deploy.side)) return;
      var u = game.state.units.filter(function (x) { return x.side === aiSide && !x.deployed; })[0];
      if (!u) return;
      var spot = game.findDeploySpot(u);
      var placed = !!(spot && game.deployUnit(u.id, spot.x, spot.y).ok);
      if (!placed) {
        // 兜底：在集结区里逐格试，避免卡死在部署阶段
        var z = game.state.map.dropZones[aiSide];
        for (var yy = z.y + 0.6; yy < z.y + z.h - 0.6 && !placed; yy += 1) {
          for (var xx = z.x + 0.6; xx < z.x + z.w - 0.6 && !placed; xx += 1) {
            if (game.deployUnit(u.id, xx, yy).ok) placed = true;
          }
        }
      }
      if (!placed) {
        console.warn('[AI] 找不到部署位置', u && u.id);
        setAiThinking(false);
        toast('电脑无法部署，已跳过');
        return;
      }
      if (game.state.phase === 'battle') {
        hideDeployBanner(); mode = 'idle';
        R.view.showZones = false;
        logFlash('部署完成，战斗开始。');
        updateHUD(); R.draw();
        setTimeout(maybeAITurn, 400);
        return;
      }
      renderDeployUI(); updateHUD(); R.draw();
      maybeAIDeploy();
    }, 260);
  }

  /* ------------------------------------------------------------ 转折点 */
  function afterTurningPoint() {
    var s = game.state;
    if (s.phase === 'end') { showResult(); return; }
    var body = '';
    var recent = s.log.filter(function (l) { return l.kind === 'score'; }).slice(-4);
    body += '<div class="combat-lines">' + recent.map(function (l) {
      return '<div>' + escapeHtml(l.text) + '</div>';
    }).join('') + '</div>';
    body += '<div class="verdict">第 ' + s.tp + ' 转折点开始 · 先手：' +
      (s.initiative === 'police' ? '警方' : '暴匪') + ' · 双方就绪。</div>';
    body += '<div class="result-breakdown" style="margin-top:10px">' +
      '<div class="row"><span>警方 VP</span><b>' + s.sides.police.vp + '</b></div>' +
      '<div class="row"><span>暴匪 VP</span><b>' + s.sides.rioters.vp + '</b></div></div>';
    showModal('第 ' + s.tp + ' 转折点', body, null);
    if (autoBoth) setTimeout(closeModal, 600);
    updateHUD();
    R.draw();
    maybeAITurn();
  }

  function showResult() {
    var s = game.state;
    setAiThinking(false);
    closeModal();
    document.getElementById('tp-modal').classList.add('hidden');
    showScreen('result');
    var title = s.winner === 'draw' ? '平局' : (s.winner === 'police' ? '警方胜利' : '暴匪胜利');
    $('#result-title').textContent = title;
    $('#result-title').style.color = s.winner === 'police' ? 'var(--blue)' : s.winner === 'rioters' ? 'var(--orange)' : 'var(--amber)';
    $('#result-score').innerHTML =
      '<div class="side police"><div class="n">' + s.sides.police.vp + '</div><div class="l">警方</div></div>' +
      '<div class="sep">:</div>' +
      '<div class="side rioters"><div class="n">' + s.sides.rioters.vp + '</div><div class="l">暴匪</div></div>';
    var rows = '';
    ['police', 'rioters'].forEach(function (sid) {
      var x = s.sides[sid];
      rows += '<div class="row"><span>' + (sid === 'police' ? '警方' : '暴匪') + ' · 击杀等级</span><b>' + x.killLevel + '</b></div>';
      rows += '<div class="row"><span>' + (sid === 'police' ? '警方' : '暴匪') + ' · 阵亡</span><b>' +
        game.state.units.filter(function (u) { return u.side === sid && !u.alive; }).length + '</b></div>';
    });
    rows += '<div class="row"><span>转折点</span><b>' + Math.min(s.tp, 4) + ' / 4</b></div>';
    $('#result-breakdown').innerHTML = rows;
  }

  /* ------------------------------------------------------------ 弹窗基础 */
  var modalCb = null;
  function showModal(title, bodyHtml, cb, okText) {
    modalCb = cb || null;
    $('#dice-title').textContent = title;
    $('#dice-body').innerHTML = bodyHtml;
    $('#dice-ok').textContent = okText || '继续';
    $('#dice-modal').classList.remove('hidden');
  }
  function closeModal() { $('#dice-modal').classList.add('hidden'); modalCb = null; }
  $('#dice-ok').onclick = function () {
    var cb = modalCb;
    closeModal();
    if (cb) cb();
  };

  $('#tp-ok').onclick = function () { $('#tp-modal').classList.add('hidden'); };

  /* ------------------------------------------------------------ 暂停 */
  /* ------------------------------------------------------------ 视角 */
  function setView(preset) {
    if (!R || !R.camera || !R.controls) { toast('当前为 2D 渲染，无 3D 视角'); return; }
    var cb = { x: game.state.map.boardW / 2, z: game.state.map.boardH / 2 };
    var cam = R.camera, ctr = R.controls;
    if (preset === 'top') {
      cam.up.set(0, 0, -1);
      cam.position.set(cb.x, 120, cb.z + 0.01);
      ctr.target.set(cb.x, 0, cb.z);
    } else if (preset === 'iso') {
      cam.up.set(0, 1, 0);
      cam.position.set(cb.x - 30, 78, game.state.map.boardH + 26);
      ctr.target.set(cb.x, 0, cb.z);
    } else {
      cam.up.set(0, 1, 0);
      cam.position.set(cb.x - 30, 78, game.state.map.boardH + 26);
      ctr.target.set(cb.x, 0, cb.z);
    }
    ctr.update();
  }
  $('#btn-view-top').onclick = function () { setView('top'); };
  $('#btn-view-iso').onclick = function () { setView('iso'); };
  $('#btn-view-reset').onclick = function () { setView('reset'); };
  // 碰撞盒调试键并入统一键盘处理（B）

  $('#btn-menu').onclick = function () { $('#pause-modal').classList.remove('hidden'); };
  $('#pause-resume').onclick = function () { $('#pause-modal').classList.add('hidden'); };
  $('#pause-restart').onclick = function () { location.reload(); };
  $('#pause-title').onclick = function () {
    $('#pause-modal').classList.add('hidden');
    showScreen('title');
  };
  $('#btn-again').onclick = function () { location.reload(); };

  /* ------------------------------------------------------------ 工具 */
  var toastTimer = null;
  function toast(msg) {
    if (!msg) return;
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function logFlash(msg) { toast(msg); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  window.addEventListener('resize', function () { if (R) R.resize(); });

  /* ------------------------------------------------------------ 启动 */
  $('#btn-deploy').onclick = function () { startGame(); };
  var tutBtn = document.getElementById('btn-tutorial');
  if (tutBtn) tutBtn.onclick = function () { startTutorial(); };
  var contBtn = document.getElementById('btn-continue');
  if (contBtn) contBtn.onclick = function () { continueGame(); };
  renderRoster();

  // 先预载 3D 模型（失败就退回 2D）
  if (window.RENDER3D && window.THREE) {
    try {
      RENDER3D.loadModels(function () { console.log('[3D] 模型加载完成'); });
    } catch (e) { console.warn('模型预载失败', e); }
  }

  // 调试入口：?debug=roster|brief|rules|deploy|battle|skirmish|result（用于自动化截图检查）
  var q = (location.search.match(/debug=(\w+)/) || [])[1];
  var showBoxes = /boxes=1/.test(location.search);
  if (q === 'roster' || q === 'brief' || q === 'rules') {
    showScreen(q);
    renderRoster();
  } else if (q === 'autoplay') {
    autoBoth = true;
    startGame();
    autoDeploy();
  } else if (q === 'shot' || q === 'primary') {
    startGame();
    autoDeploy();
    if (q === 'shot') debugShot();
    else promptPrimary();
  } else if (q) {
    startGame();
    if (q === 'battle' || q === 'skirmish' || q === 'result') {
      autoDeploy();
      if (q === 'battle') {
        game.choosePrimary('police', 'critical');
        game.choosePrimary('rioters', 'kill');
        closeModal();
        updateHUD(); R.draw();
      }
    }
    if (q === 'skirmish') debugSkirmish();
    if (q === 'vsai') debugVsAI();
    if (q === 'uitest') debugUiTest();
    if (q === 'deployflow') debugDeployFlow();
    if (q === 'charge') debugCharge();
    if (q === 'window') debugWindow();
    if (q === 'door') debugDoor();
    if (q === 'roof') debugRoof();
    if (q === 'tutorial') startTutorial();
    if (q === 'equip') debugEquip();
    if (q === 'equipriot') debugEquipRiot();
    if (showBoxes && R && R.view) { R.view.debugBoxes = true; R.draw(); }
    if (q === 'result') { game.finishGame(); showResult(); }
  }

  function debugShot() {
    var s = game.state;
    var a = s.units.filter(function (u) { return u.side === 'police'; })[0];
    var t = s.units.filter(function (u) { return u.side === 'rioters'; })[0];
    var pi = 0, ri = 0;
    s.units.forEach(function (u) {
      if (u.side === 'police' && u.id !== a.id) { u.pos = { x: 4, y: 2 + (pi++) * 3 }; u.order = 'conceal'; }
      if (u.side === 'rioters' && u.id !== t.id) { u.pos = { x: 56, y: 2 + (ri++) * 2.8 }; u.order = 'conceal'; }
    });
    a.pos = { x: 24, y: 12.5 }; a.elevation = 0; a.state = 'ready'; a.order = 'engage';
    t.pos = { x: 31, y: 12.5 }; t.elevation = 0; t.order = 'engage';
    s.sides.police.cp = 2;
    s.actingSide = 'police';
    s.activeId = null;
    game.activate(a.id, 'engage');
    selectedId = a.id;
    R.view.selectedId = a.id;
    updateHUD();
    R.draw();
    doShoot(a, t);
  }


  /* 调试：单人 vs 电脑。用脚本扮演"真人"，把 AI 回合流程完整跑一遍 */

  /* 调试：只走部署流程，用 onDeployClick 模拟真人点击，检测是否卡住 */

  /* 调试：走一遍真实 UI 的冲锋流程（findChargeSpot → doMove → fight → 结束激活） */

  /* 调试：把一名特工摆到窗边，验证"翻窗"按钮 */

  /* 调试：把特工摆到门口并进门，验证门与室内 */

  /* 调试：把特工摆到屋顶，验证上楼/屋顶部署 */

  /* 调试：打开装备选择面板 */
  function debugEquipRiot() {
    showScreen('roster');
    equipment['thug#0'] = ['armband', 'molotov'];
    equipment['thug#1'] = ['armband'];
    equipment['thug#2'] = ['armband'];
    renderRoster();
    openEquipPicker('thug#3', 'rioters');
    var grid = document.querySelector('.equip-grid'); if (grid) grid.scrollTop = grid.scrollHeight;
    console.log('[EQ] riot picker');
  }

  function debugEquip() {
    showScreen('roster');
    renderRoster();
    equipment['officer#0'] = ['armor_plate', 'frag_grenade', 'smoke_grenade'];
    equipment['officer#1'] = ['binoculars'];
    renderRoster();
    openEquipPicker('officer#0', 'police');
    console.log('[EQ] opened, pool=' + equipPoolFor('police').length);
  }

  function debugRoof() {
    startGame();
    autoDeploy();
    game.choosePrimary('police', 'critical');
    game.choosePrimary('rioters', 'kill');
    closeModal();
    var s = game.state;
    var b = s.map.terrain.filter(function (t) { return t.kind === 'building'; })[0];
    var u = s.units.filter(function (x) { return x.side === 'police'; })[0];
    s.units.forEach(function (x) {
      if (x.id === u.id) return;
      x.pos = { x: x.side === 'police' ? 2 : 88, y: x.side === 'police' ? 3 : 63 };
    });
    u.pos = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    u.elevation = 0; u.state = 'ready'; u.order = 'engage'; u.onRoof = false;
    s.actingSide = 'police'; s.activeId = null;
    game.activate(u.id, 'engage');
    var r = game.useStairs(u.id);
    console.log('[ROOF] up=' + r.ok + ' elev=' + u.elevation + ' onRoof=' + u.onRoof);
    updateHUD(); R.draw();
  }

  function debugDoor() {
    startGame();
    autoDeploy();
    game.choosePrimary('police', 'critical');
    game.choosePrimary('rioters', 'kill');
    closeModal();
    var s = game.state;
    var d = s.map.doors[0];
    var u = s.units.filter(function (x) { return x.side === 'police'; })[0];
    s.units.forEach(function (x) {
      if (x.id === u.id) return;
      x.pos = { x: x.side === 'police' ? 2 : 88, y: x.side === 'police' ? 3 : 63 };
    });
    u.pos = { x: d.x + d.w / 2, y: d.y + d.h + 0.7 };
    u.elevation = 0; u.state = 'ready'; u.order = 'engage';
    s.actingSide = 'police'; s.activeId = null;
    game.activate(u.id, 'engage');
    console.log('[DOOR] near=' + game.doorsNear(u).length + ' id=' + d.id);
    var r = game.useDoor(u.id, d.id);
    console.log('[DOOR] enter ok=' + r.ok + ' y=' + u.pos.y.toFixed(2) + ' doorY=' + d.y.toFixed(2));
    updateHUD(); R.draw();
  }

  function debugWindow() {
    startGame();
    autoDeploy();
    game.choosePrimary('police', 'critical');
    game.choosePrimary('rioters', 'kill');
    closeModal();
    var s = game.state;
    var w = s.map.windows[0];
    var u = s.units.filter(function (x) { return x.side === 'police'; })[0];
    s.units.forEach(function (x) {
      if (x.id === u.id) return;
      x.pos = { x: x.side === 'police' ? 2 : 88, y: x.side === 'police' ? 3 : 63 };
    });
    u.pos = { x: w.x + w.w / 2, y: w.y - 0.7 };
    u.elevation = 0; u.state = 'ready'; u.order = 'engage';
    s.actingSide = 'police'; s.activeId = null;
    game.activate(u.id, 'engage');
    console.log('[WIN] near=' + game.windowsNear(u).length + ' window=' + w.id);
    updateHUD(); R.draw();
  }

  function debugCharge() {
    startGame();
    autoDeploy();
    var st = game.state;
    var atk = st.units.filter(function (u) { return u.side === 'police'; })[0];
    var tgt = st.units.filter(function (u) { return u.side === 'rioters'; })[0];
    st.units.forEach(function (u) {
      if (u.id === atk.id || u.id === tgt.id) return;
      u.pos = { x: u.side === 'police' ? 3 : 87, y: u.side === 'police' ? 3 : 63 };
      u.elevation = 0;
    });
    atk.pos = { x: 30, y: 33 }; atk.elevation = 0; atk.state = 'ready'; atk.order = 'engage';
    tgt.pos = { x: 34, y: 33 }; tgt.elevation = 0;
    st.actingSide = 'police'; st.activeId = null;
    var a = game.activate(atk.id, 'engage');
    console.log('[CHARGE] activate=' + a.ok);
    var spot = findChargeSpot(atk, tgt);
    console.log('[CHARGE] spot=' + JSON.stringify(spot));
    if (!spot) return;
    var r = game.doMove(atk.id, 'charge', [spot]);
    console.log('[CHARGE] move ok=' + r.ok + ' err=' + (r.error || '-') + ' ap=' + game.apLeft(atk));
    var w = game.firstMelee(atk);
    var f = game.fight(atk.id, tgt.id, w ? w.id : null);
    console.log('[CHARGE] fight ok=' + f.ok + ' err=' + (f.error || '-'));
    var e = game.endActivation();
    console.log('[CHARGE] end ok=' + e.ok + ' active=' + game.state.activeId +
      ' atkState=' + atk.state + ' side=' + game.state.actingSide);
    updateHUD(); R.draw();
  }

  function debugDeployFlow() {
    vsAI = true;
    startGame();
    var t0 = Date.now();
    var iv = setInterval(function () {
      if (!game) { clearInterval(iv); return; }
      if (game.state.phase === 'battle') {
        if (!window.__flowLogged) {
          window.__flowLogged = true;
          console.log('[FLOW] battle at ' + (Date.now() - t0) + 'ms, acting=' + game.state.actingSide);
        }
      }
      if (game.state.phase !== 'deploy') {
        var dm = document.getElementById('dice-modal');
        if (dm && !dm.classList.contains('hidden')) {
          var b = dm.querySelector('.act-btn[data-op]');
          if (b) { b.click(); console.log('[FLOW] picked op'); }
        }
        return;
      }
      var side = game.state.deploy.side;
      if (aiControls(side)) return;               // 电脑自己在部署
      var u = game.state.units.filter(function (x) { return x.side === side && !x.deployed; })[0];
      if (!u) return;
      var spot = game.findDeploySpot(u);
      if (spot) onDeployClick({ x: spot.x, y: spot.y });
      else console.warn('[FLOW] no spot for ' + u.id);
    }, 350);
    setTimeout(function () {
      if (game && game.state.phase === 'deploy') {
        var sd = game.state.deploy.side;
        console.error('[FLOW] STUCK deploy side=' + sd + ' remain=' + game.state.deploy.remaining[sd] +
          ' pick=' + deployPickId);
      }
    }, 25000);
  }

  /* 调试：模式/难度按钮点击自检 */
  function debugUiTest() {
    showScreen('roster');
    var aiBtn = document.querySelector('#mode-toggle [data-mode="ai"]');
    var hotBtn = document.querySelector('#mode-toggle [data-mode="hotseat"]');
    var lvBtn = document.querySelector('#mode-toggle [data-ai-level="ruthless"]');
    aiBtn.click();
    console.log('[UI] 点AI后 vsAI=' + vsAI + ' 难度可见=' + !document.getElementById('ai-lv-ruthless').hidden);
    lvBtn.click();
    console.log('[UI] 点凶狠后 vsAI=' + vsAI + ' level=' + aiLevel +
      ' 模式组选中=' + (document.querySelector('#mode-toggle [data-mode].on') || {}).outerHTML);
    hotBtn.click();
    console.log('[UI] 点双人后 vsAI=' + vsAI + ' 难度可见=' + !document.getElementById('ai-lv-ruthless').hidden);
    document.getElementById('pause-modal').classList.remove('hidden');
  }

  function debugVsAI() {
    vsAI = true; humanSide = 'police'; aiSide = 'rioters';
    if (window.AI && AI.setLevel) AI.setLevel(aiLevel);
    startGame();
    autoDeploy();
    var tick = setInterval(function () {
      if (!game) { clearInterval(tick); return; }
      if (game.state.phase === 'end') { clearInterval(tick); return; }
      // 关闭转折点 / 骰子弹窗，让流程继续
      ['tp-modal', 'dice-modal'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
          var b = el.querySelector('.btn.primary, .btn');
          if (b) b.click(); else closeModal();
        }
      });
      if (game.state.phase !== 'battle') return;
      if (game.state.activeId) return;                 // AI 正在行动
      if (aiControls(game.state.actingSide)) return;   // 轮到电脑
      var sid = game.state.actingSide;
      var u = game.state.units.filter(function (x) {
        return x.side === sid && x.alive && x.state === 'ready';
      }).sort(function (a, b) { return b.apl - a.apl; })[0];
      if (!u) { game.passOver(); updateHUD(); R.draw(); maybeAITurn(); return; }
      if (!game.activate(u.id, 'engage').ok) { game.passOver(); return; }
      var mk = game.state.markers[0];
      var ang = Math.atan2(mk.y - u.pos.y, mk.x - u.pos.x);
      var step = Math.min(u.move, 5);
      var dest = { x: u.pos.x + Math.cos(ang) * step, y: u.pos.y + Math.sin(ang) * step };
      if (!game.doMove(u.id, 'move', [dest]).ok) {
        var alt = { x: u.pos.x + Math.cos(ang + 0.9) * step, y: u.pos.y + Math.sin(ang + 0.9) * step };
        game.doMove(u.id, 'move', [alt]);
      }
      var foe = game.state.units.filter(function (e) { return e.alive && e.side !== sid; })
        .sort(function (a, b) { return game.dist(a.pos, u.pos) - game.dist(b.pos, u.pos); })[0];
      if (foe) {
        var w = u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
          .filter(function (x) { return x && x.type === 'ranged'; })[0];
        if (w) game.shoot(u.id, foe.id, w.id);
      }
      game.endActivation();
      updateHUD(); R.draw(); maybeAITurn();
    }, 700);
  }

  function debugSkirmish() {
    if (!game.state.sides.police.primary) game.choosePrimary('police', 'critical');
    if (!game.state.sides.rioters.primary) game.choosePrimary('rioters', 'kill');
    closeModal();
    var s = game.state;
    var pol = s.units.filter(function (u) { return u.side === 'police'; });
    var riot = s.units.filter(function (u) { return u.side === 'rioters'; });
    var a = [[28, 20], [30, 27], [32, 33], [26, 36], [34, 24], [29, 40], [24, 30], [36, 29], [22, 24], [27, 45], [33, 46]];
    var b = [[62, 20], [60, 27], [58, 33], [64, 36], [56, 24], [61, 40], [66, 30], [54, 43], [68, 26], [63, 45], [57, 46], [50, 22], [52, 30], [49, 40], [47, 34]];
    pol.forEach(function (u, i) { if (a[i]) u.pos = { x: a[i][0], y: a[i][1] }; });
    riot.forEach(function (u, i) {
      if (b[i]) u.pos = { x: b[i][0], y: b[i][1] };
      u.order = i % 3 === 0 ? 'conceal' : 'engage';
    });
    pol.forEach(function (u, i) { u.order = 'engage'; });
    // 制造几个受伤单位
    pol[2].wounds = Math.max(2, pol[2].maxWounds - 6);
    riot[1].wounds = Math.max(2, riot[1].maxWounds - 5);
    riot[4].wounds = Math.max(1, riot[4].maxWounds - 7);
    pol[5].alive = false; pol[5].state = 'dead';
    s.tp = 2;
    s.sides.police.vp = 3; s.sides.rioters.vp = 2;
    s.sides.police.cp = 2; s.sides.rioters.cp = 1;
    var act = pol[3];
    act.equip = ['frag_grenade', 'smoke_grenade', 'armor_plate'];
    act.medkit = 2;
    act.radioAP = true;
    act.state = 'active';
    s.activeId = act.id;
    s.actingSide = 'police';
    selectedId = act.id;
    R.view.selectedId = act.id;
    act.apUsed = 1;
    act.actionsThisActivation = ['move'];
    updateHUD();
    R.draw();
  }

  /* 键盘：ESC 取消 · 行动快捷键 · 面板折叠 · 视角 */
  var ACTION_KEYS = { m: 'move', d: 'dash', c: 'charge', f: 'fallback', s: 'shoot', x: 'fight',
    z: 'overwatch', t: 'sentry', y: 'cover', g: 'pick', v: 'place', w: 'window', e: 'door', q: 'stairs' };
  function clickAct(key) {
    var b = document.querySelector('#actions .act-btn[data-key="' + key + '"]');
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  }
  window.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      if (shotPending) { toast('请先结算这次射击'); return; }
      if (!$('#dice-modal').classList.contains('hidden')) { closeModal(); return; }
      mode = 'idle';
      R && (R.view.mode = 'idle');
      updateHUD(); R && R.draw();
      return;
    }

    // 面板折叠（任何界面都能用）
    if (e.key === '[') { togglePanel('left'); e.preventDefault(); return; }
    if (e.key === ']') { togglePanel('right'); e.preventDefault(); return; }
    if (e.key === 'h' && game && game.state.phase === 'battle') { togglePanel('bottom'); e.preventDefault(); return; }

    if (!game || game.state.phase !== 'battle') return;
    if (document.querySelector('.modal:not(.hidden)')) return;   // 弹窗期间不抢键
    if (humanLocked()) return;                                   // 电脑回合

    if (e.key === 'b' || e.key === 'B') {
      if (!R || !R.view) return;
      R.view.debugBoxes = !R.view.debugBoxes;
      R.draw();
      toast(R.view.debugBoxes ? '显示碰撞盒（绿框＝引擎实际用的碰撞矩形）' : '隐藏碰撞盒');
      return;
    }
    if (e.key === '1') { setView('top'); return; }
    if (e.key === '2') { setView('iso'); return; }
    if (e.key === '3') { setView('reset'); return; }

    var k = (e.key || '').toLowerCase();
    if (ACTION_KEYS[k]) { if (clickAct(ACTION_KEYS[k])) e.preventDefault(); return; }
    if (k === 'r') { if (clickAct('reaction')) e.preventDefault(); return; }
    if (e.key === ' ' || e.key === 'Enter') { if (clickAct('end')) e.preventDefault(); return; }
    if (e.key === 'Tab') { if (clickAct('pass')) e.preventDefault(); return; }
  });

  /* 面板折叠按钮 */
  document.getElementById('tab-left').onclick = function () { togglePanel('left'); };
  document.getElementById('tab-right').onclick = function () { togglePanel('right'); };
  document.getElementById('tab-bottom').onclick = function () { togglePanel('bottom'); };
  applyPanels();
})();
