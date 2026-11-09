import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/theme.js'
import App from './App.jsx'
import { registerOfflineShell } from './offline/registerOfflineShell.js'
import { startSessionRenewal } from './services/sessionRenewal.js'

registerOfflineShell()
startSessionRenewal()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
