#!/bin/zsh
set -euo pipefail

perl -ne '
  while (/--remote-debugging-port(?:=|\s+)(\d+)/g) {
    print "$1\n" if $1 > 0 && $1 <= 65535;
  }
' | sort -nu
