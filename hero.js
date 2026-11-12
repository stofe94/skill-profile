/* Hero: a finite element mesh drawn as a graph, deforming and coloured by strain (decorative). */
(function(){
  var svg=document.getElementById('mesh');
  if(!svg) return;
  var NS="http://www.w3.org/2000/svg";
  var eG=document.getElementById('edges'), nG=document.getElementById('nodes');
  var cols=15, rows=13, W=520, H=430, padX=40, padY=34;
  var gw=(W-2*padX)/(cols-1), gh=(H-2*padY)/(rows-1);
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function lerp(a,b,t){return a+(b-a)*t}
  function cmap(t){
    t=Math.max(0,Math.min(1,t));var r,g,b;
    if(t<0.5){var u=t/0.5; r=lerp(37,0,u); g=lerp(64,166,u); b=lerp(217,156,u);}
    else{var u2=(t-0.5)/0.5; r=lerp(0,255,u2); g=lerp(166,106,u2); b=lerp(156,61,u2);}
    return 'rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')';
  }

  var pts=[];
  for(var j=0;j<rows;j++){for(var i=0;i<cols;i++){pts.push({bx:padX+i*gw,by:padY+j*gh});}}
  function idx(i,j){return j*cols+i}
  var edges=[];
  for(var j2=0;j2<rows;j2++){for(var i2=0;i2<cols;i2++){
    if(i2<cols-1)edges.push([idx(i2,j2),idx(i2+1,j2)]);
    if(j2<rows-1)edges.push([idx(i2,j2),idx(i2,j2+1)]);
  }}
  var eEls=edges.map(function(){var l=document.createElementNS(NS,'line');l.setAttribute('stroke-width','1');l.setAttribute('stroke-linecap','round');eG.appendChild(l);return l;});
  var nEls=pts.map(function(){var c=document.createElementNS(NS,'circle');nG.appendChild(c);return c;});

  function field(t){
    var c1={x:0.74+0.05*Math.sin(t*0.6), y:0.40+0.04*Math.cos(t*0.5), a:34, s:120};
    var c2={x:0.30, y:0.66, a:20, s:150};
    for(var k=0;k<pts.length;k++){
      var p=pts[k],dx=0,dy=0,mag=0;
      [c1,c2].forEach(function(c){
        var cx=padX+c.x*(W-2*padX), cy=padY+c.y*(H-2*padY);
        var ddx=p.bx-cx, ddy=p.by-cy, d2=ddx*ddx+ddy*ddy;
        var w=Math.exp(-d2/(c.s*c.s)), dist=Math.sqrt(d2)||1;
        dx+=(ddx/dist)*c.a*w; dy+=(ddy/dist)*c.a*w; mag+=w*c.a;
      });
      p.x=p.bx+dx; p.y=p.by+dy; p.m=mag;
    }
  }
  function draw(){
    for(var k=0;k<pts.length;k++){
      var p=pts[k],e=nEls[k],t=Math.min(1,p.m/40);
      e.setAttribute('cx',p.x.toFixed(2));e.setAttribute('cy',p.y.toFixed(2));
      e.setAttribute('fill',cmap(t));e.setAttribute('r',(2.2+t*2.4).toFixed(2));
    }
    for(var m=0;m<edges.length;m++){
      var a=pts[edges[m][0]],b=pts[edges[m][1]],l=eEls[m],t2=Math.min(1,((a.m+b.m)/2)/40);
      l.setAttribute('x1',a.x.toFixed(2));l.setAttribute('y1',a.y.toFixed(2));
      l.setAttribute('x2',b.x.toFixed(2));l.setAttribute('y2',b.y.toFixed(2));
      l.setAttribute('stroke',cmap(t2));l.setAttribute('stroke-opacity',(0.22+t2*0.55).toFixed(2));
    }
  }
  field(1.2);draw();
  if(!reduce){
    var t0=null;
    (function loop(ts){
      if(ts!==undefined){if(t0===null)t0=ts;field(1.2+(ts-t0)/1000);draw();}
      requestAnimationFrame(loop);
    })();
  }
})();
