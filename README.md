# Ascent

Zwift-style indoor ride app for the Toputure TBE5/TEB5 bike. It's a single `index.html` that runs in the browser and talks to the bike over Web Bluetooth.

**Open it:** https://hqd-hub.github.io/ascent/
- iPad/iPhone: use the Bluefy browser (Safari has no Web Bluetooth)
- Mac: use Chrome or Edge

## Features
- Resistance control over the FitShow protocol: 32 levels, following the road gradient
- Heart rate from Whoop (Heart Rate Broadcast) and Apple Watch (via a broadcast app such as HeartCast or BlueHeart)
- 3D first-person rides on 15 real climbs (approximate profiles) and 12 worlds
- 5 multi-stage tours
- YouTube and video rides: playback follows your speed, and you can set SYNC points per video
- Workouts with pseudo-ERG, plus an FTP ramp test
- PR ghosts, segments, XP and badges
- Export rides as .tcx

## Build
`python3 build.py` joins `template.html`, `src/*.js` and `vendor/package/build/three.min.js` (three.js r149, MIT) into `dist/index.html`. Copy that file to `index.html` to publish.
