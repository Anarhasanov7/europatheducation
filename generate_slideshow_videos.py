#!/usr/bin/env python3
"""
Generate branded slideshow videos for EuroPath Education social media.
Each video is a series of slides (1080x1080 for feed, 1080x1920 for stories)
that auto-advance every 4 seconds with smooth transitions.

Output: MP4 videos ready for Instagram/Threads/Facebook.
"""

import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

# Brand colors
NAVY_DARK = "#0b1e3f"
NAVY_LIGHT = "#16213e"
GOLD = "#c9a84c"
WHITE = "#ffffff"
GRAY_LIGHT = "#a0a8b0"

# Dimensions
FEED_W, FEED_H = 1080, 1080
STORY_W, STORY_H = 1080, 1920

# Fonts
def get_font(size, bold=True):
    paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except:
                pass
    return ImageFont.load_default()

def wrap_text(draw, text, font, max_width):
    """Word-wrap text to fit within max_width."""
    words = text.split(' ')
    lines = []
    current = ''
    for word in words:
        test = (current + ' ' + word).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(current)
            current = word
        else:
            current = test
    if current:
        lines.append(current)
    return lines

def draw_slide(width, height, slides_data, current_idx, total_slides):
    """Draw a single slide frame."""
    img = Image.new('RGB', (width, height), NAVY_DARK)
    draw = ImageDraw.Draw(img)

    # Gradient background
    for y in range(height):
        ratio = y / height
        r1, g1, b1 = 0x0b, 0x1e, 0x3f
        r2, g2, b2 = 0x16, 0x21, 0x3e
        r = int(r1 + (r2 - r1) * ratio)
        g = int(g1 + (g2 - g1) * ratio)
        b = int(b1 + (b2 - b1) * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    # Gold accent bars
    bar_h = 6 if height == 1080 else 8
    draw.rectangle([0, 0, width, bar_h], fill=GOLD)
    draw.rectangle([0, height - bar_h, width, height], fill=GOLD)

    # Logo text (top)
    logo_font = get_font(36 if height == 1080 else 40)
    draw.text((width // 2, 80 if height == 1080 else 120), "EUROPATH EDUCATION",
              fill=GOLD, font=logo_font, anchor="mm")

    # Decorative line under logo
    line_y = 100 if height == 1080 else 145
    draw.line([(width // 2 - 160, line_y), (width // 2 + 160, line_y)],
              fill=GOLD, width=2)

    slide = slides_data[current_idx]
    cy = height // 2

    # Slide number badge
    badge_font = get_font(28)
    badge_text = f"{current_idx + 1}/{total_slides}"
    draw.text((width // 2, cy - 200), badge_text, fill=GRAY_LIGHT, font=badge_font, anchor="mm")

    # Slide title
    title_font = get_font(52 if height == 1080 else 58)
    title_lines = wrap_text(draw, slide['title'], title_font, width - 160)
    title_y = cy - 140
    for line in title_lines[:3]:
        draw.text((width // 2, title_y), line, fill=GOLD, font=title_font, anchor="mm")
        title_y += 65

    # Slide body text
    body_font = get_font(36 if height == 1080 else 42, bold=False)
    body_lines = wrap_text(draw, slide['body'], body_font, width - 180)
    body_y = title_y + 30
    for line in body_lines[:8]:
        draw.text((width // 2, body_y), line, fill=WHITE, font=body_font, anchor="mm")
        body_y += 50

    # Progress dots at bottom
    dot_y = height - 80
    dot_spacing = 24
    total_dots_width = (total_slides - 1) * dot_spacing
    start_x = width // 2 - total_dots_width // 2
    for i in range(total_slides):
        x = start_x + i * dot_spacing
        if i == current_idx:
            draw.ellipse([x - 8, dot_y - 8, x + 8, dot_y + 8], fill=GOLD)
        else:
            draw.ellipse([x - 5, dot_y - 5, x + 5, dot_y + 5], fill=(80, 80, 90))

    # Handle @username at bottom
    handle_font = get_font(28 if height == 1080 else 32)
    draw.text((width // 2, height - 45 if height == 1080 else height - 55),
              "@study.with.anar  ·  @europath_education",
              fill=GOLD, font=handle_font, anchor="mm")

    return img

def create_slideshow_video(slides_data, output_path, width=1080, height=1080,
                           slide_duration=4, fps=30, transition_frames=15):
    """Create a slideshow video from slide data."""
    total_slides = len(slides_data)
    frames_per_slide = slide_duration * fps
    total_frames = total_slides * frames_per_slide

    print(f"  Generating {total_frames} frames ({total_slides} slides × {slide_duration}s)...")

    with tempfile.TemporaryDirectory() as tmpdir:
        frame_files = []

        for slide_idx in range(total_slides):
            # Generate the slide image once
            slide_img = draw_slide(width, height, slides_data, slide_idx, total_slides)

            for f in range(frames_per_slide):
                # Fade in at start, fade out at end
                alpha = 1.0
                if f < transition_frames:
                    alpha = f / transition_frames
                elif f > frames_per_slide - transition_frames:
                    alpha = (frames_per_slide - f) / transition_frames

                if alpha < 1.0:
                    # Create a dark overlay for fade effect
                    frame = slide_img.copy()
                    overlay = Image.new('RGB', (width, height), NAVY_DARK)
                    # Blend
                    frame = Image.blend(overlay, slide_img, alpha)
                else:
                    frame = slide_img.copy()

                frame_path = os.path.join(tmpdir, f"frame_{slide_idx * frames_per_slide + f:05d}.png")
                frame.save(frame_path, 'PNG')
                frame_files.append(frame_path)

        # Use ffmpeg to create video from frames
        print(f"  Encoding video with ffmpeg...")
        cmd = [
            'ffmpeg', '-y', '-framerate', str(fps),
            '-i', os.path.join(tmpdir, 'frame_%05d.png'),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-crf', '23', '-preset', 'fast',
            '-movflags', '+faststart',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  ffmpeg error: {result.stderr[:500]}")
            return False

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  ✅ Created: {output_path} ({size_mb:.1f} MB)")
    return True


# ═══════════════════════════════════════════════════════════════
# SLIDESHOW CONTENT — Educational carousel videos
# ═══════════════════════════════════════════════════════════════

SLIDESHOWS = [
    {
        "filename": "slideshow_5_steps_italy",
        "caption": "5 шагов, чтобы учиться в Италии бесплатно 🇮🇹\n\n1️⃣ Выбери программу\n2️⃣ Подай документы\n3️⃣ Получи зачисление\n4️⃣ Оформи визу\n5️⃣ Подай на DSU стипендию\n\nСохрани, чтобы не потерять! Напиши в ДМ слово ИТАЛИЯ — пришлю полный гайд.",
        "slides": [
            {"title": "5 шагов", "body": "чтобы учиться в Италии бесплатно"},
            {"title": "Шаг 1", "body": "Выбери программу на universitaly.it — 350+ программ на английском"},
            {"title": "Шаг 2", "body": "Подай документы до дедлайна — мотивационное письмо, диплом, сертификат языка"},
            {"title": "Шаг 3", "body": "Получи зачисление — Letter of Acceptance от университета"},
            {"title": "Шаг 4", "body": "Оформи визу типа D в консульстве — паспорт, зачисление, страховка, финансы"},
            {"title": "Шаг 5", "body": "Подай на DSU стипендию — обучение, общежитие и €6 800 в год бесплатно"},
            {"title": "Готово!", "body": "Напиши в ДМ слово ИТАЛИЯ — поможем бесплатно"},
        ],
    },
    {
        "filename": "slideshow_top_universities",
        "caption": "Топ-5 университетов Италии для казахстанцев 🎓\n\nКаждый из них принимает с DSU стипендией — обучение бесплатно.\n\nНапиши в ДМ — проверим твои шансы на поступление.",
        "slides": [
            {"title": "Топ-5", "body": "университетов Италии"},
            {"title": "Sapienza", "body": "Рим · 1303 год · Крупнейший в Европе · Медицина, экономика, инженерия"},
            {"title": "Politecnico", "body": "Милан · Инженерия и архитектура · Топ-1 в Италии по техническим наукам"},
            {"title": "Bologna", "body": "Болонья · 1088 год · Старейший университет Европы · Все направления"},
            {"title": "Padova", "body": "Падуя · 1222 год · Медицина, астрономия, физика · Галилей преподавал здесь"},
            {"title": "Bocconi", "body": "Милан · Экономика и финансы · Топ-5 в Европе по бизнес-образованию"},
            {"title": "Твой ход", "body": "Напиши в ДМ — проверим шансы на стипендию"},
        ],
    },
    {
        "filename": "slideshow_dsu_scholarship",
        "caption": "DSU стипендия — как учиться бесплатно в Италии 💰\n\nНе нужен высокий балл. Не нужно портфолио. Нужно одно — доход семьи ниже порога.\n\nНапиши в ДМ — прикинем твои шансы.",
        "slides": [
            {"title": "DSU", "body": "Региональная стипендия Италии"},
            {"title": "Что даёт?", "body": "Обучение — бесплатно\nОбщежитие — бесплатно\nПитание — бесплатно\n€6 800 в год — на руки"},
            {"title": "Кто может?", "body": "Любой студент, зачисленный в итальянский университет\nГражданство не важно"},
            {"title": "Главное", "body": "Доход семьи ниже ~€24 000 в год\nДоказать документами: ISEE сертификат"},
            {"title": "Не нужно", "body": "Высокий средний балл\nПортфолио\nОлимпиады\nРекомендации"},
            {"title": "Сроки", "body": "Подача: весна каждого года\nРешение: июль-сентябрь\nНачало: с первого курса"},
            {"title": "Важно", "body": "Агентства не говорят о DSU\nПотому что если знаешь — агентство не нужно\nНапиши в ДМ — помогу бесплатно"},
        ],
    },
    {
        "filename": "slideshow_visa_checklist",
        "caption": "Виза типа D — чеклист документов 📋\n\nПодавай в мае, даже если зачисление ещё не пришло — по предзачислению.\n\nНапиши в ДМ — пришлю полный гайд по визе.",
        "slides": [
            {"title": "Виза D", "body": "Чеклист документов для учебы в Италии"},
            {"title": "1. Паспорт", "body": "Действительный минимум 3 месяца после окончания визы"},
            {"title": "2. Зачисление", "body": "Letter of Acceptance или предзачисление от университета"},
            {"title": "3. Страховка", "body": "Медицинская страховка на минимум €30 000 покрытия"},
            {"title": "4. Финансы", "body": "Выписка со счёта — минимум €6 000 на год\nИли спонсорское письмо + выписка спонсора"},
            {"title": "5. Жильё", "body": "Договор аренды или подтверждение общежития на первый год"},
            {"title": "6. Анкета", "body": "Visa D application form + 2 фото 3.5×4.5 см\nПодача в консульстве Италии"},
            {"title": "Срок", "body": "30-90 дней\nПодавай в мае!\nНе жди августа"},
            {"title": "Готово", "body": "Напиши в ДМ — пришлю полный гайд"},
        ],
    },
]


def main():
    output_dir = "/tmp/europatheducation/slideshow-videos"
    os.makedirs(output_dir, exist_ok=True)

    for slideshow in SLIDESHOWS:
        print(f"\n{'='*60}")
        print(f"Creating: {slideshow['filename']}")
        print(f"  Slides: {len(slideshow['slides'])}")
        print(f"  Caption: {slideshow['caption'][:60]}...")

        # Feed version (1080x1080)
        feed_path = os.path.join(output_dir, f"{slideshow['filename']}_feed.mp4")
        print(f"\n  📐 Feed version (1080x1080):")
        create_slideshow_video(slideshow['slides'], feed_path, FEED_W, FEED_H, slide_duration=4)

        # Story version (1080x1920)
        story_path = os.path.join(output_dir, f"{slideshow['filename']}_story.mp4")
        print(f"\n  📐 Story version (1080x1920):")
        create_slideshow_video(slideshow['slides'], story_path, STORY_W, STORY_H, slide_duration=4)

        # Save caption
        caption_path = os.path.join(output_dir, f"{slideshow['filename']}_caption.txt")
        with open(caption_path, 'w') as f:
            f.write(slideshow['caption'])

    print(f"\n{'='*60}")
    print(f"✅ All videos created in: {output_dir}")
    print(f"   {len(SLIDESHOWS)} slideshows × 2 formats = {len(SLIDESHOWS)*2} videos")

    # List all files
    for f in sorted(os.listdir(output_dir)):
        size = os.path.getsize(os.path.join(output_dir, f))
        if size > 1024 * 1024:
            print(f"   {f}  ({size/(1024*1024):.1f} MB)")
        else:
            print(f"   {f}  ({size/1024:.0f} KB)")


if __name__ == '__main__':
    main()
