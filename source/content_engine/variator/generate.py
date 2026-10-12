"""
TikTok-style video generator: creates multiple variations from a template image
by combining step images, text, and exporting as images, then converting to videos.

Where to put your files:
- template1.png … template4.png  → project root. One template is chosen per variation (rotation).
- Step images   → assets/ folder (see ASSETS_IMAGES below).
- Polices → idéalement python download_fonts.py (Rubik, Montserrat, Poppins dans fonts/). Sinon tirage aléatoire parmi les .ttf du dossier ou des polices Windows courantes (souvent en gras).
- Audio (optional) → audio_path/ (all tracks used in random order each run) or set AUDIO_SINGLE for one fixed file.
"""

import argparse
import itertools
import json
import os
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# -----------------------------------------------------------------------------
# Paths (easy to modify)
# -----------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
# Multiple templates: one is chosen per variation (idx % len).
TEMPLATE_GLOB = "template*.png"  # template1.png, template2.png, ...
ASSETS_DIR = PROJECT_ROOT / "assets"
FONTS_DIR = PROJECT_ROOT / "fonts"
OUTPUT_IMAGES_DIR = PROJECT_ROOT / "output" / "images"
OUTPUT_VIDEOS_DIR = PROJECT_ROOT / "output" / "videos"

# Audio: tous les fichiers du dossier sont utilisés ; ordre mélangé à chaque exécution (variation i → i-ème du mélange). .mp3, .wav, .m4a.
AUDIO_DIR = PROJECT_ROOT / "audio_path"
# Si tu veux un seul fichier fixe, mets par ex. AUDIO_SINGLE = AUDIO_DIR / "ReelAudio-53910.mp3", sinon None.
AUDIO_SINGLE = None

# App images: find_app, create_store_app, create_ai_ugc_app + assets/allinoneapp (même visuel sur les 3 zones quand le mélange l’active).
# True = toujours l’image allinoneapp sur les 3 emplacements app (ignore le mélange).
# False = logos séparés + option all-in-one : voir ALLINONE_MIX_FRACTION.
USE_ALLINONEAPP = False
# Si USE_ALLINONEAPP est False et que allinoneapp + dossiers séparés existent : part des variations en mode « une image partout ».
ALLINONE_MIX_FRACTION = 0.25
APP_FOLDERS = ["find_app", "create_store_app", "create_ai_ugc_app"]
ALLINONEAPP_FOLDER = "allinoneapp"
SALES_FOLDER = "sales"

# Mode logos séparés : le slot create_ai_ugc_app tire au hasard parmi ces fichiers (chemins à l’usage, pas préchargés).
CREATE_AI_UGC_LOGO_FILENAMES = frozenset({"4.png", "8.png", "9.png"})

# Zones: (x_frac_left, y_frac_top, w_frac, h_frac). Logos ~3× plus grands (tous les assets). Ajuster si chevauchement.
APP_ZONES = {
    "find_app": (0.10, 0.12, 0.90, 0.33),
    "create_store_app": (0.05, 0.37, 0.90, 0.33),
    "create_ai_ugc_app": (0.05, 0.62, 0.90, 0.33),
    "sales": (0.02, 0.88, 0.96, 0.12),
}

# -----------------------------------------------------------------------------
# Text variations per step (edit these to add/change options)
# -----------------------------------------------------------------------------
STEP_1_OPTIONS = [
    "Find a winning product",
    "Find your winner",
    "Find a viral product",
    "Find Your Winning Product",
    "Find Your Next Winner",
    "Find a Winning Product Fast",
    "Find Your Next Product Winner",
    "Find Products That Actually Sell",
    "Find Your First Winning Product",
    "Find High-Converting Products",
    "Find Your Next Viral Product",
    "Let AI find you a winning product",
    "Find your Winning Product with AI",
    "Get your Winning Product",
]

STEP_1_FAVORITES = [
    "Find a winning product",
    "Find your winner",
    "Find Your Winning Product",
    "Find your Winning Product with AI",
    "Get your Winning Product",
]

STEP_2_OPTIONS = [
    "Launch Your Store With AI In 5 Minutes",
    "Build Your Store With AI In Minutes",
    "Create a Store With AI Instantly",
    "Start Your AI Store In 5 Minutes",
    "Launch an AI-Powered Store Fast",
    "Build Your Ecommerce Store With AI",
    "Create Your Online Store In Minutes",
    "AI Builds Your Store In 5 Minutes",
    "Launch Your Store With AI Instantly",
    "Create your store with AI in 5min",
    "Create your Store with AI",
    "Create your AI Store in min",
]

STEP_3_OPTIONS = [
    "Generate Realistic UGC With AI",
    "Create Viral AI UGC Ads",
    "Create AI UGC And Post On IG / TikTok",
    "Generate Realistic AI Creators",
    "Create AI Influencer Content",
    "Generate Realistic AI UGC Ads",
    "Create your AI UGC army",
    "Create your AI UGC",
    "Generate your AI UGC",
    "Create your AI UGC & Post it on ig",
    "Create your AI UGC & Post it on Tiktok",
]

STEP_4_OPTIONS = [
    "Make Bank 💰",
    "Start Making Bank",
    "Watch The Sales Roll In",
    "Print Money 💰",
    "Turn Clicks Into Cash",
    "Start Printing Sales",
    "Watch The Money Flow",
    "Turn Traffic Into Profit",
    "Cash In 💰",
    "Cash out",
    "Let The Sales Come In",
    "Make Bank Like This",
    "make bank like crazy",
    "Make Sh*t Ton of Money",
]

# Marques voiture : (mot-clé dans le texte, nom affiché, préfixe des fichiers dans assets/cars).
# Ordre important : mettre « lamborghini » avant « lambo » pour les textes qui contiennent le mot entier ;
# pour les fichiers, seul le préfixe compte (lambo.png n’existe pas → préfixe « lamborghini »).
CAR_BRAND_SPECS: list[tuple[str, str, str]] = [
    ("lamborghini", "Lamborghini", "lamborghini"),
    ("mercedes", "Mercedes", "mercedes"),
    ("mclaren", "McLaren", "mclaren"),
    ("porsche", "Porsche", "porsche"),
    ("ferrari", "Ferrari", "ferrari"),
    ("kawasaki", "Kawasaki", "kawasaki"),
    ("tesla", "Tesla", "tesla"),
    ("audi", "Audi", "audi"),
    ("bmw", "BMW", "bmw"),
    ("lambo", "Lamborghini", "lamborghini"),
]

STEP_4_CAR_TEMPLATES = [
    "Get your {car}",
    "The first of your descendants to turn the key of a {car}",
]

# ---------------------------------------------------------------------------
# Templates 9-12: phrases courtes + suffixe "on" / "with"
# ---------------------------------------------------------------------------
STEP_1_OPTIONS_SUFFIX = [
    "Find your winner on",
    "Find a winning product on",
    "Get your Winner on",
    "Find Your Winner with",
    "Find a viral product on",
    "Find Your Next Winner on",
]

STEP_1_FAVORITES_SUFFIX = [
    "Find your winner on",
    "Get your Winner on",
    "Find a winning product on",
]

STEP_2_OPTIONS_SUFFIX = [
    "Create your Store with",
    "Build Your Store with",
    "Launch Your Store with",
    "Create your AI Store with",
    "Start Your Store with",
]

STEP_3_OPTIONS_SUFFIX = [
    "Create your AI UGC with",
    "Generate your AI UGC with",
    "Create AI UGC Ads with",
    "Generate AI Creators with",
    "Create AI Content with",
]

STEP_4_OPTIONS_SUFFIX = [
    "Make Bank 💰",
    "Cash In 💰",
    "Print Money 💰",
    "Make Sh*t Ton of Money",
    "Make Bank Like This",
    "Turn Clicks Into Cash",
    "Cash out",
]

# -----------------------------------------------------------------------------
# Image layout — titres (x from right, y from top)
# -----------------------------------------------------------------------------
# find winner: 0.02y 0.95x -> (0.05, 0.02) left ; create ai store: 0.5x 0.25y -> (0.5, 0.25) center
# create ai ugc: 0.95x 0.54y -> (0.95, 0.54) right ; make bank: 0.6x 0.89y -> (0.4, 0.89) center
TEXT_POSITIONS = [  # (x_frac from left, y_frac from top) — x user was "from right", converted: x_left = 1 - x_right
    (1 - 0.95, 0.02),   # step 1 find winner — haut gauche
    (0.5, 0.25),        # step 2 create ai store — centre
    (0.95, 0.54),       # step 3 create ai ugc — droite
    (0.4, 0.89),       # step 4 make bank
]
TEXT_ALIGN = ["left", "center", "right", "center"]  # left, center, right
FONT_SIZE_RATIO = 0.03   # police réduite
TEXT_COLOR = (255, 255, 255)
OUTLINE_COLOR = (0, 0, 0)
OUTLINE_WIDTH = 2

# Grille 10×10 (labels 0.1 à 1.0) sur les images générées pour positionnement précis. Mettre False pour désactiver.
ENABLE_GRID_OVERLAY = True

# Fallback si aucun .ttf/.otf dans fonts/ : ces noms sont cherchés dans fonts/, Windows/Fonts, etc.
TITLE_FONTS = ["Rubik-Bold.ttf", "Montserrat-Bold.ttf", "Poppins-Bold.ttf"]


def _apply_layout_overrides(data: dict) -> None:
    """
    Applique les overrides de layout.json sur APP_ZONES, TEXT_POSITIONS, TEXT_ALIGN, FONT_SIZE_RATIO.
    data est un dict déjà parsé depuis le JSON.
    """
    global APP_ZONES, TEXT_POSITIONS, TEXT_ALIGN, FONT_SIZE_RATIO

    # Zones logos (mode centres optionnel + fallback en mode coin haut-gauche)
    app_centers = data.get("app_centers")
    if isinstance(app_centers, dict):
        new_zones = {}
        for name, vals in app_centers.items():
            if (
                isinstance(vals, (list, tuple))
                and len(vals) == 4
                and all(isinstance(v, (int, float)) for v in vals)
            ):
                cx, cy, w_frac, h_frac = map(float, vals)
                x_left = cx - w_frac / 2.0
                y_top = cy - h_frac / 2.0
                new_zones[name] = (x_left, y_top, w_frac, h_frac)
        if new_zones:
            merged = dict(APP_ZONES)
            merged.update(new_zones)
            APP_ZONES = merged

    # Ancien mode: valeurs déjà en (x_left, y_top, w, h)
    app_zones = data.get("app_zones")
    if isinstance(app_zones, dict):
        new_zones = {}
        for name, vals in app_zones.items():
            if (
                isinstance(vals, (list, tuple))
                and len(vals) == 4
                and all(isinstance(v, (int, float)) for v in vals)
            ):
                new_zones[name] = tuple(float(v) for v in vals)
        if new_zones:
            # On conserve les clés existantes si non fournies, pour éviter les crashes.
            merged = dict(APP_ZONES)
            merged.update(new_zones)
            APP_ZONES = merged

    # Positions titres
    text_positions = data.get("text_positions")
    if isinstance(text_positions, list) and text_positions:
        ok = True
        parsed = []
        for item in text_positions:
            if (
                isinstance(item, (list, tuple))
                and len(item) == 2
                and all(isinstance(v, (int, float)) for v in item)
            ):
                parsed.append((float(item[0]), float(item[1])))
            else:
                ok = False
                break
        if ok and parsed:
            TEXT_POSITIONS = parsed

    # Alignements titres
    text_align = data.get("text_align")
    if isinstance(text_align, list) and text_align:
        if all(isinstance(a, str) for a in text_align):
            TEXT_ALIGN[:] = text_align[: len(TEXT_ALIGN)]

    # Taille police titres
    font_size_ratio = data.get("font_size_ratio")
    if isinstance(font_size_ratio, (int, float)) and font_size_ratio > 0:
        FONT_SIZE_RATIO = float(font_size_ratio)


def load_layout_file(template_path: Path | None = None) -> None:
    """
    Charge le layout correspondant au template.

    Convention:
      - template5.png → layout5.json (s'il existe), sinon layout.json
      - template1.png → layout.json (pas de layout1.json spécifique)

    On réinitialise d'abord avec layout.json (base), puis on applique le layout
    spécifique au template par-dessus si présent.
    """
    _reset_layout_defaults()

    # 1) Toujours charger layout.json comme base
    base_path = PROJECT_ROOT / "layout.json"
    if base_path.exists():
        try:
            data = json.loads(base_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                _apply_layout_overrides(data)
        except Exception:
            pass

    # 2) Si un template est spécifié, chercher le layoutN.json le plus proche (≤ N).
    #    Ex: template7.png → layout7.json ? non → layout6.json ? non → layout5.json ? oui → utilise layout5.json
    #    Cela permet à un groupe de templates (5-8) de partager un seul layout5.json.
    if template_path is not None:
        name = template_path.stem
        digits = "".join(c for c in name if c.isdigit())
        if digits:
            num = int(digits)
            for n in range(num, 0, -1):
                candidate = PROJECT_ROOT / f"layout{n}.json"
                if candidate.exists() and candidate != base_path:
                    try:
                        data = json.loads(candidate.read_text(encoding="utf-8"))
                        if isinstance(data, dict):
                            _apply_layout_overrides(data)
                    except Exception:
                        pass
                    break


# Valeurs par défaut initiales (sauvegardées pour reset entre templates)
_DEFAULT_APP_ZONES = {
    "find_app": (0.10, 0.12, 0.90, 0.33),
    "create_store_app": (0.05, 0.37, 0.90, 0.33),
    "create_ai_ugc_app": (0.05, 0.62, 0.90, 0.33),
    "sales": (0.02, 0.88, 0.96, 0.12),
}
_DEFAULT_TEXT_POSITIONS = [
    (1 - 0.95, 0.02),
    (0.5, 0.25),
    (0.95, 0.54),
    (0.4, 0.89),
]
_DEFAULT_TEXT_ALIGN = ["left", "center", "right", "center"]
_DEFAULT_FONT_SIZE_RATIO = 0.03


def _template_group(template_path: Path) -> str:
    """Return layout group: 'suffix' for templates 9-12, 'alt' for 5-8, 'default' for 1-4."""
    digits = "".join(c for c in template_path.stem if c.isdigit())
    if digits:
        n = int(digits)
        if n >= 9:
            return "suffix"
        if n >= 5:
            return "alt"
    return "default"


def _pick_step_texts(template_path: Path, caption_text: str | None = None) -> tuple[str, str, str, str]:
    """Pick random step texts adapted to the template group."""
    group = _template_group(template_path)

    if group == "suffix":
        if random.random() < 0.8 and STEP_1_FAVORITES_SUFFIX:
            s1 = random.choice(STEP_1_FAVORITES_SUFFIX)
        else:
            s1 = random.choice(STEP_1_OPTIONS_SUFFIX)
        s2 = random.choice(STEP_2_OPTIONS_SUFFIX)
        s3 = random.choice(STEP_3_OPTIONS_SUFFIX)
        s4 = random.choice(STEP_4_OPTIONS_SUFFIX)
    else:
        if random.random() < 0.8 and STEP_1_FAVORITES:
            s1 = random.choice(STEP_1_FAVORITES)
        else:
            s1 = random.choice(STEP_1_OPTIONS)
        s2 = random.choice(STEP_2_OPTIONS)
        s3 = random.choice(STEP_3_OPTIONS)
        s4 = random.choice(STEP_4_OPTIONS)

    # Dynamic car-based step4: if a caption mentions a car brand, sometimes use a car phrase
    if caption_text and random.random() < 0.4:
        lower = caption_text.lower()
        for key, display, _prefix in CAR_BRAND_SPECS:
            if key in lower:
                tpl = random.choice(STEP_4_CAR_TEMPLATES)
                s4 = tpl.format(car=display)
                break

    return (s1, s2, s3, s4)


def _reset_layout_defaults() -> None:
    """Remet les globales layout à leurs valeurs par défaut (avant d'appliquer un layout spécifique)."""
    global APP_ZONES, TEXT_POSITIONS, TEXT_ALIGN, FONT_SIZE_RATIO
    APP_ZONES = dict(_DEFAULT_APP_ZONES)
    TEXT_POSITIONS = list(_DEFAULT_TEXT_POSITIONS)
    TEXT_ALIGN = list(_DEFAULT_TEXT_ALIGN)
    FONT_SIZE_RATIO = _DEFAULT_FONT_SIZE_RATIO

# -----------------------------------------------------------------------------
# Limit for testing (number of variations). Set to None to generate all.
# -----------------------------------------------------------------------------
MAX_VARIATIONS = 4  # 4 images + 4 videos for test; put None for full run

# -----------------------------------------------------------------------------
# Video settings (FFmpeg)
# -----------------------------------------------------------------------------
VIDEO_DURATION_SEC = 6
FPS = 25
# Fade variation: 0–1 s noir, puis découverte de 1 s à 5 s (totalement visible à 5 s).
FADE_START_SEC = 1.0
FADE_DURATION_SEC = 4.0
# Caption: pas de fade (texte lisible dès le début)

# -----------------------------------------------------------------------------
# 9:16 caption videos — fond noir, rectangle blanc (bandeau) en haut, texte centré, vidéo variation centrée en dessous
# -----------------------------------------------------------------------------
CAPTION_WIDTH = 1080
CAPTION_HEIGHT = 1920   # 9:16
CAPTION_RECT_Y_START = 0.056   # fraction hauteur (bandeau un peu plus haut)
CAPTION_RECT_Y_END = 0.163
CAPTION_TEXT_COLOR = (0, 0, 0)
CAPTION_HIGHLIGHT_COLOR = (255, 0, 0)
CAPTION_HIGHLIGHT_WORDS = [
    "2026",
    "strategy",
    "Strategy",
    "Mercedes",
    "Lamborghini",
    "AI",
    "Dropshipping",
    "bitcoin",
    "Bitcoin",
    "tools",
    "cheat",
]
# Nombre max de vidéos 9:16 à générer par run (prises au hasard dans captions.txt)
CAPTION_MAX_COUNT = 4
CAPTION_OPTIONS = [
    "Best Dropshipping app for 2026",
    "Best dropshipping strategy for 2026",
    "Mercedes-level dropshipping wins in 2026",
    "Scale to a Lamborghini with this dropshipping app",
]
OUTPUT_CAPTION_IMAGES = PROJECT_ROOT / "output" / "caption" / "images"
OUTPUT_CAPTION_VIDEOS = PROJECT_ROOT / "output" / "caption" / "videos"

_FONT_EXTS = frozenset({".ttf", ".otf", ".ttc"})


def _font_pool_from_project() -> list[str]:
    """Tous les fichiers police sous fonts/ (récursif), chemins absolus."""
    if not FONTS_DIR.is_dir():
        return []
    out: list[str] = []
    for p in FONTS_DIR.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in _FONT_EXTS:
            continue
        if p.name.upper().startswith("README"):
            continue
        out.append(str(p.resolve()))
    return out


# Si fonts/ est vide : ces noms sous Windows/Fonts sont essayés pour le hasard (évite Rubik seul).
_WINDOWS_FONT_FALLBACK_NAMES = (
    "arialbd.ttf",
    "calibrib.ttf",
    "segoeuib.ttf",
    "verdanab.ttf",
    "georgiab.ttf",
    "framd.ttf",
    "impact.ttf",
    "palab.ttf",
    "corbelb.ttf",
    "taileb.ttf",
)


def _font_pool_for_random() -> list[str]:
    """Polices disponibles pour un tirage aléatoire : fonts/ d’abord, sinon Windows/Fonts (+ fallback)."""
    pool = _font_pool_from_project()
    if pool:
        return pool
    win = Path(os.environ.get("WINDIR", "C:\\Windows")) / "Fonts"
    if not win.is_dir():
        return []
    seen: set[str] = set()
    out: list[str] = []
    for n in tuple(TITLE_FONTS) + _WINDOWS_FONT_FALLBACK_NAMES:
        p = win / n
        if p.is_file():
            s = str(p.resolve())
            if s not in seen:
                seen.add(s)
                out.append(s)
    return out


def _try_random_from_pool(
    size: int, pool: list[str]
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont | None:
    """Essaie plusieurs fichiers au hasard jusqu’à ce qu’un se charge (fichiers corrompus / formats bizarres)."""
    if not pool:
        return None
    order = list(pool)
    random.shuffle(order)
    for path in order[: min(12, len(order))]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return None


def get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Police au hasard dans fonts/ ou Windows/Fonts si possible, sinon Rubik/Arial/dégradés."""
    f = _try_random_from_pool(size, _font_pool_for_random())
    if f is not None:
        return f
    candidates = [
        str(FONTS_DIR / "Rubik-Bold.ttf"),
        "Rubik-Bold.ttf",
        "C:\\Windows\\Fonts\\Rubik-Bold.ttf",
        "arial.ttf",
        "Arial.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def get_title_font(size: int, variation_index: int = 0) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Police titre : au hasard dans fonts/ ou Windows/Fonts, sinon TITLE_FONTS + dégradés (variation_index ignoré)."""
    f = _try_random_from_pool(size, _font_pool_for_random())
    if f is not None:
        return f
    name = random.choice(TITLE_FONTS)
    win_fonts = Path(os.environ.get("WINDIR", "C:\\Windows")) / "Fonts"
    candidates = [
        str(FONTS_DIR / name),
        str(FONTS_DIR / "static" / name),
        name,
        str(win_fonts / name),
        str(win_fonts / name.replace("-", " ")),
        "/usr/share/fonts/truetype/" + name.lower(),
        "/System/Library/Fonts/Supplemental/" + name,
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return get_font(size)


def get_template_paths() -> list[Path]:
    """Return sorted list of template files (template1.png, template2.png, ...)."""
    paths = sorted(PROJECT_ROOT.glob(TEMPLATE_GLOB))
    return [p for p in paths if p.is_file()]


def get_audio_paths() -> list[Path]:
    """Liste tous les fichiers audio du dossier audio_path (un par variation)."""
    if not AUDIO_DIR.exists():
        return []
    paths = []
    for ext in ("*.mp3", "*.MP3", "*.wav", "*.m4a", "*.WAV", "*.M4A"):
        paths.extend(AUDIO_DIR.glob(ext))
    return sorted(set(p.resolve() for p in paths if p.is_file()))


def get_all_text_combinations():
    """Ancien helper (non utilisé pour la génération principale). Conservé pour compatibilité éventuelle."""
    return itertools.product(
        STEP_1_OPTIONS,
        STEP_2_OPTIONS,
        STEP_3_OPTIONS,
        STEP_4_OPTIONS,
    )


def _load_images_from_folder(
    folder: Path,
    keep_alpha: bool = False,
    *,
    allowed_names: frozenset[str] | None = None,
) -> list[Image.Image]:
    """Load all PNG/JPG from a folder. keep_alpha=True preserves transparency (RGBA) for logos."""
    allowed_l = {n.lower() for n in allowed_names} if allowed_names else None
    out = []
    for ext in ("*.png", "*.jpg", "*.jpeg"):
        for p in sorted(folder.glob(ext)):
            if allowed_l is not None and p.name.lower() not in allowed_l:
                continue
            try:
                im = Image.open(p)
                if keep_alpha and im.mode in ("RGBA", "LA", "P"):
                    im = im.convert("RGBA")
                else:
                    im = im.convert("RGB")
                out.append(im)
            except Exception:
                continue
    return out


# extensions image pour le slot sales (sous-dossiers inclus)
_SALES_IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})


def _collect_sales_image_paths(sales_dir: Path) -> list[Path]:
    """Tous les fichiers image sous sales/ (récursif), ordre mélangé pour tirage équitable."""
    paths: list[Path] = []
    for p in sales_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in _SALES_IMAGE_SUFFIXES:
            continue
        if p.name.lower().startswith("readme"):
            continue
        paths.append(p)
    random.shuffle(paths)
    return paths


def _open_asset_image(path: Path, keep_alpha: bool) -> Image.Image | None:
    try:
        im = Image.open(path)
        if keep_alpha and im.mode in ("RGBA", "LA", "P"):
            return im.convert("RGBA")
        return im.convert("RGB")
    except Exception:
        return None


def _ugc_logo_paths(folder: Path) -> list[Path]:
    """Un chemin par fichier autorisé présent sur disque (4.png, 8.png, 9.png) — tirage au collage."""
    by_lower = {p.name.lower(): p for p in folder.iterdir() if p.is_file()}
    paths: list[Path] = []
    for name in sorted(CREATE_AI_UGC_LOGO_FILENAMES):
        p = by_lower.get(name.lower())
        if p is not None:
            paths.append(p)
    return paths


def load_step_images(w: int, h: int) -> dict | None:
    """Load app images from assets subfolders. Logos en RGBA. allinoneapp est toujours chargé si le dossier existe (même si USE_ALLINONEAPP=False)."""
    out = {}
    allinone = ASSETS_DIR / ALLINONEAPP_FOLDER
    if allinone.exists():
        imgs = _load_images_from_folder(allinone, keep_alpha=True)
        out["allinoneapp"] = imgs if imgs else []
    else:
        out["allinoneapp"] = []
    for name in APP_FOLDERS:
        folder = ASSETS_DIR / name
        if not folder.exists():
            out[name] = []
            continue
        if name == "create_ai_ugc_app":
            paths = _ugc_logo_paths(folder)
            # list[Path] → ouverture + random.choice à chaque variation (évite biais / échecs chargement silencieux)
            out[name] = paths if paths else _load_images_from_folder(folder, keep_alpha=True)
        else:
            out[name] = _load_images_from_folder(folder, keep_alpha=True)
    sales_dir = ASSETS_DIR / SALES_FOLDER
    out["sales"] = _collect_sales_image_paths(sales_dir) if sales_dir.exists() else []
    has_allinone = bool(out.get("allinoneapp"))
    has_folders = any(out.get(k) for k in APP_FOLDERS)
    has_sales = bool(out.get("sales"))
    if not has_allinone and not has_folders and not has_sales:
        return None
    return out


def _use_allinone_on_all_app_slots(step_images: dict) -> bool:
    """True = même logo all-in-one sur find_app, create_store_app, create_ai_ugc (3 zones identiques)."""
    ao = step_images.get("allinoneapp") or []
    has_ao = len(ao) > 0
    has_split = any(step_images.get(k) for k in APP_FOLDERS)
    if USE_ALLINONEAPP:
        return has_ao
    if not has_ao:
        return False
    if not has_split:
        return True
    return random.random() < ALLINONE_MIX_FRACTION


def paste_step_images(
    img: Image.Image,
    step_images: dict,
    variation_index: int,
    *,
    allinone_all_slots: bool,
) -> None:
    """Paste app and sales images at APP_ZONES. All-in-one (même visuel sur les 3 apps) ou tirage aléatoire par zone."""
    w, h = img.size
    allinone_list = step_images.get("allinoneapp") or []
    use_allinone = allinone_all_slots and len(allinone_list) > 0
    ao_pick = random.choice(allinone_list) if use_allinone else None
    for slot_name, zone in APP_ZONES.items():
        if slot_name == "sales":
            sales_list = step_images.get("sales") or []
            if not sales_list:
                continue
            pick = random.choice(sales_list)
            if isinstance(pick, Path):
                slot_im = _open_asset_image(pick, keep_alpha=True)
                if slot_im is None:
                    continue
            else:
                slot_im = pick
        else:
            if use_allinone:
                slot_im = ao_pick
            else:
                lst = step_images.get(slot_name) or []
                if lst and isinstance(lst[0], Path):
                    pick = random.choice(lst)
                    slot_im = _open_asset_image(pick, keep_alpha=True)
                else:
                    slot_im = random.choice(lst) if lst else None
        if slot_im is None:
            continue
        x_frac, y_frac, w_frac, h_frac = zone
        x = int(w * x_frac)
        y = int(h * y_frac)
        zw = int(w * w_frac)
        zh = int(h * h_frac)
        # Agrandir uniformément (conserver ratio, centrer dans la zone)
        vw, vh = slot_im.size
        scale = min(zw / vw, zh / vh) if vw and vh else 1.0
        nw = int(vw * scale)
        nh = int(vh * scale)
        resized = slot_im.resize((nw, nh), Image.Resampling.LANCZOS)
        px = x + (zw - nw) // 2
        py = y + (zh - nh) // 2
        if resized.mode == "RGBA":
            img.paste(resized, (px, py), resized.split()[3])
        else:
            img.paste(resized, (px, py))
    return


def render_image(
    template: Image.Image,
    lines: tuple[str, ...],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    step_images: dict | None,
    variation_index: int,
) -> Image.Image:
    """Draw step images (if present) and the four text lines on a copy of the template.

    IMPORTANT: TEXT_POSITIONS are interpreted as the TOP-LEFT corner (start) of the title text.
    """
    img = template.copy()
    if step_images:
        allinone_all = _use_allinone_on_all_app_slots(step_images)
        paste_step_images(img, step_images, variation_index, allinone_all_slots=allinone_all)
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for i, line in enumerate(lines):
        if i >= len(TEXT_POSITIONS):
            break
        title = f"{i + 1}. {line}"
        x_frac, y_frac = TEXT_POSITIONS[i]
        # Positions are the start of the phrase (top-left corner)
        x = int(w * x_frac)
        y = int(h * y_frac)
        for dx in range(-OUTLINE_WIDTH, OUTLINE_WIDTH + 1):
            for dy in range(-OUTLINE_WIDTH, OUTLINE_WIDTH + 1):
                if dx != 0 or dy != 0:
                    draw.text((x + dx, y + dy), title, font=font, fill=OUTLINE_COLOR)
        draw.text((x, y), title, font=font, fill=TEXT_COLOR)
    return img


def draw_grid_on_image(img: Image.Image) -> None:
    """Dessine une grille 10×10 avec labels 0.1 à 1.0 (en fraction) pour positionnement précis. Modifie img en place."""
    if not ENABLE_GRID_OVERLAY:
        return
    w, h = img.size
    draw = ImageDraw.Draw(img)
    grid_color = (120, 120, 120)
    label_color = (200, 200, 200)
    font_size = max(10, min(14, int(min(w, h) * 0.012)))
    try:
        grid_font = ImageFont.truetype(str(FONTS_DIR / "Rubik-Bold.ttf"), font_size)
    except Exception:
        grid_font = ImageFont.load_default()
    for i in range(11):
        f = i / 10.0
        px = int(w * f)
        py = int(h * f)
        draw.line([(px, 0), (px, h)], fill=grid_color, width=1)
        draw.line([(0, py), (w, py)], fill=grid_color, width=1)
        label = f"{f:.1f}"
        lb = draw.textbbox((0, 0), label, font=grid_font)
        lw = lb[2] - lb[0]
        lh = lb[3] - lb[1]
        if px > 5 and px < w - lw - 5:
            draw.text((px - lw // 2, 2), label, font=grid_font, fill=label_color)
        if py > lh + 2 and py < h - 5:
            draw.text((2, py - lh // 2), label, font=grid_font, fill=label_color)
    draw.text((w - 28, 2), "x", font=grid_font, fill=label_color)
    draw.text((2, h - 14), "y", font=grid_font, fill=label_color)


def get_ffmpeg_exe() -> str | None:
    """Return path to ffmpeg.exe, or None. Tries PATH then WinGet install folder."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return "ffmpeg"
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    # WinGet installe souvent ici sans ajouter au PATH
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        winget = Path(local) / "Microsoft" / "WinGet" / "Packages"
        if winget.exists():
            for p in winget.iterdir():
                if not p.is_dir():
                    continue
                exe = p / "ffmpeg-8.0.1-full_build" / "bin" / "ffmpeg.exe"
                if exe.exists():
                    return str(exe)
                # autre version possible
                for sub in p.iterdir():
                    if sub.is_dir() and "ffmpeg" in sub.name.lower():
                        bin_exe = sub / "bin" / "ffmpeg.exe"
                        if bin_exe.exists():
                            return str(bin_exe)
    return None


def check_ffmpeg() -> bool:
    """Return True if ffmpeg is available. Print help and return False otherwise."""
    if get_ffmpeg_exe():
        return True
    print("FFmpeg n'est pas installé ou introuvable.")
    print("  - winget install ffmpeg  puis redémarre le terminal (ou relance le script).")
    print("  - Ou télécharge: https://www.gyan.dev/ffmpeg/builds/ et ajoute le dossier bin au PATH.")
    return False


def image_to_video(
    image_path: Path,
    video_path: Path,
    width: int,
    height: int,
    audio_path: Path | None,
    fade_duration_sec: float | None = None,
    fade_start_sec: float | None = None,
) -> bool:
    """
    Convert one image to a vertical video.
    fade_duration_sec: None = use FADE_DURATION_SEC, 0 = no fade-in (caption).
    fade_start_sec: None = use FADE_START_SEC (0 pour caption, 1 pour variation).
    """
    total_frames = int(VIDEO_DURATION_SEC * FPS)
    fade_sec = fade_duration_sec if fade_duration_sec is not None else FADE_DURATION_SEC
    start_sec = fade_start_sec if fade_start_sec is not None else FADE_START_SEC
    vf = f"fade=t=in:st={start_sec}:d={fade_sec}" if fade_sec > 0 else "null"
    img_abs = str(image_path.resolve())
    out_abs = str(video_path.resolve())

    ffmpeg_exe = get_ffmpeg_exe()
    if not ffmpeg_exe:
        print("FFmpeg introuvable.")
        return False

    # Build command: all inputs first, then all output options (required with multiple inputs)
    cmd = [ffmpeg_exe, "-y", "-loop", "1", "-i", img_abs]
    if audio_path and audio_path.exists():
        cmd.extend(["-stream_loop", "-1", "-i", str(audio_path.resolve())])
    # Output options (after all inputs). No -vf when fade_sec == 0 (pas de fade-in).
    out_opts = ["-frames:v", str(total_frames), "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if fade_sec > 0:
        out_opts = ["-vf", vf] + out_opts
    cmd.extend(out_opts)
    if audio_path and audio_path.exists():
        cmd.extend(["-map", "0:v", "-map", "1:a", "-t", str(VIDEO_DURATION_SEC), "-c:a", "aac"])
    else:
        cmd.append("-an")
    cmd.append(out_abs)

    try:
        result = subprocess.run(cmd, capture_output=True, text=False)
        if result.returncode == 0:
            return True
        err = (result.stderr or b"").decode(errors="replace").strip()
        print(f"FFmpeg error for {image_path.name} (code {result.returncode}):")
        print(err[-2000:] if len(err) > 2000 else err)
        # If failure was with audio, retry sans audio (vidéo seule, durée fixe)
        if audio_path and audio_path.exists():
            retry_opts = ["-frames:v", str(total_frames), "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", out_abs]
            if fade_sec > 0:
                retry_opts = ["-vf", vf] + retry_opts  # vf already uses start_sec
            cmd_no_audio = [ffmpeg_exe, "-y", "-loop", "1", "-i", img_abs] + retry_opts
            retry = subprocess.run(cmd_no_audio, capture_output=True, text=False)
            if retry.returncode == 0:
                print("  -> Vidéo créée sans audio (l’audio a été ignoré).")
                return True
        return False
    except FileNotFoundError:
        print("FFmpeg introuvable.")
        return False


def overlay_caption_on_variation(
    caption_image: Path,
    variation_video: Path,
    output_video: Path,
) -> bool:
    """
    Superpose une vidéo variation (avec son fade + audio) sur une caption 9:16 (fond + bandeau + texte, sans fade),
    façon CapCut: la variation est centrée sous le bandeau, l'audio vient de la variation.
    """
    ffmpeg_exe = get_ffmpeg_exe()
    if not ffmpeg_exe:
        print("FFmpeg introuvable pour les captions.")
        return False

    if not variation_video.exists():
        print(f"Variation video not found for caption: {variation_video}")
        return False

    img_abs = str(caption_image.resolve())
    var_abs = str(variation_video.resolve())
    out_abs = str(output_video.resolve())

    # Zone sous le bandeau blanc (où l'on veut la variation)
    y0 = int(CAPTION_HEIGHT * CAPTION_RECT_Y_START)
    y1 = int(CAPTION_HEIGHT * CAPTION_RECT_Y_END)
    # On laisse un peu plus d'espace noir en bas → on réduit légèrement la hauteur utile
    zone_h = int((CAPTION_HEIGHT - y1) * 0.85)

    # Filter:
    #  - Entrée 0: image caption (loopée)
    #  - Entrée 1: vidéo variation
    # 1) On scale la variation pour rentrer dans la zone sous le bandeau (force_original_aspect_ratio=decrease)
    # 2) On overlay au centre horizontalement, et aligné dans la zone verticalement
    filter_complex = (
        f"[1:v]scale={CAPTION_WIDTH}:{zone_h}:force_original_aspect_ratio=decrease[vid];"
        f"[0:v][vid]overlay=(main_w-overlay_w)/2:{y1}"
    )

    cmd = [
        ffmpeg_exe,
        "-y",
        "-loop",
        "1",
        "-i",
        img_abs,   # 0:v = caption (image)
        "-i",
        var_abs,   # 1:v,1:a = variation (avec fade + audio)
        "-filter_complex",
        filter_complex,
        "-r",
        str(FPS),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-map",
        "0:v",     # vidéo: résultat overlay
        "-map",
        "1:a?",    # audio: piste audio de la variation si présente
        "-c:a",
        "aac",
        "-shortest",
        out_abs,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=False)
        if result.returncode == 0:
            return True
        err = (result.stderr or b"").decode(errors="replace").strip()
        print(f"FFmpeg overlay error for {output_video.name} (code {result.returncode}):")
        print(err[-2000:] if len(err) > 2000 else err)
        return False
    except FileNotFoundError:
        print("FFmpeg introuvable pour les captions.")
        return False


def main(args):
    OUTPUT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

    template_paths = get_template_paths()
    if not template_paths:
        print(f"No templates found matching {TEMPLATE_GLOB} in {PROJECT_ROOT}")
        print("Add template1.png, template2.png, ... in the project root.")
        return

    # Preload all templates for quick access
    templates = [Image.open(p).convert("RGB") for p in template_paths]
    width, height = templates[0].size
    print(f"Loaded {len(templates)} templates: {[p.name for p in template_paths]}")

    distinct_sizes = {t.size for t in templates}
    if len(distinct_sizes) > 1:
        print(
            "Note: les templates n'ont pas tous la même taille — la police est calculée "
            f"par template (comme en --preview-live). Tailles: {[f'{p.name}:{t.size[0]}x{t.size[1]}' for p, t in zip(template_paths, templates)]}"
        )

    step_images = load_step_images(width, height)
    if step_images:
        parts = [k for k in ("allinoneapp",) + tuple(APP_FOLDERS) + (SALES_FOLDER,) if step_images.get(k)]
        print(f"Loaded app images from assets/: {', '.join(parts)}")
    else:
        print("No app images in assets/ subfolders — using template + text only. Add images in assets/allinoneapp, find_app, create_store_app, create_ai_ugc_app, sales.")

    # Un son par variation (ou un seul fichier si AUDIO_SINGLE est défini)
    audio_list = get_audio_paths() if not (AUDIO_SINGLE and AUDIO_SINGLE.exists()) else []
    if AUDIO_SINGLE and AUDIO_SINGLE.exists():
        print(f"Using single audio: {AUDIO_SINGLE}")
    elif audio_list:
        print(
            f"Using {len(audio_list)} audio files from {AUDIO_DIR} "
            "(random track per variation)"
        )
    else:
        print("No audio (add files in audio_path/ or set AUDIO_SINGLE in generate.py).")

    skip_videos = False
    if not args.images_only and not check_ffmpeg():
        print("Génération des images uniquement. Relancez après avoir installé FFmpeg pour créer les vidéos (ou utilisez --videos-only).")
        skip_videos = True

    total = 0
    max_variations = MAX_VARIATIONS if MAX_VARIATIONS is not None else 4
    for idx in range(max_variations):
        tpl_idx = random.randint(0, len(templates) - 1)
        template = templates[tpl_idx]
        load_layout_file(template_paths[tpl_idx])
        lines = _pick_step_texts(template_paths[tpl_idx])
        total += 1
        tw, th = template.size
        # Même logique que run_preview_live : la taille de police suit la hauteur DU template courant
        font_size = max(20, int(th * FONT_SIZE_RATIO))
        font = get_title_font(font_size, idx)
        image_name = f"variation_{idx:04d}.png"
        video_name = f"variation_{idx:04d}.mp4"
        image_path = OUTPUT_IMAGES_DIR / image_name
        video_path = OUTPUT_VIDEOS_DIR / video_name

        img = render_image(template, lines, font, step_images, idx)
        img.save(image_path)
        print(f"Saved image {total}: {image_name} (template: {template_paths[tpl_idx].name})")

        if not args.images_only and not skip_videos:
            ap = (AUDIO_SINGLE if (AUDIO_SINGLE and AUDIO_SINGLE.exists()) else None) or (
                random.choice(audio_list) if audio_list else None
            )
            if image_to_video(image_path, video_path, tw, th, ap):
                print(f"  -> video: {video_name}")
            else:
                print(f"  -> video failed: {video_name}")

    if args.images_only or skip_videos:
        print(f"\nDone. Generated {total} images only (no videos). Run with --videos-only to create videos from them.")
    else:
        print(f"\nDone. Generated {total} images and videos.")
    # Génération automatique des captions (9:16, bandeau + texte + variation centrée)
    print("\n--- Captions (9:16) ---")
    run_captions(args)


def run_preview_position():
    """
    Generate a single image showing where text will be placed (grid + coordinates).
    Open output/images/preview_positions.png to see positions, then adjust TEXT_POSITIONS
    and FONT_SIZE_RATIO in generate.py without regenerating all variations.
    """
    template_paths = get_template_paths()
    if not template_paths:
        print(f"No templates found. Add template1.png, ... in {PROJECT_ROOT}")
        return
    OUTPUT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    img = Image.open(template_paths[0]).convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)
    font_size = max(14, min(24, int(h * 0.02)))
    try:
        font = ImageFont.truetype(str(FONTS_DIR / "Rubik-Bold.ttf"), font_size)
    except Exception:
        font = ImageFont.load_default()
    y_fracs_used = set()
    for i, (x_frac, y_frac) in enumerate(TEXT_POSITIONS):
        y = int(h * y_frac)
        x = int(w * x_frac)
        y_fracs_used.add(round(y_frac, 2))
        draw.line([(0, y), (w, y)], fill=(255, 0, 0), width=2)
        label = f"Step {i+1}: x={x_frac:.2f} y={y_frac:.2f}  (x={x}px y={y}px)"
        bbox = draw.textbbox((0, 0), label, font=font)
        lw = bbox[2] - bbox[0]
        draw.rectangle([(5, y - 2), (5 + lw + 10, y + font_size + 4)], fill=(0, 0, 0))
        draw.text((8, y), label, font=font, fill=(255, 200, 200))
    for frac in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
        if round(frac, 2) in y_fracs_used:
            continue
        y = int(h * frac)
        draw.line([(0, y), (w, y)], fill=(80, 80, 80), width=1)
    out_path = OUTPUT_IMAGES_DIR / "preview_positions.png"
    img.save(out_path)
    print(f"Preview saved: {out_path}")
    print("Ouvre cette image pour voir les positions. Ajuste TEXT_POSITIONS et FONT_SIZE_RATIO dans generate.py puis relance --preview-position pour revérifier.")


def run_preview_live(template_num: int | None = None):
    """
    Boucle de preview "temps réel" pour ajuster les layouts.

    Usage:
      python generate.py --preview-live                   # preview template1 + layout.json
      python generate.py --preview-live --template 5      # preview template5 + layout5.json
    """
    template_paths = get_template_paths()
    if not template_paths:
        print(f"No templates found. Add template1.png, ... in {PROJECT_ROOT}")
        return
    OUTPUT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    if template_num is not None:
        tpl_path = PROJECT_ROOT / f"template{template_num}.png"
        if not tpl_path.exists():
            print(f"template{template_num}.png not found. Available: {[p.name for p in template_paths]}")
            return
        chosen_path = tpl_path
    else:
        chosen_path = template_paths[0]

    layout_file = PROJECT_ROOT / f"layout{template_num}.json" if template_num else PROJECT_ROOT / "layout.json"
    print(f"Mode preview live — template: {chosen_path.name}, layout: {layout_file.name if layout_file.exists() else 'layout.json (default)'}")
    print("  - Ouvre output/images/preview_live.png dans un viewer.")
    print(f"  - Modifie {layout_file.name} (text_positions, font_size_ratio, app_centers/app_zones).")
    print("  - Puis appuie sur Entrée ici pour regénérer (q + Entrée pour quitter).")

    while True:
        load_layout_file(chosen_path)

        base = Image.open(chosen_path).convert("RGB")
        w, h = base.size

        # Charger les logos (si présents)
        step_images = load_step_images(w, h)

        sample_lines = _pick_step_texts(chosen_path)
        title_font_size = max(20, int(h * FONT_SIZE_RATIO))
        title_font = get_title_font(title_font_size, 0)

        # Générer une image avec VRAIS titres + logos
        # On varie l'index pour voir aussi différents logos (pas seulement les titres) en preview.
        preview_idx = random.randint(0, 10_000_000)
        img = render_image(base, sample_lines, title_font, step_images, preview_idx)

        # Grille légère pour repères
        draw_grid_on_image(img)
        draw = ImageDraw.Draw(img)

        # Police pour labels (infos x/y/w/h)
        font_size = max(14, min(24, int(h * 0.02)))
        try:
            font = ImageFont.truetype(str(FONTS_DIR / "Rubik-Bold.ttf"), font_size)
        except Exception:
            font = ImageFont.load_default()

        # Titres: indications de coordonnées au-dessus des vrais textes
        y_fracs_used = set()
        for i, (x_frac, y_frac) in enumerate(TEXT_POSITIONS):
            y = int(h * y_frac)
            x = int(w * x_frac)
            y_fracs_used.add(round(y_frac, 2))
            draw.line([(0, y), (w, y)], fill=(255, 0, 0), width=2)
            label = f"Step {i+1}: x={x_frac:.2f} y={y_frac:.2f}"
            bbox = draw.textbbox((0, 0), label, font=font)
            lw = bbox[2] - bbox[0]
            draw.rectangle([(x, y - font_size - 6), (x + lw + 10, y)], fill=(0, 0, 0, 180))
            draw.text((x + 5, y - font_size - 4), label, font=font, fill=(255, 200, 200))

        # Zones logos (APP_ZONES) — on affiche maintenant un petit rectangle AU CENTRE de la zone
        colors = {
            "find_app": (0, 255, 0),
            "create_store_app": (0, 200, 255),
            "create_ai_ugc_app": (255, 200, 0),
            "sales": (255, 0, 255),
        }
        for name, (x_frac, y_frac, w_frac, h_frac) in APP_ZONES.items():
            # Centre de la zone en fractions
            cx_frac = x_frac + w_frac / 2.0
            cy_frac = y_frac + h_frac / 2.0

            # Petit rectangle centré sur (cx, cy) pour représenter le CENTRE du logo
            cx = int(w * cx_frac)
            cy = int(h * cy_frac)
            half = max(4, int(min(w, h) * 0.02))
            x0 = cx - half
            y0 = cy - half
            x1 = cx + half
            y1 = cy + half

            color = colors.get(name, (255, 255, 0))
            draw.rectangle([(x0, y0), (x1, y1)], outline=color, width=3)
            # Label avec les coordonnées du CENTRE (plus simple à manipuler dans layout.json via app_centers)
            label = f"{name}: cx={cx_frac:.2f}, cy={cy_frac:.2f}, w={w_frac:.2f}, h={h_frac:.2f}"
            bbox = draw.textbbox((0, 0), label, font=font)
            lw = bbox[2] - bbox[0]
            lh = bbox[3] - bbox[1]
            tx = max(5, min(x0 + 5, w - lw - 5))
            ty = max(5, y0 - lh - 6)
            draw.rectangle([(tx - 3, ty - 2), (tx + lw + 6, ty + lh + 2)], fill=(0, 0, 0, 200))
            draw.text((tx, ty), label, font=font, fill=color)

        out_path = OUTPUT_IMAGES_DIR / "preview_live.png"
        img.save(out_path)
        print(f"Preview live saved: {out_path}")

        try:
            cmd = input("Entrée pour regénérer, 'q' + Entrée pour quitter: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nQuit.")
            break
        if cmd == "q":
            print("Quit.")
            break


def _get_first_variation_image() -> Image.Image | None:
    """Load first variation image from output/images/ (variation_0000.png, etc.) for centering in caption."""
    for p in sorted(OUTPUT_IMAGES_DIR.glob("variation_*.png")):
        try:
            return Image.open(p).convert("RGB")
        except Exception:
            continue
    return None


def _wrap_caption_text(
    text: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont | ImageFont.ImageFont, width: int
) -> list[str]:
    """
    Si le texte est trop long (bords trop proches de 0 ou 1 en x),
    on force un retour à la ligne approximativement au milieu de la phrase.
    """
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    # On veut que les bords soient dans [0.05, 0.95] → largeur max ~ 0.9 * largeur image
    if tw <= width * 0.90:
        return [text]

    # Chercher un espace près du milieu pour couper la phrase
    mid = len(text) // 2
    split_idx = None
    # d'abord vers la droite
    for i in range(mid, len(text)):
        if text[i] == " ":
            split_idx = i
            break
    # puis vers la gauche si rien trouvé ou si plus proche
    for i in range(mid, -1, -1):
        if text[i] == " ":
            if split_idx is None or mid - i < split_idx - mid:
                split_idx = i
            break
    if split_idx is None:
        return [text]
    line1 = text[:split_idx].strip()
    line2 = text[split_idx + 1 :].strip()
    if not line1 or not line2:
        return [text]
    return [line1, line2]


def _draw_centered_colored_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    center_x: int,
    y: int,
) -> None:
    """
    Dessine le texte centré horizontalement.
    Parfois, un mot important (2026, strategy, ...) est coloré en rouge.
    """
    # Chance de surligner (pas tout le temps)
    highlight = random.random() < 0.7

    # Chercher un mot à surligner
    word = None
    idx = -1
    lower = text.lower()
    if highlight:
        for w in CAPTION_HIGHLIGHT_WORDS:
            w_lower = w.lower()
            pos = lower.find(w_lower)
            if pos != -1:
                word = text[pos : pos + len(w)]
                idx = pos
                break

    if not word or idx < 0:
        # Pas de surlignage : texte simple centré
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        x = center_x - tw // 2
        draw.text((x, y), text, font=font, fill=CAPTION_TEXT_COLOR)
        return

    prefix = text[:idx]
    highlight_text = text[idx : idx + len(word)]
    suffix = text[idx + len(word) :]

    # Largeurs
    pw = draw.textbbox((0, 0), prefix, font=font)[2]
    hw = draw.textbbox((0, 0), highlight_text, font=font)[2]
    sw = draw.textbbox((0, 0), suffix, font=font)[2]
    total = pw + hw + sw
    x = center_x - total // 2

    if prefix:
        draw.text((x, y), prefix, font=font, fill=CAPTION_TEXT_COLOR)
    x += pw
    draw.text((x, y), highlight_text, font=font, fill=CAPTION_HIGHLIGHT_COLOR)
    x += hw
    if suffix:
        draw.text((x, y), suffix, font=font, fill=CAPTION_TEXT_COLOR)


_CAR_IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})


def _stem_matches_car_brand(stem_lower: str, prefix_lower: str) -> bool:
    """audi / audi (2).png / mercedes (3).png → même préfixe de marque."""
    return stem_lower == prefix_lower or stem_lower.startswith(prefix_lower + " ")


def _all_car_file_prefixes() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for _k, _d, pref in CAR_BRAND_SPECS:
        pl = pref.lower()
        if pl not in seen:
            seen.add(pl)
            out.append(pl)
    return sorted(out, key=len, reverse=True)


def _car_paths_by_brand_prefix() -> dict[str, list[Path]]:
    """Index préfixe marque → chemins (audi.png, audi (2).png, …)."""
    idx: dict[str, list[Path]] = {}
    cars_dir = ASSETS_DIR / "cars"
    if not cars_dir.is_dir():
        return idx
    brand_prefixes = _all_car_file_prefixes()
    for p in cars_dir.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() not in _CAR_IMAGE_SUFFIXES:
            continue
        if p.name.lower().startswith("readme"):
            continue
        stem_l = p.stem.lower()
        for pref in brand_prefixes:
            if _stem_matches_car_brand(stem_l, pref):
                idx.setdefault(pref, []).append(p)
                break
    return idx


def _get_car_icon_for_caption(text: str) -> Image.Image | None:
    """
    Si le texte mentionne une marque (voir CAR_BRAND_SPECS), charge une icône depuis assets/cars.
    Plusieurs fichiers par marque (ex. audi.png, audi (2).png) : un tirage au hasard.
    Le fond blanc / quasi blanc est rendu transparent.
    """
    lower = text.lower()
    by_pref = _car_paths_by_brand_prefix()
    chosen: Path | None = None
    for key, _display, prefix in CAR_BRAND_SPECS:
        if key not in lower:
            continue
        paths = by_pref.get(prefix.lower(), [])
        if paths:
            chosen = random.choice(paths)
        break
    if chosen is None:
        return None
    try:
        im = Image.open(chosen)
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        # Rendre le fond blanc / quasi blanc transparent
        data = list(im.getdata())
        thresh = 240
        new_data = [
            (r, g, b, 0) if (r >= thresh and g >= thresh and b >= thresh) else (r, g, b, a)
            for r, g, b, a in data
        ]
        im.putdata(new_data)
        return im
    except Exception:
        return None


def render_caption_image(text: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont) -> Image.Image:
    """Fond noir 9:16, rectangle blanc 0.07–0.22 y (toute la largeur), texte centré (une ou deux lignes), puis image variation centrée en dessous."""
    img = Image.new("RGB", (CAPTION_WIDTH, CAPTION_HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    y0 = int(CAPTION_HEIGHT * CAPTION_RECT_Y_START)
    y1 = int(CAPTION_HEIGHT * CAPTION_RECT_Y_END)
    draw.rectangle([(0, y0), (CAPTION_WIDTH, y1)], fill=(255, 255, 255))

    # Icône de voiture éventuelle liée au texte
    car_icon = _get_car_icon_for_caption(text)
    band_height = y1 - y0

    # Gestion du retour à la ligne automatique si le texte touche trop les bords
    lines = _wrap_caption_text(text, draw, font, CAPTION_WIDTH)
    # Hauteur totale du bloc de texte
    line_heights: list[int] = []
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        line_heights.append(bbox[3] - bbox[1])
    total_text_h = sum(line_heights) + max(0, (len(lines) - 1) * 4)

    # Si icône voiture, réserver un espace en bas du bandeau
    car_h = 0
    if car_icon is not None:
        max_car_h = int(band_height * 0.60)
        cw, ch = car_icon.size
        if ch > 0 and cw > 0:
            scale = min(max_car_h / ch, (CAPTION_WIDTH * 0.55) / cw)
            if scale > 0:
                nw = int(cw * scale)
                nh = int(ch * scale)
                car_icon = car_icon.resize((nw, nh), Image.Resampling.LANCZOS)
                car_h = nh + 6  # padding au-dessus
        # Sinon, on ne l'affichera pas

    # Zone disponible pour le texte: le bandeau moins la zone pour l'icône voiture
    available_h = band_height - car_h
    start_y = y0 + max(0, (available_h - total_text_h) // 2)

    cy = start_y
    for i, line in enumerate(lines):
        lh = line_heights[i]
        _draw_centered_colored_text(draw, line, font, CAPTION_WIDTH // 2, cy)
        cy += lh + 4

    # Dessiner l'icône voiture au bas du bandeau, centrée (avec transparence)
    if car_icon is not None and car_h > 0:
        nw, nh = car_icon.size
        px = (CAPTION_WIDTH - nw) // 2
        py = y1 - nh - 3
        img.paste(car_icon, (px, py), car_icon.split()[3] if car_icon.mode == "RGBA" else car_icon)

    # Ne pas incruster d'image variation ici: la vidéo caption superpose la variation en overlay,
    # donc une seule variation visible (pas de double superposition).
    return img


def _parse_caption_line(line: str) -> tuple[str, int]:
    """Parse optional weight suffix: 'Caption text @5' → weight 5 (default 1)."""
    weight = 1
    if " @" in line:
        text, _, suffix = line.rpartition(" @")
        if suffix.isdigit():
            return text.strip(), int(suffix)
    return line.strip(), weight


def _load_captions_from_file(captions_path: Path) -> tuple[list[str], list[int]]:
    raw = captions_path.read_text(encoding="utf-8").splitlines()
    texts: list[str] = []
    weights: list[int] = []
    for ln in raw:
        stripped = ln.strip()
        if not stripped or stripped.startswith("#"):
            continue
        text, weight = _parse_caption_line(stripped)
        if text:
            texts.append(text)
            weights.append(max(1, weight))
    return texts, weights


def _weighted_sample_without_replacement(
    items: list[str], weights: list[int], k: int
) -> list[str]:
    pool = list(items)
    pool_w = [float(w) for w in weights]
    chosen: list[str] = []
    for _ in range(min(k, len(pool))):
        idx = random.choices(range(len(pool)), weights=pool_w, k=1)[0]
        chosen.append(pool.pop(idx))
        pool_w.pop(idx)
    return chosen


def run_captions(args) -> None:
    """
    Generate 9:16 caption images (fond noir + bandeau blanc + texte),
    puis superpose une vidéo variation.mp4 par-dessus (comme dans CapCut):
      - la caption n'a PAS de fade,
      - la variation garde son fade + son audio.
    """
    OUTPUT_CAPTION_IMAGES.mkdir(parents=True, exist_ok=True)
    OUTPUT_CAPTION_VIDEOS.mkdir(parents=True, exist_ok=True)
    font_size = max(36, int(CAPTION_HEIGHT * 0.032))
    skip_videos = False
    if not args.images_only and not check_ffmpeg():
        skip_videos = True
        print("Vidéos caption ignorées (FFmpeg manquant). Générez les images puis relancez avec --videos-only après installation de FFmpeg.")
    # Charger les captions depuis un fichier externe si présent (@N = selection weight)
    captions_path = PROJECT_ROOT / "captions.txt"
    caption_weights: list[int] | None = None
    if captions_path.exists():
        captions_all, caption_weights = _load_captions_from_file(captions_path)
        if not captions_all:
            captions_all = CAPTION_OPTIONS
            caption_weights = None
    else:
        captions_all = CAPTION_OPTIONS

    max_count = min(CAPTION_MAX_COUNT, len(captions_all))
    if caption_weights and len(caption_weights) == len(captions_all):
        selected_texts = _weighted_sample_without_replacement(captions_all, caption_weights, max_count)
    else:
        selected_texts = random.sample(captions_all, max_count)

    for out_idx, text in enumerate(selected_texts):
        font = get_font(font_size)
        img = render_caption_image(text, font)
        name = f"caption_{out_idx:04d}.png"
        img_path = OUTPUT_CAPTION_IMAGES / name
        img.save(img_path)
        print(f"Saved {name}: \"{text}\"")
        if not args.images_only and not skip_videos:
            video_path = OUTPUT_CAPTION_VIDEOS / name.replace(".png", ".mp4")
            # On prend la variation_out_idx comme source (ou la première dispo en fallback)
            variation_path = OUTPUT_VIDEOS_DIR / f"variation_{out_idx:04d}.mp4"
            if not variation_path.exists():
                variations = sorted(OUTPUT_VIDEOS_DIR.glob("variation_*.mp4"))
                variation_path = variations[0] if variations else None
            if variation_path is None:
                print("No variation videos found for captions. Run generate.py sans --captions d'abord.")
            else:
                if overlay_caption_on_variation(img_path, variation_path, video_path):
                    print(f"  -> {video_path.name} (overlay on {variation_path.name})")
                else:
                    print(f"  -> video failed: {video_path.name}")
    print(f"\nDone. Generated {len(CAPTION_OPTIONS)} caption images and videos in output/caption/.")


def run_videos_only():
    """Convert existing images in output/images/ to videos (no new images)."""
    if not check_ffmpeg():
        sys.exit(1)
    OUTPUT_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    audio_list = get_audio_paths() if not (AUDIO_SINGLE and AUDIO_SINGLE.exists()) else []
    images = sorted(OUTPUT_IMAGES_DIR.glob("variation_*.png"))
    if not images:
        print(f"No images found in {OUTPUT_IMAGES_DIR}. Run with --images-only first.")
        return
    limit = MAX_VARIATIONS if MAX_VARIATIONS is not None else len(images)
    to_process = images[:limit]
    print(f"Creating videos from {len(to_process)} images (limit: {limit})...")
    for idx, image_path in enumerate(to_process):
        with Image.open(image_path) as im:
            width, height = im.size
        video_path = OUTPUT_VIDEOS_DIR / image_path.name.replace(".png", ".mp4")
        ap = (AUDIO_SINGLE if (AUDIO_SINGLE and AUDIO_SINGLE.exists()) else None) or (
            random.choice(audio_list) if audio_list else None
        )
        if image_to_video(image_path, video_path, width, height, ap):
            print(f"  -> {video_path.name}")
        else:
            print(f"  -> failed: {video_path.name}")
    print(f"\nDone. Generated {len(to_process)} videos.")


if __name__ == "__main__":
    # Appliquer les éventuels overrides de layout.json une fois au démarrage
    load_layout_file()

    parser = argparse.ArgumentParser(description="Generate TikTok-style variation images and/or videos.")
    parser.add_argument("--images-only", action="store_true", help="Only generate images (no videos).")
    parser.add_argument("--videos-only", action="store_true", help="Only convert existing images to videos (no new images).")
    parser.add_argument("--preview-position", action="store_true", help="Generate preview_positions.png to see text positions (grille + coordonnées).")
    parser.add_argument("--preview-live", action="store_true", help="Live preview: regenerate preview_live.png in a loop while you tweak TEXT_POSITIONS / APP_ZONES.")
    parser.add_argument("--template", type=int, default=None, help="Template number for --preview-live (ex: --template 5 pour template5.png + layout5.json)")
    parser.add_argument("--captions", action="store_true", help="Generate 9:16 caption videos (fond noir, bandeau blanc, texte type Best Dropshipping app for 2026).")
    args = parser.parse_args()

    if args.preview_position:
        run_preview_position()
    elif args.preview_live:
        run_preview_live(template_num=args.template)
    elif args.captions:
        run_captions(args)
    elif args.videos_only:
        run_videos_only()
    else:
        main(args)
