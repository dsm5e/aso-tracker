import { createRoot } from 'react-dom/client';
import '../../shared/ds.css';
import './styles.css';
import './ds-bridge.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
