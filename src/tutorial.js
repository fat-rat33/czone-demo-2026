/* 新手教程：24×24 小地图 + 3 个单位 + 8 步引导 */
(function (GLOBAL) {
  'use strict';

  var T = (GLOBAL.TUTORIAL = {});

  /* ---------------- 迷你地图（24×24 寸） ---------------- */
  var T = GLOBAL.TUTORIAL;
  T.map = {
    id: 'tutorial', name: '训练场', boardW: 24, boardH: 24,
    dropZones: { police: { x: 1, y: 17, w: 6, h: 6 }, rioters: { x: 17, y: 1, w: 6, h: 6 } },
    objectives: [],
    doors: [{ id: 'td1', x: 15.3, y: 10.76, w: 1.4, h: 0.24, dir: 'h', label: '训练房门' }],
    windows: [],
    terrain: [
      // 训练房（8×6，南墙留门）
      { id: 'th', kind: 'building', style: 'shop', solid: false, los: false, coverZone: true, x: 12, y: 5, w: 8, h: 6, height: 4.5, label: '训练房' },
      { id: 'th_s1', kind: 'wall', render: false, x: 12.24, y: 10.76, w: 2.76, h: 0.24, cover: 'heavy', solid: true, los: true, height: 4.5, label: '墙' },
      { id: 'th_s2', kind: 'wall', render: false, x: 16.7, y: 10.76, w: 3.06, h: 0.24, cover: 'heavy', solid: true, los: true, height: 4.5, label: '墙' },
      { id: 'th_door', kind: 'door', render: false, x: 15.3, y: 10.76, w: 1.4, h: 0.24, cover: 'none', solid: true, los: false, height: 2.6, label: '训练房门' },
      { id: 'th_n', kind: 'wall', render: false, x: 12.24, y: 5, w: 7.52, h: 0.24, cover: 'heavy', solid: true, los: true, height: 4.5, label: '墙' },
      { id: 'th_w', kind: 'wall', render: false, x: 12, y: 5.24, w: 0.24, h: 5.52, cover: 'heavy', solid: true, los: true, height: 4.5, label: '墙' },
      { id: 'th_e', kind: 'wall', render: false, x: 19.76, y: 5.24, w: 0.24, h: 5.52, cover: 'heavy', solid: true, los: true, height: 4.5, label: '墙' },
      // 掩体
      { id: 'tc1', kind: 'cover', render: true, x: 3, y: 12, w: 3, h: 1.2, cover: 'heavy', solid: true, los: true, height: 3.2, label: '集装箱' },
      { id: 'tc2', kind: 'cover', render: true, x: 6, y: 15, w: 2.4, h: 1, cover: 'light', solid: true, los: true, height: 1.1, label: '沙袋' }
    ]
  };

  /* ---------------- 步骤 ---------------- */
  T.steps = [
    { key: 'activate', title: '选择特工', hint: '点击你方的蓝点（警员）激活它。每名特工每回合只能被激活一次。' },
    { key: 'move', title: '移动（转移）', hint: '激活后点「转移」再点地面。每名特工 APL 4，也就是每个激活有 4 点行动力；移动 1 次花 1 AP。' },
    { key: 'shoot', title: '射击', hint: '点「射击」，再点 15 寸内的敌人。命中骰 ≥ 武器命中值（3+）为成功，防御方掷 3 颗豁免骰抵消。' },
    { key: 'dash', title: '冲刺', hint: '点「冲刺」可以多跑 6 寸，但这次激活就不能再射击了——用来抢位置或抢点。' },
    { key: 'guard', title: '警戒', hint: '点「警戒」（需保留 2 AP）。敌人进入射程并移动时，你会自动开火——这就是反应射击。' },
    { key: 'door', title: '进屋：开门', hint: '走到门口 2 寸内，点「开门」花 1 AP 进屋。门被墙挡着，必须用这个动作才能通过。' },
    { key: 'stairs', title: '上屋顶', hint: '在屋内点「上楼」花 1 AP 上屋顶。站得高对低处目标有精准加成。' },
    { key: 'throw', title: '投掷物', hint: '点「投掷」再点 12 寸内的敌人扔手雷。爆破会波及目标周围的敌人。' }
  ];

  T.index = 0;
  T.done = {};
  T.active = false;

  /* ---------------- 启动 ---------------- */
  T.start = function () {
    try {
      T.game = ENGINE.createGame({ seed: 2026 });
      T.game.setup();
      var g = T.game, s = g.state;
      // 依次尝试各种自动部署接口，保证一定能进战斗
      if (g.autoDeploy) { g.autoDeploy(); }
      var guard = 0;
      while (s.phase === 'deploy' && guard++ < 400) {
        var pending = s.units.filter(function (x) { return !x.deployed; });
        if (!pending.length) { s.phase = 'battle'; break; }
        var u = pending[0];
        var sp = g.findDeploySpot(u);
        if (!sp || !g.deployUnit(u.id, sp.x, sp.y).ok) {
          u.deployed = true; u.pos = { x: u.side === 'police' ? 6 : 84, y: 20 };
        }
      }
      s.phase = 'battle';
      if (!s.tp) s.tp = 1;
      s.actingSide = 'police'; s.initiative = 'police';
      s.actingSide = 'police';
    s.initiative = 'police';
    s.activeId = null;

    T.index = 0; T.done = {}; T.active = true; T.snap = null;
      if (T.timer) clearInterval(T.timer);
      T.timer = setInterval(T.watch, 300);
      T.render();
      return g;
    } catch (err) {
      console.error('[TUT] 启动失败', err);
      T.active = false;
      return null;
    }
  };
  /* 在已经运行的对局上挂引导层（不碰渲染器与对局数据） */
  T.attach = function (g) {
    T.game = g;
    var s = g.state;

    // 暴匪挪到玩家附近（约 12-16 寸），方便演示射击/投掷
    var spots = [
      { x: 24, y: 14 }, { x: 27, y: 19 }, { x: 21, y: 24 }, { x: 29, y: 26 }
    ];
    var foes = s.units.filter(function (u) { return u.side === 'rioters'; });
    foes.forEach(function (u, i) {
      var p = spots[i % spots.length];
      u.pos = { x: p.x + (i > 3 ? (i - 3) * 1.2 : 0), y: p.y };
      u.deployed = true;
      u.order = 'conceal';
    });

    // 教程是"单人沙盒"：暴匪回合由观察器直接跳过，不启动 AI

    T.index = 0; T.done = {}; T.active = true; T.snap = null;
    if (T.timer) clearInterval(T.timer);
    T.timer = setInterval(T.watch, 250);
    T.render();
    return g;
  };

  T.detach = function () {
    if (T.timer) { clearInterval(T.timer); T.timer = null; }
    T.active = false;
  };

  /* ---------------- 状态观察（不依赖各按钮的埋点，鲁棒） ---------------- */
  T.snap = null;
  T.timer = null;

  function snapOf(g) {
    var s = g.state;
    // 优先跟踪当前激活的单位，没有激活时退回第一个存活警察
    var me = s.activeId ? s.units.filter(function (u) { return u.id === s.activeId; })[0] : null;
    if (!me) me = s.units.filter(function (u) { return u.side === 'police' && u.alive; })[0];
    var foes = s.units.filter(function (u) { return u.side === 'rioters'; });
    return {
      id: me ? me.id : '',
      x: me ? me.pos.x : 0, y: me ? me.pos.y : 0,
      apUsed: me ? me.apUsed : 0,
      guard: me ? me.guard : null,
      roof: me ? !!me.onRoof : false,
      thrown: me ? (me.throwUsed || []).length : 0,
      foeWounds: foes.reduce(function (n, f) { return n + Math.max(0, f.wounds); }, 0),
      inside: me ? !!g.buildingAt(me.pos) : false,
      activated: !!s.activeId
    };
  }

  T.ticks = 0;
  T.watch = function () {
    if (!T.active || !T.game) return;
    var gg = T.game, ss = gg.state;

    // 暴匪回合：把暴匪标记为已行动，交回给玩家（不结束转折点，避免教程自己跑完）
    if (ss.phase === 'battle' && !ss.activeId && ss.actingSide === 'rioters') {
      ss.units.forEach(function (u) {
        if (u.alive && u.side === 'rioters') u.state = 'spent';
      });
      ss.actingSide = 'police';
    }

    var now = snapOf(T.game), was = T.snap;
    T.snap = now;
    if (!was) return;
    // 激活（不依赖界面埋点，状态一变就认）
    if (now.activated && !was.activated) T.notify('activate');
    var moved = (now.id === was.id) ? Math.hypot(now.x - was.x, now.y - was.y) : 0;
    var curStep = T.steps[T.index] ? T.steps[T.index].key : '';
    if (moved > 9.5) T.notify('dash');
    else if (moved > 0.5) {
      T.notify('move');
      // 兜底：教程正等"冲刺"，一次跑动 6 寸以上也算（避免玩家卡住）
      if (curStep === 'dash' && moved > 0.5) T.notify('dash');
    }
    if (now.foeWounds < was.foeWounds) T.notify('shoot');
    if (now.guard && !was.guard) T.notify('guard');
    if (now.thrown > was.thrown) T.notify('throw');
    if (now.roof && !was.roof) T.notify('stairs');
    if (now.inside && !was.inside) T.notify('door');
  };

  /* ---------------- 推进 ---------------- */
  T.notify = function (tag) {
    if (!T.active) return;
    T.done[tag] = true;
    var step = T.steps[T.index];
    if (step && step.key === tag) T.advance();
  };

  T.advance = function () {
    T.index++;
    if (T.index >= T.steps.length) { T.finish(); return; }
    T.render();
  };

  T.finish = function () {
    T.active = false;
    if (T.timer) { clearInterval(T.timer); T.timer = null; }
    var el = document.getElementById('tut-banner');
    if (el) el.remove();
    if (GLOBAL.toast) toast('教程结束，可以继续打这一局');
    if (typeof GLOBAL.__afterTutorial === 'function') GLOBAL.__afterTutorial();
  };

  T.render = function () {
    var el = document.getElementById('tut-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tut-banner';
      document.body.appendChild(el);
    }
    var step = T.steps[T.index];
    if (!step) return;
    var dots = T.steps.map(function (s, i) {
      return '<i class="' + (i < T.index ? 'done' : (i === T.index ? 'cur' : '')) + '"></i>';
    }).join('');
    el.innerHTML = '<div class="tut-head"><b>新手教程 ' + (T.index + 1) + '/' + T.steps.length + '</b>' +
      '<span class="tut-dots">' + dots + '</span>' +
      '<button class="tut-skip">跳过教程</button></div>' +
      '<div class="tut-title">' + step.title + '</div>' +
      '<div class="tut-hint">' + step.hint + '</div>';
    var btn = el.querySelector('.tut-skip');
    if (btn) btn.onclick = function () { T.finish(); };
  };

  T.isActive = function () { return T.active; };
})(window);
