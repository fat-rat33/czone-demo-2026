/* ==========================================================================
 * C 区 · 橙色 —— 3D 渲染层（three.js）
 * 与 2D 版保持同一套对外接口：
 *   view / resize / draw / px / inv / pickUnit / pickMarker
 * 坐标系：棋盘 x(0..60) → 世界 X，棋盘 y(0..44) → 世界 Z，1 单位 = 1 英寸。
 * ========================================================================== */
var RENDER3D = (function () {
  'use strict';

  var MODELS = {};          // key -> { scene, size, loaded }
  var MODEL_KEYS = [
    'shop_store', 'shop_clinic', 'shop_gas', 'shop_garage',
    'bus', 'car', 'barricade', 'sandbag', 'dumpster', 'rubble',
    'platform_a', 'platform_b', 'ruin_a', 'ruin_b', 'ruin_c', 'ruin_d',
    'police_officer', 'police_sheriff', 'police_shield', 'police_marksman',
    'rioter_thug', 'rioter_boss', 'rioter_gunner', 'rioter_looter'
  ];
  var readyCount = 0, readyCb = null;

  /* ------------------------------------------------------------- 资源加载 */
  function b64ToBuffer(dataUri) {
    var b64 = dataUri.substring(dataUri.indexOf(',') + 1);
    var bin = atob(b64);
    var len = bin.length;
    var buf = new ArrayBuffer(len);
    var view = new Uint8Array(buf);
    for (var i = 0; i < len; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }

  function loadModels(cb) {
    readyCb = cb;
    var base = 'assets/models/';
    var loader = new THREE.GLTFLoader();
    var data = window.MODEL_DATA || {};
    MODEL_KEYS.forEach(function (key) {
      var onLoad = function (gltf) {
        var root = gltf.scene;
        var box = new THREE.Box3().setFromObject(root);
        var size = new THREE.Vector3();
        box.getSize(size);
        MODELS[key] = { scene: root, size: size, min: box.min.clone(), max: box.max.clone(), loaded: true };
        readyCount++;
        if (readyCount === MODEL_KEYS.length && readyCb) readyCb();
      };
      var onErr = function (err) {
        console.warn('模型加载失败', key, err);
        readyCount++;
        if (readyCount === MODEL_KEYS.length && readyCb) readyCb();
      };
      if (data[key]) {
        try { loader.parse(b64ToBuffer(data[key]), '', onLoad, onErr); }
        catch (e) { onErr(e); }
      } else {
        loader.load(base + key + '.glb', onLoad, undefined, onErr);
      }
    });
  }

  /* ------------------------------------------------------------- 地面贴图 */
  function makeGroundTexture(W, H, map) {
    var PX = 18;
    var c = document.createElement('canvas');
    c.width = W * PX; c.height = H * PX;
    var g = c.getContext('2d');
    // 沥青
    var grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#17191d');
    grad.addColorStop(0.5, '#1e2126');
    grad.addColorStop(1, '#141619');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    // 噪点
    for (var i = 0; i < 26000; i++) {
      var x = Math.random() * c.width, y = Math.random() * c.height;
      g.fillStyle = 'rgba(' + (120 + Math.random() * 60 | 0) + ',' + (120 + Math.random() * 60 | 0) + ',' +
        (125 + Math.random() * 60 | 0) + ',' + (0.02 + Math.random() * 0.06).toFixed(3) + ')';
      g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // 街道几何：只有一条东西向主街（y 27–40，中线 33.5），两侧人行道
    var AVE_Y0 = 27, AVE_Y1 = 40, AVE_C = (AVE_Y0 + AVE_Y1) / 2;
    var WALK = 3;

    g.fillStyle = 'rgba(46,50,57,0.62)';
    g.fillRect(0, AVE_Y0 * PX, c.width, (AVE_Y1 - AVE_Y0) * PX);

    // 人行道
    g.fillStyle = 'rgba(180,190,205,0.055)';
    g.fillRect(0, (AVE_Y0 - WALK) * PX, c.width, WALK * PX);
    g.fillRect(0, AVE_Y1 * PX, c.width, WALK * PX);

    // 路缘石
    g.strokeStyle = 'rgba(200,210,225,0.10)';
    g.lineWidth = 3;
    [AVE_Y0, AVE_Y1].forEach(function (y) {
      g.beginPath(); g.moveTo(0, y * PX); g.lineTo(c.width, y * PX); g.stroke();
    });

    // 车道虚线
    g.strokeStyle = 'rgba(240,190,80,0.35)';
    g.lineWidth = 4;
    g.setLineDash([22, 20]);
    g.beginPath();
    g.moveTo(0, AVE_C * PX); g.lineTo(c.width, AVE_C * PX);
    g.stroke();
    g.setLineDash([]);

    // 裂纹
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2;
    for (var k = 0; k < 40; k++) {
      var sx = Math.random() * c.width, sy = Math.random() * c.height;
      g.beginPath(); g.moveTo(sx, sy);
      var cx = sx, cy = sy;
      for (var s = 0; s < 5; s++) {
        cx += (Math.random() - 0.5) * 60; cy += (Math.random() - 0.5) * 60;
        g.lineTo(cx, cy);
      }
      g.stroke();
    }
    // 水洼
    for (var w = 0; w < 8; w++) {
      var px = Math.random() * c.width, py = Math.random() * c.height;
      var rx = 20 + Math.random() * 50;
      var rg = g.createRadialGradient(px, py, 0, px, py, rx);
      rg.addColorStop(0, 'rgba(70,130,160,0.18)');
      rg.addColorStop(1, 'rgba(20,30,40,0)');
      g.fillStyle = rg;
      g.beginPath(); g.ellipse(px, py, rx, rx * 0.5, Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
    // 涂鸦
    (map.graffiti || []).forEach(function (gr) {
      g.save();
      g.translate(gr.x * PX, gr.y * PX);
      g.rotate(gr.rot || 0);
      g.font = '900 ' + (gr.size * PX * 0.62) + 'px "Microsoft YaHei", Impact, sans-serif';
      g.fillStyle = gr.color;
      g.globalAlpha = 0.5;
      g.fillText(gr.text, 0, 0);
      g.restore();
    });
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    return tex;
  }

  /* ---------------------------------------------------------------- 主类 */
  function create(canvas, game) {
    var W = game.state.map.boardW, H = game.state.map.boardH;
    var CB = { x: W / 2, z: H / 2 };

    // 触屏：禁止浏览器把手势当成页面滚动/缩放
    canvas.style.touchAction = 'none';
    canvas.style.webkitUserSelect = 'none';

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080a);
    scene.fog = new THREE.Fog(0x07080a, 150, 340);

    var camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
    camera.position.set(CB.x - 30, 78, H + 26);

    var controls = new THREE.OrbitControls(camera, canvas);
    // 单指旋转视角、双指缩放/平移
    if (THREE.TOUCH) {
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    controls.enablePan = true;
    controls.panSpeed = 0.9;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 1.1;
    controls.target.set(CB.x, 0, CB.z);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 20;
    controls.maxDistance = 240;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.screenSpacePanning = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    var camQ = /cam=(\w+)/.exec(location.search);
    if (camQ) {
      var c = camQ[1];
      if (c === 'top') { camera.up.set(0, 0, -1); camera.position.set(CB.x, 120, CB.z + 0.01); controls.target.set(CB.x, 0, CB.z); }
      else if (c === 'close') { camera.position.set(23, 7, 23); controls.target.set(23, 4, 11); }
      else if (c === 'units') { camera.position.set(27, 8, 32); controls.target.set(28, 1.2, 22); }
      else if (c === 'orders') { camera.position.set(34, 4.5, 42); controls.target.set(31, 1.0, 32); }
      else if (c === 'ruin') { camera.position.set(24, 15, 44); controls.target.set(26, 1.5, 21.5); }
      else if (c === 'north') { camera.position.set(30, 26, -16); controls.target.set(30, 3, 10); }
      else if (c === 'iso') { camera.position.set(2, 26, 62); controls.target.set(30, 0, 20); }
    }
    controls.update();

    /* 光照 */
    var hemi = new THREE.HemisphereLight(0x9db6d6, 0x3a3228, 1.05);
    scene.add(new THREE.AmbientLight(0x7c8798, 0.3));
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffcf9e, 1.0);
    sun.position.set(CB.x - 34, 78, H + 26);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -72; sun.shadow.camera.right = 72;
    sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0012;
    sun.target.position.set(CB.x, 0, CB.z);
    scene.add(sun); scene.add(sun.target);
    var fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    fill.position.set(CB.x + 30, 26, -20);
    fill.castShadow = false;
    scene.add(fill);

    // 街道暖光
    var lamp1 = new THREE.PointLight(0xffb066, 0.9, 34, 2);
    lamp1.position.set(20, 7, 22);
    scene.add(lamp1);
    var lamp2 = new THREE.PointLight(0xffb066, 0.9, 34, 2);
    lamp2.position.set(40, 7, 22);
    scene.add(lamp2);

    // 霓虹补光
    var rim = new THREE.PointLight(0xff7a3c, 1.6, 60, 2);
    rim.position.set(12, 9, 10);
    scene.add(rim);
    var rim2 = new THREE.PointLight(0x35e0ff, 0.85, 46, 2);
    rim2.position.set(48, 9, 34);
    scene.add(rim2);

    /* 地面 */
    var groundTex = makeGroundTexture(W, H, game.state.map);
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0.02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    scene.add(ground);

    // 棋盘边框
    var frame = new THREE.Mesh(
      new THREE.BoxGeometry(W + 1.2, 0.5, H + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 0.9 })
    );
    frame.position.set(W / 2, -0.26, H / 2);
    scene.add(frame);

    /* 组 */
    var terrainGroup = new THREE.Group(); scene.add(terrainGroup);
    var unitGroup = new THREE.Group(); scene.add(unitGroup);
    var markerGroup = new THREE.Group(); scene.add(markerGroup);
    var overlay = new THREE.Group(); scene.add(overlay);
    var built = false;

    /* 辅助 */
    function cloneModel(key) {
      var m = MODELS[key];
      if (!m) return null;
      var obj = m.scene.clone(true);
      obj.traverse(function (o) {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (m && m.color && !m.userData_brightened) {
            m.color.multiplyScalar(1.18);
            m.userData_brightened = true;
          }
          if (m && m.emissive) {
            var e = m.emissive;
            if (e.r + e.g + e.b > 0.5) {
              m.emissiveIntensity = 2.2;
              m.toneMapped = false;
            }
          }
        });
      });
      return obj;
    }

    // 每个模型的实体占地（宽, 深）；缩放按它算，模型才会和碰撞盒严丝合缝
    var BASE = {
      shop_store: [10, 8], shop_clinic: [10, 8], shop_gas: [10, 8], shop_garage: [10, 8],
      bus: [9, 3.2], car: [4.6, 2.4], barricade: [4, 0.9], sandbag: [3.16, 1.15],
      dumpster: [2.7, 1.9], rubble: [2.34, 2.25],
      platform_a: [5, 3], platform_b: [5.5, 3],
      ruin_a: [10, 8], ruin_b: [10, 8], ruin_c: [10, 8], ruin_d: [10, 8]
    };

    function terrainModelKey(t) {
      if (t.kind === 'building') {
        if (t.label.indexOf('便利店') >= 0) return 'shop_store';
        if (t.label.indexOf('诊所') >= 0) return 'shop_clinic';
        if (t.label.indexOf('加油站') >= 0) return 'shop_gas';
        if (t.label.indexOf('夜店') >= 0 || t.label.indexOf('电台') >= 0) return 'shop_garage';
        // 其余建筑按 id 稳定轮换四种外观
        var h = 0;
        for (var i = 0; i < t.id.length; i++) h = (h * 31 + t.id.charCodeAt(i)) % 997;
        return ['shop_store', 'shop_clinic', 'shop_gas', 'shop_garage'][h % 4];
      }
      if (t.kind === 'wreck') return t.label.indexOf('公交') >= 0 ? 'bus' : 'car';
      if (t.kind === 'platform') return t.label.indexOf('废料') >= 0 ? 'platform_b' : 'platform_a';
      if (t.kind === 'ruin') return 'ruin_' + (t.variant || 'a');
      if (t.kind === 'barricade') return t.style === 'sandbag' ? 'sandbag' : 'barricade';
      if (t.kind === 'rubble') return t.style === 'dumpster' ? 'dumpster' : 'rubble';
      return 'rubble';
    }

    function unitModelKey(u) {
      return (u.side === 'police' ? 'police_' : 'rioter_') +
        ({ sheriff: 'sheriff', officer: 'officer', shieldman: 'shield', marksman: 'marksman', boss: 'boss' }[u.key] || u.key);
    }

    /* 构建场景对象（仅一次） */
    function build() {
      built = true;
      [terrainGroup, unitGroup, markerGroup].forEach(function (g) {
        while (g.children.length) g.remove(g.children[0]);
      });
      // 地形
      game.state.map.terrain.forEach(function (t) {
        if (t.render === false) return;   // 只用于碰撞的断墙
        var key = terrainModelKey(t);
        var obj = cloneModel(key);
        if (!obj) return;
        var m = MODELS[key];
        var base = BASE[key] || [m.size.x, m.size.z];
        var sx = t.w / base[0];
        var sz = t.h / base[1];
        obj.scale.set(sx, 1, sz);
        obj.position.set(t.x + t.w / 2, 0, t.y + t.h / 2);
        obj.userData.terrainId = t.id;
        // 车/公交朝向：长边沿 X
        terrainGroup.add(obj);
      });

      // 目标标识
      game.state.markers.forEach(function (mk) {
        var g = new THREE.Group();
        var R = mk.radius || 1;                       // 中央点 3 寸，其它 1 寸
        var isCenter = mk.kind === 'center';
        var col = isCenter ? 0xffd24a : 0x7fd4ff;

        var ring = new THREE.Mesh(
          new THREE.RingGeometry(R * 0.92, R, 48),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        g.add(ring);

        var glow = new THREE.Mesh(
          new THREE.CircleGeometry(R * 0.92, 32),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isCenter ? 0.1 : 0.14 })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.025;
        g.add(glow);
        var pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6),
          new THREE.MeshStandardMaterial({ color: 0x555b63, metalness: 0.6, roughness: 0.5 })
        );
        pole.position.y = 1.2;
        g.add(pole);
        var flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.55, 0.35),
          new THREE.MeshStandardMaterial({ color: isCenter ? 0xffd24a : 0x7fd4ff, emissive: isCenter ? 0xff8a20 : 0x2a86ff, emissiveIntensity: 1.4, side: THREE.DoubleSide })
        );
        flag.position.set(0.3, 2.2, 0);
        g.add(flag);
        g.position.set(mk.x, 0, mk.y);
        g.userData.markerId = mk.id;
        markerGroup.add(g);
      });

      sync();
    }

    var badgeCache = {};
    function badgeTexture(side) {
      if (badgeCache[side]) return badgeCache[side];
      var c = document.createElement('canvas');
      c.width = c.height = 128;
      var g = c.getContext('2d');
      g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
      g.fillStyle = side === 'police' ? 'rgba(74,163,255,0.95)' : 'rgba(255,122,60,0.95)';
      g.fill();
      g.lineWidth = 9; g.strokeStyle = 'rgba(12,14,18,0.9)'; g.stroke();
      g.fillStyle = '#0a0c0f';
      g.font = '900 62px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(side === 'police' ? 'P' : 'R', 64, 70);
      var tex = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      badgeCache[side] = tex;
      return tex;
    }

    // 命令指示：交战中 = 橙色准星，隐匿中 = 蓝色盾牌
    var orderCache = {};
    function orderTexture(kind) {
      if (orderCache[kind]) return orderCache[kind];
      var c = document.createElement('canvas');
      c.width = c.height = 128;
      var g = c.getContext('2d');
      g.clearRect(0, 0, 128, 128);
      if (kind === 'conceal') {
        // 盾牌
        g.beginPath();
        g.moveTo(64, 14);
        g.lineTo(108, 30);
        g.lineTo(108, 66);
        g.quadraticCurveTo(104, 104, 64, 118);
        g.quadraticCurveTo(24, 104, 20, 66);
        g.lineTo(20, 30);
        g.closePath();
        g.fillStyle = 'rgba(96,168,224,0.92)';
        g.fill();
        g.lineWidth = 7; g.strokeStyle = 'rgba(10,14,20,0.92)'; g.stroke();
        g.fillStyle = '#0a0f16';
        g.font = '900 46px "Microsoft YaHei", sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('隐', 64, 70);
      } else {
        // 准星
        g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2);
        g.lineWidth = 9; g.strokeStyle = 'rgba(255,140,40,0.95)'; g.stroke();
        g.strokeStyle = 'rgba(255,140,40,0.95)';
        g.lineWidth = 8;
        g.beginPath(); g.moveTo(64, 8); g.lineTo(64, 34); g.stroke();
        g.beginPath(); g.moveTo(64, 94); g.lineTo(64, 120); g.stroke();
        g.beginPath(); g.moveTo(8, 64); g.lineTo(34, 64); g.stroke();
        g.beginPath(); g.moveTo(94, 64); g.lineTo(120, 64); g.stroke();
        g.beginPath(); g.arc(64, 64, 8, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,140,40,1)'; g.fill();
      }
      var tex = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      orderCache[kind] = tex;
      return tex;
    }

    // 警戒状态图标（警 / 哨 / 掩）
    var guardCache = {};
    function guardTexture(kind) {
      if (guardCache[kind]) return guardCache[kind];
      var c = document.createElement('canvas');
      c.width = c.height = 128;
      var g = c.getContext('2d');
      var conf = {
        overwatch: { txt: '警', bg: 'rgba(255,196,60,0.95)', fg: '#1a1206' },
        sentry: { txt: '哨', bg: 'rgba(90,220,220,0.95)', fg: '#04191a' },
        cover: { txt: '掩', bg: 'rgba(120,230,140,0.95)', fg: '#04180a' }
      }[kind] || { txt: '?', bg: 'rgba(200,200,200,0.9)', fg: '#111' };
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.fillStyle = conf.bg;
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(10,12,16,0.9)';
      g.stroke();
      g.fillStyle = conf.fg;
      g.font = '900 62px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(conf.txt, 64, 68);
      var tex = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      guardCache[kind] = tex;
      return tex;
    }

    /* 单位对象池 */
    var unitObjs = {};
    function buildUnits() {
      game.state.units.forEach(function (u) {
        if (unitObjs[u.id]) return;
        var key = unitModelKey(u);
        var obj = cloneModel(key) || new THREE.Group();
        var holder = new THREE.Group();
        holder.add(obj);
        // 朝向：默认面向对方半场
        obj.position.y = 0.06;
        obj.scale.setScalar(1.18);

        // 底盘环
        var ringMat = new THREE.MeshBasicMaterial({
          color: u.side === 'police' ? 0x4aa3ff : 0xff7a3c,
          transparent: true, opacity: 0.95, side: THREE.DoubleSide
        });
        var ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        ring.name = 'ring';
        holder.add(ring);

        var sel = new THREE.Mesh(
          new THREE.RingGeometry(0.72, 0.82, 32),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
        );
        sel.rotation.x = -Math.PI / 2;
        sel.position.y = 0.13;
        sel.visible = false;
        sel.name = 'selection';
        holder.add(sel);

        var badge = new THREE.Sprite(new THREE.SpriteMaterial({
          map: badgeTexture(u.side), transparent: true, depthTest: true, depthWrite: false
        }));
        badge.scale.set(0.66, 0.66, 0.66);
        badge.position.y = 2.0;
        badge.name = 'badge';
        holder.add(badge);

        var orderIcon = new THREE.Sprite(new THREE.SpriteMaterial({
          map: orderTexture(u.order === 'conceal' ? 'conceal' : 'engage'),
          transparent: true, depthTest: true, depthWrite: false
        }));
        orderIcon.scale.set(0.56, 0.56, 0.56);
        orderIcon.position.set(0.58, 1.32, 0);
        orderIcon.name = 'orderIcon';
        holder.add(orderIcon);

        var guardIcon = new THREE.Sprite(new THREE.SpriteMaterial({
          map: guardTexture('overwatch'), transparent: true, depthTest: true, depthWrite: false
        }));
        guardIcon.scale.set(0.5, 0.5, 0.5);
        guardIcon.position.set(-0.58, 1.32, 0);
        guardIcon.name = 'guardIcon';
        guardIcon.visible = false;
        holder.add(guardIcon);

        holder.userData.unitId = u.id;
        unitGroup.add(holder);
        unitObjs[u.id] = holder;
      });
    }

    /* 每帧同步状态 */
    function sync() {
      // 单位
      game.state.units.forEach(function (u) {
        var holder = unitObjs[u.id];
        if (!holder) return;
        holder.visible = !!u.alive;
        holder.position.set(u.pos.x, u.elevation || 0, u.pos.y);
        // 朝向最近的敌人
        var target = null, best = 1e9;
        game.state.units.forEach(function (o) {
          if (!o.alive || o.side === u.side) return;
          var d = Math.hypot(o.pos.x - u.pos.x, o.pos.y - u.pos.y);
          if (d < best) { best = d; target = o; }
        });
        if (target) {
          var ang = Math.atan2(target.pos.x - u.pos.x, target.pos.y - u.pos.y);
          holder.rotation.y = ang;
        }
        var ring = holder.getObjectByName('ring');
        var sel = holder.getObjectByName('selection');
        if (ring) {
          ring.material.color.set(u.side === 'police' ? 0x4aa3ff : 0xff7a3c);
          ring.material.opacity = u.state === 'spent' ? 0.28 : 0.95;
        }
        if (sel) {
          sel.visible = (view.selectedId === u.id);
          var s = 1 + Math.sin(performance.now() / 320) * 0.04;
          sel.scale.set(s, 1, s);
        }
        var gi = holder.getObjectByName('guardIcon');
        if (gi) {
          if (!u.guard) {
            gi.visible = false;
          } else {
            gi.visible = true;
            if (gi.userData.kind !== u.guard) {
              gi.material.map = guardTexture(u.guard);
              gi.material.needsUpdate = true;
              gi.userData.kind = u.guard;
            }
            gi.material.opacity = 0.95;
          }
        }
        var oi = holder.getObjectByName('orderIcon');
        if (oi) {
          var kind = u.order === 'conceal' ? 'conceal' : 'engage';
          if (oi.userData.kind !== kind) {
            oi.material.map = orderTexture(kind);
            oi.material.needsUpdate = true;
            oi.userData.kind = kind;
          }
          oi.material.opacity = u.state === 'spent' ? 0.4 : 0.95;
        }
        var badge = holder.getObjectByName('badge');
        if (badge) {
          var bs = view.selectedId === u.id ? 0.86 : 0.66;
          badge.scale.set(bs, bs, bs);
          badge.material.opacity = u.state === 'spent' ? 0.45 : 0.95;
        }
        // 受创提示：轻微下压
        var body = holder.children[0];
        if (body) {
          var frac = u.wounds / u.maxWounds;
          body.rotation.z = frac < 0.35 ? 0.16 : 0;
          body.rotation.x = frac < 0.2 ? -0.12 : 0;
        }
      });

      // 标识
      markerGroup.children.forEach(function (g) {
        var mk = game.state.markers.filter(function (m) { return m.id === g.userData.markerId; })[0];
        if (!mk) return;
        g.visible = !mk.carriedBy;
        if (mk.carriedBy) return;
        var ctrl = null;
        try { ctrl = game.markerController ? game.markerController(mk) : null; } catch (e) { }
        var col = ctrl === 'police' ? 0x4aa3ff : ctrl === 'rioters' ? 0xff7a3c : 0xffbe3c;
        g.children.forEach(function (c) { if (c.material) c.material.color.set(col); });
      });

      // 覆盖层（预览线、控制范围、模型碰撞盒）
      while (overlay.children.length) {
        var c = overlay.children.pop();
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
      var active = game.unit(view.selectedId || game.state.activeId);
      if (active && active.alive) {
        var ring = new THREE.Mesh(
          new THREE.RingGeometry(0.96, 1.0, 40),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(active.pos.x, 0.02, active.pos.y);
        overlay.add(ring);

        if ((view.mode === 'move') && view.hoverPos) {
          var pts = [
            new THREE.Vector3(active.pos.x, 0.06, active.pos.y),
            new THREE.Vector3(view.hoverPos.x, 0.06, view.hoverPos.y)
          ];
          var geo = new THREE.BufferGeometry().setFromPoints(pts);
          var line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: view.previewValid ? 0x6effc0 : 0xff5050, transparent: true, opacity: 0.9
          }));
          overlay.add(line);
          var dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.55, 20),
            new THREE.MeshBasicMaterial({
              color: view.previewValid ? 0x6effc0 : 0xff5050, transparent: true, opacity: 0.35
            })
          );
          dot.rotation.x = -Math.PI / 2;
          dot.position.set(view.hoverPos.x, 0.05, view.hoverPos.y);
          overlay.add(dot);
        }
        if (view.mode === 'shoot' && view.hoverUnitId) {
          var t = game.unit(view.hoverUnitId);
          if (t) {
            var pts2 = [
              new THREE.Vector3(active.pos.x, 0.9, active.pos.y),
              new THREE.Vector3(t.pos.x, 0.9, t.pos.y)
            ];
            var line2 = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts2),
              new THREE.LineBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.9 })
            );
            overlay.add(line2);
          }
        }
      }
      if (view.showZones && game.state.phase === 'deploy') {
        Object.keys(game.state.map.dropZones).forEach(function (sid) {
          var z = game.state.map.dropZones[sid];
          var plane = new THREE.Mesh(
            new THREE.PlaneGeometry(z.w, z.h),
            new THREE.MeshBasicMaterial({
              color: sid === 'police' ? 0x4aa3ff : 0xff7a3c,
              transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false
            })
          );
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(z.x + z.w / 2, 0.015, z.y + z.h / 2);
          overlay.add(plane);
        });
      }
      if (view.ghost) {
        var gh = new THREE.Mesh(
          new THREE.CircleGeometry(0.6, 24),
          new THREE.MeshBasicMaterial({
            color: view.ghost.valid ? 0x6effc0 : 0xff5050, transparent: true, opacity: 0.45
          })
        );
        gh.rotation.x = -Math.PI / 2;
        gh.position.set(view.ghost.x, 0.05, view.ghost.y);
        overlay.add(gh);
      }
      if (view.debugBoxes) {
        game.state.map.terrain.forEach(function (t) {
          var mk = terrainModelKey(t);
          var mh = MODELS[mk] ? MODELS[mk].size.y : (t.height || 1);
          var hh = Math.min(mh || 1, t.height || mh || 1);
          var box = new THREE.Mesh(
            new THREE.BoxGeometry(t.w, hh, t.h),
            new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.4 })
          );
          box.position.set(t.x + t.w / 2, hh / 2, t.y + t.h / 2);
          overlay.add(box);
        });
      }
    }

    /* ------------------------------------------------------------- 交互 */
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();

    function groundPoint(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      return hit ? { x: hit.x, y: hit.z } : { x: 0, y: 0 };
    }

    function pickUnitAt(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(unitGroup.children, true);
      for (var i = 0; i < hits.length; i++) {
        var o = hits[i].object;
        while (o && !o.userData.unitId) o = o.parent;
        if (o && o.userData.unitId) return o.userData.unitId;
      }
      // 触屏兜底：按屏幕像素距离找最近的单位（手指比鼠标粗）
      var maxPx = ('ontouchstart' in window) ? 46 : 18;
      var best = null, bd = maxPx;
      var v = new THREE.Vector3();
      game.state.units.forEach(function (u) {
        if (!u.alive) return;
        v.set(u.pos.x, 1.0 + (u.elevation || 0), u.pos.y).project(camera);
        if (v.z > 1) return;
        var sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
        var sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
        var d = Math.hypot(sx - clientX, sy - clientY);
        if (d < bd) { bd = d; best = u.id; }
      });
      return best;
    }

    /* ------------------------------------------------------------- 尺寸 */
    function resize() {
      var rect = canvas.parentElement.getBoundingClientRect();
      var w = Math.max(320, rect.width), h = Math.max(240, rect.height);
      renderer.setSize(w, h, false);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    /* ------------------------------------------------------------- 循环 */
    var running = false;
    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    function startLoop() {
      if (running) return;
      running = true;
      animate();
    }

    /* ------------------------------------------------------------- 对外 */
    var view = {
      selectedId: null,
      hoverUnitId: null,
      mode: 'idle',
      hoverPos: null,
      previewValid: true,
      ghost: null,
      showZones: false,
      debugBoxes: false,
      previewPath: null,
      previewCost: 0,
      targetId: null,
      showGrid: false,
      flash: []
    };

    function initWhenReady() {
      if (readyCount >= MODEL_KEYS.length) {
        build();
        buildUnits();
        sync();
        startLoop();
      } else {
        // 模型没到齐：先用占位方块顶上
        placeholder();
        setTimeout(initWhenReady, 120);
      }
    }

    function placeholder() {
      game.state.map.terrain.forEach(function (t) {
        var mesh = new THREE.Mesh(
          new THREE.BoxGeometry(t.w, Math.max(t.height || 1, 1), t.h),
          new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 })
        );
        mesh.position.set(t.x + t.w / 2, Math.max(t.height || 1, 1) / 2, t.y + t.h / 2);
        terrainGroup.add(mesh);
      });
      game.state.units.forEach(function (u) {
        var mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12),
          new THREE.MeshStandardMaterial({ color: u.side === 'police' ? 0x4aa3ff : 0xff7a3c })
        );
        mesh.position.set(u.pos.x, 0.2, u.pos.y);
        unitGroup.add(mesh);
      });
      startLoop();
    }

    resize();
    initWhenReady();

    return {
      view: view,
      focusAt: function (x, y) {
        // 照抄 cam=units 预设，再整体平移到目标区（俯角与距离天然一致）
        var dx = x - 28, dz = y - 22;
        controls.target.set(28 + dx, 1.2, 22 + dz);
        camera.position.set(27 + dx, 8, 32 + dz);
        controls.update();
      },
      resize: resize,
      draw: function () { if (built) sync(); },
      inv: function (clientX, clientY) { return groundPoint(clientX, clientY); },
      px: function (x, y) { return { x: x, y: y }; },
      pickUnitAt: function (cx, cy) { return pickUnitAt(cx, cy); },
      pickUnit: function (x, y) {
        var best = null, bd = 1.1;
        game.state.units.forEach(function (u) {
          if (!u.alive) return;
          var d = Math.hypot(u.pos.x - x, u.pos.y - y);
          if (d < bd) { bd = d; best = u; }
        });
        return best;
      },
      pickMarker: function (x, y) {
        var best = null, bd = 1.0;
        game.state.markers.forEach(function (m) {
          if (m.carriedBy) return;
          var d = Math.hypot(m.x - x, m.y - y);
          if (d < bd) { bd = d; best = m; }
        });
        return best;
      },
      scene: scene,
      camera: camera,
      renderer: renderer,
      controls: controls
    };
  }

  return { create: create, loadModels: loadModels, models: MODELS };
})();
