#!/bin/sh
# Take a folder of raw scans and turn them into models the game can carry.
#
#   tools/prepmodels.sh ~/Desktop/scans [tris] [tex]
#
# Every .glb/.gltf/.obj/.fbx/.ply/.stl in the folder is decimated, its textures
# shrunk, and it is stood on the ground with its footprint centred. The results
# land in game/assets/kit/ named after the file, and the baked bundle is rebuilt
# so the game picks them up.
#
# Defaults: 20000 triangles, 1024px textures. If the total comes out heavy, run
# it again with something like 12000 512.

set -e
here=$(cd "$(dirname "$0")/.." && pwd)
src=${1:?usage: tools/prepmodels.sh FOLDER [tris] [tex]}
tris=${2:-20000}
tex=${3:-1024}
out="$here/game/assets/kit"

command -v blender >/dev/null || { echo "Blender is not on the path"; exit 1; }

found=0
for f in "$src"/*.glb "$src"/*.gltf "$src"/*.obj "$src"/*.fbx "$src"/*.ply "$src"/*.stl; do
  [ -e "$f" ] || continue
  found=$((found + 1))
  name=$(basename "$f")
  name=${name%.*}
  blender --background --python "$here/tools/decimate.py" -- \
          "$f" "$out/$name.glb" "$tris" "$tex" 2>/dev/null |
    sed -n '/->/,/^$/p'
done

[ "$found" -gt 0 ] || { echo "nothing to convert in $src"; exit 1; }

node "$here/tools/buildkit.js"
echo ""
echo "$found model(s) ready. Total baked bundle:"
ls -lh "$here/game/assets/kit.js" | awk '{print "  " $5}'
