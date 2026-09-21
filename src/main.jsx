import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-arabic'
import '@/styles/ybs-design.css'
import { MotionConfig } from 'framer-motion'

ReactDOM.createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user"><App /></MotionConfig>
)
