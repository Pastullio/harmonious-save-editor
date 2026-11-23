#!/bin/sh
# Stand-in for blender.exe in test_stale_blend.js. In the background (-b) it runs the --python script through
# Blender-as-a-module, like fake-blender.sh. Started the way the app opens a file for the person, it notes what it was
# asked to open (one argument per line in $STALE_ARGS) and, when a --python script came with the file, runs it on the
# file and saves the result to $STALE_OUT (your Blender would leave it open, unsaved).
PY="${HSE_TEST_PYTHON:-${SP}/bpyenv/bin/python}"
if [ "$1" = "-b" ]; then
  script=""; while [ $# -gt 0 ]; do case "$1" in --python) script="$2"; shift 2;; --) shift; break;; *) shift;; esac; done
  exec "$PY" -u "$script" -- "$@"
fi
: > "$STALE_ARGS"; for a in "$@"; do printf '%s\n' "$a" >> "$STALE_ARGS"; done
file="$1"; shift
[ "$1" = "--python" ] || exit 0
script="$2"; shift 3
exec "$PY" -u "$(dirname "$0")/stale_runner.py" "$file" "$script" "$STALE_OUT" -- "$@"
