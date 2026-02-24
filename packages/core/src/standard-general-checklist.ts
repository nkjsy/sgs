import { STANDARD_SKILL_IDS } from "./skills";

type StandardSkillId = (typeof STANDARD_SKILL_IDS)[keyof typeof STANDARD_SKILL_IDS];

export interface StandardGeneralChecklistItem {
  generalId: string;
  generalName: string;
  skills: StandardSkillId[];
  implementedSkills: StandardSkillId[];
  completed: boolean;
}

const STANDARD_GENERAL_SKILL_MAP: ReadonlyArray<{ generalId: string; generalName: string; skills: StandardSkillId[] }> = [
  { generalId: "caocao", generalName: "曹操", skills: [STANDARD_SKILL_IDS.caocaoJianxiong, STANDARD_SKILL_IDS.caocaoHujia] },
  { generalId: "zhangfei", generalName: "张飞", skills: [STANDARD_SKILL_IDS.zhangfeiPaoxiao] },
  { generalId: "machao", generalName: "马超", skills: [STANDARD_SKILL_IDS.machaoMashu, STANDARD_SKILL_IDS.machaoTieqi] },
  { generalId: "simayi", generalName: "司马懿", skills: [STANDARD_SKILL_IDS.simayiFankui, STANDARD_SKILL_IDS.simayiGuicai] },
  { generalId: "xiahoudun", generalName: "夏侯惇", skills: [STANDARD_SKILL_IDS.xiahoudunGanglie] },
  { generalId: "guojia", generalName: "郭嘉", skills: [STANDARD_SKILL_IDS.guojiaYiji, STANDARD_SKILL_IDS.guojiaTiandu] },
  { generalId: "zhangliao", generalName: "张辽", skills: [STANDARD_SKILL_IDS.zhangliaoTuxi] },
  { generalId: "xuchu", generalName: "许褚", skills: [STANDARD_SKILL_IDS.xuchuLuoyi] },
  { generalId: "liubei", generalName: "刘备", skills: [STANDARD_SKILL_IDS.liubeiRende, STANDARD_SKILL_IDS.liubeiJijiang] },
  { generalId: "zhugeliang", generalName: "诸葛亮", skills: [STANDARD_SKILL_IDS.zhugeliangGuanxing, STANDARD_SKILL_IDS.zhugeliangKongcheng] },
  { generalId: "zhouyu", generalName: "周瑜", skills: [STANDARD_SKILL_IDS.zhouyuYingzi, STANDARD_SKILL_IDS.zhouyuFanjian] },
  { generalId: "huanggai", generalName: "黄盖", skills: [STANDARD_SKILL_IDS.huanggaiKurou] },
  { generalId: "lvmeng", generalName: "吕蒙", skills: [STANDARD_SKILL_IDS.lvmengKeji] },
  { generalId: "sunquan", generalName: "孙权", skills: [STANDARD_SKILL_IDS.sunquanZhiheng, STANDARD_SKILL_IDS.sunquanJiuyuan] },
  {
    generalId: "sunshangxiang",
    generalName: "孙尚香",
    skills: [STANDARD_SKILL_IDS.sunshangxiangJieyin, STANDARD_SKILL_IDS.sunshangxiangXiaoji]
  },
  { generalId: "daqiao", generalName: "大乔", skills: [STANDARD_SKILL_IDS.daqiaoGuose, STANDARD_SKILL_IDS.daqiaoLiuli] },
  { generalId: "ganning", generalName: "甘宁", skills: [STANDARD_SKILL_IDS.ganningQixi] },
  { generalId: "luxun", generalName: "陆逊", skills: [STANDARD_SKILL_IDS.luxunQianxun, STANDARD_SKILL_IDS.luxunLianying] },
  { generalId: "diaochan", generalName: "貂蝉", skills: [STANDARD_SKILL_IDS.diaochanLijian, STANDARD_SKILL_IDS.diaochanBiyue] },
  { generalId: "guanyu", generalName: "关羽", skills: [STANDARD_SKILL_IDS.guanyuWusheng] },
  { generalId: "lvbu", generalName: "吕布", skills: [STANDARD_SKILL_IDS.lvbuWushuang] },
  { generalId: "zhaoyun", generalName: "赵云", skills: [STANDARD_SKILL_IDS.zhaoyunLongdan] },
  {
    generalId: "huangyueying",
    generalName: "黄月英",
    skills: [STANDARD_SKILL_IDS.huangyueyingJizhi, STANDARD_SKILL_IDS.huangyueyingQicai]
  },
  { generalId: "zhenji", generalName: "甄姬", skills: [STANDARD_SKILL_IDS.zhenjiQingguo, STANDARD_SKILL_IDS.zhenjiLuoshen] },
  { generalId: "huatuo", generalName: "华佗", skills: [STANDARD_SKILL_IDS.huatuoQingnang, STANDARD_SKILL_IDS.huatuoJijiu] }
];

const IMPLEMENTED_SKILL_SET = new Set<StandardSkillId>(Object.values(STANDARD_SKILL_IDS) as StandardSkillId[]);

export const STANDARD_GENERAL_CHECKLIST: ReadonlyArray<StandardGeneralChecklistItem> = STANDARD_GENERAL_SKILL_MAP.map((item) => {
  const implementedSkills = item.skills.filter((skillId) => IMPLEMENTED_SKILL_SET.has(skillId));
  return {
    generalId: item.generalId,
    generalName: item.generalName,
    skills: [...item.skills],
    implementedSkills,
    completed: implementedSkills.length === item.skills.length
  };
});

export const STANDARD_GENERAL_COMPLETION = {
  totalGenerals: STANDARD_GENERAL_CHECKLIST.length,
  completedGenerals: STANDARD_GENERAL_CHECKLIST.filter((item) => item.completed).length,
  pendingGenerals: STANDARD_GENERAL_CHECKLIST.filter((item) => !item.completed).length,
  get percent(): number {
    if (this.totalGenerals === 0) {
      return 0;
    }

    return Math.round((this.completedGenerals / this.totalGenerals) * 100);
  }
} as const;
