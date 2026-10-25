/* ==========================================================================
 * C 区 · 橙色 —— 数据层
 * 全部数值单位：英寸 / 点。棋盘 60"×44"（原型 30"×22" 的 4 倍面积）。
 * 规则基准：本项目战术小队规则文档（见 docs/规则摘要.md）
 * ========================================================================== */
var DATA = (function () {
  'use strict';

  var CONFIG = {
    BOARD_W: 90,
    BOARD_H: 66,
    TURNING_POINTS: 4,
    PACE: 1,            // 战场节奏：1 = 原规则；1.5 = Demo 可选加速（移动/射程同乘）
    PX_PER_INCH: 15,          // 画布逻辑像素/英寸
    BASE_RADIUS: 0.55,        // 特工底座半径（约 28mm）
    CONTROL_RANGE: 1,         // 控制范围
    COVER_RANGE: 1,           // 掩护：阻碍地形需在目标 1" 内
    NO_COVER_FROM: 2,         // 目标在射手 2" 内不给掩护
    OBSCURED_CLEAR: 1,        // 阻碍地形在任一方 1" 内 → 不遮挡
    VANTAGE_PRECISION_1: 2,   // 高差 ≥2" → 精准 1
    VANTAGE_PRECISION_2: 4,   // 高差 ≥4" → 精准 2
    REACTION_MOVE: 2,         // 反应移动上限
    ROOF_H: 7.5,               // 屋顶高度（上楼后站这里）
    WINDOW_REACH: 2,           // 距窗/门 2 寸内可翻越或进出
    MOVE_PER_ACTIVATION: 2,   // 规则适配：转移每激活可用 2 次
    DASH_DISTANCE: 6,         // 冲刺
    CHARGE_BONUS: 5,          // 冲锋额外移动
    DEFENSE_DICE: 3,          // 防御骰
    CLIMB_MIN: 2,             // 攀爬最低消耗
    JUMP_DISTANCE: 4,         // 跳跃水平距离
    FALL_FREE: 2,             // 跳落免费垂直距离
    VP_CAP_PER_OP: 6,         // 每路 op 封顶 6VP
    OBJECTIVE_RADIUS: 0.8,    // 目标标识半径（40mm ≈ 0.79"）
    MARKER_RADIUS: 0.4        // 普通标识半径（20mm）
  };

  /* ------------------------------------------------------------------ 武器 */
  // rules 里用短标签，引擎逐条实装（见 RULES_IMPL）
  var WEAPONS = {
    // ---- 武装警察 ----
    police_carbine: {
      id: 'police_carbine', name: '警用卡宾枪', type: 'ranged', pool: 'police',
      attacks: 5, hit: 3, dmg: 3, crit: 4, range: 15,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    police_rifle: {
      id: 'police_rifle', name: '警用战斗步枪', type: 'ranged', pool: 'police',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 20,
      rules: ['piercing1'],
      desc: '',
      skill: '穿刺 1', skillDesc: ''
    },
    police_smg: {
      id: 'police_smg', name: '战术冲锋枪', type: 'ranged', pool: 'police',
      attacks: 5, hit: 3, dmg: 2, crit: 3, range: 12,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    baton: {
      id: 'baton', name: '防暴警棍', type: 'melee', pool: 'police',
      attacks: 3, hit: 3, dmg: 3, crit: 4, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    riot_shield: {
      id: 'riot_shield', name: '防暴盾', type: 'shield', pool: 'police',
      attacks: 0, hit: 0, dmg: 0, crit: 0, range: 0,
      rules: ['shield'],
      desc: '',
      skill: '盾墙', skillDesc: ''
    },

    // ---- 暴匪 ----
    junk_pistol: {
      id: 'junk_pistol', name: '拼装手枪', type: 'ranged', pool: 'rioter',
      attacks: 3, hit: 4, dmg: 2, crit: 3, range: 12,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    junk_rifle: {
      id: 'junk_rifle', name: '拼装步枪', type: 'ranged', pool: 'rioter',
      attacks: 4, hit: 4, dmg: 3, crit: 4, range: 18,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    machete: {
      id: 'machete', name: '开山刀', type: 'melee', pool: 'rioter',
      attacks: 4, hit: 4, dmg: 3, crit: 4, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    sawn_shotgun: {
      id: 'sawn_shotgun', name: '锯短霰弹枪', type: 'ranged', pool: 'rioter-armory',
      attacks: 4, hit: 3, dmg: 3, crit: 4, range: 8,
      rules: ['rending'],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    assault_rifle: {
      id: 'assault_rifle', name: '改装突击步枪', type: 'ranged', pool: 'rioter-armory',
      attacks: 4, hit: 4, dmg: 3, crit: 4, range: 18,
      rules: ['lethal5'],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    light_mg: {
      id: 'light_mg', name: '废土轻机枪', type: 'ranged', pool: 'rioter-armory',
      attacks: 5, hit: 4, dmg: 3, crit: 4, range: 24,
      rules: ['heavy', 'piercing1'],
      desc: '',
      skill: '重型', skillDesc: ''
    },
    chain_axe: {
      id: 'chain_axe', name: '链锯斧', type: 'melee', pool: 'rioter-armory',
      attacks: 4, hit: 3, dmg: 4, crit: 5, range: 0,
      rules: ['rending'],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    p_shotgun: {
      id: 'p_shotgun', name: '警用战术霰弹枪', type: 'ranged', pool: 'police',
      attacks: 4, hit: 3, dmg: 2, crit: 4, range: 10,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    p_taser: {
      id: 'p_taser', name: '电击枪', type: 'ranged', pool: 'police',
      attacks: 2, hit: 3, dmg: 1, crit: 3, range: 8,
      rules: ['stun'],
      desc: '',
      skill: '压制', skillDesc: ''
    },
    p_sidearm: {
      id: 'p_sidearm', name: '制服手枪', type: 'ranged', pool: 'police',
      attacks: 3, hit: 3, dmg: 2, crit: 4, range: 10,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    p_sniper: {
      id: 'p_sniper', name: '警用狙击枪', type: 'ranged', pool: 'police',
      attacks: 2, hit: 2, dmg: 4, crit: 5, range: 30,
      rules: ['piercing1', 'heavy'],
      desc: '',
      skill: '穿刺 1', skillDesc: '', unique: true, limit: 1,
    },
    p_ram: {
      id: 'p_ram', name: '破门锤', type: 'melee', pool: 'police',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 0,
      rules: ['stun'],
      desc: '',
      skill: '压制', skillDesc: ''
    },
    p_tear_gas: {
      id: 'p_tear_gas', name: '催泪弹发射器', type: 'ranged', pool: 'police',
      attacks: 3, hit: 3, dmg: 2, crit: 4, range: 14,
      rules: ['blast'],
      desc: '',
      skill: '爆破', skillDesc: '', unique: true, limit: 1,
    },
    p_long_baton: {
      id: 'p_long_baton', name: '防暴长棍', type: 'melee', pool: 'police',
      attacks: 3, hit: 3, dmg: 3, crit: 4, range: 0,
      rules: ['reach'],
      desc: '',
      skill: '长柄', skillDesc: ''
    },
    p_short_carbine: {
      id: 'p_short_carbine', name: '短管卡宾枪', type: 'ranged', pool: 'police',
      attacks: 3, hit: 3, dmg: 3, crit: 4, range: 12,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    c_custom_rifle: {
      id: 'c_custom_rifle', name: '指挥定制步枪', type: 'ranged', pool: 'police-leader',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 22,
      rules: ['piercing1', 'focused'],
      desc: '',
      skill: '穿刺 1', skillDesc: '', unique: true, limit: 1,
    },
    c_dual_smg: {
      id: 'c_dual_smg', name: '双持冲锋枪', type: 'ranged', pool: 'police-leader',
      attacks: 6, hit: 4, dmg: 2, crit: 3, range: 10,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    c_shock_lance: {
      id: 'c_shock_lance', name: '电击长枪', type: 'melee', pool: 'police-leader',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 0,
      rules: ['stun', 'reach'],
      desc: '',
      skill: '压制', skillDesc: ''
    },
    c_command_blade: {
      id: 'c_command_blade', name: '指挥佩刀', type: 'melee', pool: 'police-leader',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    c_phase_pistol: {
      id: 'c_phase_pistol', name: '相位手枪', type: 'ranged', pool: 'police-leader',
      attacks: 3, hit: 3, dmg: 4, crit: 5, range: 12,
      rules: ['piercing2'],
      desc: '',
      skill: '穿刺 2', skillDesc: ''
    },
    c_breach_shotgun: {
      id: 'c_breach_shotgun', name: '破阵霰弹枪', type: 'ranged', pool: 'police-leader',
      attacks: 5, hit: 3, dmg: 2, crit: 4, range: 9,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    r_home_shotgun: {
      id: 'r_home_shotgun', name: '自制霰弹枪', type: 'ranged', pool: 'rioter',
      attacks: 3, hit: 4, dmg: 2, crit: 4, range: 8,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    r_pipe: {
      id: 'r_pipe', name: '钢管', type: 'melee', pool: 'rioter',
      attacks: 3, hit: 4, dmg: 2, crit: 4, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    r_molotov: {
      id: 'r_molotov', name: '燃烧瓶', type: 'ranged', pool: 'rioter',
      attacks: 2, hit: 4, dmg: 3, crit: 5, range: 6,
      rules: ['blast'],
      desc: '',
      skill: '爆破', skillDesc: ''
    },
    r_crowbar: {
      id: 'r_crowbar', name: '撬棍', type: 'melee', pool: 'rioter',
      attacks: 3, hit: 4, dmg: 3, crit: 4, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    r_double_barrel: {
      id: 'r_double_barrel', name: '双管猎枪', type: 'ranged', pool: 'rioter',
      attacks: 2, hit: 4, dmg: 4, crit: 5, range: 12,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    r_crossbow: {
      id: 'r_crossbow', name: '自制弩', type: 'ranged', pool: 'rioter',
      attacks: 2, hit: 4, dmg: 3, crit: 5, range: 18,
      rules: ['silent'],
      desc: '',
      skill: '静音', skillDesc: ''
    },
    r_spiked_bat: {
      id: 'r_spiked_bat', name: '钉刺球棒', type: 'melee', pool: 'rioter',
      attacks: 4, hit: 4, dmg: 2, crit: 4, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    r_modified_pistol: {
      id: 'r_modified_pistol', name: '改装手枪', type: 'ranged', pool: 'rioter',
      attacks: 3, hit: 4, dmg: 2, crit: 4, range: 11,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    a_heavy_mg: {
      id: 'a_heavy_mg', name: '重型机枪', type: 'ranged', pool: 'rioter-armory',
      attacks: 6, hit: 4, dmg: 2, crit: 3, range: 20,
      rules: ['heavy', 'ceaseless'],
      desc: '',
      skill: '重型', skillDesc: '', unique: true, limit: 1,
    },
    a_grenade_launcher: {
      id: 'a_grenade_launcher', name: '榴弹发射器', type: 'ranged', pool: 'rioter-armory',
      attacks: 2, hit: 4, dmg: 4, crit: 5, range: 16,
      rules: ['blast', 'piercing1'],
      desc: '',
      skill: '爆破', skillDesc: '', unique: true, limit: 1,
    },
    a_flamer: {
      id: 'a_flamer', name: '火焰喷射器', type: 'ranged', pool: 'rioter-armory',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 7,
      rules: ['blast'],
      desc: '',
      skill: '爆破', skillDesc: ''
    },
    a_ap_rifle: {
      id: 'a_ap_rifle', name: '穿甲步枪', type: 'ranged', pool: 'rioter-armory',
      attacks: 3, hit: 3, dmg: 4, crit: 5, range: 20,
      rules: ['piercing2'],
      desc: '',
      skill: '穿刺 2', skillDesc: ''
    },
    a_tower_shield: {
      id: 'a_tower_shield', name: '拼装塔盾', type: 'shield', pool: 'rioter-armory',
      attacks: 0, hit: 0, dmg: 0, crit: 0, range: 0,
      rules: ['shield'],
      desc: '',
      skill: '盾墙', skillDesc: ''
    },
    a_stim: {
      id: 'a_stim', name: '战前注射', type: 'gear', pool: 'rioter-armory',
      attacks: 0, hit: 0, dmg: 0, crit: 0, range: 0,
      rules: ['stim'],
      desc: '',
      skill: '战前注射', skillDesc: ''
    },
    a_ap_pistol: {
      id: 'a_ap_pistol', name: '高爆手枪', type: 'ranged', pool: 'rioter-armory',
      attacks: 3, hit: 3, dmg: 4, crit: 5, range: 9,
      rules: ['piercing1'],
      desc: '',
      skill: '穿刺 1', skillDesc: ''
    },
    a_chainsword: {
      id: 'a_chainsword', name: '链锯剑', type: 'melee', pool: 'rioter-armory',
      attacks: 5, hit: 3, dmg: 3, crit: 5, range: 0,
      rules: [],
      desc: '',
      skill: '基础', skillDesc: ''
    },
    b_warhammer: {
      id: 'b_warhammer', name: '煽动者战锤', type: 'melee', pool: 'rioter-leader',
      attacks: 4, hit: 3, dmg: 4, crit: 5, range: 0,
      rules: ['stun'],
      desc: '',
      skill: '压制', skillDesc: '', unique: true, limit: 1,
    },
    b_dual_machete: {
      id: 'b_dual_machete', name: '双持开山刀', type: 'melee', pool: 'rioter-leader',
      attacks: 5, hit: 3, dmg: 2, crit: 4, range: 0,
      rules: ['ceaseless'],
      desc: '',
      skill: '无休', skillDesc: ''
    },
    b_custom_rifle: {
      id: 'b_custom_rifle', name: '煽动者定制枪', type: 'ranged', pool: 'rioter-leader',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 20,
      rules: ['piercing1'],
      desc: '',
      skill: '穿刺 1', skillDesc: ''
    },
    b_gas_canister: {
      id: 'b_gas_canister', name: '毒气罐', type: 'ranged', pool: 'rioter-leader',
      attacks: 3, hit: 4, dmg: 3, crit: 5, range: 8,
      rules: ['blast'],
      desc: '',
      skill: '爆破', skillDesc: ''
    },
    b_flame_axe: {
      id: 'b_flame_axe', name: '烈焰斧', type: 'melee', pool: 'rioter-leader',
      attacks: 4, hit: 3, dmg: 3, crit: 5, range: 0,
      rules: ['blast'],
      desc: '',
      skill: '爆破', skillDesc: ''
    },
    b_executioner: {
      id: 'b_executioner', name: '处刑者', type: 'melee', pool: 'rioter-leader',
      attacks: 3, hit: 2, dmg: 5, crit: 6, range: 0,
      rules: ['piercing2'],
      desc: '',
      skill: '穿刺 2', skillDesc: ''
    },
  };

  // 引擎实装的武器规则（其余仅作战术风味描述）
  var RULES_IMPL = {
    ceaseless: '攻击骰中的 1 可以重掷一次',
    balanced: '攻击骰可以重掷一枚',
    piercing1: '防御方少掷 1 枚防御骰',
    piercing2: '防御方少掷 2 枚防御骰',
    lethal5: '攻击骰 5+ 即为关键成功',
    heavy: '本激活移动过则命中 -1',
    silent: '仅隐匿命令可用',
    focused: '防御方不能使用掩护豁免',
    rending: '攻击骰 6 造成暴击伤害',
    devastating1: '关键成功额外 +1 伤害',
    shield: '豁免 +1（最差 2+）'
  };

  /* ---------------------------------------------------------------- 阵营 */
  var POLICE = {
    id: 'police',
    name: '武装警察',
    short: 'PD',
    color: '#4aa3ff',
    accent: '#1b4f8a',
    desc: '',
    units: [
      {
        key: 'sheriff', name: '警长', role: '指挥', apl: 4, move: 9,
        save: 4, wounds: 12, weapons: ['police_rifle', 'baton'],
        abilities: ['指挥：本转折点一次，可让 6" 内一名己方警员免费获得 1AP（本激活内使用）'],
        keywords: ['武装警察', '指挥']
      },
      { key: 'officer', name: '警员', role: '步枪手', apl: 4, move: 9, save: 4, wounds: 12, weapons: ['police_carbine', 'baton'], count: 12, keywords: ['武装警察'] },
    ],
    // 固定编成：1 + 6 + 2 + 2 = 11
    trade: null
  };

  var RIOTERS = {
    id: 'rioters',
    name: '暴匪',
    short: 'RIOT',
    color: '#ff7a3c',
    accent: '#8a2f10',
    desc: '',
    units: [
      {
        key: 'boss', name: '煽动者', role: '领导者', apl: 4, move: 9,
        save: 5, wounds: 12, weapons: ['assault_rifle', 'chain_axe'],
        abilities: ['呼喝：本转折点一次，令 8" 内一名己方暴匪重掷一枚失败的攻击骰'],
        keywords: ['暴匪', '领导者']
      },
      { key: 'thug', name: '暴徒', role: '打手', apl: 4, move: 9, save: 4, wounds: 11, weapons: ['junk_rifle', 'machete'], count: 17, keywords: ['暴匪'] },
    ],
    // 1 + 9 + 2 + 3 = 15；最多 4 次「减员换装」
    trade: {
      maxSwaps: 4,
      options: [
        {
          id: 'rifle', name: '换装：改装突击步枪',
          desc: '',
          apply: { replaceWeapon: ['junk_pistol', 'assault_rifle'] }
        },
        {
          id: 'shotgun', name: '换装：锯短霰弹枪',
          desc: '',
          apply: { replaceWeapon: ['junk_pistol', 'sawn_shotgun'] }
        },
        {
          id: 'mg', name: '换装：废土轻机枪',
          desc: '',
          apply: { replaceWeapon: ['junk_pistol', 'light_mg'] }
        },
        {
          id: 'vest', name: '换装：防弹背心',
          desc: '',
          apply: { saveBonus: -1 }
        }
      ]
    }
  };

  /* -------------------------------------------------------------- 地图 C 区 */
  /*
   * 地形块字段：
   *   x,y,w,h  英寸，左上角原点
   *   kind: wall | building | wreck | rubble | barricade | platform | lamp
   *   cover: 'heavy' | 'light' | 'none'   —— 提供掩护/遮挡的类型
   *   solid: 是否阻断移动
   *   los: 是否可能阻挡视线（判定时还要看是否在 1" 内）
   *   height: 英寸（判定高差）
   *   style: 渲染用的材质
   */

  /* ---------------------------------------------------------------- 装备库
   * throwable: 投掷物（每人 ≤3，全队 ≤ 队内人数）
   * gear: 常驻装备（通讯/医疗/侦察/无人机/护具/工具）
   */
  var EQUIP = {
    /* ---------------- 投掷物（12 种） ---------------- */
    frag_grenade:  { id: 'frag_grenade', name: '破片手雷', cat: 'throwable', side: 'both', power: 3, desc: '', eff: { blast: 1, dmg: 2 } },
    smoke_grenade: { id: 'smoke_grenade', name: '烟雾弹', cat: 'throwable', side: 'both', power: 1, desc: '', eff: { smoke: 3 } },
    flashbang:     { id: 'flashbang', name: '震撼弹', cat: 'throwable', side: 'police', power: 3, desc: '', eff: { stun: 1 } },
    tear_gas:      { id: 'tear_gas', name: '催泪弹', cat: 'throwable', side: 'police', power: 3, desc: '', eff: { suppress: 2 } },
    emp_grenade:   { id: 'emp_grenade', name: '电磁脉冲弹', cat: 'throwable', side: 'police', power: 2, desc: '', eff: { emp: 2 } },
    incendiary:    { id: 'incendiary', name: '燃烧弹', cat: 'throwable', side: 'rioters', power: 2, desc: '', eff: { fire: 2 } },
    molotov:       { id: 'molotov', name: '燃烧瓶', cat: 'throwable', side: 'rioters', power: 2, desc: '', eff: { fire: 1 } },
    pipe_bomb:     { id: 'pipe_bomb', name: '土制炸弹', cat: 'throwable', side: 'rioters', power: 2, desc: '', eff: { blast: 1, dmg: 2, risky: true } },
    nail_bomb:     { id: 'nail_bomb', name: '钉子弹', cat: 'throwable', side: 'rioters', power: 2, desc: '', eff: { pierce: 1 } },
    stun_grenade:  { id: 'stun_grenade', name: '眩晕弹', cat: 'throwable', side: 'both', power: 2, desc: '', eff: { apDrain: 1 } },
    tracer:        { id: 'tracer', name: '标记弹', cat: 'throwable', side: 'police', power: 1, desc: '', eff: { mark: 1 } },
    snare_net:     { id: 'snare_net', name: '捕捉网', cat: 'throwable', side: 'police', power: 2, desc: '', eff: { snare: 1 } },

    /* ---------------- 常驻装备（12 种） ---------------- */
    radio:         { id: 'radio', name: '战术电台', cat: 'comms', side: 'both', power: 2, desc: '', eff: { extraAP: 1 } },
    jammer:        { id: 'jammer', name: '信号干扰器', cat: 'comms', side: 'police', power: 3, desc: '', eff: { jam: 1 } },
    scanner:       { id: 'scanner', name: '热成像扫描仪', cat: 'recon', side: 'both', power: 2, desc: '', eff: { reveal: 1 } },
    binoculars:    { id: 'binoculars', name: '测距仪', cat: 'recon', side: 'police', power: 2, desc: '', eff: { range: 3, precision: 1 } },
    drone_scout:   { id: 'drone_scout', name: '侦察无人机', cat: 'drone', side: 'police', power: 3, desc: '', eff: { scout: 12 } },
    drone_shield:  { id: 'drone_shield', name: '护盾无人机', cat: 'drone', side: 'police', power: 3, desc: '', eff: { shieldDrone: 1 } },
    drone_attack:  { id: 'drone_attack', name: '攻击无人机', cat: 'drone', side: 'police', power: 3, desc: '', eff: { droneShot: 2 } },
    medkit:        { id: 'medkit', name: '急救包', cat: 'medical', side: 'both', power: 2, desc: '', eff: { heal: 2 } },
    stim_pack:     { id: 'stim_pack', name: '兴奋剂包', cat: 'medical', side: 'rioters', power: 1, desc: '', eff: { stim: 1 } },
    armor_plate:   { id: 'armor_plate', name: '防弹插板', cat: 'armor', side: 'both', power: 2, desc: '', eff: { save: 1 } },
    camo_cloak:    { id: 'camo_cloak', name: '光学迷彩', cat: 'armor', side: 'police', power: 3, desc: '', eff: { camo: 1 } },
    armband:       { id: 'armband', name: '袖章', cat: 'armor', side: 'rioters', power: 3, limit: 3, desc: '', eff: { lastStand: 1 } },
    toolkit:       { id: 'toolkit', name: '工程工具', cat: 'tool', side: 'both', power: 1, desc: '', eff: { freeDoor: 2 } }
  };


  /** 自动配装：按阵营给一套合理装备（每人 ≤3 投掷物，全队 ≤ 人数） */
  function autoEquip(side, teamSize) {
    var out = {};
    var isPol = side === 'police';
    var base = isPol ? 'officer' : 'thug';
    var lead = isPol ? 'sheriff' : 'boss';
    // 每人最多 1 件常驻装备 + 投掷物
    out[lead + '#0'] = isPol ? ['binoculars', 'frag_grenade'] : ['stim_pack', 'pipe_bomb'];
    var gearCycle = isPol
      ? ['medkit', 'radio', 'toolkit', 'drone_attack', 'scanner', 'drone_shield', 'camo_cloak', 'drone_scout']
      : ['medkit', 'armor_plate'];
    var n = teamSize - 1;
    for (var i = 0; i < n; i++) {
      var key = base + '#' + i;
      var list = [];
      if (isPol) {
        list.push(gearCycle[i % gearCycle.length]);
        if (i < 9) list.push('frag_grenade');
        else if (i === 9) list.push('flashbang');
        else list.push('tear_gas');
      } else {
        // 暴匪：前 3 人带袖章，其余轮换
        list.push(i < 3 ? 'armband' : gearCycle[i % gearCycle.length]);
        if (i % 4 === 0) list.push('molotov');
        else if (i % 4 === 1) list.push('nail_bomb');
      }
      out[key] = list;
    }
    return out;
  }

  /** 装备校验：每人投掷物 ≤3，全队投掷物总数 ≤ 队内人数 */
  function validateEquip(setup, teamSize) {
    var perUnit = {}, totalThrow = 0;
    Object.keys(setup || {}).forEach(function (uid) {
      var list = setup[uid] || [];
      perUnit[uid] = list.length;
    });
    var throwCount = 0;
    Object.keys(setup || {}).forEach(function (uid) {
      (setup[uid] || []).forEach(function (id) {
        var e = EQUIP[id];
        if (e && e.cat === 'throwable') throwCount++;
      });
    });
    var overPerUnit = [];
    var overGear = [];
    var overLimit = [];
    var limitCount = {};
    Object.keys(setup || {}).forEach(function (uid) {
      var list = setup[uid] || [];
      var n = list.filter(function (id) {
        var E = EQUIP[id]; return E && E.cat === 'throwable';
      }).length;
      var gear = list.filter(function (id) {
        var E = EQUIP[id]; return E && E.cat !== 'throwable';
      }).length;
      if (n > 3) overPerUnit.push(uid);
      if (gear > 1) overGear.push(uid);
      list.forEach(function (id) {
        var E = EQUIP[id];
        if (E && E.limit) limitCount[id] = (limitCount[id] || 0) + 1;
      });
    });
    Object.keys(limitCount).forEach(function (id) {
      if (limitCount[id] > (EQUIP[id].limit || 0)) overLimit.push(id);
    });
    return {
      ok: throwCount <= teamSize && overPerUnit.length === 0 && overGear.length === 0 && overLimit.length === 0,
      overLimit: overLimit,
      throwCount: throwCount,
      teamSize: teamSize,
      overPerUnit: overPerUnit,
      overGear: overGear,
      perUnit: perUnit
    };
  }

  var MAP = {
    id: 'c-zone',
    name: '',
    level: '',
    levelDesc: '',
    brief: '',
    boardW: CONFIG.BOARD_W,
    boardH: CONFIG.BOARD_H,

    // 部署区：东西两端各 18 英寸
    dropZones: {
      police: { x: 0, y: 2, w: 18, h: 62, label: '警方集结区' },
      rioters: { x: 72, y: 2, w: 18, h: 62, label: '暴匪集结区' }
    },

    // 6 个目标标识，中央十字路口是必争之地
    objectives: [
      { id: 'obj_center', x: 45.8, y: 35.9, label: '中央补给站', kind: 'center', radius: 3 }
    ],
    /* 一次性拾取目标：每局随机撒点，只奖励一次 */
    pickups: {
      count: 4,
      value: 2,
      minGap: 9,        // 拾取点之间至少隔这么远
      centerGap: 9,     // 离中央目标至少这么远
      labels: ['弹药箱', '医疗箱', '情报终端', '军械包', '数据盘', '补给桶', '电台', '工具箱']
    },
    /* 一次性拾取目标：每局随机撒点，只奖励一次 */
    pickups: {
      count: 6,
      value: 2,
      minGap: 7,        // 拾取点之间至少隔这么远
      centerGap: 9,     // 离中央目标至少这么远
      labels: ['弹药箱', '医疗箱', '情报终端', '军械包', '数据盘', '补给桶', '电台', '工具箱']
    },

    terrain: [
      // ================= 北侧（y 4–26）：西北街区 =================
            { id: 'b1', kind: 'building', style: 'shop', solid: false, x: 5, y: 5, w: 10, h: 8, cover: 'heavy', coverZone: true, los: false, height: 12, label: '24H 便利店' },
      { id: 'b1_s0', kind: 'wall', render: false, x: 5.24, y: 12.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_win0', kind: 'window', render: false, x: 6.475, y: 12.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '24H 便利店·窗' },
      { id: 'b1_s1', kind: 'wall', render: false, x: 7.875, y: 12.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_doorblock', kind: 'door', render: false, x: 9.35, y: 12.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '24H 便利店·门' },
      { id: 'b1_s2', kind: 'wall', render: false, x: 10.65, y: 12.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_win2', kind: 'window', render: false, x: 12.125, y: 12.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '24H 便利店·窗' },
      { id: 'b1_s9', kind: 'wall', render: false, x: 13.525, y: 12.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_w1', kind: 'wall', render: false, x: 5, y: 5.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_wwin', kind: 'window', render: false, x: 5, y: 8.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '24H 便利店·窗' },
      { id: 'b1_w2', kind: 'wall', render: false, x: 5, y: 9.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_e1', kind: 'wall', render: false, x: 14.76, y: 5.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_ewin', kind: 'window', render: false, x: 14.76, y: 8.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '24H 便利店·窗' },
      { id: 'b1_e2', kind: 'wall', render: false, x: 14.76, y: 9.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
      { id: 'b1_n', kind: 'wall', render: false, x: 5.24, y: 5, w: 9.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '24H 便利店·墙' },
            { id: 'b2', kind: 'building', style: 'shop', solid: false, x: 5, y: 16, w: 10, h: 8, cover: 'heavy', coverZone: true, los: false, height: 12, label: '义体诊所' },
      { id: 'b2_s0', kind: 'wall', render: false, x: 5.24, y: 23.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_win0', kind: 'window', render: false, x: 6.475, y: 23.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '义体诊所·窗' },
      { id: 'b2_s1', kind: 'wall', render: false, x: 7.875, y: 23.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_doorblock', kind: 'door', render: false, x: 9.35, y: 23.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '义体诊所·门' },
      { id: 'b2_s2', kind: 'wall', render: false, x: 10.65, y: 23.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_win2', kind: 'window', render: false, x: 12.125, y: 23.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '义体诊所·窗' },
      { id: 'b2_s9', kind: 'wall', render: false, x: 13.525, y: 23.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_w1', kind: 'wall', render: false, x: 5, y: 16.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_wwin', kind: 'window', render: false, x: 5, y: 19.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '义体诊所·窗' },
      { id: 'b2_w2', kind: 'wall', render: false, x: 5, y: 20.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_e1', kind: 'wall', render: false, x: 14.76, y: 16.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_ewin', kind: 'window', render: false, x: 14.76, y: 19.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '义体诊所·窗' },
      { id: 'b2_e2', kind: 'wall', render: false, x: 14.76, y: 20.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
      { id: 'b2_n', kind: 'wall', render: false, x: 5.24, y: 16, w: 9.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '义体诊所·墙' },
            { id: 'b3', kind: 'building', style: 'shop', solid: false, x: 19, y: 6, w: 11, h: 9, cover: 'heavy', coverZone: true, los: false, height: 13, label: '当铺' },
      { id: 'b3_s0', kind: 'wall', render: false, x: 19.24, y: 14.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_win0', kind: 'window', render: false, x: 20.655, y: 14.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '当铺·窗' },
      { id: 'b3_s1', kind: 'wall', render: false, x: 22.195, y: 14.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_doorblock', kind: 'door', render: false, x: 23.85, y: 14.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '当铺·门' },
      { id: 'b3_s2', kind: 'wall', render: false, x: 25.15, y: 14.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_win2', kind: 'window', render: false, x: 26.805, y: 14.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '当铺·窗' },
      { id: 'b3_s9', kind: 'wall', render: false, x: 28.345, y: 14.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_w1', kind: 'wall', render: false, x: 19, y: 6.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_wwin', kind: 'window', render: false, x: 19, y: 9.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '当铺·窗' },
      { id: 'b3_w2', kind: 'wall', render: false, x: 19, y: 11.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_e1', kind: 'wall', render: false, x: 29.76, y: 6.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_ewin', kind: 'window', render: false, x: 29.76, y: 9.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '当铺·窗' },
      { id: 'b3_e2', kind: 'wall', render: false, x: 29.76, y: 11.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b3_n', kind: 'wall', render: false, x: 19.24, y: 6, w: 10.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '当铺·墙' },
      { id: 'b4', kind: 'ruin', variant: 'a', solid: false, x: 22, y: 19, w: 9, h: 7, cover: 'heavy', coverZone: true, los: false, height: 5.2, label: '坍塌面馆' },
      { id: 'b4_n', kind: 'wall', render: false, x: 22.35, y: 19, w: 8.65, h: 0.35, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌面馆·断墙' },
      { id: 'b4_p', kind: 'wall', render: false, x: 24.7, y: 21.94, w: 2.52, h: 0.35, cover: 'heavy', solid: true, los: true, height: 3.2, label: '室内隔墙' },
      { id: 'b4_up', kind: 'platform', render: false, style: 'vantage', elevated: true, x: 22.5, y: 19.48, w: 3.06, h: 2.24, cover: 'light', solid: false, los: false, height: 3, label: '二楼残板' },
      { id: 'b4_w', kind: 'wall', render: false, x: 22, y: 19, w: 0.35, h: 7, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌面馆·断墙' },
      { id: 'b4_e', kind: 'wall', render: false, x: 30.65, y: 19.35, w: 0.35, h: 3.5, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌面馆·断墙' },

      // ================= 北侧（y 4–26）：东北街区 =================
            { id: 'b5', kind: 'building', style: 'shop', solid: false, x: 58, y: 5, w: 11, h: 9, cover: 'heavy', coverZone: true, los: false, height: 12, label: '加油站' },
      { id: 'b5_s0', kind: 'wall', render: false, x: 58.24, y: 13.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_win0', kind: 'window', render: false, x: 59.655, y: 13.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '加油站·窗' },
      { id: 'b5_s1', kind: 'wall', render: false, x: 61.195, y: 13.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_doorblock', kind: 'door', render: false, x: 62.85, y: 13.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '加油站·门' },
      { id: 'b5_s2', kind: 'wall', render: false, x: 64.15, y: 13.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_win2', kind: 'window', render: false, x: 65.805, y: 13.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '加油站·窗' },
      { id: 'b5_s9', kind: 'wall', render: false, x: 67.345, y: 13.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_w1', kind: 'wall', render: false, x: 58, y: 5.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_wwin', kind: 'window', render: false, x: 58, y: 8.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '加油站·窗' },
      { id: 'b5_w2', kind: 'wall', render: false, x: 58, y: 10.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_e1', kind: 'wall', render: false, x: 68.76, y: 5.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_ewin', kind: 'window', render: false, x: 68.76, y: 8.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '加油站·窗' },
      { id: 'b5_e2', kind: 'wall', render: false, x: 68.76, y: 10.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
      { id: 'b5_n', kind: 'wall', render: false, x: 58.24, y: 5, w: 10.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '加油站·墙' },
            { id: 'b6', kind: 'building', style: 'shop', solid: false, x: 73, y: 5, w: 10, h: 8, cover: 'heavy', coverZone: true, los: false, height: 12, label: '公寓' },
      { id: 'b6_s0', kind: 'wall', render: false, x: 73.24, y: 12.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_win0', kind: 'window', render: false, x: 74.475, y: 12.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '公寓·窗' },
      { id: 'b6_s1', kind: 'wall', render: false, x: 75.875, y: 12.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_doorblock', kind: 'door', render: false, x: 77.35, y: 12.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '公寓·门' },
      { id: 'b6_s2', kind: 'wall', render: false, x: 78.65, y: 12.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_win2', kind: 'window', render: false, x: 80.125, y: 12.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '公寓·窗' },
      { id: 'b6_s9', kind: 'wall', render: false, x: 81.525, y: 12.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_w1', kind: 'wall', render: false, x: 73, y: 5.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_wwin', kind: 'window', render: false, x: 73, y: 8.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '公寓·窗' },
      { id: 'b6_w2', kind: 'wall', render: false, x: 73, y: 9.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_e1', kind: 'wall', render: false, x: 82.76, y: 5.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_ewin', kind: 'window', render: false, x: 82.76, y: 8.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '公寓·窗' },
      { id: 'b6_e2', kind: 'wall', render: false, x: 82.76, y: 9.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b6_n', kind: 'wall', render: false, x: 73.24, y: 5, w: 9.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '公寓·墙' },
      { id: 'b7', kind: 'ruin', variant: 'b', solid: false, x: 58, y: 17, w: 10, h: 8, cover: 'heavy', coverZone: true, los: false, height: 5.2, label: '坍塌维修店' },
      { id: 'b7_n', kind: 'wall', render: false, x: 58.35, y: 17, w: 9.65, h: 0.35, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌维修店·断墙' },
      { id: 'b7_p', kind: 'wall', render: false, x: 61, y: 20.36, w: 2.8, h: 0.35, cover: 'heavy', solid: true, los: true, height: 3.2, label: '室内隔墙' },
      { id: 'b7_up', kind: 'platform', render: false, style: 'vantage', elevated: true, x: 64.05, y: 21.89, w: 3.4, h: 2.56, cover: 'light', solid: false, los: false, height: 3, label: '二楼残板' },
      { id: 'b7_w', kind: 'wall', render: false, x: 58, y: 17, w: 0.35, h: 8, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌维修店·断墙' },
      { id: 'b7_s', kind: 'wall', render: false, x: 58.35, y: 24.65, w: 5.65, h: 0.35, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌维修店·断墙' },
            { id: 'b8', kind: 'building', style: 'shop', solid: false, x: 72, y: 17, w: 11, h: 8, cover: 'heavy', coverZone: true, los: false, height: 13, label: '夜店“锈钉”' },
      { id: 'b8_s0', kind: 'wall', render: false, x: 72.24, y: 24.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_win0', kind: 'window', render: false, x: 73.655, y: 24.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '夜店“锈钉”·窗' },
      { id: 'b8_s1', kind: 'wall', render: false, x: 75.195, y: 24.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_doorblock', kind: 'door', render: false, x: 76.85, y: 24.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '夜店“锈钉”·门' },
      { id: 'b8_s2', kind: 'wall', render: false, x: 78.15, y: 24.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_win2', kind: 'window', render: false, x: 79.805, y: 24.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '夜店“锈钉”·窗' },
      { id: 'b8_s9', kind: 'wall', render: false, x: 81.345, y: 24.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_w1', kind: 'wall', render: false, x: 72, y: 17.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_wwin', kind: 'window', render: false, x: 72, y: 20.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '夜店“锈钉”·窗' },
      { id: 'b8_w2', kind: 'wall', render: false, x: 72, y: 21.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_e1', kind: 'wall', render: false, x: 82.76, y: 17.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_ewin', kind: 'window', render: false, x: 82.76, y: 20.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '夜店“锈钉”·窗' },
      { id: 'b8_e2', kind: 'wall', render: false, x: 82.76, y: 21.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },
      { id: 'b8_n', kind: 'wall', render: false, x: 72.24, y: 17, w: 10.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '夜店“锈钉”·墙' },

      // ================= 南侧（y 40–62）：西南街区 =================
            { id: 'b9', kind: 'building', style: 'shop', solid: false, x: 5, y: 44, w: 10, h: 9, cover: 'heavy', coverZone: true, los: false, height: 12, label: '汽车修理厂' },
      { id: 'b9_s0', kind: 'wall', render: false, x: 5.24, y: 52.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_win0', kind: 'window', render: false, x: 6.475, y: 52.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '汽车修理厂·窗' },
      { id: 'b9_s1', kind: 'wall', render: false, x: 7.875, y: 52.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_doorblock', kind: 'door', render: false, x: 9.35, y: 52.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '汽车修理厂·门' },
      { id: 'b9_s2', kind: 'wall', render: false, x: 10.65, y: 52.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_win2', kind: 'window', render: false, x: 12.125, y: 52.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '汽车修理厂·窗' },
      { id: 'b9_s9', kind: 'wall', render: false, x: 13.525, y: 52.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_w1', kind: 'wall', render: false, x: 5, y: 44.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_wwin', kind: 'window', render: false, x: 5, y: 47.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '汽车修理厂·窗' },
      { id: 'b9_w2', kind: 'wall', render: false, x: 5, y: 49.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_e1', kind: 'wall', render: false, x: 14.76, y: 44.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_ewin', kind: 'window', render: false, x: 14.76, y: 47.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '汽车修理厂·窗' },
      { id: 'b9_e2', kind: 'wall', render: false, x: 14.76, y: 49.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
      { id: 'b9_n', kind: 'wall', render: false, x: 5.24, y: 44, w: 9.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '汽车修理厂·墙' },
            { id: 'b10', kind: 'building', style: 'shop', solid: false, x: 5, y: 55, w: 10, h: 7, cover: 'heavy', coverZone: true, los: false, height: 11, label: '烧毁的仓库' },
      { id: 'b10_s0', kind: 'wall', render: false, x: 5.24, y: 61.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_win0', kind: 'window', render: false, x: 6.475, y: 61.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '烧毁的仓库·窗' },
      { id: 'b10_s1', kind: 'wall', render: false, x: 7.875, y: 61.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_doorblock', kind: 'door', render: false, x: 9.35, y: 61.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '烧毁的仓库·门' },
      { id: 'b10_s2', kind: 'wall', render: false, x: 10.65, y: 61.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_win2', kind: 'window', render: false, x: 12.125, y: 61.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '烧毁的仓库·窗' },
      { id: 'b10_s9', kind: 'wall', render: false, x: 13.525, y: 61.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_w1', kind: 'wall', render: false, x: 5, y: 55.24, w: 0.24, h: 2.53, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_wwin', kind: 'window', render: false, x: 5, y: 57.8, w: 0.24, h: 1.37, cover: 'light', solid: true, los: true, height: 2.5, label: '烧毁的仓库·窗' },
      { id: 'b10_w2', kind: 'wall', render: false, x: 5, y: 59.2, w: 0.24, h: 2.53, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_e1', kind: 'wall', render: false, x: 14.76, y: 55.24, w: 0.24, h: 2.53, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_ewin', kind: 'window', render: false, x: 14.76, y: 57.8, w: 0.24, h: 1.37, cover: 'light', solid: true, los: true, height: 2.5, label: '烧毁的仓库·窗' },
      { id: 'b10_e2', kind: 'wall', render: false, x: 14.76, y: 59.2, w: 0.24, h: 2.53, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
      { id: 'b10_n', kind: 'wall', render: false, x: 5.24, y: 55, w: 9.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '烧毁的仓库·墙' },
            { id: 'b11', kind: 'building', style: 'shop', solid: false, x: 19, y: 45, w: 11, h: 8, cover: 'heavy', coverZone: true, los: false, height: 12, label: '批发市场' },
      { id: 'b11_s0', kind: 'wall', render: false, x: 19.24, y: 52.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_win0', kind: 'window', render: false, x: 20.655, y: 52.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '批发市场·窗' },
      { id: 'b11_s1', kind: 'wall', render: false, x: 22.195, y: 52.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_doorblock', kind: 'door', render: false, x: 23.85, y: 52.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '批发市场·门' },
      { id: 'b11_s2', kind: 'wall', render: false, x: 25.15, y: 52.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_win2', kind: 'window', render: false, x: 26.805, y: 52.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '批发市场·窗' },
      { id: 'b11_s9', kind: 'wall', render: false, x: 28.345, y: 52.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_w1', kind: 'wall', render: false, x: 19, y: 45.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_wwin', kind: 'window', render: false, x: 19, y: 48.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '批发市场·窗' },
      { id: 'b11_w2', kind: 'wall', render: false, x: 19, y: 49.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_e1', kind: 'wall', render: false, x: 29.76, y: 45.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_ewin', kind: 'window', render: false, x: 29.76, y: 48.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '批发市场·窗' },
      { id: 'b11_e2', kind: 'wall', render: false, x: 29.76, y: 49.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b11_n', kind: 'wall', render: false, x: 19.24, y: 45, w: 10.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '批发市场·墙' },
      { id: 'b12', kind: 'ruin', variant: 'c', solid: false, x: 20, y: 55, w: 10, h: 7, cover: 'heavy', coverZone: true, los: false, height: 5.2, label: '坍塌锅炉房' },
      { id: 'b12_n', kind: 'wall', render: false, x: 20.35, y: 55, w: 9.65, h: 0.35, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌锅炉房·断墙' },
      { id: 'b12_p', kind: 'wall', render: false, x: 23, y: 57.94, w: 2.8, h: 0.35, cover: 'heavy', solid: true, los: true, height: 3.2, label: '室内隔墙' },
      { id: 'b12_up', kind: 'platform', render: false, style: 'vantage', elevated: true, x: 26.05, y: 55.48, w: 3.4, h: 2.24, cover: 'light', solid: false, los: false, height: 3, label: '二楼残板' },
      { id: 'b12_w', kind: 'wall', render: false, x: 20, y: 55, w: 0.35, h: 7, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌锅炉房·断墙' },
      { id: 'b12_e', kind: 'wall', render: false, x: 29.65, y: 55.35, w: 0.35, h: 3.5, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌锅炉房·断墙' },

      // ================= 南侧（y 40–62）：东南街区 =================
            { id: 'b13', kind: 'building', style: 'shop', solid: false, x: 58, y: 44, w: 11, h: 9, cover: 'heavy', coverZone: true, los: false, height: 12, label: '数据中心' },
      { id: 'b13_s0', kind: 'wall', render: false, x: 58.24, y: 52.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_win0', kind: 'window', render: false, x: 59.655, y: 52.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '数据中心·窗' },
      { id: 'b13_s1', kind: 'wall', render: false, x: 61.195, y: 52.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_doorblock', kind: 'door', render: false, x: 62.85, y: 52.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '数据中心·门' },
      { id: 'b13_s2', kind: 'wall', render: false, x: 64.15, y: 52.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_win2', kind: 'window', render: false, x: 65.805, y: 52.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '数据中心·窗' },
      { id: 'b13_s9', kind: 'wall', render: false, x: 67.345, y: 52.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_w1', kind: 'wall', render: false, x: 58, y: 44.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_wwin', kind: 'window', render: false, x: 58, y: 47.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '数据中心·窗' },
      { id: 'b13_w2', kind: 'wall', render: false, x: 58, y: 49.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_e1', kind: 'wall', render: false, x: 68.76, y: 44.24, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_ewin', kind: 'window', render: false, x: 68.76, y: 47.6, w: 0.24, h: 1.77, cover: 'light', solid: true, los: true, height: 2.5, label: '数据中心·窗' },
      { id: 'b13_e2', kind: 'wall', render: false, x: 68.76, y: 49.4, w: 0.24, h: 3.33, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
      { id: 'b13_n', kind: 'wall', render: false, x: 58.24, y: 44, w: 10.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '数据中心·墙' },
            { id: 'b14', kind: 'building', style: 'shop', solid: false, x: 73, y: 45, w: 10, h: 8, cover: 'heavy', coverZone: true, los: false, height: 12, label: '地下诊所' },
      { id: 'b14_s0', kind: 'wall', render: false, x: 73.24, y: 52.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_win0', kind: 'window', render: false, x: 74.475, y: 52.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '地下诊所·窗' },
      { id: 'b14_s1', kind: 'wall', render: false, x: 75.875, y: 52.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_doorblock', kind: 'door', render: false, x: 77.35, y: 52.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '地下诊所·门' },
      { id: 'b14_s2', kind: 'wall', render: false, x: 78.65, y: 52.76, w: 1.445, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_win2', kind: 'window', render: false, x: 80.125, y: 52.76, w: 1.37, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '地下诊所·窗' },
      { id: 'b14_s9', kind: 'wall', render: false, x: 81.525, y: 52.76, w: 1.205, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_w1', kind: 'wall', render: false, x: 73, y: 45.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_wwin', kind: 'window', render: false, x: 73, y: 48.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '地下诊所·窗' },
      { id: 'b14_w2', kind: 'wall', render: false, x: 73, y: 49.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_e1', kind: 'wall', render: false, x: 82.76, y: 45.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_ewin', kind: 'window', render: false, x: 82.76, y: 48.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '地下诊所·窗' },
      { id: 'b14_e2', kind: 'wall', render: false, x: 82.76, y: 49.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b14_n', kind: 'wall', render: false, x: 73.24, y: 45, w: 9.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '地下诊所·墙' },
      { id: 'b15', kind: 'ruin', variant: 'd', solid: false, x: 58, y: 55, w: 10, h: 8, cover: 'heavy', coverZone: true, los: false, height: 5.2, label: '坍塌废品站' },
      { id: 'b15_n', kind: 'wall', render: false, x: 58.35, y: 55, w: 9.65, h: 0.35, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌废品站·断墙' },
      { id: 'b15_p', kind: 'wall', render: false, x: 61, y: 58.36, w: 2.8, h: 0.35, cover: 'heavy', solid: true, los: true, height: 3.2, label: '室内隔墙' },
      { id: 'b15_up', kind: 'platform', render: false, style: 'vantage', elevated: true, x: 58.55, y: 59.89, w: 3.4, h: 2.56, cover: 'light', solid: false, los: false, height: 3, label: '二楼残板' },
      { id: 'b15_w', kind: 'wall', render: false, x: 58, y: 55, w: 0.35, h: 8, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌废品站·断墙' },
      { id: 'b15_s', kind: 'wall', render: false, x: 58.35, y: 62.65, w: 5.65, h: 0.35, cover: 'heavy', solid: true, los: true, height: 4.6, label: '坍塌废品站·断墙' },
            { id: 'b16', kind: 'building', style: 'shop', solid: false, x: 72, y: 55, w: 11, h: 8, cover: 'heavy', coverZone: true, los: false, height: 13, label: '“自由电台”' },
      { id: 'b16_s0', kind: 'wall', render: false, x: 72.24, y: 62.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_win0', kind: 'window', render: false, x: 73.655, y: 62.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '“自由电台”·窗' },
      { id: 'b16_s1', kind: 'wall', render: false, x: 75.195, y: 62.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_doorblock', kind: 'door', render: false, x: 76.85, y: 62.76, w: 1.27, h: 0.24, cover: 'none', solid: true, los: false, height: 3, label: '“自由电台”·门' },
      { id: 'b16_s2', kind: 'wall', render: false, x: 78.15, y: 62.76, w: 1.625, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_win2', kind: 'window', render: false, x: 79.805, y: 62.76, w: 1.51, h: 0.24, cover: 'light', solid: true, los: true, height: 2.5, label: '“自由电台”·窗' },
      { id: 'b16_s9', kind: 'wall', render: false, x: 81.345, y: 62.76, w: 1.385, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_w1', kind: 'wall', render: false, x: 72, y: 55.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_wwin', kind: 'window', render: false, x: 72, y: 58.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '“自由电台”·窗' },
      { id: 'b16_w2', kind: 'wall', render: false, x: 72, y: 59.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_e1', kind: 'wall', render: false, x: 82.76, y: 55.24, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_ewin', kind: 'window', render: false, x: 82.76, y: 58.2, w: 0.24, h: 1.57, cover: 'light', solid: true, los: true, height: 2.5, label: '“自由电台”·窗' },
      { id: 'b16_e2', kind: 'wall', render: false, x: 82.76, y: 59.8, w: 0.24, h: 2.93, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },
      { id: 'b16_n', kind: 'wall', render: false, x: 72.24, y: 55, w: 10.49, h: 0.24, cover: 'heavy', solid: true, los: true, height: 7.5, label: '“自由电台”·墙' },

      // ================= 主街残骸（y 27–40）=================
      { id: 'w1', kind: 'wreck', style: 'bus', x: 40, y: 31, w: 9, h: 3.2, cover: 'heavy', solid: true, los: true, height: 9, label: '侧翻的公交' },
      { id: 'w2', kind: 'wreck', style: 'car', x: 16, y: 30, w: 4.6, h: 2.4, cover: 'heavy', solid: true, los: true, height: 4, label: '翻覆的警车' },
      { id: 'w3', kind: 'wreck', style: 'car', x: 26, y: 36, w: 4.4, h: 2.2, cover: 'heavy', solid: true, los: true, height: 4, label: '烧毁的轿车' },
      { id: 'w4', kind: 'wreck', style: 'car', x: 56, y: 30, w: 4.4, h: 2.2, cover: 'heavy', solid: true, los: true, height: 4, label: '报废装甲车' },
      { id: 'w5', kind: 'wreck', style: 'car', x: 66, y: 36, w: 4.6, h: 2.4, cover: 'heavy', solid: true, los: true, height: 4, label: '翻倒的货车' },
      { id: 'w6', kind: 'wreck', style: 'car', x: 33, y: 40.5, w: 4.4, h: 2.2, cover: 'heavy', solid: true, los: true, height: 4, label: '烧毁的轿车' },

      // ================= 十字路口设施 =================
      { id: 'v1', kind: 'platform', style: 'vantage', x: 41, y: 35.5, w: 5, h: 3, cover: 'light', solid: false, los: false, height: 3, elevated: true, label: '集装箱顶' },
      { id: 'v2', kind: 'platform', style: 'vantage', x: 51, y: 27.5, w: 5.5, h: 3, cover: 'light', solid: false, los: false, height: 3, elevated: true, label: '废料堆顶' },
      { id: 'v3', kind: 'platform', style: 'vantage', x: 31, y: 6, w: 5, h: 3, cover: 'light', solid: false, los: false, height: 3, elevated: true, label: '脚手架' },

      // ================= 路障 / 掩体 =================
      { id: 'c1', kind: 'barricade', style: 'barricade', x: 28, y: 28.5, w: 4, h: 1, cover: 'heavy', solid: true, los: true, height: 3, label: '街垒' },
      { id: 'c2', kind: 'barricade', style: 'barricade', x: 57, y: 39, w: 4, h: 1, cover: 'heavy', solid: true, los: true, height: 3, label: '街垒' },
      { id: 'c3', kind: 'barricade', style: 'sandbag', x: 37, y: 24, w: 3.2, h: 1.2, cover: 'heavy', solid: true, los: true, height: 2.2, label: '沙袋' },
      { id: 'c4', kind: 'barricade', style: 'sandbag', x: 50, y: 41.5, w: 3.2, h: 1.2, cover: 'heavy', solid: true, los: true, height: 2.2, label: '沙袋' },
      { id: 'c5', kind: 'barricade', style: 'barricade', x: 36, y: 33, w: 1, h: 4, cover: 'heavy', solid: true, los: true, height: 3, label: '路障' },
      { id: 'c6', kind: 'barricade', style: 'barricade', x: 45, y: 38, w: 4, h: 1, cover: 'heavy', solid: true, los: true, height: 3, label: '路障' },

      // ================= 垃圾箱 / 瓦砾 =================
      { id: 'd1', kind: 'rubble', style: 'dumpster', x: 17, y: 26, w: 2.6, h: 1.8, cover: 'light', solid: true, los: true, height: 3, label: '垃圾箱' },
      { id: 'd2', kind: 'rubble', style: 'dumpster', x: 62, y: 26.5, w: 2.6, h: 1.8, cover: 'light', solid: true, los: true, height: 3, label: '垃圾箱' },
      { id: 'd3', kind: 'rubble', style: 'dumpster', x: 24, y: 41.2, w: 2.6, h: 1.8, cover: 'light', solid: true, los: true, height: 3, label: '垃圾箱' },
      { id: 'd4', kind: 'rubble', style: 'dumpster', x: 69, y: 40.5, w: 2.6, h: 1.8, cover: 'light', solid: true, los: true, height: 3, label: '垃圾箱' },
      { id: 'r1', kind: 'rubble', style: 'rubble', x: 37, y: 17, w: 2, h: 2, cover: 'light', solid: false, los: false, height: 1, label: '瓦砾' },
      { id: 'r2', kind: 'rubble', style: 'rubble', x: 52, y: 20, w: 2, h: 2, cover: 'light', solid: false, los: false, height: 1, label: '瓦砾' },
      { id: 'r3', kind: 'rubble', style: 'rubble', x: 36, y: 48, w: 2.2, h: 2, cover: 'light', solid: false, los: false, height: 1, label: '瓦砾' },
      { id: 'r4', kind: 'rubble', style: 'rubble', x: 54, y: 47, w: 2, h: 1.8, cover: 'light', solid: false, los: false, height: 1, label: '瓦砾' },
      { id: 'r5', kind: 'rubble', style: 'rubble', x: 46, y: 34, w: 2.4, h: 2, cover: 'light', solid: false, los: false, height: 1, label: '瓦砾' },
      { id: 'r6', kind: 'rubble', style: 'rubble', x: 20, y: 30, w: 2, h: 2, cover: 'light', solid: false, los: false, height: 1, label: '瓦砾' }
    ],

    // 可进出的门（花 1 AP）
    doors: [
      { id: 'b1_door', x: 9.35, y: 12.76, w: 1.3, h: 0.24, dir: 'h', label: '24H 便利店·门' },
      { id: 'b2_door', x: 9.35, y: 23.76, w: 1.3, h: 0.24, dir: 'h', label: '义体诊所·门' },
      { id: 'b3_door', x: 23.85, y: 14.76, w: 1.3, h: 0.24, dir: 'h', label: '当铺·门' },
      { id: 'b5_door', x: 62.85, y: 13.76, w: 1.3, h: 0.24, dir: 'h', label: '加油站·门' },
      { id: 'b6_door', x: 77.35, y: 12.76, w: 1.3, h: 0.24, dir: 'h', label: '公寓·门' },
      { id: 'b8_door', x: 76.85, y: 24.76, w: 1.3, h: 0.24, dir: 'h', label: '夜店“锈钉”·门' },
      { id: 'b9_door', x: 9.35, y: 52.76, w: 1.3, h: 0.24, dir: 'h', label: '汽车修理厂·门' },
      { id: 'b10_door', x: 9.35, y: 61.76, w: 1.3, h: 0.24, dir: 'h', label: '烧毁的仓库·门' },
      { id: 'b11_door', x: 23.85, y: 52.76, w: 1.3, h: 0.24, dir: 'h', label: '批发市场·门' },
      { id: 'b13_door', x: 62.85, y: 52.76, w: 1.3, h: 0.24, dir: 'h', label: '数据中心·门' },
      { id: 'b14_door', x: 77.35, y: 52.76, w: 1.3, h: 0.24, dir: 'h', label: '地下诊所·门' },
      { id: 'b16_door', x: 76.85, y: 62.76, w: 1.3, h: 0.24, dir: 'h', label: '“自由电台”·门' }
    ],

    // 可翻越的窗洞（贴在坍塌民房的北墙上，靠近 1 寸内可花 1 AP 翻越）
    windows: [      { id: 'b4_win', x: 23.25, y: 19, w: 0.9, h: 0.35, dir: 'v', label: '窗洞' },
      { id: 'b7_win', x: 59.39, y: 17, w: 1, h: 0.35, dir: 'v', label: '窗洞' },
      { id: 'b12_win', x: 21.39, y: 55, w: 1, h: 0.35, dir: 'v', label: '窗洞' },
      { id: 'b15_win', x: 59.39, y: 55, w: 1, h: 0.35, dir: 'v', label: '窗洞' }
    ],

    graffiti: [
      { x: 6, y: 10.5, text: 'NO COPS', rot: 0, size: 1.9, color: '#ff5a5a' },
      { x: 6, y: 21.5, text: 'A 区已死', rot: 0, size: 1.6, color: '#ffd23c' },
      { x: 59, y: 10.5, text: 'ANARCHY', rot: 0, size: 1.9, color: '#ff3b3b' },
      { x: 73, y: 21.5, text: '拒绝服从', rot: 0, size: 1.6, color: '#ffd23c' },
      { x: 6, y: 49.5, text: '烧掉它们', rot: 0, size: 1.6, color: '#ff8a3c' },
      { x: 59, y: 49.5, text: 'ACAB', rot: 0, size: 2.0, color: '#ff2f2f' },
      { x: 73, y: 59.5, text: 'C 区自由', rot: 0, size: 1.5, color: '#6cf0ff' },
      { x: 44, y: 34, text: '抵抗', rot: 0, size: 1.8, color: '#ff3b3b' }
    ],
    symbols: [
      { x: 14, y: 33, size: 2.0, rot: 0.1 },
      { x: 76, y: 33, size: 2.2, rot: -0.2 },
      { x: 45, y: 26.5, size: 1.6, rot: 0.3 }
    ]
  };

  /* --------------------------------------------------------------- 任务 */
  var MISSION = {
    id: 'c-zone-orange',
    name: 'C 区 · 橙色行动',
    level: '',
    desc: '',
    objectiveCount: 4,
    // 关键行动 op：控制目标标识
    scoring: {
      perTurningPoint: function (myObj, enemyObj) {
        var vp = 0;
        if (myObj >= 1) vp += 1;
        if (myObj > enemyObj) vp += 1;
        return vp;
      }
    },
    // 击杀等级所需的残废数（依据 11 人示例 2/2/3/2/2 的近似扩表）
    killThresholds: {
      11: [2, 4, 7, 9, 11],
      12: [2, 4, 7, 10, 12],
      13: [2, 5, 8, 11, 13],
      14: [2, 5, 8, 11, 14],
      15: [3, 5, 9, 12, 15]
    },
    killThresholdDefault: [2, 5, 8, 11, 15]
  };

  return {
    CONFIG: CONFIG,
    WEAPONS: WEAPONS,
    EQUIP: EQUIP,
    autoEquip: autoEquip,
    validateEquip: validateEquip,
    RULES_IMPL: RULES_IMPL,
    FACTIONS: { police: POLICE, rioters: RIOTERS },
    MAP: MAP,
    MISSION: MISSION
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = DATA; }
