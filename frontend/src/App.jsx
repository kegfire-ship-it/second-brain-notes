import { useContext, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SharedNotePage from './pages/SharedNotePage';
import { handleRichCopy } from './utils/richCopy';
import useOfflineNotes from './hooks/useOfflineNotes';
import OfflineContext from './components/OfflineContext';
import OfflineNotes from './pages/OfflineNotes';

const ProtectedRoute = ({ children }) => {
  const offlineState = useContext(OfflineContext);
  if (!offlineState.token) return <Navigate to="/login" />;
  return offlineState.offline ? <OfflineNotes {...offlineState} /> : children;
};

function App() {
  const offlineState = useOfflineNotes();
  useEffect(() => {
    document.addEventListener('copy', handleRichCopy);
    return () => document.removeEventListener('copy', handleRichCopy);
  }, []);

  return (
    <BrowserRouter>
      <OfflineContext.Provider value={offlineState}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/shared/:token" element={<SharedNotePage />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </OfflineContext.Provider>
    </BrowserRouter>
  );
}

export default App;
