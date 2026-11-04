"""Рисует грани особого кубика «ВИТРУВИЯ».

Символ успеха: четыре гранёных лепестка, сходящихся в центре (по мотивам фото кубиков).
Цвета взяты с vitruvium.ru: тёмный #0D0D0D/#171719, кремовый #FFF0E0, тень лепестка #E8D6C3.

Выход:
  system/assets/dice/face-{0,1,2}.svg            значки граней для чата и листа
  modules/vitruvium-dice/textures/label-{0,1,2}.svg  метки граней для Dice So Nice (прозрачный фон)
  modules/vitruvium-dice/textures/bump-{0,1,2}.svg   карты рельефа (белый символ на чёрном)
PNG-версии меток делает tools/render-dice-png.mjs.
"""
import math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BODY, BODY2 = "#0D0D0D", "#1D1E20"
LIGHT, SHADE = "#FFF0E0", "#E8D6C3"
ENGRAVE_L, ENGRAVE_D = "#2B2B2E", "#171719"

def petal(cx, cy, L, w, angle, light, shade):
    a = math.radians(angle)
    def rot(x, y):
        return (cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a))
    c = rot(0, 0); tip = rot(0, -L); r = rot(w, -L * 0.5); l = rot(-w, -L * 0.5)
    f = lambda p: f"{p[0]:.2f},{p[1]:.2f}"
    return (f'<polygon points="{f(c)} {f(l)} {f(tip)}" fill="{light}"/>'
            f'<polygon points="{f(c)} {f(tip)} {f(r)}" fill="{shade}"/>')

def star(cx, cy, size, light=LIGHT, shade=SHADE):
    L, w = size, size * 0.36
    return "".join(petal(cx, cy, L, w, ang, light, shade) for ang in (45, 135, 225, 315))

def symbols(n, S, light=LIGHT, shade=SHADE):
    if n == 0:
        return ""
    if n == 1:
        return star(S / 2, S / 2, S * 0.40, light, shade)
    d = S * 0.18
    return star(S / 2 - d, S / 2 - d, S * 0.22, light, shade) + star(S / 2 + d, S / 2 + d, S * 0.22, light, shade)

def face_svg(n):
    S = 64
    inner = symbols(n, S) if n else star(S / 2, S / 2, S * 0.40, ENGRAVE_L, ENGRAVE_D)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BODY2}"/><stop offset="1" stop-color="{BODY}"/></linearGradient></defs>'
            f'<rect x="1.5" y="1.5" width="{S-3}" height="{S-3}" rx="11" fill="url(#g)" stroke="#FFF0E0" stroke-opacity=".18" stroke-width="1.5"/>'
            f'{inner}</svg>')

def label_svg(n):
    S = 256
    inner = symbols(n, S) if n else star(S / 2, S / 2, S * 0.40, ENGRAVE_L, ENGRAVE_D)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">{inner}</svg>'

def bump_svg(n):
    S = 256
    inner = symbols(n, S, "#FFFFFF", "#BBBBBB") if n else star(S / 2, S / 2, S * 0.40, "#555555", "#444444")
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}"><rect width="{S}" height="{S}" fill="#000"/>{inner}</svg>'

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        fh.write(text)

for n in (0, 1, 2):
    write(f"{ROOT}/system/assets/dice/face-{n}.svg", face_svg(n))
    write(f"{ROOT}/modules/vitruvium-dice/textures/label-{n}.svg", label_svg(n))
    write(f"{ROOT}/modules/vitruvium-dice/textures/bump-{n}.svg", bump_svg(n))
print("ok")
