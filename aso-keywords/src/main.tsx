import { createRoot } from 'react-dom/client';
import '../../shared/ds.css';
import './styles.css';
import './ds-bridge.css';
import App from './App.tsx';
// after App: its screen stylesheets load first, this layer wins
import './polish.css';

createRoot(document.getElementById('root')!).render(<App />);
