#!/bin/sh
# Stand-in for blender.exe: runs the --python script through Blender-as-a-module with the args after --.
script=""; while [ $# -gt 0 ]; do case "$1" in --python) script="$2"; shift 2;; --) shift; break;; *) shift;; esac; done
exec ${SP}/bpyenv/bin/python -u "$script" -- "$@"
