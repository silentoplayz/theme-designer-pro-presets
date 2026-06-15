// DigitalRain – transparency-optimized
let c,ctx,w,h,cols=[],font=15,glow=[]; 
self.onmessage=e=>{
  if(e.data.type==='init'){
    c=e.data.canvas;ctx=c.getContext('2d');
    w=c.width=e.data.width;h=c.height=e.data.height;
    ctx.font=font+'px monospace';
    let colCount=Math.floor(w/font);
    for(let i=0;i<colCount;i++){
      cols[i]=Math.random()*h;
      glow[i]=Math.random();
    }
    animate();
  }
  if(e.data.type==='resize'){
    w=c.width=e.data.width;h=c.height=e.data.height;
    ctx.font=font+'px monospace';
  }
};
function animate(){
  // 1. Erase a portion of the previous frame to transparency
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle='rgba(0,0,0,0.1)';
  ctx.fillRect(0,0,w,h);

  // 2. Switch back to normal drawing mode for characters
  ctx.globalCompositeOperation = 'source-over';
  
  let colCount=Math.floor(w/font);
  for(let i=0;i<colCount;i++){
    let txt=String.fromCharCode(0x30A0+Math.random()*96|0);
    let y=cols[i];
    ctx.fillStyle='hsla(120,100%,'+glow[i]*70+'%,1)';
    ctx.fillText(txt,i*font,y);
    cols[i]+=font*0.8;
    glow[i]*=0.98;
    if(y>h&&Math.random()<0.02){cols[i]=0;glow[i]=1;}
  }
  requestAnimationFrame(animate);
}