import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PageNotFound() {
  return <main className="min-h-dvh grid place-items-center bg-background p-6">
    <section className="ybs-hero w-full max-w-xl">
      <p className="ybs-eyebrow mb-6">Page not found</p>
      <h1 className="ybs-number text-primary">404</h1>
      <h2 className="ybs-title mt-6">Let’s get you back on track.</h2>
      <p className="mt-4 text-muted-foreground">This link may have changed or the page is no longer available.</p>
      <Link to="/" className="ybs-button ybs-button-primary mt-8 inline-flex items-center gap-2 px-5"><ArrowLeft size={18} /> Back to YBS</Link>
    </section>
  </main>;
}
