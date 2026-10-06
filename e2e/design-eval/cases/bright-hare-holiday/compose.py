"""Compose the flat-raster source poster from the generated photo.

The layout deliberately repeats the defects of the private case it twins:
an oversized subject, a headline crowding the face and held cup, a cramped
footer and a third-party watermark. Usage:

    python3 compose.py <NotoSansSC[wght].ttf>
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).parent
W, H = 1126, 1500
FONT = sys.argv[1]
WHITE, NAVY, GREY = (255, 255, 255), (22, 44, 96), (120, 128, 140)


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    face.set_variation_by_axes([weight])
    return face


photo = Image.open(HERE / "media/photo.png").convert("RGB")
photo = photo.resize((round(photo.width * H / photo.height), H), Image.LANCZOS)
canvas = Image.new("RGB", (W, H))
canvas.paste(photo, (0, 0))
strip = photo.crop((photo.width - (W - photo.width), 0, photo.width, H))
canvas.paste(ImageOps.mirror(strip), (photo.width, 0))
draw = ImageDraw.Draw(canvas, "RGBA")

draw.ellipse((52, 44, 112, 104), fill=WHITE)
draw.text((82, 74), "兔", font=font(36, 800), fill=NAVY, anchor="mm")
draw.text((126, 74), "亮兔咖啡 BRIGHT HARE", font=font(34, 700), fill=WHITE, anchor="lm")

draw.text((712, 150), "假期快乐！", font=font(70, 800), fill=WHITE)
draw.text((728, 236), "一起喝", font=font(124, 900), fill=WHITE)
draw.text((728, 386), "小椰乳", font=font(124, 900), fill=WHITE)

draw.text((830, 650), "BRIGHT HARE", font=font(32, 800), fill=WHITE)
draw.text((830, 696), "亮兔咖啡品牌代言人", font=font(22, 500), fill=WHITE)
draw.text((870, 730), "林知夏", font=font(34, 700), fill=WHITE)

for x, y, label in ((8, 1030, "小椰乳拿铁"), (440, 1120, "小椰乳美式")):
    draw.rectangle((x, y, x + 40, y + 34 * len(label) + 12), fill=NAVY)
    for i, char in enumerate(label):
        draw.text((x + 20, y + 23 + 34 * i), char, font=font(28, 700), fill=WHITE, anchor="mm")

draw.rectangle((560, 1330, W, 1468), fill=(252, 251, 248))
draw.text((580, 1350), "含海南椰乳*，满杯清甜椰香", font=font(38, 700), fill=(30, 30, 30))
draw.text((580, 1408), "*冰块减半隐藏喝法，口感加倍顺滑", font=font(22, 400), fill=(70, 70, 70))
draw.rectangle((0, 1468, W, H), fill=(252, 251, 248))
draw.text(
    (14, 1484),
    "*饮品添加椰乳风味奶（含海南椰乳）。产品图片及包装仅供参考。门店供应产品类型及详情，请见亮兔咖啡App/小程序。",
    font=font(13, 400),
    fill=GREY,
    anchor="lm",
)
draw.text((1100, 1300), "SnapNote号: 10000001", font=font(24, 500), fill=(160, 160, 160, 150), anchor="rm")

canvas.save(HERE / "media/source.png", optimize=True)
