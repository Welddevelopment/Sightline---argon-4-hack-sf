import { renderViews } from '../record.js';
const t0=Date.now();
const r = await renderViews({ worldUrl:'/render/dev/dev_world.js', page:'/render/dev/index.html', views:['wit_X'], t:3, stillOnly:true,
  outDir:'renders/_dev', extraWitnesses:[{id:'wit_X',name:'X',position:[5,0,20],eyeHeight:1.6,lookAt:'occ_shelter',observationTime:3,claim:'c',citation:'Live statement'}]});
console.log(JSON.stringify(r), (Date.now()-t0)/1000+'s');
