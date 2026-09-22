#!/usr/bin/env python3
"""生成“回答完就通知”项目概念演示视频。"""

from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = Path(__file__).resolve().parent
BUILD_DIR = VIDEO_DIR / "build"
OUTPUT_DIR = VIDEO_DIR / "output"
W, H = 1280, 720

FONT_REGULAR = Path("/System/Library/Fonts/PingFang.ttc")
FONT_FALLBACK = Path("/System/Library/Fonts/STHeiti Medium.ttc")
FONT_PATH = FONT_REGULAR if FONT_REGULAR.exists() else FONT_FALLBACK

COLORS = {
    "bg": "#07111f",
    "bg2": "#0d2038",
    "blue": "#51a8ff",
    "cyan": "#5ce1e6",
    "green": "#66e3a4",
    "orange": "#ffb45c",
    "red": "#ff7d83",
    "text": "#f4f8ff",
    "muted": "#a9bad0",
    "card": "#12243a",
    "line": "#28445f",
}


def font(size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size=size, index=index)


def gradient(top="#07111f", bottom="#102d4a") -> Image.Image:
    image = Image.new("RGB", (W, H))
    px = image.load()
    t = tuple(int(top[i : i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(bottom[i : i + 2], 16) for i in (1, 3, 5))
    for y in range(H):
        k = y / (H - 1)
        row = tuple(int(t[i] * (1 - k) + b[i] * k) for i in range(3))
        for x in range(W):
            glow = max(0, 1 - math.dist((x, y), (980, 160)) / 650)
            px[x, y] = tuple(min(255, int(row[i] + glow * (12 if i == 2 else 4))) for i in range(3))
    return image


def rounded(draw, box, radius=24, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, size, fill=None, anchor="la", bold=False, spacing=8):
    f = font(size, 1 if bold else 0)
    draw.multiline_text(xy, value, font=f, fill=fill or COLORS["text"], anchor=anchor, spacing=spacing)


def wrap_zh(value: str, max_chars: int) -> str:
    lines, buf = [], ""
    for ch in value:
        buf += ch
        if len(buf) >= max_chars or ch == "\n":
            lines.append(buf.rstrip("\n"))
            buf = ""
    if buf:
        lines.append(buf)
    return "\n".join(lines)


def subtitle_chunks(value: str, max_chars: int = 32) -> list[str]:
    """按中文标点拆成短字幕，每条最多约两行。"""
    sentences = [part.strip() for part in re.findall(r"[^。！？；]+[。！？；]?", value) if part.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current += sentence
        while len(current) > max_chars:
            chunks.append(current[:max_chars])
            current = current[max_chars:]
    if current:
        chunks.append(current)
    return chunks


def header(draw, kicker: str, title: str, subtitle: str = ""):
    text(draw, (72, 58), kicker.upper(), 18, COLORS["cyan"], bold=True)
    text(draw, (72, 94), title, 46, bold=True)
    if subtitle:
        text(draw, (74, 157), subtitle, 22, COLORS["muted"])


def browser(draw, box, title="ChatGPT", url="chatgpt.com"):
    x1, y1, x2, y2 = box
    rounded(draw, box, 22, "#f6f8fb")
    draw.rounded_rectangle((x1, y1, x2, y1 + 48), 22, fill="#dce4ee")
    draw.rectangle((x1, y1 + 25, x2, y1 + 49), fill="#dce4ee")
    for i, c in enumerate(("#ff6b68", "#ffbd45", "#55ca62")):
        draw.ellipse((x1 + 18 + i * 22, y1 + 17, x1 + 30 + i * 22, y1 + 29), fill=c)
    rounded(draw, (x1 + 120, y1 + 10, x2 - 105, y1 + 39), 12, "#f7f9fc")
    text(draw, ((x1 + x2) // 2, y1 + 25), url, 14, "#66768a", anchor="mm")
    text(draw, (x1 + 24, y1 + 73), title, 22, "#15263a", bold=True)


def pill(draw, xy, label, color):
    x, y = xy
    f = font(17, 1)
    bb = draw.textbbox((0, 0), label, font=f)
    w = bb[2] - bb[0] + 30
    rounded(draw, (x, y, x + w, y + 34), 17, color)
    draw.text((x + w / 2, y + 17), label, font=f, fill="#06101d", anchor="mm")
    return w


def scene_01() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    header(d, "THE PROBLEM", "AI 在思考，人却被困在等待里", "守着浪费时间，切走容易忘记")
    browser(d, (72, 218, 765, 638))
    d.ellipse((340, 316, 470, 446), outline=COLORS["blue"], width=8)
    d.arc((356, 332, 454, 430), 20, 290, fill=COLORS["cyan"], width=8)
    text(d, (405, 466), "AI 正在思考…", 24, "#53677e", anchor="mm", bold=True)
    rounded(d, (818, 234, 1208, 392), 26, COLORS["card"], COLORS["line"], 2)
    text(d, (850, 265), "注意力已经切走", 26, bold=True)
    text(d, (850, 313), "文档  ·  消息  ·  手机", 20, COLORS["muted"])
    rounded(d, (818, 430, 1208, 610), 26, "#2c1b27", "#63354a", 2)
    text(d, (850, 460), "结果早已完成", 26, COLORS["red"], bold=True)
    text(d, (850, 510), "但人没有回来", 32, bold=True)
    return im


def scene_02() -> Image.Image:
    hero_path = ROOT / "design" / "hero.png"
    hero = Image.open(hero_path).convert("RGB").resize((W, H))
    hero = hero.filter(ImageFilter.GaussianBlur(1.2))
    overlay = Image.new("RGBA", (W, H), (3, 10, 20, 155))
    im = Image.alpha_composite(hero.convert("RGBA"), overlay)
    d = ImageDraw.Draw(im)
    rounded(d, (80, 100, 1200, 620), 40, (6, 18, 34, 180), (81, 168, 255, 120), 2)
    icon = Image.open(ROOT / "src/javascript/icon128.png").convert("RGBA").resize((104, 104))
    im.alpha_composite(icon, (588, 165))
    text(d, (640, 324), "回答完就通知", 64, anchor="mm", bold=True)
    text(d, (640, 398), "让等待退出工作流，让人回到决策中", 29, COLORS["cyan"], anchor="mm")
    rounded(d, (450, 468, 830, 523), 27, (81, 168, 255, 235))
    text(d, (640, 496), "AI 完成时，主动找到你", 22, "#07111f", anchor="mm", bold=True)
    return im.convert("RGB")


def scene_03() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    header(d, "HOW IT WORKS", "不改变习惯，只改变等待方式", "提交任务，然后放心去做别的事")
    browser(d, (62, 208, 814, 646))
    rounded(d, (110, 305, 732, 380), 20, "#e9eef4")
    text(d, (136, 330), "请设计一个多 Agent 协作工作流…", 19, "#26384c")
    rounded(d, (504, 405, 732, 458), 24, "#2e8bff")
    text(d, (618, 432), "AI 正在思考…", 18, "white", anchor="mm", bold=True)
    rounded(d, (852, 212, 1218, 646), 30, COLORS["card"], COLORS["line"], 2)
    text(d, (888, 250), "支持平台", 24, bold=True)
    items = [
        ("ChatGPT", "#74d8b0"),
        ("Gemini", "#78a7ff"),
        ("Grok", "#e9eef5"),
        ("AI Studio", "#ffca72"),
    ]
    for i, (name, color) in enumerate(items):
        y = 310 + i * 70
        d.ellipse((888, y, 920, y + 32), fill=color)
        text(d, (942, y + 16), name, 21, anchor="lm", bold=True)
        text(d, (1165, y + 16), "已开启", 16, COLORS["green"], anchor="rm")
    rounded(d, (886, 588, 1184, 620), 16, "#173c49")
    text(d, (1035, 604), "通知 · 声音 · 后台保活", 15, COLORS["cyan"], anchor="mm")
    return im


def scene_04() -> Image.Image:
    im = gradient("#08131f", "#173252")
    d = ImageDraw.Draw(im)
    header(d, "THE MOMENT", "任务真的完成时，把人拉回来", "不是定时器，而是对真实完成状态的识别")
    browser(d, (68, 220, 866, 644), "ChatGPT · 已完成")
    text(d, (112, 316), "多 Agent 协作工作流", 24, "#16283a", bold=True)
    for i, label in enumerate(("研究 Agent", "设计 Agent", "开发 Agent")):
        x = 115 + i * 235
        rounded(d, (x, 375, x + 190, 472), 20, "#e5edf6")
        text(d, (x + 95, 410), label, 18, "#21364c", anchor="mm", bold=True)
        text(d, (x + 95, 447), "✓ 已完成", 16, "#26875d", anchor="mm")
    rounded(d, (650, 525, 816, 574), 22, "#2e8bff")
    text(d, (733, 549), "继续下一步", 17, "white", anchor="mm", bold=True)
    rounded(d, (740, 245, 1218, 408), 28, "#f8fafc", "#d8e2ed", 2)
    icon = Image.open(ROOT / "src/javascript/icon128.png").convert("RGBA").resize((54, 54))
    im.paste(icon, (770, 278), icon)
    text(d, (844, 278), "回答完就通知", 20, "#17283b", bold=True)
    text(d, (844, 314), "请设计一个多 Agent 协作工作流…", 18, "#40546a")
    text(d, (844, 349), "任务已经完成，点击返回对话", 16, "#67798d")
    rounded(d, (1016, 440, 1207, 504), 28, COLORS["blue"])
    text(d, (1111, 472), "点击通知 →", 19, "#07111f", anchor="mm", bold=True)
    text(d, (974, 570), "叮", 66, COLORS["cyan"], anchor="mm", bold=True)
    return im


def scene_05() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    header(d, "CAPABILITIES", "识别关键状态，而不只是等待时间", "文本、长思考、图片与后台任务")
    cards = [
        ("普通回答", "生成结束后准确提醒", COLORS["blue"], "✓"),
        ("长思考", "思考结束可单独提醒", COLORS["cyan"], "◌"),
        ("图片任务", "成功与失败分别识别", COLORS["orange"], "▣"),
        ("后台保活", "减少切走后的任务暂停", COLORS["green"], "∞"),
    ]
    for i, (title, sub, color, symbol) in enumerate(cards):
        x = 72 + (i % 2) * 588
        y = 228 + (i // 2) * 208
        rounded(d, (x, y, x + 540, y + 168), 28, COLORS["card"], COLORS["line"], 2)
        rounded(d, (x + 28, y + 28, x + 94, y + 94), 20, color)
        text(d, (x + 61, y + 61), symbol, 32, "#07111f", anchor="mm", bold=True)
        text(d, (x + 120, y + 35), title, 28, bold=True)
        text(d, (x + 120, y + 83), sub, 20, COLORS["muted"])
        text(d, (x + 120, y + 122), "关键状态已覆盖", 16, color)
    return im


def scene_06() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    header(d, "UNDER THE HOOD", "看起来只是一声“叮”", "背后是跨平台状态识别与可靠性处理")
    nodes = [
        (120, "不同平台", "请求 / SSE / 页面事件", COLORS["blue"]),
        (390, "状态识别", "完成 / 思考 / 图片", COLORS["cyan"]),
        (660, "可靠性", "耗时校验 / 节流 / 保活", COLORS["green"]),
        (930, "通知", "标题 / 声音 / 点击返回", COLORS["orange"]),
    ]
    for i, (x, title, sub, color) in enumerate(nodes):
        rounded(d, (x, 285, x + 230, 485), 28, COLORS["card"], color, 3)
        d.ellipse((x + 83, 315, x + 147, 379), fill=color)
        text(d, (x + 115, 347), str(i + 1), 26, "#07111f", anchor="mm", bold=True)
        text(d, (x + 115, 410), title, 25, anchor="mm", bold=True)
        text(d, (x + 115, 450), sub, 15, COLORS["muted"], anchor="mm")
        if i < 3:
            d.line((x + 235, 385, x + 265, 385), fill=COLORS["muted"], width=3)
            d.polygon(((x + 265, 385), (x + 252, 377), (x + 252, 393)), fill=COLORS["muted"])
    text(d, (640, 570), "减少误报  ·  补齐漏报  ·  后台也可靠", 24, COLORS["cyan"], anchor="mm", bold=True)
    return im


def scene_07() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    header(d, "THE JOURNEY", "从个人小工具，到持续演进的能力", "每一次迭代，都来自一次真实使用中的失败")
    d.line((112, 372, 1170, 372), fill=COLORS["line"], width=5)
    items = [
        (130, "2025.08", "初版通知"),
        (330, "2025.12", "架构重构\n思考检测"),
        (545, "2026.03", "Gemini / Grok\n原始提问"),
        (760, "2026.03", "后台保活"),
        (955, "2026.05", "图片状态\n终端提醒"),
    ]
    colors = [COLORS["blue"], COLORS["cyan"], COLORS["green"], COLORS["orange"], COLORS["red"]]
    for i, (x, date, label) in enumerate(items):
        d.ellipse((x - 15, 357, x + 15, 387), fill=colors[i])
        y = 270 if i % 2 == 0 else 420
        text(d, (x, y), date, 18, colors[i], anchor="mm", bold=True)
        text(d, (x, y + 49), label, 22, anchor="mm", bold=True)
        d.line((x, 350 if i % 2 == 0 else 390, x, 320 if i % 2 == 0 else 414), fill=colors[i], width=2)
    rounded(d, (350, 585, 930, 638), 26, "#163a4b")
    text(d, (640, 611), "“完成”不是一个按钮，而是一组边界条件", 22, COLORS["cyan"], anchor="mm", bold=True)
    return im


def scene_08() -> Image.Image:
    im = gradient("#0c1323", "#242138")
    d = ImageDraw.Draw(im)
    header(d, "JUDGES' FEEDBACK", "评委把问题推向了更深一层", "以下为根据录音整理的评委意见摘要")
    cards = [
        ("现状判断", "单纯的完成通知比较常见，\n差异化需要进一步加强。", COLORS["orange"]),
        ("问题升级", "真正值得探索的是，人应该在\n什么时候重新介入 Agent。", COLORS["cyan"]),
        ("未来方向", "提醒可以成为多工具、多 Agent\n环境下的人类决策入口。", COLORS["green"]),
    ]
    for i, (label, body, color) in enumerate(cards):
        x = 72 + i * 400
        rounded(d, (x, 234, x + 360, 548), 30, COLORS["card"], COLORS["line"], 2)
        pill(d, (x + 28, 266), label, color)
        text(d, (x + 30, 350), body, 24, spacing=16, bold=True)
        d.line((x + 30, 485, x + 330, 485), fill=COLORS["line"], width=2)
        text(d, (x + 30, 504), "黑客松评委意见摘要", 15, COLORS["muted"])
    return im


def scene_09() -> Image.Image:
    im = gradient()
    d = ImageDraw.Draw(im)
    header(d, "WHAT'S NEXT", "从“完成通知”走向“关键节点通知”", "未来设想：让通知成为可以操作的协作界面")
    cards = [
        ("已完成", "查看结果", COLORS["green"], "打开任务"),
        ("需要输入", "Agent 缺少信息", COLORS["blue"], "补充信息"),
        ("等待决策", "需要批准或选择", COLORS["orange"], "批准 / 拒绝"),
        ("执行异常", "失败、卡住或中断", COLORS["red"], "立即接管"),
    ]
    for i, (title, sub, color, action) in enumerate(cards):
        x = 72 + (i % 2) * 588
        y = 220 + (i // 2) * 212
        rounded(d, (x, y, x + 540, y + 174), 28, COLORS["card"], color, 2)
        d.ellipse((x + 28, y + 32, x + 54, y + 58), fill=color)
        text(d, (x + 76, y + 30), title, 26, bold=True)
        text(d, (x + 76, y + 76), sub, 19, COLORS["muted"])
        rounded(d, (x + 330, y + 105, x + 506, y + 151), 22, color)
        text(d, (x + 418, y + 128), action, 17, "#07111f", anchor="mm", bold=True)
    text(d, (1180, 675), "未来设想", 15, COLORS["muted"], anchor="rm")
    return im


def scene_10() -> Image.Image:
    im = gradient("#06101c", "#12365a")
    d = ImageDraw.Draw(im)
    header(d, "THE VISION", "一个人，多个 Agent，一个介入入口", "不必逐个窗口守候，只在真正需要时回来")
    center = (640, 388)
    agents = [
        (270, 288, "研究 Agent", COLORS["blue"]),
        (270, 500, "设计 Agent", COLORS["cyan"]),
        (1010, 288, "开发 Agent", COLORS["green"]),
        (1010, 500, "文档 Agent", COLORS["orange"]),
    ]
    for x, y, label, color in agents:
        d.line((x, y, center[0], center[1]), fill=COLORS["line"], width=4)
        rounded(d, (x - 125, y - 48, x + 125, y + 48), 24, COLORS["card"], color, 2)
        text(d, (x, y), label, 21, anchor="mm", bold=True)
    d.ellipse((535, 283, 745, 493), fill="#173f61", outline=COLORS["cyan"], width=4)
    icon = Image.open(ROOT / "src/javascript/icon128.png").convert("RGBA").resize((82, 82))
    im.paste(icon, (599, 320), icon)
    text(d, (640, 432), "人的介入层", 24, anchor="mm", bold=True)
    text(d, (640, 588), "Agent 需要你时，就通知。", 39, COLORS["cyan"], anchor="mm", bold=True)
    text(d, (640, 646), "回答完就通知", 21, COLORS["muted"], anchor="mm")
    return im


SCENE_BUILDERS = [scene_01, scene_02, scene_03, scene_04, scene_05, scene_06, scene_07, scene_08, scene_09, scene_10]


def run(args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True)


def ffprobe_duration(ffprobe: Path, path: Path) -> float:
    out = subprocess.check_output(
        [str(ffprobe), "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        text=True,
    )
    return float(out.strip())


def srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def locate_ffmpeg() -> tuple[Path, Path | None]:
    exe = os.environ.get("IMAGEIO_FFMPEG_EXE")
    if exe:
        ffmpeg = Path(exe)
    else:
        try:
            import imageio_ffmpeg  # type: ignore

            ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
        except ImportError as exc:
            raise SystemExit("缺少 imageio-ffmpeg，请先安装：python3 -m pip install imageio-ffmpeg") from exc
    ffprobe = ffmpeg.with_name("ffprobe")
    if not ffprobe.exists():
        system_ffprobe = shutil.which("ffprobe")
        if system_ffprobe:
            ffprobe = Path(system_ffprobe)
        else:
            # imageio 的单文件 ffmpeg 包通常不带 ffprobe，使用 ffmpeg 自身解析时长的备用逻辑。
            ffprobe = None
    return ffmpeg, ffprobe


def audio_duration(ffmpeg: Path, ffprobe: Path | None, path: Path) -> float:
    if ffprobe is not None:
        return ffprobe_duration(ffprobe, path)
    proc = subprocess.run([str(ffmpeg), "-i", str(path)], text=True, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL)
    import re

    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", proc.stderr)
    if not m:
        raise RuntimeError(f"无法读取音频时长：{path}")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg, ffprobe = locate_ffmpeg()

    narration = (VIDEO_DIR / "narration-scenes.txt").read_text(encoding="utf-8")
    scenes = [part.strip().replace("\n", " ") for part in narration.split("\n\n") if part.strip()]
    if len(scenes) != len(SCENE_BUILDERS):
        raise SystemExit(f"旁白段落数 {len(scenes)} 与场景数 {len(SCENE_BUILDERS)} 不一致")

    segment_paths = []
    durations = []
    srt_lines = []
    cursor = 0.0

    for idx, (builder, narration_text) in enumerate(zip(SCENE_BUILDERS, scenes), start=1):
        png = BUILD_DIR / f"scene-{idx:02}.png"
        audio = BUILD_DIR / f"scene-{idx:02}.aiff"
        segment = BUILD_DIR / f"scene-{idx:02}.mp4"
        builder().save(png, quality=95)
        run(["say", "-v", "Tingting", "-r", "165", "-o", audio, narration_text])
        duration = audio_duration(ffmpeg, ffprobe, audio) + 1.0
        durations.append(duration)
        frames = max(1, math.ceil(duration * 30))
        fade_out = max(0.0, duration - 0.45)
        vf = (
            f"scale=1320:742,zoompan=z='min(zoom+0.00012,1.035)':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1280x720:fps=30,"
            f"fade=t=in:st=0:d=0.35,fade=t=out:st={fade_out:.3f}:d=0.35,format=yuv420p"
        )
        run([
            ffmpeg, "-y", "-loop", "1", "-i", png, "-i", audio,
            "-vf", vf, "-af", "afade=t=in:st=0:d=0.2,apad=pad_dur=1",
            "-t", f"{duration:.3f}", "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", segment,
        ])
        segment_paths.append(segment)
        chunks = subtitle_chunks(narration_text)
        available = duration - 0.65
        weights = [max(8, len(chunk)) for chunk in chunks]
        weight_total = sum(weights)
        cue_cursor = cursor + 0.15
        for chunk, weight in zip(chunks, weights):
            cue_duration = available * weight / weight_total
            cue_end = cue_cursor + cue_duration
            srt_lines.extend([
                str(len([line for line in srt_lines if line.isdigit()]) + 1),
                f"{srt_time(cue_cursor)} --> {srt_time(cue_end)}",
                wrap_zh(chunk, 17),
                "",
            ])
            cue_cursor = cue_end
        cursor += duration

    concat_file = BUILD_DIR / "concat.txt"
    concat_file.write_text("".join(f"file '{p.as_posix()}'\n" for p in segment_paths), encoding="utf-8")
    base_video = BUILD_DIR / "showcase-base.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", concat_file, "-c", "copy", base_video])

    srt_path = OUTPUT_DIR / "回答完就通知-概念演示版.srt"
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

    # 在通知出现的场景开头叠加项目真实提示音。
    notification_at_ms = round(sum(durations[:3]) * 1000 + 1200)
    sound = ROOT / "src/javascript/audio/streaming-complete.mp3"
    mixed_video = BUILD_DIR / "showcase-mixed.mp4"
    run([
        ffmpeg, "-y", "-i", base_video, "-i", sound,
        "-filter_complex", f"[1:a]volume=0.85,adelay={notification_at_ms}|{notification_at_ms}[ding];[0:a][ding]amix=inputs=2:duration=first:dropout_transition=0[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", mixed_video,
    ])

    final_video = OUTPUT_DIR / "回答完就通知-项目展示-概念演示版.mp4"
    subtitle_filter = f"subtitles='{srt_path.as_posix()}':force_style='FontName=PingFang SC,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H99000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=18'"
    try:
        run([
            ffmpeg, "-y", "-i", mixed_video, "-vf", subtitle_filter,
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", final_video,
        ])
    except subprocess.CalledProcessError:
        # 某些精简 ffmpeg 不含 libass；仍交付无内嵌字幕版本与独立 SRT。
        shutil.copy2(mixed_video, final_video)
        print("警告：当前 ffmpeg 不支持烧录字幕，已输出视频和独立 SRT。", file=sys.stderr)

    print(f"\n完成：{final_video}")
    print(f"字幕：{srt_path}")
    print(f"时长：{sum(durations):.1f} 秒")


if __name__ == "__main__":
    main()
