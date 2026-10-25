/* ==========================================================================
 * C 区 · 橙色 —— 规则引擎
 * 纯逻辑、无 DOM。可在 Node 下直接 require 做自测（见 tests/engine.test.js）。
 * 规则基准：本项目战术小队规则（docs/规则摘要.md）
 * ========================================================================== */
(function (root, factory) {
  var DATA = (typeof module !== 'undefined' && module.exports)
    ? require('./data.js')
    : root.DATA;
  var api = factory(DATA);
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.ENGINE = api; }
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  'use strict';

  var C = DATA.CONFIG;

  /* ------------------------------------------------------------ 随机数 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------ 几何 */
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  function rectCenter(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  function segRectHit(x1, y1, x2, y2, r) {
    // 线段与轴对齐矩形是否相交（含内部）
    var dx = x2 - x1, dy = y2 - y1;
    var t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy];
    var q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
    for (var i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-9) {
        if (q[i] < 0) return false;
      } else {
        var t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }

  function circleRectOverlap(cx, cy, rad, r) {
    var nx = Math.max(r.x, Math.min(cx, r.x + r.w));
    var ny = Math.max(r.y, Math.min(cy, r.y + r.h));
    return Math.hypot(cx - nx, cy - ny) <= rad;
  }

  function distPointRect(p, r) {
    var nx = Math.max(r.x, Math.min(p.x, r.x + r.w));
    var ny = Math.max(r.y, Math.min(p.y, r.y + r.h));
    return Math.hypot(p.x - nx, p.y - ny);
  }

  /* ==================================================================== */
  /*  引擎 */
  /* ==================================================================== */
  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed || 1337;
    var rng = mulberry32(seed);
    var mission = DATA.MISSION;
    var map = DATA.MAP;

    var state = {
      seed: seed,
      map: map,
      mission: mission,
      tp: 0,
      phase: 'setup',          // setup | deploy | battle | end
      initiative: null,
      activeId: null,
      actingSide: null,
      units: [],
      markers: [],
      sides: {
        police: newSide('police', opts.police),
        rioters: newSide('rioters', opts.rioters)
      },
      deploy: { round: 0, side: 'police', remaining: { police: 0, rioters: 0 } },
      smokes: [],           // 烟雾弹区域
      fires: [],            // 燃烧区域
      pendingGuard: null,   // 待决的警戒触发
      pendingMove: null,    // 被打断的移动，放弃警戒后继续走
      log: [],
      winner: null,
      turnStats: { police: 0, rioters: 0 }
    };

    function newSide(id, roster) {
      return {
        id: id,
        cp: 0,
        vp: 0,
        vpByOp: { critical: 0, kill: 0 },
        kills: 0,
        killLevel: 0,
        killThresholds: [],
        cards: [],
        primary: null,       // 'critical' | 'kill'
        roster: roster || null,
        started: 0
      };
    }

    /* ---------------------------------------------------------- 编成 */
    function buildRoster(sideId, rosterCfg) {
      var fac = DATA.FACTIONS[sideId];
      var units = [];
      var n = 0;
      if (sideId === 'police') {
        fac.units.forEach(function (tpl) {
          var count = tpl.count || 1;
          for (var i = 0; i < count; i++) {
            n++;
            units.push(makeUnit(tpl, n, sideId, i));
          }
        });
      } else {
        units = buildRioters(fac, rosterCfg, makeUnit);
        n = units.length;
      }
      state.sides[sideId].started = units.length;
      return units;
    }

    /** 装备常驻效果 */
    function applyEquipPassives(u) {
      (u.equip || []).forEach(function (id) {
        var E = DATA.EQUIP[id];
        if (!E || !E.eff) return;
        var f = E.eff;
        if (f.save) u.save = Math.max(2, u.save - f.save);
        if (f.range) u.rangeBonus = (u.rangeBonus || 0) + f.range;
        if (f.precision) u.precBonus = (u.precBonus || 0) + f.precision;
        if (f.camo) u.camo = true;
        if (f.reveal) u.scanner = true;
        if (f.shieldDrone) u.shieldDrone = true;
        if (f.droneShot) u.droneShot = true;
        if (f.scout) u.scout = true;
        if (f.freeDoor) u.freeDoor = f.freeDoor;
        if (f.heal) u.medkit = f.heal;
        if (f.extraAP) u.radioAP = true;
        if (f.stim) u.stimEquip = true;
        if (f.jam) u.jammer = true;
        if (f.emp) u.empPack = true;
      });
      return u;
    }

    function makeUnit(tpl, n, sideId, idx) {
      var u = _makeUnit(tpl, n, sideId, idx);
      applyEquipPassives(u);
      return u;
    }

    function _makeUnit(tpl, n, sideId, idx) {
      var fac = DATA.FACTIONS[sideId];
      return {
        id: sideId + '_' + tpl.key + '_' + n,
        side: sideId,
        key: tpl.key,
        name: tpl.name + ' ' + n,
        role: tpl.role || '',
        apl: tpl.apl,
        aplMax: tpl.apl,
        move: Math.round(tpl.move * C.PACE),
        save: tpl.save,
        wounds: tpl.wounds,
        maxWounds: tpl.wounds,
        weapons: (function () {
          var lo = opts.loadout && (opts.loadout[tpl.key + '#' + idx] || opts.loadout[tpl.key]);
          if (!lo) return tpl.weapons.slice();
          if (Array.isArray(lo)) return lo.slice();
          var out = [];
          if (lo.primary) out.push(lo.primary);
          if (lo.melee) out.push(lo.melee);
          if (!out.length) return tpl.weapons.slice();
          // 保留单位自带的盾之类
          tpl.weapons.forEach(function (w) {
            var wp = DATA.WEAPONS[w];
            if (wp && wp.type === 'shield' && out.indexOf(w) < 0) out.push(w);
          });
          return out;
        })(),
        equip: (function () {
          var src = (opts.equip && (opts.equip[tpl.key + '#' + idx] || opts.equip[tpl.key])) || [];
          return src.slice();
        })(),
        abilities: tpl.abilities || [],
        keywords: tpl.keywords || [],
        color: fac.color,
        order: 'conceal',
        state: 'ready',        // ready | spent
        pos: { x: 0, y: 0 },
        elevation: 0,
        alive: true,
        apUsed: 0,
        actionsThisActivation: [],
        movedThisActivation: false,
        reactedThisTP: false,
        guard: null,            // overwatch | sentry | cover
        guardUsed: false,
        carrying: null,
        isLeader: tpl.key === 'sheriff' || tpl.key === 'boss',
        tpStats: {}
      };
    }

    function buildRioters(fac, cfg, mk) {
      cfg = cfg || {};
      var swaps = Math.max(0, Math.min(4, cfg.swaps || 0));
      var picks = cfg.picks || [];        // 每次换装选哪个套装 id
      var total = 18 - swaps;
      var list = [];
      var n = 0;
      // 首领
      n++; list.push(mk(fac.units[0], n, 'rioters', 0));
      // 其余按 打手→枪手→拾荒者 的原始构成压缩：优先保留枪手与拾荒者
      var pool = [];
      // 其余单位统一按第二个模板（暴徒/警员）铺开，兼容旧的三段式构成
      var base = fac.units[1];
      for (var i = 0; i < (base.count || 0); i++) pool.push(base);
      for (var u = 2; u < fac.units.length; u++) {
        var extra = fac.units[u];
        for (var j = 0; j < (extra.count || 1); j++) pool.push(extra);
      }
      // 减员：从后往前砍（先砍打手，保留特色单位）
      pool = pool.slice(0, total - 1);
      var perKey = {};
      pool.forEach(function (tpl) {
        n++;
        var k = perKey[tpl.key] || 0;
        perKey[tpl.key] = k + 1;
        list.push(mk(tpl, n, 'rioters', k));
      });

      // 换装：给幸存者加装
      for (var s = 0; s < swaps; s++) {
        var opt = ((fac.trade || {}).options || []).filter(function (o) { return o.id === (picks[s] || 'rifle'); })[0];
        if (!opt) continue;
        // 选一个还没有该装备的非首领单位
        var cand = list.filter(function (u) {
          return !u.isLeader && !u.upgraded;
        })[0];
        if (!cand) break;
        cand.upgraded = opt.id;
        if (opt.apply.replaceWeapon) {
          var idx = cand.weapons.indexOf(opt.apply.replaceWeapon[0]);
          if (idx >= 0) cand.weapons[idx] = opt.apply.replaceWeapon[1];
          else cand.weapons.push(opt.apply.replaceWeapon[1]);
        }
        if (opt.apply.saveBonus) {
          cand.save = Math.max(2, cand.save + opt.apply.saveBonus);
        }
        cand.name += '（改装）';
      }
      return list;
    }

    /* ---------------------------------------------------------- 初始化 */
    function setup() {
      state.units = buildRoster('police').concat(buildRoster('rioters', state.sides.rioters.roster));
      resolveCenter();
      state.markers = map.objectives.map(function (o, i) {
        return {
          id: o.id, name: o.label, x: o.x, y: o.y,
          carriedBy: null, side: null, index: i,
          kind: o.kind || 'center', taken: false, radius: o.radius || 0
        };
      });
      // 一次性拾取目标：随机撒在"确实走得到"的地方
      var pickCfg = map.pickups || { count: 0 };
      if (pickCfg.count > 0) {
        var spots = pickPickupSpots(pickCfg);
        spots.forEach(function (p, i) {
          state.markers.push({
            id: 'pick_' + (i + 1),
            name: (pickCfg.labels && pickCfg.labels[i % pickCfg.labels.length]) || ('补给 ' + (i + 1)),
            x: p.x, y: p.y,
            carriedBy: null, side: null, index: state.markers.length,
            kind: 'pickup', value: pickCfg.value || 2, taken: false
          });
        });
      }
      ['police', 'rioters'].forEach(function (sid) {
        var th = mission.killThresholds[state.sides[sid].started] || mission.killThresholdDefault;
        state.sides[sid].killThresholds = th.slice();
      });
      state.phase = 'deploy';
      state.deploy.remaining.police = state.sides.police.started;
      state.deploy.remaining.rioters = state.sides.rioters.started;
      log('战斗开始：' + state.sides.police.started + ' 名武装警察 vs ' + state.sides.rioters.started + ' 名暴匪。');
      startDeployment();
      return state;
    }

    function log(text, kind) {
      state.log.push({ tp: state.tp, text: text, kind: kind || 'info' });
      if (state.log.length > 400) state.log.shift();
    }

    /* ---------------------------------------------------------- 部署 */
    function startDeployment() {
      // 战前拼骰定先手（平手重投）
      var a = d6(), b = d6();
      while (a === b) { a = d6(); b = d6(); }
      state.initiative = a > b ? 'police' : 'rioters';
      var loser = state.initiative === 'police' ? 'rioters' : 'police';
      state.sides[loser].cards.push({ type: 'reroll', id: 'reroll' });
      log('部署拼骰：警方 ' + a + ' vs 暴匪 ' + b + '，' + sideName(state.initiative) + ' 获得先手，' +
        sideName(loser) + ' 获得「重投先手权」卡。', 'init');
      state.deploy.side = state.initiative;
      state.deploy.round = 0;
      state.deploy.remaining = {
        police: state.sides.police.started,
        rioters: state.sides.rioters.started
      };
    }

    function deployUnit(unitId, x, y) {
      if (state.phase !== 'deploy') return fail('当前不在部署阶段');
      var u = unit(unitId);
      if (!u || !u.alive) return fail('特工不存在');
      if (u.side !== state.deploy.side) return fail('现在轮到对手部署');
      if (u.deployed) return fail('该特工已部署');
      var zone = map.dropZones[u.side];
      if (!inRect({ x: x, y: y }, zone)) return fail('必须部署在己方集结区内');
      if (!canPlace(u, x, y)) return fail('该位置无法放置（与其他模型或地形重叠）');
      u.pos = { x: x, y: y };
      u.deployed = true;
      var db = buildingAt({ x: x, y: y });
      if (db) { u.onRoof = true; u.elevation = C.ROOF_H; }
      u.order = 'conceal';
      state.deploy.remaining[u.side]--;
      log(sideName(u.side) + ' 部署 ' + u.name + '。', 'deploy');

      // 三方轮换：每轮每家部署 1/3（向上取整），从先手方开始
      advanceDeployTurn();
      return ok();
    }

    /** 部署候选位（按"靠近街道中线 + 靠近推进侧"排序），供 UI/AI/测试复用 */
    function deployCandidates(sid) {
      var z = map.dropZones[sid];
      var inner = sid === 'police' ? z.x + z.w - 1.8 : z.x + 1.8;
      var out = [];
      for (var y = z.y + 1.2; y < z.y + z.h - 1.2; y += 1.4) {
        for (var x = z.x + 1.2; x < z.x + z.w - 1.2; x += 1.4) {
          out.push({ x: x, y: y, score: Math.abs(y - map.boardH / 2) + Math.abs(x - inner) * 0.8 });
        }
      }
      out.sort(function (a, b) { return a.score - b.score; });
      return out;
    }

    /** 给某个特工找一个合理的部署位：按角色分前后、互相拉开、尽量靠掩体 */
    function findDeploySpot(u) {
      var z = map.dropZones[u.side];
      if (!z) return null;
      var isPolice = u.side === 'police';

      // 角色倾向：0 = 后排（远离敌人），1 = 前排（贴近敌人）
      var hasRanged = (u.weapons || []).some(function (w) {
        var W = DATA.WEAPONS[w];
        return W && W.type === 'ranged';
      });
      var pref = 0.5;
      if (u.isLeader) pref = 0.25;                       // 指挥/首领压后
      else if (!hasRanged) pref = 0.8;                   // 纯近战冲前面
      else if (u.apl >= 4) pref = 0.55;
      else pref = 0.35;

      var allies = state.units.filter(function (o) {
        return o.side === u.side && o.deployed && o.alive;
      });

      var best = null, bestScore = -1e9;
      for (var x = z.x + 1.1; x <= z.x + z.w - 1.1; x += 1.1) {
        for (var y = z.y + 1.1; y <= z.y + z.h - 1.1; y += 1.1) {
          if (!canPlace(u, x, y)) continue;

          // 前后位置：警方向东推进，暴匪向西
          var t = isPolice ? (x - z.x) / z.w : (z.x + z.w - x) / z.w;
          var score = -Math.abs(t - pref) * 14;

          // 和已部署友军拉开距离
          var minD = 99;
          for (var i = 0; i < allies.length; i++) {
            var d = dist({ x: x, y: y }, allies[i].pos);
            if (d < minD) minD = d;
          }
          if (minD < 2.4) score -= (2.4 - minD) * 16;
          else if (minD < 3.6) score -= (3.6 - minD) * 2.5;

          // 靠掩体加分（近战/后排更看重）
          for (var k = 0; k < map.terrain.length; k++) {
            var tr = map.terrain[k];
            if (!tr.cover || tr.cover === 'none') continue;
            if (distPointRect({ x: x, y: y }, tr) <= 1.2) { score += 3.5; break; }
          }

          // 不要全挤在中线上
          score -= Math.abs(y - (z.y + z.h / 2)) * 0.55;

          if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
        }
      }
      return best;
    }


    /** 与所有实体地形保持净空 */
    function clearOf(x, y, margin) {
      for (var i = 0; i < map.terrain.length; i++) {
        var t = map.terrain[i];
        if (!t.solid) continue;
        if (x > t.x - margin && x < t.x + t.w + margin && y > t.y - margin && y < t.y + t.h + margin) return false;
      }
      return true;
    }

    /** 中央点如果压在障碍上/太贴，找最近的净空点 */
    function resolveCenter() {
      var o = map.objectives[0];
      if (!o) return;
      if (walkableAt(o.x, o.y) && clearOf(o.x, o.y, 1.6)) return;
      for (var r = 0.5; r <= 20; r += 0.5) {
        for (var a = 0; a < 24; a++) {
          var ang = a / 24 * Math.PI * 2;
          var x = o.x + Math.cos(ang) * r, y = o.y + Math.sin(ang) * r;
          if (x < 3 || y < 3 || x > map.boardW - 3 || y > map.boardH - 3) continue;
          if (walkableAt(x, y) && clearOf(x, y, 1.6)) { o.x = x; o.y = y; return; }
        }
      }
    }

    /** 某个坐标能不能站人（不压实体地形） */
    function walkableAt(x, y) {
      var R = C.BASE_RADIUS * 0.9;
      if (x < R || y < R || x > map.boardW - R || y > map.boardH - R) return false;
      for (var i = 0; i < map.terrain.length; i++) {
        var t = map.terrain[i];
        if (!t.solid) continue;
        if (x > t.x - R && x < t.x + t.w + R && y > t.y - R && y < t.y + t.h + R) return false;
      }
      return true;
    }

    /** 从中央目标出发做 4 连通洪泛，得到"能走到的格子" */
    function reachableCells(step) {
      step = step || 1;
      var W = Math.ceil(map.boardW / step), H = Math.ceil(map.boardH / step);
      var start = map.objectives[0] || { x: map.boardW / 2, y: map.boardH / 2 };
      var sx = Math.max(0, Math.min(W - 1, Math.round(start.x / step)));
      var sy = Math.max(0, Math.min(H - 1, Math.round(start.y / step)));
      var seen = {}, out = [], q = [[sx, sy]];
      seen[sy * W + sx] = 1;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var guard = 0;
      while (q.length && guard++ < 20000) {
        var cur = q.shift();
        out.push({ x: cur[0] * step, y: cur[1] * step });
        for (var k = 0; k < 4; k++) {
          var nx = cur[0] + dirs[k][0], ny = cur[1] + dirs[k][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var key = ny * W + nx;
          if (seen[key]) continue;
          if (!walkableAt(nx * step, ny * step)) continue;
          seen[key] = 1;
          q.push([nx, ny]);
        }
      }
      return out;
    }

    /** 随机挑 N 个拾取点：彼此拉开、离中央够远、避开部署区 */
    function pickPickupSpots(cfg) {
      var cells = reachableCells(1);
      var zones = map.dropZones || {};
      var center = map.objectives[0] || { x: map.boardW / 2, y: map.boardH / 2 };
      var picked = [];
      var tries = 0;
      while (picked.length < (cfg.count || 0) && tries++ < 3000) {
        var c = cells[Math.floor(Math.random() * cells.length)];
        if (!c) break;
        if (c.x < 2.2 || c.y < 2.2 || c.x > map.boardW - 2.2 || c.y > map.boardH - 2.2) continue;
        if (Math.hypot(c.x - center.x, c.y - center.y) < (cfg.centerGap || 9)) continue;
        var inZone = Object.keys(zones).some(function (s) {
          var z = zones[s];
          return c.x >= z.x - 1 && c.x <= z.x + z.w + 1 && c.y >= z.y - 1 && c.y <= z.y + z.h + 1;
        });
        if (inZone) continue;
        var tooClose = picked.some(function (p) {
          return Math.hypot(p.x - c.x, p.y - c.y) < (cfg.minGap || 7);
        });
        if (tooClose) continue;
        picked.push({ x: c.x, y: c.y });
      }
      return picked;
    }

    function advanceDeployTurn() {
      var other = state.deploy.side === 'police' ? 'rioters' : 'police';
      if (state.deploy.remaining[other] > 0) state.deploy.side = other;
      if (state.deploy.remaining.police === 0 && state.deploy.remaining.rioters === 0) {
        finishDeployment();
      }
    }

    function finishDeployment() {
      state.phase = 'battle';
      state.tp = 0;
      state.sides.police.cp = 0;
      state.sides.rioters.cp = 0;
      log('部署完成。战斗开始，共 ' + C.TURNING_POINTS + ' 个转折点。', 'phase');
      nextTurningPoint();
    }

    /* ------------------------------------------------------ 转折点循环 */
    function nextTurningPoint() {
      state.tp++;
      if (state.tp > C.TURNING_POINTS) { finishGame(); return state; }

      // 先手权：拼骰 + 先手权卡
      var initRes = resolveInitiative();
      state.initiative = initRes.winner;
      state.actingSide = state.initiative;

      // CP
      ['police', 'rioters'].forEach(function (sid) {
        var gain = sid === state.initiative ? 1 : (state.tp === 1 ? 1 : 2);
        // 敌方携带信号干扰器 → 本次 CP 获取 -1
        var foe = sid === 'police' ? 'rioters' : 'police';
        var jammed = state.units.some(function (u) {
          return u.alive && u.side === foe && u.jammer;
        });
        if (jammed && gain > 0) {
          gain = Math.max(0, gain - 1);
          log(sideName(foe) + ' 的信号干扰器生效，' + sideName(sid) + ' 本回合 CP -1。', 'phase');
        }
        state.sides[sid].cp += gain;
      });
      // 就绪
      state.units.forEach(function (u) {
        if (!u.alive) return;
        u.state = 'ready';
        u.apUsed = 0;
        u.actionsThisActivation = [];
        u.reactedThisTP = false;
        u.freeAp = u.freeAp || 0;
        u.activatedThisTP = false;
      });
      state.activeId = null;
      state.phase = 'battle';
      state.tpPhase = 'strategic';   // strategic | engagement
      log('—— 第 ' + state.tp + ' 转折点 —— ' + sideName(state.initiative) + ' 拥有先手权。', 'phase');
      return state;
    }

    function resolveInitiative() {
      var a = d6(), b = d6();
      var res = { rolls: { police: a, rioters: b }, plays: [] };
      var sides = ['police', 'rioters'];
      // 平手不重投：由当前没有先手权的一方获胜
      if (a === b) {
        var cur = state.initiative;
        res.winner = cur === 'police' ? 'rioters' : 'police';
        res.tie = true;
        log('先手拼骰平手（' + a + ':' + b + '），由无先手权的一方（' + sideName(res.winner) + '）获得先手。', 'init');
        awardCardToLoser(res.winner);
        return res;
      }
      var loser = a < b ? 'police' : 'rioters';
      var order = [loser, loser === 'police' ? 'rioters' : 'police'];
      // 轮流打牌或让过
      var passed = { police: false, rioters: false };
      var guard = 0;
      while (guard++ < 12) {
        var anyPlayed = false;
        for (var i = 0; i < order.length; i++) {
          var sid = order[i];
          if (passed[sid]) continue;
          var card = bestCardFor(sid, res, order[0]);
          if (card) {
            playCard(sid, card, res);
            res.plays.push({ side: sid, card: card.id });
            anyPlayed = true;
          } else {
            passed[sid] = true;
          }
        }
        if (passed.police && passed.rioters) break;
        if (!anyPlayed) break;
      }
      res.winner = res.rolls.police >= res.rolls.rioters ? 'police' : 'rioters';
      log('先手拼骰：警方 ' + res.rolls.police + ' vs 暴匪 ' + res.rolls.rioters + ' → ' +
        sideName(res.winner) + ' 获胜。', 'init');
      if (res.plays.length) {
        log('先手权卡：' + res.plays.map(function (p) {
          return sideName(p.side) + ' 打出 ' + p.card;
        }).join('，') + '。', 'init');
      }
      awardCardToLoser(res.winner);
      return res;
    }

    function awardCardToLoser(winner) {
      var loser = winner === 'police' ? 'rioters' : 'police';
      if (state.tp >= C.TURNING_POINTS) return;
      state.sides[loser].cards.push({ type: 'mod', v: state.tp, id: '+' + state.tp + '/-' + state.tp });
    }

    function bestCardFor(sid, res, firstSide) {
      var me = res.rolls[sid], foe = res.rolls[sid === 'police' ? 'rioters' : 'police'];
      var cards = state.sides[sid].cards;
      if (!cards.length) return null;
      // 落后才打，且优先能反超的最小卡
      var behind = me < foe;
      var reroll = cards.filter(function (c) { return c.type === 'reroll'; })[0];
      var mods = cards.filter(function (c) { return c.type === 'mod'; });
      if (!behind) {
        // 领先时不浪费；除非平手且必须先手
        return null;
      }
      var need = foe - me;
      var usable = mods.filter(function (c) { return c.v >= need; })
        .sort(function (x, y) { return x.v - y.v; })[0];
      if (usable && usable.v <= 3) return usable;
      if (reroll) return reroll;
      return null;
    }

    function playCard(sid, card, res) {
      var i = state.sides[sid].cards.indexOf(card);
      if (i >= 0) state.sides[sid].cards.splice(i, 1);
      if (card.type === 'reroll') {
        res.rolls[sid] = d6();
        log(sideName(sid) + ' 使用重投卡，新结果 ' + res.rolls[sid] + '。', 'init');
      } else {
        var me = res.rolls[sid], foe = res.rolls[sid === 'police' ? 'rioters' : 'police'];
        var sign = (me <= foe) ? 1 : -1;
        var val = me + sign * card.v;
        if (val < 1) val = 1;
        res.rolls[sid] = val;
        log(sideName(sid) + ' 使用 ' + card.id + ' 卡，结果修正为 ' + val + '。', 'init');
      }
    }

    /* ------------------------------------------------------------ 激活 */
    function activate(unitId, order) {
      if (state.phase !== 'battle') return fail('不在战斗阶段');
      var u = unit(unitId);
      if (!u || !u.alive) return fail('特工不存在');
      if (u.state !== 'ready') return fail('该特工已待机');
      if (u.side !== state.actingSide) return fail('现在不是该方的激活窗口');
      state.activeId = unitId;
      u.state = 'active';
      u.apUsed = 0;
      u.actionsThisActivation = [];
      u.movedThisActivation = false;
      u.activatedThisTP = true;
      if (order) u.order = order;
      u.order = order || u.order || 'conceal';
      state.tpPhase = 'engagement';
      log(sideName(u.side) + ' 激活 ' + u.name + '（' + (u.order === 'engage' ? '交战' : '隐匿') + '命令）。', 'act');
      return ok();
    }

    function apLeft(u) { return u.apl - u.apUsed; }

    function spend(u, n) {
      if (u.freeAp > 0) { u.freeAp -= 1; return; }   // 袖章送的免费动作
      u.apUsed += n;
    }

    /* ------------------------------------------------------------ 移动 */
    /*
     * 路径 = [{x,y}, ...] 航点（不含起点）。
     * 每段向上取整，合计为消耗；预算 = 上限。
     */
    function pathCost(unitRef, pts) {
      var cost = 0, prev = unitRef.pos;
      for (var i = 0; i < pts.length; i++) {
        cost += Math.ceil(dist(prev, pts[i]) - 1e-9);
        prev = pts[i];
      }
      return cost;
    }

    function blockReason(u, from, to, opts) {
      opts = opts || {};
      var steps = 6;
      // 冲锋就是要贴到 1 寸内，所以只禁止"从敌人身上穿过去"（基座重叠）
      var ignoreEnemies = !!opts.ignoreEnemies;
      var minSep = ignoreEnemies ? C.BASE_RADIUS * 0.95 : C.BASE_RADIUS * 2;
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        if (p.x < C.BASE_RADIUS || p.y < C.BASE_RADIUS ||
            p.x > C.BOARD_W - C.BASE_RADIUS || p.y > C.BOARD_H - C.BASE_RADIUS) {
          return '移动不能离开棋盘';
        }
        for (var k = 0; k < map.terrain.length; k++) {
          var t2 = map.terrain[k];
          if (!t2.solid) continue;
          if (circleRectOverlap(p.x, p.y, C.BASE_RADIUS, t2)) return '被' + t2.label + '阻挡';
        }
        // 普通移动：首尾点由 canPlace 单独校验；冲锋：全程只禁止穿过基座
        if (ignoreEnemies || (i > 0 && i < steps)) {
          for (var j = 0; j < state.units.length; j++) {
            var o = state.units[j];
            if (!o.alive || o.id === u.id) continue;
            if (o.side === u.side) continue;            // 己方可以穿过
            if (Math.hypot(p.x - o.pos.x, p.y - o.pos.y) < minSep) return '不能穿过敌方特工';
          }
        }
      }
      return null;
    }

    function moveUnit(u, pts, budget, opts) {
      opts = opts || {};
      if (!pts || !pts.length) return fail('没有移动路径');
      for (var pi = 0; pi < pts.length; pi++) {
        var pp = pts[pi];
        if (!pp || typeof pp.x !== 'number' || typeof pp.y !== 'number' ||
            !isFinite(pp.x) || !isFinite(pp.y)) {
          return fail('移动路径里有无效坐标');
        }
      }
      var cost = pathCost(u, pts);
      var end = pts[pts.length - 1];
      // 高度差：上平台要攀爬（最少 2"），下平台 2" 内免费跳落
      var startElev = elevationAt(u.pos), endElev = elevationAt(end);
      var dz = endElev - startElev, extra = 0;
      if (dz > 0) extra = Math.max(C.CLIMB_MIN, dz);
      else if (dz < 0) extra = Math.max(0, -dz - C.FALL_FREE);
      cost += extra;
      if (cost > budget) return fail('移动距离不足（需要 ' + cost + '"，可用 ' + budget + '"）');
      if (!canPlace(u, end.x, end.y, { forCharge: !!opts.mustEndInControl })) return fail('终点无法放置');
      if (u.onRoof) {
        var rb = buildingAt(end);
        if (!rb || rb !== buildingAt(u.pos)) return fail('屋顶上只能在建筑范围内移动（下楼请用楼梯）');
      }
      var prev = u.pos;
      for (var i = 0; i < pts.length; i++) {
        var reason = blockReason(u, prev, pts[i], { ignoreEnemies: !!opts.mustEndInControl });
        if (reason) return fail(reason);
        prev = pts[i];
      }
      // 敌方控制范围限制
      if (!opts.ignoreControl) {
        var enemies = enemiesInControlOf(end, u.side);
        if (opts.mustEndInControl) {
          if (!enemies.length) return fail('冲锋必须在敌方控制范围内结束');
        } else if (enemies.length && !opts.allowEndInControl) {
          return fail('不能在敌方控制范围内结束移动');
        }
        var startEnemies = enemiesInControlOf(u.pos, u.side);
        if (!opts.allowEnterControl && startEnemies.length === 0) {
          // 检查是否穿过了敌方控制范围（近似：路径抽样点）
          for (var s = 0; s < pts.length; s++) {
            var seg = sampleSegment(u.pos, pts[s], 8);
            for (var q = 0; q < seg.length; q++) {
              if (enemiesInControlOf(seg[q], u.side).length) {
                return fail('不能移动穿过敌方控制范围');
              }
            }
          }
        }
      }
      // 逐段推进：途中若进入敌方警戒射界，立刻打断并结算
      if (!opts.ignoreGuard && !guardBusy) {
        guardBusy = true;
        var guardShots = [];
        var stopAt = null;
        try {
          var cur = { x: u.pos.x, y: u.pos.y };
          scan:
          for (var wi = 0; wi < pts.length; wi++) {
            var wp = pts[wi];
            var n = Math.max(1, Math.ceil(dist(cur, wp) / 0.5));
            for (var si = 1; si <= n; si++) {
              var sp = {
                x: cur.x + (wp.x - cur.x) * si / n,
                y: cur.y + (wp.y - cur.y) * si / n
              };
              var watcher = overwatchAt(u, sp);
              if (!watcher) continue;
              stopAt = sp;
              u.pos = { x: sp.x, y: sp.y };
              u.elevation = elevationAt(sp);
              // 只挂起，等玩家/AI 决定要不要开火（不强制）
              state.pendingGuard = {
                kind: 'overwatch',
                watcherId: watcher.id,
                moverId: u.id,
                at: { x: sp.x, y: sp.y }
              };
              state.pendingMove = {
                unitId: u.id,
                pts: pts.slice(),
                fromIndex: wi,
                mode: 'move'
              };
              break scan;
            }
            cur = wp;
          }
        } finally {
          guardBusy = false;
        }
        if (stopAt) {
          u.pos = { x: stopAt.x, y: stopAt.y };
          u.elevation = u.onRoof ? C.ROOF_H : elevationAt(stopAt);
          return { ok: true, cost: cost, extra: extra, dz: dz,
            interrupted: true, killed: !u.alive, guardShots: guardShots };
        }
      }
      u.pos = { x: end.x, y: end.y };
      u.elevation = u.onRoof ? C.ROOF_H : elevationAt(end);
      return { ok: true, cost: cost, extra: extra, dz: dz, interrupted: false, guardShots: [] };
    }

    function sampleSegment(a, b, n) {
      var out = [];
      for (var i = 1; i <= n; i++) {
        out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
      }
      return out;
    }

    function elevationAt(p) {
      for (var i = 0; i < map.terrain.length; i++) {
        var t = map.terrain[i];
        if (t.elevated && inRect(p, t)) return t.height;
      }
      return 0;
    }

    function canPlace(u, x, y, opts) {
      opts = opts || {};
      if (x < C.BASE_RADIUS || y < C.BASE_RADIUS || x > C.BOARD_W - C.BASE_RADIUS || y > C.BOARD_H - C.BASE_RADIUS) return false;
      var p = { x: x, y: y };
      for (var i = 0; i < map.terrain.length; i++) {
        var t = map.terrain[i];
        if (!t.solid) continue;
        if (circleRectOverlap(x, y, C.BASE_RADIUS, t)) return false;
      }
      for (var j = 0; j < state.units.length; j++) {
        var o = state.units[j];
        if (!o.alive || o.id === u.id) continue;
        var sep = opts.forCharge ? C.BASE_RADIUS * 1.62 : C.BASE_RADIUS * 1.9;
        if (Math.hypot(x - o.pos.x, y - o.pos.y) < sep) return false;
      }
      return true;
    }

    function enemiesInControlOf(p, side) {
      return state.units.filter(function (o) {
        return o.alive && o.side !== side && dist(o.pos, p) <= C.CONTROL_RANGE &&
          hasLineOfSight(o.pos, p, o.elevation, elevationAt(p)).visible;
      });
    }

    /* ------------------------------------------------------- 可见/掩护 */
    function losParts(from, to, fromElev, toElev) {
      var parts = [];
      for (var i = 0; i < map.terrain.length; i++) {
        var t = map.terrain[i];
        if (t.cover === 'none' || !t.los) continue;
        // 高度：低矮地形不阻挡视线（除非双方都贴地且很近）
        var h = t.height || 0;
        if (h < 2.5) continue;
        if (segRectHit(from.x, from.y, to.x, to.y, t)) {
          // 制高点平台不阻挡水平视线（高度足够时再看）
          parts.push(t);
        }
      }
      return parts;
    }

    /**
     * 视线判定：返回 {visible, parts, cover, obscured, coverParts}
     * 简化依据附录 1：
     *  - 阻碍 = 线段穿过地形"部分"
     *  - 掩护 = 阻碍部分在目标 1" 内，且双方距离 > 2"
     *  - 遮挡 = 阻碍部分为重型，且不在任一方 1" 内
     */
    function hasLineOfSight(from, to, fromElev, toElev) {
      var parts = losParts(from, to, fromElev || 0, toElev || 0);
      var d = dist(from, to);
      var coverParts = [], obscuring = [];
      for (var i = 0; i < parts.length; i++) {
        var t = parts[i];
        var dTarget = distPointRect(to, t);
        var dFrom = distPointRect(from, t);
        if (dTarget <= 1.0) coverParts.push(t);
        if (t.cover === 'heavy' && dTarget > 1.0 && dFrom > 1.0) obscuring.push(t);
      }
      // 整栋废墟：目标在废墟占地内（或紧贴边缘）就算重型掩体
      var zoneCover = false;
      for (var zi = 0; zi < map.terrain.length; zi++) {
        var zt = map.terrain[zi];
        if (!zt.coverZone) continue;
        if (distPointRect(to, zt) <= 0.4) { zoneCover = true; break; }
      }
      var cover = (coverParts.length > 0 || zoneCover) && d > C.NO_COVER_FROM;
      return {
        visible: true,             // 本作不做"完全遮挡"（封闭地形除外，见下）
        parts: parts,
        coverParts: coverParts,
        cover: cover,
        obscuredParts: obscuring,
        obscured: obscuring.length > 0
      };
    }

    function shootInfo(attacker, target, weapon) {
      var los = hasLineOfSight(attacker.pos, target.pos, attacker.elevation, target.elevation);
      var d = dist(attacker.pos, target.pos);
      var range = (weapon.range || 99) * C.PACE + (attacker.rangeBonus || 0);
      var outRange = d > range;
      var hasCover = los.cover || shieldDroneCover(target);
      var valid = true, why = '';
      if (d > 0 && outRange) { valid = false; why = '超出武器范围（' + range + '"）'; }
      if (target.order === 'conceal' && hasCover && !attacker.scanner && !target.marked) {
        valid = false; why = '隐匿且拥有掩护，不是有效目标';
      }
      if (target.camo && target.order === 'conceal' && d > 12) {
        valid = false; why = '光学迷彩：超出 12 寸无法锁定';
      }
      if (attacker.order !== 'engage') { valid = false; why = '只有交战命令可以射击'; }
      if (enemiesInControlOf(attacker.pos, attacker.side).length) {
        valid = false; why = '位于敌方控制范围内不能射击';
      }
      if (weapon.rules.indexOf('silent') >= 0 && attacker.order !== 'conceal') {
        valid = false; why = '该武器只能在隐匿命令下使用';
      }
      // 高台精准
      var precision = 0;
      if (attacker.elevation - target.elevation >= C.VANTAGE_PRECISION_2) precision = 2;
      else if (attacker.elevation - target.elevation >= C.VANTAGE_PRECISION_1) precision = 1;
      if (target.order !== 'engage') precision = 0;
      precision += (attacker.precBonus || 0);
      if (target.marked) precision = Math.max(precision, 1);
      return {
        valid: valid, why: why, dist: d, range: range, outRange: outRange,
        cover: hasCover, coverParts: los.coverParts, obscured: los.obscured,
        obscuredParts: los.obscuredParts, precision: precision, los: los
      };
    }

    /* ------------------------------------------------------------ 射击 */
    /**
     * 两阶段射击：
     *   beginShoot() 只掷骰、算好要素，不结算（期间可用指挥重掷花 CP 改骰）
     *   finishShoot() 结算抵挡与伤害
     * shoot() 是两者的同步包装，供测试 / AI 使用。
     */
    function beginShoot(attackerId, targetId, weaponId) {
      var a = unit(attackerId), t = unit(targetId);
      if (!a || !t) return fail('目标不存在');
      if (a.state !== 'active') return fail('只有活跃特工能射击');
      if (apLeft(a) < 1) return fail('AP 不足');
      var w = weaponOf(a, weaponId);
      if (!w || w.type !== 'ranged') return fail('武器不可用');
      if (a.actionsThisActivation.indexOf('shoot') >= 0) return fail('本激活已射击过（行动限制）');
      var info = shootInfo(a, t, w);
      if (!info.valid) return fail(info.why || '不是有效目标');

      var lines = [];
      var hitMod = 0;
      if (w.rules.indexOf('heavy') >= 0 && a.movedThisActivation) hitMod = +1;
      var need = w.hit + hitMod;
      var lethal = w.rules.indexOf('lethal5') >= 0 ? 5 : 6;

      var attack = rollPool(w.attacks, need, lethal, w.rules, lines, '攻击');

      var defDice = C.DEFENSE_DICE;
      var pierce = w.rules.indexOf('piercing2') >= 0 ? 2 : (w.rules.indexOf('piercing1') >= 0 ? 1 : 0);
      var coverSave = false;
      if (info.cover && w.rules.indexOf('focused') < 0) {
        coverSave = true;
        defDice -= 1;
        lines.push('目标有掩护：防御方直接保留 1 个普通成功（掩护豁免）。');
      }
      defDice = Math.max(0, defDice - pierce);
      if (pierce) lines.push('穿刺 ' + pierce + '：防御骰 -' + pierce + '。');
      var def = rollPool(defDice, t.save, 6, [], lines, '防御');

      // 压制：命中后本回合不能反应
      if (a && w.rules.indexOf('stun') >= 0) {
        t.reactedThisTP = true;
        lines.push('压制：' + t.name + ' 本回合无法反应。');
      }
      return {
        ok: true, kind: 'shoot',
        attacker: a.id, target: t.id, weapon: w.id,
        info: info, lines: lines,
        attackDice: attack.dice, attackNeed: need, attackLethal: lethal,
        defenseDice: def.dice, defenseNeed: t.save,
        coverSave: coverSave, pierce: pierce, cpSpent: 0,
        killed: false, damage: 0, resolved: false
      };
    }

    /** 花 1CP 重掷一枚骰子：who = 'attack' | 'defense'，index 从 0 开始 */
    function rerollDie(pending, who, index) {
      if (!pending || pending.resolved) return fail('结算已结束');
      var a = unit(pending.attacker), t = unit(pending.target);
      var sid = who === 'defense' ? t.side : a.side;
      var side = state.sides[sid];
      if (side.cp < 1) return fail(sideName(sid) + ' 没有足够的 CP（需要 1）');
      var pool = who === 'defense' ? pending.defenseDice : pending.attackDice;
      if (index == null || index < 0 || index >= pool.length) return fail('没有可重掷的骰子');
      side.cp -= 1;
      pending.cpSpent += 1;
      var old = pool[index].v;
      var nv = d6();
      pool[index].v = nv;
      pending.rerolled = pending.rerolled || [];
      pending.rerolled.push({ who: who, index: index, from: old, to: nv, side: sid });
      pending.lines.push(sideName(sid) + ' 使用「指挥重掷」（1CP）：' +
        (who === 'defense' ? '防御骰' : '攻击骰') + ' ' + old + ' → ' + nv + '。');
      return { ok: true, value: nv, cpLeft: side.cp };
    }

    function finishShoot(pending) {
      if (!pending || !pending.ok) return pending;
      var a = unit(pending.attacker), t = unit(pending.target);
      var w = DATA.WEAPONS[pending.weapon];
      var info = pending.info;
      var lines = pending.lines;

      var attack = bucketDice(pending.attackDice, pending.attackNeed, pending.attackLethal);
      // 精准：直接把失败骰当作普通成功保留
      if (info.precision > 0) {
        var auto = 0;
        while (auto < info.precision && attack.fails.length) {
          attack.fails.pop();
          attack.normals.push({ v: 0, auto: true });
          auto++;
        }
        if (auto) lines.push('制高点精准 ' + info.precision + '：直接保留 ' + auto + ' 个普通成功。');
      }
      // 遮挡
      if (info.obscured) {
        var pool = attack.normals.concat(attack.crits);
        if (pool.length) pool.pop();
        attack.crits = attack.crits.map(function () { return { v: 6, downgraded: true }; });
        attack.normals = pool;
        lines.push('目标被遮挡：舍弃 1 个成功，所有关键成功降为普通成功。');
      }
      var defense = bucketDice(pending.defenseDice, pending.defenseNeed, 6);
      attack.rolls = attack.normals.concat(attack.crits, attack.fails);
      defense.rolls = defense.normals.concat(defense.crits, defense.fails);
      if (pending.coverSave) defense.normals.push({ v: 0, cover: true });
      lines.push('攻击骰：' + attack.normals.length + ' 普通 / ' + attack.crits.length + ' 关键；' +
        '防御骰：' + defense.normals.length + ' 普通 / ' + defense.crits.length + ' 关键。');

      var result = resolveBlocking(attack, defense, lines);

      var dmg = 0;
      var dmgList = [];
      result.unblockedNormals.forEach(function () { dmgList.push(w.dmg); });
      result.unblockedCrits.forEach(function () {
        dmgList.push(w.crit + (w.rules.indexOf('devastating1') >= 0 ? 1 : 0));
      });
      dmgList.forEach(function (d) { dmg += d; });

      spend(a, 1);
      a.actionsThisActivation.push('shoot');
      applyDamage(t, dmg, a, lines);
      lines.push('结果：造成 ' + dmg + ' 点伤害' + (t.alive ? '（剩余 ' + t.wounds + '）' : '，目标被残废') + '。');
      lines.forEach(function (l) { log(l, 'combat'); });

      pending.resolved = true;
      pending.damage = dmg;
      pending.killed = !t.alive;
      pending.attack = attack;
      pending.defense = defense;
      pending.blocked = result;
      return {
        ok: true, attacker: a.id, target: t.id, weapon: w.id,
        attack: attack, defense: defense, blocked: result, damage: dmg,
        killed: !t.alive, lines: lines, info: info,
        cpSpent: pending.cpSpent, rerolled: pending.rerolled || []
      };
    }

    function shoot(attackerId, targetId, weaponId) {
      var p = beginShoot(attackerId, targetId, weaponId);
      if (!p.ok) return p;
      var res = finishShoot(p);
      // 爆破：对目标相邻的其他敌人各追加 1 伤
      var w = DATA.WEAPONS[weaponId];
      if (w && w.rules.indexOf('blast') >= 0 && res && res.ok) {
        var t = unit(targetId), a = unit(attackerId);
        if (t) {
          state.units.forEach(function (e2) {
            if (!e2.alive || e2.side === t.side || e2.id === t.id) return;
            if (dist(e2.pos, t.pos) > 1) return;
            res.lines.push('爆破：' + e2.name + ' 被波及。');
            applyDamage(e2, 1, a, res.lines);
          });
        }
      }
      return res;
    }

    /** 把骰池按命中值分类（不改变骰子本身） */
    function bucketDice(dice, need, lethal) {
      var normals = [], crits = [], fails = [];
      dice.forEach(function (d) {
        if (d.v === 1) { fails.push(d); return; }
        if (d.v >= lethal) { crits.push(d); return; }
        if (d.v >= need) { normals.push(d); return; }
        fails.push(d);
      });
      return { normals: normals, crits: crits, fails: fails };
    }

    /** 掷一池骰子，处理"无休 / 平衡"这类自动重掷 */
    function rollPool(n, need, lethal, rules, lines, label) {
      rules = rules || [];
      var dice = [];
      for (var i = 0; i < n; i++) dice.push({ v: d6() });
      if (rules.indexOf('ceaseless') >= 0) {
        var rr = 0;
        dice.forEach(function (d) { if (d.v === 1) { d.v = d6(); d.ceaseless = true; rr++; } });
        if (rr) lines.push('无休：重掷 ' + rr + ' 枚 1。');
      }
      if (rules.indexOf('balanced') >= 0) {
        var b = bucketDice(dice, need, lethal);
        if (b.fails.length) {
          var from = b.fails[0].v;
          b.fails[0].v = d6();
          lines.push('平衡：重掷 1 枚失败（' + from + ' → ' + b.fails[0].v + '）。');
        }
      }
      var fin = bucketDice(dice, need, lethal);
      lines.push(label + '骰：' + fin.normals.length + ' 普通 / ' + fin.crits.length + ' 关键 / ' + fin.fails.length + ' 失败。');
      return {
        dice: dice, normals: fin.normals, crits: fin.crits, fails: fin.fails,
        rolls: fin.normals.concat(fin.crits, fin.fails)
      };
    }

    function rollDice(n, need, lethal, rules, lines, label) {
      return rollPool(n, need, lethal, rules, lines, label);
    }


    function resolveBlocking(attack, defense, lines) {
      var dNormals = defense.normals.slice(), dCrits = defense.crits.slice();
      var aNormals = attack.normals.slice(), aCrits = attack.crits.slice();
      // 简单策略：关键优先挡关键，普通挡普通；多余的普通挡关键
      while (dCrits.length && aCrits.length) { dCrits.pop(); aCrits.pop(); }
      while (dCrits.length && aNormals.length) { dCrits.pop(); aNormals.pop(); }
      while (dNormals.length && aNormals.length) { dNormals.pop(); aNormals.pop(); }
      while (dNormals.length >= 2 && aCrits.length) { dNormals.pop(); dNormals.pop(); aCrits.pop(); }
      lines.push('抵挡：攻击方剩 ' + aNormals.length + ' 普通 / ' + aCrits.length + ' 关键。');
      return { unblockedNormals: aNormals, unblockedCrits: aCrits };
    }

    /* ------------------------------------------------------------ 近战 */
    function fight(attackerId, targetId, weaponId, defWeaponId) {
      var a = unit(attackerId), t = unit(targetId);
      if (!a || !t) return fail('目标不存在');
      if (a.state !== 'active') return fail('只有活跃特工能近战');
      if (apLeft(a) < 1) return fail('AP 不足');
      if (dist(a.pos, t.pos) > C.CONTROL_RANGE) return fail('目标不在近战范围内（1"）');
      if (a.actionsThisActivation.indexOf('fight') >= 0) return fail('本激活已近战过（行动限制）');
      var w = weaponOf(a, weaponId);
      var dw = defWeaponId ? weaponOf(t, defWeaponId) : firstMelee(t);
      if (!w || w.type !== 'melee') return fail('武器不可用');

      var lines = [];
      // 协助：其他己方特工在被近战目标控制范围内
      var helpers = state.units.filter(function (o) {
        return o.alive && o.side === a.side && o.id !== a.id &&
          dist(o.pos, t.pos) <= C.CONTROL_RANGE;
      }).length;
      var hitBonus = helpers;
      if (helpers) lines.push('协助：' + helpers + ' 名己方特工在场，命中 +' + helpers + '。');

      var aRoll = rollDice(w.attacks, Math.max(2, w.hit - hitBonus), 6, w.rules, lines, '攻方近战');
      var dRoll = dw ? rollDice(dw.attacks, dw.hit, 6, dw.rules, lines, '守方反击') : { normals: [], crits: [], fails: [] };

      // 轮流结算：攻击方先，每枚选出击或格挡
      var aPool = aRoll.crits.map(function () { return 'crit'; })
        .concat(aRoll.normals.map(function () { return 'normal'; }));
      var dPool = dRoll.crits.map(function () { return 'crit'; })
        .concat(dRoll.normals.map(function () { return 'normal'; }));
      var dmgToT = 0, dmgToA = 0;
      var turn = 'attacker';
      var guard = 0;
      while ((aPool.length || dPool.length) && guard++ < 40) {
        if (turn === 'attacker') {
          if (!aPool.length) { turn = 'defender'; continue; }
          var myCrit = aPool.indexOf('crit');
          var choice = decideMelee(aPool, dPool);
          if (choice === 'block' && dPool.length) {
            var bi = aPool.indexOf('crit') >= 0 ? aPool.indexOf('crit') : aPool.indexOf('normal');
            var kind = aPool.splice(bi, 1)[0];
            if (kind === 'crit') {
              var di = dPool.indexOf('crit') >= 0 ? dPool.indexOf('crit') : dPool.indexOf('normal');
              if (di >= 0) dPool.splice(di, 1);
            } else {
              var di2 = dPool.indexOf('normal');
              if (di2 >= 0) dPool.splice(di2, 1);
            }
            lines.push('攻方格挡。');
          } else {
            var c = aPool.splice(aPool.indexOf('crit') >= 0 ? aPool.indexOf('crit') : 0, 1)[0];
            var d = c === 'crit' ? (w.crit + (w.rules.indexOf('devastating1') >= 0 ? 1 : 0)) : w.dmg;
            dmgToT += d;
            lines.push('攻方出击（' + (c === 'crit' ? '关键' : '普通') + '）造成 ' + d + ' 伤害。');
            if (!dPool.length && !aPool.length) break;
          }
          turn = 'defender';
        } else {
          if (!dPool.length) { turn = 'attacker'; continue; }
          var choice2 = decideMelee(dPool, aPool);
          if (choice2 === 'block' && aPool.length) {
            var bkind = dPool.splice(dPool.indexOf('crit') >= 0 ? dPool.indexOf('crit') : 0, 1)[0];
            if (bkind === 'crit') {
              var ai = aPool.indexOf('crit') >= 0 ? aPool.indexOf('crit') : aPool.indexOf('normal');
              if (ai >= 0) aPool.splice(ai, 1);
            } else {
              var ai2 = aPool.indexOf('normal');
              if (ai2 >= 0) aPool.splice(ai2, 1);
            }
            lines.push('守方格挡。');
          } else if (dw) {
            var c2 = dPool.splice(dPool.indexOf('crit') >= 0 ? dPool.indexOf('crit') : 0, 1)[0];
            var d2 = c2 === 'crit' ? dw.crit : dw.dmg;
            dmgToA += d2;
            lines.push('守方反击（' + (c2 === 'crit' ? '关键' : '普通') + '）造成 ' + d2 + ' 伤害。');
          }
          turn = 'attacker';
        }
        if (dmgToA >= a.wounds || dmgToT >= t.wounds) break;
      }

      spend(a, 1);
      a.actionsThisActivation.push('fight');
      applyDamage(t, dmgToT, a, lines);
      applyDamage(a, dmgToA, t, lines);
      lines.push('近战结束：对目标 ' + dmgToT + ' 伤害，自身承受 ' + dmgToA + ' 伤害。');
      lines.forEach(function (l) { log(l, 'combat'); });
      return {
        ok: true, attacker: a.id, target: t.id,
        damageToTarget: dmgToT, damageToAttacker: dmgToA,
        killed: !t.alive, selfKilled: !a.alive, lines: lines
      };
    }

    function decideMelee(mine, theirs) {
      // 我方结算：如果对手池子比我大，优先格挡；否则出击
      var myVal = mine.reduce(function (s, k) { return s + (k === 'crit' ? 2 : 1); }, 0);
      var thVal = theirs.reduce(function (s, k) { return s + (k === 'crit' ? 2 : 1); }, 0);
      return thVal > myVal ? 'block' : 'strike';
    }

    /* ------------------------------------------------------------ 伤害 */
    function applyDamage(t, dmg, source, lines) {
      if (dmg <= 0 || !t.alive) return;
      // 袖章：致命伤改为保留 1 血，并白送一次 1 AP 动作（每局一次）
      if (t.wounds - dmg <= 0 && !t.armbandUsed && (t.equip || []).indexOf('armband') >= 0) {
        t.armbandUsed = true;
        t.wounds = 1;
        lines.push(t.name + ' 的袖章生效：致命伤被硬扛下来，保留 1 点伤势。');
        if (state.activeId === t.id) t.apUsed = Math.max(0, t.apUsed - 1);
        else t.freeAp = (t.freeAp || 0) + 1;
        log(t.name + ' 的袖章生效，还剩 1 点伤势。', 'act');
        return;
      }
      if (t.weapons && !t.stimUsed && t.weapons.some(function (w) {
        var wp = DATA.WEAPONS[w]; return wp && wp.rules && wp.rules.indexOf('stim') >= 0;
      })) {
        t.stimUsed = true;
        lines.push(t.name + ' 的战前注射抵消了这次伤害。');
        return;
      }
      t.wounds -= dmg;
      if (t.wounds <= 0) {
        t.wounds = 0;
        t.alive = false;
        t.state = 'dead';
        if (source && source.side) {
          state.sides[source.side].kills++;
          checkKillLevel(source.side, lines);
        }
        lines.push(t.name + ' 被残废并移出杀戮区。');
      }
    }

    function checkKillLevel(sid, lines) {
      var s = state.sides[sid];
      var kills = s.kills;
      var lv = 0;
      for (var i = 0; i < s.killThresholds.length; i++) {
        if (kills >= s.killThresholds[i]) lv = i + 1;
      }
      if (lv > s.killLevel) {
        s.killLevel = lv;
        s.vp += 1;
        s.vpByOp.kill += 2;
        lines && lines.push('击杀等级提升到 ' + lv + '，' + sideName(sid) + ' 获得 1VP。');
        log(sideName(sid) + ' 击杀等级提升到 ' + lv + '（+2VP）。', 'score');
      }
    }

    /* ------------------------------------------------------------ 移动行动 */
    var MOVE_COST = { move: 1, dash: 1, fallback: 2, charge: 1 };

    function doMove(unitId, mode, pts) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (!Array.isArray(pts) || !pts.length) return fail('没有指定移动终点');
      if (u.state !== 'active') return fail('只有活跃特工能行动');
      var cost = MOVE_COST[mode];
      if (cost == null) return fail('未知移动类型');
      if (apLeft(u) < cost) return fail('AP 不足');

      var acts = u.actionsThisActivation;
      var used = acts.filter(function (a) { return a === mode; }).length;
      var limit = mode === 'move' ? C.MOVE_PER_ACTIVATION : 1;
      if (used >= limit) {
        return fail('行动限制：本激活最多执行 ' + limit + ' 次' + moveName(mode));
      }
      var inEnemyControl = enemiesInControlOf(u.pos, u.side).length > 0;

      if (mode === 'move') {
        if (inEnemyControl) return fail('位于敌方控制范围内的特工不能转移');
        if (acts.indexOf('fallback') >= 0 || acts.indexOf('charge') >= 0) return fail('本激活已后撤/冲锋，不能再转移');
      }
      if (mode === 'dash') {
        if (inEnemyControl) return fail('位于敌方控制范围内的特工不能冲刺');
        if (acts.indexOf('charge') >= 0) return fail('本激活已冲锋，不能再冲刺');
      }
      if (mode === 'fallback') {
        if (!inEnemyControl) return fail('必须有敌方特工位于自己的控制范围内才能后撤');
        if (acts.indexOf('move') >= 0 || acts.indexOf('charge') >= 0) return fail('本激活已转移/冲锋，不能再后撤');
      }
      if (mode === 'charge') {
        if (u.order !== 'engage') return fail('只有交战命令可以冲锋');
        if (inEnemyControl) return fail('已在敌方控制范围内不能冲锋');
        if (acts.indexOf('move') >= 0 || acts.indexOf('dash') >= 0 || acts.indexOf('fallback') >= 0) {
          return fail('本激活已转移/冲刺/后撤，不能再冲锋');
        }
      }

      var budget = mode === 'dash' ? Math.round(C.DASH_DISTANCE * C.PACE)
        : mode === 'charge' ? u.move + Math.round(C.CHARGE_BONUS * C.PACE)
          : u.move;
      if (u.reaction) budget = Math.min(budget, C.REACTION_MOVE);

      var res = moveUnit(u, pts, budget, {
        allowEndInControl: false,
        mustEndInControl: mode === 'charge',
        allowEnterControl: mode === 'charge' || mode === 'fallback'
      });
      if (!res.ok) return res;

      spend(u, cost);
      acts.push(mode);
      u.movedThisActivation = true;
      if (mode === 'charge') u.chargedThisActivation = true;
      log(u.name + ' 执行' + moveName(mode) + '（' + res.cost + '"' +
        (res.extra > 0 ? '，含' + (res.dz > 0 ? '攀爬' : '跳落') + ' ' + res.extra + '"' : '') +
        '）。', 'act');
      return Object.assign({ ok: true, cost: res.cost, interrupted: res.interrupted, guardShots: res.guardShots }, {});
    }

    function moveName(m) {
      return { move: '转移', dash: '冲刺', fallback: '后撤', charge: '冲锋' }[m] || m;
    }

    /* ------------------------------------------------------------ 上楼下楼 */
    function buildingAt(p) {
      for (var i = 0; i < map.terrain.length; i++) {
        var t = map.terrain[i];
        if (t.kind === 'building' && inRect(p, t)) return t;
      }
      return null;
    }

    /** 建筑内部 ↔ 屋顶：花 1 AP */
    function useStairs(unitId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (u.state !== 'active') return fail('只有活跃特工能上下楼');
      if (apLeft(u) < 1) return fail('AP 不足');
      if (!u.onRoof) {
        var b = buildingAt(u.pos);
        if (!b) return fail('不在建筑内，找不到上楼的路');
        spend(u, 1);
        u.onRoof = true;
        u.elevation = C.ROOF_H;
        log(u.name + ' 花 1 AP 上了屋顶。', 'act');
        return ok({ up: true });
      }
      spend(u, 1);
      u.onRoof = false;
      u.elevation = elevationAt(u.pos);
      log(u.name + ' 花 1 AP 下到室内。', 'act');
      return ok({ up: false });
    }

    function canStairs(u) {
      if (!u || !u.alive) return false;
      return !!u.onRoof || !!buildingAt(u.pos);
    }

    /* ------------------------------------------------------------ 出入门 */
    function doorsNear(u) {
      var list = map.doors || [];
      return list.filter(function (d) { return distPointRect(u.pos, d) <= C.WINDOW_REACH; });
    }

    /** 花 1 AP 从门进/出建筑 */
    function useDoor(unitId, doorId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (u.state !== 'active') return fail('只有活跃特工能开门');
      if (apLeft(u) < 1 && !(u.freeDoor > 0)) return fail('AP 不足');
      var d = (map.doors || []).filter(function (x) { return x.id === doorId; })[0];
      if (!d) return fail('没有这个门');
      if (distPointRect(u.pos, d) > C.WINDOW_REACH) return fail('离门太远（需在 1 寸内）');
      var outside = u.pos.y > d.y;                 // 南侧 = 建筑外
      var dest = {
        x: Math.max(d.x + 0.4, Math.min(u.pos.x, d.x + d.w - 0.4)),
        y: outside ? d.y - C.BASE_RADIUS - 0.2 : d.y + d.h + C.BASE_RADIUS + 0.2
      };
      if (!canPlace(u, dest.x, dest.y)) return fail('门另一侧没有落脚点');
      if (u.freeDoor > 0) { u.freeDoor--; log(u.name + ' 用工程工具破门（不消耗 AP）。', 'act'); }
      else spend(u, 1);
      u.actionsThisActivation.push('door');
      u.pos = { x: dest.x, y: dest.y };
      u.elevation = elevationAt(dest);
      log(u.name + ' 花 1 AP ' + (outside ? '进入' : '走出') + '了建筑。', 'act');
      return ok({ moved: true, inside: outside });
    }


    /* ------------------------------------------------------------ 存档 */
    var SAVE_VERSION = 1;

    /** 把整局状态导出成可 JSON 化的对象 */
    function serialize() {
      return {
        v: SAVE_VERSION,
        seed: opts.seed || 0,
        tp: state.tp,
        phase: state.phase,
        actingSide: state.actingSide,
        initiative: state.initiative,
        activeId: state.activeId,
        tpPhase: state.tpPhase,
        sides: state.sides,
        deploy: state.deploy,
        markers: state.markers,
        smokes: state.smokes || [],
        fires: state.fires || [],
        log: state.log.slice(-40),
        units: state.units.map(function (u) {
          var o = {};
          Object.keys(u).forEach(function (k) {
            var v = u[k];
            if (typeof v === 'function') return;
            o[k] = v;
          });
          return o;
        })
      };
    }

    /** 从存档恢复（返回是否成功） */
    function restore(save) {
      if (!save || save.v !== SAVE_VERSION) return fail('存档版本不匹配');
      try {
        state.tp = save.tp;
        state.phase = save.phase;
        state.actingSide = save.actingSide;
        state.initiative = save.initiative;
        state.activeId = save.activeId;
        state.tpPhase = save.tpPhase;
        state.sides = save.sides;
        state.deploy = save.deploy;
        state.markers = save.markers;
        state.smokes = save.smokes || [];
        state.fires = save.fires || [];
        state.log = save.log || [];
        state.units = save.units;
        return ok({ units: state.units.length });
      } catch (err) {
        return fail('存档损坏：' + err.message);
      }
    }

    function hasSaveableState() {
      return state.units && state.units.length > 0 && state.phase !== 'deploy';
    }

    /* ------------------------------------------------------------ 装备使用 */
    /** 攻击无人机：12 寸内一次 A2 4+ 射击（每转折点一次，1 AP） */
    function useDroneShot(unitId, targetId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (!u.droneShot) return fail('没有携带攻击无人机');
      if (u.droneUsedTP === state.tp) return fail('本转折点无人机已经出击');
      if (apLeft(u) < 1) return fail('AP 不足');
      var t = unit(targetId);
      if (!t || !t.alive || t.side === u.side) return fail('选择敌方目标');
      if (dist(u.pos, t.pos) > 12) return fail('超出无人机航程（12"）');
      var fake = {
        id: 'drone_' + u.id, side: u.side, name: '攻击无人机',
        weapons: [], order: 'engage', pos: { x: u.pos.x, y: u.pos.y }, elevation: u.elevation,
        apl: 1, apUsed: 0, actionsThisActivation: [], state: 'active', alive: true, equip: []
      };
      spend(u, 1);
      u.droneUsedTP = state.tp;
      var lines = [u.name + ' 放出攻击无人机。'];
      var roll = 0;
      for (var i = 0; i < 2; i++) if (Math.floor(Math.random() * 6) + 1 >= 4) roll++;
      if (roll > 0) {
        applyDamage(t, roll, u, lines);
        lines.push('无人机命中 ' + roll + ' 次。');
      } else {
        lines.push('无人机未能命中。');
      }
      lines.forEach(function (L) { log(L, 'act'); });
      return ok({ lines: lines, hits: roll });
    }

    /** 侦察无人机：标记 12 寸内一名敌人（本转折点不能获得掩护） */
    function useDroneScout(unitId, targetId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (!u.scout) return fail('没有携带侦察无人机');
      if (u.scoutUsedTP === state.tp) return fail('本转折点已经侦察过');
      if (apLeft(u) < 1) return fail('AP 不足');
      var t = unit(targetId);
      if (!t || !t.alive || t.side === u.side) return fail('选择敌方目标');
      if (dist(u.pos, t.pos) > 12) return fail('超出无人机航程（12"）');
      spend(u, 1);
      u.scoutUsedTP = state.tp;
      t.marked = true;
      log(u.name + ' 的侦察无人机标定了 ' + t.name + '（本回合无法获得掩护）。', 'act');
      return ok({ marked: t.id });
    }

    /** 护盾无人机：为 3 寸内友军提供掩护 */
    function shieldDroneCover(target) {
      return state.units.some(function (a) {
        return a.alive && a.side === target.side && a.id !== target.id && a.shieldDrone &&
          dist(a.pos, target.pos) <= 3;
      });
    }

    function equipCount(u, cat) {
      return (u.equip || []).filter(function (id) {
        var E = DATA.EQUIP[id]; return E && E.cat === cat;
      }).length;
    }

    /** 投掷物：1 AP，对 12 寸内目标点结算 */
    function throwGear(unitId, equipId, targetRef) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (u.state !== 'active') return fail('只有活跃特工能投掷');
      if (apLeft(u) < 1) return fail('AP 不足');
      var E = DATA.EQUIP[equipId];
      if (!E || E.cat !== 'throwable') return fail('不是投掷物');
      if ((u.equip || []).indexOf(equipId) < 0) return fail('没有携带这件投掷物');
      if (u.throwUsed && u.throwUsed.indexOf(equipId) >= 0) return fail('已经用掉了');

      // 目标可以是单位，也可以是一块空地
      var t = null, at;
      if (typeof targetRef === 'string') {
        t = unit(targetRef);
        if (!t || !t.alive) return fail('目标不存在');
        at = { x: t.pos.x, y: t.pos.y };
      } else if (targetRef && typeof targetRef.x === 'number') {
        at = { x: targetRef.x, y: targetRef.y };
      } else {
        return fail('选择投掷点');
      }
      if (at.x < 0 || at.y < 0 || at.x > map.boardW || at.y > map.boardH) return fail('投掷点越界');
      if (dist(u.pos, at) > 12) return fail('投掷距离超出 12"');

      u.throwUsed = u.throwUsed || [];
      u.throwUsed.push(equipId);
      spend(u, 1);
      var lines = [u.name + ' 投出「' + E.name + '」。'];
      var f = E.eff || {};

      if (f.blast) {
        var R = 1.6;
        var hitList = state.units.filter(function (o) {
          return o.alive && o.id !== u.id && dist(o.pos, at) <= R;
        });
        if (!hitList.length) lines.push('落在空地上，没有炸到人。');
        hitList.forEach(function (o, idx) {
          var dmg = (idx === 0 ? (f.dmg || 1) : 1);
          if (t && o.id === t.id) dmg = f.dmg || 1;
          lines.push('爆破命中 ' + o.name + '。');
          applyDamage(o, dmg, u, lines);
        });
        if (!hitList.length && f.risky) { /* 空炸不触发自伤 */ }
        if (f.risky) {
          lines.push('土制炸弹不稳定，' + u.name + ' 也被波及。');
          applyDamage(u, 1, u, lines);
        }
      }
      if (f.stun && t) { t.reactedThisTP = true; t.apUsed = Math.min(t.apl, t.apUsed + f.stun); lines.push(t.name + ' 被压制。'); }
      if (f.apDrain && t) { t.apUsed = Math.min(t.apl, t.apUsed + f.apDrain); lines.push(t.name + ' 失去 1 AP。'); }
      if (f.suppress && t) { t.apl = Math.max(0, t.apl - f.suppress); lines.push(t.name + ' APL 下降。'); }
      if (f.snare && t) { t.move = Math.max(2, Math.ceil(t.move / 2)); lines.push(t.name + ' 被束缚。'); }
      if (f.mark && t) { t.marked = true; lines.push(t.name + ' 被标记。'); }
      if (f.pierce && t) { t.pierced = true; lines.push(t.name + ' 防御骰 -1。'); }
      if (f.fire) { state.fires.push({ x: at.x, y: at.y, r: f.fire + 1 }); lines.push('落点起火。'); }
      if (f.smoke) { state.smokes.push({ x: at.x, y: at.y, r: f.smoke }); lines.push('落点被烟雾覆盖。'); }
      if (f.emp && t) { t.droneDown = true; lines.push(t.name + ' 的电子装备瘫痪。'); }
      lines.forEach(function (L) { log(L, 'act'); });
      return ok({ lines: lines, equipment: equipId });
    }

    /** 急救包：相邻友军回血（每局一次） */
    function useMedkit(unitId, targetId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (u.state !== 'active') return fail('只有活跃特工能用医疗');
      if (!u.medkit) return fail('没有携带医疗装备');
      if (apLeft(u) < 1) return fail('AP 不足');
      var t = targetId ? unit(targetId) : u;
      if (!t || !t.alive) return fail('目标不存在');
      if (t.side !== u.side) return fail('只能治疗友军');
      if (dist(u.pos, t.pos) > 1.5) return fail('目标不在 1.5 寸内');
      spend(u, 1);
      var heal = u.medkit;
      u.medkit = 0;
      t.wounds = Math.min(t.maxWounds, t.wounds + heal);
      log(u.name + ' 使用急救包，' + t.name + ' 恢复 ' + heal + ' 点伤势。', 'act');
      return ok({ healed: heal });
    }

    /** 电台：12 寸内友军 +1 AP（每转折点一次） */
    function useRadio(unitId, targetId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (!u.radioAP) return fail('没有携带通讯装备');
      if (u.radioUsedTP === state.tp) return fail('本转折点已经用过电台');
      if (apLeft(u) < 1) return fail('AP 不足');
      var t = targetId ? unit(targetId) : u;
      if (!t || !t.alive) return fail('目标不存在');
      if (t.side !== u.side) return fail('只能给友军下令');
      if (dist(u.pos, t.pos) > 12) return fail('超出通讯范围');
      spend(u, 1);
      u.radioUsedTP = state.tp;
      t.apUsed = Math.max(0, t.apUsed - 1);
      log(u.name + ' 通过电台为 ' + t.name + ' 争取到 1 AP。', 'act');
      return ok({ ap: 1 });
    }

    /* ------------------------------------------------------------ 翻窗 */
    function windowsNear(u) {
      var list = (map.windows || []).slice();
      map.terrain.forEach(function (t) { if (t.kind === 'window') list.push(t); });
      return list.filter(function (w) { return distPointRect(u.pos, w) <= C.WINDOW_REACH; });
    }

    function useWindow(unitId, winId) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (u.state !== 'active') return fail('只有活跃特工能翻窗');
      if (apLeft(u) < 1) return fail('AP 不足');
      var list = (map.windows || []).slice();
      map.terrain.forEach(function (t) { if (t.kind === 'window') list.push(t); });
      list = list.filter(function (w) { return w.id === winId; });
      var w = list[0];
      if (!w) return fail('没有这个窗洞');
      if (distPointRect(u.pos, w) > C.WINDOW_REACH) return fail('离窗户太远（需在 1 寸内）');
      // 判断墙的走向：横向墙（w >= h）沿 y 翻，纵向墙沿 x 翻
      var horiz = w.w >= w.h;
      var dest;
      if (horiz) {
        var northSide = u.pos.y < w.y + w.h / 2;
        dest = {
          x: Math.max(w.x + C.BASE_RADIUS, Math.min(u.pos.x, w.x + w.w - C.BASE_RADIUS)),
          y: northSide ? w.y + w.h + C.BASE_RADIUS + 0.15 : w.y - C.BASE_RADIUS - 0.15
        };
      } else {
        var westSide = u.pos.x < w.x + w.w / 2;
        dest = {
          x: westSide ? w.x + w.w + C.BASE_RADIUS + 0.15 : w.x - C.BASE_RADIUS - 0.15,
          y: Math.max(w.y + C.BASE_RADIUS, Math.min(u.pos.y, w.y + w.h - C.BASE_RADIUS))
        };
      }
      if (!canPlace(u, dest.x, dest.y)) return fail('窗户另一侧没有落脚点');
      spend(u, 1);
      u.actionsThisActivation.push('window');
      u.pos = { x: dest.x, y: dest.y };
      u.elevation = elevationAt(dest);
      log(u.name + ' 花 1 AP 从窗洞翻了过去。', 'act');
      return ok({ moved: true });
    }

    /* ------------------------------------------------- 警戒 / 哨戒 / 掩护 */
    var GUARD_NAMES = { overwatch: '警戒', sentry: '哨戒', cover: '掩护' };
    var GUARD_TYPES = ['overwatch', 'sentry', 'cover'];
    var guardBusy = false;   // 警戒链式触发时的防递归

    function guardName(k) { return GUARD_NAMES[k] || k; }

    function firstRanged(u) {
      return u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
        .filter(function (w) { return w && w.type === 'ranged'; })[0];
    }

    /** 进入警戒/哨戒/掩护：花 1 AP，且必须留 1 AP 备用 */
    function setGuard(unitId, kind) {
      var u = unit(unitId);
      if (!u) return fail('特工不存在');
      if (u.state !== 'active') return fail('只有活跃特工能进入警戒');
      if (GUARD_TYPES.indexOf(kind) < 0) return fail('未知的警戒类型');
      if (u.guard) return fail('已经处于' + guardName(u.guard) + '状态（同时只能有一种）');
      if (apLeft(u) < 2) return fail('进入' + guardName(kind) + '需要预留 1 点行动力（当前 AP ' + apLeft(u) + '）');
      spend(u, 1);
      u.guard = kind;
      u.guardUsed = false;
      u.actionsThisActivation.push('guard');
      log(u.name + ' 进入' + guardName(kind) + '，预留 1 行动点待触发。', 'act');
      return ok();
    }

    /** 用临时位置判断"能否射击某个坐标上的目标"（不动原对象） */
    function guardShotInfo(watcher, target, pos, elev) {
      var w = firstRanged(watcher);
      if (!w) return null;
      var sp = target.pos, se = target.elevation, so = watcher.order;
      target.pos = pos;
      target.elevation = elev == null ? elevationAt(pos) : elev;
      watcher.order = 'engage';            // 警戒射击按交战口径判定
      var info = null;
      try { info = shootInfo(watcher, target, w); } catch (e) { info = null; }
      watcher.order = so;
      target.pos = sp;
      target.elevation = se;
      if (!info || !info.valid) return null;
      return { weapon: w, info: info };
    }

    /** 找一名能对这个位置开火的警戒单位 */
    function overwatchAt(mover, pos) {
      for (var i = 0; i < state.units.length; i++) {
        var w = state.units[i];
        if (!w.alive || w.side === mover.side) continue;
        if (w.guard !== 'overwatch' || w.guardUsed) continue;
        if (apLeft(w) < 1) continue;
        if (guardShotInfo(w, mover, pos)) return w;
      }
      return null;
    }

    /** 掩护：移动方的友军若处于掩护且能打到开火者，先打一枪 */
    function coverFire(mover, watcher) {
      var out = [];
      state.units.forEach(function (f) {
        if (!f.alive || f.side !== mover.side || f.guard !== 'cover' || f.guardUsed) return;
        if (apLeft(f) < 1) return;
        var shot = guardShotInfo(f, watcher, watcher.pos, watcher.elevation);
        if (!shot) return;
        f.guardUsed = true; f.guard = null; f.order = 'engage';
        spend(f, 1);
        log(f.name + ' 触发掩护，向 ' + watcher.name + ' 开火！', 'act');
        var res = beginShoot(f.id, watcher.id, shot.weapon.id);
        if (res.ok) { res.guard = 'cover'; out.push(finishShoot(res)); }
      });
      return out;
    }

    /** 警戒射击：移动中的敌人进入射界就挨一枪 */
    function fireOverwatch(watcher, mover) {
      if (!watcher.alive || watcher.guard !== 'overwatch' || watcher.guardUsed) return null;
      if (apLeft(watcher) < 1) return null;
      var shot = guardShotInfo(watcher, mover, mover.pos, mover.elevation);
      if (!shot) return null;
      watcher.guardUsed = true; watcher.guard = null;
      watcher.order = 'engage';            // 触发后立刻转交战
      spend(watcher, 1);
      log(watcher.name + ' 触发警戒，向 ' + mover.name + ' 开火！', 'act');
      var res = beginShoot(watcher.id, mover.id, shot.weapon.id);
      if (!res.ok) return null;
      return finishShoot(res);
    }

    /** 哨戒：被射击/冲锋/近战锁定前，先冲刺 3 寸躲开 */
    function sentryDash(unitId, threatPos) {
      var u = unit(unitId);
      if (!u || !u.alive) return fail('特工不存在');
      if (u.guard !== 'sentry' || u.guardUsed) return fail('不在哨戒状态');
      if (apLeft(u) < 1) return fail('没有预留的行动点');
      var budget = Math.round(C.DASH_DISTANCE * C.PACE);
      var best = null, bestD = -1;
      for (var a = 0; a < 24; a++) {
        var ang = a / 24 * Math.PI * 2;
        for (var rr = budget; rr >= 0.6; rr -= 0.4) {
          var p = { x: u.pos.x + Math.cos(ang) * rr, y: u.pos.y + Math.sin(ang) * rr };
          if (!canPlace(u, p.x, p.y)) continue;
          if (blockReason(u, u.pos, p)) continue;
          var d = threatPos ? dist(p, threatPos) : 0;
          if (d > bestD) { bestD = d; best = p; }
          break;
        }
      }
      if (!best) return fail('没有可以冲刺的空间');
      u.guardUsed = true; u.guard = null;
      spend(u, 1);
      u.pos = { x: best.x, y: best.y };
      u.elevation = elevationAt(best);
      log(u.name + ' 触发哨戒，冲刺躲开 ' + Math.round(budget) + '" 。', 'act');
      return ok({ moved: true });
    }

    /** 冲锋前调用：目标若在哨戒，先让它冲刺 */
    function trySentry(unitId, threatPos) {
      var u = unit(unitId);
      if (!u || u.guard !== 'sentry') return ok({ dashed: false });
      var r = sentryDash(unitId, threatPos);
      return r.ok ? ok({ dashed: true }) : r;
    }

    /* -------------------------------------------- 待决警戒（不强制触发） */
    function guardThreat(unitId) {
      var u = unit(unitId);
      return !!(u && u.alive && u.guard === 'sentry' && !u.guardUsed && apLeft(u) >= 1);
    }

    /** 待机单位用预留的行动点开一枪（临时当作活跃，打完回到待机） */
    function shootAsGuard(shooter, target, weapon) {
      var st = shooter.state, ap = shooter.apUsed, acts = shooter.actionsThisActivation.slice();
      shooter.state = 'active';
      shooter.apUsed = Math.max(0, shooter.apl - 1);   // 恰好剩 1 AP
      var res;
      try {
        res = beginShoot(shooter.id, target.id, weapon.id);
        if (res.ok) res = finishShoot(res);
      } finally {
        shooter.state = st === 'active' ? 'active' : 'spent';
        if (shooter.state === 'spent') shooter.apUsed = Math.min(shooter.apl, ap + 1);  // 只花掉预留的 1 点
        else shooter.apUsed = ap;
        shooter.actionsThisActivation = acts;
      }
      return res;
    }

    /** 掩护候选：移动方的友军里，处于掩护且能打到开火者 */
    function coverCandidates(moverId, watcherId) {
      var mover = unit(moverId), watcher = unit(watcherId);
      if (!mover || !watcher) return [];
      return state.units.filter(function (f) {
        if (!f.alive || f.side !== mover.side || f.guard !== 'cover' || f.guardUsed) return false;
        if (apLeft(f) < 1) return false;
        return !!guardShotInfo(f, watcher, watcher.pos, watcher.elevation);
      }).map(function (f) { return f.id; });
    }

    function fireCoverUnit(unitId, watcherId) {
      var f = unit(unitId), w = unit(watcherId);
      if (!f || !w) return fail('目标不存在');
      if (f.guard !== 'cover' || f.guardUsed) return fail('不在掩护状态');
      if (apLeft(f) < 1) return fail('没有预留的行动点');
      var shot = guardShotInfo(f, w, w.pos, w.elevation);
      if (!shot) return fail('打不到目标');
      f.guardUsed = true; f.guard = null; f.order = 'engage';
      log(f.name + ' 触发掩护，向 ' + w.name + ' 开火！', 'act');
      return shootAsGuard(f, w, shot.weapon);
    }

    function fireOverwatchNow(watcherId, moverId) {
      var watcher = unit(watcherId), mover = unit(moverId);
      if (!watcher || !mover) return fail('目标不存在');
      if (!watcher.alive || watcher.guard !== 'overwatch' || watcher.guardUsed) return fail('警戒已失效');
      if (apLeft(watcher) < 1) return fail('没有预留的行动点');
      var shot = guardShotInfo(watcher, mover, mover.pos, mover.elevation);
      if (!shot) return fail('当前打不到目标');
      watcher.guardUsed = true; watcher.guard = null;
      watcher.order = 'engage';
      log(watcher.name + ' 触发警戒，向 ' + mover.name + ' 开火！', 'act');
      return shootAsGuard(watcher, mover, shot.weapon);
    }

    /** 放弃警戒：清除待决，并让被打断的移动继续走完 */
    function declineGuard() {
      var pm = state.pendingMove;
      state.pendingGuard = null;
      state.pendingMove = null;
      if (!pm) return ok({ resumed: false });
      var u = unit(pm.unitId);
      if (!u || !u.alive) return ok({ resumed: false });
      var rest = [pm.pts[pm.fromIndex]].concat(pm.pts.slice(pm.fromIndex + 1));
      if (!rest.length) return ok({ resumed: false });
      guardBusy = true;   // 继续走的时候不再重复触发
      var res;
      try {
        res = moveUnit(u, rest, 99, { ignoreControl: true, ignoreGuard: true });
      } finally { guardBusy = false; }
      return ok({ resumed: !!res.ok });
    }

    function acceptGuard() {
      var pg = state.pendingGuard;
      state.pendingMove = null;
      if (!pg) return fail('没有待处理的警戒');
      state.pendingGuard = null;
      return ok({ kind: pg.kind });
    }

    function pendingGuard() { return state.pendingGuard; }

    /* ------------------------------------------------------------ 反应 */
    /**
     * 反应：自己全员待机、对手还有就绪特工时可让一名交战命令的待机特工
     * 免费执行 1 个 1AP 行动（移动 ≤2"），每名特工每转折点一次。
     */
    function canReact(sid) {
      if (state.phase !== 'battle') return false;
      if (state.activeId) return false;
      if (readyCount(sid) > 0) return false;
      var foe = sid === 'police' ? 'rioters' : 'police';
      if (readyCount(foe) === 0) return false;
      return state.units.some(function (u) {
        return u.alive && u.side === sid && u.state === 'spent' &&
          u.order === 'engage' && !u.reactedThisTP;
      });
    }

    function beginReaction(unitId) {
      var u = unit(unitId);
      if (!u || !u.alive) return fail('特工不存在');
      if (!canReact(u.side)) return fail('当前不能反应');
      if (u.state !== 'spent') return fail('只有待机特工能反应');
      if (u.order !== 'engage') return fail('只有交战命令能反应');
      if (u.reactedThisTP) return fail('本转折点已经反应过');
      state.activeId = u.id;
      state.reacting = u.id;
      u.state = 'active';
      u.reaction = true;
      u.apUsed = Math.max(0, u.apl - 1);   // 反应提供 1 点行动力
      u.actionsThisActivation = [];
      u.movedThisActivation = false;
      log(sideName(u.side) + ' 用 ' + u.name + ' 进行反应（免费 1 个行动，移动 ≤2"）。', 'act');
      return ok();
    }

    function endReaction() {
      var u = unit(state.activeId);
      if (u) {
        u.reaction = false;
        u.state = 'spent';
        u.reactedThisTP = true;
      }
      state.activeId = null;
      state.reacting = null;
      return ok();
    }

    /* ------------------------------------------------------------ 其它行动 */
    /** 1 寸内可拾取的一次性目标 */
    function pickupsNear(u) {
      if (!u) return [];
      return state.markers.filter(function (m) {
        return m.kind === 'pickup' && !m.taken && dist(u.pos, m) <= C.CONTROL_RANGE;
      });
    }

    function pickUp(unitId, markerId) {
      var u = unit(unitId), m = marker(markerId);
      if (!u || !m) return fail('目标标识不存在');
      if (u.state !== 'active') return fail('只有活跃特工能行动');
      if (apLeft(u) < 1) return fail('AP 不足');

      // 一次性拾取目标：拿到就加分，然后从场上移除
      if (m.kind === 'pickup') {
        if (m.taken) return fail('已经被拿走了');
        if (dist(u.pos, m) > C.CONTROL_RANGE) return fail('不在拾取范围内');
        m.taken = true;
        var vp = m.value || 2;
        state.sides[u.side].vp += vp;
        spend(u, 1);
        u.actionsThisActivation.push('pickup');
        log(u.name + ' 拾取了 ' + m.name + '（+' + vp + 'VP）。', 'score');
        state.markers = state.markers.filter(function (x) { return x.id !== m.id; });
        return ok({ vp: vp, picked: m.name });
      }

      if (u.carrying) return fail('已经携带标识');
      if (dist(u.pos, m) > C.CONTROL_RANGE) return fail('标识不在控制范围内');
      m.carriedBy = u.id;
      u.carrying = m.id;
      spend(u, 1);
      u.actionsThisActivation.push('pick');
      log(u.name + ' 拾取 ' + m.name + '。', 'act');
      return ok();
    }

    function placeMarker(unitId, x, y) {
      var u = unit(unitId);
      if (!u || !u.carrying) return fail('没有携带标识');
      var m = marker(u.carrying);
      if (!(u.state === 'active' ? apLeft(u) >= 1 : false)) return fail('AP 不足');
      if (Math.hypot(x - u.pos.x, y - u.pos.y) > C.CONTROL_RANGE) return fail('必须放在控制范围内');
      m.x = x; m.y = y; m.carriedBy = null; u.carrying = null;
      spend(u, 1);
      u.actionsThisActivation.push('place');
      log(u.name + ' 放置 ' + m.name + '。', 'act');
      return ok();
    }

    function endActivation() {
      var u = unit(state.activeId);
      if (u && u.reaction) {
        endReaction();
        return ok({ reacted: true });
      }
      if (u) {
        u.state = 'spent';
        log(u.name + ' 结束激活，进入待机。', 'act');
      }
      state.activeId = null;
      var actSide = state.actingSide;
      var other = actSide === 'police' ? 'rioters' : 'police';
      if (readyCount(actSide) === 0 && readyCount(other) === 0) {
        endTurningPoint();
        return ok({ tpEnded: true });
      }
      if (readyCount(actSide) === 0) state.actingSide = other;
      else if (readyCount(other) === 0) state.actingSide = actSide;
      else state.actingSide = other;
      return ok();
    }

    function readyCount(sid) {
      return state.units.filter(function (u) { return u.alive && u.side === sid && u.state === 'ready'; }).length;
    }

    function allSpent(sid) {
      return state.units.filter(function (u) { return u.alive && u.side === sid; })
        .every(function (u) { return u.state === 'spent'; });
    }

    /* ------------------------------------------------------ 阶段推进 */
    function nextActivationSide() {
      var act = state.actingSide;
      var other = act === 'police' ? 'rioters' : 'police';
      if (readyCount(act) === 0 && readyCount(other) === 0) return null;
      if (readyCount(act) > 0 && readyCount(other) === 0) return act;
      if (readyCount(act) === 0 && readyCount(other) > 0) return other;
      // 交替：谁刚激活完就换手；由 UI 在每次激活后调用
      return other;
    }

    function passOver() {
      var act = state.actingSide;
      var other = act === 'police' ? 'rioters' : 'police';
      if (readyCount(other) > 0) state.actingSide = other;
      else if (readyCount(act) > 0) state.actingSide = act;
      else endTurningPoint();
    }

    function endTurningPoint() {
      // 计分（第 1 转折点后开始）
      if (state.tp >= 1) {
        ['police', 'rioters'].forEach(function (sid) {
          var mine = countObjectives(sid);
          var theirs = countObjectives(sid === 'police' ? 'rioters' : 'police');
          if (state.tp >= 1) {
            var vp = 0;
            if (mine >= 1) vp += 1;   // 中央点：控制 +1VP
            if (vp > 0) {
              state.sides[sid].vp += vp;
              state.sides[sid].vpByOp.critical += vp;
              log('第 ' + state.tp + ' 转折点计分：' + sideName(sid) + ' 控制 ' + mine + ' 个目标（对手 ' +
                theirs + '）→ +' + vp + 'VP。', 'score');
            } else {
              var st = controlStatus(state.markers.filter(function (m) { return m.kind === 'center'; })[0] || null);
              if (st && st.contested) {
                log('第 ' + state.tp + ' 转折点计分：' + sideName(sid) + ' 与对手在中央点势均力敌（争夺中），无 VP。', 'score');
              } else {
                log('第 ' + state.tp + ' 转折点计分：' + sideName(sid) + ' 未控制目标，无 VP。', 'score');
              }
            }
          }
        });
      }
      // 打捞
      state.units.forEach(function (u) {
        if (u.alive) { u.carried = u.carried || null; }
        u.guard = null; u.guardUsed = false;
      });

      if (state.tp >= C.TURNING_POINTS) {
        finishGame();
      } else {
        state.tpPhase = 'strategic';
        nextTurningPoint();
      }
    }

    /** 目标点的控制半径（中央点 3 寸，其余 1 寸） */
    function markerRadius(m) {
      return m && m.radius ? m.radius : C.CONTROL_RANGE;
    }

    /** 某方在目标点范围内的"控制力"明细 */
    function controlDetail(m, side) {
      var r = markerRadius(m);
      var units = [], weight = 0;
      state.units.forEach(function (u) {
        if (!u.alive || u.side !== side) return;
        if (dist(u.pos, m) > r) return;
        if (!hasLineOfSight(u.pos, m, u.elevation, 0).visible) return;
        var bonus = 0;
        (u.equip || []).forEach(function (id) {
          var E = DATA.EQUIP && DATA.EQUIP[id];
          if (!E || !E.eff) return;
          if (E.eff.extraAP || E.eff.scout || E.eff.shieldDrone || E.eff.droneShot) bonus = 1;
        });
        units.push({ u: u, w: (u.apl || 1) + bonus });
      });
      // 大圈里最多算 3 个人：人海不能靠堆人碾压
      units.sort(function (a, b) { return b.w - a.w; });
      var capped = units.slice(0, 3);
      var wsum = capped.reduce(function (n, x) { return n + x.w; }, 0);
      return {
        units: units.map(function (x) { return x.u; }),
        count: units.length,
        capped: capped.length,
        weight: wsum,
        radius: r
      };
    }

    /**
     * 占点判定：
     *  - 只有一方在场 → 该方控制
     *  - 双方都在场 → 比"控制力"（APL 之和 + 装备加成）
     *  - 控制力相同 → 争夺中，无人控制（下回合重新判定）
     */
    function markerController(m) {
      if (m.carriedBy) {
        var cu = unit(m.carriedBy);
        return cu && cu.alive ? cu.side : null;
      }
      var a = controlDetail(m, 'police'), b = controlDetail(m, 'rioters');
      if (a.count === 0 && b.count === 0) return null;
      if (b.count === 0) return 'police';
      if (a.count === 0) return 'rioters';
      if (a.weight === b.weight) return null;      // 势均力敌 → 争夺
      return a.weight > b.weight ? 'police' : 'rioters';
    }

    /** 给日志/UI 用：当前争夺状态一句话 */
    function controlStatus(m) {
      var a = controlDetail(m, 'police'), b = controlDetail(m, 'rioters');
      var c = markerController(m);
      return {
        radius: markerRadius(m),
        police: a, rioters: b,
        controller: c,
        contested: !!c === false && (a.count > 0 && b.count > 0)
      };
    }

    function countObjectives(sid) {
      var n = 0;
      state.markers.forEach(function (m) {
        if (m.taken) return;
        if (m.kind !== 'center') return;      // 一次性拾取点不计入控制分
        if (markerController(m) === sid) n++;
      });
      return n;
    }

    /* ------------------------------------------------------------ 决战/结算 */
    function choosePrimary(sid, op) {
      if (state.tp !== 1) return fail('主要行动只能在第 1 转折点选择');
      state.sides[sid].primary = op;
      log(sideName(sid) + ' 秘密选定主要行动 op：' + (op === 'critical' ? '关键行动' : '击杀行动') + '。', 'score');
      return ok();
    }

    function finishGame() {
      state.phase = 'end';
      var p = state.sides.police, r = state.sides.rioters;
      ['police', 'rioters'].forEach(function (sid) {
        var s = state.sides[sid];
        if (s.primary) {
          var bonus = Math.ceil(s.vpByOp[s.primary === 'critical' ? 'critical' : 'kill'] / 2);
          s.vp += bonus;
          log(sideName(sid) + ' 主要行动 op（' + (s.primary === 'critical' ? '关键' : '击杀') + '）奖励 +' + bonus + 'VP。', 'score');
        }
      });
      if (p.vp === r.vp) state.winner = 'draw';
      else state.winner = p.vp > r.vp ? 'police' : 'rioters';
      log('战斗结束：警方 ' + p.vp + ' VP vs 暴匪 ' + r.vp + ' VP → ' +
        (state.winner === 'draw' ? '平局' : sideName(state.winner) + ' 获胜'), 'phase');
    }

    /* ------------------------------------------------------------ 工具 */
    function d6() { return Math.floor(rng() * 6) + 1; }
    function unit(id) { return state.units.filter(function (u) { return u.id === id; })[0]; }
    function marker(id) { return state.markers.filter(function (m) { return m.id === id; })[0]; }
    function weaponOf(u, id) { return u.weapons.map(function (w) { return DATA.WEAPONS[w]; }).filter(function (w) { return w && w.id === id; })[0]; }
    function firstMelee(u) {
      return u.weapons.map(function (w) { return DATA.WEAPONS[w]; }).filter(function (w) { return w && w.type === 'melee'; })[0];
    }
    function sideName(sid) { return sid === 'police' ? '警方' : '暴匪'; }
    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(msg) { return { ok: false, error: msg }; }

    function enemiesOf(u) {
      return state.units.filter(function (o) { return o.alive && o.side !== u.side; });
    }

    /* ------------------------------------------------------------ 导出 */
    var api = {
      state: state,
      setup: setup,
      // 部署
      deployUnit: deployUnit,
      deployCandidates: deployCandidates,
      findDeploySpot: findDeploySpot,
      // 回合
      nextTurningPoint: nextTurningPoint,
      endTurningPoint: endTurningPoint,
      activate: activate,
      endActivation: endActivation,
      passOver: passOver,
      choosePrimary: choosePrimary,
      // 行动
      moveUnit: moveUnit,
      doMove: doMove,
      shoot: shoot,
      beginShoot: beginShoot,
      finishShoot: finishShoot,
      rerollDie: rerollDie,
      fight: fight,
      pickUp: pickUp,
      pickupsNear: pickupsNear,
      markerRadius: markerRadius,
      controlStatus: controlStatus,
      controlDetail: controlDetail,
      placeMarker: placeMarker,
      pathCost: pathCost,
      blockReason: blockReason,
      // 查询
      unit: unit,
      marker: marker,
      weaponOf: weaponOf,
      firstMelee: firstMelee,
      apLeft: apLeft,
      readyCount: readyCount,
      allSpent: allSpent,
      useStairs: useStairs,
      canStairs: canStairs,
      buildingAt: buildingAt,
      doorsNear: doorsNear,
      useDoor: useDoor,
      windowsNear: windowsNear,
      useWindow: useWindow,
      applyDamage: applyDamage,
      serialize: serialize,
      restore: restore,
      hasSaveableState: hasSaveableState,
      throwGear: throwGear,
      useDroneShot: useDroneShot,
      useDroneScout: useDroneScout,
      shieldDroneCover: shieldDroneCover,
      useMedkit: useMedkit,
      useRadio: useRadio,
      equipCount: equipCount,
      setGuard: setGuard,
      guardThreat: guardThreat,
      coverCandidates: coverCandidates,
      fireCoverUnit: fireCoverUnit,
      fireOverwatchNow: fireOverwatchNow,
      acceptGuard: acceptGuard,
      declineGuard: declineGuard,
      pendingGuard: pendingGuard,
      sentryDash: sentryDash,
      trySentry: trySentry,
      guardName: guardName,
      canReact: canReact,
      beginReaction: beginReaction,
      endReaction: endReaction,
      countObjectives: countObjectives,
      markerController: markerController,
      enemiesInControlOf: enemiesInControlOf,
      hasLineOfSight: hasLineOfSight,
      shootInfo: shootInfo,
      canPlace: canPlace,
      elevationAt: elevationAt,
      dist: dist,
      sideName: sideName,
      enemiesOf: enemiesOf,
      spend: spend,
      log: log,
      finishGame: finishGame
    };
    return api;
  }

  return { createGame: createGame, mulberry32: mulberry32 };
});
