"use client";

import { useEffect, useRef } from "react";

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }`;

// Fluid, noise-driven glass orb. uEnergy (0..1) speeds up and brightens it while the agent works.
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uEnergy; uniform float uHue;

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/min(uRes.x,uRes.y);
  uv-=uMouse*0.035;
  float r=length(uv);
  float t=uTime*(0.16+0.42*uEnergy);
  float rad=0.335+0.012*sin(uTime*1.3)*(0.4+uEnergy);
  vec2 q=uv/rad;
  float aa=6.0/min(uRes.x,uRes.y)/rad;
  float inside=1.0-smoothstep(1.0-aa,1.0+aa,length(q));
  vec3 n=vec3(q,sqrt(max(0.0,1.0-dot(q,q))));

  // domain-warped flow inside the sphere
  vec3 pp=vec3(n.xy*1.35,t);
  float w=snoise(pp+vec3(0.0,0.0,0.0));
  float nz=snoise(vec3(n.xy*1.7+w*0.55,t*1.15))+0.5*snoise(vec3(n.xy*3.4-w*0.4+7.0,t*1.6));

  vec3 cA=vec3(0.42,0.34,0.99);   // iris
  vec3 cB=vec3(0.20,0.82,0.97);   // cyan
  vec3 cC=vec3(0.98,0.42,0.80);   // magenta highlight
  vec3 cD=vec3(0.24,0.90,0.66);   // mint
  vec3 col=mix(cA,cB,smoothstep(-0.7,0.9,nz+n.y*0.55+uHue*0.3));
  col=mix(col,cC,smoothstep(0.55,1.25,nz)*0.38);
  col=mix(col,cD,smoothstep(0.7,1.3,-nz+n.x*0.6)*0.18*(1.0+uEnergy));

  float light=0.45+0.55*clamp(dot(n,normalize(vec3(-0.45,0.55,0.75))),0.0,1.0);
  float fres=pow(1.0-n.z,2.2);
  float spec=pow(clamp(dot(reflect(-normalize(vec3(-0.4,0.6,0.7)),n),vec3(0.0,0.0,1.0)),0.0,1.0),28.0);
  col=col*light*(0.82+0.25*nz)+fres*vec3(0.62,0.72,1.0)*0.95+spec*0.55;

  float halo=exp(-pow(max(r-rad,0.0)*6.2,1.15))*(0.42+0.35*uEnergy);
  vec3 hc=mix(cA,cB,0.5+0.5*sin(t*2.0+atan(uv.y,uv.x)*2.0))*halo;

  vec3 outc=col*inside+hc*(1.0-inside);
  float a=clamp(max(inside,halo),0.0,1.0);
  gl_FragColor=vec4(outc*a,a);
}`;

type Props = { energy?: number; className?: string; hue?: number };

export default function Orb({ energy = 0, className = "", hue = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const energyRef = useRef(energy);
  const hueRef = useRef(hue);
  useEffect(() => {
    energyRef.current = energy;
    hueRef.current = hue;
  }, [energy, hue]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Each effect run owns a fresh canvas (StrictMode runs effects twice; a lost context can't be reused).
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full";
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return; // CSS glow underneath remains as the fallback
    host.appendChild(canvas);
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.remove();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uEnergy = gl.getUniformLocation(prog, "uEnergy");
    const uHue = gl.getUniformLocation(prog, "uHue");

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    let e = energyRef.current;
    let h = hueRef.current;
    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.tx = ((ev.clientX - rect.left) / rect.width - 0.5) * 2;
      mouse.ty = -((ev.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(canvas);

    let raf = 0;
    const start = performance.now();
    let last = start;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 3);
      mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 3);
      e += (energyRef.current - e) * Math.min(1, dt * 2.5);
      h += (hueRef.current - h) * Math.min(1, dt * 2);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uEnergy, e);
      gl.uniform1f(uHue, h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  return (
    <div className={`relative ${className}`} aria-hidden>
      <div className="absolute inset-[22%] rounded-full bg-[radial-gradient(circle_at_35%_30%,#9b8cff,#3a2fb8_45%,#0f1a3d_75%)] opacity-60 blur-2xl" />
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
