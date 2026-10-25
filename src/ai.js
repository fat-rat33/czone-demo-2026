/* ==========================================================================
 * C 区 · 橙色 —— 简易 AI（暴匪/警方通用）
 * 策略：优先能打的目标 → 冲锋近战 → 向目标标识推进 → 占点
 * ========================================================================== */
var AI = (function (DATA) {
  'use strict';

  /* 难度：影响是否用指挥重掷、推进意愿、是否找掩体、残血是否后撤 */
  var LEVELS = {
    rookie: { key: 'rookie', name: '新手', reroll: false, aggro: 0.45, cover: 0.5, fallback: 0 },
    veteran: { key: 'veteran', name: '老兵', reroll: true, aggro: 0.85, cover: 1.0, fallback: 1 },
    ruthless: { key: 'ruthless', name: '凶狠', reroll: true, aggro: 1.25, cover: 1.15, fallback: 1 }
  };
  var levelKey = 'veteran';
  function cfg() { return LEVELS[levelKey] || LEVELS.veteran; }
  function setLevel(k) { if (LEVELS[k]) levelKey = k; }
  function getLevel() { return levelKey; }


  function planActivation(g, side) {
    var ready = g.state.units.filter(function (u) {
      return u.side === side && u.alive && u.state === 'ready';
    });
    if (!ready.length) return null;

    var enemies = g.state.units.filter(function (u) { return u.alive && u.side !== side; });
    var markers = g.state.markers;

    var best = null, bestScore = -1e9;
    ready.forEach(function (u) {
      var score = 0;
      // 能射击的目标?
      var targets = enemies.map(function (e) { return { u: e, info: shootInfoOf(g, u, e) }; })
        .filter(function (t) { return t.info && t.info.valid; });
      var holding = !u.carrying && markers.some(function (m) {
        return !m.carriedBy && g.dist(u.pos, m) <= 1;
      });
      if (targets.length) {
        score += 75;
        targets.sort(function (a, b) { return a.u.wounds - b.u.wounds; });
        score += (10 - targets[0].u.wounds) * 0.5;
      }
      // 近战距离
      var adj = enemies.filter(function (e) { return g.dist(e.pos, u.pos) <= 1; });
      if (adj.length) score += 85;
      // 可冲锋
      var chargeable = enemies.filter(function (e) {
        var d = g.dist(e.pos, u.pos);
        return d <= u.move + 2 && d > 1;
      });
      if (chargeable.length) score += 45;
      // 离目标标识的距离（越近越好）
      var near = 999;
      markers.forEach(function (m) {
        if (m.carriedBy) return;
        near = Math.min(near, g.dist(u.pos, m));
      });
      score += Math.max(0, 26 - near) * 0.9;
      // 抢分：离目标越近越优先，且没控点的单位额外加分
      if (!holding) score += Math.max(0, 34 - near) * 1.8;
      if (u.carrying) score += 18;
      if (u.isLeader) score += 4;
      score += (u.wounds / u.maxWounds) * 8;
      // 已经在点上、又打不到人的单位不要反复空转
      if (holding && !targets.length && !adj.length && !chargeable.length) score -= 60;
      if (score > bestScore) { bestScore = score; best = u; }
    });
    return best;
  }

  function shootInfoOf(g, u, e) {
    var w = u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
      .filter(function (x) { return x && x.type === 'ranged'; })[0];
    if (!w) return null;
    try { return g.shootInfo(u, e, w); } catch (err) { return null; }
  }

  /** 某点附近有没有掩体（1 寸内），重掩体权重更高 */
  function coverScoreAt(g, p) {
    var best = 0;
    var list = g.state.map.terrain;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t.cover || t.cover === 'none' || t.render === false) continue;
      var nx = Math.max(t.x, Math.min(p.x, t.x + t.w));
      var ny = Math.max(t.y, Math.min(p.y, t.y + t.h));
      if (Math.hypot(p.x - nx, p.y - ny) <= 1.0) {
        best = Math.max(best, t.cover === 'heavy' ? 2 : 1);
      }
    }
    return best;
  }

  /** 对指定目标开火；难度允许时用指挥重掷补关键骰 */
  function shootAt(g, u, tgt, wep, side) {
    var lv = cfg();
    var p = g.beginShoot(u.id, tgt.id, wep.id);
    if (!p || !p.ok) return false;
    if (lv.reroll && g.state.sides[side].cp >= 1) {
      var need = p.attackNeed, lethal = p.attackLethal;
      var hits = p.attackDice.filter(function (d) { return d.v >= need || d.v >= lethal; }).length;
      var worth = hits === 0 || (hits === 1 && tgt.wounds <= 2);
      if (worth) {
        var worst = -1, wv = 99;
        p.attackDice.forEach(function (d, i) {
          if (d.v < need && d.v < wv) { wv = d.v; worst = i; }
        });
        if (worst >= 0) g.rerollDie(p, 'attack', worst);
      }
    }
    var res = g.finishShoot(p);
    return !!(res && res.ok !== false);
  }

  /** 挑一个能打的目标并开火；返回 true 表示开过枪 */
  /** 开火前，如果目标在哨戒，按难度决定要不要让它先冲刺 */
  function trySentryOnTargets(g, u, side) {
    if (!g.guardThreat) return;
    var cands = g.state.units.filter(function (e) { return e.alive && e.side !== side && g.guardThreat(e.id); });
    cands.forEach(function (e) {
      if (!g.guardThreat(e.id)) return;
      if (cfg().key === 'rookie' && Math.random() < 0.5) return;
      g.sentryDash(e.id, u.pos);
    });
  }

  function shootSmart(g, u, side) {
    var cands = g.state.units.filter(function (e) { return e.alive && e.side !== side; })
      .map(function (e) { return { u: e, info: shootInfoOf(g, u, e) }; })
      .filter(function (t) { return t.info && t.info.valid; })
      .sort(function (a, b) {
        var sa = a.u.wounds + (a.info.cover ? 1.5 : 0);
        var sb = b.u.wounds + (b.info.cover ? 1.5 : 0);
        return sa - sb;
      });
    if (!cands.length) return false;
    var wep = u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
      .filter(function (x) { return x && x.type === 'ranged'; })[0];
    if (!wep) return false;
    return shootAt(g, u, cands[0].u, wep, side);
  }

  /** 后撤落点：离敌人更远、且能站 */
  function fallbackSpot(g, u, side, enemy) {
    var best = null, bestD = -1;
    for (var a = 0; a < 12; a++) {
      var ang = a / 12 * Math.PI * 2;
      var p = { x: u.pos.x + Math.cos(ang) * 2.2, y: u.pos.y + Math.sin(ang) * 2.2 };
      if (!g.canPlace(u, p.x, p.y)) continue;
      if (g.enemiesInControlOf(p, side).length) continue;
      var d = g.dist(p, enemy.pos);
      if (d > bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** 执行一个完整激活；返回 true 表示做了事 */
  function takeTurn(g, side) {
    var u = planActivation(g, side);
    if (!u) return false;

    var enemies = g.state.units.filter(function (x) { return x.alive && x.side !== side; });
    var nearest = null, nd = 1e9;
    enemies.forEach(function (e) {
      var d = g.dist(e.pos, u.pos);
      if (d < nd) { nd = d; nearest = e; }
    });

    var targets = enemies.map(function (e) { return { u: e, info: shootInfoOf(g, u, e) }; })
      .filter(function (t) { return t.info && t.info.valid; });
    var lv = cfg();
    var order = (targets.length || nd <= u.move + 4) ? 'engage' : 'conceal';
    var res = g.activate(u.id, order);
    if (!res.ok) return false;

    var me = g.state.sides[side], foe = g.state.sides[side === 'police' ? 'rioters' : 'police'];
    // 第 2 转折点起主动压上（约 2/3 的人推进，1/3 留守目标）
    var push = g.state.tp >= 2 && (u.id.charCodeAt(u.id.length - 1) % 3 !== 0);
    var aggro = lv.aggro >= 1 ? true : (push || me.vp < foe.vp || nd <= 24 * lv.aggro + 8);

    var guard = 0;
    while (g.state.activeId === u.id && guard++ < 6) {
      var acted = false;

      // 0. 站在补给点上就立刻捡
      if (g.apLeft(u) >= 1 && g.pickupsNear) {
        var pk = g.pickupsNear(u);
        if (pk.length) {
          var pr = g.pickUp(u.id, pk[0].id);
          if (pr && pr.ok) acted = true;
        }
      }

      // 1. 近战
      var adj = g.state.units.filter(function (e) {
        return e.alive && e.side !== side && g.dist(e.pos, u.pos) <= 1;
      });
      if (adj.length && g.apLeft(u) >= 1) {
        adj.sort(function (a, b) { return a.wounds - b.wounds; });
        var w = g.firstMelee(u);
        var r = g.fight(u.id, adj[0].id, w ? w.id : null);
        if (r.ok) acted = true;
      }

      // 1.4 无人机：优先出手（每转折点一次，独立资源）
      if (g.apLeft(u) >= 1) {
        var allFoes = g.state.units.filter(function (e) { return e.alive && e.side !== side; });
        if (g.useDroneShot && u.droneShot && u.droneUsedTP !== g.state.tp) {
          var dt = allFoes.filter(function (e) { return g.dist(e.pos, u.pos) <= 12; })
            .sort(function (p, q) { return p.wounds - q.wounds; })[0];
          if (dt) { var dr = g.useDroneShot(u.id, dt.id); if (dr && dr.ok) acted = true; }
        }
        if (g.useDroneScout && u.scout && u.scoutUsedTP !== g.state.tp) {
          var st = allFoes.filter(function (e) { return e.order === 'conceal' && g.dist(e.pos, u.pos) <= 12; })[0];
          if (st) { var sr = g.useDroneScout(u.id, st.id); if (sr && sr.ok) acted = true; }
        }
      }

      // 1.5 投掷物：按效果挑最合适的
      if (!acted && g.apLeft(u) >= 1) {
        var bestScore = -1, bestAct = null;
        var foes = g.state.units.filter(function (e) { return e.alive && e.side !== side; });
        (u.equip || []).forEach(function (id) {
          var E = DATA.EQUIP[id];
          if (!E || E.cat !== 'throwable') return;
          if ((u.throwUsed || []).indexOf(id) >= 0) return;
          foes.forEach(function (e) {
            if (g.dist(e.pos, u.pos) > 12) return;
            var cluster = foes.filter(function (o) { return g.dist(o.pos, e.pos) <= 1.5; }).length;
            var sc = 0;
            if (id === 'frag_grenade' || id === 'pipe_bomb' || id === 'nail_bomb') sc = 10 + (3 - Math.min(3, e.wounds)) + cluster * 2;
            else if (id === 'flashbang' || id === 'stun_grenade') sc = 8 + (e.order === 'engage' ? 2 : 0);
            else if (id === 'molotov' || id === 'incendiary') sc = 7 + cluster * 3;
            else if (id === 'tear_gas' || id === 'emp_grenade') sc = 6 + cluster * 2;
            else if (id === 'tracer' || id === 'snare_net') sc = 7 + (e.order === 'conceal' ? 2 : 0);
            else if (id === 'smoke_grenade') sc = 4;
            if (sc > bestScore) { bestScore = sc; bestAct = { id: id, target: e }; }
          });
        });
        if (bestAct && bestScore >= 6) {
          // 爆破类：如果两个人靠得近，扔他们中间的空地能一次炸到两个
          var aim = bestAct.target.id;
          var E2 = DATA.EQUIP[bestAct.id];
          if (E2 && E2.eff && E2.eff.blast) {
            var bestPt = null, bestN = 0;
            var alive = g.state.units.filter(function (x) { return x.alive && x.side !== side; });
            for (var ia = 0; ia < alive.length; ia++) {
              for (var ib = ia + 1; ib < alive.length; ib++) {
                var A = alive[ia], B = alive[ib];
                if (g.dist(A.pos, B.pos) > 3.2) continue;
                var mid = { x: (A.pos.x + B.pos.x) / 2, y: (A.pos.y + B.pos.y) / 2 };
                if (g.dist(u.pos, mid) > 12) continue;
                var n = alive.filter(function (o) { return g.dist(o.pos, mid) <= 1.6; }).length;
                if (n > bestN) { bestN = n; bestPt = mid; }
              }
            }
            if (bestPt && bestN >= 2) aim = bestPt;   // 中间比单体更划算
          }
          var tr = g.throwGear(u.id, bestAct.id, aim);
          if (tr && tr.ok) acted = true;
        }
      }

      // 2. 射击（会按难度决定要不要花 CP 重掷）
      if (!acted && g.apLeft(u) >= 1) {
        trySentryOnTargets(g, u, side);
        if (shootSmart(g, u, side)) acted = true;
      }

      // 3. 冲锋
      if (!acted && g.apLeft(u) >= 1 && u.order === 'engage') {
        var cand = enemies.filter(function (e) {
          var d = g.dist(e.pos, u.pos);
          return e.alive && d > 1 && d <= u.move + 2;
        }).sort(function (a, b) { return a.wounds - b.wounds; });
        for (var i = 0; i < cand.length && !acted; i++) {
          var sentryRes = g.trySentry ? g.trySentry(cand[i].id, u.pos) : null;
          if (sentryRes && sentryRes.ok && sentryRes.dashed) {
            var d2 = g.dist(cand[i].pos, u.pos);
            if (d2 > u.move + 2) continue;         // 跑掉了就换目标
          }
          var spot = chargeSpot(g, u, cand[i]);
          if (spot) {
            var r3 = g.doMove(u.id, 'charge', [spot]);
            if (r3.ok) acted = true;
          }
        }
      }

      // 3.5 残血脱离
      if (!acted && lv.fallback && g.apLeft(u) >= 2 && u.wounds <= u.maxWounds * 0.34) {
        var engaged = g.state.units.filter(function (e) {
          return e.alive && e.side !== side && g.dist(e.pos, u.pos) <= 1.2;
        }).sort(function (a, b) { return g.dist(a.pos, u.pos) - g.dist(b.pos, u.pos); })[0];
        if (engaged) {
          var flee = fallbackSpot(g, u, side, engaged);
          if (flee) {
            var rf = g.doMove(u.id, 'fallback', flee);
            if (rf.ok) acted = true;
          }
        }
      }

  /** 目标在墙的另一侧时，穿过门/窗比绕路更近就用它（1 AP） */
  function tryPortal(g, u, side) {
    if (g.apLeft(u) < 1) return false;
    var foes = g.state.units.filter(function (e) { return e.alive && e.side !== side; });
    // 目标：优先最近的目标点，其次最近的敌人
    var goalPt = null;
    if (g.state.markers && g.state.markers.length) {
      var mk = g.state.markers.slice().sort(function (p, q) { return g.dist(p, u.pos) - g.dist(q, u.pos); })[0];
      goalPt = { x: mk.x, y: mk.y };
    } else if (foes.length) {
      var fd = foes.slice().sort(function (p, q) { return g.dist(p.pos, u.pos) - g.dist(q.pos, u.pos); })[0];
      goalPt = { x: fd.pos.x, y: fd.pos.y };
    }
    if (!goalPt) return false;
    var here = g.dist(u.pos, goalPt);

    var cands = [];
    (g.doorsNear(u) || []).forEach(function (d) { cands.push({ kind: 'door', item: d }); });
    (g.windowsNear(u) || []).forEach(function (w) { cands.push({ kind: 'window', item: w }); });

    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], r = c.item;
      var horiz = r.w >= r.h;
      var dx = horiz ? r.w / 2 : 0.7;
      var dy = horiz ? 0.7 : r.h / 2;
      var sides = [
        { x: r.x + r.w / 2, y: r.y + r.h / 2 - dy },
        { x: r.x + r.w / 2, y: r.y + r.h / 2 + dy },
        { x: r.x + r.w / 2 - dx, y: r.y + r.h / 2 },
        { x: r.x + r.w / 2 + dx, y: r.y + r.h / 2 }
      ];
      for (var k = 0; k < sides.length; k++) {
        var p = sides[k];
        if (!g.canPlace(u, p.x, p.y)) continue;
        var after = g.dist(p, goalPt);
        // 穿过去明显更近才用（避免为省 1 寸浪费 1 AP）
        if (after < here - 1.5) {
          var rr = c.kind === 'door' ? g.useDoor(u.id, r.id) : g.useWindow(u.id, r.id);
          if (rr && rr.ok) return true;
        }
      }
    }
    return false;
  }

      // 3.8 医疗 / 通讯装备
      if (!acted && g.apLeft(u) >= 1 && u.medkit && u.wounds <= u.maxWounds - 3) {
        var mr = g.useMedkit(u.id, u.id);
        if (mr && mr.ok) acted = true;
      }
      if (!acted && g.apLeft(u) >= 1 && u.radioAP && u.radioUsedTP !== g.state.tp) {
        var ally = g.state.units.filter(function (x) {
          return x.alive && x.side === u.side && x.id !== u.id && x.state === 'ready' &&
            g.dist(x.pos, u.pos) <= 12 && g.apLeft(x) < 2;
        })[0];
        if (ally) {
          var rr = g.useRadio(u.id, ally.id);
          if (rr && rr.ok) acted = true;
        }
      }

      // 3.9 门窗捷径
      if (!acted && g.apLeft(u) >= 1) {
        if (tryPortal(g, u, side)) acted = true;
      }

      // 4. 移动
      if (!acted && g.apLeft(u) >= 1) {
        var dest = pickDestination(g, u, side, aggro);
        if (dest) {
          var r4 = g.doMove(u.id, 'move', dest.pts);
          if (r4.ok) acted = true;
          else if (g.apLeft(u) >= 1 && tryPortal(g, u, side)) acted = true;
        } else if (g.apLeft(u) >= 1 && tryPortal(g, u, side)) acted = true;
      }

      // 4.5 移动后如果贴着门口/窗口，直接进去
      if (g.apLeft(u) >= 1) {
        var nearDoor = g.doorsNear(u) || [];
        var nearWin = g.windowsNear(u) || [];
        if (nearDoor.length || nearWin.length) {
          if (tryPortal(g, u, side)) acted = true;
        }
      }

      // 5. 还有余量就进入警戒/哨戒
      if (!acted && !u.guard && g.apLeft(u) >= 2) {
        var engagedInMelee = g.state.units.some(function (e) {
          return e.alive && e.side !== side && g.dist(e.pos, u.pos) <= 1;
        });
        var kind = null;
        if (!engagedInMelee) {
          var foes = g.state.units.filter(function (e) { return e.alive && e.side !== side; });
          var nearest = foes.length ? Math.min.apply(null, foes.map(function (e) { return g.dist(e.pos, u.pos); })) : 999;
          if (nearest <= 18) kind = 'overwatch';
          else if (lv.fallback) kind = 'sentry';
        }
        if (kind) {
          var gr = g.setGuard(u.id, kind);
          if (gr.ok) acted = true;
        }
      }

      if (!acted) break;
      if (!g.state.activeId) break;
      if (g.apLeft(u) < 1) break;
    }

    if (g.state.activeId === u.id) g.endActivation();
    return true;
  }

  function chargeSpot(g, u, target) {
    for (var a = 0; a < 16; a++) {
      var ang = (a / 16) * Math.PI * 2;
      var p = { x: target.pos.x + Math.cos(ang) * 0.95, y: target.pos.y + Math.sin(ang) * 0.95 };
      if (!g.canPlace(u, p.x, p.y, { forCharge: true })) continue;
      var cost = g.pathCost(u, [p]);
      if (cost > u.move + 2) continue;
      if (g.blockReason(u, u.pos, p, { ignoreEnemies: true })) continue;
      return p;
    }
    return null;
  }

  /**
   * 选一个能真正走过去的落点：朝目标方向做 ±(0/12°/24°/36°) 采样，
   * 逐个用 blockReason / canPlace 预检，再挑"向目标推进最多"的那个。
   */
  /* ---------------------------------------------------------------- 寻路 */
  var CELL = 1;
  function navGrid(g) {
    if (g.__nav) return g.__nav;
    var W = g.state.map.boardW, H = g.state.map.boardH;
    var nx = Math.floor(W / CELL), ny = Math.floor(H / CELL);
    var blocked = new Uint8Array(nx * ny);
    var solids = g.state.map.terrain.filter(function (t) { return t.solid; });
    var R = 0.58;
    for (var y = 0; y < ny; y++) {
      for (var x = 0; x < nx; x++) {
        var cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
        var bad = false;
        for (var i = 0; i < solids.length; i++) {
          var t = solids[i];
          var px = Math.max(t.x, Math.min(cx, t.x + t.w));
          var py = Math.max(t.y, Math.min(cy, t.y + t.h));
          if (Math.hypot(cx - px, cy - py) <= R) { bad = true; break; }
        }
        if (cx < R || cy < R || cx > W - R || cy > H - R) bad = true;
        blocked[y * nx + x] = bad ? 1 : 0;
      }
    }
    g.__nav = { nx: nx, ny: ny, blocked: blocked, cell: CELL, W: W, H: H };
    return g.__nav;
  }

  function cellIndex(nav, x, y) {
    var cx = Math.max(0, Math.min(nav.nx - 1, Math.floor(x / nav.cell)));
    var cy = Math.max(0, Math.min(nav.ny - 1, Math.floor(y / nav.cell)));
    return cy * nav.nx + cx;
  }

  function nearestFree(nav, idx) {
    if (!nav.blocked[idx]) return idx;
    var x0 = idx % nav.nx, y0 = Math.floor(idx / nav.nx);
    for (var r = 1; r <= 6; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var x = x0 + dx, y = y0 + dy;
          if (x < 0 || y < 0 || x >= nav.nx || y >= nav.ny) continue;
          if (!nav.blocked[y * nav.nx + x]) return y * nav.nx + x;
        }
      }
    }
    return -1;
  }

  function aStar(g, from, to) {
    var nav = navGrid(g);
    var s = nearestFree(nav, cellIndex(nav, from.x, from.y));
    var t = nearestFree(nav, cellIndex(nav, to.x, to.y));
    if (s < 0 || t < 0) return null;
    if (s === t) return [];
    var n = nav.nx * nav.ny;
    var open = [s];
    var gScore = new Float32Array(n);
    var fScore = new Float32Array(n);
    var came = new Int32Array(n);
    var closed = new Uint8Array(n);
    for (var q = 0; q < n; q++) { gScore[q] = Infinity; fScore[q] = Infinity; came[q] = -1; }
    gScore[s] = 0; fScore[s] = 0;
    var dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    var guard = 0;
    while (open.length && guard++ < 9000) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur === t) break;
      closed[cur] = 1;
      var cx = cur % nav.nx, cy = Math.floor(cur / nav.nx);
      for (var d = 0; d < dirs.length; d++) {
        var nx2 = cx + dirs[d][0], ny2 = cy + dirs[d][1];
        if (nx2 < 0 || ny2 < 0 || nx2 >= nav.nx || ny2 >= nav.ny) continue;
        var ni = ny2 * nav.nx + nx2;
        if (nav.blocked[ni] || closed[ni]) continue;
        if (dirs[d][2] > 1) {
          if (nav.blocked[cy * nav.nx + nx2] || nav.blocked[ny2 * nav.nx + cx]) continue;
        }
        var ng = gScore[cur] + dirs[d][2];
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = cur;
          var tx = t % nav.nx, ty = Math.floor(t / nav.nx);
          var hx = Math.abs(nx2 - tx), hy = Math.abs(ny2 - ty);
          fScore[ni] = ng + (hx + hy) + (1.4142 - 2) * Math.min(hx, hy);
          if (open.indexOf(ni) < 0) open.push(ni);
        }
      }
    }
    if (came[t] < 0 && s !== t) return null;
    var path = [];
    var c = t, guard2 = 0;
    while (c !== s && c >= 0 && guard2++ < 3000) {
      path.push({ x: (c % nav.nx + 0.5) * nav.cell, y: (Math.floor(c / nav.nx) + 0.5) * nav.cell });
      c = came[c];
    }
    path.reverse();
    return path;
  }

  /** 把 A* 路径裁剪成"本次能走完的一段"（按引擎的向上取整算钱） */
  function pathBudget(unit, path, budget) {
    if (!path || !path.length) return null;
    var pts = [], acc = 0;
    var prev = { x: unit.pos.x, y: unit.pos.y };
    for (var i = 0; i < path.length; i++) {
      var seg = Math.hypot(path[i].x - prev.x, path[i].y - prev.y);
      var c = Math.ceil(seg - 1e-9);
      if (acc + c > budget) break;
      acc += c;
      pts.push(path[i]);
      prev = path[i];
    }
    return pts.length ? pts : null;
  }

  /** 目标点本身可能被墙/隔断占住：在它周围找最近的可站立点 */
  function approachPoint(g, u, m) {
    // 目标点正中心常被友军占住：直接找 0.6~0.95 寸内的可站点（控制半径就是 1 寸）
    let best = null, bd = 1e9;
    for (let ring = 0.6; ring <= 0.95; ring += 0.15) {
      for (let i = 0; i < 16; i++) {
        const ang = i / 16 * Math.PI * 2;
        const p = { x: m.x + Math.cos(ang) * ring, y: m.y + Math.sin(ang) * ring };
        if (!g.canPlace(u, p.x, p.y)) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) return best;
    }
    return { x: m.x, y: m.y };
  }

  /** 目标在建筑里：先走到门口（建筑内部靠门/窗进出，A* 进不去） */
  function doorApproach(g, m) {
    var b = null;
    g.state.map.terrain.forEach(function (t) {
      if (b || t.kind !== 'building') return;
      if (m.x >= t.x && m.x <= t.x + t.w && m.y >= t.y && m.y <= t.y + t.h) b = t;
    });
    if (!b) return null;
    var doors = (g.state.map.doors || []).filter(function (d) {
      return d.x >= b.x - 0.1 && d.x <= b.x + b.w + 0.1 && d.y >= b.y - 0.1 && d.y <= b.y + b.h + 0.1;
    });
    if (!doors.length) return null;
    var best = null, bd = 1e9;
    doors.forEach(function (d) {
      var p = { x: d.x + d.w / 2, y: d.y - 1.2 };   // 门外（南侧）
      var dd = g.dist(p, m);
      if (dd < bd) { bd = dd; best = p; }
    });
    return best;
  }

  function pickDestination(g, u, side, aggro) {
    var markers = g.state.markers.filter(function (m) { return !m.carriedBy; });
    var enemies = g.state.units.filter(function (e) { return e.alive && e.side !== side; });
    var holding = !u.carrying && markers.some(function (m) { return g.dist(u.pos, m) <= 1; });
    var nearestEnemy = null, ned = 1e9;
    enemies.forEach(function (e) {
      var d = g.dist(e.pos, u.pos);
      if (d < ned) { ned = d; nearestEnemy = e; }
    });
    if (holding && !aggro && !u.carrying) return null;

    var targets = [];
    if (u.carrying) {
      var z = g.state.map.dropZones[side];
      targets.push({ x: z.x + z.w / 2, y: z.y + z.h / 2 });
    } else if (aggro && nearestEnemy) {
      // 抢分优先：先冲目标点，没有目标点才追人
      if (markers.length) {
        preferMarkers(g, u, markers).slice(0, 3).forEach(function (m) { targets.push(approachPoint(g, u, doorApproach(g, m) || m)); });
      } else {
        targets.push({ x: nearestEnemy.pos.x, y: nearestEnemy.pos.y });
      }
    } else {
      preferMarkers(g, u, markers).slice(0, 3).forEach(function (m) { targets.push(approachPoint(g, u, doorApproach(g, m) || m)); });
      if (nearestEnemy) targets.push({ x: nearestEnemy.pos.x, y: nearestEnemy.pos.y });
    }

    var best = null, bestScore = -1e9;
    targets.forEach(function (t, ti) {
      var path = aStar(g, u.pos, t);
      if (!path) return;
      var pts = pathBudget(u, path, u.move);
      if (!pts) return;
      // 逐步回退，直到终点可放置、且不在敌方控制范围内
      while (pts.length) {
        var end = pts[pts.length - 1];
        var okPos = g.canPlace(u, end.x, end.y);
        // 争点：站在目标点 1 寸内是可以接受的风险（不然永远拿不到分）
        var onPoint = markers.some(function (mk) { return g.dist(end, mk) <= 1.0; });
        var danger = !onPoint && g.enemiesInControlOf(end, u.side).length > 0;
        if (okPos && !danger) break;
        pts.pop();
      }
      if (!pts.length) return;
      var end2 = pts[pts.length - 1];
      var gain = g.dist(u.pos, t) - g.dist(end2, t);
      var score = gain * 2 - ti * 0.4;
      if (aggro) score += gain * 0.5;
      score += coverScoreAt(g, end2) * 2.2 * cfg().cover;
      // 站到目标点旁边 = 拿分，优先级最高
      markers.forEach(function (mk) {
        if (g.dist(end2, mk) <= 0.95) score += 30;
        else if (g.dist(end2, mk) <= 1.6) score += 8;
      });
      if (nearestEnemy && g.dist(end2, nearestEnemy.pos) < 8) score -= 1.5;   // 别贴脸站桩
      if (score > bestScore) { bestScore = score; best = { pts: pts }; }
    });
    return best;
  }


  function hash2(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
    return h;
  }

  function preferMarkers(g, u, markers) {
    return markers.slice().sort(function (a, b) {
      var ja = (hash2(u.id + a.id) % 9) * 0.55;
      var jb = (hash2(u.id + b.id) % 9) * 0.55;
      return (g.dist(u.pos, a) + ja) - (g.dist(u.pos, b) + jb);
    });
  }

  /** 反应：用一名待机交战特工免费射一发（AI 只做"能射就射"） */
  function takeReaction(g, side) {
    if (!g.canReact(side)) return false;
    var units = g.state.units.filter(function (u) {
      return u.alive && u.side === side && u.state === 'spent' &&
        u.order === 'engage' && !u.reactedThisTP;
    });
    if (!units.length) return false;
    var enemies = g.state.units.filter(function (e) { return e.alive && e.side !== side; });
    var best = null, bestScore = -1e9;
    units.forEach(function (u) {
      // 反应移动上限 2"，所以只考虑原地能射的目标
      enemies.forEach(function (e) {
        var info = shootInfoOf(g, u, e);
        if (!info || !info.valid) return;
        var score = 20 - e.wounds;
        if (score > bestScore) { bestScore = score; best = { u: u, e: e }; }
      });
    });
    if (!best) return false;
    var w = best.u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
      .filter(function (x) { return x && x.type === 'ranged'; })[0];
    if (!w) return false;
    var r = g.beginReaction(best.u.id);
    if (!r.ok) return false;
    shootAt(g, best.u, best.e, w, side);
    g.endActivation();     // 反应结束，回到待机
    return true;
  }

  return {
    takeTurn: takeTurn,
    takeReaction: takeReaction,
    planActivation: planActivation,
    setLevel: setLevel,
    getLevel: getLevel,
    levels: function () { return Object.keys(LEVELS).map(function (k) { return LEVELS[k]; }); }
  };
})(typeof module !== 'undefined' && module.exports ? require('./data.js') : (typeof DATA !== 'undefined' ? DATA : null));

if (typeof module !== 'undefined' && module.exports) { module.exports = AI; }
