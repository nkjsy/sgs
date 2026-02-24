import { GameEvent, GameState, SkillDefinition, SkillSystemState } from "./types";

export const STANDARD_SKILL_IDS = {
  caocaoJianxiong: "std.caocao.jianxiong",
  caocaoHujia: "std.caocao.hujia",
  zhangfeiPaoxiao: "std.zhangfei.paoxiao",
  machaoMashu: "std.machao.mashu",
  machaoTieqi: "std.machao.tieqi",
  simayiFankui: "std.simayi.fankui",
  simayiGuicai: "std.simayi.guicai",
  xiahoudunGanglie: "std.xiahoudun.ganglie",
  guojiaTiandu: "std.guojia.tiandu",
  zhangliaoTuxi: "std.zhangliao.tuxi",
  xuchuLuoyi: "std.xuchu.luoyi",
  liubeiRende: "std.liubei.rende",
  liubeiJijiang: "std.liubei.jijiang",
  zhugeliangGuanxing: "std.zhugeliang.guanxing",
  zhouyuYingzi: "std.zhouyu.yingzi",
  zhouyuFanjian: "std.zhouyu.fanjian",
  huanggaiKurou: "std.huanggai.kurou",
  lvmengKeji: "std.lvmeng.keji",
  sunquanZhiheng: "std.sunquan.zhiheng",
  sunshangxiangJieyin: "std.sunshangxiang.jieyin",
  daqiaoGuose: "std.daqiao.guose",
  daqiaoLiuli: "std.daqiao.liuli",
  ganningQixi: "std.ganning.qixi",
  luxunLianying: "std.luxun.lianying",
  luxunQianxun: "std.luxun.qianxun",
  diaochanBiyue: "std.diaochan.biyue",
  diaochanLijian: "std.diaochan.lijian",
  sunshangxiangXiaoji: "std.sunshangxiang.xiaoji",
  guanyuWusheng: "std.guanyu.wusheng",
  guojiaYiji: "std.guojia.yiji",
  zhugeliangKongcheng: "std.zhugeliang.kongcheng",
  lvbuWushuang: "std.lvbu.wushuang",
  zhaoyunLongdan: "std.zhaoyun.longdan",
  huangyueyingJizhi: "std.huangyueying.jizhi",
  huangyueyingQicai: "std.huangyueying.qicai",
  zhenjiQingguo: "std.zhenji.qingguo",
  zhenjiLuoshen: "std.zhenji.luoshen",
  sunquanJiuyuan: "std.sunquan.jiuyuan",
  huatuoQingnang: "std.huatuo.qingnang",
  huatuoJijiu: "std.huatuo.jijiu"
} as const;

export function createSkillSystemState(): SkillSystemState {
  return {
    definitions: {},
    playerSkills: {}
  };
}

export function registerSkill(state: GameState, definition: SkillDefinition): void {
  state.skillSystem.definitions[definition.id] = definition;
}

export function assignSkillToPlayer(state: GameState, playerId: string, skillId: string): void {
  const skills = state.skillSystem.playerSkills[playerId] ?? [];
  if (!skills.includes(skillId)) {
    skills.push(skillId);
  }
  state.skillSystem.playerSkills[playerId] = skills;
}

export function hasSkill(state: GameState, playerId: string, skillId: string): boolean {
  const skills = state.skillSystem.playerSkills[playerId] ?? [];
  return skills.includes(skillId);
}

export function emitSkillEvent(state: GameState, event: GameEvent): void {
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }

    const skillIds = state.skillSystem.playerSkills[player.id] ?? [];
    for (const skillId of skillIds) {
      const definition = state.skillSystem.definitions[skillId];
      if (!definition?.onEvent) {
        continue;
      }

      definition.onEvent({
        state,
        event,
        owner: player
      });
    }
  }
}
