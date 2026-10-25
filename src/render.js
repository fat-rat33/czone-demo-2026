/* ==========================================================================
 * C 区 · 橙色 —— 渲染层（Canvas 2D，俯视）
 * ========================================================================== */
var RENDER = (function () {
  'use strict';

  function create(canvas, game) {
    var ctx = canvas.getContext('2d');
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    var view = {
      scale: 15,
      ox: 0,
      oy: 0,
      selectedId: null,
      hoverUnitId: null,
      mode: 'idle',          // idle | move | shoot | fight | charge | deploy | place
      previewPath: null,
      previewCost: 0,
      previewValid: true,
      targetId: null,
      showZones: false,
      showGrid: false,
      hoverPos: null,
      flash: []
    };
    var W = game.state.map.boardW, H = game.state.map.boardH;
    var noiseTile = makeNoise(256);
    var scanTile = makeScanlines();

    /* -------------------------------------------------------- 工具 */
    function makeNoise(size) {
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var g = c.getContext('2d');
      var img = g.createImageData(size, size);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = 128 + (Math.random() * 2 - 1) * 34;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c;
    }

    function makeScanlines() {
      var c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      var g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, 0, 4, 2);
      return c;
    }

    function resize() {
      var rect = canvas.parentElement.getBoundingClientRect();
      var w = Math.max(640, rect.width), h = Math.max(420, rect.height);
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      // 适配：让 60×44 落在 HUD 面板之间的可视区
      var inset = { l: 250, r: 284, t: 66, b: 92 };
      if (w < 1200) inset = { l: 210, r: 234, t: 60, b: 86 };
      var availW = w - inset.l - inset.r;
      var availH = h - inset.t - inset.b;
      var sx = availW / W, sy = availH / H;
      view.scale = Math.min(sx, sy);
      view.ox = inset.l + (availW - W * view.scale) / 2;
      view.oy = inset.t + (availH - H * view.scale) / 2;
      draw();
    }

    function px(x, y) { return { x: view.ox + x * view.scale, y: view.oy + y * view.scale }; }
    function inv(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var x = (clientX - r.left - view.ox) / view.scale;
      var y = (clientY - r.top - view.oy) / view.scale;
      return { x: x, y: y };
    }

    /* -------------------------------------------------------- 地面 */
    function drawGround() {
      var a = px(0, 0), b = px(W, H);
      // 沥青底
      var g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, '#191c21');
      g.addColorStop(0.45, '#191c21');
      g.addColorStop(1, '#14171b');
      ctx.fillStyle = g;
      ctx.fillRect(a.x, a.y, W * view.scale, H * view.scale);

      // 噪声
      ctx.save();
      ctx.globalAlpha = 0.055;
      ctx.globalCompositeOperation = 'overlay';
      var pat = ctx.createPattern(noiseTile, 'repeat');
      ctx.fillStyle = pat;
      ctx.fillRect(a.x, a.y, W * view.scale, H * view.scale);
      ctx.restore();

      // 街道：横向主路 y=17.5..26.5
      var st = px(0, 17.5), st2 = px(W, 26.5);
      var rg = ctx.createLinearGradient(0, st.y, 0, st2.y);
      rg.addColorStop(0, '#2a2f36');
      rg.addColorStop(0.5, '#242930');
      rg.addColorStop(1, '#2a2f36');
      ctx.fillStyle = rg;
      ctx.fillRect(st.x, st.y, st2.x - st.x, st2.y - st.y);

      // 车道虚线
      ctx.save();
      ctx.strokeStyle = 'rgba(255,180,60,0.18)';
      ctx.lineWidth = Math.max(2, view.scale * 0.16);
      ctx.setLineDash([view.scale * 1.4, view.scale * 1.4]);
      ctx.beginPath();
      var mid = px(0, 22);
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(px(W, 22).x, mid.y);
      ctx.stroke();
      ctx.restore();

      // 纵向巷道（左右各一条暗色）
      ['36.5'].forEach(function (x) {
        var g1 = px(x, 0), g2 = px(x + 3, H);
        ctx.fillStyle = 'rgba(255,255,255,0.012)';
        ctx.fillRect(g1.x, g1.y, g2.x - g1.x, g2.y - g1.y);
      });

      // 裂纹
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.2;
      var rnd = seeded(7);
      for (var i = 0; i < 26; i++) {
        var sx = rnd() * W, sy = rnd() * H;
        ctx.beginPath();
        ctx.moveTo(px(sx, sy).x, px(sx, sy).y);
        var cx = sx, cy = sy;
        for (var k = 0; k < 4; k++) {
          cx += (rnd() - 0.5) * 3; cy += (rnd() - 0.5) * 3;
          ctx.lineTo(px(cx, cy).x, px(cx, cy).y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // 路缘
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      [17.5, 26.5].forEach(function (y) {
        ctx.beginPath();
        ctx.moveTo(px(0, y).x, px(0, y).y);
        ctx.lineTo(px(W, y).x, px(W, y).y);
        ctx.stroke();
      });

      drawSidewalks();
      drawDecor();
    }

    /* 人行道 + 街沿 */
    function drawSidewalks() {
      [[11.4, 17.5], [26.5, 32.6]].forEach(function (band) {
        var a = px(0, band[0]), b = px(W, band[1]);
        ctx.fillStyle = 'rgba(255,255,255,0.022)';
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        [band[0], band[1]].forEach(function (yy) {
          ctx.beginPath();
          ctx.moveTo(px(0, yy).x, px(0, yy).y);
          ctx.lineTo(px(W, yy).x, px(0, yy).y);
          ctx.stroke();
        });
        // 铺装缝
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        for (var x = 0; x < W; x += 4) {
          ctx.beginPath();
          ctx.moveTo(px(x, band[0]).x, px(x, band[0]).y);
          ctx.lineTo(px(x + 0.4, band[1]).x, px(x + 0.4, band[1]).y);
          ctx.stroke();
        }
      });
    }

    /* 装饰：水洼、垃圾、油桶、轮胎、路锥（不影响规则） */
    function drawDecor() {
      var rnd = seeded(20251);
      // 水洼
      for (var i = 0; i < 9; i++) {
        var wx = rnd() * W, wy = 3 + rnd() * (H - 6);
        var rx = (0.8 + rnd() * 1.8) * view.scale;
        var ry = rx * (0.35 + rnd() * 0.25);
        var p = px(wx, wy);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, ry, rnd() * 3, 0, Math.PI * 2);
        var gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
        gg.addColorStop(0, 'rgba(60,120,150,0.22)');
        gg.addColorStop(0.7, 'rgba(20,40,55,0.28)');
        gg.addColorStop(1, 'rgba(10,15,20,0)');
        ctx.fillStyle = gg;
        ctx.fill();
        ctx.restore();
      }
      // 垃圾与碎石
      ctx.save();
      for (var k = 0; k < 110; k++) {
        var x = rnd() * W, y = rnd() * H;
        var pp = px(x, y);
        var s = 1.5 + rnd() * 4.5;
        ctx.fillStyle = 'rgba(' + (90 + rnd() * 40 | 0) + ',' + (90 + rnd() * 40 | 0) + ',' + (95 + rnd() * 40 | 0) + ',' + (0.15 + rnd() * 0.35).toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(pp.x + s, pp.y + s * 0.5);
        ctx.lineTo(pp.x + s * 0.4, pp.y + s);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // 油桶
      var barrels = [[7, 14], [9.5, 30.5], [46, 27], [53, 12.5], [23, 24], [37.5, 21]];
      barrels.forEach(function (b) {
        var p = px(b[0], b[1]);
        var r = 0.42 * view.scale;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + r * 0.4, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        var g2 = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 1, p.x, p.y, r);
        g2.addColorStop(0, '#5a6b3f');
        g2.addColorStop(1, '#2a3320');
        ctx.fillStyle = g2;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,180,60,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      });
      // 路锥
      var cones = [[16, 18.6], [35.5, 24.5], [29, 28.4], [44.5, 19.6]];
      cones.forEach(function (c) {
        var p = px(c[0], c[1]);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 6);
        ctx.lineTo(p.x + 5, p.y + 3);
        ctx.lineTo(p.x - 5, p.y + 3);
        ctx.closePath();
        ctx.fillStyle = 'rgba(240,110,30,0.75)';
        ctx.fill();
        ctx.fillStyle = 'rgba(240,240,240,0.6)';
        ctx.fillRect(p.x - 3.5, p.y - 2, 7, 2);
        ctx.restore();
      });
    }

    function seeded(s) {
      var a = s >>> 0;
      return function () {
        a = (a * 1664525 + 1013904223) % 4294967296;
        return a / 4294967296;
      };
    }

    /* -------------------------------------------------------- 地形 */
    function drawTerrain() {
      var list = game.state.map.terrain.slice().sort(function (a, b) {
        return (a.y + a.h) - (b.y + b.h);
      });
      list.forEach(function (t) {
        if (t.render === false) return;
        if (t.kind === 'building') drawBuilding(t);
        else if (t.kind === 'ruin') drawRubble(t);
        else if (t.kind === 'wreck') drawWreck(t);
        else if (t.kind === 'barricade') drawBarricade(t);
        else if (t.kind === 'platform') drawPlatform(t);
        else drawRubble(t);
      });
      drawGraffiti();
    }

    function shadow(t, blur) {
      var p = px(t.x, t.y);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = blur || 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(p.x, p.y, t.w * view.scale, t.h * view.scale);
      ctx.restore();
    }

    function drawBuilding(t) {
      var p = px(t.x, t.y), w = t.w * view.scale, h = t.h * view.scale;
      shadow(t, 26);
      // 屋顶
      var g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + h);
      g.addColorStop(0, '#2b3039');
      g.addColorStop(1, '#1b1f25');
      ctx.fillStyle = g;
      ctx.fillRect(p.x, p.y, w, h);
      // 墙体厚度
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x, p.y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 3, p.y + 3, w - 6, h - 6);

      // 屋顶细节：通风口 / 水箱 / 破损
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, w, h);
      ctx.clip();
      var rnd = seeded(Math.round(t.x * 31 + t.y * 17));
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      for (var i = 0; i < 5; i++) {
        var bw = (0.6 + rnd() * 1.4) * view.scale;
        var bh = (0.6 + rnd() * 1.2) * view.scale;
        ctx.fillRect(p.x + rnd() * (w - bw), p.y + rnd() * (h - bh), bw, bh);
      }
      // 破损缺口
      ctx.fillStyle = 'rgba(8,9,11,0.85)';
      ctx.beginPath();
      var hx = p.x + rnd() * w * 0.7, hy = p.y + rnd() * h * 0.7;
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + 18, hy + 6);
      ctx.lineTo(hx + 10, hy + 22);
      ctx.lineTo(hx - 6, hy + 14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 霓虹招牌
      if (t.style === 'shop') {
        var glow = t.label.indexOf('诊所') >= 0 ? '#35e0ff'
          : t.label.indexOf('夜店') >= 0 ? '#ff3ba7'
            : t.label.indexOf('公寓') >= 0 ? '#ffd23c' : '#ff7a3c';
        ctx.save();
        ctx.font = '600 ' + Math.max(10, view.scale * 0.55) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = glow;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 12;
        ctx.globalAlpha = 0.85;
        ctx.fillText(t.label, p.x + 8, p.y + h - 8);
        ctx.restore();
        // 招牌灯管
        ctx.strokeStyle = 'rgba(255,140,60,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 5, p.y + h - 5 - view.scale * 0.7, w - 10, view.scale * 0.55);
      }
    }

    function drawWreck(t) {
      var p = px(t.x, t.y), w = t.w * view.scale, h = t.h * view.scale;
      shadow(t, 16);
      ctx.save();
      ctx.translate(p.x + w / 2, p.y + h / 2);
      ctx.rotate(-0.12);
      var body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      body.addColorStop(0, '#33373f');
      body.addColorStop(0.5, '#41464f');
      body.addColorStop(1, '#22262c');
      ctx.fillStyle = body;
      roundRect(-w / 2, -h / 2, w, h, 6);
      ctx.fill();
      ctx.strokeStyle = '#0a0b0d';
      ctx.lineWidth = 2;
      ctx.stroke();
      // 车窗
      ctx.fillStyle = 'rgba(10,14,18,0.9)';
      roundRect(-w * 0.16, -h / 2 + 3, w * 0.34, h - 6, 3);
      ctx.fill();
      // 烧灼
      ctx.fillStyle = 'rgba(255,110,40,0.10)';
      ctx.beginPath();
      ctx.ellipse(w * 0.24, 0, w * 0.12, h * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      // 警灯
      if (t.label.indexOf('警车') >= 0) {
        ctx.fillStyle = 'rgba(70,150,255,0.85)';
        ctx.fillRect(-w * 0.05, -4, 6, 8);
        ctx.fillStyle = 'rgba(255,60,60,0.75)';
        ctx.fillRect(w * 0.02, -4, 6, 8);
      }
      ctx.restore();
    }

    function drawBarricade(t) {
      var p = px(t.x, t.y), w = t.w * view.scale, h = t.h * view.scale;
      shadow(t, 12);
      if (t.style === 'sandbag') {
        ctx.save();
        var rnd = seeded(Math.round(t.x * 13 + t.y * 7));
        for (var i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 ? '#4a4536' : '#3d3a2e';
          roundRect(p.x + (i % 3) * w / 3 + 1, p.y + Math.floor(i / 3) * h / 2 + 1, w / 3 - 2, h / 2 - 2, 4);
          ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#2c3138';
        ctx.fillRect(p.x, p.y, w, h);
        // 黄黑警示条
        ctx.save();
        ctx.beginPath(); ctx.rect(p.x, p.y, w, h); ctx.clip();
        ctx.strokeStyle = 'rgba(255,196,0,0.55)';
        ctx.lineWidth = Math.max(3, h * 0.25);
        for (var k = -h; k < w + h; k += h * 0.9) {
          ctx.beginPath();
          ctx.moveTo(p.x + k, p.y + h);
          ctx.lineTo(p.x + k + h, p.y);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = '#0a0b0d';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, w, h);
      }
    }

    function drawPlatform(t) {
      var p = px(t.x, t.y), w = t.w * view.scale, h = t.h * view.scale;
      // 高台投影
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(p.x + 6, p.y + 8, w, h);
      ctx.restore();
      var g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + h);
      g.addColorStop(0, '#3a4250');
      g.addColorStop(1, '#232a34');
      ctx.fillStyle = g;
      ctx.fillRect(p.x, p.y, w, h);
      ctx.strokeStyle = 'rgba(120,200,255,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, w, h);
      // 格栅
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      for (var x = p.x + 6; x < p.x + w; x += 8) {
        ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + h); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(120,200,255,0.7)';
      ctx.font = '600 ' + Math.max(9, view.scale * 0.42) + 'px "Microsoft YaHei"';
      ctx.fillText('▲ ' + t.height + '"', p.x + 6, p.y + 14);
    }

    function drawRubble(t) {
      var p = px(t.x, t.y), w = t.w * view.scale, h = t.h * view.scale;
      if (t.style === 'dumpster') {
        shadow(t, 12);
        ctx.fillStyle = '#2f4a3a';
        ctx.fillRect(p.x, p.y, w, h);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(p.x + 4, p.y + 4, w - 8, 4);
        return;
      }
      var rnd = seeded(Math.round(t.x * 7 + t.y * 11));
      ctx.save();
      for (var i = 0; i < 12; i++) {
        var rx = p.x + rnd() * w, ry = p.y + rnd() * h;
        var s = 2 + rnd() * 6;
        ctx.fillStyle = 'rgba(' + (60 + rnd() * 40 | 0) + ',' + (62 + rnd() * 38 | 0) + ',' + (66 + rnd() * 34 | 0) + ',0.9)';
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + s, ry + s * 0.4);
        ctx.lineTo(rx + s * 0.6, ry + s);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    function drawGraffiti() {
      var map = game.state.map;
      ctx.save();
      (map.graffiti || []).forEach(function (g) {
        var p = px(g.x, g.y);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(g.rot || 0);
        ctx.font = '900 ' + (g.size * view.scale * 0.62) + 'px "Microsoft YaHei", Impact, sans-serif';
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.3;
        ctx.shadowColor = g.color;
        ctx.shadowBlur = 10;
        ctx.fillText(g.text, 0, 0);
        ctx.restore();
      });
      (map.symbols || []).forEach(function (s) {
        drawAnarchy(px(s.x, s.y), s.size * view.scale * 0.72, s.rot || 0);
      });
      ctx.restore();
    }

    function drawAnarchy(p, r, rot) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rot);
      ctx.strokeStyle = 'rgba(255,60,60,0.55)';
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.92);
      ctx.lineTo(0, r * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.78, r * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.78, r * 0.62);
      ctx.stroke();
      ctx.restore();
    }

    /* -------------------------------------------------------- 标识 */
    function drawObjectives() {
      game.state.markers.forEach(function (m) {
        if (m.carriedBy) return;
        var p = px(m.x, m.y);
        var r = 0.8 * view.scale;
        var t = performance.now() / 1000;
        var pulse = 0.55 + Math.sin(t * 2 + m.index) * 0.18;
        var ctrl = null;
        try { ctrl = game.markerController ? game.markerController(m) : null; } catch (e) { ctrl = null; }
        var col = ctrl === 'police' ? '74,163,255' : ctrl === 'rioters' ? '255,122,60' : '255,190,60';
        ctx.save();
        ctx.strokeStyle = 'rgba(' + col + ',' + pulse + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(' + col + ',0.22)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.55, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(' + col + ',0.14)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        if (ctrl) {
          ctx.fillStyle = 'rgba(' + col + ',0.9)';
          ctx.beginPath(); ctx.arc(p.x, p.y - r * 1.55, r * 0.22, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,225,170,0.95)';
        ctx.font = '700 ' + Math.round(r * 0.95) + 'px "Microsoft YaHei"';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String.fromCharCode(65 + m.index), p.x, p.y + 1);
        ctx.restore();
      });
    }

    /* -------------------------------------------------------- 单位 */
    function drawUnits() {
      var units = game.state.units.filter(function (u) { return u.alive; });
      units.sort(function (a, b) { return a.pos.y - b.pos.y; });
      units.forEach(function (u) {
        var p = px(u.pos.x, u.pos.y);
        var r = 0.62 * view.scale;
        var fac = DATA.FACTIONS[u.side];
        var isSel = view.selectedId === u.id;
        var isHover = view.hoverUnitId === u.id;
        var isActive = game.state.activeId === u.id;

        // 底座阴影
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + r * 0.35, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill();

        // 高台单位外圈
        if (u.elevation > 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.25, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(120,200,255,0.6)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // 底盘
        var g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.2, p.x, p.y, r);
        g.addColorStop(0, shade(fac.color, 0.35));
        g.addColorStop(1, '#0e1116');
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = isSel ? 3 : 2;
        ctx.strokeStyle = isSel ? '#ffffff' : fac.color;
        ctx.stroke();

        // 命令弧：隐匿 = 半环（下），交战 = 全环
        ctx.beginPath();
        if (u.order === 'engage') {
          ctx.arc(p.x, p.y, r * 0.82, 0, Math.PI * 2);
        } else {
          ctx.arc(p.x, p.y, r * 0.82, Math.PI * 0.15, Math.PI * 0.85);
        }
        ctx.strokeStyle = u.order === 'engage' ? 'rgba(255,90,60,0.9)' : 'rgba(120,200,255,0.85)';
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // 花名/编号
        ctx.save();
        ctx.font = '900 ' + Math.round(r * 1.15) + 'px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var tag = u.isLeader ? '★' : (u.side === 'police' ? 'P' : 'R');
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(tag, p.x, p.y + 1);
        ctx.fillStyle = u.isLeader ? '#ffd979' : '#eef4ff';
        ctx.fillText(tag, p.x, p.y + 1);
        ctx.restore();

        // 受伤条
        if (u.wounds < u.maxWounds) {
          var frac = Math.max(0, u.wounds / u.maxWounds);
          var bw = r * 2.0, bh = 3;
          var bx = p.x - bw / 2, by = p.y - r - 8;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = frac > 0.5 ? '#5ad26a' : frac > 0.25 ? '#ffc400' : '#ff4d3d';
          ctx.fillRect(bx, by, bw * frac, bh);
        }

        // 已待机
        if (u.state === 'spent') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.12, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (u.state === 'active') {
          var t = performance.now() / 400;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * (1.25 + Math.sin(t) * 0.08), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,225,120,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 悬停提示
        if (isHover || isSel) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.45, 0, Math.PI * 2);
          ctx.strokeStyle = isHover ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    function shade(hex, amt) {
      var c = hex.replace('#', '');
      var r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
      r = Math.min(255, r + 255 * amt) | 0;
      g = Math.min(255, g + 255 * amt) | 0;
      b = Math.min(255, b + 255 * amt) | 0;
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    /* -------------------------------------------------------- 覆盖层 */
    function drawZones() {
      if (!view.showZones) return;
      var z = game.state.map.dropZones;
      [['police', z.police], ['rioters', z.rioters]].forEach(function (pair) {
        var sid = pair[0], r = pair[1];
        var p = px(r.x, r.y);
        ctx.save();
        ctx.fillStyle = sid === 'police' ? 'rgba(74,163,255,0.10)' : 'rgba(255,122,60,0.10)';
        ctx.fillRect(p.x, p.y, r.w * view.scale, r.h * view.scale);
        ctx.strokeStyle = sid === 'police' ? 'rgba(74,163,255,0.5)' : 'rgba(255,122,60,0.5)';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, r.w * view.scale, r.h * view.scale);
        ctx.setLineDash([]);
        ctx.fillStyle = sid === 'police' ? 'rgba(120,190,255,0.8)' : 'rgba(255,170,120,0.8)';
        ctx.font = '600 13px "Microsoft YaHei"';
        ctx.save();
        ctx.translate(p.x + 10, p.y + 22);
        ctx.fillText(r.label, 0, 0);
        ctx.restore();
        ctx.restore();
      });
    }

    function drawDeployGhost() {
      var g = view.ghost;
      if (!g) return;
      var p = px(g.x, g.y);
      var r = 0.62 * view.scale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g.valid ? 'rgba(110,255,170,0.18)' : 'rgba(255,70,70,0.18)';
      ctx.fill();
      ctx.strokeStyle = g.valid ? 'rgba(110,255,170,0.85)' : 'rgba(255,80,80,0.85)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    function drawPreview() {
      var u = game.state.units.filter(function (x) { return x.id === view.selectedId; })[0];
      if (!u || !u.alive) return;
      // 控制范围
      var p = px(u.pos.x, u.pos.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.0 * view.scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 移动预览
      if (view.mode === 'move' && view.hoverPos) {
        var hp = px(view.hoverPos.x, view.hoverPos.y);
        var cost = Math.ceil(Math.hypot(view.hoverPos.x - u.pos.x, view.hoverPos.y - u.pos.y));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(hp.x, hp.y);
        ctx.strokeStyle = view.previewValid ? 'rgba(120,255,180,0.9)' : 'rgba(255,80,80,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 0.55 * view.scale, 0, Math.PI * 2);
        ctx.strokeStyle = view.previewValid ? 'rgba(120,255,180,0.9)' : 'rgba(255,80,80,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // 距离标签
        var label = cost + '"';
        ctx.font = '700 13px "Microsoft YaHei"';
        var tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(8,10,12,0.9)';
        roundRect(hp.x + 10, hp.y - 22, tw, 18, 4);
        ctx.fill();
        ctx.fillStyle = view.previewValid ? '#8affc0' : '#ff8080';
        ctx.fillText(label, hp.x + 15, hp.y - 8);
        ctx.restore();
      }

      // 射击/近战目标线
      if ((view.mode === 'shoot' || view.mode === 'fight') && view.hoverUnitId) {
        var t = game.state.units.filter(function (x) { return x.id === view.hoverUnitId; })[0];
        if (t) {
          var tp = px(t.pos.x, t.pos.y);
          var okTarget = view.mode === 'fight'
            ? Math.hypot(t.pos.x - u.pos.x, t.pos.y - u.pos.y) <= 1
            : (function () {
              var w = u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
                .filter(function (x) { return x && x.type === 'ranged'; })[0];
              return w ? game.shootInfo(u, t, w).valid : false;
            })();
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(tp.x, tp.y);
          ctx.strokeStyle = okTarget ? 'rgba(255,90,90,0.85)' : 'rgba(160,160,160,0.5)';
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 0.75 * view.scale, 0, Math.PI * 2);
          ctx.strokeStyle = okTarget ? 'rgba(255,90,90,0.9)' : 'rgba(160,160,160,0.6)';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (view.mode === 'shoot') {
            var info = (function () {
              var w = u.weapons.map(function (id) { return DATA.WEAPONS[id]; })
                .filter(function (x) { return x && x.type === 'ranged'; })[0];
              return w ? game.shootInfo(u, t, w) : null;
            })();
            if (info) {
              var txt = info.valid
                ? (info.cover ? '有效目标 · 有掩护' : '有效目标') + (info.obscured ? ' · 遮挡' : '') +
                  (info.precision ? ' · 精准' + info.precision : '')
                : '不可射击：' + info.why;
              ctx.font = '600 12px "Microsoft YaHei"';
              var tw2 = ctx.measureText(txt).width + 12;
              ctx.fillStyle = 'rgba(8,10,12,0.92)';
              roundRect(tp.x + 14, tp.y - 26, tw2, 20, 4);
              ctx.fill();
              ctx.fillStyle = info.valid ? '#ffd88a' : '#ff8080';
              ctx.fillText(txt, tp.x + 20, tp.y - 12);
            }
          }
          ctx.restore();
        }
      }
    }

    function drawVignette() {
      var w = canvas.width / DPR, h = canvas.height / DPR;
      var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // 扫描线
      ctx.save();
      ctx.globalAlpha = 0.05;
      var pat = ctx.createPattern(scanTile, 'repeat');
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* -------------------------------------------------------- 主绘制 */
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 棋盘外框
      var a = px(0, 0);
      ctx.save();
      ctx.shadowColor = 'rgba(255,120,40,0.25)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(a.x - 8, a.y - 8, W * view.scale + 16, H * view.scale + 16);
      ctx.restore();

      drawGround();
      drawZones();
      drawTerrain();
      drawObjectives();
      drawDeployGhost();
      drawPreview();
      drawUnits();

      // 棋盘边框 + 刻度
      ctx.strokeStyle = 'rgba(255,140,60,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px(0, 0).x, px(0, 0).y, W * view.scale, H * view.scale);
      ctx.save();
      ctx.fillStyle = 'rgba(255,160,80,0.5)';
      ctx.font = '10px "Consolas", monospace';
      for (var i = 2; i < W; i += 2) {
        ctx.fillRect(px(i, 0).x, px(0, 0).y - 4, 1, 4);
      }
      for (var j = 2; j < H; j += 2) {
        ctx.fillRect(px(0, 0).x - 4, px(0, j).y, 4, 1);
      }
      ctx.restore();

      drawVignette();
    }

    /* -------------------------------------------------------- 交互辅助 */
    function pickUnit(x, y) {
      var best = null, bd = 1.2;
      game.state.units.forEach(function (u) {
        if (!u.alive) return;
        var d = Math.hypot(u.pos.x - x, u.pos.y - y);
        if (d < bd) { bd = d; best = u; }
      });
      return best;
    }

    function pickMarker(x, y) {
      var best = null, bd = 0.9;
      game.state.markers.forEach(function (m) {
        if (m.carriedBy) return;
        var d = Math.hypot(m.x - x, m.y - y);
        if (d < bd) { bd = d; best = m; }
      });
      return best;
    }

    return {
      view: view,
      resize: resize,
      pickUnitAt: function (cx, cy) { var q = inv(cx, cy); return pickUnit(q.x, q.y); },
      draw: draw,
      px: px,
      inv: inv,
      pickUnit: pickUnit,
      pickMarker: pickMarker,
      canvas: canvas,
      ctx: ctx
    };
  }

  return { create: create };
})();
