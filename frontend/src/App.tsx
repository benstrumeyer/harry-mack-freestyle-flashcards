import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import FlashcardPage from './pages/FlashcardPage'
import OpenerDictionaryPage from './pages/OpenerDictionaryPage'
import RhymeDictionaryPage from './pages/RhymeDictionaryPage'
import PipelinePage from './pages/PipelinePage'

function App() {
  return (
    <BrowserRouter>
      <nav
        style={{
          display: 'flex',
          gap: '1.5rem',
          padding: '0.75rem 1.25rem',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        {[
          { to: '/', label: 'Flashcards', end: true },
          { to: '/openers', label: 'Openers', end: false },
          { to: '/rhymes', label: 'Rhymes', end: false },
          { to: '/pipeline', label: 'Pipeline', end: false },
        ].map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            style={({ isActive }) => ({
              color: isActive ? 'var(--color-primary)' : 'var(--color-muted)',
              textDecoration: 'none',
              transition: 'color 0.15s',
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route path="/" element={<FlashcardPage />} />
        <Route path="/openers" element={<OpenerDictionaryPage />} />
        <Route path="/rhymes" element={<RhymeDictionaryPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
