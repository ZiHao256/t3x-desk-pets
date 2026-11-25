// 随扩展发布的宠物（Codex 之外）：精灵图在 pets/<id>/sheet.webp，这里是落点、缩放、粒子颜色等参数（字段同自定义宠物的 pet.json）。
// Clawd、Moffy 是作者自己绘制的同人像素形象，仅供非商业使用；角色形象本身归原权利方所有（Clawd 是 Anthropic 的 Claude 吉祥物）。
const BUNDLED_PETS = [
{
  "id": "claude",
  "name": "Clawd",
  "pixelFx": true,
  "badgeBottom": 40,
  "vars": {
    "--t3x-pet-scale": "1.125",
    "--t3x-pet-sink": "calc(var(--t3x-pet-w) * 0.114)",
    "--t3x-pet-shadow-bottom": "calc(var(--t3x-pet-w) * 0.066)",
    "--t3x-pet-origin-y": "92%",
    "--t3x-pet-fx-beam-h": "72%",
    "--t3x-pet-fx-beam-b": "8%",
    "--t3x-pet-fx-burst-top": "68%",
    "--t3x-pet-fx-poke-top": "18%",
    "--t3x-pet-fx-beam": "radial-gradient(ellipse 11% 42% at 50% 54%, #fff3ec 0%, #f2a488 40%, transparent 72%), radial-gradient(ellipse 34% 38% at 50% 56%, rgba(217, 119, 87, 0.84) 0%, rgba(217, 119, 87, 0.28) 50%, transparent 72%), radial-gradient(ellipse 46% 32% at 50% 58%, rgba(217, 119, 87, 0.2) 0%, transparent 70%)",
    "--t3x-pet-fx-sparks": "linear-gradient(#d97757, #d97757) 18% 24% / 4px 4px no-repeat, linear-gradient(#c65e3d, #c65e3d) 82% 20% / 4px 4px no-repeat, linear-gradient(#f09f83, #f09f83) 28% 12% / 3px 3px no-repeat, linear-gradient(#d97757, #d97757) 10% 58% / 5px 5px no-repeat, linear-gradient(#f09f83, #f09f83) 88% 54% / 4px 4px no-repeat, linear-gradient(#c65e3d, #c65e3d) 76% 74% / 3px 3px no-repeat, linear-gradient(#d97757, #d97757) 30% 82% / 4px 4px no-repeat, linear-gradient(#d97757, #d97757) 68% 84% / 3px 3px no-repeat",
    "--t3x-pet-fx-poke-sparks": "linear-gradient(#d97757, #d97757) 26% 62% / 4px 4px no-repeat, linear-gradient(#c65e3d, #c65e3d) 50% 22% / 4px 4px no-repeat, linear-gradient(#f09f83, #f09f83) 74% 58% / 4px 4px no-repeat",
    "--t3x-sub-greet-top": "22%",
    "--t3x-sub-highfive-top": "44%",
    "--t3x-sub-droop-top": "36%",
    "--t3x-sub-greet-fx": "linear-gradient(#d97757, #d97757) 44% 38% / 4px 4px no-repeat, linear-gradient(#c65e3d, #c65e3d) 62% 24% / 3px 3px no-repeat, linear-gradient(#f09f83, #f09f83) 24% 64% / 4px 4px no-repeat, linear-gradient(#d97757, #d97757) 72% 58% / 3px 3px no-repeat",
    "--t3x-sub-hf-ring": "radial-gradient(circle, transparent 38%, rgba(217, 119, 87, 0.84) 54%, rgba(240, 159, 131, 0.3) 66%, transparent 76%)",
    "--t3x-sub-hf-sparks": "linear-gradient(#d97757, #d97757) 50% 10% / 4px 4px no-repeat, linear-gradient(#c65e3d, #c65e3d) 86% 28% / 4px 4px no-repeat, linear-gradient(#f09f83, #f09f83) 84% 72% / 4px 4px no-repeat, linear-gradient(#d97757, #d97757) 48% 88% / 3px 3px no-repeat, linear-gradient(#c65e3d, #c65e3d) 14% 70% / 4px 4px no-repeat, linear-gradient(#f09f83, #f09f83) 16% 28% / 4px 4px no-repeat"
  },
  "darkVars": {
    "--t3x-pet-fx-beam": "radial-gradient(ellipse 11% 44% at 50% 54%, #ffffff 0%, #f8beaa 38%, transparent 72%), radial-gradient(ellipse 34% 40% at 50% 56%, rgba(229, 134, 103, 0.92) 0%, rgba(217, 119, 87, 0.34) 50%, transparent 72%), radial-gradient(ellipse 46% 34% at 50% 58%, rgba(217, 119, 87, 0.26) 0%, transparent 70%)",
    "--t3x-pet-fx-sparks": "linear-gradient(#e58667, #e58667) 18% 24% / 4px 4px no-repeat, linear-gradient(#f8beaa, #f8beaa) 82% 20% / 4px 4px no-repeat, linear-gradient(#fff1ea, #fff1ea) 28% 12% / 3px 3px no-repeat, linear-gradient(#d97757, #d97757) 10% 58% / 5px 5px no-repeat, linear-gradient(#f8beaa, #f8beaa) 88% 54% / 4px 4px no-repeat, linear-gradient(#fff1ea, #fff1ea) 76% 74% / 3px 3px no-repeat, linear-gradient(#e58667, #e58667) 30% 82% / 4px 4px no-repeat, linear-gradient(#d97757, #d97757) 68% 84% / 3px 3px no-repeat",
    "--t3x-pet-fx-poke-sparks": "linear-gradient(#e58667, #e58667) 26% 62% / 4px 4px no-repeat, linear-gradient(#fff1ea, #fff1ea) 50% 22% / 4px 4px no-repeat, linear-gradient(#f8beaa, #f8beaa) 74% 58% / 4px 4px no-repeat",
    "--t3x-sub-greet-fx": "linear-gradient(#fff1ea, #fff1ea) 44% 38% / 4px 4px no-repeat, linear-gradient(#f8beaa, #f8beaa) 62% 24% / 3px 3px no-repeat, linear-gradient(#e58667, #e58667) 24% 64% / 4px 4px no-repeat, linear-gradient(#d97757, #d97757) 72% 58% / 3px 3px no-repeat",
    "--t3x-sub-hf-ring": "radial-gradient(circle, transparent 38%, rgba(248, 190, 170, 0.92) 52%, rgba(217, 119, 87, 0.36) 66%, transparent 76%)",
    "--t3x-sub-hf-sparks": "linear-gradient(#fff1ea, #fff1ea) 50% 10% / 4px 4px no-repeat, linear-gradient(#f8beaa, #f8beaa) 86% 28% / 4px 4px no-repeat, linear-gradient(#e58667, #e58667) 84% 72% / 4px 4px no-repeat, linear-gradient(#f8beaa, #f8beaa) 48% 88% / 3px 3px no-repeat, linear-gradient(#d97757, #d97757) 14% 70% / 4px 4px no-repeat, linear-gradient(#fff1ea, #fff1ea) 16% 28% / 4px 4px no-repeat"
  }
},
{
  "id": "gemini",
  "name": "Moffy",
  "pixelFx": false,
  "badgeBottom": 54,
  "vars": {
    "--t3x-pet-sink": "calc(var(--t3x-pet-w) * 0.105)",
    "--t3x-pet-shadow-bottom": "calc(var(--t3x-pet-w) * 0.056)",
    "--t3x-pet-origin-y": "93%",
    "--t3x-pet-fx-beam": "radial-gradient(ellipse 9% 42% at 50% 52%, #ffffff 0%, rgba(232, 222, 255, 0.88) 38%, transparent 72%), radial-gradient(ellipse 30% 28% at 50% 34%, rgba(66, 133, 244, 0.72) 0%, transparent 72%), radial-gradient(ellipse 34% 34% at 50% 54%, rgba(155, 114, 203, 0.78) 0%, transparent 72%), radial-gradient(ellipse 30% 26% at 50% 74%, rgba(217, 101, 112, 0.7) 0%, transparent 72%)",
    "--t3x-pet-fx-sparks": "radial-gradient(circle, #4285f4 0 1.7px, rgba(66, 133, 244, 0.45) 2.6px, transparent 3.4px) 16% 22% / 8px 8px no-repeat, radial-gradient(circle, #9b72cb 0 1.8px, rgba(155, 114, 203, 0.45) 2.7px, transparent 3.5px) 84% 20% / 8px 8px no-repeat, radial-gradient(circle, #d96570 0 1.7px, rgba(217, 101, 112, 0.45) 2.6px, transparent 3.4px) 12% 62% / 8px 8px no-repeat, radial-gradient(circle, #4285f4 0 1.6px, rgba(66, 133, 244, 0.42) 2.5px, transparent 3.3px) 88% 58% / 8px 8px no-repeat, radial-gradient(circle, #9b72cb 0 1.4px, rgba(155, 114, 203, 0.38) 2.3px, transparent 3.1px) 30% 84% / 7px 7px no-repeat, radial-gradient(circle, #d96570 0 1.4px, rgba(217, 101, 112, 0.38) 2.3px, transparent 3.1px) 74% 82% / 7px 7px no-repeat",
    "--t3x-pet-fx-poke-sparks": "radial-gradient(circle, #4285f4 0 1.6px, rgba(66, 133, 244, 0.44) 2.5px, transparent 3.3px) 24% 62% / 8px 8px no-repeat, radial-gradient(circle, #9b72cb 0 1.9px, rgba(155, 114, 203, 0.48) 2.8px, transparent 3.6px) 50% 24% / 9px 9px no-repeat, radial-gradient(circle, #d96570 0 1.6px, rgba(217, 101, 112, 0.44) 2.5px, transparent 3.3px) 76% 58% / 8px 8px no-repeat",
    "--t3x-sub-greet-fx": "radial-gradient(ellipse 46% 12% at 50% 44%, #9b72cb 0%, rgba(155, 114, 203, 0.45) 55%, transparent 78%) 50% 44% / 14px 14px no-repeat, radial-gradient(ellipse 12% 46% at 50% 44%, #9b72cb 0%, rgba(155, 114, 203, 0.45) 55%, transparent 78%) 50% 44% / 14px 14px no-repeat, radial-gradient(circle, #4285f4 0 1.6px, rgba(66, 133, 244, 0.4) 2.5px, transparent 3.4px) 16% 68% / 8px 8px no-repeat, radial-gradient(circle, #d96570 0 1.6px, rgba(217, 101, 112, 0.4) 2.5px, transparent 3.4px) 84% 26% / 8px 8px no-repeat",
    "--t3x-sub-hf-ring": "radial-gradient(circle, transparent 36%, rgba(155, 114, 203, 0.85) 52%, rgba(66, 133, 244, 0.36) 64%, transparent 76%)",
    "--t3x-sub-hf-sparks": "radial-gradient(circle, #4285f4 0 1.8px, rgba(66, 133, 244, 0.46) 2.7px, transparent 3.6px) 50% 8% / 8px 8px no-repeat, radial-gradient(circle, #9b72cb 0 1.8px, rgba(155, 114, 203, 0.46) 2.7px, transparent 3.6px) 86% 28% / 8px 8px no-repeat, radial-gradient(circle, #d96570 0 1.8px, rgba(217, 101, 112, 0.46) 2.7px, transparent 3.6px) 84% 74% / 8px 8px no-repeat, radial-gradient(circle, #4285f4 0 1.6px, rgba(66, 133, 244, 0.42) 2.5px, transparent 3.3px) 50% 92% / 8px 8px no-repeat, radial-gradient(circle, #9b72cb 0 1.7px, rgba(155, 114, 203, 0.44) 2.6px, transparent 3.4px) 14% 72% / 8px 8px no-repeat, radial-gradient(circle, #d96570 0 1.7px, rgba(217, 101, 112, 0.44) 2.6px, transparent 3.4px) 16% 26% / 8px 8px no-repeat"
  },
  "darkVars": {
    "--t3x-pet-fx-beam": "radial-gradient(ellipse 10% 44% at 50% 52%, #ffffff 0%, rgba(240, 232, 255, 0.92) 38%, transparent 72%), radial-gradient(ellipse 32% 30% at 50% 34%, rgba(66, 133, 244, 0.84) 0%, transparent 72%), radial-gradient(ellipse 36% 36% at 50% 54%, rgba(155, 114, 203, 0.9) 0%, transparent 72%), radial-gradient(ellipse 32% 28% at 50% 74%, rgba(217, 101, 112, 0.82) 0%, transparent 72%)",
    "--t3x-pet-fx-sparks": "radial-gradient(circle, #ffffff 0 1.2px, #4285f4 2.4px, transparent 3.5px) 16% 22% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.3px, #9b72cb 2.5px, transparent 3.6px) 84% 20% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.2px, #d96570 2.4px, transparent 3.5px) 12% 62% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.2px, #4285f4 2.4px, transparent 3.5px) 88% 58% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1px, #9b72cb 2.2px, transparent 3.2px) 30% 84% / 7px 7px no-repeat, radial-gradient(circle, #ffffff 0 1px, #d96570 2.2px, transparent 3.2px) 74% 82% / 7px 7px no-repeat",
    "--t3x-pet-fx-poke-sparks": "radial-gradient(circle, #ffffff 0 1.2px, #4285f4 2.4px, transparent 3.4px) 24% 62% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.4px, #9b72cb 2.7px, transparent 3.7px) 50% 24% / 9px 9px no-repeat, radial-gradient(circle, #ffffff 0 1.2px, #d96570 2.4px, transparent 3.4px) 76% 58% / 8px 8px no-repeat",
    "--t3x-sub-greet-fx": "radial-gradient(ellipse 46% 12% at 50% 44%, #ffffff 0%, #c6a8eb 50%, transparent 78%) 50% 44% / 14px 14px no-repeat, radial-gradient(ellipse 12% 46% at 50% 44%, #ffffff 0%, #c6a8eb 50%, transparent 78%) 50% 44% / 14px 14px no-repeat, radial-gradient(circle, #ffffff 0 1.2px, #4285f4 2.4px, transparent 3.5px) 16% 68% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.2px, #d96570 2.4px, transparent 3.5px) 84% 26% / 8px 8px no-repeat",
    "--t3x-sub-hf-ring": "radial-gradient(circle, transparent 36%, rgba(232, 214, 255, 0.94) 50%, rgba(155, 114, 203, 0.46) 64%, transparent 76%)",
    "--t3x-sub-hf-sparks": "radial-gradient(circle, #ffffff 0 1.3px, #4285f4 2.6px, transparent 3.6px) 50% 8% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.4px, #9b72cb 2.7px, transparent 3.7px) 86% 28% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.3px, #d96570 2.6px, transparent 3.6px) 84% 74% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.1px, #4285f4 2.3px, transparent 3.3px) 50% 92% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.3px, #9b72cb 2.5px, transparent 3.5px) 14% 72% / 8px 8px no-repeat, radial-gradient(circle, #ffffff 0 1.3px, #d96570 2.5px, transparent 3.5px) 16% 26% / 8px 8px no-repeat"
  }
}
];
