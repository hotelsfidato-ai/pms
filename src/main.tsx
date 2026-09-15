import '@fontsource-variable/inter'
import './styles/theme.css'
/* Initialises the app and analytics. Imported for the side effect;
   nothing in Stage 1 reads application data through it. */
import '@/lib/firebase'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerServiceWorker } from '@/lib/sw'

/* After render, not before. Registration is a network call and the
   first paint should not wait on it. */
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
