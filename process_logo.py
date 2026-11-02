"""Gera as variações da logo a partir de web/assets/logo-original.png.

Uso (precisa do Pillow: python -m pip install pillow):

    python process_logo.py

Saídas em web/assets/: logo.png (emblema branco 256×256, usado no app e nos
PDFs), logo-full.png (emblema + texto, branco) e logo-full-gold.png (dourado).
Os ícones do app (favicon, icon-192, icon-512) são independentes e não mudam.
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Falta o Pillow. Instale com: python -m pip install pillow")
    sys.exit(2)

ASSETS = Path(__file__).resolve().parent / "web" / "assets"
SRC = ASSETS / "logo-original.png"

gray = Image.open(SRC).convert("L")
W, H = gray.size


def acurve(v: int) -> int:
    """Fundo claro vira transparente; traço escuro vira opaco (antialiasing só na borda)."""
    if v >= 205:
        return 0
    if v <= 120:
        return 255
    return int((205 - v) * 255 / 85)


alpha = gray.point(acurve)


def tint(rgb: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (W, H), rgb + (255,))
    img.putalpha(alpha)
    return img


white_full = tint((255, 255, 255))
gold_full = tint((245, 180, 0))

# recorta só o emblema circular (sem o texto): procura a faixa vazia entre os dois
a = alpha.load()
row_counts = [sum(1 for x in range(0, W, 3) if a[x, y] > 30) for y in range(H)]
start = int(H * 0.55)
cut = int(H * 0.72)
gap = 0
for y in range(start, H):
    if row_counts[y] <= 1:
        gap += 1
        if gap >= 8:
            cut = y - gap + 1
            break
    else:
        gap = 0

emblem = white_full.crop(white_full.crop((0, 0, W, cut)).getbbox())
ew, eh = emblem.size
side = max(ew, eh)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(emblem, ((side - ew) // 2, (side - eh) // 2), emblem)
square.resize((256, 256), Image.LANCZOS).save(ASSETS / "logo.png")

scale = 440.0 / max(W, H)
size = (int(W * scale), int(H * scale))
white_full.resize(size, Image.LANCZOS).save(ASSETS / "logo-full.png")
gold_full.resize(size, Image.LANCZOS).save(ASSETS / "logo-full-gold.png")

print(f"Pronto: logos atualizadas em {ASSETS}")
