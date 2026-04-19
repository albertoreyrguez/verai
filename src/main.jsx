import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Mock de window.storage usando localStorage
window.storage = {
  get: async (k) => {
    const v = localStorage.getItem(k)
    return v ? { value: v } : null
  },
  set: async (k, v) => {
    localStorage.setItem(k, String(v))
    return { key: k, value: v }
  },
  delete: async (k) => {
    localStorage.removeItem(k)
    return { key: k, deleted: true }
  },
  list: async () => ({ keys: Object.keys(localStorage) })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)