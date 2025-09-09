import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// GLOBAL STYLES (new UI)
import './styles.css'

// Toasts provider
import { ToastProvider } from './ui/toast.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)
