#!/usr/bin/env python3
"""
SmashRoms pack — validate a Smash OS chart project and build a ship bundle.

Bundle layout:
  <song>-smashrom/
    meta.json          # pack manifest
    charts/*.indies
    source/            # optional copies of audio/cover
    README.txt
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    sys.exit(code)


def validate_indies(path: Path) -> list[str]:
    """Return list of warnings; raise via die on fatal."""
    warnings: list[str] = []
    if path.stat().st_size < 32:
        die(f"Fatal: {path.name} is tiny ({path.stat().st_size} bytes)")
    # .indies is zip-like (editor package)
    try:
        with zipfile.ZipFile(path, "r") as zf:
            names = zf.namelist()
            if not names:
                die(f"Fatal: {path.name} is an empty zip")
            lower = [n.lower() for n in names]
            if not any("meta.json" in n or n.endswith(".json") for n in lower):
                warnings.append(f"{path.name}: no meta.json inside package (may still load)")
    except zipfile.BadZipFile:
        # Some builds may use a different container; warn only
        warnings.append(f"{path.name}: not a zip container — leaving as opaque blob")
    return warnings


def pack_project(root: Path, out: Path | None) -> Path:
    root = root.resolve()
    if not root.is_dir():
        die(f"Not a project directory: {root}")

    title = root.name
    pj = root / "project.json"
    if pj.is_file():
        try:
            title = json.loads(pj.read_text(encoding="utf-8")).get("title", title)
        except json.JSONDecodeError:
            pass

    indies = list((root / "export").rglob("*.indies"))
    if not indies:
        die("No .indies under export/. Export from Editor or: smash from-midi …")

    all_warn: list[str] = []
    for f in indies:
        all_warn.extend(validate_indies(f))

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in title).strip().replace(" ", "_")
    bundle_name = f"{safe}-smashrom-{stamp}"
    if out:
        bundle = Path(out).expanduser().resolve()
        if bundle.suffix == ".zip":
            bundle_dir = bundle.with_suffix("")
        else:
            bundle_dir = bundle
    else:
        bundle_dir = root / "export" / bundle_name

    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    charts = bundle_dir / "charts"
    charts.mkdir(parents=True)
    src_out = bundle_dir / "source"
    src_out.mkdir(parents=True)

    for f in indies:
        shutil.copy2(f, charts / f.name)
        print(f"  + charts/{f.name}")

    src = root / "source"
    if src.is_dir():
        for f in src.iterdir():
            if f.is_file():
                shutil.copy2(f, src_out / f.name)

    manifest = {
        "format": "smashrom",
        "version": 1,
        "title": title,
        "created": datetime.now(timezone.utc).isoformat(),
        "charts": [p.name for p in indies],
        "warnings": all_warn,
        "quest": {
            "install_dir": "/sdcard/SmashIndies/Install",
            "indies_dir": "/sdcard/Android/data/com.PotamWorks.SmashDrums/files/Indies",
        },
    }
    (bundle_dir / "meta.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (bundle_dir / "README.txt").write_text(
        f"""SmashRom bundle: {title}
Created: {manifest['created']}

Install on Quest:
  1. smash push-quest   (from Smash OS)
  2. smash apply-quest
  3. Open Smash Drums → Custom / Indies

Or copy charts/*.indies into Smash Indies Install / game Indies folder.
""",
        encoding="utf-8",
    )

    zip_path = bundle_dir.with_suffix(".zip")
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in bundle_dir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(bundle_dir.parent).as_posix())

    print(f"Packed: {bundle_dir}")
    print(f"Zip:    {zip_path}")
    for w in all_warn:
        print(f"  warn: {w}")
    return zip_path


def main() -> None:
    ap = argparse.ArgumentParser(description="SmashRoms pack/validate")
    ap.add_argument("project", type=Path, help="Project root (~/Charts/Song)")
    ap.add_argument("--out", help="Output dir or .zip path")
    args = ap.parse_args()
    pack_project(args.project, Path(args.out) if args.out else None)


if __name__ == "__main__":
    main()
