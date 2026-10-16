# Canvas FX checks

[`harness.js`](harness.js) runs one Canvas FX script the way Theme Designer Pro does, in a Web Worker with an `OffscreenCanvas`, and screenshots it through a fixed sequence:

1. a dark theme, for 5 seconds
2. a cursor sweep and a tap on the right side
3. a live switch to a light theme
4. a resize to 1000x700
5. 1440x900 at a pixel ratio of 2, with reduced motion on

It saves the five screenshots and a `summary.json` with any errors from the page or the worker, the frame rate, and the CPU time each frame takes. [`analyze.py`](analyze.py) then compares each screenshot with the theme's background and writes `report.json`: how much of the screen the effect covers, how busy the chat column is next to the screen's edges (`calm`, under 1 means calmer), and flags for a blank canvas or a painted backdrop.

```bash
npm install --no-save playwright-core@1.56.1
node tests/canvas-fx/harness.js canvas-fx/nebula_webgl.js /tmp/fx/nebula_webgl
python3 tests/canvas-fx/analyze.py /tmp/fx/nebula_webgl
```

It needs Google Chrome and Pillow. It launches Chrome headless with the GPU enabled, since SwiftShader gives a worker no WebGL context.

A script that meets the [house standard](../../canvas-fx/README.md) shows no errors and no flags, a `calm` at or below 0.8 in the dark stage, and under 2 ms of CPU per frame for a 2D script. Look at the screenshots too: the numbers can't tell whether it reads well.
