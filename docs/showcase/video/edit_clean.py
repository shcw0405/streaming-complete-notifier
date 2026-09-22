#!/usr/bin/env python3
"""生成方便老师配音、加字幕的高清静音剪辑版和独立镜头。"""
import json
import re
import subprocess
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
BUILD = HERE / 'build/clean'
OUT = HERE / 'output'
FFMPEG = '/Users/caixu/Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1'

def run(args):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)

def duration(file):
    p = subprocess.run([FFMPEG, '-hide_banner', '-i', str(file)], capture_output=True, text=True)
    h, m, s = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', p.stderr).groups()
    return int(h)*3600 + int(m)*60 + float(s)

def main():
    records = json.loads((BUILD / 'recordings.json').read_text())
    clips, lengths = [], []
    names = ['01-常用提醒设置', '02-插件完整管理', '03-编程工具接入与恢复']
    chapters = OUT / '回响-无声分镜素材'; chapters.mkdir(parents=True, exist_ok=True)
    for record, name in zip(records, names):
        source = Path(record['file']); seconds = round((duration(source) - 2.0)*30)/30
        target = chapters / (name + '.mp4')
        run(['-ss', '1.5', '-i', source, '-t', seconds, '-vf', 'fps=30,scale=1600:900:flags=lanczos,pad=1920:1080:160:40:color=0xedf1e9,setsar=1,format=yuv420p', '-an', '-sn', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-threads', '4', '-movflags', '+faststart', target])
        clips.append(target); lengths.append(seconds)
        print('已导出镜头：', name, seconds, flush=True)
    overlap = .6; offset1 = lengths[0] - overlap; offset2 = sum(lengths[:2]) - 2*overlap
    total = sum(lengths) - 2*overlap
    final = OUT / '回响-优化演示版-1080p无字幕无声.mp4'
    filters = f'[0:v][1:v]xfade=transition=fade:duration={overlap}:offset={offset1}[a];[a][2:v]xfade=transition=fade:duration={overlap}:offset={offset2},fade=t=in:st=0:d=0.5,fade=t=out:st={total-0.8}:d=0.8,format=yuv420p[v]'
    run(['-i', clips[0], '-i', clips[1], '-i', clips[2], '-filter_complex_threads', '1', '-filter_complex', filters, '-map', '[v]', '-an', '-sn', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-threads', '4', '-r', '30', '-movflags', '+faststart', final])
    sheet = Image.new('RGB', (960, 810), '#edf1e9'); draw = ImageDraw.Draw(sheet)
    for i, t in enumerate([3, offset1+3, offset2+7, offset2+19, offset2+33, total-9]):
        frame = BUILD / f'check-{i}.png'; run(['-ss', t, '-i', final, '-frames:v', '1', frame])
        with Image.open(frame) as im: sheet.paste(im.resize((480,270)), ((i%2)*480,(i//2)*270))
    sheet.save(BUILD / 'contact-sheet.jpg')
    (OUT / '给老师-剪辑说明.md').write_text(f'''# 回响视频后期交接

## 主视频

`回响-优化演示版-1080p无字幕无声.mp4`：1920×1080、30 fps、H.264，约 {total:.1f} 秒。无音频轨道，无字幕轨道，也没有烧录解说字幕。保留真实软件界面的按钮、说明和配置预览文字。画面底部约 140 像素留作后期字幕区域。

这是当前产品的实际界面操作录制，不是 AI 对话或系统通知实况：配置接入、恢复和保存使用隔离演示目录及真实后端执行；浏览器账号和用户原配置没有入镜。开头使用居中放大的真实扩展弹窗，鼠标圆点为录制辅助标记。片中不包含虚构的 AI 回答、评委评价或未来功能。

## 镜头顺序（可按旁白自由调整）

- 0–{offset1:.1f} 秒：扩展常用开关、音量。
- {offset1:.1f}–{offset2:.1f} 秒：完整插件管理页与高级提醒设置。
- {offset2:.1f}–{total:.1f} 秒：统一工作台；Claude Code、Codex、OpenCode 配置预览与接入；共同偏好；恢复原配置。

`回响-无声分镜素材/` 提供三段独立 MP4，未加字幕和音频，便于延长停留、调整顺序或另配讲稿。当前成片无配乐和提示音，老师可自由添加。

## 旧版同时间轴备用

`回答完就通知-原版同时间轴-无字幕无声.mp4` 来自旧版烧字幕之前的原始画面，不是裁掉字幕区域，因此没有残留遮挡，也没有丢失底部画面。保留原片节奏与画面中的标题、评委摘要和概念说明，但去掉旁白、提示音及解说字幕。旧片是概念演示，其未来设想不代表已经实现。若需沿用旧讲解稿，请使用这个版本。

原视频、旧 SRT 均保留在原路径，没有覆盖。
''', encoding='utf-8')
    with zipfile.ZipFile(OUT / '回响-老师后期素材包.zip', 'w', zipfile.ZIP_STORED) as bundle:
        for file in [final, OUT / '回答完就通知-原版同时间轴-无字幕无声.mp4', OUT / '给老师-剪辑说明.md', *clips]:
            bundle.write(file, str(file.relative_to(OUT)))
    print('完成：', final, '时长', total, flush=True)

if __name__ == '__main__': main()
