#!/system/bin/sh
# Apply staged Smash Indies maps into Smash Drums.
# Runs ON the Quest (via: adb shell sh /sdcard/SmashIndies/apply-installs.sh)
#
# Or from phone Termux after pushing this file to the Quest.

SRC="/sdcard/SmashIndies/Install"
DST="/sdcard/Android/data/com.PotamWorks.SmashDrums/files/Indies"

echo "Smash Indies apply"
echo "  from: $SRC"
echo "  to:   $DST"

mkdir -p "$DST"

count=0
for f in "$SRC"/*.indies; do
  # No matches → literal glob left as-is on some shells
  if [ ! -f "$f" ]; then
    continue
  fi
  name=$(basename "$f")
  cp -f "$f" "$DST/$name" && count=$((count + 1)) && echo "  + $name"
done

if [ "$count" -eq 0 ]; then
  echo "No .indies files in $SRC"
  echo "Download maps in Smash Indies (Indies-DB) first."
  exit 0
fi

echo "Done. Installed $count map(s). Open Smash Drums → Custom / Indies."
ls "$DST"
