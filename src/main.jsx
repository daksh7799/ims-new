import React from 'react'
import ReactDOM from 'react-dom/client'

// ⛔ Comment out the normal App
// import App from './App.jsx'

// ✅ Use the no-auth App instead
import AppNoAuth from './App.jsx'

// GLOBAL STYLES (new UI)
import './styles.css'

// Toasts provider
import { ToastProvider } from './ui/toast.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      {/* <App /> */}
      <AppNoAuth />
    </ToastProvider>
  </React.StrictMode>
)
