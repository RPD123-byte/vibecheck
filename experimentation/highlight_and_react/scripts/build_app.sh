#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}

swift build --package-path "$project_dir" -c release
binary_dir=$(swift build --package-path "$project_dir" -c release --show-bin-path)

app_dir="$project_dir/build/HighlightAndReact.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"

mkdir -p "$macos_dir" "$resources_dir"
cp "$binary_dir/highlight-and-react" "$macos_dir/highlight-and-react"
cp "$project_dir/Resources/Info.plist" "$contents_dir/Info.plist"
codesign --force --sign - "$app_dir"

print "$app_dir"
