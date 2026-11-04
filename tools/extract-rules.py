"""Собирает журнал «Правила «ВИТРУВИЙ»» для компендиума из страницы правил Ultra.

Текст правил Beta 3.1 переносится дословно. Убираются только элементы оформления
страницы (иконки, классы, кнопки). Пояснения к терминам из оригинала (всплывающие
заметки) сохраняются как подсказки data-tooltip.

Запуск: python3 tools/extract-rules.py <путь к _Ultra/src/page.html>
Выход: system/packs/_source/rules/*.json
"""
import json, os, re, sys, hashlib
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/_Ultra/src/page.html"
OUT = os.path.join(ROOT, "system/packs/_source/rules")

raw = open(SRC, encoding="utf8").read()
notes = json.loads(re.search(r"const NOTES=(\{.*?\});", raw, re.S).group(1))
soup = BeautifulSoup(raw, "html.parser")

def fid(*parts):
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]

def clean(node):
    """Возвращает HTML узла без классов и служебных атрибутов."""
    for sv in node.find_all("svg"):
        sv.decompose()
    for span in node.select("span.ic"):
        span.decompose()
    for term in node.select("span.term"):
        n = notes.get(term.get("data-n"))
        new = soup.new_tag("span")
        new.string = term.get_text()
        if n:
            new["data-tooltip"] = f"{n[0]}. {n[1]}" if n[0].lower() != term.get_text().lower() else n[1]
        term.replace_with(new)
    tags = node.find_all(True) + ([node] if getattr(node, "attrs", None) is not None else [])
    for tag in tags:
        keep = {k: v for k, v in tag.attrs.items() if k in ("href", "data-tooltip")}
        tag.attrs = keep
    return node

def section_html(section):
    parts = []
    wrap = section.select_one(".wrap")
    for child in wrap.find_all(recursive=False):
        cls = child.get("class") or []
        if "eyebrow" in cls or child.name == "h2" or "cta" in cls:
            continue
        if "row" in cls:
            h = child.find("h3")
            parts.append(f"<h3>{h.get_text().strip()}</h3>")
            body = child.find("div")
            # Блок характеристик: иконки убираем, названия и пояснения оставляем.
            for ch in body.select(".chars .char"):
                name = ch.find("h4").get_text().strip()
                desc = ch.find("p").get_text().strip()
                p = soup.new_tag("p")
                b = soup.new_tag("strong"); b.string = name
                p.append(b); p.append(" " + desc)
                ch.replace_with(p)
            for lvl in body.select(".lvl .card"):
                pass
            parts.append("".join(str(clean(x)) for x in body.contents if str(x).strip()))
        elif child.name == "ol" and "steps" in cls:
            for li in child.find_all("li", recursive=False):
                h = li.select_one(".h").get_text().strip()
                parts.append(f"<h3>{h}</h3>")
                b = li.select_one(".b")
                for card in b.select(".lvl .card"):
                    name = card.find("h4").get_text().strip()
                    n = card.select_one(".n").get_text().strip()
                    desc = card.find("p").get_text().strip()
                    p = soup.new_tag("p")
                    st = soup.new_tag("strong"); st.string = f"{name} {n}"
                    p.append(st); p.append(" " + desc)
                    card.replace_with(p)
                for d in b.select(".lvl"):
                    d.unwrap()
                parts.append("".join(str(clean(x)) for x in b.contents if str(x).strip()))
        else:
            parts.append(str(clean(child)))
    html = "\n".join(parts)
    html = re.sub(r"<div>\s*</div>", "", html)
    html = re.sub(r"</?div[^>]*>", "", html)
    return html

pages = []
for sec_id, title in [("game", "ИГРОВЫЕ ПРАВИЛА"), ("character", "ПЕРСОНАЖ"), ("create", "СОЗДАНИЕ ПЕРСОНАЖА"), ("gm", "ВЕДЕНИЕ ИГРЫ")]:
    sec = soup.find("section", id=sec_id)
    pages.append((title, section_html(sec)))

# Авторство
cred = soup.select_one("dl.credits")
rows = []
for dt, dd in zip(cred.find_all("dt"), cred.find_all("dd")):
    rows.append(f"<p><strong>{dt.get_text().strip()}:</strong> {dd.get_text().strip()}</p>")
rows.append("<p><em>*Настоящая версия системы находится на этапе открытого тестирования и разрешена к распространению третьим лицам</em></p>")
rows.append('<p>Источник: <a href="https://vitruvium.ru/rules">vitruvium.ru/rules</a></p>')
pages.append(("Автор системы «ВИТРУВИЙ»: Георгий Воронин", "\n".join(rows)))

entry_id = fid("rules-entry")
doc = {
    "_id": entry_id,
    "_key": f"!journal!{entry_id}",
    "name": "«ВИТРУВИЙ»: игровые правила",
    "folder": None,
    "sort": 0,
    "ownership": {"default": 2},
    "flags": {"vitruvium": {"main": True}},
    "pages": []
}
for i, (title, html) in enumerate(pages):
    pid = fid("rules-page", str(i))
    doc["pages"].append({
        "_id": pid,
        "_key": f"!journal.pages!{entry_id}.{pid}",
        "name": title,
        "type": "text",
        "title": {"show": True, "level": 1},
        "text": {"format": 1, "content": html},
        "sort": (i + 1) * 100000,
        "ownership": {"default": -1},
        "flags": {}
    })

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "rules.json"), "w", encoding="utf8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=2)
print("pages:", [p[0] for p in pages])
