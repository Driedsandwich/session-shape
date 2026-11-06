import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
// Novus by Pendo: boot once with an anonymous visitor. The app has no sign-in.
pendo?.initialize({
  visitor: { id: '' },
  excludeAllText: true,
  allowedText: [],
  recording: { enabled: false },
});
createRoot(document.getElementById('root')!).render(<App />);
