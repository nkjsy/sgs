# Web 素材放置规范

把素材统一放在 `apps/web/public/assets` 下，按下列目录和命名放置：

## 目录

- `generals/`：武将立绘
- `cards/`：卡牌图片
- `ui/`：按钮、背景、图标等 UI 素材
- `audio/`：音效/BGM（可后补）

## 命名约定

- 全部小写 + 下划线
- 不用中文和空格
- 建议扩展名：图片 `png/webp`，音频 `mp3/ogg`

### 武将立绘

文件名建议：`<general_id>.png`

例如：
- `liubei.png`
- `zhouyu.png`
- `diaochan.png`

`general_id` 建议与 core 清单中的 `generalId` 保持一致（见 `packages/core/src/standard-general-checklist.ts`）。

### 卡牌素材

文件名建议：`<card_kind>.png`

例如：
- `slash.png`
- `dodge.png`
- `peach.png`
- `duel.png`
- `weapon_qinggang_sword.png`

`card_kind` 建议与 core 的 `CardKind` 一致（见 `packages/core/src/types.ts`）。

## 尺寸建议（可先不严格）

- 武将立绘：`512x512` 或 `768x1024`
- 卡牌图：`360x500`（统一比例即可）
- UI 图标：`64x64` 或矢量 SVG

## 最小可用集（先做这些就能接 UI）

- 武将：5 张（当前演示阵容）
- 卡牌：`slash / dodge / peach / snatch / dismantle / duel / nullify`
- UI：1 张桌面背景（可选）

