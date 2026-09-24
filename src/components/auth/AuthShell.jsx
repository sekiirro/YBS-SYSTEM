import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import "@/styles/registration-landing.css";

export const HERO_BASE_IMAGE = "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260831_115955_2a9adb39-5e9b-4ced-96e2-6900eabe3de9.png&w=1920&q=85";
export const HERO_REVEAL_IMAGE = "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260831_123709_183f0065-efb2-4bb2-a849-13aaa5af2f3f.png&w=1920&q=85";
const PACKAGE_IMAGE = "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260831_121937_3f02b5a0-5b86-43d9-b30e-03c5e46632e7.png&w=1920&q=85";

// Shared YBS authentication shell. Login and invitation-only registration
// render inside this exact layout — only the right-side card changes.
// There is intentionally NO public "Create Account" action anywhere here:
// account creation exists solely because a valid invitation token resolved.
export default function AuthShell({
  workspaceName = "YBS Coaching",
  loginTarget = "/login",
  panelKicker,
  panelTitle,
  panelTitleId = "auth-panel-heading",
  panelSub,
  packageSummary = null,
  children,
}) {
  const revealRef = useRef(null);

  useEffect(() => {
    const reveal = revealRef.current;
    if (!reveal || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const updateReveal = (clientX, clientY) => {
      const rect = reveal.getBoundingClientRect();
      const radius = window.innerWidth < 480 ? 120 : window.innerWidth < 720 ? 160 : 260;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const mask = `radial-gradient(circle ${radius}px at ${x}px ${y}px, #fff 0%, #fff 40%, rgba(255,255,255,.75) 60%, rgba(255,255,255,.4) 75%, rgba(255,255,255,.12) 88%, transparent 100%)`;
      reveal.style.webkitMaskImage = mask;
      reveal.style.maskImage = mask;
    };
    const onMouseMove = (event) => updateReveal(event.clientX, event.clientY);
    const onTouchMove = (event) => event.touches[0] && updateReveal(event.touches[0].clientX, event.touches[0].clientY);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return (
    <main className="registration-scene">
      <div className="registration-image registration-image-base" style={{ backgroundImage: `url(${HERO_BASE_IMAGE})` }} aria-hidden="true" />
      <div ref={revealRef} className="registration-image registration-image-reveal" style={{ backgroundImage: `url(${HERO_REVEAL_IMAGE})` }} aria-hidden="true" />
      <div className="registration-shade" aria-hidden="true" />
      <header className="registration-header">
        <div>
          <Link to="/" className="registration-identity" aria-label="YBS home"><strong>YBS</strong><span aria-hidden="true">//</span><span>{workspaceName}</span></Link>
          <p>Trust the process. Build the result.</p>
        </div>
        <nav aria-label="Account actions">
          <Link to={loginTarget} className="registration-login">Login</Link>
        </nav>
      </header>
      <div className="registration-layout">
        <section className="registration-editorial" aria-label="YBS coaching">
          <div className="registration-copy">
            <p className="registration-kicker registration-fade" style={{ "--delay": ".45s" }}>Private coaching access</p>
            <h1 className="registration-title registration-words">
              <span>Trust the process.</span>
              <span>Build the result.</span>
            </h1>
            <p className="registration-intro registration-fade" style={{ "--delay": ".62s" }}>
              Your training, nutrition, and progress—connected to the team guiding your next phase.
            </p>
          </div>
          {packageSummary && <div className="registration-package-desktop">{packageSummary}</div>}
        </section>

        <section className="registration-form-panel registration-fade" style={{ "--delay": ".35s" }} aria-labelledby={panelTitleId}>
          <div className="registration-form-heading">
            {panelKicker && <p className="registration-kicker">{panelKicker}</p>}
            <h2 id={panelTitleId}>{panelTitle}</h2>
            {panelSub && <p>{panelSub}</p>}
          </div>
          {packageSummary && (
            <div className="registration-package-mobile">{packageSummary}</div>
          )}
          {children}
        </section>
      </div>
    </main>
  );
}

// Invitation / package card shown inside the shared shell. Rendered in the
// editorial column on desktop and above the form on mobile.
export function PackageSummary({ workspace, packageName, duration, workspaceName, isScopedLink }) {
  return (
    <article className="registration-package registration-fade" style={{ "--delay": ".82s" }} aria-label="Assigned package">
      <div className="registration-package-image" style={{ backgroundImage: `url(${PACKAGE_IMAGE})` }} aria-hidden="true" />
      <div className="registration-package-copy">
        <p className="registration-package-label">Your package</p>
        <h2>{packageName}</h2>
        <div className="registration-package-meta">
          {workspace?.package_tier && <span>{workspace.package_tier}</span>}
          <span>{duration}</span>
        </div>
        <p>{isScopedLink ? `Assigned by ${workspaceName}. This package is fixed for this registration link.` : "Submit your application to begin your YBS coaching journey."}</p>
      </div>
    </article>
  );
}

// Centered status card (loading / invalid / expired / used / success states)
// rendered on the same hero background so invitation errors never leave the
// shared authentication experience.
export function AuthStatusCard({ icon: Icon, iconClassName = "", eyebrow, title, description, action = null }) {
  return (
    <main className="registration-scene">
      <div className="registration-image registration-image-base" style={{ backgroundImage: `url(${HERO_BASE_IMAGE})` }} aria-hidden="true" />
      <div className="registration-image registration-image-reveal registration-state-reveal" style={{ backgroundImage: `url(${HERO_REVEAL_IMAGE})` }} aria-hidden="true" />
      <div className="registration-shade" aria-hidden="true" />
      <header className="registration-header">
        <div>
          <Link to="/" className="registration-identity" aria-label="YBS home"><strong>YBS</strong><span aria-hidden="true">//</span><span>Coaching OS</span></Link>
          <p>Trust the process. Build the result.</p>
        </div>
        <nav aria-label="Account actions">
          <Link to="/login" className="registration-login">Login</Link>
        </nav>
      </header>
      <section className="registration-link-state" role="status" aria-live="polite">
        {Icon && <span className="registration-success-icon"><Icon className={iconClassName} aria-hidden="true" /></span>}
        {eyebrow && <p className="registration-kicker">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {action}
      </section>
    </main>
  );
}
