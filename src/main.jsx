import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { IconProvider } from './contexts/IconContext.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IconProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </IconProvider>
  </React.StrictMode>,
)
