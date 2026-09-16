import React, { useEffect, useRef, useMemo } from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import Hls from 'hls.js';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getLandingPath } from '@/lib/ybs-auth';

const MUX_HLS_URL = 'https://stream.mux.com/8wrHPCX2dC3msyYU9ObwqNdm00u3ViXvOSHUMRYSEe5Q.m3u8';

const EASE = [0.22, 1, 0.36, 1];

// Cinematic HLS background. Degrades gracefully to a static visual
// (the overlays below) if the player or the network fails — authentication
// entry must never depend on video playback.
function LandingVideo() {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let hls = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
      });
      hls.loadSource(MUX_HLS_URL);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = MUX_HLS_URL;
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover"
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
    />
  );
}

export default function Landing() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  const search = useMemo(() => location.search || '', [location.search]);

  // A valid session exists → bypass the marketing page entirely and hand off
  // to the existing role-aware authenticated destination.
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#050505]">
        <Loader2 className="w-7 h-7 animate-spin text-white/40" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    return <Navigate to={getLandingPath(user)} replace />;
  }

  const linkLogin = { pathname: '/login', search: search && search !== '?' ? search : '' };
  const linkRegister = { pathname: '/register', search: search && search !== '?' ? search : '' };

  const motionProps = reduceMotion
    ? { initial: false }
    : {};

  return (
    <div className="relative min-h-screen flex flex-col bg-[#050505] text-white overflow-x-hidden selection:bg-primary/50 selection:text-black">
      {/* Cinematic background */}
      <div className="absolute inset-0 -z-0">
        <div className="absolute inset-0 bg-black">
          <LandingVideo />
        </div>
        {/* Contrast overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/55 to-black/90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_45%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.55)_75%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 to-transparent" />
      </div>

      {/* Top wordmark + entry points */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-16 lg:px-24 h-20">
        <Link to="/" className="flex items-center gap-3 group">
          <span className="w-9 h-9 rounded-xl bg-primary text-black font-bold text-base tracking-tight flex items-center justify-center shadow-[0_0_24px_-6px_rgba(143,191,232,0.5)]">
            Y
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-brand text-lg tracking-tight">YBS</span>
            <span className="text-[10px] text-white/50 tracking-[0.25em] uppercase mt-0.5">
              Coaching System
            </span>
          </span>
        </Link>

        <div className="hidden sm:flex items-center gap-2">
          <Link
            to={linkLogin}
            className="px-4 h-9 inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors"
          >
            LOGIN <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to={linkRegister}
            className="px-4 h-9 inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-black bg-primary hover:bg-primary-hover shadow-[0_0_28px_-8px_rgba(143,191,232,0.5)] transition-colors"
          >
            CREATE ACCOUNT <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 md:px-16 lg:px-24 py-16 text-center">
        <motion.p
          {...motionProps}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="mb-6 text-[11px] md:text-xs tracking-[0.35em] uppercase text-primary/90"
        >
          Evidence-based&nbsp;·&nbsp;Data-driven&nbsp;·&nbsp;Built around you
        </motion.p>

        <motion.h1
          {...motionProps}
          initial={reduceMotion ? false : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
          className="font-brand text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight text-white text-balance"
        >
          YBS Coaching System
        </motion.h1>

        <motion.p
          {...motionProps}
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.32, ease: EASE }}
          className="mt-6 max-w-xl text-lg md:text-xl font-light text-white/70 leading-relaxed"
        >
          Where technology meets the science of human performance.
        </motion.p>

        <motion.div
          {...motionProps}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.52, ease: EASE }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto"
        >
          <Link
            to={linkLogin}
            className="w-full sm:w-auto h-12 px-8 inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold tracking-wide text-black bg-primary hover:bg-primary-hover shadow-[0_0_44px_-10px_rgba(143,191,232,0.6)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-hover focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            LOGIN <ArrowUpRight className="w-4 h-4" />
          </Link>
          <Link
            to={linkRegister}
            className="w-full sm:w-auto h-12 px-8 inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium tracking-wide text-white/85 bg-white/[0.04] border border-white/15 hover:bg-white/10 hover:border-white/25 liquid-glass backdrop-blur-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            CREATE ACCOUNT <ArrowUpRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 md:px-16 lg:px-24 pb-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 pt-6 border-t border-white/10">
          <p className="text-[12px] text-white/45 tracking-wide">© 2026 YBS. All rights reserved.</p>
          <p className="text-[11px] text-white/35 tracking-[0.2em] uppercase">
            Technology × Human Performance
          </p>
        </div>
      </footer>
    </div>
  );
}