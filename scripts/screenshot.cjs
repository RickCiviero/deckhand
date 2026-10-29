// Visual check helper: launches the built app directly and saves a PNG via CDP. Usage: electron scripts/screenshot.cjs <deck.html> <out.png> [js-to-run-before]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const out = process.argv[3] || 'e2e-cap.png';
require('../apps/desktop/out/main/index.js');
app.whenReady().then(() => setTimeout(async () => {
  const w = BrowserWindow.getAllWindows()[0];
  const dbg = w.webContents.debugger;
  dbg.attach('1.3');
  if (process.argv[4]) { await w.webContents.executeJavaScript(process.argv[4]); await new Promise((r) => setTimeout(r, 1500)); }
  const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('saved', out);
  app.exit(0);
}, 5000));
