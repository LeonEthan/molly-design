# Molly opening cue v2

The user supplied `Folio — Form & Rhythm_watermark.mp3` and requested its use in the three-scene welcome opening. The source is a 123.389-second, 44.1 kHz stereo, 128 kbps MP3. Its embedded AIGC metadata identifies MiniMax as the content producer. Source SHA-256: `99744621bdc9c2c591b80ad7e031941d95167e6e495ab49ee04cf5abce05ac7b`.

`molly-opening-v2.mp3` uses source time 0.55–8.20 seconds. FFmpeg `atempo=0.85` expands its short musical phrase to nine seconds without changing pitch; `volume=5.5dB` and a final 0.8-second fade place the source cadence and tail inside the cue. The output is 44.1 kHz stereo, 192 kbps MP3, exactly 9.000 seconds, -22.5 LUFS integrated, with -2.9 dBFS true peak. Output SHA-256: `818f68f42f8bbdaf18450e844b4c83fdbb6494974aa93054de1c331f58cefeae`.

The source file is not bundled. After listening to the final nine-second file presented in this task, the user replied “LGTM” on 2026-09-24. This accepts that file's sound; it does not document listening to the cue inside Electron during early exit, mute or blocked recovery. The runtime player uses a further 0.55 volume factor and never loops.
