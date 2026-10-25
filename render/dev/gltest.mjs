import { chromium as pw } from 'playwright-core';
import sp from '@sparticuz/chromium';
const exe = await sp.executablePath();
console.log('exe', exe);
const variants = {
  swiftshader: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
  swiftshader2: ['--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
  gl: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
};
for (const [name, extra] of Object.entries(variants)) {
  const b = await pw.launch({ executablePath: exe, headless: true, args: [...sp.args.filter(a=>!/disable-webgl|use-gl|use-angle|disable-gpu|single-process/.test(a)), ...extra] });
  const p = await b.newPage();
  await p.setContent('<canvas id=c></canvas>');
  const r = await p.evaluate(()=>{const g=document.getElementById('c').getContext('webgl2')||document.getElementById('c').getContext('webgl'); return g? g.getParameter(g.VERSION)+' | '+ (g.getExtension('WEBGL_debug_renderer_info')? g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL):''):null});
  console.log(name, r);
  await b.close();
}
