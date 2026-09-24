import React, { useState, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '@/lib/AuthContext';
import { pageVariants } from '@/lib/motion';
import { LoadingState } from '@/components/ui';

// Shown only while a lazily-loaded route chunk downloads. Matches the app's
// existing loading state so navigation appearance is unchanged.
const RouteFallback = () => <LoadingState label="Loading…" />;

export default function Layout() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="ybs-workspace flex min-h-screen">
      <a className="ybs-skip" href="#workspace-content">Skip to content</a>
      <Sidebar
        user={user}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main id="workspace-content" className="ybs-workspace-main flex-1 min-w-0">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            className="h-full"
          >
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
