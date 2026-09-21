import React from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { ArrowUpRight, Activity, Dumbbell, Apple, TrendingUp } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getLandingPath } from '@/lib/ybs-auth';
import { LoadingState } from '@/components/ui';

export default function Landing() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const { search } = useLocation();
  if (isLoadingAuth) return <LoadingState label="Opening YBS…" />;
  if (isAuthenticated && user) return <Navigate to={getLandingPath(user)} replace />;
  const login = { pathname: '/login', search };
  const register = { pathname: '/register', search };
  return (
    <div className="ybs-landing min-h-dvh">
      <header className="flex items-center justify-between gap-4 px-6 md:px-12 lg:px-20 py-6">
        <Link to="/" className="ybs-brand" aria-label="YBS home"><span className="ybs-monogram">Y</span><span className="ybs-wordmark">YBS</span></Link>
        <Link to={login} className="ybs-button inline-flex items-center gap-2 px-4 border border-white/20">Sign in <ArrowUpRight size={18} /></Link>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 md:px-12 lg:px-20 pt-16 lg:pt-28 pb-16">
        <p className="ybs-eyebrow flex items-center gap-2 mb-7"><Activity size={16} /> Your coaching, connected</p>
        <h1 className="max-w-5xl">Progress.<br /><span className="text-primary">With purpose.</span></h1>
        <div className="mt-10 grid lg:grid-cols-2 gap-8 lg:gap-20 items-end">
          <p className="text-lg md:text-xl leading-relaxed text-slate-300 max-w-xl">One place for your training, nutrition, and the progress you’re working toward. A clearer connection between you and your coach.</p>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link to={login} className="ybs-button ybs-button-primary inline-flex items-center justify-center gap-3 px-7 min-h-14">Open your workspace <ArrowUpRight size={20} /></Link>
            <Link to={register} className="ybs-button inline-flex items-center justify-center px-6 min-h-14 border border-white/25 hover:bg-white/5">Create an account</Link>
          </div>
        </div>
        <section aria-label="Your coaching essentials" className="mt-20 lg:mt-28 grid md:grid-cols-3 gap-8 lg:gap-14">
          {[
            [Dumbbell, 'Train with intention', 'Follow your program, record your sets, and keep your next session in focus.'],
            [Apple, 'Nutrition that fits', 'Your meals, portions, and daily targets, organized into a plan you can follow.'],
            [TrendingUp, 'See the bigger picture', 'Bring measurements, check-ins, and progress together over time.'],
          ].map(([Icon, title, description]) => <article className="ybs-landing-feature" key={title}><Icon className="text-primary mb-5" size={24} aria-hidden="true" /><h2>{title}</h2><p>{description}</p></article>)}
        </section>
      </main>
      <footer className="px-6 md:px-12 lg:px-20 py-7 border-t border-white/10 flex flex-wrap justify-between gap-3 text-sm text-slate-300"><span>© {new Date().getFullYear()} YBS</span><span>Technology meets human performance.</span></footer>
    </div>
  );
}
