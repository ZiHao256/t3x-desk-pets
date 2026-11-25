# 用代码逐帧绘制 Codex 风格像素宠物（原创重画：蓝色云朵头、深色屏幕脸 ">_"、小身体），
# 输出 Codex 宠物 v2 图集格式：8 列 x 11 行，格子 192x208。每格是 48x52 的网格，每个网格点 4px。
# 用法: python3 codex_atlas.py <输出 png> [对比图 png]
import math
import sys

from PIL import Image, ImageDraw

PX, GW, GH = 4, 48, 52
OUTLINE = (0x23, 0x2C, 0x7A, 255)
BLUE = (0x55, 0x72, 0xF6, 255)
LIGHT = (0x88, 0xA0, 0xFF, 255)
DARK = (0x3B, 0x53, 0xD8, 255)
SCREEN = (0x16, 0x1D, 0x45, 255)
GLYPH = (0x8C, 0xF0, 0xFF, 255)
RED = (0xFF, 0x7A, 0x8F, 255)
DROP = (0xCF, 0xE3, 0xEE, 255)
SWEAT = [(38, 12, DROP), (37, 13, DROP), (38, 13, DROP), (37, 14, DROP), (38, 14, DROP), (39, 14, DROP), (38, 15, DROP)]


# ---------- 光栅化 ----------
def ellipse(cx, cy, rx, ry):
    return {(x, y) for y in range(GH) for x in range(GW) if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1}


def rrect(x0, y0, x1, y1, r):
    """含端点的圆角矩形。"""
    pts = set()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            cx = min(max(x, x0 + r), x1 - r)
            cy = min(max(y, y0 + r), y1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.5:
                pts.add((x, y))
    return pts


def capsule(x0, y0, x1, y1, r):
    pts = set()
    dx, dy = x1 - x0, y1 - y0
    ll = dx * dx + dy * dy or 1
    for y in range(int(min(y0, y1) - r - 1), int(max(y0, y1) + r + 2)):
        for x in range(int(min(x0, x1) - r - 1), int(max(x0, x1) + r + 2)):
            t = max(0, min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / ll))
            if (x + 0.5 - x0 - t * dx) ** 2 + (y + 0.5 - y0 - t * dy) ** 2 <= r * r:
                pts.add((x, y))
    return pts


def shift(pts, dx, dy):
    return {(x + dx, y + dy) for x, y in pts}


# ---------- 部件 ----------
def head(dx, dy, squash):
    """云朵头：底部椭圆加四个鼓包；squash>0 时整体压扁一点。"""
    sy = 1 - 0.06 * squash
    base = ellipse(24, 25 + squash, 14.5, 8 * sy)
    bumps = [(14, 21, 5), (19.5, 16.5, 5.5), (28.5, 16.5, 5.5), (34, 21, 5)]
    for cx, cy, r in bumps:
        base |= ellipse(cx, cy + squash * 1.2, r, r * sy)
    return shift(base, dx, dy)


def screen(dx, dy, squash):
    return shift(rrect(14, 19 + squash, 34, 30, 3), dx, dy)


def body(dx, dy, squash):
    return shift(rrect(17, 31 + squash, 31, 42, 3), dx, dy)


ARM_ANGLE = {"down": 15, "side": 55, "up": 135, "high": 165, "type": -40}


def arm(side, pose, dx, dy):
    """side=-1 左 / 1 右；角度从正下方量起，正数向外张。"""
    sx, sy = (17.5 if side < 0 else 30.5) + dx, 34 + dy
    a = math.radians(ARM_ANGLE[pose])
    length = 4.5 if pose == "type" else 6.5
    ex, ey = sx + side * math.sin(a) * length, sy + math.cos(a) * length
    return capsule(sx, sy, ex, ey, 1.6)


def legs(pose, dx, dy, length):
    pts = set()
    offsets = {"stand": ((0, 0), (0, 0)), "walkA": ((-2, 0), (2, -1)), "walkB": ((2, -1), (-2, 0)), "tucked": ((0, -2), (0, -2))}[pose]
    for hip_x, (fx, fy) in zip((21, 27), offsets):
        pts |= capsule(hip_x + dx, 41 + dy, hip_x + fx + dx, 41 + length + fy + dy, 1.7)
    return pts


# ---------- 屏幕上的表情 ----------
def chevron(x, y, flip=False):
    """7 行高的 ">"（flip 为 "<"）。"""
    pts = set()
    for i, w in enumerate((0, 1, 2, 3, 2, 1, 0)):
        px = x + (3 - w if flip else w)
        pts |= {(px, y + i), (px + 1, y + i)}
    return pts


def face(kind, gx, gy, frame_no=0):
    """返回 [(pts, color)]，坐标相对屏幕左上角 (14, 19)，gx/gy 是视线偏移。"""
    ox, oy = 16 + gx, 21 + gy
    out = []
    if kind in ("open", "blink"):
        out.append((chevron(ox, oy), GLYPH))
        if kind == "open":
            out.append(({(x, oy + 6) for x in range(ox + 8, ox + 14)} | {(x, oy + 5) for x in range(ox + 8, ox + 14)}, GLYPH))
    elif kind == "happy":
        for cx in (ox + 2, ox + 11):
            out.append(({(cx, oy + 3), (cx + 1, oy + 2), (cx + 2, oy + 1), (cx + 3, oy + 2), (cx + 4, oy + 3),
                         (cx, oy + 4), (cx + 4, oy + 4)}, GLYPH))
    elif kind == "dizzy":
        for cx in (ox + 1, ox + 11):
            out.append(({(cx + i, oy + 1 + i) for i in range(5)} | {(cx + 4 - i, oy + 1 + i) for i in range(5)}, RED))
    elif kind == "dots":
        out.append((chevron(ox, oy), GLYPH))
        for i in range(frame_no % 3 + 1):
            out.append((rrect(ox + 7 + i * 3, oy + 5, ox + 8 + i * 3, oy + 6, 0), GLYPH))
    elif kind == "code":
        widths = [(5, 9, 3), (8, 4, 6), (3, 7, 8), (6, 5, 4), (9, 3, 5), (4, 8, 7)]
        for row, w in enumerate(widths[frame_no % len(widths)]):
            y = oy + row * 3
            out.append(({(x, y) for x in range(ox, ox + w)} | {(x, y + 1) for x in range(ox, ox + w)}, GLYPH))
    elif kind == "scan":
        out.append((chevron(ox, oy), GLYPH))
        bar = ox + 7 + frame_no
        out.append(({(x, oy + 3) for x in range(bar, bar + 3)} | {(x, oy + 4) for x in range(bar, bar + 3)}, GLYPH))
    return out


# ---------- 帧 ----------
def frame(face_kind="open", gx=0, gy=0, arms=("side", "side"), leg="stand", leg_len=5, dy=0, dx=0, squash=0,
          lean=0, extra=(), n=0):
    return dict(face=face_kind, gx=gx, gy=gy, arms=arms, leg=leg, leg_len=leg_len, dy=dy, dx=dx, squash=squash,
                lean=lean, extra=list(extra), n=n)


def paint_part(grid, pts, fill, shade=True):
    """先画外扩一圈描边，再填色；上左边缘提亮、下右边缘压暗。后画的部件盖住前面的，形成内描边。"""
    ring = {(x + ax, y + ay) for x, y in pts for ax, ay in ((1, 0), (-1, 0), (0, 1), (0, -1))} - pts
    for p in ring:
        grid[p] = OUTLINE
    for x, y in pts:
        color = fill
        if shade and (x - 1, y - 1) not in pts:
            color = LIGHT
        elif shade and ((x + 1, y + 1) not in pts or (x, y + 2) not in pts):
            color = DARK
        grid[(x, y)] = color


def render(fr):
    grid = {}
    dx, dy, sq, lean = fr["dx"], fr["dy"], fr["squash"], fr["lean"]
    paint_part(grid, legs(fr["leg"], dx, dy, fr["leg_len"]), BLUE)
    paint_part(grid, body(dx, dy, sq), BLUE)
    hx = dx + lean
    paint_part(grid, head(hx, dy, sq), BLUE)
    scr = screen(hx, dy, sq)
    for p in scr:
        grid[p] = SCREEN
    for pts, color in face(fr["face"], fr["gx"], fr["gy"] + sq, fr["n"]):
        for x, y in shift(pts, hx, dy):
            if (x, y) in scr:
                grid[(x, y)] = color
    # 胸口的小 ">-"
    for x, y in {(21, 35), (22, 36), (21, 37), (24, 36), (25, 36), (26, 36)}:
        grid[(x + dx, y + dy + sq)] = LIGHT
    paint_part(grid, arm(-1, fr["arms"][0], dx, dy + sq), BLUE)
    paint_part(grid, arm(1, fr["arms"][1], dx, dy + sq), BLUE)
    for x, y, color in fr["extra"]:
        grid[(x + hx, y + dy)] = color
    return grid


def rows():
    r = {}
    r[0] = [frame(), frame("blink"), frame(), frame(squash=1, leg_len=4), frame(gx=1), frame()]  # idle：光标闪、呼吸、瞥一眼
    r[1] = [frame(gx=2, lean=1, leg="walkA" if i % 2 == 0 else "walkB", dy=-1 if i % 4 in (1, 2) else 0,
                  arms=("down", "side") if i % 2 == 0 else ("side", "down")) for i in range(8)]  # 向右跑
    # 向左跑单独画（整体镜像会把屏幕上的 ">_" 翻成 "_<"）：视线和身体朝左，腿和手臂相位与向右跑对称
    r[2] = [frame(gx=-2, lean=-1, leg="walkB" if i % 2 == 0 else "walkA", dy=-1 if i % 4 in (1, 2) else 0,
                  arms=("side", "down") if i % 2 == 0 else ("down", "side")) for i in range(8)]
    r[3] = [frame("happy", arms=("side", "up")), frame("happy", arms=("side", "high")),
            frame("happy", arms=("side", "up")), frame("happy", arms=("side", "high"))]  # 挥手
    r[4] = [frame(squash=2, leg_len=4, face_kind="blink"), frame(dy=-5, arms=("up", "up")),  # 跳：蓄力、起跳、最高点、下落、落地
            frame("happy", dy=-9, leg="tucked", arms=("up", "up")), frame(dy=-4, arms=("side", "side")),
            frame(squash=2, leg_len=4)]
    r[5] = [frame("dizzy", arms=("down", "down"), squash=1, leg_len=4, dx=(0, 1, 0, -1)[i % 4],
                  extra=SWEAT if i in (2, 3, 6, 7) else []) for i in range(8)]  # 失败
    r[6] = [frame("dots", gy=-1, arms=("side", "up" if i in (1, 2) else "side"), dy=-1 if i in (1, 4) else 0, n=i) for i in range(6)]  # 等待
    r[7] = [frame("code", gy=1, arms=("type", "side") if i % 2 == 0 else ("side", "type"), squash=1 if i % 3 == 1 else 0,
                  leg_len=4 if i % 3 == 1 else 5, n=i) for i in range(6)]  # 工作：敲键盘、屏幕滚代码
    r[8] = [frame("scan", n=i, lean=(-1, -1, 0, 1, 1, 0)[i], gx=(-1, -1, 0, 1, 1, 0)[i]) for i in range(6)]  # 审查：扫视
    looks = []
    for i in range(16):  # 0 度朝上，顺时针每 22.5 度
        a = math.radians(i * 22.5)
        gx, gy = round(math.sin(a) * 2), round(-math.cos(a) * 2)
        lean = 1 if 45 <= i * 22.5 <= 135 else -1 if 225 <= i * 22.5 <= 315 else 0
        looks.append(frame(gx=gx, gy=gy, lean=lean, dy=-1 if gy < 0 and gx == 0 else 0))
    r[9], r[10] = looks[:8], looks[8:]
    return r


def main(out_png, compare=None):
    img = Image.new("RGBA", (1536, 2288), (0, 0, 0, 0))
    for row, frames in rows().items():
        for col, fr in enumerate(frames):
            for (x, y), color in render(fr).items():
                if 0 <= x < GW and 0 <= y + 1 < GH:  # 整体下移一格，脚底落在第 200 行（和原图集一致）
                    img.paste(color, (col * 192 + x * PX, row * 208 + (y + 1) * PX, col * 192 + x * PX + PX, row * 208 + (y + 2) * PX))
    img.save(out_png)
    if compare:
        sheet = Image.new("RGBA", img.size, (52, 52, 56, 255))
        sheet.alpha_composite(img)
        d = ImageDraw.Draw(sheet)
        for row in range(11):
            d.text((4, row * 208 + 2), f"row{row}", fill=(255, 255, 0, 255))
        sheet.convert("RGB").resize((768, 1144), Image.NEAREST).save(compare)
    print(out_png)


if __name__ == "__main__":
    main(*sys.argv[1:3])
