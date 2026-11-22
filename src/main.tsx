import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Elemen #app tidak ditemukan');
createRoot(root).render(<App />);
