// Temporary live-fire test: run RIGHT AFTER killing ptpcamerad, in one chain:
//   sudo killall -9 ptpcamerad && node fire-test.mjs
const cam = await import("./server/camera/gphoto2.js");

const shot = async (label) => {
  const t0 = Date.now();
  try {
    await cam.captureImage();
    console.log(label, "FIRED", Date.now() - t0 + "ms");
  } catch (e) {
    console.log(label, "ERR", Date.now() - t0 + "ms", e.message.split("\n")[0]);
  }
};

await shot("shot 1 (spawn + camera init):");
await shot("shot 2 (warm):");
await shot("shot 3 (warm):");
await shot("shot 4 (warm):");
cam.close();
process.exit(0);
