import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Lenis from 'lenis';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCoverflow } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import { buildProgressEvidence } from '@/lib/progress-evidence';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~|}{[]:;?><';

function EvidenceChart({ points = [] }) {
  const plot = useMemo(() => {
    if (!points.length) return '';
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return points.map((point, index) => {
      const x = points.length === 1 ? 50 : 8 + (index / (points.length - 1)) * 84;
      const y = max === min ? 50 : 84 - ((point.value - min) / (max - min)) * 68;
      return `${x},${y}`;
    }).join(' ');
  }, [points]);
  return <div className="ascent-chart" aria-label={`Chart with ${points.length} real historical points`}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
      <line x1="8" y1="84" x2="92" y2="84" />
      <polyline points={plot} />
      {plot.split(' ').filter(Boolean).map((pair,index) => { const [cx,cy]=pair.split(','); return <circle key={`${cx}-${cy}-${index}`} cx={cx} cy={cy} r={index === 0 || index === points.length-1 ? 2.2 : 1.2}/>; })}
    </svg>
    <div><span>{points[0]?.date ? new Date(points[0].date).toLocaleDateString() : ''}</span><span>{points.at(-1)?.date ? new Date(points.at(-1).date).toLocaleDateString() : ''}</span></div>
  </div>;
}

function EvidenceCard({ item }) {
  const format = (value) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(1)) : '—';
  if (!item.sufficient) return <div className="ascent-card-outer"><div className="ascent-card-inner ascent-card-inner--warning"><div><span className="ascent-card-title">{item.title}</span><div className="ascent-card-value">{format(item.current)}<small>{item.unit}</small></div></div><div className="ascent-warning"><AlertTriangle aria-hidden="true"/><span>No usable training history yet</span></div></div><div className="ascent-card-footer">ONE VALID SESSION · MORE EVIDENCE REQUIRED</div></div>;
  return <div className="ascent-card-outer"><div className="ascent-card-inner"><div><span className="ascent-card-title">{item.title}</span><div className="ascent-card-value">{format(item.current)}<small>{item.unit}</small></div></div><div className="ascent-card-details"><div><span>STARTED</span><strong>{format(item.first)} {item.unit}</strong></div><div><span>NOW</span><strong>{format(item.current)} {item.unit}</strong></div><div><span>CHANGE</span><strong>{item.change > 0 ? '+' : ''}{format(item.change)} {item.unit}</strong></div></div><EvidenceChart points={item.points}/></div><div className="ascent-card-footer">{item.points.length} VERIFIED HISTORICAL {item.points.length === 1 ? 'POINT' : 'POINTS'}</div></div>;
}

export default function EvidenceOfAscent({ clientName, heroName, videoUrl, metrics, workoutLogs, nutritionLogs, onBack, onCheckIn }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const heroRef = useRef(null);
  const descRef = useRef(null);
  const cinematicRef = useRef(null);
  const cardsRef = useRef(null);
  const evidence = useMemo(() => buildProgressEvidence({ metrics, workoutLogs, nutritionLogs }), [metrics, workoutLogs, nutritionLogs]);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return undefined;
    let frame = 0; let scrollProgress = 0; let smooth = 0; let seeking = false; let nextSeek = null; let entrance = 'loading'; let entranceStart = 0; let ready = false; let cardsRevealed = false;
    const scrambles = [...root.querySelectorAll('[data-scramble-in]')].map((el) => ({ el, text: el.dataset.text || '', delay: Number(el.dataset.delay || 0), phase:'idle', progress:0, lastTime:0, started:false, timer:null }));
    const updateScroll = () => { const height = document.documentElement.scrollHeight - innerHeight; scrollProgress = height > 0 ? scrollY / height : 0; if (!cardsRevealed && cardsRef.current?.getBoundingClientRect().top < innerHeight * .9) { cardsRevealed=true; cardsRef.current.classList.add('is-revealed'); } };
    addEventListener('scroll', updateScroll, { passive:true }); updateScroll();
    let lenis;
    if (innerWidth >= 768 && !matchMedia('(prefers-reduced-motion: reduce)').matches) lenis = new Lenis({ duration:1.2, easing:(t)=>Math.min(1,1.001-Math.pow(2,-10*t)), smoothWheel:true, wheelMultiplier:1, touchMultiplier:1.5 });
    const onSeeking = () => { seeking = true; };
    const onSeeked = () => { seeking=false; if(nextSeek!=null && video.duration){ const time=nextSeek; nextSeek=null; seeking=true; video.currentTime=time; } };
    const onMetadata = () => { video.autoplay=false; video.pause(); };
    video.addEventListener('seeking',onSeeking); video.addEventListener('seeked',onSeeked); video.addEventListener('loadedmetadata',onMetadata);
    const safety = setTimeout(()=>{if(entrance==='loading'){entrance='animating';entranceStart=performance.now();}},3500);
    const updateScrambles = (now) => scrambles.forEach((state) => {
      const scrollActive=scrollProgress>.015;
      if(!ready&&state.phase==='idle')return;
      if(ready&&state.phase==='idle'&&!scrollActive&&!state.started){state.started=true;state.timer=setTimeout(()=>{state.phase='in';state.progress=0;state.lastTime=performance.now();},state.delay);return;}
      if(scrollActive&&(state.phase==='revealed'||state.phase==='in')){state.phase='out';state.progress=0;state.lastTime=now;} else if(!scrollActive&&(state.phase==='hidden'||state.phase==='out')){state.phase='in';state.progress=0;state.lastTime=now;}
      if(state.phase==='in'||state.phase==='out'){const duration=state.phase==='in'?900:700;state.progress=Math.min(1,state.progress+(now-state.lastTime)/duration);state.lastTime=now;const t=state.progress;let result='';for(let i=0;i<state.text.length;i++){if(state.text[i]===' '){result+=' ';continue;}const threshold=i/state.text.length;if(state.phase==='in')result+=t>=threshold+.15?state.text[i]:t>=threshold-.1?GLYPHS[Math.floor(Math.random()*GLYPHS.length)]:'\u00a0';else result+=t>=threshold+.2?'\u00a0':t>=threshold-.05?GLYPHS[Math.floor(Math.random()*GLYPHS.length)]:state.text[i];}state.el.textContent=result;state.el.style.opacity=state.phase==='out'?String(Math.max(0,1-t*1.5)):'1';if(t>=1){state.phase=state.phase==='in'?'revealed':'hidden';state.el.textContent=state.phase==='revealed'?state.text:state.text.replace(/\S/g,'\u00a0');}}
    });
    const tick = (now) => { lenis?.raf(now); smooth+=(scrollProgress-smooth)*.12;if(Math.abs(scrollProgress-smooth)<.0001)smooth=scrollProgress;const subtle=Math.max(0,Math.min(1,(smooth-.1)/.45));const progressive=Math.max(0,Math.min(1,(smooth-.55)/.4));let zoom=1,opacity=1;if(entrance==='loading'){zoom=1.12;opacity=0;if(video.readyState>=3){entrance='animating';entranceStart=now;}}if(entrance==='animating'){const elapsed=now-entranceStart;const progress=Math.min(1,elapsed/1400);const ease=1-Math.pow(1-progress,3);zoom=1.12-.12*ease;opacity=Math.min(1,elapsed/500);if(progress>=1){entrance='complete';ready=true;root.classList.add('is-visible');}}video.style.filter=`blur(${subtle*5+progressive*50}px)`;video.style.transform=`scale(${(1.03+Math.max(0,Math.min(1,(smooth-.1)/.9))*.08)*zoom})`;video.style.opacity=String(opacity);if(video.readyState>=1&&video.duration){const target=Math.max(0,Math.min(video.duration,smooth*video.duration));if(Math.abs(video.currentTime-target)>.008){if(!seeking&&!video.seeking){seeking=true;video.currentTime=target;}else nextSeek=target;}}const norm=(document.documentElement.scrollHeight-innerHeight)>0?scrollY/(document.documentElement.scrollHeight-innerHeight):0;if(heroRef.current){heroRef.current.style.opacity=String(Math.max(0,Math.min(1,1-norm/.26)));heroRef.current.style.transform=`scale(${1-.04*Math.min(1,norm/.26)})`;}if(descRef.current){descRef.current.style.opacity=String(Math.max(0,1-norm/.12));descRef.current.style.transform=`translateY(${-30*Math.min(1,norm/.12)}px)`;}let cin=norm<=.08?0:norm<=.22?(norm-.08)/.14:norm<=.42?1:norm<=.65?1-(norm-.42)/.23:0;if(cinematicRef.current){cinematicRef.current.style.transform=`rotateX(24deg) translateY(${-120*Math.min(1,scrollY/1000)}px) translateZ(15px)`;cinematicRef.current.style.opacity=String(Math.max(0,Math.min(1,cin)));}updateScrambles(now);frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);clearTimeout(safety);scrambles.forEach(s=>clearTimeout(s.timer));removeEventListener('scroll',updateScroll);video.removeEventListener('seeking',onSeeking);video.removeEventListener('seeked',onSeeked);video.removeEventListener('loadedmetadata',onMetadata);lenis?.destroy();};
  }, []);

  return <div className="ascent-page" ref={rootRef}>
    <div className="ascent-video-layer"><video ref={videoRef} muted playsInline preload="auto" src={videoUrl}/></div><div className="ascent-bottom-blur"/>
    <header className="ascent-header"><button type="button" className="ascent-logo-pill" onClick={onBack}><ArrowLeft/><span>Your Hero</span></button><button type="button" className="ascent-action-pill" onClick={onCheckIn}>Check-in</button></header>
    <main className="ascent-main"><div className="ascent-dot-grid"/><section className="ascent-hero" ref={heroRef}><div className="ascent-hero-inner"><div className="ascent-grid"><div className="ascent-title"><span data-scramble-in data-text={clientName.toUpperCase()} data-delay="100">&nbsp;</span></div><div/></div><div className="ascent-grid-bottom"><div className="ascent-desc" ref={descRef}><p>KEEP ASCENDING</p></div><div className="ascent-title right"><span data-scramble-in data-text={heroName.toUpperCase()} data-delay="300">&nbsp;</span></div></div></div></section>
      <section className="ascent-cinematic"><div ref={cinematicRef}><h2>This is not a promise of transformation. It is the record of what changed — every kilogram, every completed set, every measured point. The evidence does not flatter you. It remembers you.</h2></div></section>
      <section className="ascent-stats" ref={cardsRef}>{evidence.length ? <Swiper modules={[EffectCoverflow]} effect="coverflow" grabCursor slidesPerView="auto" centeredSlides loop={evidence.length>2} spaceBetween={32} coverflowEffect={{rotate:30,stretch:0,depth:100,modifier:1,slideShadows:false}} observer observeParents>{evidence.map((item)=><SwiperSlide key={item.id}><EvidenceCard item={item}/></SwiperSlide>)}</Swiper>:<div className="ascent-empty"><AlertTriangle/><span>No verified evidence is available yet.</span></div>}</section>
    </main>
  </div>;
}
