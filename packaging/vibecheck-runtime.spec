# -*- mode: python ; coding: utf-8 -*-

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(os.environ["VIBECHECK_REPO_ROOT"])
model = Path(os.environ["VIBECHECK_MODEL_SOURCE"])
rust_binary = Path(os.environ["VIBECHECK_RUST_BINARY"])

datas = [(str(model), "models")]
binaries = [(str(rust_binary), ".")]
hiddenimports = [
    *collect_submodules("vibecheck"),
    *collect_submodules("emotiefflib"),
    *collect_submodules("facenet_pytorch"),
]
for package in (
    "emotiefflib",
    "facenet_pytorch",
    "onnxruntime",
    "cv2",
    "Cocoa",
    "AVFoundation",
):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas.extend(package_datas)
    binaries.extend(package_binaries)
    hiddenimports.extend(package_hidden)

a = Analysis(
    [str(root / "packaging" / "frozen_entry.py")],
    pathex=[str(root / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="vibecheck-runtime",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    target_arch="arm64",
    contents_directory=".",
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="vibecheck-runtime",
)
