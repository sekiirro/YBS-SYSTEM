import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-arabic'
import '@/styles/ybs-design.css'
import '@/styles/ybs-theme.css'
import '@/styles/client-dashboard-cinematic.css'
import '@/styles/client-nutrition-cinematic.css'
import '@/styles/client-forms-cinematic.css'
import '@/styles/client-workout-cinematic.css'
import '@/styles/client-metrics-cinematic.css'
import '@/styles/client-progress-mythic.css'
import '@/styles/evidence-of-ascent.css'
import ThemeProvider from '@/components/ThemeProvider'
import { applyTheme, readThemeMode } from '@/lib/theme'
import { MotionConfig } from 'framer-motion'

applyTheme(readThemeMode());

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider><MotionConfig reducedMotion="user"><App /></MotionConfig></ThemeProvider>
)
