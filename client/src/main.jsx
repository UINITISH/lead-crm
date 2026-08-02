import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { resolveToken } from './lib/api.js';
import './styles.css';

resolveToken().then(() => {
  createRoot(document.getElementById('root')).render(<App />);
});
