import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Без StrictMode: двойной вызов эффектов в dev освобождал бы (dispose) закешированную GLB-модель.
createRoot(root).render(<App />);
